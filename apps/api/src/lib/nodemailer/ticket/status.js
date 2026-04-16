const nodemailer = require("nodemailer");
const express = require('express');
const mongoose = require('mongoose');
const handlebars = require('handlebars');
const { createTransportProvider } = require('../../transport');
const Email = require('../../../models/Email');
const EmailTemplate = require('../../../models/EmailTemplate');
const { requirePermission } = require('../../roles');
const { checkSession } = require('../../session');
const EmailQueue = require('../../../models/EmailQueue');

const router = express.Router();

/**
 * Send ticket status update email
 * @param {Object} ticket - Ticket document
 */
async function sendTicketStatus(ticket) {
  try {
    // 🔹 Get Gmail config from EmailQueue
    const emailConfig = await EmailQueue.findOne({ serviceType: "gmail", active: true });
    if (!emailConfig) throw new Error("Email provider not configured in EmailQueue");

    // 🔹 Setup transporter with Gmail OAuth2
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: emailConfig.username,
        clientId: emailConfig.clientId,
        clientSecret: emailConfig.clientSecret,
        refreshToken: emailConfig.refreshToken,
        accessToken: emailConfig.accessToken,
      },
    });

    // 🔹 Load template
    const templateData = await EmailTemplate.findOne({ type: "ticket_status_changed" });
    if (!templateData) throw new Error("Email template not found (ticket_status_changed)");

    const template = handlebars.compile(templateData.html);
    const replacements = {
      title: ticket.title,
      status: ticket.isComplete ? "COMPLETED" : "OUTSTANDING",
      ticketNumber: ticket.Number || ticket.number || ticket.id,
      email: ticket.email,
    };
    const htmlToSend = template(replacements);
    const statusText = ticket.isComplete ? "COMPLETED" : "OUTSTANDING";

    // 🔹 Send email
    await transport.sendMail({
      from: emailConfig.username,
      to: ticket.email,
      subject: `Issue #${ticket.Number || ticket.number || ticket.id} status is now ${statusText}`,
      text: `Hello, issue #${ticket.Number || ticket.number || ticket.id} is now marked as ${statusText}.`,
      html: htmlToSend,
    });

    console.log(`✅ Ticket status email sent to ${ticket.email}`);
  } catch (err) {
    console.error("Error in sendTicketStatus:", err);
    throw err;
  }
}

module.exports = { sendTicketStatus };