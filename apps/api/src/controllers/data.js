const express = require('express');
const { requirePermission } = require('../lib/roles');
const Ticket = require('../models/Ticket');
const fs = require('fs/promises');

const router = express.Router();

// Get total count of all tickets
router.get('/tickets/all', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ hidden: false });
  res.json({ count });
});

// Get total count of all completed tickets
router.get('/tickets/completed', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ isComplete: true, hidden: false });
  res.json({ count });
});

// Get total count of all open tickets
router.get('/tickets/open', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ isComplete: false, hidden: false });
  res.json({ count });
});

// Get total of all unassigned tickets
router.get('/tickets/unassigned', requirePermission(['issue::read']), async (req, res) => {
  const count = await Ticket.countDocuments({ userId: null, hidden: false, isComplete: false });
  res.json({ count });
});

// Get all logs
router.get('/logs', requirePermission(['settings::view', 'settings::manage'], false), async (req, res) => {
  try {
    const logs = await fs.readFile('logs.log', 'utf-8');
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ message: 'Could not read log file', error: error.message });
  }
});

module.exports = router;
