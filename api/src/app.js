'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createErrorHandler, notFound } = require('./http/errors');
const { createHealthRouter } = require('./http/health');

const DEFAULT_RATE_LIMIT = { windowMs: 60 * 1000, limit: 120 };
const JSON_BODY_LIMIT = '100kb';

// Builds the Express application. The database is passed in so tests can
// replace it and the server can own its connection pool.
function createApp({ db, rateLimit: rateOptions = {}, logger = console } = {}) {
  if (!db) {
    throw new TypeError('createApp requires a db dependency.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: rateOptions.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
      limit: rateOptions.limit ?? DEFAULT_RATE_LIMIT.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
      },
    })
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(createHealthRouter({ db, logger }));
  app.use(notFound);
  app.use(createErrorHandler({ logger }));
  return app;
}

module.exports = { createApp };
