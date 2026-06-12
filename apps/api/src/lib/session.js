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
const WORKFLOW_JWT_ISSUER = 'gss-php';
const WORKFLOW_JWT_AUDIENCE = 'ticketer-workflow';

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.split(' ')[1] || null;
}

function getWorkflowJwtSecret() {
  return String(process.env.WORKFLOW_JWT_SECRET || '').trim();
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Validate JWT and fetch user with permissions
async function checkSession(req) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return null;
    }

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

async function checkWorkflowJwt(req) {
  try {
    const secret = getWorkflowJwtSecret();
    if (!secret) {
      return null;
    }

    const token = getBearerToken(req);
    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, secret, {
      issuer: WORKFLOW_JWT_ISSUER,
      audience: WORKFLOW_JWT_AUDIENCE,
    });

    if (decoded?.typ !== 'workflow') {
      return null;
    }

    const phpUserId = normalizePositiveInteger(decoded.phpUserId);
    const phpRole = normalizeNonEmptyString(decoded.phpRole);
    if (!phpUserId || !phpRole) {
      return null;
    }

    const phpClientId = normalizePositiveInteger(decoded.phpClientId) || 0;

    return {
      id: `php:${phpUserId}`,
      phpUserId,
      phpRole,
      phpClientId,
      isWorkflowPrincipal: true,
      permissions: [],
    };
  } catch (err) {
    return null;
  }
}


// Express middleware version
async function attachUser(req, res, next) {
  const user = await checkSession(req);
  if (user) {
    req.user = user;
    return next();
  }

  const workflowUser = await checkWorkflowJwt(req);
  if (workflowUser) {
    req.user = workflowUser;
  }

  next();
}

module.exports = {
  checkSession,
  checkWorkflowJwt,
  attachUser,
  createSession,
  deleteSession,
  deleteAllUserSessions,
  getUserSessions
};
