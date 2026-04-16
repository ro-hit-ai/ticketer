const express = require('express');
const Notification = require('../../../../models/Notification');
const Ticket = require('../../../../models/Ticket');
const User = require('../../../../models/User');

const router = express.Router();

/**
 * Creates priority change notifications for all ticket followers.
 * @param {object} issue - The ticket object
 * @param {object} updatedBy - The user object who updated the priority
 * @param {string} oldPriority - The old priority value
 * @param {string} newPriority - The new priority value
 * @returns {Promise<void>}
 */
async function priorityNotification(issue, updatedBy, oldPriority, newPriority) {
  try {
    const text = `Priority changed on #${issue.Number} from ${oldPriority} to ${newPriority} by ${updatedBy.name}`;

    // Get all followers of the ticket, ensuring the creator is not already a follower
    const followers = [
      ...(issue.following || []),
      ...(issue.following && issue.following.includes(issue.createdBy.toString())
        ? []
        : [issue.createdBy])
    ];

    // Create notifications for all followers (except the person who updated)
    const notificationData = followers
      .filter(userId => userId.toString() !== updatedBy._id.toString())
      .map(userId => ({
        text,
        userId,
        ticketId: issue._id
      }));

    if (notificationData.length > 0) {
      await Notification.insertMany(notificationData);
    }

  } catch (error) {
    console.error("Error creating priority change notifications:", error);
    throw error;
  }
}

// Create priority change notification endpoint
router.post(
  '/api/v1/notifications/priority-change',
  async (req, res) => {
    try {
      const { issueId, updatedById, oldPriority, newPriority } = req.body;

      if (!issueId || !updatedById || !oldPriority || !newPriority) {
        return res.status(400).json({
          message: 'Issue ID, Updated By ID, Old Priority, and New Priority are required',
          success: false
        });
      }

      // Validate priority values
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(oldPriority) || !validPriorities.includes(newPriority)) {
        return res.status(400).json({
          message: 'Invalid priority values. Must be one of: low, medium, high, critical',
          success: false
        });
      }

      // Fetch all necessary data
      const [issue, updatedBy] = await Promise.all([
        Ticket.findById(issueId).populate('createdBy', 'name'),
        User.findById(updatedById)
      ]);

      if (!issue || !updatedBy) {
        return res.status(404).json({
          message: 'Issue or User not found',
          success: false
        });
      }

      await priorityNotification(issue, updatedBy, oldPriority, newPriority);

      res.status(200).json({
        message: 'Priority change notifications created successfully',
        success: true
      });

    } catch (error) {
      console.error('Error creating priority change notifications:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Keep the previous endpoints (assigned notification, comment notification, etc.)
// ... [Previous endpoints from earlier conversions] ...

// Get user notifications
router.get(
  '/api/v1/notifications/user/:userId',
  async (req, res) => {
    try {
      const { userId } = req.params;
      
      const notifications = await Notification.find({ userId })
        .populate('ticketId', 'Number title')
        .populate('userId', 'name')
        .sort({ createdAt: -1 });

      res.status(200).json({
        notifications,
        success: true
      });

    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Mark notification as read
router.patch(
  '/api/v1/notifications/:id/read',
  async (req, res) => {
    try {
      const { id } = req.params;

      const notification = await Notification.findByIdAndUpdate(
        id,
        { read: true, updatedAt: new Date() },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({
          message: 'Notification not found',
          success: false
        });
      }

      res.status(200).json({
        message: 'Notification marked as read',
        success: true,
        notification
      });

    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Mark all notifications as read for user
router.patch(
  '/api/v1/notifications/user/:userId/read-all',
  async (req, res) => {
    try {
      const { userId } = req.params;

      await Notification.updateMany(
        { userId, read: false },
        { read: true, updatedAt: new Date() }
      );

      res.status(200).json({
        message: 'All notifications marked as read',
        success: true
      });

    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Delete notification
router.delete(
  '/api/v1/notifications/:id',
  async (req, res) => {
    try {
      const { id } = req.params;

      const notification = await Notification.findByIdAndDelete(id);

      if (!notification) {
        return res.status(404).json({
          message: 'Notification not found',
          success: false
        });
      }

      res.status(200).json({
        message: 'Notification deleted successfully',
        success: true
      });

    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

module.exports = router;