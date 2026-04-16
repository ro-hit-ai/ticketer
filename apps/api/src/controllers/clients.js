const express = require('express');
const { track } = require('../lib/hog');
const { requirePermission } = require('../lib/roles');
const Client = require('../models/Client');

const router = express.Router();

// Register a new client
router.post(
  '/create',
  requirePermission(['client::create']),
  async (req, res) => {
    const { name, email, number, contactName } = req.body;

    const client = new Client({
      name,
      contactName,
      email,
      number: String(number)
    });
    await client.save();

    const hog = track();
    hog.capture({
      event: 'client_created',
      distinctId: client._id,
    });

    res.json({ success: true });
  }
);

// Update client
router.post(
  '/update',
  requirePermission(['client::update']),
  async (req, res) => {
    const { name, email, number, contactName, id } = req.body;

    await Client.updateOne(
      { _id: id },
      { name, contactName, email, number: String(number) }
    );

    res.json({ success: true });
  }
);

// Get all clients
router.get(
  '/all',
  requirePermission(['client::read']),
  async (req, res) => {
    const clients = await Client.find({});

    res.json({ success: true, clients });
  }
);

// Delete client
router.delete(
  '/:id/delete-client',
  requirePermission(['client::delete']),
  async (req, res) => {
    const { id } = req.params;

    await Client.deleteOne({ _id: id });

    res.json({ success: true });
  }
);

module.exports = router;
