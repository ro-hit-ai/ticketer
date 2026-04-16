const mongoose = require('mongoose');

function normalizeSourceCaseId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

const ALLOWED_ACTIVATION_TRIGGERS = new Set(['system_issue', 'agent', 'candidate_email', 'unknown']);

const threadSchema = new mongoose.Schema(
  {
    sourceCaseId: {
      type: String,
      required: true,
      trim: true,
      set: normalizeSourceCaseId,
    },
    subject: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ['monitoring', 'active', 'open', 'pending', 'closed', 'archived'],
      default: 'open',
    },
    channel: {
      type: String,
      enum: ['email', 'internal', 'mixed'],
      default: 'mixed',
    },
    mailboxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mailbox',
      default: null,
    },
    applicantEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    workflowSnapshot: {
      currentRole: {
        type: String,
        trim: true,
        default: null,
      },
      currentUserId: {
        type: String,
        trim: true,
        default: null,
      },
      currentUserName: {
        type: String,
        trim: true,
        default: null,
      },
      assignedAt: {
        type: Date,
        default: null,
      },
      assignmentSource: {
        type: String,
        trim: true,
        default: null,
      },
      lastEventId: {
        type: String,
        trim: true,
        default: null,
      },
    },
    lastAssignedUserId: {
      type: String,
      trim: true,
      default: null,
    },
    linkSentAt: {
      type: Date,
      default: null,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    activationTrigger: {
      type: String,
      enum: ['system_issue', 'agent', 'candidate_email', 'unknown'],
      default: undefined,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    claimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    currentStage: {
      type: String,
      trim: true,
      default: null,
    },
    lastMessage: {
      type: String,
      trim: true,
      default: null,
    },
    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isMapped: {
      type: Boolean,
      default: true,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

threadSchema.pre('validate', function normalizeBeforeValidate(next) {
  if (this.sourceCaseId) {
    this.sourceCaseId = normalizeSourceCaseId(this.sourceCaseId);
  }

  // Clean up legacy/bad values so enum validation doesn't break unrelated saves.
  if (this.activationTrigger === null || this.activationTrigger === undefined || this.activationTrigger === '') {
    this.activationTrigger = undefined;
  } else if (!ALLOWED_ACTIVATION_TRIGGERS.has(this.activationTrigger)) {
    this.activationTrigger = undefined;
  }

  next();
});

threadSchema.index({ sourceCaseId: 1 }, { unique: true });
threadSchema.index({ mailboxId: 1, updatedAt: -1 });
threadSchema.index({ lastMessageAt: -1 });
threadSchema.index({ ticketId: 1 }, { sparse: true });
threadSchema.index({ claimedBy: 1, status: 1 });
threadSchema.index({ lastAssignedUserId: 1 });

module.exports = mongoose.models.Thread || mongoose.model('Thread', threadSchema);
