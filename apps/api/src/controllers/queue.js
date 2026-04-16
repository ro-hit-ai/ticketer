const express = require('express');
const ImapSimple = require('imap-simple');
const { track } = require('../lib/hog');
const { requirePermission } = require('../lib/roles');
const EmailQueue = require('../models/EmailQueue');
const redisClient = require('../lib/redisClient');

const router = express.Router();

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

      await redisClient.del(`mailbox:${id}:tokens`);

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

module.exports = router;
