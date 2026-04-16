const User = require('../models/User');
const Config = require('../models/Config');

class InsufficientPermissionsError extends Error {
  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'InsufficientPermissionsError';
  }
}

function normalizeRequiredPermissions(requiredPermissions) {
  if (!requiredPermissions) return [];
  if (Array.isArray(requiredPermissions)) {
    return requiredPermissions.filter(Boolean);
  }
  return [requiredPermissions];
}

function collectPermissions(user) {
  const userPermissions = new Set();

  if (Array.isArray(user?.permissions)) {
    user.permissions.forEach((perm) => userPermissions.add(perm));
  }

  if (Array.isArray(user?.roles)) {
    user.roles.forEach((role) => {
      if (Array.isArray(role?.permissions)) {
        role.permissions.forEach((perm) => userPermissions.add(perm));
      }
    });
  }

  return userPermissions;
}

// Check if user has required permissions
function hasPermission(user, requiredPermissions, requireAll = true) {
  if (!user) return false;
  if (user.isAdmin) return true;

  const required = normalizeRequiredPermissions(requiredPermissions);
  if (required.length === 0) return true;

  const permissions = collectPermissions(user);
  if (permissions.has('*')) return true;

  return requireAll
    ? required.every((perm) => permissions.has(perm))
    : required.some((perm) => permissions.has(perm));
}

function requirePermission(requiredPermissions, requireAll = true) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: missing authenticated user context',
        });
      }

      // Allow when no permissions are explicitly required
      const required = normalizeRequiredPermissions(requiredPermissions);
      if (required.length === 0) {
        return next();
      }

      // Admin and wildcard bypass
      if (req.user.isAdmin || (Array.isArray(req.user.permissions) && req.user.permissions.includes('*'))) {
        return next();
      }

      // Fetch fresh user+roles for up-to-date permissions
      const userWithRoles = await User.findById(req.user._id).populate('roles').lean().exec();
      if (!userWithRoles) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: user not found',
        });
      }

      // Merge token-level permissions (if present) with DB role permissions
      userWithRoles.permissions = Array.from(
        new Set([...(req.user.permissions || []), ...(userWithRoles.permissions || [])])
      );

      const config = await Config.findOne({}).lean().exec();
      const rolesActive = Boolean(config?.roles_active);

      if (!rolesActive) {
        return next();
      }

      if (!hasPermission(userWithRoles, required, requireAll)) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: missing required permission(s): ${required.join(', ')}`,
        });
      }

      return next();
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal Server Error while checking permissions',
      });
    }
  };
}

module.exports = {
  InsufficientPermissionsError,
  hasPermission,
  requirePermission,
};
