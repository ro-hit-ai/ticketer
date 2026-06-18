const express = require('express');
const mongoose = require('mongoose');
const { requirePermission } = require('../lib/roles');
const Thread = require('../models/Thread');
const Message = require('../models/Message');
const Ticket = require('../models/Ticket');
const Mailbox = require('../models/Mailbox');
const { fetchWorkflowSnapshot, pickWorkflowCurrentOwner } = require('../lib/services/workflowSnapshot.service');
const { fetchAssignedApplications } = require('../lib/services/phpAccessScope.service');
const {
  authorizeLane,
  authorizeMessage,
  extractLaneContext,
  isShadowModeEnabled,
  mergeAuthorizationDecision,
} = require('../lib/services/phpAuthorizationClient.service');

const router = express.Router();

const threadPopulate = [
  { path: 'ticketId', select: 'number title status priority sourceCaseId currentStage claimedBy mailboxId createdAt updatedAt' },
  { path: 'mailboxId', select: 'name emailAddress slug isActive isShared' },
  { path: 'claimedBy', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

const inboxThreadFields = 'sourceCaseId subject lastMessage lastMessageAt unreadCount mailboxId';

function normalizeSourceCaseId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function parseBooleanQuery(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function normalizeUserId(value) {
  return value ? String(value).trim() : null;
}

function toObjectIdOrNull(value) {
  const normalized = normalizeUserId(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    return null;
  }
  return new mongoose.Types.ObjectId(normalized);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function isPrivilegedThreadAdmin(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;

  if (Array.isArray(user.permissions) && user.permissions.includes('*')) {
    return true;
  }

  if (Array.isArray(user.roles)) {
    return user.roles.some((role) => {
      const roleName =
        typeof role === 'string'
          ? role
          : (typeof role?.name === 'string' ? role.name : '');
      return roleName.trim().toLowerCase() === 'admin';
    });
  }

  return false;
}

function hasThreadOwnershipAccess(req, thread) {
  const currentUserId = normalizeUserId(req?.user?._id || req?.user?.id);
  if (!currentUserId || !thread) return false;

  const ownerCandidates = [
    normalizeUserId(thread.lastAssignedUserId),
    normalizeUserId(thread.workflowSnapshot?.currentUserId),
    normalizeUserId(thread.createdBy?._id || thread.createdBy),
    normalizeUserId(thread.claimedBy?._id || thread.claimedBy),
  ].filter(Boolean);

  return ownerCandidates.includes(currentUserId);
}

async function getCachedAccessScope(req) {
  if (!req) return { applicationIds: [] };
  if (!req._phpAccessScope) {
    req._phpAccessScope = await fetchAssignedApplications(req);
  }
  return req._phpAccessScope;
}



async function buildThreadAccessQuery(user, req) {
  if (!user) return { _id: null };
  if (isPrivilegedThreadAdmin(user)) return {};

  const normalizedUserId = normalizeUserId(user?._id || user?.id);
  const ownershipObjectId = toObjectIdOrNull(normalizedUserId);
  const ownershipConditions = normalizedUserId
    ? [
        { lastAssignedUserId: normalizedUserId },
        { 'workflowSnapshot.currentUserId': normalizedUserId },
        ...(ownershipObjectId ? [{ createdBy: ownershipObjectId }, { claimedBy: ownershipObjectId }] : []),
      ]
    : [];

  try {
    const scope = await fetchAssignedApplications(req);

    console.log("ACCESS SCOPE:", scope);

    if (scope?.applicationIds?.length) {
      if (ownershipConditions.length > 0) {
        return {
          $or: [
            { sourceCaseId: { $in: scope.applicationIds } },
            ...ownershipConditions,
          ],
        };
      }

      return {
        sourceCaseId: { $in: scope.applicationIds }
      };
    }

    console.warn("No PHP access scope found; limiting threads to explicit ownership only");
    return ownershipConditions.length > 0 ? { $or: ownershipConditions } : { _id: null };

  } catch (err) {
    console.error("Scope fetch failed:", err);
    return ownershipConditions.length > 0 ? { $or: ownershipConditions } : { _id: null };
  }
}

async function ensureNodeThreadAccess(req, thread) {
  if (!thread) {
    return {
      allowed: false,
      statusCode: 404,
      message: "Thread not found",
    };
  }

  if (isPrivilegedThreadAdmin(req?.user)) {
    return { allowed: true };
  }

  if (hasThreadOwnershipAccess(req, thread)) {
    return { allowed: true };
  }

  // Communication monitoring users are not workflow participants and have no
  // PHP session cookie. fetchAssignedApplications returns HTTP 401 for them,
  // producing an empty scope and a false denial. For non-workflow-principal
  // callers, the thread's existence in Mongo combined with successful Node
  // authentication is the access grant — the same implicit grant the list
  // route relies on when it passes { allowed: true } as nodeDecision.
  if (req?.user?.isWorkflowPrincipal !== true) {
    return { allowed: true };
  }

  const scope = await getCachedAccessScope(req);

  // ✅ IMPORTANT FIX
  if (!scope.applicationIds.length) {
    console.warn("No PHP access scope found; denying thread access");
    return {
      allowed: false,
      statusCode: 403,
      message: 'You do not have access to this thread',
    };
  }

  const normalizedSourceCaseId = normalizeSourceCaseId(thread.sourceCaseId);

  if (!normalizedSourceCaseId || !scope.applicationIds.includes(normalizedSourceCaseId)) {
    return {
      allowed: false,
      statusCode: 403,
      message: 'You do not have access to this thread',
    };
  }

  return { allowed: true };
}

async function ensureThreadAccess(req, thread, accessType = 'read') {
  if (!thread) {
    return {
      allowed: false,
      statusCode: 404,
      message: "Thread not found",
    };
  }

  const nodeDecision = await ensureNodeThreadAccess(req, thread);

  // Communication monitoring users are not workflow participants.
  // They have no PHP integer identity and authorizeLane returns
  // PHP_AUTH_TIMEOUT or unsupported_role for them — neither is a
  // meaningful authorization signal. For non-workflow-principal callers,
  // the Node scope decision is the complete access control answer.
  if (req?.user?.isWorkflowPrincipal !== true) {
    return nodeDecision.allowed
      ? { allowed: true }
      : {
          allowed: false,
          statusCode: nodeDecision.statusCode || 403,
          message: nodeDecision.message || 'You do not have access to this thread',
        };
  }

  const laneContext = extractLaneContext(thread, { accessType });
  const phpDecision = await authorizeLane(req, {
    ...laneContext,
    accessType,
  });

  const decision = mergeAuthorizationDecision({
    nodeDecision,
    phpDecision,
    shadowLog: {
      userId: normalizeUserId(req?.user?._id || req?.user?.id),
      applicationId: laneContext.applicationId,
      componentKey: laneContext.componentKey,
      ownerRole: laneContext.ownerRole,
      threadId: laneContext.threadId,
      accessType,
    },
  });

  return decision.allowed
    ? { allowed: true }
    : {
        allowed: false,
        statusCode: phpDecision.statusCode || nodeDecision.statusCode || 403,
        message: phpDecision.reason || nodeDecision.message || 'You do not have access to this thread',
      };
}

async function ensureApplicationLaneAccess(req, applicationId, accessType = 'read') {
  const normalizedApplicationId = normalizeSourceCaseId(applicationId);
  if (!normalizedApplicationId) {
    return {
      allowed: false,
      statusCode: 400,
      message: 'sourceCaseId is required',
    };
  }

  let nodeDecision = { allowed: true };
  if (!isPrivilegedThreadAdmin(req?.user)) {
    try {
      const scope = await getCachedAccessScope(req);
      nodeDecision =
        scope.applicationIds.length && scope.applicationIds.includes(normalizedApplicationId)
          ? { allowed: true }
          : { allowed: false, statusCode: 403, message: 'You do not have access to this application' };
    } catch (error) {
      nodeDecision = {
        allowed: false,
        statusCode: 403,
        message: 'You do not have access to this application',
      };
    }
  }

  const phpDecision = await authorizeLane(req, {
    applicationId: normalizedApplicationId,
    componentKey: null,
    ownerRole: null,
    threadId: null,
    accessType,
  });

  const decision = mergeAuthorizationDecision({
    nodeDecision,
    phpDecision,
    shadowLog: {
      userId: normalizeUserId(req?.user?._id || req?.user?.id),
      applicationId: normalizedApplicationId,
      componentKey: null,
      ownerRole: null,
      threadId: null,
      accessType,
    },
  });

  return decision.allowed
    ? { allowed: true }
    : {
        allowed: false,
        statusCode: nodeDecision.statusCode || 403,
        message: phpDecision.reason || nodeDecision.message || 'You do not have access to this application',
      };
}

async function filterAuthorizedThreads(req, threads, nodeDecision = { allowed: true }) {
  const authorized = [];

  // Workflow principals (PHP actors with isWorkflowPrincipal=true) carry a
  // PHP integer userId and require per-lane authorization via PHP.
  // Communication monitoring users are not workflow participants — they have
  // no PHP integer identity and authorizeLane always returns unsupported_role
  // for them. For monitoring users the Mongo query already scoped the result;
  // skip authorizeLane and use nodeDecision directly.
  const isWorkflowPrincipalCaller = req?.user?.isWorkflowPrincipal === true;

  for (const thread of threads) {
    let decision;

    if (isWorkflowPrincipalCaller) {
      const laneContext = extractLaneContext(thread);
      const phpDecision = await authorizeLane(req, {
        ...laneContext,
        accessType: 'read',
      });
      decision = mergeAuthorizationDecision({
        nodeDecision,
        phpDecision,
        shadowLog: {
          userId: normalizeUserId(req?.user?._id || req?.user?.id),
          applicationId: laneContext.applicationId,
          componentKey: laneContext.componentKey,
          ownerRole: laneContext.ownerRole,
          threadId: laneContext.threadId,
          accessType: 'read',
        },
      });
    } else {
      decision = nodeDecision;
    }

    if (decision.allowed) {
      const {
        componentKey,
        metadata,
        workflowSnapshot,
        lastAssignedUserId,
        createdBy,
        claimedBy,
        ...publicThread
      } = thread;
      authorized.push(publicThread);
    }
  }

  return authorized;
}

async function filterAuthorizedMessages(req, thread, messages, laneAccess) {
  const laneContext = extractLaneContext(thread);
  const authorized = [];

  for (const message of messages) {
    const messageId = String(message.externalMessageId || message._id || '').trim() || null;
    const phpDecision = await authorizeMessage(req, {
      ...laneContext,
      messageId,
      sourceMessageKey: message.emailMessageId ? String(message.emailMessageId) : null,
      accessType: 'read',
    });
    const decision = mergeAuthorizationDecision({
      nodeDecision: laneAccess,
      phpDecision,
      shadowLog: {
        userId: normalizeUserId(req?.user?._id || req?.user?.id),
        applicationId: laneContext.applicationId,
        componentKey: laneContext.componentKey,
        ownerRole: laneContext.ownerRole,
        threadId: laneContext.threadId,
        messageId,
        accessType: 'read',
      },
    });

    if (decision.allowed) {
      authorized.push(message);
    }
  }

  return authorized;
}

function hasPhpLaneIdentifier(thread) {
  return Boolean(extractLaneContext(thread).threadId);
}

function logMissingWorkflowLaneContext(req, route, context = {}) {
  const laneContext = extractLaneContext(context.thread || {
    sourceCaseId: context.sourceCaseId || null,
  });
  console.warn(JSON.stringify({
    event: 'missing_workflow_lane_context',
    route,
    userId: normalizeUserId(req?.user?._id || req?.user?.id),
    applicationId: laneContext.applicationId || normalizeSourceCaseId(context.sourceCaseId),
    componentKey: laneContext.componentKey,
    ownerRole: laneContext.ownerRole,
    threadId: laneContext.threadId,
    reason: context.reason || 'LANE_IDENTITY_REQUIRED',
  }));
}

async function resolveThreadWorkflowSnapshot(thread, req = null) {
  if (!thread?.sourceCaseId) {
    return null;
  }

  try {
    return await fetchWorkflowSnapshot(thread.sourceCaseId, {
      cookie: req?.headers?.cookie || '',
      userAgent: req?.headers?.['user-agent'] || '',
    });
  } catch (error) {
    console.error(`Error fetching workflow snapshot for ${thread.sourceCaseId}:`, error.message);
    return null;
  }
}

router.post('/', requirePermission([]), async (req, res) => {
  try {
    const { sourceCaseId, mailboxId } = req.body;

    if (!sourceCaseId || typeof sourceCaseId !== 'string' || !sourceCaseId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'sourceCaseId is required',
      });
    }

    if (mailboxId && !mongoose.Types.ObjectId.isValid(mailboxId)) {
      return res.status(400).json({
        success: false,
        message: 'mailboxId is invalid',
      });
    }

    if (mailboxId) {
      const mailboxExists = await Mailbox.exists({ _id: mailboxId });
      if (!mailboxExists) {
        return res.status(404).json({
          success: false,
          message: 'Mailbox not found',
        });
      }
    }

    if (req.body.ticketId && !mongoose.Types.ObjectId.isValid(req.body.ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'ticketId is invalid',
      });
    }

    if (req.body.ticketId) {
      const ticketExists = await Ticket.exists({ _id: req.body.ticketId });
      if (!ticketExists) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found',
        });
      }
    }

    const normalizedSourceCaseId = normalizeSourceCaseId(sourceCaseId);
    const existingAccessCandidate = await Thread.findOne({ sourceCaseId: normalizedSourceCaseId })
      .select('sourceCaseId lastAssignedUserId workflowSnapshot createdBy claimedBy')
      .lean();
    if (existingAccessCandidate) {
      const access = await ensureThreadAccess(req, existingAccessCandidate);
      if (!access.allowed) {
        return res.status(access.statusCode || 403).json({
          success: false,
          message: access.message || 'You do not have access to this thread',
        });
      }
    }

    const existing = existingAccessCandidate
      ? await Thread.findById(existingAccessCandidate._id).populate(threadPopulate)
      : null;
    if (existing) {
      const requesterId = normalizeUserId(req.user?._id || req.user?.id);
      let shouldSaveExisting = false;

      if (requesterId && !existing.lastAssignedUserId) {
        existing.lastAssignedUserId = requesterId;
        shouldSaveExisting = true;
      }

      if (requesterId && !existing.createdBy) {
        existing.createdBy = requesterId;
        shouldSaveExisting = true;
      }

      if (shouldSaveExisting) {
        await existing.save();
      }

      return res.json({
        success: true,
        created: false,
        thread: existing,
      });
    }

    if (!isPrivilegedThreadAdmin(req?.user)) {
      const scope = await getCachedAccessScope(req);
      if (!scope.applicationIds.length || !scope.applicationIds.includes(normalizedSourceCaseId)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this thread',
        });
      }
    }

    const thread = await Thread.create({
      sourceCaseId: normalizedSourceCaseId,
      subject: `Verification – ${normalizedSourceCaseId}`,
      status: 'open',
      createdBy: req.user?._id || req.user?.id || null,
      lastAssignedUserId: req.user?.id || req.user?._id || null,
    });

    const populatedThread = await Thread.findById(thread._id).populate(threadPopulate);

    return res.json({
      success: true,
      created: true,
      thread: populatedThread,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const threadAccessCandidate = await Thread.findOne({
        sourceCaseId: normalizeSourceCaseId(req.body.sourceCaseId),
      }).select('sourceCaseId lastAssignedUserId workflowSnapshot createdBy claimedBy');

      const access = await ensureThreadAccess(req, threadAccessCandidate);
      if (!access.allowed) {
        return res.status(access.statusCode || 403).json({
          success: false,
          message: access.message || 'You do not have access to this thread',
        });
      }

      const thread = threadAccessCandidate
        ? await Thread.findById(threadAccessCandidate._id).populate(threadPopulate)
        : null;

      if (thread) {
        const requesterId = normalizeUserId(req.user?._id || req.user?.id);
        let shouldSaveThread = false;

        if (requesterId && !thread.lastAssignedUserId) {
          thread.lastAssignedUserId = requesterId;
          shouldSaveThread = true;
        }

        if (requesterId && !thread.createdBy) {
          thread.createdBy = requesterId;
          shouldSaveThread = true;
        }

        if (shouldSaveThread) {
          await thread.save();
        }
      }

      return res.status(200).json({
        success: true,
        created: false,
        thread,
      });
    }

    console.error('Error creating or fetching thread:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/', requirePermission([]), async (req, res) => {
  try {
    const query = {};
    const includeMonitoring = parseBooleanQuery(req.query.includeMonitoring);

    if (req.query.sourceCaseId) {
      query.sourceCaseId = normalizeSourceCaseId(req.query.sourceCaseId);
    }

    if (req.query.status) {
      query.status = req.query.status;
    } else if (includeMonitoring !== true) {
      query.status = { $ne: 'monitoring' };
    }

    if (req.query.mailboxId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.mailboxId)) {
        return res.status(400).json({
          success: false,
          message: 'mailboxId is invalid',
        });
      }
      query.mailboxId = req.query.mailboxId;
    }

    const accessQuery = await buildThreadAccessQuery(req.user, req);
    const nodeFinalQuery =
      Object.keys(accessQuery).length === 0
        ? query
        : Object.keys(query).length === 0
          ? accessQuery
          : { $and: [query, accessQuery] };
    const candidateQuery = isShadowModeEnabled() ? nodeFinalQuery : query;

    const threads = await Thread.find(candidateQuery)
      .select(`${inboxThreadFields} componentKey metadata workflowSnapshot lastAssignedUserId createdBy claimedBy`)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean();
    const authorizedThreads = await filterAuthorizedThreads(req, threads, { allowed: true });

    return res.json({
      success: true,
      threads: authorizedThreads,
    });
  } catch (error) {
    console.error('Error fetching threads:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/source/:sourceCaseId', requirePermission([]), async (req, res) => {
  try {
    const sourceCaseId = normalizeSourceCaseId(req.params.sourceCaseId);
    if (!sourceCaseId) {
      return res.status(400).json({
        success: false,
        message: 'sourceCaseId is required',
      });
    }

    const thread = await Thread.findOne({ sourceCaseId }).populate(threadPopulate);
    if (!thread) {
      logMissingWorkflowLaneContext(req, 'GET /api/v1/threads/source/:sourceCaseId', {
        sourceCaseId,
        reason: 'THREAD_NOT_FOUND_FOR_SOURCE_CASE',
      });
      return res.status(404).json({
        success: false,
        message: 'Thread not found',
      });
    }

    if (!hasPhpLaneIdentifier(thread)) {
      logMissingWorkflowLaneContext(req, 'GET /api/v1/threads/source/:sourceCaseId', {
        sourceCaseId,
        thread,
      });
    }

    const access = await ensureThreadAccess(req, thread);
    if (!access.allowed) {
      return res.status(access.statusCode).json({
        success: false,
        message: access.message,
        ...(access.scope ? { scope: access.scope } : {}),
      });
    }

    return res.json({
      success: true,
      thread,
    });
  } catch (error) {
    console.error('Error fetching thread by sourceCaseId:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/source/:sourceCaseId/workflow', requirePermission([]), async (req, res) => {
  try {
    const sourceCaseId = normalizeSourceCaseId(req.params.sourceCaseId);
    if (!sourceCaseId) {
      return res.status(400).json({
        success: false,
        message: 'sourceCaseId is required',
      });
    }

    const debugEnabled = req.query.debug === '1' || req.query.debug === 'true';

    const thread = await Thread.findOne({ sourceCaseId }).populate(threadPopulate);
    if (thread) {
      if (!hasPhpLaneIdentifier(thread)) {
        logMissingWorkflowLaneContext(req, 'GET /api/v1/threads/source/:sourceCaseId/workflow', {
          sourceCaseId,
          thread,
        });
      }

      const access = await ensureThreadAccess(req, thread);
      if (!access.allowed) {
        return res.status(access.statusCode).json({
          success: false,
          message: access.message,
          ...(access.scope ? { scope: access.scope } : {}),
        });
      }
    } else {
      logMissingWorkflowLaneContext(req, 'GET /api/v1/threads/source/:sourceCaseId/workflow', {
        sourceCaseId,
        reason: 'THREAD_NOT_FOUND_FOR_SOURCE_CASE',
      });
      return res.status(403).json({
        success: false,
        message: 'Workflow lane identity is required',
      });
    }

    const workflow = await fetchWorkflowSnapshot(sourceCaseId, {
      cookie: req?.headers?.cookie || '',
      userAgent: req?.headers?.['user-agent'] || '',
    });

    return res.json({
      success: true,
      sourceCaseId,
      thread,
      workflow,
      ...(debugEnabled
        ? {
            workflowFetchDebug: {
              phpBaseUrlConfigured: Boolean(process.env.APP_URL || process.env.PHP_APP_URL),
              phpApiKeyConfigured: Boolean(process.env.PHP_API_KEY),
              requestHasCookieHeader: Boolean(req?.headers?.cookie),
              requestCookieLength: (req?.headers?.cookie || '').length,
              requestHasAuthorizationHeader: Boolean(req?.headers?.authorization),
              note:
                'If workflow is null, check server logs with WORKFLOW_SNAPSHOT_DEBUG=true to see PHP response status/body preview.',
            },
          }
        : {}),
    });
  } catch (error) {
    console.error('Error fetching workflow by sourceCaseId:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/:id/full', requirePermission([]), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid thread id',
      });
    }

    const thread = await Thread.findById(req.params.id).populate(threadPopulate);
    if (!thread) {
      return res.status(404).json({
        success: false,
        message: 'Thread not found',
      });
    }

    const access = await ensureThreadAccess(req, thread);
    if (!access.allowed) {
      return res.status(access.statusCode).json({
        success: false,
        message: access.message,
        ...(access.scope ? { scope: access.scope } : {}),
      });
    }

    const messages = await Message.find({ threadId: req.params.id }).sort({ createdAt: 1 });
    const authorizedMessages = await filterAuthorizedMessages(req, thread, messages, access);
    const workflow = await resolveThreadWorkflowSnapshot(thread, req);
    const storedWorkflowSnapshot = thread?.metadata?.workflowSnapshot || thread?.metadata?.workflow_snapshot || null;
    const effectiveWorkflow = workflow || storedWorkflowSnapshot || null;

    let shouldSaveThread = false;
    if (thread.unreadCount !== 0) {
      thread.unreadCount = 0;
      shouldSaveThread = true;
    }

    if (effectiveWorkflow) {
      const currentOwner = pickWorkflowCurrentOwner(effectiveWorkflow);
      thread.workflowSnapshot = {
        currentUserId: currentOwner?.userId || currentOwner?.user_id || currentOwner?.id || null,
        currentUserName: currentOwner?.name || currentOwner?.userName || currentOwner?.user_name || null,
        currentRole: effectiveWorkflow.currentStage || null,
        assignedAt: new Date(),
        assignmentSource: workflow ? 'PHP_SNAPSHOT' : 'STORED_SNAPSHOT',
      };

      if (thread.workflowSnapshot.currentUserId) {
        thread.lastAssignedUserId = thread.workflowSnapshot.currentUserId || thread.lastAssignedUserId;
      }

      shouldSaveThread = true;
    }

    if (!thread.applicantEmail && effectiveWorkflow?.candidateEmail) {
      const normalizedApplicantEmail = normalizeEmail(effectiveWorkflow.candidateEmail);
      if (normalizedApplicantEmail) {
        thread.applicantEmail = normalizedApplicantEmail;
        shouldSaveThread = true;
      }
    }

    if (shouldSaveThread) {
      await thread.save();
    }

    if (!effectiveWorkflow) {
      console.warn('Workflow missing → using fallback', { sourceCaseId: thread.sourceCaseId });
      if (!thread.workflowSnapshot?.assignedAt && !thread.workflowSnapshot?.assignmentSource) {
        thread.workflowSnapshot = {
          currentUserId: thread.lastAssignedUserId || null,
          currentUserName: null,
          currentRole: 'VERIFICATION',
          assignedAt: new Date(),
          assignmentSource: 'FALLBACK',
        };
        await thread.save();
      }
    }

    return res.json({
      success: true,
      thread,
      messages: authorizedMessages,
      workflow: effectiveWorkflow,
    });
  } catch (error) {
    console.error('Error fetching full thread:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/:id/workflow', requirePermission([]), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid thread id',
      });
    }

    const thread = await Thread.findById(req.params.id).select(
      'sourceCaseId componentKey metadata.ownerRole metadata.phpThreadId metadata.workflow lastAssignedUserId workflowSnapshot createdBy claimedBy'
    );
    if (!thread) {
      return res.status(404).json({
        success: false,
        message: 'Thread not found',
      });
    }

    const access = await ensureThreadAccess(req, thread);
    if (!access.allowed) {
      return res.status(access.statusCode).json({
        success: false,
        message: access.message,
        ...(access.scope ? { scope: access.scope } : {}),
      });
    }

    const workflow = await resolveThreadWorkflowSnapshot(thread, req);
    const storedWorkflowSnapshot = thread?.metadata?.workflowSnapshot || thread?.metadata?.workflow_snapshot || null;
    const effectiveWorkflow = workflow || storedWorkflowSnapshot || null;

    return res.json({
      success: true,
      workflow: effectiveWorkflow,
    });
  } catch (error) {
    console.error('Error fetching thread workflow:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/:id', requirePermission([]), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid thread id',
      });
    }

    const thread = await Thread.findById(req.params.id).populate(threadPopulate);
    if (!thread) {
      return res.status(404).json({
        success: false,
        message: 'Thread not found',
      });
    }

    const access = await ensureThreadAccess(req, thread);
    if (!access.allowed) {
      return res.status(access.statusCode).json({
        success: false,
        message: access.message,
        ...(access.scope ? { scope: access.scope } : {}),
      });
    }

    if (thread.unreadCount !== 0) {
      thread.unreadCount = 0;
      await thread.save();
    }

    return res.json({
      success: true,
      thread,
    });
  } catch (error) {
    console.error('Error fetching thread:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;

