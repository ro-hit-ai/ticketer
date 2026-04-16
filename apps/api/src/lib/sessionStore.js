// apps/api/src/lib/sessionStore.js
const jwt = require('jsonwebtoken');
const Session = require('../models/Session');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const JWT_EXPIRES_IN = '7d';

// Create a new session
async function createSession(userId, userAgent, ipAddress) {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  const session = new Session({
    userId,
    token,
    userAgent,
    ipAddress,
    createdAt: new Date(),
  });

  await session.save();
  return token;
}

// Delete a specific session
async function deleteSession(token) {
  await Session.deleteOne({ token });
}

// Delete all sessions for a user
async function deleteAllUserSessions(userId) {
  await Session.deleteMany({ userId });
}

// Get all sessions for a user
async function getUserSessions(userId) {
  return Session.find({ userId }).sort({ createdAt: -1 }).lean();
}

module.exports = {
  createSession,
  deleteSession,
  deleteAllUserSessions,
  getUserSessions,
};
