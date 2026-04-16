const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema({
  active: {
    type: Boolean,
    default: false
  },
  serviceType: {
    type: String,
    enum: ['gmail', 'microsoft', 'other'],
    default: 'other'
  },
  host: {
    type: String,
    required: true
  },
  port: {
    type: Number,
    required: true
  },
  secure: {
    type: Boolean,
    default: false
  },
  user: {
    type: String,
    required: true
  },
  pass: {
    type: String,
    required: true
  },
  clientId: {
    type: String,
    default: null
  },
  clientSecret: {
    type: String,
    default: null
  },
  redirectUri: {
    type: String,
    default: null
  },
  refreshToken: {
    type: String,
    default: null
  },
  accessToken: {
    type: String,
    default: null
  },
  expiresIn: {
    type: Date,
    default: null
  },
  tenantId: {
    type: String,
    default: null
  },
  reply: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Email', emailSchema);
