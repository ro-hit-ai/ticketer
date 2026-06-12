const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const axios = require('axios');
const mongoose = require('mongoose');
const {
  buildContractUrl,
  getContractEndpoint,
  initializeContractConfig,
} = require('../src/lib/services/phpContractConfig.service');

const APPLY = process.argv.includes('--apply');
const RUN_ID = `lane-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const ROLLBACK_DIR = path.resolve(__dirname, '../tmp');
const ROLLBACK_FILE = path.join(ROLLBACK_DIR, `${RUN_ID}-rollback.json`);
const DEFAULT_TIMEOUT_MS = 5000;
const phpLookupStats = {
  attempts: 0,
  recovered: 0,
  ambiguous: 0,
  noMatch: 0,
  errors: 0,
  byType: {},
  byStatus: {},
};

const OWNER_ROLE_ALIASES = {
  team_lead: 'qa',
  teamlead: 'qa',
  db_verifier: 'verifier',
  dbverifier: 'verifier',
};

const ALLOWED_OWNER_ROLES = new Set([
  'qa',
  'verifier',
  'validator',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeApplicationId(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeComponentKey(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeOwnerRole(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const key = normalized.toLowerCase().replace(/[\s-]+/g, '_');
  const aliased = OWNER_ROLE_ALIASES[key] || key;

  if (!ALLOWED_OWNER_ROLES.has(aliased)) {
    return null;
  }

  return aliased;
}

function normalizeMessageId(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/^<|>$/g, '').trim() : null;
}

function extractMessageIds(value) {
  const normalized = normalizeString(value);
  if (!normalized) return [];

  const bracketed = Array.from(normalized.matchAll(/<([^>]+)>/g)).map((match) => normalizeMessageId(match[1]));
  if (bracketed.length > 0) {
    return Array.from(new Set(bracketed.filter(Boolean)));
  }

  return Array.from(new Set(normalized.split(/\s+/).map(normalizeMessageId).filter(Boolean)));
}

function getPath(object, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current && current[key], object);
}

function firstPath(object, paths, normalizer = normalizeString) {
  for (const dottedPath of paths) {
    const value = normalizer(getPath(object, dottedPath));
    if (value) {
      return { value, path: dottedPath };
    }
  }
  return { value: null, path: null };
}

function buildPhpThreadId({ applicationId, componentKey, ownerRole }) {
  if (!applicationId || !componentKey || !ownerRole) return null;
  return `wf:${applicationId}:${componentKey}:${ownerRole}`;
}

function parsePhpThreadId(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const match = normalized.match(/^wf:([^:]+):([^:]+):([^:]+)$/i);
  if (!match) return null;

  const applicationId = normalizeApplicationId(match[1]);
  const componentKey = normalizeComponentKey(match[2]);
  const ownerRole = normalizeOwnerRole(match[3]);
  const phpThreadId = buildPhpThreadId({ applicationId, componentKey, ownerRole });

  return phpThreadId ? { applicationId, componentKey, ownerRole, phpThreadId } : null;
}

function normalizePhpThreadLookupValue(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return parsePhpThreadId(normalized) ? normalized : null;
}

function getRecordThreadLookupValue(record) {
  return normalizePhpThreadLookupValue(record.phpThreadId) ||
    normalizePhpThreadLookupValue(record.threadId) ||
    normalizePhpThreadLookupValue(record.thread_id) ||
    normalizePhpThreadLookupValue(record.metadata?.phpThreadId) ||
    normalizePhpThreadLookupValue(record.metadata?.threadId) ||
    normalizePhpThreadLookupValue(record.metadata?.thread_id) ||
    normalizePhpThreadLookupValue(record.metadata?.workflow?.phpThreadId) ||
    normalizePhpThreadLookupValue(record.metadata?.workflow?.threadId) ||
    normalizePhpThreadLookupValue(record.metadata?.workflow?.thread_id) ||
    normalizePhpThreadLookupValue(record.metadata?.laneBackfill?.phpThreadId) ||
    null;
}

function getLaneEvidence(record) {
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const workflow = metadata.workflow && typeof metadata.workflow === 'object' ? metadata.workflow : {};
  const parsedThreadId = parsePhpThreadId(getRecordThreadLookupValue(record));
  const merged = {
    ...record,
    metadata,
    workflow,
    parsedThreadId,
  };

  const application = firstPath(merged, [
    'sourceCaseId',
    'metadata.applicationId',
    'metadata.sourceCaseId',
    'metadata.workflow.applicationId',
    'metadata.workflow.sourceCaseId',
    'workflow.applicationId',
    'workflow.sourceCaseId',
    'parsedThreadId.applicationId',
  ], normalizeApplicationId);

  const component = firstPath(merged, [
    'componentKey',
    'metadata.componentKey',
    'metadata.component_key',
    'metadata.workflow.componentKey',
    'metadata.workflow.component_key',
    'workflow.componentKey',
    'workflow.component_key',
    'parsedThreadId.componentKey',
  ], normalizeComponentKey);

  const owner = firstPath(merged, [
    'ownerRole',
    'threadOwnerRole',
    'thread_owner_role',
    'metadata.ownerRole',
    'metadata.threadOwnerRole',
    'metadata.thread_owner_role',
    'metadata.workflow.ownerRole',
    'metadata.workflow.threadOwnerRole',
    'metadata.workflow.thread_owner_role',
    'metadata.workflow.senderRole',
    'workflow.ownerRole',
    'workflow.threadOwnerRole',
    'workflow.thread_owner_role',
    'workflow.senderRole',
    'sentByRole',
    'parsedThreadId.ownerRole',
  ], normalizeOwnerRole);

  return {
    applicationId: application.value,
    applicationSource: application.path,
    componentKey: component.value,
    componentSource: component.path,
    ownerRole: owner.value,
    ownerSource: owner.path,
    phpThreadId: buildPhpThreadId({
      applicationId: application.value,
      componentKey: component.value,
      ownerRole: owner.value,
    }),
  };
}

function hasTrustedLane(record) {
  return Boolean(
    normalizeString(record?.phpThreadId) &&
    normalizeComponentKey(record?.componentKey) &&
    normalizeOwnerRole(record?.ownerRole)
  );
}

function getMessageLookupInput(message, emailMessage = null) {
  const threadId = getRecordThreadLookupValue(message);
  const emailHeaders = emailMessage?.headers && typeof emailMessage.headers === 'object' ? emailMessage.headers : {};
  const parentMessageIds = [
    normalizeMessageId(message.inReplyTo),
    normalizeMessageId(message.in_reply_to),
    normalizeMessageId(message.metadata?.inReplyTo),
    normalizeMessageId(message.metadata?.in_reply_to),
    normalizeMessageId(emailMessage?.inReplyTo),
    normalizeMessageId(emailMessage?.in_reply_to),
    normalizeMessageId(emailHeaders['in-reply-to']),
    normalizeMessageId(emailHeaders['In-Reply-To']),
    ...extractMessageIds(Array.isArray(message.references) ? message.references.join(' ') : message.references),
    ...extractMessageIds(message.metadata?.references),
    ...extractMessageIds(emailMessage?.references),
    ...extractMessageIds(emailHeaders.references || emailHeaders.References),
  ].filter(Boolean);
  const sourceMessageKey =
    normalizeString(message.sourceMessageKey) ||
    normalizeString(message.source_message_key) ||
    normalizeString(message.metadata?.sourceMessageKey) ||
    normalizeString(message.metadata?.source_message_key) ||
    normalizeString(message.metadata?.workflow?.sourceMessageKey) ||
    normalizeString(message.metadata?.workflow?.source_message_key) ||
    (message.emailMessageId ? String(message.emailMessageId) : null);

  return {
    applicationId: normalizeApplicationId(
      message.sourceCaseId ||
        message.source_case_id ||
        message.metadata?.applicationId ||
        message.metadata?.application_id ||
        message.metadata?.sourceCaseId ||
        message.metadata?.source_case_id ||
        message.metadata?.workflow?.applicationId ||
        message.metadata?.workflow?.application_id ||
        message.metadata?.workflow?.sourceCaseId ||
        message.metadata?.workflow?.source_case_id
    ),
    messageId:
      normalizeString(message.externalMessageId) ||
      normalizeString(message.messageId) ||
      normalizeString(message.message_id) ||
      normalizeString(message.metadata?.messageId) ||
      normalizeString(message.metadata?.message_id) ||
      normalizeString(message.metadata?.workflow?.messageId) ||
      normalizeString(message.metadata?.workflow?.message_id),
    emailMessageId: message.emailMessageId ? String(message.emailMessageId) : null,
    parentMessageIds: Array.from(new Set(parentMessageIds)),
    sourceMessageKey,
    communicationId:
      normalizeString(message.communicationId) ||
      normalizeString(message.communication_id) ||
      normalizeString(message.metadata?.communicationId) ||
      normalizeString(message.metadata?.communication_id) ||
      normalizeString(message.metadata?.workflow?.communicationId) ||
      normalizeString(message.metadata?.workflow?.communication_id),
    rootOutgoingCommunicationId:
      normalizeString(message.rootOutgoingCommunicationId) ||
      normalizeString(message.root_outgoing_communication_id) ||
      normalizeString(message.metadata?.rootOutgoingCommunicationId) ||
      normalizeString(message.metadata?.root_outgoing_communication_id) ||
      normalizeString(message.metadata?.workflow?.rootOutgoingCommunicationId) ||
      normalizeString(message.metadata?.workflow?.root_outgoing_communication_id),
    threadId,
  };
}

function getThreadLookupInput(thread) {
  return {
    applicationId: normalizeApplicationId(
      thread.sourceCaseId ||
        thread.source_case_id ||
        thread.metadata?.applicationId ||
        thread.metadata?.application_id ||
        thread.metadata?.sourceCaseId ||
        thread.metadata?.source_case_id ||
        thread.metadata?.workflow?.applicationId ||
        thread.metadata?.workflow?.application_id ||
        thread.metadata?.workflow?.sourceCaseId ||
        thread.metadata?.workflow?.source_case_id
    ),
    threadId: getRecordThreadLookupValue(thread),
    communicationId:
      normalizeString(thread.communicationId) ||
      normalizeString(thread.communication_id) ||
      normalizeString(thread.metadata?.communicationId) ||
      normalizeString(thread.metadata?.communication_id) ||
      normalizeString(thread.metadata?.workflow?.communicationId) ||
      normalizeString(thread.metadata?.workflow?.communication_id),
    rootOutgoingCommunicationId:
      normalizeString(thread.rootOutgoingCommunicationId) ||
      normalizeString(thread.root_outgoing_communication_id) ||
      normalizeString(thread.metadata?.rootOutgoingCommunicationId) ||
      normalizeString(thread.metadata?.root_outgoing_communication_id) ||
      normalizeString(thread.metadata?.workflow?.rootOutgoingCommunicationId) ||
      normalizeString(thread.metadata?.workflow?.root_outgoing_communication_id),
  };
}

function getPhpLookupConfig() {
  const baseUrl = normalizeString(
    process.env.PHP_CONTRACT_BASE_URL ||
      process.env.PHP_AUTHORIZATION_BASE_URL ||
      process.env.PHP_APP_URL ||
      process.env.APP_URL
  );
  const lookupPath = normalizeString(
    getContractEndpoint(
      'communicationLookup',
      process.env.PHP_COMMUNICATION_LOOKUP_PATH || process.env.PHP_LANE_LOOKUP_PATH || '',
      'api/shared/workflow_communication_lookup.php'
    )
  );
  const token = normalizeString(
    process.env.PHP_CONTRACT_SERVICE_TOKEN ||
      process.env.PHP_AUTHORIZATION_SERVICE_TOKEN ||
      process.env.PHP_API_KEY ||
      ''
  );

  if (!lookupPath) return null;

  let url;
  try {
    url = buildContractUrl(lookupPath);
  } catch (error) {
    if (!baseUrl) return null;
    throw error;
  }

  return {
    url,
    fallbackUrls: [],
    token,
    timeout: Number(process.env.PHP_LANE_LOOKUP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function buildLookupAttempts(lookup) {
  const attempts = [
    lookup.messageId ? { lookupType: 'message_id', message_id: lookup.messageId } : null,
    ...(Array.isArray(lookup.parentMessageIds)
      ? lookup.parentMessageIds.map((messageId) => ({ lookupType: 'message_id', message_id: messageId, parentHistory: true }))
      : []),
    lookup.sourceMessageKey ? { lookupType: 'source_message_key', source_message_key: lookup.sourceMessageKey } : null,
    lookup.sourceMessageKey && !lookup.sourceMessageKey.startsWith('node:')
      ? { lookupType: 'source_message_key', source_message_key: `node:${lookup.sourceMessageKey}` }
      : null,
    lookup.communicationId ? { lookupType: 'communication_id', communication_id: lookup.communicationId } : null,
    lookup.rootOutgoingCommunicationId
      ? { lookupType: 'root_outgoing_communication_id', root_outgoing_communication_id: lookup.rootOutgoingCommunicationId }
      : null,
    lookup.threadId ? { lookupType: 'thread_id', thread_id: lookup.threadId } : null,
  ].filter(Boolean);

  return attempts.map((attempt) => {
    const payload = { ...attempt };
    if (lookup.applicationId && !attempt.parentHistory) {
      payload.applicationId = lookup.applicationId;
      payload.application_id = lookup.applicationId;
    }
    delete payload.parentHistory;
    return payload;
  });
}

async function lookupPhpLane(record, inputBuilder = getMessageLookupInput) {
  const config = getPhpLookupConfig();
  if (!config) return null;

  const lookup = inputBuilder(record);
  const attempts = buildLookupAttempts(lookup);

  if (attempts.length === 0) {
    return null;
  }

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (config.token) {
    headers['x-api-key'] = config.token;
    headers['x-service-token'] = config.token;
    headers.Authorization = `Bearer ${config.token}`;
  }

  for (const attempt of attempts) {
    phpLookupStats.attempts += 1;
    phpLookupStats.byType[attempt.lookupType] = (phpLookupStats.byType[attempt.lookupType] || 0) + 1;

    let response;
    const urls = [config.url, ...(config.fallbackUrls || [])];
    for (const url of urls) {
      try {
        response = await axios.post(url, attempt, {
          timeout: config.timeout,
          headers,
          validateStatus: () => true,
        });
      } catch (error) {
        phpLookupStats.errors += 1;
        phpLookupStats.byStatus[error.code || 'REQUEST_ERROR'] =
          (phpLookupStats.byStatus[error.code || 'REQUEST_ERROR'] || 0) + 1;
        continue;
      }
      if (response.status !== 404) {
        break;
      }
    }

    if (!response) continue;

    phpLookupStats.byStatus[response.status] = (phpLookupStats.byStatus[response.status] || 0) + 1;

    if (response.status === 401 || response.status === 403) {
      phpLookupStats.errors += 1;
      return {
        unavailable: true,
        lookupType: attempt.lookupType,
        reason: 'php_lookup_unauthorized',
      };
    }

    if (response.status === 404) {
      phpLookupStats.errors += 1;
      return {
        unavailable: true,
        lookupType: attempt.lookupType,
        reason: 'php_lookup_endpoint_not_found',
      };
    }

    if (response.status < 200 || response.status >= 300 || !response.data || response.data.status === 0) {
      continue;
    }

    const normalized = normalizePhpLookupResponse(response.data);
    if (normalized.ambiguous) {
      phpLookupStats.ambiguous += 1;
      return {
        ambiguous: true,
        lookupType: attempt.lookupType,
        reason: normalized.reason,
      };
    }

    if (!normalized.data) {
      continue;
    }

    const lane = laneFromPhpCommunication(normalized.data);
    if (lane?.phpThreadId) {
      phpLookupStats.recovered += 1;
      return {
        ...lane,
        lookupType: attempt.lookupType,
        communicationId: normalizeString(normalized.data.communicationId || normalized.data.communication_id),
        rootOutgoingCommunicationId: normalizeString(
          normalized.data.rootOutgoingCommunicationId || normalized.data.root_outgoing_communication_id
        ),
        phpThreadId: lane.phpThreadId,
      };
    }
  }

  phpLookupStats.noMatch += 1;
  return null;
}

function normalizePhpLookupResponse(responseData) {
  const data = responseData?.data ?? responseData;
  const candidates =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.records)
        ? data.records
        : Array.isArray(data?.matches)
          ? data.matches
          : null;

  if (candidates) {
    if (candidates.length === 1) {
      return { data: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { data: null, ambiguous: true, reason: 'PHP_LOOKUP_MULTIPLE_MATCHES' };
    }
    return { data: null, ambiguous: false };
  }

  return data && typeof data === 'object'
    ? { data, ambiguous: false }
    : { data: null, ambiguous: false };
}

function laneFromPhpCommunication(data) {
  const parsedThreadId = parsePhpThreadId(
    data.phpThreadId ||
      data.php_thread_id ||
      data.threadId ||
      data.thread_id ||
      data.workflowThreadId ||
      data.workflow_thread_id
  );

  const evidence = getLaneEvidence({
    sourceCaseId:
      data.applicationId ||
      data.application_id ||
      data.sourceCaseId ||
      data.source_case_id ||
      parsedThreadId?.applicationId,
    componentKey:
      data.componentKey ||
      data.component_key ||
      parsedThreadId?.componentKey,
    ownerRole:
      data.ownerRole ||
      data.owner_role ||
      data.threadOwnerRole ||
      data.thread_owner_role ||
      parsedThreadId?.ownerRole,
    metadata: {
      workflow: {
        applicationId: data.applicationId || data.application_id || parsedThreadId?.applicationId,
        componentKey: data.componentKey || data.component_key || parsedThreadId?.componentKey,
        ownerRole:
          data.ownerRole ||
          data.owner_role ||
          data.threadOwnerRole ||
          data.thread_owner_role ||
          parsedThreadId?.ownerRole,
      },
    },
  });

  return evidence.phpThreadId ? evidence : parsedThreadId;
}

function previousValues(record) {
  return {
    phpThreadId: record.phpThreadId ?? null,
    componentKey: record.componentKey ?? null,
    ownerRole: record.ownerRole ?? null,
    metadataLaneBackfill: record.metadata?.laneBackfill ?? null,
  };
}

function buildSet(record, lane, status) {
  const set = {
    'metadata.laneBackfill': {
      runId: RUN_ID,
      status,
      confidence: lane.confidence,
      source: lane.source,
      appliedAt: new Date(),
    },
  };

  if (!normalizeString(record.phpThreadId)) set.phpThreadId = lane.phpThreadId;
  if (!normalizeComponentKey(record.componentKey)) set.componentKey = lane.componentKey;
  if (!normalizeOwnerRole(record.ownerRole)) set.ownerRole = lane.ownerRole;

  return set;
}

function buildSkipSet(reason, details = {}, resolutionStatus = 'manual_review') {
  return {
    resolutionStatus,
    'metadata.laneBackfill': {
      runId: RUN_ID,
      status: 'skipped',
      reason,
      resolutionStatus,
      details,
      appliedAt: new Date(),
    },
  };
}

function hasAnyLookupKey(input) {
  return Object.entries(input || {}).some(([key, value]) => key !== 'applicationId' && Boolean(value));
}

function summarizeReadiness(stats) {
  const totalMessages = stats.messages.scanned || 0;
  const totalThreads = stats.threads.scanned || 0;
  const messageReady = (stats.messages.unchanged || 0) + (stats.messages.update || 0);
  const threadReady = (stats.threads.unchanged || 0) + (stats.threads.update || 0);
  const total = totalMessages + totalThreads;
  const ready = messageReady + threadReady;

  return {
    messages: {
      ready: messageReady,
      total: totalMessages,
      score: totalMessages > 0 ? Number((messageReady / totalMessages).toFixed(4)) : 1,
    },
    threads: {
      ready: threadReady,
      total: totalThreads,
      score: totalThreads > 0 ? Number((threadReady / totalThreads).toFixed(4)) : 1,
    },
    overall: {
      ready,
      total,
      score: total > 0 ? Number((ready / total).toFixed(4)) : 1,
    },
  };
}

function recordDecision(stats, collection, decision) {
  stats[collection].scanned += 1;
  stats[collection][decision.action] += 1;
  stats[collection].byCategory[decision.category] =
    (stats[collection].byCategory[decision.category] || 0) + 1;
  if (decision.reason) {
    stats[collection].byReason[decision.reason] =
      (stats[collection].byReason[decision.reason] || 0) + 1;
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/peppermint';
  await mongoose.connect(mongoUri);
  await initializeContractConfig();

  const db = mongoose.connection.db;
  const threads = db.collection('threads');
  const messages = db.collection('messages');
  const rollback = [];
  const stats = {
    mode: APPLY ? 'apply' : 'dry-run',
    runId: RUN_ID,
    phpLookupEnabled: Boolean(getPhpLookupConfig()),
    phpLookup: phpLookupStats,
    messages: { scanned: 0, update: 0, skip: 0, unchanged: 0, byCategory: {}, byReason: {} },
    threads: { scanned: 0, update: 0, skip: 0, unchanged: 0, byCategory: {}, byReason: {} },
    recovered: { messages: 0, threads: 0, bySource: {} },
    remaining: {
      ambiguousThreads: [],
      manualReviewRecords: [],
      archiveOnlyRecords: [],
    },
  };

  const messageDocs = await messages.find({}).toArray();
  const threadDocs = await threads.find({}).toArray();
  const emailMessageIds = messageDocs
    .map((message) => message.emailMessageId)
    .filter(Boolean);
  const emailMessageDocs = emailMessageIds.length > 0
    ? await db.collection('emailmessages').find({ _id: { $in: emailMessageIds } }).toArray()
    : [];
  const emailMessagesById = new Map(emailMessageDocs.map((emailMessage) => [String(emailMessage._id), emailMessage]));
  const messageLanes = new Map();
  const baseThreadLanes = new Map();

  for (const thread of threadDocs) {
    if (hasTrustedLane(thread)) {
      baseThreadLanes.set(String(thread._id), {
        phpThreadId: thread.phpThreadId,
        componentKey: normalizeComponentKey(thread.componentKey),
        ownerRole: normalizeOwnerRole(thread.ownerRole),
        category: 'existing',
        confidence: 'existing',
        source: 'existing_trusted_thread_values',
      });
      continue;
    }

    const direct = getLaneEvidence(thread);
    if (direct.phpThreadId) {
      baseThreadLanes.set(String(thread._id), {
        ...direct,
        category: 'A',
        confidence: 'high',
        source: 'thread_workflow_metadata',
      });
    }
  }

  for (const message of messageDocs) {
    if (hasTrustedLane(message)) {
      const lane = {
        phpThreadId: message.phpThreadId,
        componentKey: normalizeComponentKey(message.componentKey),
        ownerRole: normalizeOwnerRole(message.ownerRole),
        category: 'existing',
        confidence: 'existing',
        source: 'existing_trusted_values',
      };
      messageLanes.set(String(message._id), lane);
      recordDecision(stats, 'messages', { action: 'unchanged', category: 'existing' });
      continue;
    }

    const direct = getLaneEvidence(message);
    let lane = direct.phpThreadId ? {
      ...direct,
      category: 'A',
      confidence: 'high',
      source: 'workflow_metadata',
    } : null;

    if (!lane) {
      const emailMessage = message.emailMessageId ? emailMessagesById.get(String(message.emailMessageId)) : null;
      const phpLane = await lookupPhpLane(message, (record) => getMessageLookupInput(record, emailMessage));
      if (phpLane?.ambiguous) {
        const reason = phpLane.reason || 'php_lookup_ambiguous';
        recordDecision(stats, 'messages', { action: 'skip', category: 'D', reason });
        stats.remaining.manualReviewRecords.push({
          collection: 'messages',
          id: String(message._id),
          reason,
        });
        if (APPLY) {
          rollback.push({ collection: 'messages', _id: message._id, previous: previousValues(message) });
          await messages.updateOne(
            { _id: message._id },
            { $set: buildSkipSet(reason, { ...getMessageLookupInput(message, emailMessage), lookupType: phpLane.lookupType }, 'manual_review') }
          );
        }
        continue;
      }

      if (phpLane?.unavailable) {
        const reason = phpLane.reason || 'php_lookup_unavailable';
        recordDecision(stats, 'messages', { action: 'skip', category: 'B', reason });
        stats.remaining.manualReviewRecords.push({
          collection: 'messages',
          id: String(message._id),
          reason,
        });
        if (APPLY) {
          rollback.push({ collection: 'messages', _id: message._id, previous: previousValues(message) });
          await messages.updateOne(
            { _id: message._id },
            { $set: buildSkipSet(reason, { ...getMessageLookupInput(message, emailMessage), lookupType: phpLane.lookupType }, 'manual_review') }
          );
        }
        continue;
      }

      if (phpLane?.phpThreadId) {
        lane = {
          ...phpLane,
          category: 'B',
          confidence: 'high',
          source: 'php_communication_lookup',
        };
      }
    }

    if (!lane) {
      const parentLane = message.threadId ? baseThreadLanes.get(String(message.threadId)) : null;
      if (parentLane?.phpThreadId) {
        lane = {
          ...parentLane,
          category: 'C',
          confidence: 'high',
          source: 'confirmed_parent_thread_history',
        };
      }
    }

    if (!lane) {
      const emailMessage = message.emailMessageId ? emailMessagesById.get(String(message.emailMessageId)) : null;
      const lookupInput = getMessageLookupInput(message, emailMessage);
      const hasLookupKey = hasAnyLookupKey(lookupInput);
      const reason = hasLookupKey ? 'php_lookup_no_match' : 'missing_lane_evidence';
      const resolutionStatus = hasLookupKey ? 'manual_review' : 'archive_only';
      recordDecision(stats, 'messages', { action: 'skip', category: hasLookupKey ? 'B' : 'D', reason });
      stats.remaining[resolutionStatus === 'manual_review' ? 'manualReviewRecords' : 'archiveOnlyRecords'].push({
        collection: 'messages',
        id: String(message._id),
        reason,
      });
      if (APPLY) {
        rollback.push({ collection: 'messages', _id: message._id, previous: previousValues(message) });
        await messages.updateOne({ _id: message._id }, { $set: buildSkipSet(reason, lookupInput, resolutionStatus) });
      }
      continue;
    }

    messageLanes.set(String(message._id), lane);
    recordDecision(stats, 'messages', { action: 'update', category: lane.category });
    stats.recovered.messages += 1;
    stats.recovered.bySource[lane.source] = (stats.recovered.bySource[lane.source] || 0) + 1;
    if (APPLY) {
      rollback.push({ collection: 'messages', _id: message._id, previous: previousValues(message) });
      await messages.updateOne({ _id: message._id }, { $set: buildSet(message, lane, 'backfilled') });
    }
  }

  for (const thread of threadDocs) {
    if (hasTrustedLane(thread)) {
      recordDecision(stats, 'threads', { action: 'unchanged', category: 'existing' });
      continue;
    }

    const direct = getLaneEvidence(thread);
    let lane = direct.phpThreadId ? {
      ...direct,
      category: 'A',
      confidence: 'high',
      source: 'workflow_metadata',
    } : null;

    if (!lane) {
      const linkedMessages = messageDocs.filter((message) => String(message.threadId || '') === String(thread._id));
      const linkedLanes = new Map();
      linkedMessages.forEach((message) => {
        const linkedLane = messageLanes.get(String(message._id));
        if (linkedLane?.phpThreadId) {
          linkedLanes.set(linkedLane.phpThreadId, linkedLane);
        }
      });

      if (linkedLanes.size === 1) {
        lane = {
          ...Array.from(linkedLanes.values())[0],
          category: 'C',
          confidence: 'high',
          source: 'unique_linked_message_history',
        };
      } else if (linkedLanes.size > 1) {
        const reason = 'ambiguous_linked_message_lanes';
        recordDecision(stats, 'threads', { action: 'skip', category: 'D', reason });
        stats.remaining.ambiguousThreads.push({
          id: String(thread._id),
          reason,
          lanes: Array.from(linkedLanes.keys()),
        });
        stats.remaining.manualReviewRecords.push({
          collection: 'threads',
          id: String(thread._id),
          reason,
        });
        if (APPLY) {
          rollback.push({ collection: 'threads', _id: thread._id, previous: previousValues(thread) });
          await threads.updateOne(
            { _id: thread._id },
            { $set: buildSkipSet(reason, { lanes: Array.from(linkedLanes.keys()) }, 'manual_review') }
          );
        }
        continue;
      }
    }

    if (!lane) {
      const phpLane = await lookupPhpLane(thread, getThreadLookupInput);
      if (phpLane?.ambiguous) {
        const reason = phpLane.reason || 'php_lookup_ambiguous';
        recordDecision(stats, 'threads', { action: 'skip', category: 'D', reason });
        stats.remaining.ambiguousThreads.push({
          id: String(thread._id),
          reason,
          lookupType: phpLane.lookupType,
        });
        stats.remaining.manualReviewRecords.push({
          collection: 'threads',
          id: String(thread._id),
          reason,
        });
        if (APPLY) {
          rollback.push({ collection: 'threads', _id: thread._id, previous: previousValues(thread) });
          await threads.updateOne(
            { _id: thread._id },
            { $set: buildSkipSet(reason, { ...getThreadLookupInput(thread), lookupType: phpLane.lookupType }, 'manual_review') }
          );
        }
        continue;
      }

      if (phpLane?.unavailable) {
        const reason = phpLane.reason || 'php_lookup_unavailable';
        recordDecision(stats, 'threads', { action: 'skip', category: 'B', reason });
        stats.remaining.manualReviewRecords.push({
          collection: 'threads',
          id: String(thread._id),
          reason,
        });
        if (APPLY) {
          rollback.push({ collection: 'threads', _id: thread._id, previous: previousValues(thread) });
          await threads.updateOne(
            { _id: thread._id },
            { $set: buildSkipSet(reason, { ...getThreadLookupInput(thread), lookupType: phpLane.lookupType }, 'manual_review') }
          );
        }
        continue;
      }

      if (phpLane?.phpThreadId) {
        lane = {
          ...phpLane,
          category: 'B',
          confidence: 'high',
          source: 'php_communication_lookup',
        };
      }
    }

    if (!lane) {
      const lookupInput = getThreadLookupInput(thread);
      const hasLookupKey = hasAnyLookupKey(lookupInput);
      const reason = hasLookupKey ? 'php_lookup_no_match_or_missing_history' : 'missing_lane_evidence_or_history';
      const resolutionStatus = hasLookupKey ? 'manual_review' : 'archive_only';
      recordDecision(stats, 'threads', { action: 'skip', category: 'B', reason });
      stats.remaining[resolutionStatus === 'manual_review' ? 'manualReviewRecords' : 'archiveOnlyRecords'].push({
        collection: 'threads',
        id: String(thread._id),
        reason,
      });
      if (APPLY) {
        rollback.push({ collection: 'threads', _id: thread._id, previous: previousValues(thread) });
        await threads.updateOne({ _id: thread._id }, { $set: buildSkipSet(reason, lookupInput, resolutionStatus) });
      }
      continue;
    }

    recordDecision(stats, 'threads', { action: 'update', category: lane.category });
    stats.recovered.threads += 1;
    stats.recovered.bySource[lane.source] = (stats.recovered.bySource[lane.source] || 0) + 1;
    if (APPLY) {
      rollback.push({ collection: 'threads', _id: thread._id, previous: previousValues(thread) });
      await threads.updateOne({ _id: thread._id }, { $set: buildSet(thread, lane, 'backfilled') });
    }
  }

  if (APPLY) {
    fs.mkdirSync(ROLLBACK_DIR, { recursive: true });
    fs.writeFileSync(ROLLBACK_FILE, JSON.stringify({ runId: RUN_ID, rollback }, null, 2));
    stats.rollbackFile = ROLLBACK_FILE;
  }

  stats.readiness = summarizeReadiness(stats);
  stats.enforcementReady = stats.remaining.manualReviewRecords.length === 0 && stats.remaining.ambiguousThreads.length === 0;
  console.log(JSON.stringify(stats, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Lane identity backfill failed:', error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore disconnect errors during failure
  }
  process.exit(1);
});
