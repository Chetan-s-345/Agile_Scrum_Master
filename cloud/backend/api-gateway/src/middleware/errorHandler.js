const { logger } = require('./logger');
const { env } = require('../config/env');

function errorHandler(err, req, res, next) {
  void next;
  logger.error({ err }, 'Unhandled error');
  const statusCode = err?.statusCode || err?.status || 500;
  const isServerError = statusCode >= 500;

  const publicMessage = typeof err?.publicMessage === 'string' && err.publicMessage.trim()
    ? err.publicMessage.trim()
    : null;

  const message = !isServerError
    ? err.message
    : env.NODE_ENV === 'production'
      ? publicMessage || 'Internal server error'
      : err.message || publicMessage || 'Internal server error';

  const payload = { error: message, code: statusCode, detail: String(message) };

  // Pass through structured details for client-side form errors.
  // Only include these for non-5xx responses to avoid leaking internals.
  if (!isServerError && err?.details) {
    payload.details = err.details;
  }

  res.status(statusCode).json(payload);
}

module.exports = { errorHandler };
