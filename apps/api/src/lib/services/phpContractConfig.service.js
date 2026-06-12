const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 5000;
const CONTRACT_CONFIG_PATH = 'node_contract_config.php';

let cachedContract = null;
let discoveryAttempted = false;

function trimSlashes(value, { trailing = true, leading = false } = {}) {
  let result = String(value || '').trim();
  if (trailing) result = result.replace(/\/+$/, '');
  if (leading) result = result.replace(/^\/+/, '');
  return result;
}

function getFallbackBaseUrl() {
  return trimSlashes(
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
  const value = Number(process.env.PHP_CONTRACT_CONFIG_TIMEOUT_MS || process.env.PHP_AUTHORIZATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function buildUrl(baseUrl, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${trimSlashes(baseUrl)}/${trimSlashes(path, { trailing: false, leading: true })}`;
}

function getConfigPaths() {
  const configured = String(process.env.PHP_CONTRACT_CONFIG_PATH || '').trim();
  const paths = configured
    ? [configured]
    : [CONTRACT_CONFIG_PATH, 'api/shared/node_contract_config.php'];
  return [...new Set(paths)];
}

function normalizeEndpointMap(endpoints) {
  if (!endpoints || typeof endpoints !== 'object' || Array.isArray(endpoints)) {
    return null;
  }

  const aliases = {
    lane: ['lane', 'laneAuthorize', 'authorizeLane', 'workflowLaneAuthorize', 'workflow_lane_authorize'],
    message: ['message', 'messageAuthorize', 'authorizeMessage', 'workflowMessageAuthorize', 'workflow_message_authorize'],
    attachment: [
      'attachment',
      'attachmentAuthorize',
      'authorizeAttachment',
      'workflowAttachmentAuthorize',
      'workflow_attachment_authorize',
    ],
    inboundRoute: ['inboundRoute', 'routeInboundEmail', 'workflowRouteInboundEmail', 'workflow_route_inbound_email'],
    communicationLookup: [
      'communicationLookup',
      'workflowCommunicationLookup',
      'workflow_communication_lookup',
      'laneLookup',
    ],
  };

  const normalized = {};
  Object.entries(aliases).forEach(([name, keys]) => {
    const value = keys.map((key) => endpoints[key]).find((candidate) => typeof candidate === 'string' && candidate.trim());
    if (value) normalized[name] = value.trim();
  });

  return normalized;
}

function validateContractConfig(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, reason: 'INVALID_JSON' };
  }

  if (!(data.status === 1 || data.status === '1' || data.status === true || data.success === true)) {
    return { valid: false, reason: data.reason || data.message || 'CONTRACT_STATUS_NOT_OK' };
  }

  const contractVersion = String(data.contractVersion || data.contract_version || '').trim();
  const contractBaseUrl = String(data.contractBaseUrl || data.contract_base_url || '').trim();
  const endpoints = normalizeEndpointMap(data.endpoints);

  if (!contractVersion) return { valid: false, reason: 'MISSING_CONTRACT_VERSION' };
  if (!contractBaseUrl) return { valid: false, reason: 'MISSING_CONTRACT_BASE_URL' };
  if (!endpoints || Object.keys(endpoints).length === 0) return { valid: false, reason: 'MISSING_ENDPOINTS' };

  return {
    valid: true,
    contract: {
      contractVersion,
      contractBaseUrl: trimSlashes(contractBaseUrl),
      endpoints,
    },
  };
}

function logContractConfig(event, fields = {}) {
  const level = fields.error || fields.valid === false ? 'warn' : 'info';
  console[level](JSON.stringify({ event, ...fields }));
}

async function fetchContractConfig() {
  const baseUrl = getFallbackBaseUrl();
  if (!baseUrl) {
    throw new Error('PHP contract base URL is not configured');
  }

  const token = getServiceToken();
  const headers = { Accept: 'application/json' };
  if (token) {
    headers['x-api-key'] = token;
    headers['x-service-token'] = token;
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError = null;
  for (const path of getConfigPaths()) {
    const url = buildUrl(baseUrl, path);
    try {
      const response = await axios.get(url, {
        timeout: getTimeoutMs(),
        headers,
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        lastError = new Error(`HTTP_${response.status}`);
        continue;
      }

      const validation = validateContractConfig(response.data);
      if (!validation.valid) {
        lastError = new Error(validation.reason);
        continue;
      }

      cachedContract = validation.contract;
      discoveryAttempted = true;
      return cachedContract;
    } catch (error) {
      lastError = error;
    }
  }

  discoveryAttempted = true;
  throw lastError || new Error('CONTRACT_DISCOVERY_FAILED');
}

async function initializeContractConfig() {
  try {
    const contract = await fetchContractConfig();
    logContractConfig('php_contract_discovered', {
      contractVersion: contract.contractVersion,
      contractBaseUrl: contract.contractBaseUrl,
      endpoints: contract.endpoints,
    });
    return contract;
  } catch (error) {
    cachedContract = null;
    logContractConfig('php_contract_discovery_failed', {
      valid: false,
      reason: error.message,
      fallbackBaseUrl: getFallbackBaseUrl() || null,
      error: error.message,
    });
    return null;
  }
}

function getCachedContractConfig() {
  return cachedContract;
}

function getContractEndpoint(name, envPath, fallbackPath) {
  const contractPath = cachedContract?.endpoints?.[name];
  return contractPath || envPath || fallbackPath;
}

function buildContractUrl(path) {
  const baseUrl = cachedContract?.contractBaseUrl || getFallbackBaseUrl();
  if (!baseUrl) {
    throw new Error('PHP contract base URL is not configured');
  }
  return buildUrl(baseUrl, path);
}

module.exports = {
  buildContractUrl,
  fetchContractConfig,
  getCachedContractConfig,
  getContractEndpoint,
  initializeContractConfig,
  validateContractConfig,
  wasContractDiscoveryAttempted: () => discoveryAttempted,
};
