const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const TicketFile = require('../models/TicketFile');
const Ticket = require('../models/Ticket');
const Thread = require('../models/Thread');
const Message = require('../models/Message');
const { requirePermission } = require('../lib/roles');
const { fetchAssignedApplications } = require('../lib/services/phpAccessScope.service');
const {
  authorizeAttachment,
  extractLaneContext,
  mergeAuthorizationDecision,
} = require('../lib/services/phpAuthorizationClient.service');

const router = express.Router();

function normalizeUserId(value) {
  return value ? String(value).trim() : null;
}

function normalizeSourceCaseId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function isPrivilegedThreadAdmin(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  if (Array.isArray(user.permissions) && user.permissions.includes('*')) return true;

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

function hasExplicitOwnershipAccess(req, ticket, thread) {
  const currentUserId = normalizeUserId(req?.user?._id || req?.user?.id);
  if (!currentUserId) return false;

  const ownerCandidates = [
    normalizeUserId(ticket?.createdBy),
    normalizeUserId(ticket?.assignedTo),
    normalizeUserId(ticket?.claimedBy),
    normalizeUserId(thread?.lastAssignedUserId),
    normalizeUserId(thread?.workflowSnapshot?.currentUserId),
    normalizeUserId(thread?.createdBy),
    normalizeUserId(thread?.claimedBy),
  ].filter(Boolean);

  return ownerCandidates.includes(currentUserId);
}

async function ensureNodeTicketAttachmentAccess(req, ticketId) {
  if (isPrivilegedThreadAdmin(req?.user)) {
    return { allowed: true };
  }

  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    return { allowed: false, statusCode: 404, message: 'Ticket not found' };
  }

  const ticket = await Ticket.findById(ticketId)
    .select('sourceCaseId threadId createdBy assignedTo claimedBy')
    .lean();
  if (!ticket) {
    return { allowed: false, statusCode: 404, message: 'Ticket not found' };
  }

  const thread = ticket.threadId
    ? await Thread.findById(ticket.threadId)
      .select('sourceCaseId lastAssignedUserId workflowSnapshot createdBy claimedBy')
      .lean()
    : null;

  if (hasExplicitOwnershipAccess(req, ticket, thread)) {
    return { allowed: true };
  }

  const sourceCaseId = normalizeSourceCaseId(ticket.sourceCaseId || thread?.sourceCaseId);
  const scope = await fetchAssignedApplications(req);
  if (!sourceCaseId || !scope.applicationIds.length || !scope.applicationIds.includes(sourceCaseId)) {
    return {
      allowed: false,
      statusCode: 403,
      message: 'You do not have access to this attachment',
    };
  }

  return { allowed: true };
}

async function getAttachmentAuthorizationContext(ticketId, file = null) {
  const ticket = mongoose.Types.ObjectId.isValid(ticketId)
    ? await Ticket.findById(ticketId)
      .select('sourceCaseId threadId createdBy assignedTo claimedBy')
      .lean()
    : null;
  const thread = ticket?.threadId
    ? await Thread.findById(ticket.threadId)
      .select('sourceCaseId componentKey metadata lastAssignedUserId workflowSnapshot createdBy claimedBy')
      .lean()
    : null;
  const laneContext = extractLaneContext(thread || {
    sourceCaseId: ticket?.sourceCaseId || null,
  });
  const messageContext = await resolveAttachmentMessageContext(ticket, thread);
  const messageWorkflow =
    messageContext?.metadata?.workflow && typeof messageContext.metadata.workflow === 'object'
      ? messageContext.metadata.workflow
      : {};
  const effectiveLaneContext = {
    ...laneContext,
    componentKey:
      laneContext.componentKey ||
      messageWorkflow.componentKey ||
      messageWorkflow.component_key ||
      null,
    ownerRole:
      laneContext.ownerRole ||
      messageContext?.sentByRole ||
      messageWorkflow.ownerRole ||
      messageWorkflow.threadOwnerRole ||
      messageWorkflow.thread_owner_role ||
      messageWorkflow.senderRole ||
      null,
    threadId:
      laneContext.threadId ||
      messageWorkflow.threadId ||
      messageWorkflow.thread_id ||
      null,
  };
  return {
    ticket,
    thread,
    message: messageContext,
    laneContext: effectiveLaneContext,
    attachmentId: file?._id ? String(file._id) : null,
  };
}

async function resolveAttachmentMessageContext(ticket, thread) {
  if (!ticket?._id && !thread?._id) {
    return null;
  }

  const query = {
    $or: [
      ...(ticket?._id ? [{ ticketId: ticket._id }] : []),
      ...(thread?._id ? [{ threadId: thread._id }] : []),
    ],
  };

  if (!query.$or.length) {
    return null;
  }

  const candidates = await Message.find(query)
    .select('externalMessageId emailMessageId sourceCaseId sentByRole metadata threadId ticketId')
    .sort({ createdAt: -1 })
    .limit(2)
    .lean();

  return candidates.length === 1 ? candidates[0] : null;
}

function logMissingAttachmentContext({ req, laneContext, file, message, ticketId }) {
  const missing = [];
  if (!message?.externalMessageId && !message?._id) missing.push('messageId');
  if (!laneContext?.componentKey) missing.push('componentKey');
  if (!laneContext?.ownerRole) missing.push('ownerRole');

  if (!missing.length) return;

  console.warn(JSON.stringify({
    event: 'missing_attachment_authorization_context',
    userId: normalizeUserId(req?.user?._id || req?.user?.id),
    attachmentId: file?._id ? String(file._id) : null,
    ticketId: ticketId ? String(ticketId) : null,
    messageId: message?.externalMessageId || (message?._id ? String(message._id) : null),
    componentKey: laneContext?.componentKey || null,
    ownerRole: laneContext?.ownerRole || null,
    threadId: laneContext?.threadId || null,
    missing,
  }));
}

async function ensureTicketAttachmentAccess(req, ticketId, options = {}) {
  const nodeDecision = await ensureNodeTicketAttachmentAccess(req, ticketId);
  const context = await getAttachmentAuthorizationContext(ticketId, options.file || null);
  logMissingAttachmentContext({
    req,
    laneContext: context.laneContext,
    file: options.file || null,
    message: context.message,
    ticketId,
  });
  const phpDecision = await authorizeAttachment(req, {
    ...context.laneContext,
    messageId: context.message?.externalMessageId || (context.message?._id ? String(context.message._id) : null),
    sourceMessageKey: context.message?.emailMessageId ? String(context.message.emailMessageId) : null,
    attachmentId: context.attachmentId || options.attachmentId || null,
    ticketId,
    accessType: options.accessType || 'read',
  });

  const decision = mergeAuthorizationDecision({
    nodeDecision,
    phpDecision,
    shadowLog: {
      userId: normalizeUserId(req?.user?._id || req?.user?.id),
      applicationId: context.laneContext.applicationId,
      componentKey: context.laneContext.componentKey,
      ownerRole: context.laneContext.ownerRole,
      threadId: context.laneContext.threadId,
      attachmentId: context.attachmentId || options.attachmentId || null,
      ticketId,
      accessType: options.accessType || 'read',
    },
  });

  return decision.allowed
    ? { allowed: true }
    : {
        allowed: false,
        statusCode: nodeDecision.statusCode || 403,
        message: phpDecision.reason || nodeDecision.message || 'You do not have access to this attachment',
      };
}

async function ensureFileAttachmentAccess(req, fileId, options = {}) {
  if (!mongoose.Types.ObjectId.isValid(fileId)) {
    return {
      allowed: false,
      statusCode: 404,
      message: 'File not found',
      file: null,
    };
  }

  const file = await TicketFile.findById(fileId);
  if (!file) {
    return {
      allowed: false,
      statusCode: 404,
      message: 'File not found',
      file: null,
    };
  }

  const access = await ensureTicketAttachmentAccess(req, file.ticketId, {
    file,
    attachmentId: fileId,
    accessType: options.accessType || 'read',
  });
  return {
    ...access,
    file: access.allowed ? file : null,
  };
}

function requireTicketAttachmentAccess(req, res, next) {
  ensureTicketAttachmentAccess(req, req.params.id, {
    accessType: req.method === 'POST' ? 'write' : 'read',
  })
    .then((access) => {
      if (!access.allowed) {
        return res.status(access.statusCode || 403).send({
          success: false,
          message: access.message || 'You do not have access to this attachment',
        });
      }
      return next();
    })
    .catch((error) => {
      console.error('Error checking attachment access:', error);
      return res.status(500).send({
        success: false,
        message: 'Internal server error',
      });
    });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Optional: Add file type validation
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Upload single file for ticket
router.post(
  "/ticket/:id/upload/single",
  requirePermission(['issue::update']),
  requireTicketAttachmentAccess,
  upload.single("file"),
  async (req, res) => {
    try {
      console.log(req.file);
      console.log(req.body);

      if (!req.file) {
        return res.status(400).send({
          success: false,
          message: "No file uploaded"
        });
      }

      const uploadedFile = await TicketFile.create({
        ticketId: req.params.id,
        filename: req.file.originalname,
        path: req.file.path,
        mime: req.file.mimetype,
        size: req.file.size,
        encoding: req.file.encoding,
        userId: req.body.user,
      });

      console.log(uploadedFile);

      res.status(200).send({
        success: true,
        fileId: uploadedFile._id,
        message: "File uploaded successfully"
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get all ticket attachments
router.get(
  "/ticket/:id/files",
  requirePermission(['issue::read']),
  async (req, res) => {
    try {
      const { id } = req.params;

      const access = await ensureTicketAttachmentAccess(req, id);
      if (!access.allowed) {
        return res.status(access.statusCode || 403).send({
          success: false,
          message: access.message || 'You do not have access to this attachment',
        });
      }

      const files = await TicketFile.find({ ticketId: id })
        .populate('userId', 'name email')
        .select('filename mime size createdAt userId');

      res.status(200).send({
        success: true,
        files: files
      });
    } catch (error) {
      console.error("Error fetching ticket files:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Delete an attachment
router.delete(
  "/file/:fileId/delete",
  requirePermission(['issue::update']),
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const access = await ensureFileAttachmentAccess(req, fileId, { accessType: 'delete' });
      if (!access.allowed) {
        return res.status(access.statusCode || 403).send({
          success: false,
          message: access.message || "File not found"
        });
      }
      const file = access.file;

      // Delete the physical file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      // Delete the database record
      await TicketFile.findByIdAndDelete(fileId);

      res.status(200).send({
        success: true,
        message: "File deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Download an attachment
router.get(
  "/file/:fileId/download",
  requirePermission(['issue::read']),
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const access = await ensureFileAttachmentAccess(req, fileId);
      if (!access.allowed) {
        return res.status(access.statusCode || 403).send({
          success: false,
          message: access.message || "File not found"
        });
      }
      const file = access.file;

      if (!fs.existsSync(file.path)) {
        return res.status(404).send({
          success: false,
          message: "File not found on server"
        });
      }

      // Set appropriate headers for download
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Content-Length', file.size);

      // Stream the file
      const fileStream = fs.createReadStream(file.path);
      fileStream.pipe(res);

      // Handle stream errors
      fileStream.on('error', (error) => {
        console.error("Error streaming file:", error);
        res.status(500).send({
          success: false,
          message: "Error downloading file"
        });
      });

    } catch (error) {
      console.error("Error downloading file:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get file info (without downloading)
router.get(
  "/file/:fileId/info",
  requirePermission(['issue::read']),
  async (req, res) => {
    try {
      const { fileId } = req.params;

      const access = await ensureFileAttachmentAccess(req, fileId);
      if (!access.allowed) {
        return res.status(access.statusCode || 403).send({
          success: false,
          message: access.message || "File not found"
        });
      }
      const file = await TicketFile.findById(fileId)
        .populate('userId', 'name email')
        .select('filename mime size createdAt userId ticketId');

      res.status(200).send({
        success: true,
        file: file
      });
    } catch (error) {
      console.error("Error fetching file info:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

module.exports = router;
