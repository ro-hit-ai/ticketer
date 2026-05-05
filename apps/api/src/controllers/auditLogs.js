const express = require('express');
const { requirePermission } = require('../lib/roles');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

router.get('/', requirePermission(['integration::manage'], false), async (req, res) => {
  try {
    const {
      eventType,
      entityType,
      entityId,
      startDate,
      endDate,
      limit = 50,
      page = 1,
    } = req.query;

    const parsedLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
    const parsedPage = Math.max(Number(page || 1), 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const query = {};
    if (eventType) query.eventType = String(eventType).trim();
    if (entityType) query.entityType = String(entityType).trim();
    if (entityId) query.entityId = String(entityId).trim();

    if (startDate || endDate) {
      query.at = {};
      if (startDate) query.at.$gte = new Date(String(startDate));
      if (endDate) query.at.$lte = new Date(String(endDate));
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query).sort({ at: -1 }).skip(skip).limit(parsedLimit).lean(),
      AuditLog.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      filters: { eventType: eventType || null, entityType: entityType || null, entityId: entityId || null, startDate: startDate || null, endDate: endDate || null },
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit),
      },
      logs,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
