const AuditLog = require('../../models/AuditLog');

async function emitAuditLog({
  eventType,
  actor = {},
  entityType,
  entityId,
  requestId = null,
  metadata = {},
}) {
  if (!eventType || !entityType || !entityId) {
    return null;
  }

  return AuditLog.create({
    eventType,
    actor: {
      actorType: actor.actorType || 'system',
      actorId: actor.actorId || null,
      actorEmail: actor.actorEmail || null,
      actorName: actor.actorName || null,
    },
    entityType,
    entityId: String(entityId),
    requestId,
    metadata,
    at: new Date(),
  });
}

module.exports = { emitAuditLog };
