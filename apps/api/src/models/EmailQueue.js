const mongoose = require('mongoose');

const EmailQueueSchema = new mongoose.Schema({
  // Basic configuration
  name: {
    type: String,
    required: true,
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  },
  serviceType: {
    type: String,
    required: true,
    enum: ['gmail', 'other'],
    default: 'other'
  },

  // Connection details
  username: {
    type: String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    // Required for 'other' service type, optional for Gmail (uses OAuth2)
    required: function () {
      return this.serviceType === 'other';
    },
    default: null
  },
  hostname: {
    type: String,
    required: true,
    trim: true
  },
  imapPort: {
    type: Number,
    default: 993
  },
    smtpPort: {
    type: Number,
    default: 465
  },
  tls: {
    type: Boolean,
    default: true
  },

  // OAuth2 fields (for Gmail)
   clientId: {
    type: String,
    default: null
  },
  clientSecret: {
    type: String,
    default: null
  },
   redirectUri:{
    type: String,
    default: null
   },
  accessToken: {
    type: String,
    default: null
  },
  refreshToken: {
    type: String,
    default: null
  },
  tokenExpiry: {
    type: Date,
    default: null
  },

  // Additional settings
  folder: {
    type: String,
    default: 'INBOX'
  },
  scanInterval: {
    type: Number, // in minutes
    default: 5
  },
  lastScanned: {
    type: Date,
    default: null
  },
  imapState: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false   // <-- change to true later if you want mandatory tracking
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true // auto-manages createdAt & updatedAt
});

// Index for better query performance
EmailQueueSchema.index({ active: 1, serviceType: 1 });
EmailQueueSchema.index({ createdBy: 1 });
EmailQueueSchema.index({ isDeleted: 1 });

// Pre-save middleware to update updatedAt
EmailQueueSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for checking if token is expired (for Gmail)
EmailQueueSchema.virtual('isTokenExpired').get(function () {
  if (this.serviceType !== 'gmail' || !this.tokenExpiry) return false;
  return this.tokenExpiry < new Date();
});

// Method to validate configuration
EmailQueueSchema.methods.validateConfig = function () {
  if (this.serviceType === 'other' && !this.password) {
    throw new Error('Password is required for non-Gmail services');
  }
  if (this.serviceType === 'gmail' && (!this.accessToken || !this.refreshToken)) {
    throw new Error('OAuth2 tokens are required for Gmail service');
  }
  return true;
};

// Static method to find active queues
EmailQueueSchema.statics.findActiveQueues = function () {
  return this.find({ active: true, isDeleted: false });
};

// Static method to find by service type
EmailQueueSchema.statics.findByServiceType = function (serviceType) {
  return this.find({ serviceType, active: true, isDeleted: false });
};

module.exports = mongoose.model('EmailQueue', EmailQueueSchema);
