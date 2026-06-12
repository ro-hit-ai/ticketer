// services/authService.js
const { google } = require("googleapis");
const EmailQueue = require("../../models/EmailQueue");
const { decryptSecret } = require("./secretField.service");

function getTlsOptions(servername) {
  const allowInsecureTls =
    String(process.env.MAIL_ALLOW_INSECURE_TLS || 'false').toLowerCase() === 'true';
  return {
    rejectUnauthorized: !allowInsecureTls,
    servername,
  };
}

class AuthService {
static async getValidAccessToken(queue) {
  if (queue.serviceType !== "gmail") {
    throw new Error("Access token is only required for Gmail service type");
  }

  const refreshToken = decryptSecret(queue.refreshToken);
  const clientSecret = decryptSecret(queue.clientSecret);
  const existingAccessToken = decryptSecret(queue.accessToken);

  if (!refreshToken) {
    throw new Error("No refresh token found. Please re-authorize Gmail with prompt=consent");
  }

  // Check expiry properly
  const notExpired = queue.tokenExpiry && Date.now() < new Date(queue.tokenExpiry).getTime();

  // Setup OAuth2 client
  const oAuth2Client = new google.auth.OAuth2(
    queue.clientId,
    clientSecret,
    queue.redirectUri
  );

  oAuth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  // Always refresh if expired
  let token = existingAccessToken;
  if (!notExpired) {
    const newAccessToken = await oAuth2Client.getAccessToken();
    token = newAccessToken?.token || newAccessToken;
    if (!token) throw new Error("Failed to refresh Gmail access token");

    const expiry = Date.now() + 3600 * 1000; // 1h

    // Update Mongo
    await EmailQueue.findByIdAndUpdate(queue._id, {
      accessToken: token,
      tokenExpiry: expiry,
    });
  }

  return token;
}


  static generateXOAuth2Token(username, accessToken) {
    return Buffer.from(
      `user=${username}\u0001auth=Bearer ${accessToken}\u0001\u0001`
    ).toString("base64");
  }

static async getEmailConfig(queue) {
  if (queue.serviceType === "gmail") {
    const accessToken = await this.getValidAccessToken(queue);

    const xoauth2 = this.generateXOAuth2Token(queue.username, accessToken);

    // 🔎 Debug log (remove in prod)
    console.log("📩 IMAP Config for Gmail:", {
      user: queue.username,
      host: queue.hostname,
      port: 993,
      tls: true,
      xoauth2: xoauth2 ? "[token generated]" : null,
      expiry: queue.tokenExpiry,
    });

    return {
      user: queue.username,
      host: queue.hostname,
      port: 993,
      tls: true,
      xoauth2,
      tlsOptions: getTlsOptions(queue.hostname),
    };
  }

  if (queue.serviceType === "other") {
    // 🔎 Debug log (remove in prod)
    console.log("📩 IMAP Config for Other:", {
      user: queue.username,
      host: queue.hostname,
      port: queue.tls ? 993 : 143,
      tls: queue.tls || false,
    });

    return {
      user: queue.username,
      password: decryptSecret(queue.password),
      host: queue.hostname,
      port: queue.tls ? 993 : 143,
      tls: queue.tls || false,
      tlsOptions: getTlsOptions(queue.hostname),
    };
  }

  throw new Error(`Unsupported service type: ${queue.serviceType}`);
}

}

module.exports = AuthService;
