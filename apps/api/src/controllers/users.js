const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const { requirePermission } = require('../lib/roles');
const { checkSession } = require('../lib/session');

// All users
router.get(
  '/all',
  requirePermission(['user::read']),
  async (req, res) => {
    try {
      const users = await User.find(
        { external_user: false },
        'id name email isAdmin createdAt updatedAt language'
      ).exec();

      res.send({
        users,
        success: true
      });
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to fetch users'
      });
    }
  }
);

// New user
router.post(
  '/new',
  requirePermission(['user::create', 'user::manage'], false),
  async (req, res) => {
    try {
      const session = await checkSession(req);
      
      if (session && (session.isAdmin || session.permissions.includes('*') || session.permissions.includes('user::manage'))) {
        const { email, password, name, admin } = req.body;

        const e = email.toLowerCase();
        const hash = await bcrypt.hash(password, 10);

        const newUser = new User({
          name,
          email: e,
          password: hash,
          isAdmin: admin
        });

        await newUser.save();

        // Track event (uncomment if you implement tracking)
        // const client = track();
        // client.capture({
        //   event: 'user_created',
        //   distinctId: 'uuid',
        // });
        // client.shutdownAsync();

        res.send({
          success: true
        });
      } else {
        res.status(403).send({ message: 'Unauthorized', failed: true });
      }
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to create user'
      });
    }
  }
);

// (ADMIN) Reset password
router.put(
  '/reset-password',
  requirePermission(['user::update', 'user::manage'], false),
  async (req, res) => {
    try {
      const { password, id } = req.body;
      const session = await checkSession(req);

      if (session && (session.isAdmin || session.permissions.includes('*') || session.permissions.includes('user::manage'))) {
        const hashedPass = await bcrypt.hash(password, 10);
        
        await User.findByIdAndUpdate(id, {
          password: hashedPass,
          updatedAt: Date.now()
        });

        res.status(201).send({ message: 'password updated success', failed: false });
      } else {
        res.status(403).send({ message: 'Unauthorized', failed: true });
      }
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to reset password'
      });
    }
  }
);

// Mark Notification as read
router.get(
  '/notification/:id',
  requirePermission(['user::read', 'issue::read'], false),
  async (req, res) => {
    try {
      const { id } = req.params;
      const session = await checkSession(req);
      
      if (!session) {
        return res.status(401).send({
          message: 'Unauthorized',
          success: false
        });
      }

      // Get the notification and verify it belongs to the user
      const notification = await Notification.findById(id);
      
      if (!notification) {
        return res.status(404).send({
          message: 'Notification not found',
          success: false
        });
      }
      
      if (notification.userId.toString() !== String(session.id)) {
        return res.status(403).send({
          message: 'Access denied. You can only manage your own notifications.',
          success: false
        });
      }

      await Notification.findByIdAndUpdate(id, {
        read: true
      });

      res.send({
        success: true
      });
    } catch (error) {
      console.error(error);
      res.status(500).send({
        success: false,
        error: 'Failed to update notification'
      });
    }
  }
);

module.exports = router;
