const express = require('express');
const axios = require('axios');
const Webhook = require('../../../models/Webhook');
const { sendWebhookNotification } = require('../../webhookUtils');
const { requirePermission } = require('../../roles');
const { checkSession } = require('../../session');

const router = express.Router();

// Create a new webhook
router.post(
  '/api/v1/webhooks',
  requirePermission(['webhooks::create']),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      const { name, url, type, active, secret } = req.body;

      if (!name || !url) {
        return res.status(400).json({
          message: 'Name and URL are required',
          success: false
        });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        return res.status(400).json({
          message: 'Invalid URL format',
          success: false
        });
      }

      const webhook = new Webhook({
        name,
        url,
        type: type || 'custom',
        active: active !== undefined ? active : true,
        secret: secret || '',
        createdBy: user._id
      });

      await webhook.save();

      res.status(201).json({
        message: 'Webhook created successfully',
        success: true,
        webhook
      });

    } catch (error) {
      console.error('Error creating webhook:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Get all webhooks
router.get(
  '/api/v1/webhooks',
  requirePermission(['webhooks::read']),
  async (req, res) => {
    try {
      const webhooks = await Webhook.find({})
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 });

      res.status(200).json({
        webhooks,
        success: true
      });

    } catch (error) {
      console.error('Error fetching webhooks:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Send test webhook notification
router.post(
  '/api/v1/webhooks/:id/test',
  requirePermission(['webhooks::update']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { testData } = req.body;

      const webhook = await Webhook.findById(id);
      
      if (!webhook) {
        return res.status(404).json({
          message: 'Webhook not found',
          success: false
        });
      }

      const testMessage = testData || {
        id: 'test-123',
        title: 'Test Issue',
        priority: 'medium',
        email: 'test@example.com',
        createdBy: { name: 'Test User' },
        assignedTo: null,
        client: { name: 'Test Client' },
        type: 'Test'
      };

      await sendWebhookNotification(webhook, testMessage);

      res.status(200).json({
        message: 'Test webhook sent successfully',
        success: true
      });

    } catch (error) {
      console.error('Error sending test webhook:', error);
      res.status(500).json({
        message: 'Failed to send test webhook: ' + error.message,
        success: false
      });
    }
  }
);

// Update webhook
router.put(
  '/api/v1/webhooks/:id',
  requirePermission(['webhooks::update']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, url, type, active, secret } = req.body;

      const webhook = await Webhook.findById(id);
      
      if (!webhook) {
        return res.status(404).json({
          message: 'Webhook not found',
          success: false
        });
      }

      if (url) {
        try {
          new URL(url);
        } catch (error) {
          return res.status(400).json({
            message: 'Invalid URL format',
            success: false
          });
        }
        webhook.url = url;
      }

      if (name) webhook.name = name;
      if (type) webhook.type = type;
      if (active !== undefined) webhook.active = active;
      if (secret !== undefined) webhook.secret = secret;
      
      webhook.updatedAt = new Date();

      await webhook.save();

      res.status(200).json({
        message: 'Webhook updated successfully',
        success: true,
        webhook
      });

    } catch (error) {
      console.error('Error updating webhook:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Delete webhook
router.delete(
  '/api/v1/webhooks/:id',
  requirePermission(['webhooks::delete']),
  async (req, res) => {
    try {
      const { id } = req.params;

      const webhook = await Webhook.findByIdAndDelete(id);
      
      if (!webhook) {
        return res.status(404).json({
          message: 'Webhook not found',
          success: false
        });
      }

      res.status(200).json({
        message: 'Webhook deleted successfully',
        success: true
      });

    } catch (error) {
      console.error('Error deleting webhook:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Send webhook notification (for internal use)
router.post(
  '/api/v1/webhooks/send-notification',
  requirePermission(['webhooks::send']),
  async (req, res) => {
    try {
      const { webhookId, message } = req.body;

      if (!webhookId || !message) {
        return res.status(400).json({
          message: 'Webhook ID and message are required',
          success: false
        });
      }

      const webhook = await Webhook.findById(webhookId);
      
      if (!webhook) {
        return res.status(404).json({
          message: 'Webhook not found',
          success: false
        });
      }

      await sendWebhookNotification(webhook, message);

      res.status(200).json({
        message: 'Webhook notification sent successfully',
        success: true
      });

    } catch (error) {
      console.error('Error sending webhook notification:', error);
      res.status(500).json({
        message: 'Failed to send webhook notification: ' + error.message,
        success: false
      });
    }
  }
);

module.exports = router;