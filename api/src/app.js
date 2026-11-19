'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createErrorHandler, notFound } = require('./http/errors');
const { createHealthRouter } = require('./http/health');
const { createAuth } = require('./auth');
const { createAuthzGate } = require('./authz/gate');
const { createCare } = require('./care');
const { createAudit } = require('./audit');
const { createVideo, loadVideoConfig } = require('./video');
const { loadSecurityConfig } = require('./security/config');
const { createSecurityHeaders } = require('./security/headers');
const { createCsrfGuard } = require('./security/csrf');
const { createLoginLimiter, createWriteLimiter } = require('./security/limits');

const DEFAULT_RATE_LIMIT = { windowMs: 60 * 1000, limit: 120 };
const JSON_BODY_LIMIT = '100kb';
const LOGIN_PATHS = ['/auth/login', '/auth/callback'];

// Builds the Express application. The database is passed in so tests can
// replace it and the server can own its connection pool. `trustProxy` is the
// number of reverse proxies in front of the app (Apache is one), so the rate
// limit sees the client IP instead of the proxy IP. `auth` holds the sign-in
// settings. When it is missing or disabled, the /auth routes and the protected
// routes are not mounted. `careStore` replaces the SQL store for appointments
// and consultations, which tests do. `auditStore` replaces the SQL store for
// the audit log, which tests do. `video` holds `config`, the result of
// loadVideoConfig. When it is missing, the config is read from process.env, and
// an invalid VIDEO_PROVIDER stops startup. `security` holds the result of
// loadSecurityConfig (allowed origins, Jitsi origin, sign-in and write limits).
// When it is missing, it is read from process.env.
function createApp({
  db,
  rateLimit: rateOptions = {},
  trustProxy = 0,
  auth: authOptions,
  careStore,
  auditStore,
  video: videoOptions,
  security: securityOptions,
  logger = console,
} = {}) {
  if (!db) {
    throw new TypeError('createApp requires a db dependency.');
  }

  const security =
    securityOptions ||
    loadSecurityConfig(process.env, {
      redirectUri: authOptions && authOptions.config ? authOptions.config.redirectUri : undefined,
      jitsiBaseUrl: videoOptions && videoOptions.config && videoOptions.config.jitsi ? videoOptions.config.jitsi.baseUrl : undefined,
    });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(createSecurityHeaders(security));
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
  // The origin check runs before the body is read.
  app.use(createCsrfGuard({ allowedOrigins: security.allowedOrigins }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  if (authOptions && authOptions.config && authOptions.config.enabled) {
    const audit = createAudit({ db, store: auditStore });
    const auth = createAuth({ ...authOptions, db, logger, audit });
    app.locals.auth = auth;
    // The chat writes to the same audit log, so createServer reads the sink here.
    app.locals.audit = audit;
    // The sign-in routes have their own, stricter limit per client IP.
    app.use(LOGIN_PATHS, createLoginLimiter(security.loginLimit));
    app.use(auth.router);
    // Everything after this point is protected. The gate answers 403 for any
    // route that has no rule, so a new route is closed until a rule opens it.
    app.use(createAuthzGate({ requireSession: auth.requireSession, audit }));
    // State-changing requests are limited for each signed-in user.
    app.use(createWriteLimiter(security.writeLimit));
    app.use(createCare({ db, store: careStore, audit }).router);
    app.use(
      createVideo({
        db,
        store: careStore,
        audit,
        config: (videoOptions && videoOptions.config) || loadVideoConfig(process.env),
        logger,
      }).router
    );
    // The audit router comes last. Its only route is GET /audit, which the gate admits for auditors.
    app.use(audit.router);
  }
  app.use(notFound);
  app.use(createErrorHandler({ logger }));
  return app;
}

module.exports = { createApp };
