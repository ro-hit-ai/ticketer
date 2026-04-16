const express = require('express');
const mongoose = require('mongoose');
const { requirePermission } = require('../lib/roles');
const Thread = require('../models/Thread');
const Message = require('../models/Message');
const Ticket = require('../models/Ticket');
const Mailbox = require('../models/Mailbox');
const { fetchWorkflowSnapshot } = require('../lib/services/workflowSnapshot.service');
const { fetchAssignedApplications } = require('../lib/services/phpAccessScope.service');

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

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

async function getCachedAccessScope(req) {
  if (!req) return { applicationIds: [] };
  if (!req._phpAccessScope) {
    req._phpAccessScope = await fetchAssignedApplications(req);
  }
  return req._phpAccessScope;
}



async function buildThreadAccessQuery(user, req) {
  if (!user) return {};

  try {
    const scope = await fetchAssignedApplications(req);

    console.log("ACCESS SCOPE:", scope);

    // ✅ If PHP returns valid applications
    if (scope?.applicationIds?.length) {
      return {
        sourceCaseId: { $in: scope.applicationIds }
      };
    }

    // ⚠️ FALLBACK (IMPORTANT)
    console.warn("No scope found → fallback to ALL threads");

    return {}; // show all threads instead of empty

  } catch (err) {
    console.error("Scope fetch failed:", err);

    // ⚠️ FAIL SAFE
    return {};
  }
}

async function ensureThreadAccess(req, thread) {
  if (!thread) {
    return {
      allowed: false,
      statusCode: 404,
      message: "Thread not found",
    };
  }

  if (req?.user?.isAdmin) {
    return { allowed: true };
  }

  const scope = await getCachedAccessScope(req);

  // ✅ IMPORTANT FIX
  if (!scope.applicationIds.length) {
    console.warn("No scope → fallback allow");
    return { allowed: true };
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
    const existing = await Thread.findOne({ sourceCaseId: normalizedSourceCaseId }).populate(threadPopulate);
    if (existing) {
      return res.json({
        success: true,
        created: false,
        thread: existing,
      });
    }

    const thread = await Thread.create({
      sourceCaseId: normalizedSourceCaseId,
      subject: `Verification – ${normalizedSourceCaseId}`,
      status: 'open',
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
      const thread = await Thread.findOne({
        sourceCaseId: normalizeSourceCaseId(req.body.sourceCaseId),
      }).populate(threadPopulate);

      if (thread && !thread.lastAssignedUserId) {
        thread.lastAssignedUserId = normalizeUserId(req.user?._id || req.user?.id);
        await thread.save();
      }

      const access = await ensureThreadAccess(req, thread);
      if (!access.allowed) {
        return res.status(access.statusCode).json({
          success: false,
          message: access.message,
          ...(access.scope ? { scope: access.scope } : {}),
        });
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
    const finalQuery =
      Object.keys(accessQuery).length === 0
        ? query
        : Object.keys(query).length === 0
          ? accessQuery
          : { $and: [query, accessQuery] };

    const threads = await Thread.find(finalQuery)
      .select(inboxThreadFields)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean();

    return res.json({
      success: true,
      threads,
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

    // Enforce PHP assignment scope for non-admin users even if the thread doesn't exist yet.
    if (!req.user?.isAdmin) {
      const scope = await getCachedAccessScope(req);
      if (scope.applicationIds.length > 0 && !scope.applicationIds.includes(sourceCaseId)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this application',
        });
      }
    }

    const thread = await Thread.findOne({ sourceCaseId }).populate(threadPopulate);
    if (thread) {
      const access = await ensureThreadAccess(req, thread);
      if (!access.allowed) {
        return res.status(access.statusCode).json({
          success: false,
          message: access.message,
          ...(access.scope ? { scope: access.scope } : {}),
        });
      }
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

    const thread = await Thread.findByIdAndUpdate(
      req.params.id,
      { $set: { unreadCount: 0 } },
      { new: true }
    ).populate(threadPopulate);
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
    const workflow = await resolveThreadWorkflowSnapshot(thread, req);

    let shouldSaveThread = false;

    if (workflow) {
      thread.workflowSnapshot = {
        currentUserId: workflow.ownerSummary?.validator?.userId || null,
        currentUserName: workflow.ownerSummary?.validator?.name || null,
        currentRole: workflow.currentStage || null,
        assignedAt: new Date(),
        assignmentSource: 'PHP_SNAPSHOT',
      };

      if (thread.workflowSnapshot.currentUserId) {
        thread.lastAssignedUserId = thread.workflowSnapshot.currentUserId || thread.lastAssignedUserId;
      }

      shouldSaveThread = true;
    }

    if (!thread.applicantEmail && workflow?.candidateEmail) {
      const normalizedApplicantEmail = normalizeEmail(workflow.candidateEmail);
      if (normalizedApplicantEmail) {
        thread.applicantEmail = normalizedApplicantEmail;
        shouldSaveThread = true;
      }
    }

    if (shouldSaveThread) {
      await thread.save();
    }

    if (!workflow) {
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
      messages,
      workflow,
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

    const thread = await Thread.findById(req.params.id).select('sourceCaseId');
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

    return res.json({
      success: true,
      workflow,
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

    const thread = await Thread.findByIdAndUpdate(
      req.params.id,
      { $set: { unreadCount: 0 } },
      { new: true }
    ).populate(threadPopulate);
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
