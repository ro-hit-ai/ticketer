function normalizeAppId(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : 'UNKNOWN';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSubject(thread, existingSubject = null) {
  const existing = typeof existingSubject === 'string' ? existingSubject.trim() : '';
  if (existing.startsWith('Re:')) {
    return existing;
  }

  const appId = normalizeAppId(thread?.sourceCaseId);
  const base = `GSS Verification Update – ${appId}`;
  return `[CONFIDENTIAL] ${base}`;
}

function verificationIssue({ appId, message }) {
  const normalizedAppId = normalizeAppId(appId);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />');

  return {
    subject: buildSubject({ sourceCaseId: normalizedAppId }),
    body: `
Hello,

We have identified discrepancies in your submitted documents.

Details:
${message}

Please review and upload correct documents.

⚠️ This communication is confidential.

Regards,
GSS Verification Team
    `,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <p>Hello,</p>
        <p>We have identified discrepancies in your submitted documents.</p>
        <p><strong>Details:</strong><br />${safeMessage}</p>
        <p>Please review and upload correct documents.</p>
        <p><strong>This communication is confidential.</strong></p>
        <p>Regards,<br />GSS Verification Team</p>
      </div>
    `,
  };
}

module.exports = {
  buildSubject,
  verificationIssue,
};
