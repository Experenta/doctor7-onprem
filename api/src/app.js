'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createErrorHandler, notFound } = require('./http/errors');
const { createHealthRouter } = require('./http/health');
const { createAuth } = require('./auth');
const { createAuthzGate, ROUTE_RULES } = require('./authz/gate');
const { createCare } = require('./care');
const { createAudit } = require('./audit');
const { loadDemoConfig } = require('./demo/config');
const { createMeetControl } = require('./demo/control');
const { createDemoRouter, DEMO_ROUTE_RULES } = require('./demo/router');
const { createVideo, loadVideoConfig } = require('./video');
const { createMemoryMeetingStore } = require('./video/memoryStore');
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
// loadVideoConfig, and optionally `meetingStore`. When `meetingStore` is missing, the
// meetings use the SQL store, or an in-memory store when `careStore` is replaced.
// When `config` is missing, the config is read from process.env, and
// an invalid VIDEO_PROVIDER stops startup. `security` holds the result of
// loadSecurityConfig (allowed origins, Jitsi origin, sign-in and write limits).
// When it is missing, it is read from process.env. `demo` holds `config`, the result of
// loadDemoConfig, and optionally `fetchImpl`. The demo-only Meet outage switch (K-36) exists
// only when that config is not null, which needs DEMO_MODE=1. Without it, the gate gets no rule
// for the switch, no router is mounted, and no client for the simulator is created.
function createApp({
  db,
  rateLimit: rateOptions = {},
  trustProxy = 0,
  auth: authOptions,
  careStore,
  auditStore,
  video: videoOptions,
  security: securityOptions,
  demo: demoOptions,
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
    // The demo switch gets its rules only when DEMO_MODE=1.
    const demoConfig = demoOptions ? demoOptions.config : loadDemoConfig(process.env);
    app.use(
      createAuthzGate({
        requireSession: auth.requireSession,
        audit,
        rules: demoConfig ? [...ROUTE_RULES, ...DEMO_ROUTE_RULES] : ROUTE_RULES,
      })
    );
    // State-changing requests are limited for each signed-in user.
    app.use(createWriteLimiter(security.writeLimit));
    app.use(createCare({ db, store: careStore, audit }).router);
    app.use(
      createVideo({
        db,
        store: careStore,
        // With a replaced care store there is no real database, so the meetings stay in memory.
        meetingStore: (videoOptions && videoOptions.meetingStore) || (careStore ? createMemoryMeetingStore() : undefined),
        audit,
        config: (videoOptions && videoOptions.config) || loadVideoConfig(process.env),
        logger,
        demoMode: Boolean(demoConfig),
      }).router
    );
    // The demo-only Meet outage switch. Nothing is created without DEMO_MODE=1.
    if (demoConfig) {
      app.use(
        createDemoRouter({
          control: createMeetControl({ config: demoConfig, fetchImpl: demoOptions && demoOptions.fetchImpl }),
          audit,
        })
      );
    }
    // The audit router comes last. Its only route is GET /audit, which the gate admits for auditors.
    app.use(audit.router);
  }
  app.use(notFound);
  app.use(createErrorHandler({ logger }));
  return app;
}

module.exports = { createApp };
