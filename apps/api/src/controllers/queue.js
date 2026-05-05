const express = require('express');
const ImapSimple = require('imap-simple');
const { track } = require('../lib/hog');
const { requirePermission } = require('../lib/roles');
const EmailQueue = require('../models/EmailQueue');
const OutboundEmailJob = require('../models/OutboundEmailJob');
const { MailService } = require('../lib/services/smtp.service');
const { emitAuditLog } = require('../lib/services/auditLog.service');

const router = express.Router();

function attachImapErrorHandler(connection, context = {}) {
  if (!connection || typeof connection.on !== 'function') {
    return connection;
  }

  if (connection.__ticketerImapErrorHandlerAttached) {
    return connection;
  }

  Object.defineProperty(connection, '__ticketerImapErrorHandlerAttached', {
    value: true,
    enumerable: false,
    configurable: true,
    writable: false,
  });

  connection.on('error', (error) => {
    console.error('IMAP test connection emitted error event:', {
      message: error?.message || String(error),
      code: error?.code || null,
      errno: error?.errno || null,
      syscall: error?.syscall || null,
      source: error?.source || null,
      ...context,
    });
  });

  return connection;
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

async function tracking(event, properties) {
  const client = track();
  client.capture({
    event: event,
    properties: properties,
    distinctId: 'uuid',
  });
  client.shutdownAsync();
}

router.post('/create', async (req, res) => {
  try {
    const serviceType = String(req.body.serviceType || 'other').trim().toLowerCase();
    if (serviceType !== 'other' && serviceType !== 'custom') {
      return res.status(400).send({
        success: false,
        message: "Invalid serviceType. This backend supports only 'other' (SMTP/IMAP with username/password).",
      });
    }

    const username = req.body.username || process.env.IMAP_USER || process.env.SMTP_USER;
    const name = req.body.name || username || 'default-queue';

    if (!username) {
      return res.status(400).send({
        success: false,
        message: 'username is required (or set IMAP_USER/SMTP_USER in backend .env).',
      });
    }

    const hostname =
      req.body.hostname ||
      process.env.IMAP_HOST ||
      process.env.SMTP_HOST;

    if (!hostname) {
      return res.status(400).send({
        success: false,
        message: 'hostname is required (or set IMAP_HOST/SMTP_HOST in backend .env).',
      });
    }

    const tlsDefault = toBoolean(process.env.IMAP_TLS, true);
    const tls = toBoolean(req.body.tls, tlsDefault);

    const queuePayload = {
      name,
      username,
      hostname,
      tls,
      serviceType: 'other',
      password: req.body.password || process.env.IMAP_PASS || process.env.SMTP_PASS || null,
      imapPort: Number(req.body.imapPort || req.body.port || process.env.IMAP_PORT || 993),
      smtpPort: Number(req.body.smtpPort || process.env.SMTP_PORT || 465),
      active: req.body.active !== undefined ? Boolean(req.body.active) : true,
    };

    if (!queuePayload.password) {
      return res.status(400).send({
        success: false,
        message: 'password is required (or set IMAP_PASS/SMTP_PASS in backend .env).',
      });
    }

    const mailbox = await EmailQueue.create(queuePayload);

    console.log(`📧 Created OTHER queue for ${username}`);

    return res.status(200).send({
      success: true,
      message: 'IMAP/SMTP queue created successfully from request/.env values.',
      queueId: mailbox._id,
      serviceType: 'other',
    });
  } catch (error) {
    console.error('❌ Error creating email queue:', error);
    return res.status(500).send({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// Get all email queues
router.get(
  '/all',
  requirePermission(['integration::manage']),
  async (req, res) => {
    try {
      const queues = await EmailQueue.find({})
        .select('id name serviceType active teams username hostname imapPort smtpPort tls');

      res.status(200).send({
        success: true,
        queues: queues,
      });
    } catch (error) {
      console.error('Error fetching email queues:', error);
      res.status(500).send({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// Delete an email queue
router.delete(
  '/delete',
  requirePermission(['integration::manage']),
  async (req, res) => {
    try {
      const { id } = req.body;

      const result = await EmailQueue.findByIdAndDelete(id);
      if (!result) {
        return res.status(404).send({
          success: false,
          message: 'Email queue not found',
        });
      }

      res.status(200).send({
        success: true,
        message: 'Email queue deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting email queue:', error);
      res.status(500).send({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// Test IMAP connection for a username/password based queue
router.post('/test-connection',
  //  requirePermission(['integration::manage']), 
   async (req, res) => {
  try {
    const { queueId } = req.body;
    const queue = await EmailQueue.findById(queueId);
    if (!queue) {
      return res.status(404).send({ success: false, message: 'Queue not found' });
    }

    const imapConfig = {
      user: queue.username,
      password: queue.password,
      host: queue.hostname,
      port: queue.imapPort || (queue.tls ? 993 : 143),
      tls: queue.tls || false,
      authTimeout: 30000,
      tlsOptions: { rejectUnauthorized: false, servername: queue.hostname },
    };

    const connection = await ImapSimple.connect({ imap: imapConfig });
    attachImapErrorHandler(connection, {
      queueId: String(queue._id),
      username: queue.username || null,
      host: queue.hostname || null,
    });
    await connection.openBox('INBOX');
    connection.end();

    return res.status(200).send({
      success: true,
      message: `IMAP connection successful for ${queue.username}`,
    });
  } catch (error) {
    console.error('IMAP test connection failed:', error);
    return res.status(500).send({
      success: false,
      message: 'IMAP connection test failed',
      error: error.message,
    });
  }
});

// Test SMTP connection for a queue
router.post('/test-smtp-connection', async (req, res) => {
  try {
    const { queueId } = req.body;
    const queue = await EmailQueue.findById(queueId);
    if (!queue) {
      return res.status(404).send({ success: false, message: 'Queue not found' });
    }

    await MailService.testSmtpConnection(queue);
    return res.status(200).send({
      success: true,
      message: `SMTP connection successful for ${queue.username}`,
    });
  } catch (error) {
    console.error('SMTP test connection failed:', error);
    return res.status(500).send({
      success: false,
      message: 'SMTP connection test failed',
      error: error.message,
    });
  }
});

router.get(
  '/jobs',
  requirePermission(['integration::manage']),
  async (req, res) => {
    try {
      const status = String(req.query.status || '').trim().toLowerCase();
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
      const query = {};

      if (status) {
        query.status = status;
      }

      const jobs = await OutboundEmailJob.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return res.status(200).json({
        success: true,
        jobs,
      });
    } catch (error) {
      console.error('Error fetching outbound jobs:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

router.post(
  '/jobs/:id/retry',
  requirePermission(['integration::manage']),
  async (req, res) => {
    try {
      const job = await OutboundEmailJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found' });
      }

      if (!['failed', 'dead'].includes(job.status)) {
        return res.status(409).json({
          success: false,
          message: `Only failed/dead jobs can be retried. Current status: ${job.status}`,
        });
      }

      const previousStatus = job.status;
      job.status = 'pending';
      job.nextRetryAt = new Date();
      job.lockedAt = null;
      job.lockedBy = null;
      job.lastError = null;
      await job.save();

      await emitAuditLog({
        eventType: 'job_retry',
        actor: {
          actorType: 'user',
          actorId: String(req.user?._id || ''),
          actorEmail: req.user?.email || null,
          actorName: req.user?.name || null,
        },
        entityType: 'outbound_email_job',
        entityId: job._id,
        metadata: {
          previousStatus,
          attempt: job.attempt,
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Job re-queued for retry',
        jobId: job._id,
      });
    } catch (error) {
      console.error('Error retrying outbound job:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

module.exports = router;
