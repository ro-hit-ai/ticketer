const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const { track } = require('../lib/hog');
const { createTransportProvider } = require('../lib/transport');
const { requirePermission } = require('../lib/roles');
const { checkSession } = require('../lib/session');
const Config = require('../models/Config');
const OpenIdConfig = require('../models/OpenIdConfig');
const OAuthProvider = require('../models/OAuthProvider');
const Email = require('../models/Email');

const router = express.Router();

async function tracking(event, properties) {
  const client = track();
  client.capture({
    event: event,
    properties: properties,
    distinctId: "uuid",
  });
}

// Check auth method
router.get('/check', async (req, res) => {
  const config = await Config.findOne({});
  const { sso_active, sso_provider } = config || {};
  if (sso_active) {
    return res.json({ success: true, sso: sso_active, provider: sso_provider });
  }
  res.json({ success: true, sso: sso_active });
});

// Update OIDC Provider
router.post('/oidc/update', requirePermission(['settings::manage']), async (req, res) => {
  const { clientId, clientSecret, redirectUri, issuer, jwtSecret } = req.body;
  const conf = await Config.findOne({});
  await Config.updateOne({ _id: conf._id }, { sso_active: true, sso_provider: "oidc" });

  let existingProvider = await OpenIdConfig.findOne({});
  if (!existingProvider) {
    await OpenIdConfig.create({ clientId, redirectUri, issuer });
  } else {
    await OpenIdConfig.updateOne({ _id: existingProvider._id }, { clientId, redirectUri, issuer });
  }

  await tracking("oidc_provider_updated", {});
  res.json({ success: true, message: "OIDC config Provider updated!" });
});

// Update OAuth Provider
router.post('/oauth/update', requirePermission(['settings::manage']), async (req, res) => {
  const { name, clientId, clientSecret, redirectUri, tenantId, issuer, jwtSecret } = req.body;
  const conf = await Config.findOne({});
  await Config.updateOne({ _id: conf._id }, { sso_active: true, sso_provider: "oauth" });

  let existingProvider = await OAuthProvider.findOne({});
  if (!existingProvider) {
    await OAuthProvider.create({
      name,
      clientId,
      clientSecret,
      redirectUri,
      scope: "",
      authorizationUrl: "",
      tokenUrl: "",
      userInfoUrl: ""
    });
  } else {
    await OAuthProvider.updateOne(
      { _id: existingProvider._id },
      { clientId, clientSecret, redirectUri }
    );
  }

  await tracking("oauth_provider_updated", {});
  res.json({ success: true, message: "SSO Provider updated!" });
});

// Delete auth config
router.delete('/delete', requirePermission(['settings::manage']), async (req, res) => {
  const conf = await Config.findOne({});
  await Config.updateOne({ _id: conf._id }, { sso_active: false, sso_provider: "" });
  await OAuthProvider.deleteMany({});
  await tracking("sso_provider_deleted", {});
  res.json({ success: true, message: "SSO Provider deleted!" });
});

// Get Email Config and verify via Nodemailer
router.get('/email', requirePermission(['settings::view', 'settings::manage'], false), async (req, res) => {
  // Authorization check can be added if needed (not in original)
  const config = await Email.findOne({}, { active: 1, host: 1, port: 1, reply: 1, user: 1 });

  if (config && config.active) {
    const provider = await createTransportProvider();

    provider.verify(function (error, success) {
      if (error) {
        return res.json({ success: true, active: true, email: config, verification: error });
      } else {
        return res.json({ success: true, active: true, email: config, verification: success });
      }
    });
    return;
  }
  res.json({ success: true, active: false });
});

// Update Email Provider Settings + Gmail OAuth setup
router.put('/email', requirePermission(['settings::manage']), async (req, res) => {
  const { host, active, port, reply: replyto, username, password, serviceType, clientId, clientSecret, redirectUri } = req.body;
  let email = await Email.findOne({});
  if (!email) {
    await Email.create({
      host, port, reply: replyto, user: username, pass: password, active: true, clientId, clientSecret, serviceType, redirectUri
    });
  } else {
    await Email.updateOne(
      { _id: email._id },
      { host, port, reply: replyto, user: username, pass: password, active, clientId, clientSecret, serviceType, redirectUri }
    );
  }
  if (serviceType === "gmail") {
    email = await Email.findOne({});
    const google = new OAuth2Client(email.clientId, email.clientSecret, email.redirectUri);
    const authorizeUrl = google.generateAuthUrl({
      access_type: "offline",
      scope: "https://mail.google.com",
      prompt: "consent"
    });
    return res.json({ success: true, message: "SSO Provider updated!", authorizeUrl });
  }
  res.json({ success: true, message: "SSO Provider updated!" });
});

// Google OAuth callback for Gmail
router.get('/oauth/gmail', async (req, res) => {
  const { code } = req.query;
  const email = await Email.findOne({});
  const google = new OAuth2Client(email.clientId, email.clientSecret, email.redirectUri);
  const r = await google.getToken(code);
  await Email.updateOne(
    { _id: email._id },
    {
      refreshToken: r.tokens.refresh_token,
      accessToken: r.tokens.access_token,
      expiresIn: r.tokens.expiry_date,
      serviceType: "gmail"
    }
  );
  const provider = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      type: "OAuth2",
      user: email.user,
      clientId: email.clientId,
      clientSecret: email.clientSecret,
      refreshToken: r.tokens.refresh_token,
      accessToken: r.tokens.access_token,
      expiresIn: r.tokens.expiry_date
    }
  });
  res.json({ success: true, message: "SSO Provider updated!" });
});

// Disable/Enable Email
router.delete('/email', requirePermission(['settings::manage']), async (req, res) => {
  await Email.deleteMany({});
  res.json({ success: true, message: "Email settings deleted!" });
});

// Toggle all roles
router.patch('/toggle-roles', requirePermission(['settings::manage']), async (req, res) => {
  const { isActive } = req.body;
  const session = await checkSession(req);
  if (!session || !session.isAdmin) {
    return res.status(403).json({ message: "Unauthorized. Admin access required.", success: false });
  }
  const config = await Config.findOne({});
  await Config.updateOne({ _id: config._id }, { roles_active: isActive });
  res.json({ success: true, message: "Roles updated!" });
});

module.exports = router;
