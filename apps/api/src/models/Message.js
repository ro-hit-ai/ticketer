const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    type: {
      type: String,
      enum: ['user', 'system', 'external'],
      default: 'external',
    },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    threadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Thread',
      required: true,
      index: true,
    },
    sourceCaseId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      default: null,
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound', 'internal'],
      required: true,
    },
    channel: {
      type: String,
      enum: ['email', 'internal'],
      default: 'email',
    },
    sender: {
      type: participantSchema,
      required: true,
    },
    sentByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    sentByRole: {
      type: String,
      trim: true,
      default: null,
    },
    recipientUserId: {
      type: String,
      trim: true,
      default: null,
    },
    recipients: {
      to: [{ type: String, trim: true, lowercase: true }],
      cc: [{ type: String, trim: true, lowercase: true }],
      bcc: [{ type: String, trim: true, lowercase: true }],
    },
    subject: {
      type: String,
      trim: true,
      default: null,
    },
    body: {
      type: String,
      required: true,
    },
    bodyHtml: {
      type: String,
      default: null,
    },
    externalMessageId: {
      type: String,
      trim: true,
      default: null,
    },
    emailMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailMessage',
      default: null,
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'delivered', 'received', 'failed'],
      default: 'sent',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

messageSchema.index({ threadId: 1, createdAt: 1 });
messageSchema.index(
  { threadId: 1, externalMessageId: 1 },
  { unique: true, partialFilterExpression: { externalMessageId: { $type: 'string' } } }
);
messageSchema.index({ mailboxId: 1, createdAt: -1 });

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);
