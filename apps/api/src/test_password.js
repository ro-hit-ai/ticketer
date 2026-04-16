// test-password.js
const bcrypt = require('bcryptjs');

async function testPassword() {
  const storedHash = '$2b$10$8e9X5z2Qz7qK3p8y9vW2G.4X6Y7Z8A9B0C1D2E3F4G5H6I7J8K9L0'; // Replace with actual hash from DB
  const password = '1234';
  const isMatch = await bcrypt.compare(password, storedHash);
  console.log('Password Match:', isMatch);
}

testPassword();