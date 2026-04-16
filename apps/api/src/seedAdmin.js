// seedAdmin.js
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User"); // adjust path if models are in another folder

async function seedAdmin() {
  try {
    // connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/peppermint");

    // check if admin already exists
    const existing = await User.findOne({ email: "admin1@gmail.com" });
    if (existing) {
      console.log("⚠️ Admin already exists with email:", existing.email);
      process.exit(0);
    }

    // hash the password
    const hashedPassword = await bcrypt.hash("1234567", 10);

    // create admin user
    const admin = await User.create({
      email: "admin1@gmail.com",
      password: hashedPassword,
      name: "Admin User",
      isAdmin: true,
      language: "en",
      notify_ticket_created: true,
      notify_ticket_status_changed: true,
      notify_ticket_comments: true,
      notify_ticket_assigned: true,
      firstLogin: true,
      external_user: false
    });

    console.log("✅ Admin user created:", admin.email);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding admin:", err.message);
    process.exit(1);
  }
}

seedAdmin();
