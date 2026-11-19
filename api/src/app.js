'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createErrorHandler, notFound } = require('./http/errors');
const { createHealthRouter } = require('./http/health');
const { createAuth } = require('./auth');
const { createAuthzGate } = require('./authz/gate');
const { createCare } = require('./care');

const DEFAULT_RATE_LIMIT = { windowMs: 60 * 1000, limit: 120 };
const JSON_BODY_LIMIT = '100kb';

// Builds the Express application. The database is passed in so tests can
// replace it and the server can own its connection pool. `trustProxy` is the
// number of reverse proxies in front of the app (Apache is one), so the rate
// limit sees the client IP instead of the proxy IP. `auth` holds the sign-in
// settings. When it is missing or disabled, the /auth routes and the protected
// routes are not mounted. `careStore` replaces the SQL store for appointments
// and consultations, which tests do.
function createApp({
  db,
  rateLimit: rateOptions = {},
  trustProxy = 0,
  auth: authOptions,
  careStore,
  logger = console,
} = {}) {
  if (!db) {
    throw new TypeError('createApp requires a db dependency.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet());
  // Probes are registered before the rate limit so monitoring is never throttled.
  app.use(createHealthRouter({ db, logger }));
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
  if (authOptions && authOptions.config && authOptions.config.enabled) {
    const auth = createAuth({ ...authOptions, db, logger });
    app.locals.auth = auth;
    app.use(auth.router);
    // Everything after this point is protected. The gate answers 403 for any
    // route that has no rule, so a new route is closed until a rule opens it.
    app.use(createAuthzGate({ requireSession: auth.requireSession }));
    app.use(createCare({ db, store: careStore }).router);
  }
  app.use(notFound);
  app.use(createErrorHandler({ logger }));
  return app;
}

module.exports = { createApp };
