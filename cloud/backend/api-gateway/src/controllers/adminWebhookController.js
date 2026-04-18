const { webhookRetryService } = require('../services/webhookRetryService');

function errorBody(error, code, detail) {
  return { error, code, detail };
}

async function getDlq(req, res, next) {
  try {
    if (!req.orgDb) {
      return res.status(500).json(errorBody('Org DB not attached', 500, 'Organization database connection missing'));
    }

    const out = await webhookRetryService.listDlq(req.orgDb, {
      source: req.query?.source,
      eventType: req.query?.eventType,
      from: req.query?.from,
      to: req.query?.to,
      limit: req.query?.limit,
    });

    return res.status(200).json(out);
  } catch (err) {
    return next(err);
  }
}

async function retryDlqEvent(req, res, next) {
  try {
    if (!req.orgDb) {
      return res.status(500).json(errorBody('Org DB not attached', 500, 'Organization database connection missing'));
    }

    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) {
      return res.status(400).json(errorBody('Bad request', 400, 'eventId is required'));
    }

    const out = await webhookRetryService.retryDlqEvent(req.orgDb, eventId);
    return res.status(200).json(out);
  } catch (err) {
    return next(err);
  }
}

async function retryAllDlq(req, res, next) {
  try {
    if (!req.orgDb) {
      return res.status(500).json(errorBody('Org DB not attached', 500, 'Organization database connection missing'));
    }

    const out = await webhookRetryService.retryAllDlq(req.orgDb);
    return res.status(200).json(out);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getDlq,
  retryDlqEvent,
  retryAllDlq,
};
