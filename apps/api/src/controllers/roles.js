const express = require('express');
const { track } = require('../lib/hog');
const { requirePermission } = require('../lib/roles');
const Role = require('../models/Role');
const User = require('../models/User');
const Config = require('../models/Config');

const router = express.Router();

// ------------------- ROUTES ------------------- //

// Create a new role
router.post(
  "/create",
  requirePermission(["role::create"]),
  async (req, res) => {
    try {
      const { name, description, permissions, isDefault } = req.body;

      const existingRole = await Role.findOne({ name });
      if (existingRole) {
        return res.status(400).send({
          message: "Role already exists",
          success: false,
        });
      }

      await Role.create({
        name,
        description,
        permissions,
        isDefault: isDefault || false,
      });

      const client = track();
      client.capture({
        event: "role_created",
        distinctId: "uuid",
      });
      client.shutdownAsync();

      res.status(200).send({ message: "Role created!", success: true });
    } catch (error) {
      console.error("Error creating role:", error);
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
);

// Get all roles
router.get(
  "/all",
  requirePermission(["role::read"]),
  async (req, res) => {
    try {
      const roles = await Role.find({})
        .select('-users')
        .populate('users', 'name email');

      const activeConfig = await Config.getConfig();
      const roles_active = activeConfig ? activeConfig.roles_active : false;

      res.status(200).send({ roles, success: true, roles_active });
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
);

// Get role by ID
router.get(
  "/:id",
  requirePermission(["role::read"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const role = await Role.findById(id).populate('users', 'name email');
      if (!role) {
        return res.status(404).send({
          message: "Role not found",
          success: false,
        });
      }

      res.status(200).send({ role, success: true });
    } catch (error) {
      console.error("Error fetching role:", error);
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
); 

// Update role
router.put(
  "/:id/update",
  requirePermission(["role::update"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, permissions, isDefault, users } = req.body;

      const updatedRole = await Role.findByIdAndUpdate(
        id,
        {
          name,
          description,
          permissions,
          isDefault,
          updatedAt: new Date(),
        },
        { new: true, runValidators: true }
      );

      if (!updatedRole) {
        return res.status(404).send({
          message: "Role not found",
          success: false,
        });
      }

      // If users array is provided, update the users for this role
      if (Array.isArray(users)) {
        // First, remove this role from all users who currently have it
        await User.updateMany(
          { roles: id },
          { $pull: { roles: id } }
        );

        // Then add this role to the specified users
        if (users.length > 0) {
          await User.updateMany(
            { _id: { $in: users } },
            { $addToSet: { roles: id } }
          );
        }
      }

      res.status(200).send({ role: updatedRole, success: true });
    } catch (error) {
      console.error("Error updating role:", error);
      if (error.name === 'CastError') {
        return res.status(404).send({
          message: "Role not found",
          success: false,
        });
      }
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
);

// Delete role
router.delete(
  "/:id/delete",
  requirePermission(["role::delete"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      // First, remove this role from all users
      await User.updateMany(
        { roles: id },
        { $pull: { roles: id } }
      );

      const deletedRole = await Role.findByIdAndDelete(id);
      if (!deletedRole) {
        return res.status(404).send({
          message: "Role not found",
          success: false,
        });
      }

      res.status(200).send({ success: true });
    } catch (error) {
      console.error("Error deleting role:", error);
      if (error.name === 'CastError') {
        return res.status(404).send({
          message: "Role not found",
          success: false,
        });
      }
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
);

// Assign role to user
router.post(
  "/assign",
  requirePermission(["role::update"]),
  async (req, res) => {
    try {
      const { userId, roleId } = req.body;

      const user = await User.findById(userId);
      const role = await Role.findById(roleId);

      if (!user || !role) {
        return res.status(404).send({
          message: "User or Role not found",
          success: false,
        });
      }

      // Add role to user if not already assigned
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $addToSet: { roles: roleId } },
        { new: true }
      ).populate('roles', 'name description');

      res.status(200).send({ user: updatedUser, success: true });
    } catch (error) {
      console.error("Error assigning role:", error);
      if (error.name === 'CastError') {
        return res.status(404).send({
          message: "User or Role not found",
          success: false,
        });
      }
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
);

// Remove role from user
router.post(
  "/remove",
  requirePermission(["role::update"]),
  async (req, res) => {
    try {
      const { userId, roleId } = req.body;

      const user = await User.findById(userId);
      const role = await Role.findById(roleId);

      if (!user || !role) {
        return res.status(404).send({
          message: "User or Role not found",
          success: false,
        });
      }

      // Remove role from user
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $pull: { roles: roleId } },
        { new: true }
      ).populate('roles', 'name description');

      res.status(200).send({ user: updatedUser, success: true });
    } catch (error) {
      console.error("Error removing role:", error);
      if (error.name === 'CastError') {
        return res.status(404).send({
          message: "User or Role not found",
          success: false,
        });
      }
      res.status(500).send({
        message: "Internal server error",
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;
