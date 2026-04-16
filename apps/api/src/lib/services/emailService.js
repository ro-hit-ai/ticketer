// emailService.js
const { MailService } = require('./smtp.service');
const EmailQueue = require('../../models/EmailQueue');

async function sendComment(comment, title, ticketId, recipient) {
  try {
    // Pick an active Gmail queue
    const queue = await EmailQueue.findOne({ active: true, serviceType: 'gmail' });
    if (!queue) throw new Error("No active Gmail queue configured");

    const subject = `Ticket #${ticketId}: ${title}`;
    const html = `
      <h3>${title}</h3>
      <p><b>Ticket ID:</b> ${ticketId}</p>
      <p>${comment}</p>
    `;

    const mail = await MailService.sendEmail({
      to: recipient,
      subject,
      text: comment,
      html,
      queue,
    });

    console.log("📧 Email sent:", mail.messageId);
    return true;
  } catch (err) {
    console.error("❌ Error sending comment email:", err);
    return false;
  }
}

module.exports = { sendComment };
