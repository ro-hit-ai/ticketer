const express = require('express');
const EmailReplyParser = require('email-reply-parser');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const AuthService = require('./authService');
const EmailQueue = require('../../models/EmailQueue');
const Ticket = require('../../models/Ticket');
const Comment = require('../../models/Comment');
const ImapEmail = require('../../models/ImapEmail');
const EmailMessage = require('../../models/EmailMessage');
const { sendTicketCreate } = require('../nodemailer/ticket/create');
const { requirePermission } = require('../roles');

const router = express.Router();

const tlsRejectUnauthorized =
  String(process.env.MAIL_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';
const allowInsecureTls =
  String(process.env.MAIL_ALLOW_INSECURE_TLS || 'false').toLowerCase() === 'true';

function getTlsOptions(servername) {
  if (allowInsecureTls) {
    return { rejectUnauthorized: false, servername };
  }
  return { rejectUnauthorized: tlsRejectUnauthorized, servername };
}

function getReplyText(email) {
  const parsed = new EmailReplyParser().read(email.text || '');
  let replyText = '';
  parsed.getFragments().forEach((fragment) => {
    if (!fragment._isHidden && !fragment._isSignature && !fragment._isQuoted) {
      replyText += fragment._content;
    }
  });
  return replyText;
}

function toPlainText(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

class MailService {
  static assertDeliveryAccepted(info, recipients = []) {
    const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
    const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
    const pending = Array.isArray(info?.pending) ? info.pending : [];
    const recipientCount = Array.isArray(recipients)
      ? recipients.length
      : String(recipients || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean).length;

    // Nodemailer can resolve even when SMTP rejects recipients.
    // Treat "nothing accepted" as a hard failure to avoid false 200s.
    if (recipientCount > 0 && accepted.length === 0) {
      const detail = `accepted=${accepted.length}, rejected=${rejected.length}, pending=${pending.length}`;
      throw new Error(`SMTP accepted 0 recipients (${detail})`);
    }
  }

  static async getImapConfig(queue) {
    switch (queue.serviceType) {
      case 'gmail': {
        const token = await AuthService.getValidAccessToken(queue);
        return {
          user: queue.username,
          host: queue.hostname,
          port: 993,
          tls: true,
          xoauth2: AuthService.generateXOAuth2Token(queue.username, token),
          tlsOptions: getTlsOptions(queue.hostname),
        };
      }
      case 'other':
        return {
          user: queue.username,
          password: queue.password,
          host: queue.hostname,
          port: queue.imapPort || 993,
          tls: queue.tls || false,
          tlsOptions: getTlsOptions(queue.hostname),
        };
      default:
        throw new Error('Unsupported service type');
    }
  }

  static async getSmtpTransporter(queue) {
    const smtpPort = Number(queue.smtpPort || 587);
    const useTls = Boolean(queue.tls);
    // 465 = implicit TLS (secure:true). 587/25 = STARTTLS/plain (secure:false).
    const secure = smtpPort === 465;

    if (queue.serviceType === 'gmail') {
      const accessToken = await AuthService.getValidAccessToken(queue);
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: queue.username,
          clientId: queue.clientId,
          clientSecret: queue.clientSecret,
          refreshToken: queue.refreshToken,
          accessToken,
        },
      });
    }

    return nodemailer.createTransport({
      host: queue.hostname,
      port: smtpPort,
      secure,
      requireTLS: !secure && useTls,
      auth: {
        user: queue.username,
        pass: queue.password,
      },
      tls: getTlsOptions(queue.hostname),
    });
  }

  static async testSmtpConnection(queue) {
    const transporter = await this.getSmtpTransporter(queue);
    await transporter.verify();
    return true;
  }

  static async sendEmail({
    to,
    subject,
    text,
    html,
    queue,
    from,
    attachments = [],
    cc = [],
    bcc = [],
    replyTo = null,
    headers = {},
  }) {
    const transporter = await this.getSmtpTransporter(queue);
    const info = await transporter.sendMail({
      from: from || queue.username,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text,
      html,
      attachments,
      headers,
    });
    this.assertDeliveryAccepted(info, to);
    return info;
  }

  static async persistSentEmail({
    queue,
    threadId = null,
    sourceCaseId = null,
    direction = 'outbound',
    to,
    cc = [],
    bcc = [],
    subject,
    text,
    html,
    attachments = [],
    messageId,
    from,
    inReplyTo = null,
    references = [],
    sentByUserId = null,
    sentByRole = null,
    recipientUserId = null,
    headers = {},
  }) {
    const recipients = Array.isArray(to)
      ? to.filter(Boolean)
      : String(to || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    const normalizedCc = Array.isArray(cc) ? cc.filter(Boolean) : [];
    const normalizedBcc = Array.isArray(bcc) ? bcc.filter(Boolean) : [];
    const normalizedReferences = Array.isArray(references)
      ? references.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    if (!queue?._id || recipients.length === 0) {
      return null;
    }

    return EmailMessage.findOneAndUpdate(
      {
        mailbox: queue._id,
        messageId: messageId || `sent:${Date.now()}`,
      },
      {
        $setOnInsert: {
          mailbox: queue._id,
          messageId: messageId || `sent:${Date.now()}`,
          folder: "sent",
          subject: subject || "(No subject)",
          body: text || toPlainText(html),
          from: from || queue.username,
          to: recipients,
          cc: normalizedCc,
          bcc: normalizedBcc,
          date: new Date(),
          isRead: true,
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            url: attachment.url,
          })),
        },
        $set: {
          threadId,
          sourceCaseId,
          direction,
          inReplyTo,
          references: normalizedReferences,
          headers,
          sentByUserId,
          sentByRole,
          recipientUserId,
        },
      },
      { upsert: true, new: true }
    );
  }

  static async processEmail(parsed, isReply) {
    const { from, subject, text, html, textAsHtml } = parsed;
    const fromAddress = from?.value?.[0]?.address;
    const fromName = from?.value?.[0]?.name;

    if (!fromAddress) {
      throw new Error('Email sender address missing');
    }

    if (isReply) {
      const ticketId = subject?.match(/(?:ref:|#)([0-9a-f\-]{36})/)?.[1];
      if (!ticketId) throw new Error('Ticket ID not found in subject');

      const ticket = await Ticket.findById(ticketId);
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

      const replyText = getReplyText(parsed);
      await Comment.create({
        text: text ? replyText : 'No Body',
        userId: null,
        ticketId: ticket._id,
        reply: true,
        replyEmail: fromAddress,
        public: true,
      });
      return;
    }

    const imapEmail = await ImapEmail.create({
      from: fromAddress,
      subject: subject || 'No Subject',
      body: text || 'No Body',
      html: html || '',
      text: textAsHtml || '',
    });

    const ticketCount = await Ticket.countDocuments();
    const ticketNumber = `TKT-${String(ticketCount + 1).padStart(6, '0')}`;

    const ticket = await Ticket.create({
      number: ticketNumber,
      email: fromAddress,
      name: fromName,
      title: imapEmail.subject || '-',
      isComplete: false,
      priority: 'low',
      fromImap: true,
      detail: html || textAsHtml,
    });

    await sendTicketCreate(ticket);
  }

  static async fetchEmails() {
    const queues = await EmailQueue.find({ active: true, isDeleted: false });
    const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const queue of queues) {
      try {
        const imapConfig = await this.getImapConfig(queue);
        const imap = new Imap(imapConfig);

        await new Promise((resolve, reject) => {
          imap.once('ready', () => {
            imap.openBox('INBOX', false, (err) => {
              if (err) return reject(err);

              imap.search([['SINCE', sinceDate]], (searchError, results) => {
                if (searchError) return reject(searchError);
                if (!results || !results.length) {
                  imap.end();
                  return resolve();
                }

                const fetch = imap.fetch(results, { bodies: '' });
                fetch.on('message', (msg) => {
                  msg.on('body', (stream) => {
                    simpleParser(stream, async (parseErr, parsed) => {
                      if (parseErr) {
                        console.error(parseErr);
                        return;
                      }

                      const normalizedSubject = (parsed.subject || '').toLowerCase();
                      const isReply =
                        normalizedSubject.includes('re:') || normalizedSubject.includes('ref:');

                      try {
                        await this.processEmail(parsed, isReply);
                      } catch (processError) {
                        console.error('Email processing error:', processError);
                      }
                    });
                  });

                  msg.once('attributes', (attrs) => {
                    imap.addFlags(attrs.uid, ['\\Seen'], () => {});
                  });
                });

                fetch.once('end', () => imap.end());
              });
            });
          });

          imap.once('error', reject);
          imap.once('end', resolve);
          imap.connect();
        });
      } catch (error) {
        console.error(`Queue ${queue._id} error:`, error);
      }
    }
  }
}

router.post('/fetch-emails', requirePermission(['integration::manage']), async (req, res) => {
  MailService.fetchEmails().catch((err) => console.error(err));
  res.status(202).json({ message: 'IMAP fetch started', success: true });
});

router.post('/send-email', requirePermission(['email::send', 'integration::manage'], false), async (req, res) => {
  try {
    const { to, subject, text, html, queueId } = req.body;
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({
        success: false,
        message: 'to, subject and either text or html are required',
      });
    }

    let queue;
    if (queueId) {
      queue = await EmailQueue.findOne({ _id: queueId, active: true, isDeleted: false });
    } else {
      queue = await EmailQueue.findOne({ active: true, isDeleted: false }).sort({ createdAt: 1 });
    }

    if (!queue) {
      return res.status(404).json({ success: false, message: 'Queue not found' });
    }

    const mail = await MailService.sendEmail({ to, subject, text, html, queue });
    await MailService.persistSentEmail({
      queue,
      to,
      subject,
      text,
      html,
      messageId: mail.messageId,
      from: queue.username,
    });

    return res.status(200).json({
      success: true,
      message: 'Email sent',
      messageId: mail.messageId,
      queue: queue.name,
    });
  } catch (error) {
    console.error('SMTP send error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/emails', requirePermission(['email::read', 'integration::manage'], false), async (req, res) => {
  const emails = await ImapEmail.find({}).sort({ createdAt: -1 }).limit(50);
  res.status(200).json({ success: true, emails });
});

router.post('/tickets/:id/reply', requirePermission(['issue::comment', 'email::send'], false), async (req, res) => {
  try {
    const { text, queueId } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: 'Reply text is required', success: false });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const queue = await EmailQueue.findOne({ _id: queueId, active: true, isDeleted: false });
    if (!queue) return res.status(400).json({ message: 'Invalid queueId' });

    const mail = await MailService.sendEmail({
      to: ticket.email,
      subject: `Re: ${ticket.title} #${ticket._id}`,
      text,
      queue,
    });

    const comment = await Comment.create({
      text,
      userId: req.user?._id || null,
      ticketId: ticket._id,
      reply: true,
      replyEmail: ticket.email,
      public: true,
    });

    await ImapEmail.create({
      from: queue.username,
      subject: `Re: ${ticket.title} #${ticket._id}`,
      body: text,
      html: text,
      text,
    });

    await MailService.persistSentEmail({
      queue,
      to: ticket.email,
      subject: `Re: ${ticket.title} #${ticket._id}`,
      text,
      html: text,
      messageId: mail.messageId,
      from: queue.username,
    });

    return res.status(200).json({ message: 'Reply sent and ticket updated', success: true, comment });
  } catch (err) {
    console.error('Reply error:', err);
    return res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

module.exports = { router, MailService };
