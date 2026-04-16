const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function resetPassword() {
  const hash = await bcrypt.hash('newpassword123', 10);
  await User.updateOne({ email: 'admin@gmail.com' }, { password: hash });
  console.log("Password reset successfully!");
}
resetPassword();
