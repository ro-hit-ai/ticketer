const axios = require('axios');

const ACCESS_SCOPE_PATH = '/api/shared/my_assigned_applications.php';

function getPhpBaseUrl() {
  const raw = process.env.APP_URL || process.env.PHP_APP_URL || '';
  return raw.replace(/\/+$/, '');
}

function getAccessScopeUrl() {
  const baseUrl = getPhpBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}${ACCESS_SCOPE_PATH}`;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeScopeItem(item = {}) {
  return {
    applicationId: typeof item.applicationId === 'string' ? item.applicationId.trim().toUpperCase() : null,
    caseId: item.caseId ?? null,
    currentRoleForUser: item.currentRoleForUser || null,
    currentStage: item.currentStage || null,
    accessReason: item.accessReason || null,
  };
}

function normalizeScopeResponse(payload = {}) {
  const root = normalizeObject(payload);
  const rawItems = normalizeArray(root.data);
  const items = rawItems
    .map((item) => normalizeScopeItem(normalizeObject(item)))
    .filter((item) => item.applicationId);

  return {
    applicationIds: Array.from(new Set(items.map((item) => item.applicationId))),
    items,
    scopeSource: 'php_assigned_applications',
    scopeDebug: {
      status: root.status ?? null,
      message: root.message || null,
      itemCount: items.length,
    },
  };
}

async function fetchAssignedApplications(req = null) {
  const url = getAccessScopeUrl();
  if (!url) {
    return {
      applicationIds: [],
      items: [],
      scopeSource: 'php_assigned_applications',
      scopeDebug: {
        status: null,
        message: 'APP_URL is not configured',
        itemCount: 0,
      },
    };
  }

  try {
    const response = await axios.get(url, {
      headers: {
        Cookie: req?.headers?.cookie || '',
        Authorization: req?.headers?.authorization || '',
        'User-Agent': req?.headers?.['user-agent'] || 'MintLeaf API',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      withCredentials: true,
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        applicationIds: [],
        items: [],
        scopeSource: 'php_assigned_applications',
        scopeDebug: {
          status: response.status,
          statusCode: response.status,
          message: 'PHP access scope request failed',
          itemCount: 0,
        },
      };
    }

    const normalized = normalizeScopeResponse(response.data);
    return {
      ...normalized,
      scopeDebug: {
        ...normalized.scopeDebug,
        statusCode: response.status,
      },
    };
  } catch (error) {
    return {
      applicationIds: [],
      items: [],
      scopeSource: 'php_assigned_applications',
      scopeDebug: {
        status: null,
        message: error.message,
        itemCount: 0,
      },
    };
  }
}

module.exports = {
  fetchAssignedApplications,
};
