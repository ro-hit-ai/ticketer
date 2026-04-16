const express = require('express');
const Notification = require('../../../../models/Notification');
const Ticket = require('../../../../models/Ticket');
const User = require('../../../../models/User');

const router = express.Router();

/**
 * Creates active status change notifications for all ticket followers.
 * @param {object} ticket - The ticket object
 * @param {object} updater - The user object who updated the status
 * @param {boolean} newStatus - The new active status (true for closed, false for open)
 * @returns {Promise<void>}
 */
async function activeStatusNotification(ticket, updater, newStatus) {
  try {
    const statusText = newStatus ? "Closed" : "Open";
    const text = `#${ticket.Number} status changed to ${statusText} by ${updater.name}`;

    // Get all followers of the ticket, ensuring the creator is not already a follower
    const followers = [
      ...(ticket.following || []),
      ...(ticket.following && ticket.following.includes(ticket.createdBy.toString())
        ? []
        : [ticket.createdBy])
    ];

    // Create notifications for all followers (except the updater)
   const notificationData = followers
  .filter(userId => {
    return userId && updater && updater._id && userId.toString() !== updater._id.toString();
  })
  .map(userId => ({
    text,
    userId,
    ticketId: ticket._id
  }));



    if (notificationData.length > 0) {
      await Notification.insertMany(notificationData);
    }

  } catch (error) {
    console.error("Error creating status change notifications:", error);
    throw error;
  }
}

/**
 * Creates status update notifications for all ticket followers.
 * @param {object} ticket - The ticket object
 * @param {object} updater - The user object who updated the status
 * @param {string} newStatus - The new status value
 * @returns {Promise<void>}
 */
async function statusUpdateNotification(ticket, updater, newStatus) {
  try {
    const text = `#${ticket.Number} status changed to ${newStatus} by ${updater.name}`;

    // Get all followers of the ticket, ensuring the creator is not already a follower
    const followers = [
      ...(ticket.following || []),
      ...(ticket.following && ticket.following.includes(ticket.createdBy.toString())
        ? []
        : [ticket.createdBy])
    ];

    // Create notifications for all followers (except the updater)
    const notificationData = followers
      .filter(userId => userId.toString() !== updater._id.toString())
      .map(userId => ({
        text,
        userId,
        ticketId: ticket._id
      }));

    if (notificationData.length > 0) {
      await Notification.insertMany(notificationData);
    }

  } catch (error) {
    console.error("Error creating status update notifications:", error);
    throw error;
  }
}

// Create active status change notification endpoint
router.post(
  '/api/v1/notifications/active-status-change',
  async (req, res) => {
    try {
      const { ticketId, updaterId, newStatus } = req.body;

      if (!ticketId || !updaterId || typeof newStatus !== 'boolean') {
        return res.status(400).json({
          message: 'Ticket ID, Updater ID, and New Status (boolean) are required',
          success: false
        });
      }

      // Fetch all necessary data
      const [ticket, updater] = await Promise.all([
        Ticket.findById(ticketId).populate('createdBy', 'name'),
        User.findById(updaterId)
      ]);

      if (!ticket || !updater) {
        return res.status(404).json({
          message: 'Ticket or User not found',
          success: false
        });
      }

      await activeStatusNotification(ticket, updater, newStatus);

      res.status(200).json({
        message: 'Active status change notifications created successfully',
        success: true
      });

    } catch (error) {
      console.error('Error creating active status change notifications:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Create status update notification endpoint
router.post(
  '/api/v1/notifications/status-update',
  async (req, res) => {
    try {
      const { ticketId, updaterId, newStatus } = req.body;

      if (!ticketId || !updaterId || !newStatus) {
        return res.status(400).json({
          message: 'Ticket ID, Updater ID, and New Status are required',
          success: false
        });
      }

      // Validate status values
      const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({
          message: 'Invalid status value. Must be one of: open, in_progress, resolved, closed',
          success: false
        });
      }

      // Fetch all necessary data
      const [ticket, updater] = await Promise.all([
        Ticket.findById(ticketId).populate('createdBy', 'name'),
        User.findById(updaterId)
      ]);

      if (!ticket || !updater) {
        return res.status(404).json({
          message: 'Ticket or User not found',
          success: false
        });
      }

      await statusUpdateNotification(ticket, updater, newStatus);

      res.status(200).json({
        message: 'Status update notifications created successfully',
        success: true
      });

    } catch (error) {
      console.error('Error creating status update notifications:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Keep the previous endpoints (assigned, comment, priority notifications, etc.)
// ... [Previous endpoints from earlier conversions] ...

// Get user notifications
router.get(
  '/api/v1/notifications/user/:userId',
  async (req, res) => {
    try {
      const { userId } = req.params;
      
      const notifications = await Notification.find({ userId })
        .populate('ticketId', 'Number title status')
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
  activeStatusNotification,
  statusUpdateNotification
};
