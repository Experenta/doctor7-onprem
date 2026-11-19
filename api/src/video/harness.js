'use strict';

// Shared setup for the video tests. The file name does not end in .test.js, so
// the runner does not execute it. The API runs with in-memory stores, a mock
// Google, and a live session for every synthetic user.

const { createApp } = require('../app');
const { createMemoryAuthStore } = require('../auth/memoryStore');
const { createMemoryCareStore } = require('../care/memoryStore');
const { createMemoryAuditStore } = require('../audit/memoryStore');
const { createMemoryMeetingStore } = require('./memoryStore');
const { USERS, APPOINTMENTS, AUTH_CONFIG } = require('../audit/harness');
const { fakeDb, listen } = require('../../test/helpers');
const { createMockGoogle } = require('../../../tools/mock-google/server');
const { createTestServiceAccount } = require('../../../tools/mock-google/testing');
const { loadVideoConfig } = require('./config');

const JITSI_BASE_URL = 'https://jitsi.example.test';

// A logger that keeps every line, so tests can search the log.
function capturingLogger() {
  const lines = [];
  const keep = (...args) => lines.push(args.map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg))).join(' '));
  return { lines, error: keep, warn: keep, info: keep, log: keep };
}

// Starts a mock Google and the API. `env` adds to or replaces the video settings.
// Appointment a1 (center c1): professional u-pro1, client u-cli1.
async function startVideoApi({ env = {}, googleMode = 'ok' } = {}) {
  const account = createTestServiceAccount();
  const google = await createMockGoogle({
    publicKeyPem: account.publicKeyPem,
    serviceAccountEmail: account.email,
    delegatedUsers: [account.delegatedUser],
  }).start();
  google.mode = googleMode;

  let config;
  try {
    config = loadVideoConfig({
      VIDEO_PROVIDER: 'meet',
      JITSI_BASE_URL,
      GOOGLE_SERVICE_ACCOUNT_JSON: account.credentialJson(google.issuer),
      GOOGLE_MEET_DELEGATED_USER: account.delegatedUser,
      GOOGLE_MEET_API_BASE_URL: google.issuer,
      MEET_TIMEOUT_MS: '300',
      ...env,
    });
  } catch (err) {
    await google.close();
    throw err;
  }

  const logger = capturingLogger();
  const auditStore = createMemoryAuditStore();
  const careStore = createMemoryCareStore({ users: USERS, appointments: APPOINTMENTS, consultations: [] });
  const meetingStore = createMemoryMeetingStore();
  const authStore = createMemoryAuthStore({ users: USERS });
  const app = createApp({
    db: fakeDb(),
    logger,
    rateLimit: { limit: 1e9 },
    auth: { config: AUTH_CONFIG, store: authStore, oidc: {} },
    careStore,
    auditStore,
    video: { config, meetingStore },
  });
  const tokens = {};
  for (const user of USERS) {
    tokens[user.id] = (await app.locals.auth.sessions.create(user)).token;
  }
  const server = await listen(app);

  async function call(method, path, { as = null, body, raw, contentType = 'application/json' } = {}) {
    const headers = {};
    if (as) headers.Cookie = `d7_session=${tokens[as]}`;
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
    return { status: res.status, json, text, headers: res.headers };
  }

  // Audit entries whose action starts with `prefix`.
  const entries = (prefix = '') => auditStore.entries.filter((entry) => entry.action.startsWith(prefix));

  return {
    account,
    google,
    config,
    logger,
    auditStore,
    careStore,
    meetingStore,
    call,
    entries,
    async close() {
      await server.close();
      await google.close();
    },
  };
}

module.exports = { startVideoApi, capturingLogger, JITSI_BASE_URL };
