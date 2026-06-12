// phpBridge.js - Add this to your Node.js app
const express = require('express');
const fs = require('fs');
const path = require('path');
const { MailService } = require('./smtp.service');
const EmailQueue = require('../../models/EmailQueue');
const Thread = require('../../models/Thread');
const Message = require('../../models/Message');
const EmailMessage = require('../../models/EmailMessage');
const Mailbox = require('../../models/Mailbox');
const { fetchWorkflowSnapshot } = require('./workflowSnapshot.service');

const router = express.Router();

// API Key authentication for PHP
const API_KEY = process.env.PHP_API_KEY || null;
const MAX_SUBJECT_LENGTH = Number(process.env.PHP_BRIDGE_MAX_SUBJECT_LENGTH || 255);
const MAX_HTML_LENGTH = Number(process.env.PHP_BRIDGE_MAX_HTML_LENGTH || 200000); // ~200 KB text
const MAX_ATTACHMENTS = Number(process.env.PHP_BRIDGE_MAX_ATTACHMENTS || 10);
const MAX_ATTACHMENT_BYTES = Number(process.env.PHP_BRIDGE_MAX_ATTACHMENT_BYTES || 10 * 1024 * 1024); // 10 MB each
const RATE_LIMIT_ENABLED = String(process.env.PHP_BRIDGE_RATE_LIMIT_ENABLED || 'true').toLowerCase() === 'true';
const RATE_LIMIT_WINDOW_MS = Number(process.env.PHP_BRIDGE_RATE_LIMIT_WINDOW_MS || 60 * 1000); // 1 minute
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.PHP_BRIDGE_RATE_LIMIT_MAX_REQUESTS || 120);
const MAX_BULK_EMAILS = Number(process.env.PHP_BRIDGE_MAX_BULK_EMAILS || 200);
const RATE_LIMIT_CLEANUP_INTERVAL_MS = Math.max(RATE_LIMIT_WINDOW_MS, 30 * 1000);
const PHP_BRIDGE_DEBUG = String(process.env.PHP_BRIDGE_DEBUG || 'false').toLowerCase() === 'true';
const requestWindowStore = new Map();
const SEND_EMAIL_TRACE_LOG = path.join(__dirname, '../../../../tmp/send-email-trace.log');

function traceSendEmail(requestId, event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    requestId,
    event,
    ...data,
  };
  console.log('[SEND_EMAIL_TRACE]', entry);
  try {
    fs.mkdirSync(path.dirname(SEND_EMAIL_TRACE_LOG), { recursive: true });
    fs.appendFileSync(SEND_EMAIL_TRACE_LOG, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('[SEND_EMAIL_TRACE] write failed', { error: error.message });
  }
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeRecipients(to) {
  if (Array.isArray(to)) {
    return to.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof to === 'string') {
    return to
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function estimateBase64Size(content) {
  if (typeof content !== 'string') return 0;
  const cleaned = content.replace(/\s/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

function normalizeApplicationId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function normalizeComponentKey(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeWorkflowOwnerRole(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  if (normalized === 'component_verifier' || normalized === 'db_verifier') return 'verifier';
  if (normalized === 'component_validator') return 'validator';
  if (normalized === 'team_lead') return 'qa';
  return normalized;
}

function normalizePhpThreadId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function resolveApplicationIdentity(...values) {
  for (const value of values) {
    const normalized = normalizeApplicationId(value);
    if (normalized && typeof normalized === 'string' && normalized.trim()) {
      return normalized;
    }
  }
  return null;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function normalizeRecipientEmail(input) {
  if (typeof input !== 'string') return null;

  let value = input.replace(/\r?\n/g, ' ').trim();
  if (!value) return null;

  // Markdown mailto links: [label](mailto:user@example.com)
  const markdownMailtoMatch = value.match(/\[[^\]]*\]\(\s*mailto:([^)\s>]+)\s*\)/i);
  if (markdownMailtoMatch?.[1]) {
    value = markdownMailtoMatch[1].trim();
  }

  // Display name / angle bracket formats: Name <user@example.com>
  const angleBracketMatch = value.match(/<\s*([^>]+)\s*>/);
  if (angleBracketMatch?.[1]) {
    value = angleBracketMatch[1].trim();
  }

  // mailto:user@example.com
  value = value.replace(/^mailto:\s*/i, '').trim();

  // Mailto may still appear after other wrappers.
  const embeddedMailtoMatch = value.match(/mailto:([^\s>]+)/i);
  if (embeddedMailtoMatch?.[1]) {
    value = embeddedMailtoMatch[1].trim();
  }

  value = value.replace(/^["']|["']$/g, '').trim();

  // Extract one canonical email token from mixed display strings.
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/i);
  return emailMatch ? normalizeEmail(emailMatch[0]) : null;
}

function normalizeQueueId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function buildThreadReplyEnvelope({
  applicationId,
  thread = null,
  messages = [],
  legacyRecovered = false,
  legacyMessageCount = 0,
  fallbackReason = null,
  fallbackRecommended = null,
}) {
  const hasThread = Boolean(thread);
  const hasMessages = Array.isArray(messages) && messages.length > 0;

  return {
    success: true,
    source: 'node',
    applicationId,
    hasThread,
    hasMessages,
    thread: thread
      ? {
          id: String(thread._id),
          sourceCaseId: thread.sourceCaseId || applicationId || null,
          subject: thread.subject || null,
          status: thread.status || null,
          mailboxId: thread.mailboxId ? String(thread.mailboxId) : null,
          applicantEmail: thread.applicantEmail || null,
          currentStage: thread.currentStage || null,
          workflowSnapshot: thread.workflowSnapshot || {},
          lastMessageAt: thread.lastMessageAt || null,
          unreadCount: Number(thread.unreadCount || 0),
        }
      : null,
    messages,
    meta: {
      replyCount: Array.isArray(messages) ? messages.length : 0,
      legacyRecovered: Boolean(legacyRecovered),
      legacyMessageCount: Number(legacyMessageCount || 0),
      fallbackRecommended:
        typeof fallbackRecommended === 'boolean'
          ? fallbackRecommended
          : (!hasThread || !hasMessages),
      fallbackReason: fallbackReason || (!hasThread ? 'THREAD_NOT_FOUND' : (!hasMessages ? 'MESSAGES_NOT_FOUND' : null)),
    },
  };
}

function toReplyMessageShape(message, options = {}) {
  if (!message) return null;
  const sourceCaseId = resolveApplicationIdentity(
    message.sourceCaseId,
    options.sourceCaseId,
    message.metadata?.workflow?.applicationId,
    message.metadata?.applicationId,
    message.metadata?.sourceCaseId
  );

  return {
    id: options.syntheticId || String(message._id),
    threadId: message.threadId ? String(message.threadId) : (options.threadId || null),
    sourceCaseId: sourceCaseId || null,
    direction: message.direction || 'inbound',
    channel: message.channel || 'email',
    subject: message.subject || null,
    body: message.body || '',
    bodyHtml: message.bodyHtml || null,
    externalMessageId: message.externalMessageId || message.messageId || null,
    emailMessageId: message.emailMessageId ? String(message.emailMessageId) : (options.emailMessageId || null),
    mailboxId: message.mailboxId ? String(message.mailboxId) : (message.mailbox ? String(message.mailbox) : null),
    sender: message.sender || {
      name: options.senderName || null,
      email: options.senderEmail || null,
      type: options.senderType || 'external',
    },
    sentByUserId: message.sentByUserId ? String(message.sentByUserId) : null,
    sentByRole: message.sentByRole || null,
    recipientUserId: message.recipientUserId ? String(message.recipientUserId) : null,
    recipients: message.recipients || {
      to: Array.isArray(message.to) ? message.to : [],
      cc: Array.isArray(message.cc) ? message.cc : [],
      bcc: Array.isArray(message.bcc) ? message.bcc : [],
    },
    status: message.status || (message.direction === 'outbound' ? 'sent' : 'received'),
    createdAt: message.createdAt || message.date || null,
    metadata: {
      ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
    },
  };
}

function normalizeMessageLookupKey(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/^<|>$/g, '').toLowerCase();
  return normalized || null;
}

function getReplyMessageKeys(message) {
  const keys = [];
  const emailMessageId = message.emailMessageId ? String(message.emailMessageId) : null;
  const externalMessageId = normalizeMessageLookupKey(message.externalMessageId || message.messageId);
  const recordId = message._id ? String(message._id) : null;

  if (emailMessageId) keys.push(`email:${emailMessageId}`);
  if (externalMessageId) keys.push(`external:${externalMessageId}`);
  if (recordId) keys.push(`record:${recordId}`);

  return keys;
}

function getWorkflowComponentKeyFromEmail(email) {
  const headers = email?.headers && typeof email.headers === 'object' ? email.headers : {};
  return normalizeComponentKey(
    headers['x-workflow-component-key'] ||
      headers['X-Workflow-Component-Key'] ||
      headers['x-component-key'] ||
      headers['X-Component-Key'] ||
      email?.metadata?.workflow?.componentKey ||
      email?.metadata?.componentKey ||
      null
  );
}

function emailMessageToReplyShape(email, index, { applicationId, thread = null } = {}) {
  return toReplyMessageShape(
    {
      ...email,
      channel: 'email',
      status: email.direction === 'outbound' ? 'sent' : 'received',
    },
    {
      syntheticId: `email:${email._id || index}`,
      sourceCaseId: applicationId,
      threadId: email.threadId ? String(email.threadId) : (thread?._id ? String(thread._id) : null),
      emailMessageId: email._id ? String(email._id) : null,
      senderName: email.from || null,
      senderEmail: email.from || null,
      senderType: email.direction === 'outbound' ? 'system' : 'external',
      metadata: {
        legacyRecovered: true,
        sourceRecord: 'EmailMessage',
        workflow: {
          componentKey: getWorkflowComponentKeyFromEmail(email),
        },
      },
    }
  );
}

function matchesReplyFilters(message, { componentKey = null, sentByRole = null } = {}) {
  if (!message) return false;

  if (componentKey) {
    const candidateComponentKey =
      message.metadata?.workflow?.componentKey ||
      message.metadata?.componentKey ||
      null;
    const normalizedCandidate = String(candidateComponentKey || '').trim();
    const normalizedWanted = String(componentKey).trim();
    // Inbound replies often arrive without workflow component metadata.
    // Keep untagged rows so component-scoped views don't lose valid replies.
    if (normalizedCandidate !== '' && normalizedCandidate !== normalizedWanted) {
      return false;
    }
  }

  if (sentByRole) {
    if (String(message.sentByRole || '').trim() !== String(sentByRole).trim()) {
      return false;
    }
  }

  return true;
}

function appendApplicationIdToSubject(subject, applicationId) {
  if (!applicationId) return subject;
  const rawSubject = typeof subject === 'string' ? subject.trim() : '';
  const token = `[${applicationId}]`;
  if (!rawSubject) return token;

  const alreadyHasId = rawSubject.toUpperCase().includes(applicationId);
  if (alreadyHasId) return rawSubject;

  const next = `${rawSubject} ${token}`.trim();
  if (next.length <= MAX_SUBJECT_LENGTH) return next;

  // Trim subject to fit within MAX_SUBJECT_LENGTH when appending token.
  const allowance = Math.max(0, MAX_SUBJECT_LENGTH - (token.length + 1));
  const trimmed = rawSubject.slice(0, allowance).trimEnd();
  return `${trimmed} ${token}`.trim();
}

async function resolveQueue(queueId) {
  if (queueId) {
    return EmailQueue.findOne({ _id: queueId, active: true, isDeleted: false });
  }

  const defaultQueue = await EmailQueue.findOne({ default: true, active: true, isDeleted: false });
  if (defaultQueue) return defaultQueue;

  return EmailQueue.findOne({ active: true, isDeleted: false }).sort({ createdAt: 1 });
}

async function resolveMailboxForQueue(queue) {
  if (!queue?._id) return null;

  const mailbox = await Mailbox.findOne({
    $or: [
      { emailQueueId: queue._id },
      { emailAddress: normalizeEmail(queue.username) },
    ],
  }).sort({ createdAt: 1 });

  return mailbox || null;
}

async function ensureMonitoringThread({
  applicationId,
  componentKey = null,
  ownerRole = null,
  phpThreadId = null,
  applicantEmail,
  linkSentAt,
  subject,
  mailboxId,
}) {
  if (!applicationId) return null;
  const normalizedComponentKey = normalizeComponentKey(componentKey);
  const normalizedOwnerRole = normalizeWorkflowOwnerRole(ownerRole);
  const normalizedPhpThreadId = normalizePhpThreadId(phpThreadId);

  const safeLinkSentAt = linkSentAt && !Number.isNaN(linkSentAt.getTime()) ? linkSentAt : new Date();
  const setOnInsert = {
    sourceCaseId: applicationId,
    componentKey: normalizedComponentKey,
    status: 'monitoring',
    isMapped: true,
    'metadata.createdAt': new Date(),
  };

  const set = {
    'metadata.applicationId': applicationId,
    'metadata.workflow.componentKey': normalizedComponentKey,
  };

  if (normalizedOwnerRole) {
    set['metadata.ownerRole'] = normalizedOwnerRole;
    set['metadata.workflow.ownerRole'] = normalizedOwnerRole;
  }

  if (normalizedPhpThreadId) {
    set['metadata.phpThreadId'] = normalizedPhpThreadId;
    set['metadata.workflow.threadId'] = normalizedPhpThreadId;
  }

  if (applicantEmail) {
    set.applicantEmail = applicantEmail;
    set['metadata.applicantEmail'] = applicantEmail;
  }

  if (safeLinkSentAt) {
    set.linkSentAt = safeLinkSentAt;
    set['metadata.linkSentAt'] = safeLinkSentAt;
  }

  if (subject) {
    set.subject = subject;
  }

  if (mailboxId) {
    set.mailboxId = mailboxId;
  }

  const setKeys = Object.keys(set);
  const setOnInsertKeys = Object.keys(setOnInsert);
  const isPathConflict = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  const overlappingKeys = [];
  for (const left of setKeys) {
    for (const right of setOnInsertKeys) {
      if (isPathConflict(left, right)) {
        overlappingKeys.push([left, right]);
      }
    }
  }
  console.log('[PHP BRIDGE] ensureMonitoringThread upsert-shape', {
    setKeys,
    setOnInsertKeys,
    overlappingKeys,
    applicationId,
  });

  return Thread.findOneAndUpdate(
    { sourceCaseId: applicationId, componentKey: normalizedComponentKey },
    {
      $setOnInsert: setOnInsert,
      $set: set,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function mirrorOutboundThreadMessage({
  thread,
  mailboxId,
  subject,
  htmlBody,
  textBody,
  emailMessageId = null,
  externalMessageId,
  senderEmail,
  senderName,
  recipients,
  metadata,
}) {
  if (!thread || !externalMessageId) {
    return null;
  }

  const workflowMeta =
    metadata && typeof metadata === 'object' && metadata.workflow && typeof metadata.workflow === 'object'
      ? metadata.workflow
      : {};
  const resolvedSourceCaseId = normalizeApplicationId(
    thread.sourceCaseId ||
      workflowMeta.applicationId ||
      metadata?.applicationId ||
      metadata?.sourceCaseId
  ) || null;
  const resolvedSentByUserId = toSafeId(workflowMeta.senderUserId) || null;
  const resolvedSentByRole = toSafeId(workflowMeta.senderRole) || null;

  const existing = await Message.findOne({ threadId: thread._id, externalMessageId });
  if (existing) {
    return existing;
  }

  const message = await Message.create({
    threadId: thread._id,
    sourceCaseId: resolvedSourceCaseId,
    ticketId: thread.ticketId || null,
    mailboxId: mailboxId || thread.mailboxId || null,
    direction: 'outbound',
    channel: 'email',
    sender: {
      id: null,
      name: senderName || null,
      email: senderEmail || null,
      type: senderEmail ? 'system' : 'external',
    },
    sentByUserId: resolvedSentByUserId,
    sentByRole: resolvedSentByRole,
    recipients: {
      to: recipients.map((value) => normalizeEmail(value)).filter(Boolean),
      cc: [],
      bcc: [],
    },
    subject: subject || thread.subject || null,
    body: String(textBody || '').trim() || 'No Body',
    bodyHtml: htmlBody || null,
    externalMessageId,
    emailMessageId,
    status: 'sent',
    metadata: {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      phpBridge: true,
    },
  });

  const shouldActivate = thread.status === 'monitoring';
  await Thread.findByIdAndUpdate(thread._id, {
    $set: {
      lastMessage: String(message.body || '').replace(/\s+/g, ' ').trim().slice(0, 280) || null,
      lastMessageAt: message.createdAt,
      mailboxId: message.mailboxId || thread.mailboxId || null,
      ...(shouldActivate
        ? {
            status: 'active',
            activatedAt: new Date(),
            activationTrigger: 'agent',
          }
        : {}),
    },
  });

  return message;
}

function validateEmailPayload(body) {
  const errors = [];
  const recipients = normalizeRecipients(body.to);

  if (recipients.length === 0) {
    errors.push('Missing required field: to');
  } else if (!recipients.every(isValidEmail)) {
    errors.push('Invalid recipient email format in `to`');
  }

  if (typeof body.subject !== 'string' || body.subject.trim().length === 0) {
    errors.push('Missing required field: subject');
  } else if (body.subject.length > MAX_SUBJECT_LENGTH) {
    errors.push(`Subject too long. Max ${MAX_SUBJECT_LENGTH} characters`);
  }

  if (body.fromEmail && !isValidEmail(body.fromEmail)) {
    errors.push('Invalid fromEmail format');
  }

  if (typeof body.htmlBody !== 'string' || body.htmlBody.trim().length === 0) {
    errors.push('Missing required field: htmlBody');
  } else if (body.htmlBody.length > MAX_HTML_LENGTH) {
    errors.push(`htmlBody too large. Max ${MAX_HTML_LENGTH} characters`);
  }

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachments.length > MAX_ATTACHMENTS) {
    errors.push(`Too many attachments. Max ${MAX_ATTACHMENTS}`);
  }

  attachments.forEach((att, index) => {
    if (!att || typeof att !== 'object') {
      errors.push(`Attachment[${index}] must be an object`);
      return;
    }

    if (!att.filename || typeof att.filename !== 'string') {
      errors.push(`Attachment[${index}] missing filename`);
    }

    if (!att.content || typeof att.content !== 'string') {
      errors.push(`Attachment[${index}] missing content`);
      return;
    }

    const approxSize = estimateBase64Size(att.content);
    if (approxSize > MAX_ATTACHMENT_BYTES) {
      errors.push(
        `Attachment[${index}] exceeds limit (${approxSize} bytes > ${MAX_ATTACHMENT_BYTES} bytes)`
      );
    }
  });

  return { errors, recipients, attachments };
}

function getRateLimitKey(req) {
  const apiKey = req.headers['x-api-key'] || 'no-key';
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return `${apiKey}:${ip}`;
}

function cleanupRateLimitStore(now) {
  for (const [key, bucket] of requestWindowStore.entries()) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      requestWindowStore.delete(key);
    }
  }
}

setInterval(() => cleanupRateLimitStore(Date.now()), RATE_LIMIT_CLEANUP_INTERVAL_MS).unref();

function summarizePhpBridgePayload(body) {
  if (!body || typeof body !== 'object') return null;

  const to = normalizeRecipients(body.to);
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const metadataKeys =
    body.metadata && typeof body.metadata === 'object' ? Object.keys(body.metadata).slice(0, 20) : [];
  const subjectLength = typeof body.subject === 'string' ? body.subject.length : 0;
  const htmlLength = typeof body.htmlBody === 'string' ? body.htmlBody.length : 0;

  return {
    keys: Object.keys(body).slice(0, 30),
    queueId: body.queueId || null,
    applicationId: body.applicationId || body.sourceCaseId || body.metadata?.applicationId || null,
    toCount: to.length,
    toPreview: to.slice(0, 3),
    subjectLength,
    hasHtmlBody: htmlLength > 0,
    htmlLength,
    fromEmail: normalizeEmail(body.fromEmail),
    hasFromName: typeof body.fromName === 'string' && body.fromName.trim().length > 0,
    attachmentsCount: attachments.length,
    attachmentNames: attachments
      .map((attachment) => (attachment && typeof attachment.filename === 'string' ? attachment.filename : null))
      .filter(Boolean)
      .slice(0, 10),
    metadataKeys,
  };
}

function toSafeId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWorkflowRecipientList(recipientEmail, recipientName) {
  const email = normalizeRecipientEmail(recipientEmail);
  if (!email) return [];
  return [
    {
      email,
      name: toSafeId(recipientName) || '',
    },
  ];
}

function normalizeWorkflowBodies(messageBody) {
  const raw = String(messageBody || '');
  const trimmed = raw.trim();
  const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(trimmed);
  const escaped = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br />');

  const htmlBody = hasHtmlTags ? trimmed : `<div>${escaped}</div>`;
  const textBody = String(htmlBody).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || trimmed;
  return { htmlBody, textBody };
}

async function resolveWorkflowThread({
  nodeThreadId,
  nodeConversationId,
  applicationId,
  componentKey = null,
  ownerRole = null,
  phpThreadId = null,
  recipientEmail,
  subject,
}) {
  const requestedThreadId = toSafeId(nodeThreadId) || toSafeId(nodeConversationId);
  const normalizedComponentKey = normalizeComponentKey(componentKey);
  const normalizedOwnerRole = normalizeWorkflowOwnerRole(ownerRole);
  const normalizedPhpThreadId = normalizePhpThreadId(phpThreadId);

  if (requestedThreadId) {
    const existingById = await Thread.findById(requestedThreadId);
    if (existingById) {
      return { thread: existingById, reused: true, source: 'id' };
    }
  }

  if (applicationId) {
    let existingByCase = await Thread.findOne({ sourceCaseId: applicationId, componentKey: normalizedComponentKey });
    if (!existingByCase && normalizedComponentKey) {
      existingByCase = await Thread.findOne({ sourceCaseId: applicationId, componentKey: null });
    }
    if (existingByCase) {
      const updates = {};
      if (recipientEmail && !existingByCase.applicantEmail) {
        updates.applicantEmail = recipientEmail;
        updates['metadata.applicantEmail'] = recipientEmail;
      }
      if (subject && !existingByCase.subject) {
        updates.subject = subject;
      }
      if (normalizedComponentKey && !existingByCase.componentKey) {
        updates.componentKey = normalizedComponentKey;
      }
      if (normalizedComponentKey) {
        updates['metadata.workflow.componentKey'] = normalizedComponentKey;
      }
      if (normalizedOwnerRole) {
        updates['metadata.ownerRole'] = normalizedOwnerRole;
        updates['metadata.workflow.ownerRole'] = normalizedOwnerRole;
      }
      if (normalizedPhpThreadId) {
        updates['metadata.phpThreadId'] = normalizedPhpThreadId;
        updates['metadata.workflow.threadId'] = normalizedPhpThreadId;
      }
      if (Object.keys(updates).length) {
        await Thread.findByIdAndUpdate(existingByCase._id, { $set: updates });
      }
      return { thread: existingByCase, reused: true, source: 'sourceCaseId' };
    }

    const created = await ensureMonitoringThread({
      applicationId,
      componentKey: normalizedComponentKey,
      ownerRole: normalizedOwnerRole,
      phpThreadId: normalizedPhpThreadId,
      applicantEmail: recipientEmail,
      linkSentAt: new Date(),
      subject,
      mailboxId: null,
    });
    return { thread: created, reused: false, source: 'created' };
  }

  return { thread: null, reused: false, source: 'none' };
}

function phpBridgeDebugLogger(req, res, next) {
  if (!PHP_BRIDGE_DEBUG) return next();

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  req._phpBridgeRequestId = requestId;
  const startedAt = Date.now();

  console.log(`[PHP BRIDGE][${requestId}] IN`, {
    method: req.method,
    path: req.originalUrl || req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    contentType: req.headers['content-type'] || null,
    hasApiKey: Boolean(req.headers['x-api-key']),
    payload: summarizePhpBridgePayload(req.body),
  });

  res.on('finish', () => {
    console.log(`[PHP BRIDGE][${requestId}] OUT`, {
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  return next();
}

// Middleware to verify API key
function authenticatePhp(req, res, next) {
  if (!API_KEY) {
    if (PHP_BRIDGE_DEBUG) {
      console.warn(`[PHP BRIDGE][${req._phpBridgeRequestId || 'no-id'}] Auth failed: PHP_API_KEY not configured`);
    }
    return res.status(503).json({
      success: false,
      error: 'PHP bridge is disabled. Set PHP_API_KEY to enable it.'
    });
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== API_KEY) {
    if (PHP_BRIDGE_DEBUG) {
      console.warn(`[PHP BRIDGE][${req._phpBridgeRequestId || 'no-id'}] Auth failed: invalid x-api-key`, {
        hasApiKey: Boolean(apiKey),
      });
    }
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized - Invalid API key' 
    });
  }
  next();
}

function rateLimitPhp(req, res, next) {
  if (!RATE_LIMIT_ENABLED) {
    return next();
  }

  const now = Date.now();
  const key = getRateLimitKey(req);
  const existing = requestWindowStore.get(key);

  if (!existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS) {
    requestWindowStore.set(key, { windowStart: now, count: 1 });
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', RATE_LIMIT_MAX_REQUESTS - 1);
    return next();
  }

  existing.count += 1;
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - existing.count);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (existing.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds);
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Rate limit exceeded for PHP bridge.',
      retryAfterSeconds,
    });
  }

  return next();
}

// Apply bridge-specific security middleware to every PHP bridge route
router.use(phpBridgeDebugLogger);
router.use(authenticatePhp, rateLimitPhp);

router.post('/send-email', async (req, res) => {
  const requestId = req._phpBridgeRequestId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { subject, htmlBody, fromName, fromEmail } = req.body;
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const requestedHeaders = req.body?.headers && typeof req.body.headers === 'object' ? req.body.headers : {};
    const requestedQueueId =
      normalizeQueueId(req.body?.queueId) ||
      normalizeQueueId(metadata?.queue_id) ||
      null;
    const applicationIdCandidate =
      req.body?.applicationId ||
      req.body?.sourceCaseId ||
      metadata?.applicationId ||
      metadata?.sourceCaseId;
    const componentKey = normalizeComponentKey(
      req.body?.componentKey ||
      req.body?.component_key ||
      metadata?.componentKey ||
      metadata?.component_key ||
      metadata?.workflow?.componentKey ||
      metadata?.workflow?.component_key
    );
    const ownerRole = normalizeWorkflowOwnerRole(
      req.body?.ownerRole ||
      req.body?.owner_role ||
      metadata?.ownerRole ||
      metadata?.owner_role ||
      metadata?.threadOwnerRole ||
      metadata?.thread_owner_role ||
      metadata?.workflow?.ownerRole ||
      metadata?.workflow?.owner_role ||
      metadata?.workflow?.senderRole ||
      metadata?.workflow?.sender_role
    );
    const phpThreadId = normalizePhpThreadId(
      req.body?.phpThreadId ||
      req.body?.php_thread_id ||
      metadata?.phpThreadId ||
      metadata?.php_thread_id ||
      metadata?.threadId ||
      metadata?.thread_id ||
      metadata?.workflow?.threadId ||
      metadata?.workflow?.thread_id ||
      req.headers?.['x-workflow-thread-id']
    );
    const applicationId =
      typeof applicationIdCandidate === 'string' && applicationIdCandidate.trim()
        ? normalizeApplicationId(applicationIdCandidate)
        : null;

    traceSendEmail(requestId, 'route_entry', {
      path: req.originalUrl || req.path,
      method: req.method,
      body: {
        keys: Object.keys(req.body || {}),
        to: req.body?.to || null,
        subject: typeof subject === 'string' ? subject : null,
        queueId: requestedQueueId,
        applicationId,
        componentKey,
        ownerRole,
        phpThreadId,
        metadata,
        headers: requestedHeaders,
      },
    });

    const validation = validateEmailPayload(req.body);
    if (validation.errors.length > 0) {
      traceSendEmail(requestId, 'final_http_response', {
        statusCode: 400,
        body: {
          success: false,
          error: 'Invalid request payload',
          details: validation.errors,
        },
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid request payload',
        details: validation.errors
      });
    }

    traceSendEmail(requestId, 'queue_resolution_start', { requestedQueueId });
    const queue = await resolveQueue(requestedQueueId);
    traceSendEmail(requestId, 'queue_resolution_end', {
      found: Boolean(queue),
      queueId: queue?._id ? String(queue._id) : null,
      queueName: queue?.name || null,
      username: queue?.username || null,
      active: queue?.active ?? null,
      isDeleted: queue?.isDeleted ?? null,
    });

    if (!queue) {
      const activeQueues = await EmailQueue.find({ active: true, isDeleted: false })
        .select('_id name username')
        .sort({ createdAt: 1 })
        .limit(20)
        .lean();
      traceSendEmail(requestId, 'final_http_response', {
        statusCode: 404,
        body: {
          success: false,
          error: 'Queue not found',
          requestedQueueId,
        },
      });
      return res.status(404).json({
        success: false,
        error: 'Queue not found',
        details: {
          requestedQueueId,
          hint:
            'Use a valid active queue _id from the current MongoDB database (and ensure isDeleted=false).',
          availableActiveQueues: activeQueues.map((item) => ({
            id: String(item._id),
            name: item.name || null,
            username: item.username || null,
          })),
        },
      });
    }

    const finalSubject = applicationId
      ? appendApplicationIdToSubject(subject, applicationId)
      : subject.trim();

    const textBody = htmlBody.replace(/<[^>]*>/g, '');
    const queueEmail = normalizeEmail(queue.username);
    const requestedFromEmail = normalizeEmail(fromEmail);
    const safeFromEmail = requestedFromEmail === queueEmail ? requestedFromEmail : null;
    if (requestedFromEmail && !safeFromEmail) {
      console.warn(
        `PHP bridge ignored fromEmail ${requestedFromEmail}; using authenticated queue sender ${queueEmail}`
      );
    }
    const sender =
      safeFromEmail && fromName
        ? `${fromName.trim()} <${safeFromEmail}>`
        : (safeFromEmail || undefined);
    
    // Add tracking pixel or metadata if needed
    let finalHtml = htmlBody;
    if (metadata.ticketId && process.env.APP_URL) {
      // Add tracking pixel for ticket emails
      const trackingPixel = `<img src="${process.env.APP_URL}/api/tracking/open?ticket=${metadata.ticketId}&email=${encodeURIComponent(validation.recipients.join(','))}" width="1" height="1" />`;
      finalHtml = htmlBody + trackingPixel;
    }

    // Send email using MailService
    const applicantEmail = typeof req.body?.applicantEmail === 'string'
      ? normalizeEmail(req.body.applicantEmail)
      : (validation.recipients?.[0] ? normalizeEmail(validation.recipients[0]) : null);
    const linkSentAt = req.body?.linkSentAt ? new Date(req.body.linkSentAt) : new Date();
    traceSendEmail(requestId, 'mailbox_resolution_start', {
      queueId: queue?._id ? String(queue._id) : null,
      queueUsername: queue?.username || null,
    });
    const mailbox = await resolveMailboxForQueue(queue);
    traceSendEmail(requestId, 'mailbox_resolution_end', {
      found: Boolean(mailbox),
      mailboxId: mailbox?._id ? String(mailbox._id) : null,
      emailAddress: mailbox?.emailAddress || null,
    });
    traceSendEmail(requestId, 'ensureMonitoringThread_start', {
      applicationId,
      componentKey,
      ownerRole,
      phpThreadId,
      query: applicationId ? { sourceCaseId: applicationId, componentKey } : null,
    });
    const thread = applicationId
      ? await ensureMonitoringThread({
          applicationId,
          componentKey,
          ownerRole,
          phpThreadId,
          applicantEmail,
          linkSentAt,
          subject: finalSubject,
          mailboxId: mailbox?._id || null,
        })
      : null;
    traceSendEmail(requestId, 'ensureMonitoringThread_end', {
      found: Boolean(thread),
      threadId: thread?._id ? String(thread._id) : null,
      sourceCaseId: thread?.sourceCaseId || null,
      componentKey: thread?.componentKey || null,
      ownerRole: thread?.metadata?.ownerRole || null,
      phpThreadId: thread?.metadata?.phpThreadId || null,
      status: thread?.status || null,
    });

    traceSendEmail(requestId, 'smtp_send_start', {
      queueId: queue?._id ? String(queue._id) : null,
      to: validation.recipients,
      subject: finalSubject,
      componentKey,
      ownerRole,
      phpThreadId,
    });
    const result = await MailService.sendEmail({
      to: validation.recipients.join(','),
      subject: finalSubject,
      text: textBody,
      html: finalHtml,
      queue,
      from: sender,
      headers: {
        ...(applicationId
          ? {
              'X-Application-Id': applicationId,
              'X-SourceCaseId': applicationId,
            }
          : {}),
        ...Object.entries(requestedHeaders).reduce((acc, [key, value]) => {
          const safeKey = String(key || '').trim();
          const safeValue = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
          if (!safeKey || !safeValue) return acc;
          acc[safeKey] = safeValue;
          return acc;
        }, {}),
      },
      attachments: validation.attachments.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
        encoding: 'base64'
      }))
    });
    traceSendEmail(requestId, 'smtp_send_end', {
      messageId: result?.messageId || null,
      accepted: Array.isArray(result?.accepted) ? result.accepted : [],
      rejected: Array.isArray(result?.rejected) ? result.rejected : [],
      pending: Array.isArray(result?.pending) ? result.pending : [],
      response: result?.response || null,
    });

    // Always persist outbound email (sent) to MongoDB for auditability and UI.
    // This is intentionally independent of thread/message activation (hybrid lifecycle).
    let sentEmailRecord = null;
    try {
      traceSendEmail(requestId, 'emailmessage_persistence_start', {
        mailbox: queue?._id ? String(queue._id) : null,
        messageId: result?.messageId || null,
        threadId: thread?._id ? String(thread._id) : null,
        sourceCaseId: applicationId || null,
      });
      const attachmentsSummary = validation.attachments.map((att) => ({
        filename: att.filename,
        contentType: att.contentType,
        size: estimateBase64Size(att.content),
      }));

      sentEmailRecord = await EmailMessage.findOneAndUpdate(
        { mailbox: queue._id, messageId: result.messageId },
        {
          $setOnInsert: {
            mailbox: queue._id,
            messageId: result.messageId,
            folder: 'sent',
            subject: finalSubject,
            body: finalHtml || htmlBody,
            from: queue.username,
            to: validation.recipients,
            cc: [],
            bcc: [],
            date: new Date(),
            isRead: true,
            attachments: attachmentsSummary,
          },
          $set: {
            mailboxId: mailbox?._id || null,
            threadId: thread?._id || null,
            sourceCaseId: applicationId || null,
            direction: 'outbound',
            headers: {
              ...(applicationId
                ? {
                    'x-application-id': applicationId,
                    'x-sourcecaseid': applicationId,
                  }
                : {}),
              ...Object.entries(requestedHeaders).reduce((acc, [key, value]) => {
                const safeKey = String(key || '').trim().toLowerCase();
                const safeValue = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
                if (!safeKey || !safeValue) return acc;
                acc[safeKey] = safeValue;
                return acc;
              }, {}),
            },
          },
        },
        { upsert: true, new: true }
      );
      traceSendEmail(requestId, 'emailmessage_persistence_end', {
        success: Boolean(sentEmailRecord),
        emailMessageId: sentEmailRecord?._id ? String(sentEmailRecord._id) : null,
        messageId: sentEmailRecord?.messageId || null,
      });
    } catch (persistError) {
      traceSendEmail(requestId, 'emailmessage_persistence_error', {
        error: persistError.message,
        code: persistError.code || null,
      });
      console.error('Failed to persist sent email:', persistError);
    }

    try {
      traceSendEmail(requestId, 'message_persistence_start', {
        threadId: thread?._id ? String(thread._id) : null,
        emailMessageId: sentEmailRecord?._id ? String(sentEmailRecord._id) : null,
        externalMessageId: result?.messageId || null,
        componentKey,
        ownerRole,
        phpThreadId,
      });
      const messageRecord = await mirrorOutboundThreadMessage({
        thread,
        mailboxId: mailbox?._id || null,
        subject: finalSubject,
        htmlBody: finalHtml,
        textBody,
        emailMessageId: sentEmailRecord?._id || null,
        externalMessageId: result.messageId,
        senderEmail: normalizeEmail(fromEmail) || normalizeEmail(queue.username),
        senderName: fromName || queue.name || null,
        recipients: validation.recipients,
        metadata: {
          ...metadata,
          applicationId,
          componentKey,
          ownerRole,
          phpThreadId,
          queueId: String(queue._id),
          workflow: {
            ...(metadata.workflow && typeof metadata.workflow === 'object' ? metadata.workflow : {}),
            componentKey,
            ownerRole,
            threadId: phpThreadId,
          },
        },
      });
      traceSendEmail(requestId, 'message_persistence_end', {
        success: Boolean(messageRecord),
        messageId: messageRecord?._id ? String(messageRecord._id) : null,
        externalMessageId: messageRecord?.externalMessageId || null,
      });
    } catch (messageMirrorError) {
      traceSendEmail(requestId, 'message_persistence_error', {
        error: messageMirrorError.message,
        code: messageMirrorError.code || null,
      });
      console.error('Failed to mirror PHP bridge email into thread messages:', messageMirrorError);
    }

    // Log to database if you have an EmailLog model
    if (global.EmailLog) {
      await EmailLog.create({
        messageId: result.messageId,
        from: queue.username,
        to: validation.recipients,
        subject,
        status: 'sent',
        metadata,
        queueId: queue._id
      });
    }

    // Backward compatible flag: keep accepting saveToSent but persistence is now always-on.

    const responseBody = {
      success: true,
      messageId: result.messageId,
      queue: queue.name,
      delivery: {
        accepted: Array.isArray(result.accepted) ? result.accepted : [],
        rejected: Array.isArray(result.rejected) ? result.rejected : [],
        pending: Array.isArray(result.pending) ? result.pending : [],
        response: result.response || null,
      },
    };
    traceSendEmail(requestId, 'final_http_response', {
      statusCode: 200,
      body: responseBody,
    });
    res.json(responseBody);

  } catch (error) {
    traceSendEmail(requestId, 'final_http_response', {
      statusCode: 500,
      body: {
        success: false,
        error: error.message,
      },
      exception: {
        message: error.message,
        code: error.code || null,
        stack: error.stack || null,
      },
    });
    console.error('PHP Bridge send error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/workflow/send-verification-mail', async (req, res) => {
  const requestId = req._phpBridgeRequestId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const {
    case_id: caseId,
    application_id: applicationIdRaw,
    component_key: componentKey,
    recipient_email: recipientEmailRaw,
    recipient_name: recipientName,
    template_key: templateKey,
    sender_role: senderRole,
    sender_user_id: senderUserId,
    remarks,
    subject,
    message_body: messageBody,
    node_thread_id: nodeThreadId,
    node_conversation_id: nodeConversationId,
  } = req.body || {};

  const applicationId = normalizeApplicationId(applicationIdRaw);
  const rawRecipientEmail = toSafeId(recipientEmailRaw);
  const recipientEmail = normalizeRecipientEmail(recipientEmailRaw);

  console.log(`[PHP BRIDGE][${requestId}] workflow recipient normalization`, {
    rawRecipientEmail,
    normalizedRecipientEmail: recipientEmail,
    normalizationChanged: rawRecipientEmail !== (recipientEmail || null),
  });

  console.log(`[PHP BRIDGE][${requestId}] workflow/send-verification-mail hit`, {
    applicationId,
    caseId: toSafeId(caseId),
    componentKey: toSafeId(componentKey),
    templateKey: toSafeId(templateKey),
    hasNodeThreadId: Boolean(toSafeId(nodeThreadId)),
    hasNodeConversationId: Boolean(toSafeId(nodeConversationId)),
    recipientEmail,
  });

  const requiredFields = [
    ['case_id', caseId],
    ['application_id', applicationIdRaw],
    ['component_key', componentKey],
    ['recipient_email', recipientEmailRaw],
    ['template_key', templateKey],
    ['subject', subject],
    ['message_body', messageBody],
  ];

  const missingFields = requiredFields
    .filter(([_, value]) => typeof value !== 'string' || !value.trim())
    .map(([name]) => name);

  if (missingFields.length > 0) {
    return res.status(400).json({
      status: 0,
      message: 'Missing required fields',
      error: { code: 'VALIDATION_ERROR', missing_fields: missingFields },
    });
  }

  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    return res.status(400).json({
      status: 0,
      message: 'Invalid recipient email',
      error: { code: 'INVALID_RECIPIENT_EMAIL' },
    });
  }

  try {
    const recipients = normalizeWorkflowRecipientList(recipientEmailRaw, recipientName);
    const canonicalTo = recipients.map((item) => item.email).filter(Boolean);
    const { htmlBody, textBody } = normalizeWorkflowBodies(messageBody);
    const adaptedPayload = {
      to: canonicalTo,
      subject: String(subject || '').trim(),
      htmlBody,
      textBody,
    };
    console.log(`[PHP BRIDGE][${requestId}] workflow adapted payload pre-validation`, {
      hasHtmlBody: !!adaptedPayload.htmlBody,
      htmlLength: adaptedPayload.htmlBody?.length || 0,
      hasTextBody: !!adaptedPayload.textBody,
      textLength: adaptedPayload.textBody?.length || 0,
      to: adaptedPayload.to,
      subjectLength: adaptedPayload.subject?.length || 0,
    });
    const adaptedValidation = validateEmailPayload(adaptedPayload);
    if (adaptedValidation.errors.length > 0) {
      return res.status(400).json({
        status: 0,
        message: 'Invalid mail payload after workflow adaptation',
        error: {
          code: 'MAIL_PAYLOAD_VALIDATION_ERROR',
          details: adaptedValidation.errors,
        },
      });
    }

    const queue = await resolveQueue(null);
    if (!queue) {
      return res.status(404).json({
        status: 0,
        message: 'No active queue found',
        error: { code: 'QUEUE_NOT_FOUND' },
      });
    }

    const mailbox = await resolveMailboxForQueue(queue);
    const threadResult = await resolveWorkflowThread({
      nodeThreadId,
      nodeConversationId,
      applicationId,
      componentKey,
      recipientEmail,
      subject: String(subject || '').trim(),
    });

    if (!threadResult.thread) {
      return res.status(500).json({
        status: 0,
        message: 'Unable to create or resolve communication thread',
        error: { code: 'THREAD_RESOLUTION_FAILED' },
      });
    }

    console.log(`[PHP BRIDGE][${requestId}] workflow thread resolved`, {
      threadId: String(threadResult.thread._id),
      reused: threadResult.reused,
      source: threadResult.source,
    });

    const finalSubject = appendApplicationIdToSubject(adaptedPayload.subject, applicationId);
    console.log(`[PHP BRIDGE][${requestId}] workflow normalized payload`, {
      toCount: canonicalTo.length,
      toPreview: canonicalTo.slice(0, 3),
      hasHtmlBody: Boolean(htmlBody && htmlBody.trim().length > 0),
      hasTextBody: Boolean(textBody && textBody.trim().length > 0),
      subjectLength: finalSubject.length,
    });

    let sendResult;
    const selectedSmtpHost =
      String(queue?.smtpHost || '').trim() ||
      String(process.env.SMTP_HOST || '').trim() ||
      String(queue?.hostname || '').trim();
    const selectedSmtpPort = Number(queue?.smtpPort || process.env.SMTP_PORT || 587);
    const envelope = {
      from: normalizeEmail(queue?.username),
      to: adaptedPayload.to,
    };

    console.log(`[PHP BRIDGE][${requestId}] verification smtp queue selected`, {
      queueId: String(queue._id),
      queueName: queue.name || null,
      username: queue.username || null,
      host: selectedSmtpHost,
      port: selectedSmtpPort,
      secure: selectedSmtpPort === 465,
      serviceType: queue.serviceType || null,
      envelope,
    });

    try {
      sendResult = await MailService.sendEmail({
        to: adaptedPayload.to.join(','),
        subject: finalSubject,
        text: adaptedPayload.textBody,
        html: adaptedPayload.htmlBody,
        queue,
        headers: {
          'X-Application-Id': applicationId,
          'X-SourceCaseId': applicationId,
          'X-Workflow-Component-Key': String(componentKey).trim(),
          'X-Workflow-Template-Key': String(templateKey).trim(),
        },
      });
    } catch (providerError) {
      console.error(`[PHP BRIDGE][${requestId}] verification send failed`, {
        threadId: String(threadResult.thread._id),
        error: providerError.message,
        code: providerError.code || null,
        command: providerError.command || null,
        response: providerError.response || null,
        responseCode: providerError.responseCode || null,
        rejected: Array.isArray(providerError.rejected) ? providerError.rejected : [],
        rejectedErrors: Array.isArray(providerError.rejectedErrors)
          ? providerError.rejectedErrors.map((item) => ({
              recipient: item.recipient || null,
              response: item.response || null,
              responseCode: item.responseCode || null,
              command: item.command || null,
            }))
          : [],
        envelope,
        smtp: {
          queueId: String(queue._id),
          username: queue.username || null,
          host: selectedSmtpHost,
          port: selectedSmtpPort,
          secure: selectedSmtpPort === 465,
        },
      });
      return res.status(502).json({
        status: 0,
        message: 'Mail provider failure',
        error: { code: 'MAIL_PROVIDER_FAILURE', detail: providerError.message },
      });
    }

    let sentEmailRecord = null;
    try {
      sentEmailRecord = await MailService.persistSentEmail({
        queue,
        threadId: threadResult.thread._id,
        sourceCaseId: applicationId,
        direction: 'outbound',
        to: adaptedPayload.to,
        subject: finalSubject,
        text: adaptedPayload.textBody,
        html: adaptedPayload.htmlBody,
        messageId: sendResult.messageId,
        from: normalizeEmail(queue.username),
        sentByUserId: toSafeId(senderUserId),
        sentByRole: toSafeId(senderRole),
        recipientUserId: null,
        headers: {
          'X-Application-Id': applicationId,
          'X-SourceCaseId': applicationId,
          'X-Workflow-Component-Key': String(componentKey).trim(),
          'X-Workflow-Template-Key': String(templateKey).trim(),
        },
      });
    } catch (persistError) {
      console.error(`[PHP BRIDGE][${requestId}] failed to persist workflow sent email`, {
        threadId: String(threadResult.thread._id),
        messageId: sendResult.messageId || null,
        error: persistError.message,
      });
    }

    const message = await mirrorOutboundThreadMessage({
      thread: threadResult.thread,
      mailboxId: mailbox?._id || null,
      subject: finalSubject,
      htmlBody: adaptedPayload.htmlBody,
      textBody: adaptedPayload.textBody,
      emailMessageId: sentEmailRecord?._id || null,
      externalMessageId: sendResult.messageId,
      senderEmail: normalizeEmail(queue.username),
      senderName: queue.name || 'Workflow Mailer',
      recipients: adaptedPayload.to,
      metadata: {
        workflow: {
          caseId: String(caseId).trim(),
          applicationId,
          componentKey: String(componentKey).trim(),
          templateKey: String(templateKey).trim(),
          senderRole: toSafeId(senderRole),
          senderUserId: toSafeId(senderUserId),
          remarksPresent: typeof remarks === 'string' && remarks.trim().length > 0,
          recipientName: toSafeId(recipientName),
        },
      },
    });

    console.log(`[PHP BRIDGE][${requestId}] verification send success`, {
      threadId: String(threadResult.thread._id),
      conversationId: String(threadResult.thread._id),
      messageId: sendResult.messageId || null,
      messageRecordId: message?._id ? String(message._id) : null,
      emailMessageRecordId: sentEmailRecord?._id ? String(sentEmailRecord._id) : null,
      durationMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      status: 1,
      message: 'Verification mail sent',
      thread_id: String(threadResult.thread._id),
      conversation_id: String(threadResult.thread._id),
      message_id: sendResult.messageId || null,
      communication_status: 'sent',
      data: {
        node_thread_id: String(threadResult.thread._id),
        node_conversation_id: String(threadResult.thread._id),
        thread_id: String(threadResult.thread._id),
        conversation_id: String(threadResult.thread._id),
        message_id: sendResult.messageId || null,
        communication_status: 'sent',
      },
    });
  } catch (error) {
    console.error(`[PHP BRIDGE][${requestId}] workflow/send-verification-mail fatal`, {
      error: error.message,
      applicationId,
    });
    return res.status(500).json({
      status: 0,
      message: 'Failed to send verification mail',
      error: { code: 'SEND_FAILURE', detail: error.message },
    });
  }
});

// Trusted PHP integration boundary:
// this route is intentionally not user-scoped; access is restricted by router-level x-api-key auth above.
// Do not mount this router without authenticatePhp, or it can expose full application conversations.
router.get('/applications/:sourceCaseId/replies', async (req, res) => {
  const applicationId = resolveApplicationIdentity(
    req.params?.sourceCaseId,
    req.query?.application_id,
    req.query?.applicationId,
    req.query?.sourceCaseId
  );
  const componentKey = typeof req.query?.componentKey === 'string' && req.query.componentKey.trim()
    ? normalizeComponentKey(req.query.componentKey)
    : null;
  const sentByRole = typeof req.query?.sentByRole === 'string' && req.query.sentByRole.trim()
    ? req.query.sentByRole.trim()
    : null;

  if (!applicationId) {
    return res.status(400).json({
      success: false,
      source: 'node',
      error: {
        code: 'APPLICATION_ID_REQUIRED',
        message: 'sourceCaseId/application_id is required',
      },
      meta: {
        fallbackRecommended: true,
      },
    });
  }

  try {
    let thread = null;
    let threads = [];
    if (componentKey) {
      thread = await Thread.findOne({ sourceCaseId: applicationId, componentKey }).lean();
    } else {
      thread = await Thread.findOne({ sourceCaseId: applicationId, componentKey: null }).lean();
    }
    if (thread) {
      threads = [thread];
    } else if (!componentKey) {
      threads = await Thread.find({ sourceCaseId: applicationId }).lean();
      thread = threads[0] || null;
    }

    const threadIds = threads.map((item) => item?._id).filter(Boolean);
    const messageQuery = {
      channel: 'email',
      direction: { $in: ['inbound', 'outbound'] },
      ...(threadIds.length > 0
        ? { threadId: { $in: threadIds } }
        : componentKey
          ? { _id: null }
          : { sourceCaseId: applicationId }),
    };

    const messageDocs =
      threadIds.length > 0 || (!componentKey && applicationId)
        ? await Message.find(messageQuery)
          .sort({ createdAt: 1, _id: 1 })
          .lean()
        : [];

    const messagesFromMessageDocs = messageDocs
      .map((message) => toReplyMessageShape(message, { sourceCaseId: applicationId }))
      .filter((message) => matchesReplyFilters(message, { componentKey, sentByRole }));

    const seenKeys = new Set();
    messagesFromMessageDocs.forEach((message) => {
      getReplyMessageKeys(message).forEach((key) => seenKeys.add(key));
    });

    const legacyEmailQuery = {
      direction: { $in: ['inbound', 'outbound'] },
      ...(threadIds.length > 0
        ? componentKey
          ? { threadId: { $in: threadIds } }
          : {
              $or: [
                { threadId: { $in: threadIds } },
                { sourceCaseId: applicationId },
              ],
            }
        : componentKey
          ? { _id: null }
          : { sourceCaseId: applicationId }),
    };

    const legacyEmailDocs = await EmailMessage.find(legacyEmailQuery)
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .lean();

    if (!thread) {
      const legacyThreadId = legacyEmailDocs.find((item) => item.threadId)?.threadId || null;
      if (legacyThreadId) {
        thread = await Thread.findById(legacyThreadId).lean();
      }
    }

    const messagesFromEmailDocs = legacyEmailDocs
      .map((email, index) => emailMessageToReplyShape(email, index, { applicationId, thread }))
      .filter((message) => matchesReplyFilters(message, { componentKey, sentByRole }))
      .filter((message) => {
        const keys = getReplyMessageKeys(message);
        if (keys.some((key) => seenKeys.has(key))) {
          return false;
        }
        keys.forEach((key) => seenKeys.add(key));
        return true;
      });

    const messages = [...messagesFromMessageDocs, ...messagesFromEmailDocs].sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id || '').localeCompare(String(right.id || ''));
    });

    const legacyRecovered = messagesFromEmailDocs.length > 0;
    const legacyMessageCount = messagesFromEmailDocs.length;

    return res.status(200).json(
      buildThreadReplyEnvelope({
        applicationId,
        thread,
        messages,
        legacyRecovered,
        legacyMessageCount,
        fallbackReason: !thread
          ? (messages.length > 0 ? 'LEGACY_EMAILMESSAGE_RECOVERY' : 'THREAD_NOT_FOUND')
          : (messages.length > 0 ? null : 'MESSAGES_NOT_FOUND'),
        fallbackRecommended: messages.length === 0,
      })
    );
  } catch (error) {
    console.error('[PHP BRIDGE] Failed to fetch application replies from Node', {
      applicationId,
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      source: 'node',
      applicationId,
      error: {
        code: 'REPLIES_FETCH_FAILED',
        message: 'Unable to fetch replies from Node',
      },
      meta: {
        fallbackRecommended: true,
      },
    });
  }
});

// ---------------------------------------------------------------------------
// BGV HYBRID THREAD LIFECYCLE (safe, additive endpoints)
// ---------------------------------------------------------------------------

// Phase 1: create thread immediately on application creation (status=monitoring)
router.post('/application-created', async (req, res) => {
  try {
    const applicationId = normalizeApplicationId(req.body?.applicationId || req.body?.sourceCaseId);
    const applicantEmail = typeof req.body?.applicantEmail === 'string' ? req.body.applicantEmail.trim().toLowerCase() : null;
    const linkSentAt = req.body?.linkSentAt ? new Date(req.body.linkSentAt) : null;

    if (!applicationId || typeof applicationId !== 'string' || !applicationId.trim()) {
      return res.status(400).json({ success: false, error: 'applicationId is required' });
    }

    const safeLinkSentAt = linkSentAt && !Number.isNaN(linkSentAt.getTime()) ? linkSentAt : null;

    const $set = {};
    if (applicantEmail) {
      $set.applicantEmail = applicantEmail;
      $set['metadata.applicantEmail'] = applicantEmail;
    }
    if (safeLinkSentAt) {
      $set.linkSentAt = safeLinkSentAt;
      $set['metadata.linkSentAt'] = safeLinkSentAt;
    }

    let workflow = null;
    try {
      workflow = await fetchWorkflowSnapshot(applicationId, {
        cookie: req.headers?.cookie || '',
        userAgent: req.headers?.['user-agent'] || '',
      });
    } catch (snapshotError) {
      console.error(`Unable to fetch workflow snapshot for ${applicationId}:`, snapshotError.message);
    }

    if (workflow) {
      $set.currentStage = workflow.currentStage || null;
      $set['metadata.workflowSnapshot'] = workflow;
      $set['metadata.workflowSource'] = workflow.workflowSource || null;
      $set['metadata.workflowFetchedAt'] = new Date();
    }

    const thread = await Thread.findOneAndUpdate(
      { sourceCaseId: applicationId },
      {
        ...(Object.keys($set).length ? { $set } : {}),
        $setOnInsert: {
          sourceCaseId: applicationId,
          status: 'monitoring',
          isMapped: true,
          applicantEmail,
          linkSentAt: safeLinkSentAt,
          metadata: {
            applicationId,
            applicantEmail,
            linkSentAt: safeLinkSentAt,
            createdAt: new Date(),
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ success: true, thread, workflow });
  } catch (error) {
    console.error('PHP bridge application-created error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Phase 3: application completes with no issues → keep monitoring or archive
router.post('/application-completed', async (req, res) => {
  try {
    const applicationId = normalizeApplicationId(req.body?.applicationId || req.body?.sourceCaseId);
    const completedAt = req.body?.completedAt ? new Date(req.body.completedAt) : new Date();

    if (!applicationId || typeof applicationId !== 'string' || !applicationId.trim()) {
      return res.status(400).json({ success: false, error: 'applicationId is required' });
    }

    const thread = await Thread.findOneAndUpdate(
      { sourceCaseId: applicationId, status: 'monitoring' },
      {
        $set: {
          status: 'archived',
          'metadata.completedAt': !Number.isNaN(completedAt.getTime()) ? completedAt : new Date(),
          ...(req.body?.metadata && typeof req.body.metadata === 'object' ? { 'metadata.php': req.body.metadata } : {}),
        },
      },
      { new: true }
    );

    return res.status(200).json({ success: true, thread });
  } catch (error) {
    console.error('PHP bridge application-completed error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Send bulk emails from PHP
 * POST /api/php/send-bulk
 */
router.post('/send-bulk', async (req, res) => {
  try {
    const { emails } = req.body;
    const requestedQueueId = normalizeQueueId(req.body?.queueId);
    
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Emails array is required'
      });
    }
    if (emails.length > MAX_BULK_EMAILS) {
      return res.status(400).json({
        success: false,
        error: `Bulk request too large. Max ${MAX_BULK_EMAILS} emails per request.`,
      });
    }

    const queue = await resolveQueue(requestedQueueId);

    if (!queue) {
      const activeQueues = await EmailQueue.find({ active: true, isDeleted: false })
        .select('_id name username')
        .sort({ createdAt: 1 })
        .limit(20)
        .lean();
      return res.status(404).json({
        success: false,
        error: 'Queue not found',
        details: {
          requestedQueueId,
          hint:
            'Use a valid active queue _id from the current MongoDB database (and ensure isDeleted=false).',
          availableActiveQueues: activeQueues.map((item) => ({
            id: String(item._id),
            name: item.name || null,
            username: item.username || null,
          })),
        },
      });
    }

    const results = [];
    
    // Process in batches to avoid overwhelming
    const batchSize = 10;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const batchPromises = batch.map(async (email) => {
        try {
          const validation = validateEmailPayload(email);
          if (validation.errors.length > 0) {
            return {
              to: email.to,
              success: false,
              error: `Invalid payload: ${validation.errors.join('; ')}`
            };
          }

          const textBody = email.htmlBody.replace(/<[^>]*>/g, '');
          const result = await MailService.sendEmail({
            to: validation.recipients.join(','),
            subject: email.subject.trim(),
            text: textBody,
            html: email.htmlBody,
            queue,
            attachments: validation.attachments.map(att => ({
              filename: att.filename,
              content: att.content,
              contentType: att.contentType,
              encoding: 'base64'
            }))
          });
          
          return {
            to: email.to,
            success: true,
            messageId: result.messageId
          };
        } catch (error) {
          return {
            to: email.to,
            success: false,
            error: error.message
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.json({
      success: true,
      total: emails.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });

  } catch (error) {
    console.error('PHP Bridge bulk send error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get email queue status
 * GET /api/php/queues
 */
router.get('/queues', async (req, res) => {
  try {
    const queues = await EmailQueue.find({ active: true })
      .select('name serviceType username hostname tls');
    
    res.json({
      success: true,
      queues
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get email by message ID
 * GET /api/php/email/:messageId
 */
router.get('/email/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    
    // Try to find in EmailMessage collection
    const EmailMessage = require('../../models/EmailMessage');
    const email = await EmailMessage.findOne({ messageId })
      .populate('mailbox');
    
    if (!email) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }

    res.json({
      success: true,
      email: {
        id: email._id,
        messageId: email.messageId,
        subject: email.subject,
        from: email.from,
        to: email.to,
        date: email.date,
        folder: email.folder,
        isRead: email.isRead,
        attachments: email.attachments
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Health check endpoint
 * GET /api/php/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'VATI GSS PHP Bridge'
  });
});

module.exports = router;
