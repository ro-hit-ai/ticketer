const axios = require('axios');
const {
  buildContractUrl,
  getContractEndpoint,
} = require('./phpContractConfig.service');

const DEFAULT_TIMEOUT_MS = 5000;

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getPhpBaseUrl() {
  return trimTrailingSlash(
    process.env.PHP_CONTRACT_BASE_URL ||
      process.env.PHP_AUTHORIZATION_BASE_URL ||
      process.env.PHP_APP_URL ||
      process.env.APP_URL
  );
}

function getServiceToken() {
  return String(
    process.env.PHP_CONTRACT_SERVICE_TOKEN ||
      process.env.PHP_AUTHORIZATION_SERVICE_TOKEN ||
      process.env.PHP_API_KEY ||
      ''
  ).trim();
}

function getTimeoutMs() {
  const value = Number(process.env.PHP_AUTHORIZATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function isShadowModeEnabled() {
  return String(process.env.PHP_AUTHORIZATION_SHADOW_MODE || 'false').toLowerCase() === 'true';
}

function endpointPath(name, fallback) {
  const envName = `PHP_AUTHORIZATION_${name.toUpperCase()}_PATH`;
  const configured = String(process.env[envName] || '').trim();
  return getContractEndpoint(name, configured, fallback);
}

function buildUrl(path) {
  return buildContractUrl(path);
}

function isWorkflowPrincipal(req) {
  return req?.user?.isWorkflowPrincipal === true;
}

function normalizePositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function getUserId(req, explicitUserId = null) {
  if (isWorkflowPrincipal(req)) {
    return normalizePositiveInteger(req?.user?.phpUserId);
  }

  return String(explicitUserId || req?.user?._id || req?.user?.id || '').trim() || null;
}

function missingPhpUserDecision(kind, payload) {
  const decision = {
    allowed: false,
    requestSucceeded: false,
    statusCode: 403,
    reason: 'MISSING_PHP_USER_ID',
    raw: null,
  };

  logAuthorization(kind, {
    ...payload,
    phpDecision: false,
    reason: decision.reason,
    statusCode: decision.statusCode,
  });

  return decision;
}

function normalizeApplicationId(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function normalizeComponentKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeRole(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeThreadId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractLaneContext(thread = {}, overrides = {}) {
  const metadata = thread?.metadata && typeof thread.metadata === 'object' ? thread.metadata : {};
  const workflow = metadata.workflow && typeof metadata.workflow === 'object' ? metadata.workflow : {};

  return {
    userId: overrides.userId || null,
    applicationId: normalizeApplicationId(
      overrides.applicationId ||
        thread.sourceCaseId ||
        metadata.applicationId ||
        metadata.sourceCaseId ||
        workflow.applicationId ||
        workflow.sourceCaseId
    ),
    componentKey: normalizeComponentKey(
      overrides.componentKey ||
        thread.componentKey ||
        workflow.componentKey ||
        workflow.component_key ||
        metadata.componentKey ||
        metadata.component_key
    ),
    ownerRole: normalizeRole(
      overrides.ownerRole ||
        thread.ownerRole ||
        thread.threadOwnerRole ||
        workflow.ownerRole ||
        workflow.threadOwnerRole ||
        workflow.thread_owner_role ||
        workflow.senderRole ||
        metadata.ownerRole ||
        metadata.threadOwnerRole ||
        metadata.thread_owner_role ||
        thread.workflowSnapshot?.currentRole
    ),
    threadId: normalizeThreadId(
      overrides.threadId ||
        thread.phpThreadId ||
        thread.workflowThreadId ||
        thread.workflow_thread_id ||
        thread.thread_id ||
        metadata.phpThreadId ||
        metadata.workflowThreadId ||
        metadata.workflow_thread_id ||
        metadata.threadId ||
        metadata.thread_id ||
        workflow.threadId ||
        workflow.thread_id
    ),
  };
}

function logMissingLaneIdentifier(kind, payload) {
  if (payload.threadId) return;

  logAuthorization('missing_lane_identifier', {
    authorizationKind: kind,
    userId: payload.userId || null,
    applicationId: payload.applicationId || null,
    componentKey: payload.componentKey || null,
    ownerRole: payload.ownerRole || null,
    messageId: payload.messageId || null,
    attachmentId: payload.attachmentId || null,
    ticketId: payload.ticketId || null,
    reason: 'MISSING_PHP_THREAD_ID',
  });
}

function normalizeDecision(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { allowed: false, reason: 'EMPTY_OR_INVALID_RESPONSE', raw: data || null };
  }

  if (data.status === 0 || data.status === '0' || data.success === false) {
    return {
      allowed: false,
      reason: data.reason || data.message || 'PHP_DENIED',
      raw: data,
    };
  }

  const requestSucceeded =
    data.status === 1 ||
    data.status === '1' ||
    data.success === true;

  const allowed =
    data.allowed === true ||
    data.authorized === true;

  return {
    allowed,
    requestSucceeded,
    reason: data.reason || data.message || (allowed ? 'PHP_ALLOWED' : 'PHP_DENIED'),
    raw: data,
  };
}

function logAuthorization(kind, fields = {}) {
  const payload = {
    event: `php_${kind}_authorization`,
    shadowMode: isShadowModeEnabled(),
    ...fields,
  };
  const level = fields.error || fields.phpDecision === false ? 'warn' : 'info';
  console[level](JSON.stringify(payload));
}

async function callAuthorizationEndpoint(kind, path, payload) {
  const startedAt = Date.now();

  try {
    const token = getServiceToken();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['x-api-key'] = token;
      headers['x-service-token'] = token;
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await axios.post(buildUrl(path), payload, {
      timeout: getTimeoutMs(),
      headers,
      validateStatus: () => true,
    });

    const decision = normalizeDecision(response.data);
    if (response.status < 200 || response.status >= 300) {
      decision.allowed = false;
      decision.reason = decision.reason || `HTTP_${response.status}`;
    }

    logAuthorization(kind, {
      ...payload,
      phpDecision: decision.allowed,
      reason: decision.reason,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    });

    return decision;
  } catch (error) {
    const decision = {
      allowed: false,
      reason: error.code === 'ECONNABORTED' ? 'PHP_AUTH_TIMEOUT' : 'PHP_AUTH_UNAVAILABLE',
      error: error.message,
      raw: null,
    };

    logAuthorization(kind, {
      ...payload,
      phpDecision: false,
      reason: decision.reason,
      error: error.message,
      durationMs: Date.now() - startedAt,
    });

    return decision;
  }
}

async function authorizeLane(req, input = {}) {
  const payload = {
    userId: getUserId(req, input.userId),
    applicationId: normalizeApplicationId(input.applicationId),
    componentKey: normalizeComponentKey(input.componentKey),
    ownerRole: normalizeRole(input.ownerRole),
    threadId: input.threadId ? String(input.threadId) : null,
    accessType: input.accessType || 'read',
  };

  logMissingLaneIdentifier('lane', payload);

  if (isWorkflowPrincipal(req) && !payload.userId) {
    return missingPhpUserDecision('lane', payload);
  }

  return callAuthorizationEndpoint(
    'lane',
    endpointPath('lane', '/api/shared/workflow_lane_authorize.php'),
    payload
  );
}

async function authorizeMessage(req, input = {}) {
  const payload = {
    userId: getUserId(req, input.userId),
    applicationId: normalizeApplicationId(input.applicationId),
    componentKey: normalizeComponentKey(input.componentKey),
    ownerRole: normalizeRole(input.ownerRole),
    threadId: input.threadId ? String(input.threadId) : null,
    messageId: input.messageId ? String(input.messageId) : null,
    sourceMessageKey: input.sourceMessageKey ? String(input.sourceMessageKey) : null,
    accessType: input.accessType || 'read',
  };

  logMissingLaneIdentifier('message', payload);

  if (isWorkflowPrincipal(req) && !payload.userId) {
    return missingPhpUserDecision('message', payload);
  }

  return callAuthorizationEndpoint(
    'message',
    endpointPath('message', '/api/shared/workflow_message_authorize.php'),
    payload
  );
}

async function authorizeAttachment(req, input = {}) {
  const payload = {
    userId: getUserId(req, input.userId),
    applicationId: normalizeApplicationId(input.applicationId),
    componentKey: normalizeComponentKey(input.componentKey),
    ownerRole: normalizeRole(input.ownerRole),
    threadId: input.threadId ? String(input.threadId) : null,
    messageId: input.messageId ? String(input.messageId) : null,
    sourceMessageKey: input.sourceMessageKey ? String(input.sourceMessageKey) : null,
    attachmentId: input.attachmentId ? String(input.attachmentId) : null,
    ticketId: input.ticketId ? String(input.ticketId) : null,
    accessType: input.accessType || 'read',
  };

  logMissingLaneIdentifier('attachment', payload);

  if (isWorkflowPrincipal(req) && !payload.userId) {
    return missingPhpUserDecision('attachment', payload);
  }

  return callAuthorizationEndpoint(
    'attachment',
    endpointPath('attachment', '/api/shared/workflow_attachment_authorize.php'),
    payload
  );
}

function mergeAuthorizationDecision({ nodeDecision, phpDecision, shadowLog }) {
  logAuthorization('comparison', {
    ...shadowLog,
    nodeDecision: Boolean(nodeDecision?.allowed),
    phpDecision: Boolean(phpDecision?.allowed),
    reason: phpDecision?.reason || null,
    mismatch: Boolean(nodeDecision?.allowed) !== Boolean(phpDecision?.allowed),
  });

  if (isShadowModeEnabled()) {
    return nodeDecision;
  }

  return phpDecision;
}

module.exports = {
  authorizeAttachment,
  authorizeLane,
  authorizeMessage,
  extractLaneContext,
  isShadowModeEnabled,
  mergeAuthorizationDecision,
};
