// apps/api/src/services/imap.service.js
const express = require('express');
const EmailReplyParser = require('email-reply-parser');
const ImapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const AuthService = require('./authService');
const EmailQueue = require('../../models/EmailQueue');
const Ticket = require('../../models/Ticket');
const Comment = require('../../models/Comment');
const Counter = require('../../models/Counter');
const User = require('../../models/User'); // adjust path if needed
const EmailMessage = require('../../models/EmailMessage');
const Thread = require('../../models/Thread');
const Message = require('../../models/Message');
const nodemailer = require('nodemailer');
const { requirePermission } = require('../roles');
const {
  buildHeaderSnapshot,
  extractSourceCaseIdFromHeadersOrSubject,
  getHeader,
  normalizeReferences,
  resolveThreadForInboundEmail,
} = require('./emailThreading.service');
const { extractApplicationIdFromSubject } = require('./emailApplicationId.service');
const router = express.Router();

// ------------------ Helper Functions ------------------
function getReplyText(email) {
  const parsed = new EmailReplyParser().read(email.text);
  const fragments = parsed.getFragments();
  let replyText = "";

  fragments.forEach((fragment) => {
    if (!fragment._isHidden && !fragment._isSignature && !fragment._isQuoted) {
      replyText += fragment._content;
    }
  });

  return replyText;
}

// Categorize mail based on sender/receiver
function categorizeMail(parsed, username) {
  if (parsed.from?.text?.includes(username)) return "sent";
  else if (parsed.to?.value?.some(addr => addr.address === username)) return "received";
  return "inbox";
}

// Helper to normalize IMAP folder to EmailMessage enum
function normalizeFolder(folderName) {
  const name = folderName.toLowerCase();
  if (name.includes("inbox")) return "inbox";
  if (name.includes("sent")) return "sent";
  return "internal"; // fallback for other folders
}

// Save parsed email into EmailMessage collection
async function saveEmail(parsed, mailboxId, folder, options = {}) {
  const messageId = options.messageId || parsed.messageId;
  const references = Array.isArray(options.references)
    ? options.references
    : normalizeReferences(getHeader(parsed, 'references'));

  return EmailMessage.findOneAndUpdate(
    {
      mailbox: mailboxId,
      messageId,
    },
    {
      $setOnInsert: {
        mailbox: mailboxId,
        messageId,
        folder,
        subject: parsed.subject || "(No subject)",
        body: parsed.text || parsed.html || "",
        from: parsed.from?.text,
        to: parsed.to?.value?.map(addr => addr.address) || [],
        cc: parsed.cc?.value?.map(addr => addr.address) || [],
        bcc: parsed.bcc?.value?.map(addr => addr.address) || [],
        date: parsed.date || new Date(),
        isRead: false,
        attachments: parsed.attachments?.map(att => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
        })),
      },
      $set: {
        threadId: options.threadId || null,
        sourceCaseId: options.sourceCaseId || null,
        direction: options.direction || 'inbound',
        inReplyTo: options.inReplyTo || getHeader(parsed, 'in-reply-to') || null,
        references,
        headers: options.headers || buildHeaderSnapshot(parsed),
        sentByUserId: options.sentByUserId || null,
        sentByRole: options.sentByRole || null,
        recipientUserId: options.recipientUserId || null,
      },
    },
    { upsert: true, new: true }
  );
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSourceCaseId(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

function buildLastMessagePreview(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, 280);
}

function resolveActivationTrigger({ direction, sender, explicitTrigger }) {
  const allowed = new Set(["system_issue", "agent", "candidate_email", "unknown"]);
  if (explicitTrigger && allowed.has(explicitTrigger)) return explicitTrigger;

  if (direction === "inbound") return "candidate_email";
  if (sender?.type === "system") return "system_issue";
  if (direction === "outbound" || direction === "internal") return "agent";
  return "unknown";
}

function extractSourceCaseIdFromPlusAddress(toEmails = []) {
  // support+APP-123@domain.com -> APP-123
  for (const addr of toEmails) {
    const value = String(addr || "");
    const match = value.match(/\+([a-z0-9][a-z0-9-]{2,63})@/i);
    if (match?.[1]) return normalizeSourceCaseId(match[1]);
  }
  return null;
}

async function findExistingThreadForInboundEmail({ extractedSourceCaseId, normalizedFromEmail, mailboxId }) {
  if (extractedSourceCaseId) {
    const thread = await Thread.findOne({ sourceCaseId: extractedSourceCaseId });
    if (thread) return thread;
  }

  if (!normalizedFromEmail) {
    return null;
  }

  const candidates = await Thread.find({ applicantEmail: normalizedFromEmail })
    .sort({ createdAt: -1 })
    .limit(5);

  if (candidates.length === 0) {
    return null;
  }

  const mailboxMatch = candidates.find((candidate) => String(candidate.mailboxId || "") === String(mailboxId || ""));
  if (mailboxMatch) {
    return mailboxMatch;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function serializeEmail(emailDoc) {
  const email = typeof emailDoc?.toObject === "function" ? emailDoc.toObject() : emailDoc;
  const plainBody = String(email?.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return {
    ...email,
    preview: plainBody.slice(0, 180),
    hasAttachments: Array.isArray(email?.attachments) && email.attachments.length > 0,
    attachmentCount: Array.isArray(email?.attachments) ? email.attachments.length : 0,
  };
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

function shouldRetryImapError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('connection ended unexpectedly') ||
    message.includes('socket closed') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  );
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildKeepaliveConfig() {
  const enabled = String(process.env.IMAP_KEEPALIVE_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return false;

  return {
    interval: Number(process.env.IMAP_KEEPALIVE_INTERVAL_MS || 10000),
    idleInterval: Number(process.env.IMAP_KEEPALIVE_IDLE_INTERVAL_MS || 300000),
    forceNoop: true,
  };
}

function stringifyUserId(value) {
  if (!value) return null;
  return String(value).trim() || null;
}

async function resolveInboundRecipientUserId(thread, parsed) {
  // 1. Try In-Reply-To (BEST CASE)
  const inReplyTo = getHeader(parsed, 'in-reply-to');

  if (inReplyTo) {
    const originalEmail = await EmailMessage.findOne({
      messageId: inReplyTo
    });

    if (originalEmail?.sentByUserId) {
      console.log("Routing via In-Reply-To:", originalEmail.sentByUserId);
      return String(originalEmail.sentByUserId);
    }
  }

  // 2. Workflow snapshot
  const workflowUserId = stringifyUserId(thread?.workflowSnapshot?.currentUserId);
  if (workflowUserId) return workflowUserId;

  // 3. Thread owner
  const lastAssignedUserId = stringifyUserId(thread?.lastAssignedUserId);
  if (lastAssignedUserId) return lastAssignedUserId;

  // 4. Last sender fallback
  const lastMessage = await Message.findOne({
    threadId: thread?._id,
    $or: [
      { sentByUserId: { $exists: true, $ne: null } },
      { 'sender.id': { $exists: true, $ne: null } },
    ],
  })
    .sort({ createdAt: -1 })
    .select('sentByUserId sender');

  return stringifyUserId(lastMessage?.sentByUserId || lastMessage?.sender?.id || null);
}
function isImapDebugEnabled() {
  return String(process.env.IMAP_DEBUG_ENABLED || 'false').toLowerCase() === 'true';
}

function buildQueueDebugInfo(queue) {
  return {
    queueId: String(queue?._id || ''),
    username: queue?.username || null,
    host: queue?.hostname || null,
    port: Number(queue?.imapPort || (queue?.tls ? 993 : 143)),
    tls: Boolean(queue?.tls),
    serviceType: queue?.serviceType || null,
  };
}

function logImapDebug(message, context = {}) {
  if (!isImapDebugEnabled()) return;
  console.log(`[IMAP DEBUG] ${message}`, context);
}

function getFolderUidState(queue, folderName) {
  const normalizedFolder = String(folderName || '').toUpperCase();
  const map = queue?.imapState?.lastUidByFolder || {};
  const value = Number(map[normalizedFolder] || 0);
  return Number.isFinite(value) ? value : 0;
}

function shouldBootstrapHistoricalUnread(queue, folderName) {
  const flag = String(process.env.IMAP_BOOTSTRAP_HISTORICAL_UNREAD || 'true').toLowerCase() === 'true';
  if (flag) return false;

  return getFolderUidState(queue, folderName) <= 0;
}

async function persistFolderUidState(queueId, folderName, uid) {
  const numericUid = Number(uid || 0);
  if (!numericUid) return;

  const normalizedFolder = String(folderName || '').toUpperCase();
  await EmailQueue.updateOne(
    { _id: queueId },
    {
      $max: {
        [`imapState.lastUidByFolder.${normalizedFolder}`]: numericUid,
      },
      $set: {
        lastScanned: new Date(),
      },
    }
  );
}

function safeEndConnection(connection, queueId) {
  try {
    const state = connection?.imap?.state || null;
    logImapDebug('Closing IMAP connection', { queueId: String(queueId), state });
    if (!connection || state === 'disconnected') {
      return;
    }
    connection.end();
  } catch (closeError) {
    console.error(`⚠️ Error closing IMAP connection for queue ${queueId}:`, closeError.message);
  }
}

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
    console.error('IMAP connection emitted error event:', {
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

async function ensureTicketForThread({ thread, parsed, fromEmail, queue, mailboxId }) {
  if (thread?.ticketId) {
    return thread.ticketId;
  }

  const existingTicket =
    (thread?.sourceCaseId
      ? await Ticket.findOne({ sourceCaseId: thread.sourceCaseId, hidden: false }).select('_id')
      : null) ||
    await Ticket.findOne({
      email: fromEmail,
      title: parsed.subject || "-",
      hidden: false,
    }).select('_id');

  if (existingTicket?._id) {
    await Thread.findByIdAndUpdate(thread._id, {
      $set: {
        ticketId: existingTicket._id,
        mailboxId: thread.mailboxId || mailboxId || null,
      },
    });

    await Ticket.findByIdAndUpdate(existingTicket._id, {
      $set: {
        threadId: thread._id,
        sourceCaseId: thread.sourceCaseId || null,
        mailboxId: thread.mailboxId || mailboxId || null,
      },
    });

    return existingTicket._id;
  }

  const defaultUserId = process.env.DEFAULT_USER_ID || queue.createdBy || null;
  const ticket = new Ticket({
    email: fromEmail,
    name: parsed.from?.value?.[0]?.name || fromEmail,
    title: parsed.subject || "-",
    isComplete: false,
    priority: "low",
    fromImap: true,
    detail: parsed.text || parsed.html,
    createdBy: defaultUserId,
    threadId: thread._id,
    sourceCaseId: thread.sourceCaseId || null,
    mailboxId: thread.mailboxId || mailboxId || null,
  });

  if (!ticket.number) {
    const counter = await Counter.findByIdAndUpdate(
      { _id: 'ticket' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    ticket.number = `TKT-${String(counter.seq).padStart(6, '0')}`;
  }

  await ticket.save();

  await Thread.findByIdAndUpdate(thread._id, {
    $set: {
      ticketId: ticket._id,
      mailboxId: thread.mailboxId || mailboxId || null,
    },
  });

  return ticket._id;
}

async function getSmtpTransport(queue) {
  if (queue.serviceType === "gmail") {
    const accessToken = await AuthService.getValidAccessToken(queue);
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: queue.username,
        clientId: queue.clientId,
        clientSecret: queue.clientSecret,
        refreshToken: queue.refreshToken,
        accessToken,
      },
    });
  }

  const smtpPort = Number(queue.smtpPort || 465);
  return nodemailer.createTransport({
    host: queue.hostname,
    port: smtpPort,
    secure: smtpPort === 465 || Boolean(queue.tls),
    auth: {
      user: queue.username,
      pass: queue.password,
    },
    tls: { rejectUnauthorized: false, servername: queue.hostname },
  });
}

async function sendTicketCreatedAck(queue, ticket, recipientEmail) {
  if (!recipientEmail) {
    return false;
  }

  try {
    const transport = await getSmtpTransport(queue);
    const subject = `Issue #${ticket._id} has just been created & logged`;
    const text = `Hello there, your ticket "${ticket.title}" has now been created and logged. Ticket ID: ${ticket._id}.`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin: 0 0 12px;">Your ticket has been created</h2>
        <p>We received your email and created a support ticket.</p>
        <p><strong>Ticket ID:</strong> ${ticket._id}</p>
        <p><strong>Title:</strong> ${ticket.title || "-"}</p>
        <p><strong>Priority:</strong> ${ticket.priority || "low"}</p>
      </div>
    `;

    const info = await transport.sendMail({
      from: queue.username,
      to: recipientEmail,
      subject,
      text,
      html,
    });

    await EmailMessage.findOneAndUpdate(
      {
        mailbox: queue._id,
        messageId: info.messageId || `ticket-created:${ticket._id}`,
      },
      {
        $setOnInsert: {
          mailbox: queue._id,
          messageId: info.messageId || `ticket-created:${ticket._id}`,
          folder: "sent",
          subject,
          body: text || toPlainText(html),
          from: queue.username,
          to: [recipientEmail],
          cc: [],
          bcc: [],
          date: new Date(),
          isRead: true,
          attachments: [],
        },
      },
      { upsert: true }
    );

    console.log(`📨 Ticket created acknowledgement sent to ${recipientEmail}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send ticket created acknowledgement to ${recipientEmail}:`, error.message);
    return false;
  }
}

// ------------------ IMAP Service ------------------
let isFetchInProgress = false;
const queueFailureState = new Map();

function getQueueFailureState(queueId) {
  return queueFailureState.get(String(queueId)) || { failures: 0, nextAllowedAt: 0, lastError: null };
}

function clearQueueFailureState(queueId) {
  queueFailureState.delete(String(queueId));
}

function markQueueFailure(queueId, error) {
  const key = String(queueId);
  const current = getQueueFailureState(key);
  const failures = current.failures + 1;
  const baseDelayMs = Number(process.env.IMAP_QUEUE_BACKOFF_BASE_MS || 30000);
  const maxDelayMs = Number(process.env.IMAP_QUEUE_BACKOFF_MAX_MS || 10 * 60 * 1000);
  const delayMs = Math.min(baseDelayMs * (2 ** Math.max(0, failures - 1)), maxDelayMs);

  queueFailureState.set(key, {
    failures,
    nextAllowedAt: Date.now() + delayMs,
    lastError: String(error?.message || error || 'unknown error'),
  });

  return { failures, delayMs };
}

function shouldSkipQueueForBackoff(queueId) {
  const state = getQueueFailureState(queueId);
  return state.nextAllowedAt > Date.now() ? state : null;
}

class ImapService {
  // Get IMAP config
  static async getImapConfig(queue) {
    if (queue.serviceType === "gmail") {
      const accessToken = await AuthService.getValidAccessToken(queue);
      const xoauth2 = Buffer.from(
        `user=${queue.username}\u0001auth=Bearer ${accessToken}\u0001\u0001`
      ).toString("base64");

      return {
        user: queue.username,
        xoauth2,
        host: queue.hostname || "imap.gmail.com",
        port: Number(queue.imapPort || 993),
        tls: true,
        authTimeout: Number(process.env.IMAP_AUTH_TIMEOUT_MS || 30000),
        connTimeout: Number(process.env.IMAP_CONN_TIMEOUT_MS || 30000),
        socketTimeout: Number(process.env.IMAP_SOCKET_TIMEOUT_MS || 120000),
        keepalive: buildKeepaliveConfig(),
        tlsOptions: { rejectUnauthorized: false, servername: queue.hostname || "imap.gmail.com" },
      };
    }

    return {
      user: queue.username,
      password: queue.password,
      host: queue.hostname || "imap.gmail.com",
      port: Number(queue.imapPort || (queue.tls ? 993 : 143)),
      tls: queue.tls || false,
      authTimeout: Number(process.env.IMAP_AUTH_TIMEOUT_MS || 30000),
      connTimeout: Number(process.env.IMAP_CONN_TIMEOUT_MS || 30000),
      socketTimeout: Number(process.env.IMAP_SOCKET_TIMEOUT_MS || 120000),
      keepalive: buildKeepaliveConfig(),
      tlsOptions: { rejectUnauthorized: false, servername: queue.hostname || "imap.gmail.com" },
    };
  }

  static async testFetchQueue(queueId) {
    if (!queueId) {
      throw new Error('queueId is required');
    }

    const queue = await EmailQueue.findOne({ _id: queueId, active: true, isDeleted: false });
    if (!queue) {
      throw new Error('Queue not found or inactive');
    }

    let connection = null;
    try {
      const imapConfig = await this.getImapConfig(queue);
      connection = await ImapSimple.connect({ imap: imapConfig });
      attachImapErrorHandler(connection, {
        mode: 'test-fetch',
        queueId: String(queue._id),
        username: queue.username || null,
      });
      await connection.openBox('INBOX');

      const unseenResults = await connection.search(['UNSEEN'], { bodies: [], markSeen: false });
      const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentResults = await connection.search(
        [['SINCE', recentSince]],
        { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)'], markSeen: false }
      );

      const sampleMessages = await Promise.all(
        recentResults.slice(0, 5).map(async (result) => {
          const headerBody = result?.parts?.[0]?.body || {};
          const getHeaderValue = (key) => {
            const value = headerBody?.[key];
            if (Array.isArray(value)) {
              return value[0] || null;
            }
            return value || null;
          };

          return {
            uid: Number(result?.attributes?.uid || 0) || null,
            messageId: getHeaderValue('message-id'),
            subject: getHeaderValue('subject') || '(No subject)',
            from: getHeaderValue('from'),
            to: getHeaderValue('to'),
            date: getHeaderValue('date'),
          };
        })
      );

      return {
        queue: {
          id: String(queue._id),
          username: queue.username || null,
          hostname: queue.hostname || null,
          imapPort: Number(queue.imapPort || (queue.tls ? 993 : 143)),
          tls: Boolean(queue.tls),
        },
        inbox: {
          name: 'INBOX',
          unseenCount: Array.isArray(unseenResults) ? unseenResults.length : 0,
          recentCount: Array.isArray(recentResults) ? recentResults.length : 0,
          lastProcessedUid: getFolderUidState(queue, 'INBOX'),
          sampleMessages,
        },
      };
    } finally {
      safeEndConnection(connection, queueId);
    }
  }


  // Process email for ticket or save
static async processEmail(parsed, mailboxId, queue) {
  const subjectLower = parsed.subject?.toLowerCase() || "";
  const fromEmail = parsed.from?.value?.[0]?.address;
  const normalizedFromEmail = String(fromEmail || "").toLowerCase();
  const normalizedQueueEmail = String(queue.username || "").toLowerCase();
  const toEmails = parsed.to?.value?.map(addr => String(addr.address || "").toLowerCase()) || [];
  const inReplyTo = getHeader(parsed, 'in-reply-to') || null;
  const references = normalizeReferences(getHeader(parsed, 'references'));
  const headerSnapshot = buildHeaderSnapshot(parsed);

  let replyText = "";

  if (normalizedFromEmail && normalizedFromEmail === normalizedQueueEmail) {
    console.log(`Skipping self-sent email (not inbound): ${normalizedFromEmail}`);
    await saveEmail(parsed, mailboxId, "sent", {
      messageId: parsed.messageId,
      direction: 'outbound',
      inReplyTo,
      references,
      headers: headerSnapshot,
    });
    return;
  }

  // Determine folder
  let folder = "inbox"; // default
  if (toEmails.includes(normalizedQueueEmail)) folder = "inbox";
  else if (normalizedFromEmail === normalizedQueueEmail) folder = "sent";
  else folder = "internal"; // agent-to-agent or system email

  // Ignore internal or agent emails for ticket creation
  const isInternalOrAgent = normalizedFromEmail === normalizedQueueEmail || folder === "internal";
  if (isInternalOrAgent) {
    await saveEmail(parsed, mailboxId, folder, {
      messageId: parsed.messageId,
      direction: folder === 'sent' ? 'outbound' : 'inbound',
      inReplyTo,
      references,
      headers: headerSnapshot,
    });
    return;
  }

  // ------------------------------------------------------------------
  // COMMUNICATION ENGINE: map inbound email -> Thread + Message (hybrid)
  // ------------------------------------------------------------------
  // Keep existing ticket behavior intact: only divert to thread/message if we can map to a thread.
  if (folder === "inbox" && normalizedFromEmail) {
    const subjectApplicationId = extractApplicationIdFromSubject(parsed.subject);
    let thread = subjectApplicationId
      ? await Thread.findOne({ sourceCaseId: subjectApplicationId })
      : null;
    const resolvedInbound = thread
      ? {
          thread,
          sourceCaseId: thread.sourceCaseId || subjectApplicationId,
          inReplyTo,
          references,
        }
      : await resolveThreadForInboundEmail(parsed);
    const extractedSourceCaseId =
      subjectApplicationId ||
      resolvedInbound.sourceCaseId ||
      extractSourceCaseIdFromHeadersOrSubject(parsed) ||
      extractSourceCaseIdFromPlusAddress(toEmails);

    thread =
      thread ||
      resolvedInbound.thread ||
      (await findExistingThreadForInboundEmail({
        extractedSourceCaseId,
        normalizedFromEmail,
        mailboxId,
      }));

    if(thread){
       const externalMessageId = parsed.messageId ? String(parsed.messageId) : null;

if (externalMessageId) {
  const exists = await Message.findOne({ threadId: thread._id, externalMessageId });
  if (exists) return;
}

const inboundBody = getReplyText(parsed) || parsed.text || parsed.html || "No Body";

// ================== 🔥 INBOUND ROUTING FIX ==================
let routedToUserId = null;

// STEP 1: Try In-Reply-To (BEST CASE)
let inReplyTo = getHeader(parsed, 'in-reply-to');

if (inReplyTo) {
  const normalizedInReplyTo = inReplyTo.replace(/[<>]/g, '').trim();

const originalEmail = await EmailMessage.findOne({
  messageId: { $regex: normalizedInReplyTo, $options: 'i' }
});

  if (originalEmail?.sentByUserId) {
    routedToUserId = String(originalEmail.sentByUserId);
    console.log("✅ Routed via In-Reply-To:", routedToUserId);
  }
}

// STEP 2: Fallback (thread ownership logic)
if (!routedToUserId) {
  routedToUserId = await resolveInboundRecipientUserId(thread);
  console.log("↩️ Routed via fallback:", routedToUserId);
}

// Normalize header for storage
if (inReplyTo) {
  inReplyTo = inReplyTo.replace(/[<>]/g, '').trim();
}
// ===========================================================

// Save email
const emailRecord = await saveEmail(parsed, mailboxId, folder, {
  messageId: externalMessageId || parsed.messageId,
  threadId: thread._id,
  sourceCaseId: thread.sourceCaseId || extractedSourceCaseId || null,
  direction: 'inbound',
  inReplyTo,
  references,
  headers: headerSnapshot,
  recipientUserId: routedToUserId,
});

let message = null;

try {
  message = await Message.create({
    threadId: thread._id,
    sourceCaseId: thread.sourceCaseId || extractedSourceCaseId || null,
    ticketId: effectiveTicketId || null,
    mailboxId: thread.mailboxId || mailboxId || null,
    direction: "inbound",
    channel: "email",
    sender: {
      id: null,
      name: parsed.from?.value?.[0]?.name || null,
      email: normalizedFromEmail || null,
      type: "external",
    },
    sentByUserId: null,
    sentByRole: null,
    recipientUserId: routedToUserId,
    recipients: { to: toEmails, cc: [], bcc: [] },
    subject: parsed.subject || thread.subject || null,
    body: String(inboundBody || "").trim() || "No Body",
    bodyHtml: parsed.html || null,
    externalMessageId,
    emailMessageId: emailRecord?._id || null,
    status: "received",
    metadata: {
      imap: {
        mailboxId: String(mailboxId),
        folder,
      },
      routedToUserId,
      workflowSnapshotAtReceive: thread.workflowSnapshot || {},
    },
  });
} catch (error) {
  if (error?.code === 11000 && externalMessageId) {
    return;
  }
  throw error;
}

// Update thread
const shouldActivate = thread.status === "monitoring";
const activationTrigger = shouldActivate
  ? resolveActivationTrigger({
      direction: "inbound",
      sender: message.sender,
    })
  : null;

await Thread.findByIdAndUpdate(thread._id, {
  $inc: { unreadCount: 1 },
  $set: {
    lastMessage: buildLastMessagePreview(message.body),
    lastMessageAt: message.createdAt,
    mailboxId: message.mailboxId || thread.mailboxId || null,
    ...(shouldActivate
      ? {
          status: "active",
          activatedAt: new Date(),
          activationTrigger: activationTrigger || "candidate_email",
        }
      : {}),
  },
});
    }
  }

  await saveEmail(parsed, mailboxId, folder, {
    messageId: parsed.messageId,
    sourceCaseId:
      extractSourceCaseIdFromHeadersOrSubject(parsed) || extractSourceCaseIdFromPlusAddress(toEmails),
    direction: 'inbound',
    inReplyTo,
    references,
    headers: headerSnapshot,
  });

  const isReply = subjectLower.includes("re:") || subjectLower.includes("ref:");
  
  // --- Handle Replies ---
  if (isReply) {
    const uuidMatch = parsed.subject.match(/(?:ref:|#)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const ticketId = uuidMatch?.[1];
    if (!ticketId) return console.warn(`⚠️ Could not extract ticket ID from subject: ${parsed.subject}`);

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) return console.warn(`⚠️ Ticket not found: ${ticketId}`);

   
    if (isReply) {
       replyText = getReplyText(parsed);
    }

    await Comment.create({
      text: replyText || parsed.text || parsed.html || "No Body",
      userId: queue.createdBy || null,
      ticketId: ticket._id,
      reply: false,
      replyEmail: fromEmail,
      public: true,
   });

    return;
  }

  // --- Handle New User Email (Create Ticket) ---
 // --- Handle New User Email (Create Ticket) ---
const defaultUserId = process.env.DEFAULT_USER_ID || queue.createdBy || null;

// ✅ Avoid duplicate tickets for same email
const existingTicket = await Ticket.findOne({
  email: fromEmail,
  title: parsed.subject || "-"
});

if (existingTicket) {
  console.log(`ℹ️ Ticket already exists for ${parsed.subject}, skipping new ticket.`);
  
  // Instead, just append as a comment
  await Comment.create({
    text: parsed.text || parsed.html || "No Body",
    userId: queue.createdBy || null,
    ticketId: existingTicket._id,
    reply: true,
    replyEmail: fromEmail,
    public: true,
  });
  return;
}

// ✅ Only create new ticket if no existing one
const ticket = new Ticket({
  email: fromEmail,
  name: parsed.from?.value?.[0]?.name || fromEmail,
  title: parsed.subject || "-",
  isComplete: false,
  priority: "low",
  fromImap: true,
  detail: parsed.text || parsed.html,
  createdBy: defaultUserId,
});

// Assign sequential ticket number
if (!ticket.number) {
  const counter = await Counter.findByIdAndUpdate(
    { _id: 'ticket' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  ticket.number = `TKT-${String(counter.seq).padStart(6, '0')}`;
}

await ticket.save();

if (fromEmail) {
  await sendTicketCreatedAck(queue, ticket, fromEmail);
}

await Comment.create({
  text: parsed.text || parsed.html || "No Body",
  userId: queue.createdBy || null,
  ticketId: ticket._id,
  reply: true,
  replyEmail: fromEmail,
  public: true,
});
}


  static async fetchFolderMails(connection, queue, folderName, mailboxId) {
    try {
      await connection.openBox(folderName);
      logImapDebug('IMAP box opened', {
        ...buildQueueDebugInfo(queue),
        folderName,
        state: connection?.imap?.state || null,
      });

      const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const searchCriteria = [
        ['SINCE', sinceDate],
        'UNSEEN'
      ];

      const fetchOptions = { bodies: [''], markSeen: false };
      const results = await connection.search(searchCriteria, fetchOptions);
      const lastProcessedUid = getFolderUidState(queue, folderName);
      const highestUidInBatch = Array.isArray(results)
        ? results.reduce((maxUid, result) => {
            const numericUid = Number(result?.attributes?.uid || 0);
            return numericUid > maxUid ? numericUid : maxUid;
          }, 0)
        : 0;
      logImapDebug('IMAP search completed', {
        ...buildQueueDebugInfo(queue),
        folderName,
        resultCount: Array.isArray(results) ? results.length : 0,
        lastProcessedUid,
        highestUidInBatch,
      });

      if (
        shouldBootstrapHistoricalUnread(queue, folderName) &&
        highestUidInBatch > 0
      ) {
        await persistFolderUidState(queue._id, folderName, highestUidInBatch);
        console.log(
          `⚠️ Bootstrapped IMAP UID state for ${queue.username} ${folderName}; skipped ${results.length} historical unread message(s)`
        );
        return;
      }

      for (const res of results) {
        const currentUid = Number(res?.attributes?.uid || 0);
        if (currentUid && currentUid <= lastProcessedUid) {
          logImapDebug('Skipping IMAP message because UID was already processed', {
            ...buildQueueDebugInfo(queue),
            folderName,
            uid: currentUid,
            lastProcessedUid,
          });
          continue;
        }

        const raw = res.parts[0].body;
        const parsed = await simpleParser(raw);

        const fallbackMessageId = parsed.messageId || `${queue._id}:${folderName}:${res.attributes.uid}`;
        const exists = await EmailMessage.findOne({
          mailbox: mailboxId,
          messageId: fallbackMessageId,
        });
        if (exists) {
          await persistFolderUidState(queue._id, folderName, currentUid);
          continue; // skip duplicates
        }

        parsed.messageId = fallbackMessageId;
        await ImapService.processEmail(parsed, mailboxId, queue); // processEmail handles save
        await persistFolderUidState(queue._id, folderName, currentUid);
      }

      console.log(`✅ Synced ${folderName} mails`);
    } catch (err) {
      console.error(`❌ Error syncing ${folderName}:`, err.message);
      throw err;
    }
  }
 
// Main fetch logic
  static isFetchInProgress() {
    return isFetchInProgress;
  }

  static async fetchEmails() {
    if (isFetchInProgress) {
      console.log('Skipping IMAP fetch because another run is already in progress');
      return { started: false, skipped: true };
    }

    isFetchInProgress = true;
    try {
      const queues = await EmailQueue.find({ active: true, isDeleted: false });

      for (const queue of queues) {
        const queueBackoffState = shouldSkipQueueForBackoff(queue._id);
        if (queueBackoffState) {
          const remainingMs = Math.max(0, queueBackoffState.nextAllowedAt - Date.now());
          logImapDebug('Skipping queue because of backoff', {
            ...buildQueueDebugInfo(queue),
            remainingMs,
            failures: queueBackoffState.failures,
            lastError: queueBackoffState.lastError,
          });
          console.log(
            `Skipping IMAP queue ${queue._id} for ${Math.ceil(remainingMs / 1000)}s due to repeated failures`
          );
          continue;
        }

        let lastError = null;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
          let connection = null;
          try {
            const imapConfig = await this.getImapConfig(queue);
            logImapDebug('Starting IMAP connection attempt', {
              ...buildQueueDebugInfo(queue),
              attempt,
              authTimeout: imapConfig.authTimeout,
              connTimeout: imapConfig.connTimeout,
              socketTimeout: imapConfig.socketTimeout,
              keepalive: imapConfig.keepalive || false,
            });
            connection = await ImapSimple.connect({ imap: imapConfig });
            attachImapErrorHandler(connection, {
              mode: 'fetch-emails',
              queueId: String(queue._id),
              username: queue.username || null,
              attempt,
            });
            logImapDebug('IMAP connection established', {
              ...buildQueueDebugInfo(queue),
              attempt,
              state: connection?.imap?.state || null,
            });

            // Sequential fetch: Inbox first, then Sent
            await this.fetchFolderMails(connection, queue, "INBOX", queue._id);
            // await this.fetchFolderMails(connection, queue, "[Gmail]/Sent Mail", queue._id);
            console.log(`📡 Completed fetch for: ${queue.username}`);
            clearQueueFailureState(queue._id);
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            const canRetry = attempt < 2 && shouldRetryImapError(err);
            console.error(
              `❌ Error processing queue ${queue._id} on attempt ${attempt}:`,
              err?.message || err
            );
            logImapDebug('IMAP attempt failed', {
              ...buildQueueDebugInfo(queue),
              attempt,
              state: connection?.imap?.state || null,
              errorName: err?.name || null,
              errorMessage: err?.message || String(err),
              stack: err?.stack || null,
            });
            if (canRetry) {
              console.log(`↻ Retrying IMAP queue ${queue._id} after transient socket failure`);
              await delay(1500);
            }
          } finally {
            safeEndConnection(connection, queue._id);
          }
        }

        if (lastError) {
          const backoff = markQueueFailure(queue._id, lastError);
          console.error(`❌ Final failure processing queue ${queue._id}:`, lastError);
          console.error(
            `⏳ Backing off queue ${queue._id} after ${backoff.failures} failure(s) for ${Math.ceil(backoff.delayMs / 1000)}s`
          );
        }
      }
      return { started: true, skipped: false };
    } catch (err) {
      console.error('Error in fetchEmails:', err);
      throw err;
    } finally {
      isFetchInProgress = false;
    }
  }

static async moveEmailOnServer(messageId, targetFolder) {
  const queues = await EmailQueue.find({ active: true });
  
  for (const queue of queues) {
    const connection = await ImapSimple.connect({ imap: await this.getImapConfig(queue) });
    attachImapErrorHandler(connection, {
      mode: 'move-email-on-server',
      queueId: String(queue._id),
      username: queue.username || null,
    });
    await connection.openBox('INBOX'); // adjust if email is in another folder

    const results = await connection.search(['HEADER', 'Message-ID', messageId], { bodies: [] });
    if (results.length > 0) {
      const uids = results.map(r => r.attributes.uid);
      await connection.moveMessage(uids, targetFolder);
      console.log(`Moved message ${messageId} to ${targetFolder} on server`);
    }

    connection.end();
  }
}
}
// ------------------ Router Endpoints ------------------
router.post('/fetch-emails', requirePermission(['integration::manage']), async (req, res) => {
  try {
    if (ImapService.isFetchInProgress()) {
      return res.status(202).json({
        message: 'IMAP email fetch already in progress',
        success: true,
        skipped: true,
      });
    }

    ImapService.fetchEmails().catch(error => console.error('Background IMAP fetch error:', error));
    res.status(202).json({ message: 'IMAP email fetch started in background', success: true, skipped: false });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

router.post('/test-fetch', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const { queueId } = req.body || {};
    if (!queueId) {
      return res.status(400).json({
        success: false,
        message: 'queueId is required',
      });
    }

    const result = await ImapService.testFetchQueue(queueId);

    return res.status(200).json({
      success: true,
      message: 'IMAP test fetch successful',
      ...result,
    });
  } catch (error) {
    console.error('IMAP test fetch failed:', error);
    return res.status(500).json({
      success: false,
      message: 'IMAP test fetch failed',
      error: error.message,
    });
  }
});

router.get('/emails', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      folder,
      q,
      unreadOnly,
    } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const query = {};

    if (folder) {
      query.folder = String(folder).toLowerCase();
    }

    if (String(unreadOnly).toLowerCase() === 'true') {
      query.isRead = false;
    }

    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      query.$or = [
        { subject: pattern },
        { from: pattern },
        { body: pattern },
        { to: pattern },
        { cc: pattern },
        { bcc: pattern },
      ];
    }

    const emails = await EmailMessage.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber);

    const total = await EmailMessage.countDocuments(query);

    res.status(200).json({
      emails: emails.map(serializeEmail),
      total,
      page: pageNumber,
      pages: Math.ceil(total / limitNumber),
      success: true
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

router.get('/emails/:id', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const email = await EmailMessage.findById(req.params.id);
    if (!email) return res.status(404).json({ message: 'Email not found', success: false });
    res.status(200).json({ email: serializeEmail(email), success: true });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

router.patch('/emails/:id/read', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const { isRead } = req.body;
    const email = await EmailMessage.findByIdAndUpdate(
      req.params.id,
      { isRead: Boolean(isRead) },
      { new: true }
    );

    if (!email) {
      return res.status(404).json({ message: 'Email not found', success: false });
    }

    res.status(200).json({
      email: serializeEmail(email),
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

router.patch('/emails/read', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const { emailIds, isRead } = req.body;
    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ message: 'No emails provided', success: false });
    }

    await EmailMessage.updateMany(
      { _id: { $in: emailIds } },
      { $set: { isRead: Boolean(isRead) } }
    );

    res.status(200).json({
      success: true,
      updated: emailIds.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

router.get('/priority-stats', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const [unread, attachments] = await Promise.all([
      EmailMessage.countDocuments({ isRead: false }),
      EmailMessage.countDocuments({ "attachments.0": { $exists: true } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        unread,
        withAttachments: attachments,
        pendingAnalysis: unread,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

// ------------------ Move Emails Routes ------------------

// Move a single email to another folder
router.post('/emails/:id/move', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const { folder } = req.body;
    if (!folder) return res.status(400).json({ message: 'Folder is required', success: false });

    const email = await EmailMessage.findById(req.params.id);
    if (!email) return res.status(404).json({ message: 'Email not found', success: false });

    // Update folder in DB
    email.folder = folder;
    await email.save();

    // Optional: move on IMAP server
    // await ImapService.moveEmailOnServer(email.messageId, folder);

    res.status(200).json({ message: `Email moved to ${folder}`, success: true });
  } catch (err) {
    console.error('Error moving email:', err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});

// Move multiple emails at once
router.post('/emails/move', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const { emailIds, folder } = req.body; // emailIds = array of IDs
    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ message: 'No emails provided', success: false });
    }
    if (!folder) return res.status(400).json({ message: 'Folder is required', success: false });

    await EmailMessage.updateMany(
      { _id: { $in: emailIds } },
      { $set: { folder } }
    );

    // Optional: move in IMAP server using ImapService
    // for (const id of emailIds) await ImapService.moveEmailOnServer(id, folder);

    res.status(200).json({ message: `Moved ${emailIds.length} emails to ${folder}`, success: true });
  } catch (err) {
    console.error('Error moving emails:', err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
});





// ------------------ Export ------------------
module.exports = {
  router,
  ImapService,
};
