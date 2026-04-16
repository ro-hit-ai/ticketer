const mongoose = require("mongoose");

const EmailMessageSchema = new mongoose.Schema({
  mailbox: { type: mongoose.Schema.Types.ObjectId, ref: "EmailQueue", required: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: "Thread", default: null, index: true },
  sourceCaseId: { type: String, trim: true, uppercase: true, default: null, index: true },
  direction: { type: String, enum: ["inbound", "outbound"], default: "inbound", index: true },
  messageId: { type: String, index: true }, // IMAP UID or Gmail messageId
  inReplyTo: { type: String, trim: true, default: null, index: true },
  references: [{ type: String, trim: true }],
  headers: { type: mongoose.Schema.Types.Mixed, default: {} },
  sentByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  sentByRole: { type: String, trim: true, default: null },
  recipientUserId: { type: String, trim: true, default: null },
  // folder: { type: String, enum: ["inbox", "sent", "received", "drafts", "trash"], default: "inbox" },
  folder: {
     type: String,
     enum: ["inbox", "sent", "received", "drafts", "trash", "resolved", "internal"],
     default: "inbox"
  },
  subject: String,
  body: String,
  from: String,
  to: [String],
  cc: [String],
  bcc: [String],
  date: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
  attachments: [
    {
      filename: String,
      contentType: String,
      size: Number,
      url: String, // if stored in S3/GridFS
    }
  ]
}, { timestamps: true });

EmailMessageSchema.index(
  { mailbox: 1, messageId: 1 },
  { unique: true, partialFilterExpression: { messageId: { $type: "string" } } }
);
EmailMessageSchema.index({ threadId: 1, date: -1 });
EmailMessageSchema.index({ sourceCaseId: 1, date: -1 });
EmailMessageSchema.index({ inReplyTo: 1 });
EmailMessageSchema.index({ references: 1 });

module.exports = mongoose.model("EmailMessage", EmailMessageSchema);
