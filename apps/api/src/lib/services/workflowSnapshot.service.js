const axios = require('axios');

const SNAPSHOT_PATH = '/api/shared/case_workflow_snapshot.php';
const REPORT_PATH = '/api/shared/candidate_report_get.php';
const TIMELINE_PATH = '/api/shared/case_timeline_list.php';

function isDebugEnabled() {
  return process.env.WORKFLOW_SNAPSHOT_DEBUG === 'true' || process.env.NODE_ENV !== 'production';
}

function redactCookie(cookieValue) {
  const raw = typeof cookieValue === 'string' ? cookieValue : '';
  if (!raw) return '';
  const head = raw.slice(0, 24);
  return `${head}${raw.length > 24 ? '…' : ''} (len=${raw.length})`;
}

function previewPayload(value, limit = 2000) {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (!raw) return '';
    return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
  } catch (error) {
    return '[unserializable payload]';
  }
}

function getPhpBaseUrl() {
  const raw = process.env.APP_URL || process.env.PHP_APP_URL || '';
  return raw.replace(/\/+$/, '');
}

function getSnapshotUrl() {
  const baseUrl = getPhpBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}${SNAPSHOT_PATH}`;
}

function getCandidateReportUrl() {
  const baseUrl = getPhpBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}${REPORT_PATH}`;
}

function getTimelineUrl() {
  const baseUrl = getPhpBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}${TIMELINE_PATH}`;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isUsableSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const hasCanonicalFields =
    'applicationId' in payload ||
    'application_id' in payload ||
    'currentStage' in payload ||
    'current_stage' in payload ||
    'rawCaseStatus' in payload ||
    'raw_case_status' in payload ||
    'ownerSummary' in payload ||
    'owner_summary' in payload ||
    'pendingItemsSummary' in payload ||
    'pending_items_summary' in payload ||
    'snapshot' in payload;

  return hasCanonicalFields;
}

function coerceJsonLike(value) {
  if (value && typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return value;
    }
  }

  return value;
}

function normalizeWorkflowSnapshot(payload = {}) {
  const ownerSummary = normalizeObject(payload.ownerSummary || payload.owner_summary);
  const pendingItemsSummary = normalizeObject(payload.pendingItemsSummary || payload.pending_items_summary);
  const lastTimelineEvent = normalizeObject(payload.lastTimelineEvent || payload.last_timeline_event);
  const tatConfig = normalizeObject(payload.tatConfig || payload.tat_config);

  const validator = normalizeObject(ownerSummary.validator || ownerSummary.validator_summary);
  const verifierRaw = ownerSummary.verifier || ownerSummary.verifiers || ownerSummary.verifier_summary;
  const verifier = Array.isArray(verifierRaw)
    ? verifierRaw
    : verifierRaw && typeof verifierRaw === 'object'
      ? [verifierRaw]
      : [];

  return {
    applicationId: pickFirst(payload.applicationId, payload.application_id),
    caseId: pickFirst(payload.caseId, payload.case_id),
    candidateName: pickFirst(payload.candidateName, payload.candidate_name),
    candidateEmail: pickFirst(payload.candidateEmail, payload.candidate_email),
    currentStage: pickFirst(payload.currentStage, payload.current_stage),
    rawCaseStatus: pickFirst(payload.rawCaseStatus, payload.raw_case_status),
    ownerSummary: {
      mode: pickFirst(ownerSummary.mode, ownerSummary.assignment_mode),
      validator,
      verifier: normalizeArray(verifier),
      dbVerifier: normalizeObject(ownerSummary.dbVerifier || ownerSummary.db_verifier),
    },
    pendingItemsSummary: {
      totalRequired: Number(pickFirst(pendingItemsSummary.totalRequired, pendingItemsSummary.total_required, 0)),
      pendingCount: Number(pickFirst(pendingItemsSummary.pendingCount, pendingItemsSummary.pending_count, 0)),
      holdCount: Number(pickFirst(pendingItemsSummary.holdCount, pendingItemsSummary.hold_count, 0)),
      rejectedCount: Number(pickFirst(pendingItemsSummary.rejectedCount, pendingItemsSummary.rejected_count, 0)),
      items: normalizeArray(pendingItemsSummary.items || pendingItemsSummary.item_list),
    },
    lastTimelineEvent: {
      at: pickFirst(lastTimelineEvent.at, lastTimelineEvent.created_at),
      eventType: pickFirst(lastTimelineEvent.eventType, lastTimelineEvent.event_type),
      sectionKey: pickFirst(lastTimelineEvent.sectionKey, lastTimelineEvent.section_key),
      message: pickFirst(lastTimelineEvent.message, lastTimelineEvent.event_message),
      actorRole: pickFirst(lastTimelineEvent.actorRole, lastTimelineEvent.actor_role),
      actorUserId: pickFirst(lastTimelineEvent.actorUserId, lastTimelineEvent.actor_user_id),
      actorName: pickFirst(lastTimelineEvent.actorName, lastTimelineEvent.actor_name),
    },
    tatConfig: {
      clientInternalTatDays: pickFirst(tatConfig.clientInternalTatDays, tatConfig.client_internal_tat_days, tatConfig.internal_tat),
      weekendRules: pickFirst(tatConfig.weekendRules, tatConfig.weekend_rules),
    },
    workflowSource: pickFirst(payload.workflowSource, payload.workflow_source, 'snapshot'),
    workflowDebug: normalizeObject(payload.workflowDebug || payload.workflow_debug),
  };
}

function coerceNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function extractCurrentStageFromComponent(component = {}) {
  const directStage = pickFirst(component.current_stage, component.stageLabel, component.stage_label);
  if (directStage) return directStage;

  const workflow = normalizeObject(component.component_workflow || component.workflow);
  const stageOrder = [
    ['qa', 'QA'],
    ['verifier', 'Verifier'],
    ['validator', 'Validator'],
    ['candidate', 'Candidate'],
  ];

  for (const [key, label] of stageOrder) {
    const stageState = normalizeObject(workflow[key]);
    const status = String(
      pickFirst(stageState.current_stage, stageState.status, stageState.state, '')
    ).toLowerCase();

    if (status && status !== 'completed' && status !== 'approved' && status !== 'clear') {
      return `${label} ${status.charAt(0).toUpperCase()}${status.slice(1)}`.trim();
    }
  }

  return null;
}

function normalizePendingItemsSummary(components = []) {
  const requiredComponents = components.filter((component) => component?.is_required !== false);
  const items = [];
  let pendingCount = 0;
  let holdCount = 0;
  let rejectedCount = 0;

  requiredComponents.forEach((component) => {
    const status = String(pickFirst(component.status, '')).toLowerCase();
    if (status === 'pending') pendingCount += 1;
    if (status === 'hold') holdCount += 1;
    if (status === 'rejected') rejectedCount += 1;

    if (status === 'pending' || status === 'hold' || status === 'rejected') {
      items.push({
        componentKey: pickFirst(component.component_key, component.componentKey),
        stageLabel: extractCurrentStageFromComponent(component),
        assignedRole: pickFirst(component.assigned_role, component.assignedRole),
        assignedUserId: pickFirst(component.assigned_user_id, component.assignedUserId),
      });
    }
  });

  return {
    totalRequired: requiredComponents.length,
    pendingCount,
    holdCount,
    rejectedCount,
    items,
  };
}

function normalizeCandidateReportPayload(payload = {}) {
  const topLevel = normalizeObject(payload);
  const root = normalizeObject(topLevel.data);
  const caseData = normalizeObject(root.case);
  const application = normalizeObject(root.application);
  const assignedComponents = normalizeArray(root.assigned_components);

  const candidateFirstName = pickFirst(
    caseData.candidate_first_name,
    application.candidate_first_name,
    root.candidate_first_name
  );
  const candidateLastName = pickFirst(
    caseData.candidate_last_name,
    application.candidate_last_name,
    root.candidate_last_name
  );

  return {
    applicationId: pickFirst(root.application_id, caseData.application_id, application.application_id),
    caseId: pickFirst(root.case_id, caseData.case_id, application.case_id),
    candidateName: [candidateFirstName, candidateLastName].filter(Boolean).join(' ').trim() || null,
    candidateEmail: pickFirst(
      caseData.candidate_email,
      application.candidate_email,
      root.candidate_email
    ),
    currentStage: pickFirst(root.current_stage, caseData.current_stage, application.current_stage),
    rawCaseStatus: pickFirst(caseData.case_status, application.status, root.case_status),
    ownerSummary: {
      mode: 'component_assignment',
      validator: {},
      verifier: [],
      dbVerifier: {},
    },
    pendingItemsSummary: normalizePendingItemsSummary(assignedComponents),
    lastTimelineEvent: {
      at: null,
      eventType: null,
      sectionKey: null,
      message: null,
      actorRole: null,
      actorUserId: null,
      actorName: null,
    },
    tatConfig: {
      clientInternalTatDays: coerceNumber(
        pickFirst(
          root.internal_tat,
          caseData.internal_tat,
          application.internal_tat,
          topLevel.internal_tat
        )
      ),
      weekendRules: pickFirst(
        root.weekend_rules,
        caseData.weekend_rules,
        application.weekend_rules,
        topLevel.weekend_rules
      ),
    },
    workflowSource: 'candidate_report_fallback',
    workflowDebug: normalizeObject(topLevel.workflowDebug),
  };
}

function normalizeTimelineEvent(row = {}) {
  const firstName = pickFirst(row.first_name, row.firstName);
  const lastName = pickFirst(row.last_name, row.lastName);
  const actorName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  return {
    at: pickFirst(row.created_at, row.createdAt),
    eventType: pickFirst(row.event_type, row.eventType),
    sectionKey: pickFirst(row.section_key, row.sectionKey),
    message: pickFirst(row.message),
    actorRole: pickFirst(row.actor_role, row.actorRole),
    actorUserId: pickFirst(row.actor_user_id, row.actorUserId),
    actorName,
  };
}

function pickWorkflowCurrentOwner(snapshot = {}) {
  const ownerSummary = normalizeObject(snapshot.ownerSummary || snapshot.owner_summary);
  const currentStage = String(
    pickFirst(snapshot.currentStage, snapshot.current_stage, snapshot.rawCaseStatus, snapshot.raw_case_status, '')
  ).toLowerCase();

  const validator = normalizeObject(ownerSummary.validator || ownerSummary.validator_summary);
  const verifierRaw = ownerSummary.verifier || ownerSummary.verifiers || ownerSummary.verifier_summary;
  const verifiers = Array.isArray(verifierRaw)
    ? verifierRaw.map((item) => normalizeObject(item)).filter((item) => Object.keys(item).length > 0)
    : verifierRaw && typeof verifierRaw === 'object'
      ? [normalizeObject(verifierRaw)]
      : [];
  const dbVerifier = normalizeObject(ownerSummary.dbVerifier || ownerSummary.db_verifier);

  if (currentStage.includes('verifier') || currentStage.includes('verification')) {
    return verifiers[0] || dbVerifier || validator || {};
  }

  if (currentStage.includes('validator') || currentStage.includes('validation')) {
    return validator || verifiers[0] || dbVerifier || {};
  }

  if (currentStage.includes('qa') || currentStage.includes('team lead') || currentStage.includes('team_lead')) {
    return normalizeObject(ownerSummary.qa || ownerSummary.teamLead || ownerSummary.team_lead) || {};
  }

  return validator || verifiers[0] || dbVerifier || {};
}

async function fetchLatestTimelineEvent(applicationId, headers) {
  const timelineUrl = getTimelineUrl();
  if (!timelineUrl) {
    return null;
  }

  const response = await axios.get(timelineUrl, {
    params: { application_id: applicationId, limit: 1 },
    headers,
    timeout: Number(process.env.PHP_SNAPSHOT_TIMEOUT_MS || 10000),
    validateStatus: () => true,
  });

  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return null;
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`PHP timeline request failed with status ${response.status}`);
  }

  const payload = normalizeObject(coerceJsonLike(response.data));
  const rows = normalizeArray(payload.data);
  if (!rows.length) {
    return null;
  }

  return normalizeTimelineEvent(rows[0]);
}

async function fetchWorkflowSnapshot(applicationId, options = {}) {
  const debugEnabled = isDebugEnabled();
  const normalizedId = typeof applicationId === 'string' ? applicationId.trim().toUpperCase() : '';
  if (!normalizedId) {
    return null;
  }

  const url = getSnapshotUrl();
  const fallbackUrl = getCandidateReportUrl();
  if (!url && !fallbackUrl) {
    return null;
  }

  const headers = {};
  if (process.env.PHP_API_KEY) {
    headers['x-api-key'] = process.env.PHP_API_KEY;
  }
  headers.Cookie = options.cookie || '';
  headers['User-Agent'] = options.userAgent || '';
  headers['X-Requested-With'] = 'XMLHttpRequest';
  headers.Accept = 'application/json';

  if (debugEnabled) {
    console.log('Fetching workflow for:', normalizedId);
    console.log('Calling URL:', url || '(none)');
    if (fallbackUrl) {
      console.log('Fallback URL:', fallbackUrl);
    }
    console.log('Request headers:', {
      ...headers,
      Cookie: redactCookie(headers.Cookie),
    });
    console.log('Request options:', {
      cookie: redactCookie(options.cookie),
      userAgent: options.userAgent || '',
    });
  }

  if (url) {
    try {
      const response = await axios.get(url, {
        params: { application_id: normalizedId },
        headers,
        withCredentials: true,
        timeout: Number(process.env.PHP_SNAPSHOT_TIMEOUT_MS || 10000),
        validateStatus: () => true,
      });

      if (debugEnabled) {
        console.log('PHP API RESPONSE (snapshot):', {
          status: response.status,
          preview: previewPayload(response?.data),
        });
      }

      if (!response?.data) {
        console.warn('Invalid workflow response (snapshot): empty body');
      } else if ('success' in response.data && response.data.success === false) {
        console.warn('Invalid workflow response (snapshot):', response.data);
      }

      if (response.status >= 200 && response.status < 300) {
        const parsedBody = coerceJsonLike(response.data);
        const payload = normalizeObject(parsedBody);
        let source = null;
        if (payload.snapshot && typeof payload.snapshot === 'object') {
          source = payload.snapshot;
        } else if (payload.data && typeof payload.data === 'object') {
          source = payload.data;
        } else if (typeof payload.data === 'string') {
          const coercedData = coerceJsonLike(payload.data);
          if (coercedData && typeof coercedData === 'object') {
            source = coercedData;
          }
        }
        source = source || payload;

        if (isUsableSnapshotPayload(source)) {
          const normalized = normalizeWorkflowSnapshot(source);
          normalized.workflowDebug = {
            ...normalized.workflowDebug,
            path: 'snapshot',
            statusCode: response.status,
            bodyType: typeof parsedBody,
            topLevelKeys: Object.keys(payload),
          };
          if (!normalized.lastTimelineEvent?.message) {
            normalized.lastTimelineEvent =
              (await fetchLatestTimelineEvent(normalizedId, headers)) || normalized.lastTimelineEvent;
          }
          return normalized;
        }

        console.warn('Invalid workflow response (snapshot): missing expected fields', {
          status: response.status,
          topLevelKeys: Object.keys(payload),
        });
      } else if (response.status !== 404 && !fallbackUrl) {
        console.warn(`PHP workflow snapshot request failed with status ${response.status}`);
        return null;
      }
    } catch (err) {
      console.error('Workflow API ERROR (snapshot):', err?.response?.data || err.message);
      return null;
    }
  }

  if (!fallbackUrl) {
    return null;
  }

  try {
    const fallbackResponse = await axios.get(fallbackUrl, {
      params: { application_id: normalizedId },
      headers,
      withCredentials: true,
      timeout: Number(process.env.PHP_SNAPSHOT_TIMEOUT_MS || 10000),
      validateStatus: () => true,
    });

    if (debugEnabled) {
      console.log('PHP API RESPONSE (candidate_report):', {
        status: fallbackResponse.status,
        preview: previewPayload(fallbackResponse?.data),
      });
    }

    if (!fallbackResponse?.data) {
      console.warn('Invalid workflow response (candidate_report): empty body');
      return null;
    }

    if ('success' in fallbackResponse.data && fallbackResponse.data.success === false) {
      console.warn('Invalid workflow response (candidate_report):', fallbackResponse.data);
      return null;
    }

    if (fallbackResponse.status === 404 || fallbackResponse.status === 401 || fallbackResponse.status === 403) {
      return null;
    }

    if (fallbackResponse.status < 200 || fallbackResponse.status >= 300) {
      console.warn(`PHP candidate report request failed with status ${fallbackResponse.status}`);
      return null;
    }

    const parsedFallbackBody = coerceJsonLike(fallbackResponse.data);
    const fallbackPayload = normalizeObject(parsedFallbackBody);
    const normalized = normalizeCandidateReportPayload(fallbackPayload);
    normalized.workflowDebug = {
      ...normalized.workflowDebug,
      path: 'candidate_report_fallback',
      statusCode: fallbackResponse.status,
      bodyType: typeof parsedFallbackBody,
      topLevelKeys: Object.keys(fallbackPayload),
      hasData: Boolean(fallbackPayload.data),
      dataKeys: Object.keys(normalizeObject(fallbackPayload.data)),
      preview:
        typeof fallbackResponse.data === 'string'
          ? fallbackResponse.data.slice(0, 120)
          : null,
    };
    normalized.lastTimelineEvent =
      (await fetchLatestTimelineEvent(normalizedId, headers)) || normalized.lastTimelineEvent;
    return normalized;
  } catch (err) {
    console.error('Workflow API ERROR (candidate_report):', err?.response?.data || err.message);
    return null;
  }
}

module.exports = {
  fetchWorkflowSnapshot,
  pickWorkflowCurrentOwner,
};
