// // checkPassword.js
// const bcrypt = require('bcryptjs');

// const plainPasswords = ['12356', '123456'];
// const storedHash = '$2y$10$JPyh.ywTnSFkhu3ZRf9oOOi/CN3kOmbX0msOw3nbEfhl2WHTpme.O';
// const providedHash = '$2b$10$9rXDFswymyMT5mvQNbcA5.oDEvWisJBPRJbpISxvrRerlV/axuZyq';

// async function checkPassword() {
//   for (const password of plainPasswords) {
//     console.log(`Checking password: ${password}`);
//     console.log('Against stored hash:', await bcrypt.compare(password, storedHash));
//     console.log('Against provided hash:', await bcrypt.compare(password, providedHash));
//   }
// }

// checkPassword();