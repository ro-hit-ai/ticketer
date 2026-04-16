// apps/api/src/lib/session.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const {
  createSession,
  deleteSession,
  deleteAllUserSessions,
  getUserSessions
} = require('./sessionStore'); // handles DB ops only

const { getJwtSecret } = require('./jwtSecret');
const JWT_SECRET = getJwtSecret() || 'supersecretkey123';

// Validate JWT and fetch user with permissions
async function checkSession(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const userId = decoded.data?.id || decoded.userId;
    if (!userId) {
      return null;
    }

    const user = await User.findById(userId).populate('roles').exec();
    if (!user) {
      return null;
    }

    const resolvedRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
    const roleNames = resolvedRoles
      .map((role) => (typeof role?.name === 'string' ? role.name.trim() : ''))
      .filter(Boolean);
    const isAgent = roleNames.some((roleName) => roleName.toLowerCase() === 'agent');
    const rolePermissions = resolvedRoles.flatMap((role) =>
      Array.isArray(role.permissions) ? role.permissions : []
    );
    const permissions = new Set(rolePermissions);

    if (user.isAdmin) {
      permissions.add('*');
    }

    req.user = {
      _id: user._id,
      id: user._id,
      email: user.email,
      isAdmin: user.isAdmin,
      isAgent,
      roles: resolvedRoles,
      permissions: Array.from(permissions),
    };

    return req.user;
  } catch (err) {
    return null;
  }
}


// Express middleware version
async function attachUser(req, res, next) {
  const user = await checkSession(req);
  if (user) {
    req.user = user;
  }
  next();
}

module.exports = {
  checkSession,
  attachUser,
  createSession,
  deleteSession,
  deleteAllUserSessions,
  getUserSessions
};
