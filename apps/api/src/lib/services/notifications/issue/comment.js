const express = require('express');
const Notification = require('../../../../models/Notification');
const Ticket = require('../../../../models/Ticket');
const User = require('../../../../models/User');

const router = express.Router();

/**
 * Creates comment notifications for all ticket followers.
 * @param {object} issue - The ticket object related to the comment.
 * @param {object} commenter - The user object who commented.
 * @returns {Promise<void>}
 */
async function commentNotification(issue, commenter) {
  try {
    const text = `New comment on #${issue.Number} by ${commenter.name}`;

    // Get all followers of the ticket, ensuring the creator is not already a follower
    const followers = [
      ...(issue.following || []),
      ...(issue.following && issue.following.includes(issue.createdBy.toString())
        ? []
        : [issue.createdBy])
    ];

    // Create notifications for all followers (except the commenter)
    const notificationData = followers
      .filter(userId => userId.toString() !== commenter._id.toString())
      .map(userId => ({
        text,
        userId,
        ticketId: issue._id
      }));

    if (notificationData.length > 0) {
      await Notification.insertMany(notificationData);
    }

  } catch (error) {
    console.error("Error creating comment notifications:", error);
    throw error;
  }
}

// Create comment notification endpoint
router.post(
  '/api/v1/notifications/comment',
  async (req, res) => {
    try {
      const { issueId, commenterId } = req.body;

      if (!issueId || !commenterId) {
        return res.status(400).json({
          message: 'Issue ID and Commenter ID are required',
          success: false
        });
      }

      // Fetch all necessary data
      const [issue, commenter] = await Promise.all([
        Ticket.findById(issueId).populate('createdBy', 'name'),
        User.findById(commenterId)
      ]);

      if (!issue || !commenter) {
        return res.status(404).json({
          message: 'Issue or Commenter not found',
          success: false
        });
      }

      await commentNotification(issue, commenter);

      res.status(200).json({
        message: 'Comment notifications created successfully',
        success: true
      });

    } catch (error) {
      console.error('Error creating comment notifications:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Keep the previous endpoints (assigned notification, get notifications, etc.)
// ... [Previous endpoints from the first conversion] ...

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

module.exports = {
  router,
  commentNotification
};
