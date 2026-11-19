'use strict';

// Shared setup for the audit tests. The file name does not end in .test.js, so the
// runner does not execute it. The API runs with in-memory stores, except that the
// audit sink can be replaced, and sessions are created through the session service.

const { createApp } = require('../app');
const { createMemoryAuthStore } = require('../auth/memoryStore');
const { createMemoryCareStore } = require('../care/memoryStore');
const { createMemoryAuditStore } = require('./memoryStore');
const { loadAuthConfig } = require('../auth/config');
const { fakeDb, listen } = require('../../test/helpers');

const quietLogger = { error() {}, warn() {} };

const AUTH_CONFIG = {
  enabled: true,
  sessionCookieName: 'd7_session',
  absoluteTtlSeconds: 3600,
  idleTtlSeconds: 600,
  postLoginPath: '/',
};

const person = (id, role, centerId, email = `${id}@example.test`) => ({
  id,
  email,
  displayName: id,
  role,
  centerId,
});

// Synthetic users. u-ana matches a mock identity provider account, for sign-in tests.
const USERS = [
  person('u-pro1', 'professional', 'c1'),
  person('u-pro1b', 'professional', 'c1'),
  person('u-cli1', 'client', 'c1'),
  person('u-cli1b', 'client', 'c1'),
  person('u-adm1', 'admin', 'c1'),
  person('u-aud1', 'auditor', 'c1'),
  person('u-pro2', 'professional', 'c2'),
  person('u-cli2', 'client', 'c2'),
  person('u-aud2', 'auditor', 'c2'),
  person('u-adm0', 'admin', null),
  person('u-aud0', 'auditor', null),
  person('u-ana', 'professional', 'c1', 'ana.rivera@example.test'),
  person('u-pending', 'client', 'c1', 'pending@example.test'),
];

const appointment = (id, centerId, professionalId, clientId) => ({
  id,
  centerId,
  professionalId,
  clientId,
  startsAt: new Date('2026-12-01T15:00:00.000Z'),
  endsAt: new Date('2026-12-01T15:50:00.000Z'),
  status: 'scheduled',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

const APPOINTMENTS = [
  appointment('a1', 'c1', 'u-pro1', 'u-cli1'),
  appointment('a2', 'c1', 'u-pro1b', 'u-cli1b'),
  appointment('a3', 'c2', 'u-pro2', 'u-cli2'),
];

const CONSULTATIONS = [
  { id: 'k1', appointmentId: 'a1', body: { note: 'synthetic note k1' }, createdAt: new Date('2026-12-01T16:00:00.000Z') },
  { id: 'k3', appointmentId: 'a3', body: { note: 'synthetic note k3' }, createdAt: new Date('2026-12-01T16:00:00.000Z') },
];

// Starts the API with the in-memory stores and a live session for every user.
// `auth` can override the sign-in settings (used by the sign-in tests).
// `auditStore` replaces the audit sink. The default is the in-memory store.
async function startApi({ auth, auditStore = createMemoryAuditStore(), users = USERS } = {}) {
  const careStore = createMemoryCareStore({ users, appointments: APPOINTMENTS, consultations: CONSULTATIONS });
  const authStore = createMemoryAuthStore({ users });
  const app = createApp({
    db: fakeDb(),
    logger: quietLogger,
    rateLimit: { limit: 1e9 },
    auth: auth || { config: AUTH_CONFIG, store: authStore, oidc: {} },
    careStore,
    auditStore,
  });
  const tokens = {};
  for (const user of users) {
    tokens[user.id] = (await app.locals.auth.sessions.create(user)).token;
  }
  const server = await listen(app);

  // Sends a request as `as` (a user id, or null for no session).
  async function call(method, path, { as = null, body, cookie, raw, contentType = 'application/json' } = {}) {
    const headers = {};
    if (as) headers.Cookie = `d7_session=${tokens[as]}`;
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (raw !== undefined) {
      payload = raw;
      if (contentType) headers['Content-Type'] = contentType;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (contentType) headers['Content-Type'] = contentType;
    }
    const res = await fetch(`${server.url}${path}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }

  return { app, server, call, tokens, auditStore, authStore, careStore, close: () => server.close() };
}

// The audit entries of a store, as plain objects.
function entriesOf(auditStore) {
  return auditStore.entries.map((entry) => ({ ...entry }));
}

// Sign-in settings that point at a running mock identity provider.
function providerAuth(idp, { clientId, redirectUri }) {
  return {
    config: {
      ...loadAuthConfig({
        OIDC_ISSUER: idp.issuer,
        OIDC_CLIENT_ID: clientId,
        OIDC_REDIRECT_URI: redirectUri,
        SESSION_ABSOLUTE_TTL_SECONDS: '3600',
        SESSION_IDLE_TTL_SECONDS: '600',
      }),
    },
    store: createMemoryAuthStore({ users: USERS }),
  };
}

module.exports = {
  USERS,
  APPOINTMENTS,
  CONSULTATIONS,
  AUTH_CONFIG,
  quietLogger,
  startApi,
  entriesOf,
  providerAuth,
  createMemoryAuditStore,
};
