const rateLimit = require('express-rate-limit');

// Basic limiter; swap to Redis-backed limiter when needed.
const perOrgRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const orgId = req?.user?.orgId;
    return orgId ? `org:${orgId}` : req.ip;
  },
});

module.exports = { perOrgRateLimiter };
