function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.SECRET || null;
}

module.exports = { getJwtSecret };
