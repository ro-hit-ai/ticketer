function normalizeApplicationId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function extractApplicationIdFromSubject(subject) {
  const value = String(subject || '');
  const match = value.match(/\[(APP-\d+)\]/i);
  return match?.[1] ? normalizeApplicationId(match[1]) : null;
}

function ensureApplicationIdInSubject(subject, applicationId) {
  const normalizedApplicationId = normalizeApplicationId(applicationId);
  const rawSubject = typeof subject === 'string' ? subject.trim() : '';

  if (!normalizedApplicationId) {
    return rawSubject || null;
  }

  if (extractApplicationIdFromSubject(rawSubject)) {
    return rawSubject;
  }

  const prefix = `[${normalizedApplicationId}]`;
  return rawSubject ? `${prefix} ${rawSubject}` : prefix;
}

module.exports = {
  ensureApplicationIdInSubject,
  extractApplicationIdFromSubject,
  normalizeApplicationId,
};
