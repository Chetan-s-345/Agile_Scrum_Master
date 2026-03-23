const { prMetricsService } = require('../services/prMetricsService');

function safeText(value) {
  return String(value || '').trim();
}

async function getPrReviewMetrics(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) {
      return res.status(500).json({ error: 'Org DB not attached', code: 500, detail: 'Org DB not attached' });
    }

    const groupBy = safeText(req.query.groupBy).toLowerCase() || 'reviewer';
    const sprintId = safeText(req.query.sprintId) || null;

    const items = await prMetricsService.getPrReviewMetrics(orgPool, { groupBy, sprintId });
    return res.status(200).json({ groupBy, sprintId, items });
  } catch (err) {
    const code = Number(err?.statusCode || 500);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ error: 'Bad request', code, detail: String(err?.message || 'Bad request') });
    }
    return next(err);
  }
}

module.exports = {
  getPrReviewMetrics,
};
