require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pp';
  await mongoose.connect(uri);

  const email = 'admin@vati.com';
  const plainPassword = 'Admin@123';
  const password = await bcrypt.hash(plainPassword, 10);

  const existing = await User.findOne({ email });

  if (existing) {
    existing.password = password;
    existing.isAdmin = true;
    existing.firstLogin = false;
    existing.external_user = false;
    await existing.save();
    console.log(`Updated admin user: ${email}`);
  } else {
    await User.create({
      email,
      password,
      name: 'System Admin',
      isAdmin: true,
      firstLogin: false,
      external_user: false,
      language: 'en',
    });
    console.log(`Created admin user: ${email}`);
  }

  console.log(`Login credentials => ${email} / ${plainPassword}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Failed to create admin user:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
