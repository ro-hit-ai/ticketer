const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("./jwtSecret");

function checkToken(token) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error("JWT secret not configured");
  }

  return jwt.verify(token, secret);
}

module.exports = { checkToken };
