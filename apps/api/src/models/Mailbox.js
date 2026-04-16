const mongoose = require('mongoose');

const mailboxSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    emailAddress: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    isShared: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
    emailQueueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailQueue',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

mailboxSchema.index({ emailAddress: 1 }, { unique: true });
mailboxSchema.index({ slug: 1 }, { unique: true, sparse: true });
mailboxSchema.index({ isActive: 1, isShared: 1 });

module.exports = mongoose.models.Mailbox || mongoose.model('Mailbox', mailboxSchema);
