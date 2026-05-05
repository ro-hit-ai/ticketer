const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    actor: {
      actorType: {
        type: String,
        enum: ['user', 'worker', 'system'],
        default: 'system',
      },
      actorId: { type: String, default: null, trim: true },
      actorEmail: { type: String, default: null, trim: true, lowercase: true },
      actorName: { type: String, default: null, trim: true },
    },
    entityType: { type: String, required: true, trim: true, index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    requestId: { type: String, default: null, trim: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

auditLogSchema.index({ eventType: 1, at: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
