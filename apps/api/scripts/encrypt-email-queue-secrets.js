require('dotenv').config();

const mongoose = require('mongoose');
const EmailQueue = require('../src/models/EmailQueue');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/peppermint', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const queues = await EmailQueue.find({});
  let updated = 0;

  for (const queue of queues) {
    queue.markModified('password');
    queue.markModified('clientSecret');
    queue.markModified('accessToken');
    queue.markModified('refreshToken');
    await queue.save();
    updated += 1;
  }

  console.log(`Encrypted email queue secrets for ${updated} queue(s).`);
}

main()
  .catch((error) => {
    console.error('Failed to encrypt email queue secrets:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
