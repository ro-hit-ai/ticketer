const express = require('express');
const mongoose = require('mongoose');
const { requirePermission } = require('../lib/roles');
const Mailbox = require('../models/Mailbox');
const EmailQueue = require('../models/EmailQueue');

const router = express.Router();

router.post('/', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const { name, emailAddress, emailQueueId } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    if (!emailAddress || typeof emailAddress !== 'string' || !emailAddress.trim()) {
      return res.status(400).json({ success: false, message: 'emailAddress is required' });
    }

    if (emailQueueId && !mongoose.Types.ObjectId.isValid(emailQueueId)) {
      return res.status(400).json({ success: false, message: 'emailQueueId is invalid' });
    }

    if (emailQueueId) {
      const queueExists = await EmailQueue.exists({ _id: emailQueueId });
      if (!queueExists) {
        return res.status(404).json({ success: false, message: 'Email queue not found' });
      }
    }

    const mailbox = await Mailbox.findOneAndUpdate(
      { emailAddress: emailAddress.trim().toLowerCase() },
      {
        $setOnInsert: {
          name: name.trim(),
          emailAddress: emailAddress.trim().toLowerCase(),
          slug: req.body.slug || null,
          description: req.body.description || null,
          isShared: req.body.isShared !== undefined ? Boolean(req.body.isShared) : true,
          isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
          teamId: req.body.teamId || null,
          emailQueueId: emailQueueId || null,
          createdBy: req.user?._id || null,
          metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(201).json({
      success: true,
      mailbox,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const mailbox = await Mailbox.findOne({ emailAddress: req.body.emailAddress.trim().toLowerCase() });
      return res.status(200).json({
        success: true,
        mailbox,
      });
    }

    console.error('Error creating mailbox:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/', requirePermission(['integration::manage']), async (req, res) => {
  try {
    const query = {};

    if (req.query.active !== undefined) {
      query.isActive = String(req.query.active).toLowerCase() === 'true';
    }

    const mailboxes = await Mailbox.find(query)
      .populate('emailQueueId', 'name username serviceType active')
      .sort({ name: 1 });

    return res.json({
      success: true,
      mailboxes,
    });
  } catch (error) {
    console.error('Error fetching mailboxes:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
