const express = require('express');
const crypto = require('crypto');
const { track } = require('../lib/hog');
const { requirePermission } = require('../lib/roles');
const { checkSession } = require('../lib/session');
const Webhook = require('../models/Webhook');
const Thread = require('../models/Thread');
const Message = require('../models/Message');

const router = express.Router();
const processedEventIds = new Set();

function normalizeSourceCaseId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function computeWebhookSignature(req) {
  const secret = String(process.env.VATI_WEBHOOK_SECRET || '');
  if (!secret) return null;

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}));

  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function isSignatureValid(req) {
  const received = String(req.headers['x-vati-signature'] || '').trim();
  const expected = computeWebhookSignature(req);

  if (!received || !expected) {
    return false;
  }

  const normalizedReceived = received.replace(/^sha256=/i, '');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedReceived, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch (_) {
    return false;
  }
}

async function handleVatiWebhook(req, res) {
  try {
    if (!process.env.VATI_WEBHOOK_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'VATI webhook secret is not configured',
      });
    }

    if (!isSignatureValid(req)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature',
      });
    }

    const { eventId, eventType, data } = req.body || {};
    const sourceCaseId = normalizeSourceCaseId(data?.sourceCaseId);
    const assignedToUserId =
      typeof data?.assignedToUserId === 'string' ? data.assignedToUserId.trim() : '';
    const assignedToRole =
      typeof data?.assignedToRole === 'string' ? data.assignedToRole.trim() : '';
    const assignedToName =
      typeof data?.assignedToName === 'string' ? data.assignedToName.trim() : '';

    if (!eventId || typeof eventId !== 'string') {
      return res.status(400).json({ success: false, message: 'eventId is required' });
    }

    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({ success: false, message: 'eventType is required' });
    }

    if (!sourceCaseId || !assignedToUserId || !assignedToRole || !assignedToName) {
      return res.status(400).json({
        success: false,
        message: 'data.sourceCaseId, data.assignedToUserId, data.assignedToRole, and data.assignedToName are required',
      });
    }

    if (processedEventIds.has(eventId)) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: 'Webhook already processed',
      });
    }

    const thread = await Thread.findOne({ sourceCaseId });
    if (!thread) {
      return res.status(404).json({
        success: false,
        message: 'Thread not found for sourceCaseId',
      });
    }

    thread.workflowSnapshot = {
      ...(thread.workflowSnapshot && typeof thread.workflowSnapshot === 'object'
        ? thread.workflowSnapshot
        : {}),
      currentUserId: assignedToUserId,
      currentRole: assignedToRole,
      currentUserName: assignedToName,
      assignedAt: new Date(),
      assignmentSource: 'VATI_WEBHOOK',
      lastEventId: eventId,
    };
    thread.lastAssignedUserId = assignedToUserId;
    await thread.save();

    await Message.create({
      threadId: thread._id,
      sourceCaseId: thread.sourceCaseId,
      ticketId: thread.ticketId || null,
      mailboxId: thread.mailboxId || null,
      direction: 'internal',
      channel: 'internal',
      sender: {
        id: null,
        name: 'VATI Webhook',
        email: null,
        type: 'system',
      },
      sentByUserId: null,
      sentByRole: 'system',
      recipientUserId: assignedToUserId,
      recipients: {
        to: [],
        cc: [],
        bcc: [],
      },
      subject: null,
      body: `Assigned to ${assignedToRole} (${assignedToName})`,
      bodyHtml: null,
      status: 'sent',
      metadata: {
        eventId,
        eventType,
        routedToUserId: assignedToUserId,
        type: 'assignment_update',
      },
    });

    processedEventIds.add(eventId);
    if (processedEventIds.size > 5000) {
      const oldest = processedEventIds.values().next().value;
      if (oldest) {
        processedEventIds.delete(oldest);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
    });
  } catch (error) {
    console.error('Error handling VATI webhook:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
}

 // Mongoose model

// Create a new webhook
router.post('/vati', handleVatiWebhook);

router.post(
  '/create',
  requirePermission(['webhook::create']),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      const { name, url, type, active, secret } = req.body;

      const webhook = new Webhook({
        name,
        url,
        type,
        active,
        secret,
        createdBy: user.id,
      });

      await webhook.save();

      const client = track();
      client.capture({
        event: 'webhook_created',
        distinctId: 'uuid',
      });
      client.shutdownAsync();

      res.status(200).json({ message: 'Hook created!', success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

// Get all webhooks
router.get(
  '/all',
  requirePermission(['webhook::read']),
  async (req, res) => {
    try {
      const webhooks = await Webhook.find({});
      res.status(200).json({ webhooks, success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

// Delete a webhook
router.delete(
  '/:id/delete',
  requirePermission(['webhook::delete']),
  async (req, res) => {
    try {
      const { id } = req.params;
      await Webhook.findByIdAndDelete(id);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

module.exports = router;
module.exports.handleVatiWebhook = handleVatiWebhook;
