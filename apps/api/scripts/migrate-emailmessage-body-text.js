const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const EmailMessage = require('../src/models/EmailMessage');

function toPlainText(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function looksLikeHtml(value) {
  if (typeof value !== 'string') return false;
  return /<\/?[a-z][\s\S]*>/i.test(value) || /&nbsp;|&amp;|&lt;|&gt;/i.test(value);
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/peppermint';
  await mongoose.connect(mongoUri);

  console.log(`Connected to MongoDB: ${mongoUri}`);

  const cursor = EmailMessage.find(
    { body: { $type: 'string', $ne: '' } },
    { _id: 1, body: 1, subject: 1, folder: 1 }
  ).cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for await (const email of cursor) {
    scanned += 1;

    if (!looksLikeHtml(email.body)) {
      skipped += 1;
      continue;
    }

    const plainText = toPlainText(email.body);
    if (!plainText || plainText === email.body) {
      skipped += 1;
      continue;
    }

    await EmailMessage.updateOne(
      { _id: email._id },
      {
        $set: {
          body: plainText,
        },
      }
    );

    updated += 1;

    if (updated % 100 === 0) {
      console.log(`Updated ${updated} emails so far...`);
    }
  }

  console.log(`Migration complete. scanned=${scanned} updated=${updated} skipped=${skipped}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Migration failed:', error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore disconnect errors during failure
  }
  process.exit(1);
});
