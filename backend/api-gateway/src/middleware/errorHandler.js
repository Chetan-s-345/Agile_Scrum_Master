const { logger } = require('./logger');
const { env } = require('../config/env');

function errorHandler(err, req, res, next) {
  logger.error({ err }, 'Unhandled error');
  const statusCode = err?.statusCode || err?.status || 500;
  const isServerError = statusCode >= 500;

  const message = !isServerError
    ? err.message
    : env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error';

  const payload = { error: message };

  // Pass through structured details for client-side form errors.
  // Only include these for non-5xx responses to avoid leaking internals.
  if (!isServerError && err?.details) {
    payload.details = err.details;
  }

  res.status(statusCode).json(payload);
}

module.exports = { errorHandler };
