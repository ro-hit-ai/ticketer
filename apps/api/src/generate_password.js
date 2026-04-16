// generate-password.js
const bcrypt = require('bcryptjs');

async function generatePasswordHash() {
  const password = '1234';
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  console.log('New Hashed Password:', hashedPassword);
}

generatePasswordHash();