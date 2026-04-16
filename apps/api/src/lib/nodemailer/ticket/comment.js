const express = require('express');
const { sendComment } = require('../../services/emailService');
const { requirePermission } = require('../../roles');
const { checkSession } = require('../../session');

const router = express.Router();

// Send comment email endpoint
router.post(
  '/api/v1/email/send-comment',
  requirePermission(['email::send']),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      const { comment, title, ticketId, email } = req.body;

      // Validate required fields
      if (!comment || !title || !ticketId || !email) {
        return res.status(400).json({ 
          message: 'Comment, title, ticketId, and email are required', 
          success: false 
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          message: 'Invalid email format', 
          success: false 
        });
      }

      const success = await sendComment(comment, title, ticketId, email);

      if (success) {
        res.status(200).json({ 
          message: 'Comment email sent successfully', 
          success: true 
        });
      } else {
        res.status(500).json({ 
          message: 'Failed to send comment email', 
          success: false 
        });
      }

    } catch (err) {
      console.error('Error sending comment email:', err);
      res.status(500).json({ 
        message: 'Internal Server Error', 
        success: false 
      });
    }
  }
);

// Get email templates
router.get(
  '/api/v1/email/templates',
  requirePermission(['email::read']),
  async (req, res) => {
    try {
      const EmailTemplate = require('../models/EmailTemplate');
      const templates = await EmailTemplate.find({});
      res.status(200).json({ templates, success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

// Get email configuration
router.get(
  '/api/v1/email/config',
  requirePermission(['email::read']),
  async (req, res) => {
    try {
      const Email = require('../models/Email');
      const emailConfig = await Email.findOne();
      res.status(200).json({ emailConfig, success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

module.exports = { router, sendComment };
