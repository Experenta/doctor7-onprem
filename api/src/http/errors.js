'use strict';

// Every error response uses one JSON shape: { error: { code, message } }.
// Stack traces and driver messages go to the server log only.

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function notFound(req, res, next) {
  next(new ApiError(404, 'not_found', 'Route not found.'));
}

function createErrorHandler({ logger = console } = {}) {
  // Express recognizes error middleware by its four-parameter signature.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      next(err);
      return;
    }

    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error.';

    if (err instanceof ApiError) {
      status = err.status;
      code = err.code;
      message = err.message;
    } else if (err && err.type === 'entity.parse.failed') {
      status = 400;
      code = 'invalid_json';
      message = 'Request body is not valid JSON.';
    } else if (err && err.type === 'entity.too.large') {
      status = 413;
      code = 'payload_too_large';
      message = 'Request body is too large.';
    } else {
      logger.error(err);
    }

    res.status(status).json({ error: { code, message } });
  };
}

module.exports = { ApiError, notFound, createErrorHandler };
