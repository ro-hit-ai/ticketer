const express = require('express');
const mongoose = require('mongoose');
const handlebars = require('handlebars');
const { createTransportProvider } = require('../../transport');
const Email = require('../../../models/Email');
const EmailTemplate = require('../../../models/EmailTemplate');
const { requirePermission } = require('../../roles');
const { checkSession } = require('../../session');

const router = express.Router();

async function sendAssignedEmail(email) {
  try {
    const provider = await Email.findOne();

    if (provider) {
      const mail = await createTransportProvider(provider);

      console.log("Sending email to: ", email);

      const testhtml = await EmailTemplate.findOne({
        type: "ticket_assigned"
      });

      if (!testhtml) {
        console.log("Email template not found");
        return;
      }

      const template = handlebars.compile(testhtml.html);
      const htmlToSend = template({});

      await mail
        .sendMail({
          from: provider.reply,
          to: email,
          subject: `A new ticket has been assigned to you`,
          text: `Hello there, a ticket has been assigned to you`,
          html: htmlToSend,
        })
        .then((info) => {
          console.log("Message sent: %s", info.messageId);
        })
        .catch((err) => console.log(err));
    }
  } catch (error) {
    console.log(error);
  }
}

// Send assigned email endpoint
router.post(
  '/api/v1/email/send-assigned',
  requirePermission(['email::send']),
  async (req, res) => {
    try {
      const user = await checkSession(req);
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email is required', success: false });
      }

      await sendAssignedEmail(email);

      res.status(200).json({ message: 'Email sent successfully', success: true });
    } catch (err) {
      console.error('Error sending email:', err);
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
      const emailConfig = await Email.findOne();
      res.status(200).json({ emailConfig, success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

// Update email configuration
router.put(
  '/api/v1/email/config',
  requirePermission(['email::update']),
  async (req, res) => {
    try {
      const { host, port, secure, user, pass, reply } = req.body;
      
      let emailConfig = await Email.findOne();
      
      if (emailConfig) {
        emailConfig.host = host;
        emailConfig.port = port;
        emailConfig.secure = secure;
        emailConfig.user = user;
        emailConfig.pass = pass;
        emailConfig.reply = reply;
        emailConfig.updatedAt = new Date();
        await emailConfig.save();
      } else {
        emailConfig = new Email({
          host,
          port,
          secure,
          user,
          pass,
          reply
        });
        await emailConfig.save();
      }

      res.status(200).json({ message: 'Email configuration updated', success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

// Get email templates
router.get(
  '/api/v1/email/templates',
  requirePermission(['email::read']),
  async (req, res) => {
    try {
      const templates = await EmailTemplate.find({});
      res.status(200).json({ templates, success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

// Update email template
router.put(
  '/api/v1/email/template/:type',
  requirePermission(['email::update']),
  async (req, res) => {
    try {
      const { type } = req.params;
      const { html, subject } = req.body;

      let template = await EmailTemplate.findOne({ type });

      if (template) {
        template.html = html;
        template.subject = subject;
        template.updatedAt = new Date();
        await template.save();
      } else {
        template = new EmailTemplate({
          type,
          html,
          subject
        });
        await template.save();
      }

      res.status(200).json({ message: 'Template updated', success: true });
    } catch (err) {
      res.status(500).json({ message: 'Internal Server Error', success: false });
    }
  }
);

module.exports = { router,sendAssignedEmail } ;