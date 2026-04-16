const express = require('express');
const Notification = require('../../../../models/Notification');
const Ticket = require('../../../../models/Ticket');
const User = require('../../../../models/User');

const router = express.Router();

/**
 * Creates assignment notifications for all ticket followers.
 * @param {object} assignee - The user object being assigned
 * @param {object} ticket - The ticket object
 * @param {object} assigner - The user object doing the assigning
 * @returns {Promise<void>}
 */
async function assignedNotification(assignee, ticket, assigner) {
  try {
    const text = `Ticket #${ticket.Number} was assigned to ${assignee.name} by ${assigner.name}`;

    // Get all followers of the ticket, ensuring the creator is not already a follower
    const followers = [
      ...(ticket.following || []),
      ...(ticket.following && ticket.following.includes(ticket.createdBy.toString())
        ? []
        : [ticket.createdBy])
    ];

    // Create notifications for all followers (except the assigner)
    const notificationData = followers
      .filter(userId => userId.toString() !== assigner._id.toString())
      .map(userId => ({
        text,
        userId,
        ticketId: ticket._id
      }));

    if (notificationData.length > 0) {
      await Notification.insertMany(notificationData);
    }

  } catch (error) {
    console.error("Error creating assignment notifications:", error);
    throw error;
  }
}

// Create assignment notification endpoint
router.post(
  '/api/v1/notifications/assigned',
  async (req, res) => {
    try {
      const { assigneeId, ticketId, assignerId } = req.body;

      if (!assigneeId || !ticketId || !assignerId) {
        return res.status(400).json({
          message: 'Assignee ID, Ticket ID, and Assigner ID are required',
          success: false
        });
      }

      // Fetch all necessary data
      const [assignee, ticket, assigner] = await Promise.all([
        User.findById(assigneeId),
        Ticket.findById(ticketId).populate('createdBy', 'name'),
        User.findById(assignerId)
      ]);

      if (!assignee || !ticket || !assigner) {
        return res.status(404).json({
          message: 'Assignee, Ticket, or Assigner not found',
          success: false
        });
      }

      await assignedNotification(assignee, ticket, assigner);

      res.status(200).json({
        message: 'Assignment notifications created successfully',
        success: true
      });

    } catch (error) {
      console.error('Error creating assignment notifications:', error);
      res.status(500).json({
        message: 'Internal Server Error',
        success: false
      });
    }
  }
);

// Get user notifications
router.get(
  '/api/v1/notifications/user/:userId',
  async (req, res) => {
    try {
      const { userId } = req.params;
      
      const notifications = await Notification.find({ userId })
        .populate('ticketId', 'Number title')
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
    router,assignedNotification
  };