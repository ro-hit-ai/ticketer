const mongoose = require('mongoose');

const outboundEmailJobSchema = new mongoose.Schema(
  {
    idempotencyKey: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed', 'dead'],
      default: 'pending',
      index: true,
    },
    attempt: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    nextRetryAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastError: {
      type: String,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    payload: {
      threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread', required: true },
      sourceCaseId: { type: String, trim: true, uppercase: true, default: null },
      mailboxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mailbox', default: null },
      queueId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailQueue', required: true },
      senderName: { type: String, trim: true, default: null },
      senderEmail: { type: String, trim: true, lowercase: true, required: true },
      to: [{ type: String, trim: true, lowercase: true }],
      cc: [{ type: String, trim: true, lowercase: true }],
      bcc: [{ type: String, trim: true, lowercase: true }],
      subject: { type: String, trim: true, required: true },
      text: { type: String, default: '' },
      html: { type: String, default: '' },
      inReplyTo: { type: String, trim: true, default: null },
      references: [{ type: String, trim: true }],
      headers: { type: mongoose.Schema.Types.Mixed, default: {} },
      sentByUserId: { type: String, trim: true, default: null },
      sentByRole: { type: String, trim: true, default: null },
      recipientUserId: { type: String, trim: true, default: null },
      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    result: {
      messageId: { type: String, default: null },
      queueName: { type: String, default: null },
    },
  },
  { timestamps: true }
);

outboundEmailJobSchema.index({ status: 1, nextRetryAt: 1, lockedAt: 1 });
outboundEmailJobSchema.index({ 'payload.threadId': 1, createdAt: -1 });

module.exports = mongoose.models.OutboundEmailJob || mongoose.model('OutboundEmailJob', outboundEmailJobSchema);
