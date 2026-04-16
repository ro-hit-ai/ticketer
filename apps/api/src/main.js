// require("dotenv").config();
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const mongoose = require("mongoose");
const User = require("./models/User");
const { attachUser } = require('./lib/session');
// Custom imports
const { track } = require("./lib/hog");
const { getEmails } = require("./lib/imap");
const { registerRoutes } = require("./routes"); // combined routes

const corsOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const jsonLimit = process.env.API_JSON_LIMIT || "2mb";
const formLimit = process.env.API_FORM_LIMIT || "2mb";
const upload = multer({
  limits: {
    files: Number(process.env.API_MAX_FILES || 10),
    fileSize: Number(process.env.API_MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024),
  },
});

// Initialize Express
const app = express();
app.set("trust proxy", 1);

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.length === 0) {
      if (isProduction) return callback(new Error("CORS is not configured for production"));
      return callback(null, true);
    }

    if (corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  optionsSuccessStatus: 204,
}));
app.use(express.json({
  limit: jsonLimit,
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: formLimit }));
app.use((req, res, next) => {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    return upload.any()(req, res, next);
  }
  return next();
});
app.use(attachUser);

const EXCLUDED_ROUTES = [
  { method: 'GET', pattern: /^\/$/ },
  { method: 'GET', pattern: /^\/health\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/login\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/user\/register\/external\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/password-reset\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/password-reset\/code\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/password-reset\/password\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/auth\/check\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/auth\/oidc\/callback\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/auth\/oauth\/callback\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/config\/authentication\/check\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/config\/authentication\/oauth\/gmail\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/email-queue\/oauth\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/email-queue\/create\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/ticket\/public\/create\/?$/ },
  { method: null, pattern: /^\/api\/v1\/php(\/.*)?$/ },
  { method: null, pattern: /^\/api\/php(\/.*)?$/ },
  { method: null, pattern: /^\/php(\/.*)?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/imap\/test-fetch\/?$/ },
  { method: 'GET', pattern: /^\/api\/v1\/imap\/emails\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/php\/send-email\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/webhook\/vati\/?$/ },
  { method: 'POST', pattern: /^\/api\/v1\/email-queue\/test-connection\/?$/ },
];

function isExcludedRoute(req) {
  const cleanPath = req.path.replace(/\/+$/, '') || '/';
  return EXCLUDED_ROUTES.some((route) => {
    const methodMatches = !route.method || route.method === req.method;
    return methodMatches && route.pattern.test(cleanPath);
  });
}

// JWT middleware
app.use((req, res, next) => {
  if (isExcludedRoute(req)) return next();
  if (req.user) return next();
  return res.status(401).json({ message: "Unauthorized", success: false });
});

// Register all routes
registerRoutes(app);

// Health check
app.get("/", (req, res) => res.json({ healthy: true }));
app.get("/health", (req, res) => res.json({ healthy: true }));

// Seed admin user
// Seed (or reseed) admin user
async function seedAdmin() {
  try {
    const existingAdmin = await User.findOne({ email: "admin@gmail.com" });
    if (existingAdmin) {
      return;
    }

    const hashedPassword = await bcrypt.hash("123456", 10); // default admin password
    const admin = new User({
      email: "admin@gmail.com",
      password: hashedPassword,
      name: "Admin User",
      isAdmin: true,
      role: "admin"
    });

    await admin.save();
    console.log("✅ Admin user reseeded: admin@gmail.com / 123456");
  } catch (err) {
    console.error("❌ Failed to seed admin:", err);
  }
}


// Start server function
async function start() {
  try {
    // Connect to MongoDB only if not already connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/peppermint", {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log("✅ Connected to MongoDB");
    } else {
      console.log("ℹ️ MongoDB already connected");
    }

    // Seed admin only when explicitly enabled
    if (String(process.env.SEED_ADMIN_ON_STARTUP || 'false').toLowerCase() === 'true') {
      await seedAdmin();
    }

    const port = process.env.PORT || 5005;
    app.listen(port, () => {
      console.log(`🚀 Server listening on port ${port}`);

      // Track server start
      const client = track();
      client.capture({ event: "server_started", distinctId: "uuid" });
      client.shutdownAsync();

      // Start email polling
      const pollingEnabled = String(process.env.EMAIL_POLLING_ENABLED || "true").toLowerCase() === "true";
      if (pollingEnabled) {
        const pollingIntervalMs = Math.max(Number(process.env.EMAIL_POLLING_INTERVAL_MS || 10000), 5000);
        setInterval(() => getEmails(), pollingIntervalMs);
      }
    });

  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

// Start the server
start();

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const isCorsError = typeof err?.message === 'string' && err.message.toLowerCase().includes('cors');
  res.status(isCorsError ? 403 : (err?.status || 500)).json({
    success: false,
    message: isCorsError ? 'CORS policy blocked this request' : (err?.message || 'Internal server error'),
  });
});
