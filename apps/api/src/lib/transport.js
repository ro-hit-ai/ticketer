const nodemailer = require('nodemailer');
const { ConfidentialClientApplication } = require('@azure/identity');
const Email = require('../models/Email');

function getEnvProvider() {
  const host = process.env.SMTP_HOST || null;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || null;
  const pass = process.env.SMTP_PASS || null;
  const reply = process.env.DEFAULT_FROM_EMAIL || user || null;

  if (!host || !user || !pass || !reply) {
    return null;
  }

  return {
    active: true,
    serviceType: 'other',
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    user,
    pass,
    reply,
  };
}

async function createTransportProvider(providerOverride = null) {
  try {
    const provider = providerOverride || await Email.findOne() || getEnvProvider();

    if (!provider) {
      throw new Error("No email provider configured.");
    }

    if (provider.active === false) {
      throw new Error("Email provider is disabled.");
    }

    if (provider.serviceType === "gmail") {
      return nodemailer.createTransport({
        service: "gmail",
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          type: "OAuth2",
          user: provider.user,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          refreshToken: provider.refreshToken,
          accessToken: provider.accessToken,
          expires: provider.expiresIn,
        },
      });
    } else if (provider.serviceType === "microsoft") {
      // Microsoft
      const cca = new ConfidentialClientApplication({
        auth: {
          clientId: provider.clientId,
          authority: `https://login.microsoftonline.com/${provider.tenantId}`,
          clientSecret: provider.clientSecret,
        },
      });

      const result = await cca.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
      });

      return nodemailer.createTransport({
        service: "hotmail",
        auth: {
          type: "OAuth2",
          user: provider.user,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          accessToken: result.accessToken,
        },
      });
    } else if (provider.serviceType === "other") {
      // Username/password configuration
      return nodemailer.createTransport({
        host: provider.host,
        port: provider.port,
        secure: provider.secure ?? provider.port === 465,
        auth: {
          user: provider.user,
          pass: provider.pass,
        },
      });
    } else {
      throw new Error("No valid authentication method configured.");
    }
  } catch (error) {
    console.error('Error creating transport provider:', error);
    throw error;
  }
}

module.exports = { createTransportProvider };
