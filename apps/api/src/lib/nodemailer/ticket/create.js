const handlebars = require('handlebars');
const { createTransportProvider } = require('../../transport');
const Email = require('../../../models/Email');
const EmailTemplate = require('../../../models/EmailTemplate');
const EmailQueue = require('../../../models/EmailQueue');
const EmailMessage = require('../../../models/EmailMessage');

function getFallbackEmailConfig() {
  const reply = process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER || null;
  const user = process.env.SMTP_USER || null;

  if (!reply || !user) {
    return null;
  }

  return {
    reply,
    user,
    active: true,
    serviceType: 'other',
  };
}

function buildDefaultTicketCreatedHtml(ticket) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
      <h2 style="margin-bottom: 12px;">Your ticket has been created</h2>
      <p>Hello,</p>
      <p>We received your request and created a support ticket for it.</p>
      <div style="margin: 16px 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;">
        <p style="margin: 0 0 8px;"><strong>Ticket ID:</strong> ${ticket._id || ticket.id}</p>
        <p style="margin: 0 0 8px;"><strong>Title:</strong> ${ticket.title || '-'}</p>
        <p style="margin: 0;"><strong>Priority:</strong> ${ticket.priority || 'low'}</p>
      </div>
      <p>Our team will get back to you as soon as possible.</p>
    </div>
  `;
}

async function storeSentTicketCreateEmail({
  emailConfig,
  ticket,
  subject,
  text,
  html,
  messageId,
}) {
  const senderAddress = String(emailConfig.reply || emailConfig.user || '').trim().toLowerCase();
  if (!senderAddress) {
    return;
  }

  const mailbox = await EmailQueue.findOne({
    active: true,
    isDeleted: false,
    $or: [
      { username: senderAddress },
      { username: emailConfig.user },
    ],
  }).select('_id');

  if (!mailbox) {
    return;
  }

  try {
    await EmailMessage.findOneAndUpdate(
      {
        mailbox: mailbox._id,
        messageId: messageId || `ticket-created:${ticket._id}`,
      },
      {
        $setOnInsert: {
          mailbox: mailbox._id,
          messageId: messageId || `ticket-created:${ticket._id}`,
          folder: 'sent',
          subject,
          body: html || text || '',
          from: emailConfig.reply || emailConfig.user,
          to: [ticket.email],
          cc: [],
          bcc: [],
          date: new Date(),
          isRead: true,
          attachments: [],
        },
      },
      {
        upsert: true,
        new: true,
      }
    );
  } catch (error) {
    console.error('Failed to persist sent ticket creation email:', error);
  }
}

async function sendTicketCreate(ticket) {
  try {
    const emailConfig = await Email.findOne() || getFallbackEmailConfig();

    if (!emailConfig) {
      console.log("Email provider not configured");
      return false;
    }

    const transport = await createTransportProvider(emailConfig);

    const templateData = await EmailTemplate.findOne({
      type: "ticket_created"
    });

    const replacements = {
      id: ticket._id || ticket.id,
      title: ticket.title,
      description: ticket.description,
      email: ticket.email,
      createdAt: ticket.createdAt,
      status: ticket.status,
      priority: ticket.priority
    };

    const htmlToSend = templateData
      ? handlebars.compile(templateData.html)(replacements)
      : buildDefaultTicketCreatedHtml(ticket);
    const subject = `Issue #${ticket._id || ticket.id} has just been created & logged`;
    const text = `Hello there, Issue #${ticket._id || ticket.id}, which you reported on ${ticket.createdAt}, has now been created and logged`;

    const info = await transport.sendMail({
      from: emailConfig.reply,
      to: ticket.email,
      subject,
      text,
      html: htmlToSend,
    });

    await storeSentTicketCreateEmail({
      emailConfig,
      ticket,
      subject,
      text,
      html: htmlToSend,
      messageId: info.messageId,
    });

    console.log("Message sent: %s", info.messageId);
    return true;

  } catch (error) {
    console.error('Error sending ticket creation email:', error);
    return false;
  }
}

// Export existing functions too
module.exports = {
  sendTicketCreate,
  // sendComment: require('./emailService').sendComment // if you have this from previous
};
