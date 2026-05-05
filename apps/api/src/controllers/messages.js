const express = require('express');
const mongoose = require('mongoose');
const { requirePermission } = require('../lib/roles');
const Message = require('../models/Message');
const Thread = require('../models/Thread');
const Mailbox = require('../models/Mailbox');
const Ticket = require('../models/Ticket');
const EmailQueue = require('../models/EmailQueue');
const User = require('../models/User');
const { MailService } = require('../lib/services/smtp.service');
const { OutboundEmailQueueService } = require('../lib/services/outboundEmailQueue.service');
const emailTemplates = require('../utils/emailTemplates');
const { fetchAssignedApplications } = require('../lib/services/phpAccessScope.service');

const router = express.Router();

const messagePopulate = [
  { path: 'threadId', select: 'sourceCaseId subject status channel currentStage claimedBy mailboxId lastMessageAt' },
  { path: 'mailboxId', select: 'name emailAddress slug' },
  { path: 'ticketId', select: 'number title status priority sourceCaseId' },
];

function normalizeRecipients(recipients = {}) {
  return {
    to: Array.isArray(recipients.to) ? recipients.to : [],
    cc: Array.isArray(recipients.cc) ? recipients.cc : [],
    bcc: Array.isArray(recipients.bcc) ? recipients.bcc : [],
  };
}

function buildLastMessagePreview(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.slice(0, 280);
}

function resolveActivationTrigger({ direction, sender, explicitTrigger }) {
  const allowed = new Set(['system_issue', 'agent', 'candidate_email', 'unknown']);
  if (explicitTrigger && allowed.has(explicitTrigger)) return explicitTrigger;

  if (direction === 'inbound') return 'candidate_email';
  if (sender?.type === 'system') return 'system_issue';
  if (direction === 'outbound' || direction === 'internal') return 'agent';
  return 'unknown';
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function normalizeEmailList(values = []) {
  return Array.isArray(values)
    ? values.map((value) => normalizeEmail(value)).filter(Boolean)
    : [];
}

function buildHtmlFromBody(body) {
  const escaped = String(body || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
  return `<div>${escaped}</div>`;
}

function isPrivilegedThreadAdmin(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;

  if (Array.isArray(user.permissions) && user.permissions.includes('*')) {
    return true;
  }

  if (Array.isArray(user.roles)) {
    return user.roles.some((role) => {
      const roleName =
        typeof role === 'string'
          ? role
          : (typeof role?.name === 'string' ? role.name : '');
      return roleName.trim().toLowerCase() === 'admin';
    });
  }

  return false;
}

function hasThreadOwnershipAccess(req, thread) {
  const currentUserId = String(req?.user?._id || req?.user?.id || '').trim();
  if (!currentUserId || !thread) return false;

  const ownerCandidates = [
    String(thread.lastAssignedUserId || '').trim(),
    String(thread.workflowSnapshot?.currentUserId || '').trim(),
    String(thread.createdBy?._id || thread.createdBy || '').trim(),
    String(thread.claimedBy?._id || thread.claimedBy || '').trim(),
  ].filter(Boolean);

  return ownerCandidates.includes(currentUserId);
}

async function ensureThreadAccess(req, thread) {
  if (!thread) {
    return { allowed: false, statusCode: 404, message: 'Thread not found' };
  }

  if (isPrivilegedThreadAdmin(req?.user)) {
    return { allowed: true, scope: null };
  }

  if (!req._phpAccessScope) {
    req._phpAccessScope = await fetchAssignedApplications(req);
  }

  const scope = req._phpAccessScope;
  // Fail open if PHP scope is unavailable (missing cookie / PHP down). Threads.js uses the same behavior.
  if (!scope.applicationIds.length) {
    console.warn('No scope → fallback allow');
    return { allowed: true, scope: null };
  }

  if (hasThreadOwnershipAccess(req, thread)) {
    return { allowed: true, scope: null };
  }

  const sourceCaseId = typeof thread.sourceCaseId === 'string' ? thread.sourceCaseId.trim().toUpperCase() : null;
  if (!sourceCaseId || !scope.applicationIds.includes(sourceCaseId)) {
    return { allowed: false, statusCode: 403, message: 'You do not have access to this thread' };
  }

  return { allowed: true, scope: null };
}

async function resolveOutboundQueue(thread, explicitMailboxId) {
  const mailboxLookupId = explicitMailboxId || thread.mailboxId || null;
  if (mailboxLookupId && mongoose.Types.ObjectId.isValid(mailboxLookupId)) {
    const mailbox = await Mailbox.findById(mailboxLookupId).lean();
    if (!mailbox) {
      throw new Error('Mailbox not found');
    }

    if (mailbox.emailQueueId) {
      const queue = await EmailQueue.findOne({
        _id: mailbox.emailQueueId,
        active: true,
        isDeleted: false,
      });
      if (queue) {
        return { queue, mailbox };
      }
    }
  }

  const fallbackQueue = await EmailQueue.findOne({ active: true, isDeleted: false }).sort({ createdAt: 1 });
  if (!fallbackQueue) {
    throw new Error('No active email queue available');
  }

  return { queue: fallbackQueue, mailbox: null };
}

function formatFromAddress(name, email) {
  if (!email) return null;
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  return trimmedName ? `${trimmedName} <${email}>` : email;
}

function stringifyUserId(value) {
  if (!value) return null;
  return String(value).trim() || null;
}

function resolveThreadRecipientUserId(thread) {
  return (
    stringifyUserId(thread?.workflowSnapshot?.currentUserId) ||
    stringifyUserId(thread?.lastAssignedUserId) ||
    stringifyUserId(thread?.claimedBy) ||
    stringifyUserId(thread?.createdBy) ||
    null
  );
}

async function resolveUserEmailById(userId) {
  const normalizedUserId = stringifyUserId(userId);
  if (!normalizedUserId || !mongoose.Types.ObjectId.isValid(normalizedUserId)) {
    return null;
  }

  const user = await User.findById(normalizedUserId).select('email');
  return normalizeEmail(user?.email);
}

function resolveApprovedSenderIdentity({ sender, queue, mailbox }) {
  const queueEmail = normalizeEmail(queue?.username);
  const mailboxEmail = normalizeEmail(mailbox?.emailAddress);

  if (mailboxEmail && queueEmail && mailboxEmail !== queueEmail) {
    throw new Error(
      `Mailbox sender ${mailboxEmail} does not match authenticated queue user ${queueEmail}`
    );
  }

  const approvedEmail = mailboxEmail || queueEmail;
  if (!approvedEmail) {
    throw new Error('No approved sender email found for outbound mailbox');
  }

  return {
    email: approvedEmail,
    name: sender?.name || mailbox?.name || null,
  };
}

router.post('/', requirePermission([]), async (req, res) => {
  try {
    const {
      threadId,
      body,
      sender,
      direction = 'outbound',
      channel = 'email',
      mailboxId = null,
      ticketId = null,
      externalMessageId = null,
    } = req.body;

    if (!threadId) {
      return res.status(400).json({ success: false, message: 'threadId is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(threadId)) {
      return res.status(400).json({ success: false, message: 'threadId is invalid' });
    }

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ success: false, message: 'body is required' });
    }

    if (!sender || typeof sender !== 'object' || (!sender.email && !sender.name && !sender.id)) {
      return res.status(400).json({ success: false, message: 'sender is required' });
    }

    const thread = await Thread.findById(threadId);
    if (!thread) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    const access = await ensureThreadAccess(req, thread);
    if (!access.allowed) {
      return res.status(access.statusCode).json({
        success: false,
        message: access.message,
        ...(access.scope ? { scope: access.scope } : {}),
      });
    }

    if (mailboxId && !mongoose.Types.ObjectId.isValid(mailboxId)) {
      return res.status(400).json({ success: false, message: 'mailboxId is invalid' });
    }

    if (mailboxId) {
      const mailboxExists = await Mailbox.exists({ _id: mailboxId });
      if (!mailboxExists) {
        return res.status(404).json({ success: false, message: 'Mailbox not found' });
      }
    }

    const effectiveTicketId = ticketId || thread.ticketId || null;
    if (effectiveTicketId && !mongoose.Types.ObjectId.isValid(effectiveTicketId)) {
      return res.status(400).json({ success: false, message: 'ticketId is invalid' });
    }

    if (effectiveTicketId) {
      const ticketExists = await Ticket.exists({ _id: effectiveTicketId });
      if (!ticketExists) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }
    }

    const normalizedSenderEmail = normalizeEmail(sender.email);
    if (
      direction === 'inbound' &&
      thread.status === 'monitoring' &&
      thread.applicantEmail &&
      normalizedSenderEmail &&
      thread.applicantEmail !== normalizedSenderEmail
    ) {
      return res.status(409).json({
        success: false,
        message: 'Inbound sender does not match the monitoring thread applicantEmail',
      });
    }

    if (externalMessageId) {
      const existingMessage = await Message.findOne({ threadId, externalMessageId }).populate(messagePopulate);
      if (existingMessage) {
        return res.status(200).json({
          success: true,
          created: false,
          message: existingMessage,
        });
      }
    }

    const recipients = normalizeRecipients(req.body.recipients);
    const requestedRecipientEmail = normalizeEmail(req.body.recipientEmail);
    const template = emailTemplates.verificationIssue({
      appId: thread.sourceCaseId,
      message: req.body.body,
    });
    const messageBody = template.body.trim();
    let toEmail =
      requestedRecipientEmail ||
      thread.applicantEmail;

    if (!toEmail && direction === 'outbound' && channel === 'email') {
      const routedEmail = await resolveUserEmailById(resolveThreadRecipientUserId(thread));
      if (routedEmail) {
        toEmail = routedEmail;
      }
    }

    if (!toEmail && direction === 'outbound' && channel === 'email') {
      const lastMessage = await Message.findOne({ threadId: thread._id }).sort({ createdAt: -1 });
      if (lastMessage?.recipients?.to?.length) {
        toEmail = normalizeEmail(lastMessage.recipients.to[0]);
      }
    }

    if (!toEmail && direction === 'outbound' && channel === 'email') {
      throw new Error('Recipient email missing');
    }

    if (toEmail && !thread.applicantEmail && direction === 'outbound' && channel === 'email') {
      thread.applicantEmail = toEmail;
      await thread.save();
    }

    let resolvedRecipients = {
      to: normalizeEmailList(
        recipients.to.length > 0
          ? recipients.to
          : (direction === 'outbound' && toEmail ? [toEmail] : [])
      ),
      cc: normalizeEmailList(recipients.cc),
      bcc: normalizeEmailList(recipients.bcc),
    };

    if (resolvedRecipients.to.length === 0) {
      resolvedRecipients = {
        ...resolvedRecipients,
        to: normalizeEmailList(
          direction === 'outbound' && toEmail ? [toEmail] : []
        ),
      };
    }
    const subject =
      direction === 'outbound' && channel === 'email'
        ? emailTemplates.buildSubject(thread, template.subject)
        : thread.subject || emailTemplates.buildSubject(thread, template.subject);
    const baseMetadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const sentByUserId = stringifyUserId(sender.id || sender._id || null);
    const sentByRole = thread.workflowSnapshot?.currentRole || null;
    const requestedRecipientUserId = stringifyUserId(req.body.recipientUserId || null);
    const recipientUserId = requestedRecipientUserId || resolveThreadRecipientUserId(thread);

    if (!thread.lastAssignedUserId && sentByUserId && direction !== 'inbound') {
      thread.lastAssignedUserId = sentByUserId;
      await thread.save();
      console.log('Thread owner assigned:', thread.lastAssignedUserId);
    }

    if (resolvedRecipients.to.length === 0 && recipientUserId) {
      const internalRecipientEmail = await resolveUserEmailById(recipientUserId);
      if (internalRecipientEmail) {
        resolvedRecipients = {
          ...resolvedRecipients,
          to: [internalRecipientEmail],
        };
      }
    }

    let resolvedMailboxId = mailboxId || thread.mailboxId || null;
    let resolvedExternalMessageId = externalMessageId;
    let resolvedStatus = req.body.status || (direction === 'inbound' ? 'received' : 'sent');
    let resolvedBodyHtml = req.body.bodyHtml || template.html || null;
    let emailMessageRecord = null;
    let shouldSendEmail = channel === 'email' && direction !== 'inbound';
    let outboundQueueJob = null;

    if (channel === 'email' && direction === 'internal' && resolvedRecipients.to.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Internal email requires a valid recipientUserId or recipients.to email address',
      });
    }

    if (shouldSendEmail) {
      if (resolvedRecipients.to.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Email message requires at least one recipient',
        });
      }

      const { queue, mailbox } = await resolveOutboundQueue(thread, mailboxId);
      const approvedSender = resolveApprovedSenderIdentity({ sender, queue, mailbox });
      const htmlBody = resolvedBodyHtml || buildHtmlFromBody(messageBody);
      const outboundHeaders = thread.sourceCaseId
        ? {
            'X-Application-Id': thread.sourceCaseId,
            'X-SourceCaseId': thread.sourceCaseId,
            'X-Thread-Id': String(thread._id),
          }
        : {};

      outboundQueueJob = {
        queueId: queue._id,
        mailboxId: resolvedMailboxId || mailbox?._id || null,
        threadId: thread._id,
        sourceCaseId: thread.sourceCaseId || null,
        senderName: approvedSender.name || null,
        senderEmail: approvedSender.email,
        to: resolvedRecipients.to,
        cc: resolvedRecipients.cc,
        bcc: resolvedRecipients.bcc,
        subject: subject || '(No subject)',
        text: messageBody,
        html: htmlBody,
        inReplyTo: req.body.inReplyTo || null,
        references: Array.isArray(req.body.references) ? req.body.references : [],
        headers: outboundHeaders,
        sentByUserId: sender.id || sender._id || null,
        sentByRole,
        recipientUserId,
        metadata: {},
      };

      resolvedStatus = req.body.status || 'queued';
      resolvedBodyHtml = htmlBody;
      resolvedMailboxId = resolvedMailboxId || mailbox?._id || null;
    }

    const message = await Message.create({
      threadId,
      sourceCaseId: thread.sourceCaseId || null,
      ticketId: effectiveTicketId,
      mailboxId: resolvedMailboxId,
      direction,
      channel,
      sender: {
        id: sender.id || sender._id || null,
        name: sender.name || null,
        email: sender.email || null,
        type: sender.type || (sender.id || sender._id ? 'user' : 'external'),
      },
      sentByUserId,
      sentByRole,
      recipientUserId,
      recipients: resolvedRecipients,
      subject,
      body: messageBody,
      bodyHtml: resolvedBodyHtml,
      externalMessageId: resolvedExternalMessageId,
      emailMessageId: emailMessageRecord?._id || null,
      status: resolvedStatus,
      metadata: {
        ...baseMetadata,
        recipientUserId,
        workflowSnapshotAtSend: thread.workflowSnapshot || {},
      },
    });

    const shouldActivate = thread.status === 'monitoring';
    const activationTrigger = shouldActivate
      ? resolveActivationTrigger({
          direction,
          sender: message.sender,
          explicitTrigger: req.body.activationTrigger,
        })
      : null;

    await Thread.findByIdAndUpdate(threadId, {
      $inc: {
        unreadCount: direction === 'inbound' ? 1 : 0,
      },
      $set: {
        lastMessage: buildLastMessagePreview(message.body),
        lastMessageAt: message.createdAt,
        mailboxId: message.mailboxId || thread.mailboxId || null,
        ...(sentByUserId && direction !== 'inbound'
          ? { lastAssignedUserId: sentByUserId }
          : {}),
        ...(direction === 'inbound' && normalizedSenderEmail && !thread.applicantEmail
          ? { applicantEmail: normalizedSenderEmail }
          : {}),
        ...(shouldActivate
          ? {
              status: 'active',
              activatedAt: new Date(),
              ...(activationTrigger ? { activationTrigger } : {}),
            }
          : {}),
      },
    });

    const populatedMessage = await Message.findById(message._id).populate(messagePopulate);

    if (outboundQueueJob) {
      outboundQueueJob.metadata = {
        ...baseMetadata,
        messageId: message._id,
      };

      const job = await OutboundEmailQueueService.enqueue(outboundQueueJob, {
        idempotencyKey: externalMessageId || null,
        actor: {
          actorType: 'user',
          actorId: String(req.user?._id || ''),
          actorEmail: req.user?.email || null,
          actorName: req.user?.name || null,
        },
        requestId: req.headers['x-request-id'] || null,
      });
      await Message.findByIdAndUpdate(message._id, {
        $set: {
          metadata: {
            ...message.metadata,
            outboundJobId: job._id,
          },
        },
      });
      populatedMessage.metadata = {
        ...(populatedMessage.metadata || {}),
        outboundJobId: job._id,
      };
    }

    return res.status(201).json({
      success: true,
      created: true,
      message: populatedMessage,
    });
  } catch (error) {
    if (error?.code === 11000 && req.body.externalMessageId) {
      const message = await Message.findOne({
        threadId: req.body.threadId,
        externalMessageId: req.body.externalMessageId,
      }).populate(messagePopulate);

      return res.status(200).json({
        success: true,
        created: false,
        message,
      });
    }

    console.error('Error creating message:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/:threadId', requirePermission([]), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.threadId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid thread id',
      });
    }

    const thread = await Thread.findById(req.params.threadId).select('sourceCaseId');
    if (!thread) {
      return res.status(404).json({
        success: false,
        message: 'Thread not found',
      });
    }

    const access = await ensureThreadAccess(req, thread);
    if (!access.allowed) {
      return res.status(access.statusCode).json({
        success: false,
        message: access.message,
        ...(access.scope ? { scope: access.scope } : {}),
      });
    }

    const messages = await Message.find({ threadId: req.params.threadId })
      .populate(messagePopulate)
      .sort({ createdAt: 1 });

    return res.json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
