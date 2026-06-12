const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function getEncryptionKey() {
  const rawKey = process.env.MAIL_CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!rawKey) {
    throw new Error('MAIL_CREDENTIAL_ENCRYPTION_KEY is required to store email credentials');
  }
  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(value) {
  if (value == null || value === '') return value;
  if (isEncryptedSecret(value)) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (value == null || value === '') return value;
  if (!isEncryptedSecret(value)) return value;

  const parts = String(value).slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }

  const [ivRaw, tagRaw, encryptedRaw] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivRaw, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
};
