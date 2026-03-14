const { db } = require('../config/database');

async function orgDbMiddleware(req, res, next) {
  try {
    const orgId = req?.user?.orgId;
    if (!orgId) return res.status(400).json({ error: 'Missing orgId in token' });

    const pool = await db.getOrgPool(orgId);
    req.orgDb = pool;
    req.orgQuery = (sql, params) => pool.query(sql, params);
    return next();
  } catch (err) {
    return res.status(503).json({ message: 'Database unavailable' });
  }
}

module.exports = { orgDbMiddleware };
