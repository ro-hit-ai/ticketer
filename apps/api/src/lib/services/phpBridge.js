// phpBridge.js - Add this to your Node.js app
const express = require('express');
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
const requestWindowStore = new Map();

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

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
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

async function ensureMonitoringThread({ applicationId, applicantEmail, linkSentAt, subject, mailboxId }) {
  if (!applicationId) return null;

  const safeLinkSentAt = linkSentAt && !Number.isNaN(linkSentAt.getTime()) ? linkSentAt : new Date();

  return Thread.findOneAndUpdate(
    { sourceCaseId: applicationId },
    {
      $setOnInsert: {
        sourceCaseId: applicationId,
        status: 'monitoring',
        isMapped: true,
        applicantEmail,
        linkSentAt: safeLinkSentAt,
        subject: subject || null,
        mailboxId: mailboxId || null,
        metadata: {
          applicationId,
          applicantEmail,
          linkSentAt: safeLinkSentAt,
          createdAt: new Date(),
        },
      },
      $set: {
        ...(applicantEmail ? { applicantEmail } : {}),
        ...(safeLinkSentAt ? { linkSentAt: safeLinkSentAt } : {}),
        ...(subject ? { subject } : {}),
        ...(mailboxId ? { mailboxId } : {}),
        'metadata.applicationId': applicationId,
        ...(applicantEmail ? { 'metadata.applicantEmail': applicantEmail } : {}),
        ...(safeLinkSentAt ? { 'metadata.linkSentAt': safeLinkSentAt } : {}),
      },
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
  externalMessageId,
  senderEmail,
  senderName,
  recipients,
  metadata,
}) {
  if (!thread || !externalMessageId) {
    return null;
  }

  const existing = await Message.findOne({ threadId: thread._id, externalMessageId });
  if (existing) {
    return existing;
  }

  const message = await Message.create({
    threadId: thread._id,
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
    recipients: {
      to: recipients.map((value) => normalizeEmail(value)).filter(Boolean),
      cc: [],
      bcc: [],
    },
    subject: subject || thread.subject || null,
    body: String(textBody || '').trim() || 'No Body',
    bodyHtml: htmlBody || null,
    externalMessageId,
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

// Middleware to verify API key
function authenticatePhp(req, res, next) {
  if (!API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'PHP bridge is disabled. Set PHP_API_KEY to enable it.'
    });
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== API_KEY) {
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
router.use(authenticatePhp, rateLimitPhp);

router.post('/send-email', async (req, res) => {
  try {
    const { subject, htmlBody, fromName, fromEmail, queueId = null } = req.body;
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const applicationIdCandidate =
      req.body?.applicationId ||
      req.body?.sourceCaseId ||
      metadata?.applicationId ||
      metadata?.sourceCaseId;
    const applicationId =
      typeof applicationIdCandidate === 'string' && applicationIdCandidate.trim()
        ? normalizeApplicationId(applicationIdCandidate)
        : null;

    const validation = validateEmailPayload(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request payload',
        details: validation.errors
      });
    }

    const queue = await resolveQueue(queueId);

    if (!queue) {
      return res.status(404).json({
        success: false,
        error: 'Queue not found'
      });
    }

    const finalSubject = applicationId
      ? appendApplicationIdToSubject(subject, applicationId)
      : subject.trim();

    const textBody = htmlBody.replace(/<[^>]*>/g, '');
    const sender =
      fromEmail && fromName
        ? `${fromName.trim()} <${fromEmail.trim()}>`
        : (fromEmail ? fromEmail.trim() : undefined);
    
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
    const mailbox = await resolveMailboxForQueue(queue);
    const thread = applicationId
      ? await ensureMonitoringThread({
          applicationId,
          applicantEmail,
          linkSentAt,
          subject: finalSubject,
          mailboxId: mailbox?._id || null,
        })
      : null;

    const result = await MailService.sendEmail({
      to: validation.recipients.join(','),
      subject: finalSubject,
      text: textBody,
      html: finalHtml,
      queue,
      from: sender,
      headers: applicationId
        ? {
            'X-Application-Id': applicationId,
            'X-SourceCaseId': applicationId,
          }
        : {},
      attachments: validation.attachments.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
        encoding: 'base64'
      }))
    });

    // Always persist outbound email (sent) to MongoDB for auditability and UI.
    // This is intentionally independent of thread/message activation (hybrid lifecycle).
    try {
      const attachmentsSummary = validation.attachments.map((att) => ({
        filename: att.filename,
        contentType: att.contentType,
        size: estimateBase64Size(att.content),
      }));

      await EmailMessage.findOneAndUpdate(
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
        },
        { upsert: true }
      );
    } catch (persistError) {
      console.error('Failed to persist sent email:', persistError);
    }

    try {
      await mirrorOutboundThreadMessage({
        thread,
        mailboxId: mailbox?._id || null,
        subject: finalSubject,
        htmlBody: finalHtml,
        textBody,
        externalMessageId: result.messageId,
        senderEmail: normalizeEmail(fromEmail) || normalizeEmail(queue.username),
        senderName: fromName || queue.name || null,
        recipients: validation.recipients,
        metadata: {
          ...metadata,
          applicationId,
          queueId: String(queue._id),
        },
      });
    } catch (messageMirrorError) {
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

    res.json({
      success: true,
      messageId: result.messageId,
      queue: queue.name
    });

  } catch (error) {
    console.error('PHP Bridge send error:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
    const { emails, queueId = null } = req.body;
    
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

    const queue = await resolveQueue(queueId);

    if (!queue) {
      return res.status(404).json({
        success: false,
        error: 'Queue not found'
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
