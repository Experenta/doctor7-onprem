'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, requireDatabaseUrl } = require('./config');

// A value that must never appear in an error message.
const MARKER = 'MARKER-VALUE-8c1d';
const JITSI = 'https://jitsi.example.test';
const SIGN_IN = {
  OIDC_ISSUER: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'doctor7-test-client',
  OIDC_REDIRECT_URI: 'https://clinic.example.test/auth/callback',
};

test('loadConfig reads every section, with defaults for an empty environment', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.databaseUrl, '');
  assert.equal(config.trustProxy, 0);
  assert.deepEqual(config.rateLimit, { windowMs: 60000, limit: 120 });
  assert.equal(config.auth.enabled, false);
  assert.equal(config.video.provider, null);
  assert.deepEqual(config.chat, { retentionDays: 90 });
});

test('each invalid setting stops loading, and the message names the variable without its value', () => {
  const cases = [
    ['VIDEO_PROVIDER', { VIDEO_PROVIDER: MARKER }],
    ['TRUST_PROXY', { TRUST_PROXY: MARKER }],
    ['TRUST_PROXY', { TRUST_PROXY: '11' }],
    ['PORT', { PORT: MARKER }],
    ['PORT', { PORT: '70000' }],
    ['RATE_LIMIT_MAX', { RATE_LIMIT_MAX: '0' }],
    ['RATE_LIMIT_WINDOW_MS', { RATE_LIMIT_WINDOW_MS: MARKER }],
    ['CHAT_RETENTION_DAYS', { CHAT_RETENTION_DAYS: MARKER }],
    ['OIDC_ISSUER', { ...SIGN_IN, OIDC_ISSUER: `http://${MARKER}.example.test` }],
    ['SESSION_COOKIE_NAME', { ...SIGN_IN, SESSION_COOKIE_NAME: `bad-${MARKER}` }],
    ['AUTH_POST_LOGIN_PATH', { ...SIGN_IN, AUTH_POST_LOGIN_PATH: MARKER }],
    ['JITSI_BASE_URL', { VIDEO_PROVIDER: 'jitsi', JITSI_BASE_URL: MARKER }],
    ['MEET_TIMEOUT_MS', { MEET_TIMEOUT_MS: MARKER }],
    [
      'GOOGLE_SERVICE_ACCOUNT_JSON',
      {
        VIDEO_PROVIDER: 'meet',
        JITSI_BASE_URL: JITSI,
        GOOGLE_MEET_DELEGATED_USER: 'organizer@example.test',
        GOOGLE_SERVICE_ACCOUNT_JSON: MARKER,
      },
    ],
  ];
  for (const [name, env] of cases) {
    assert.throws(
      () => loadConfig(env),
      (err) => err.message.includes(name) && !err.message.includes(MARKER),
      `${name}: ${JSON.stringify(Object.keys(env))}`
    );
  }
});

test('TRUST_PROXY accepts 0 to 10 and the message gives the range', () => {
  assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(loadConfig({ TRUST_PROXY: '10' }).trustProxy, 10);
  assert.throws(() => loadConfig({ TRUST_PROXY: '11' }), /TRUST_PROXY must be a whole number from 0 to 10\./);
});

test('CHAT_RETENTION_DAYS uses the purge rule, so a bad value stops the server too', () => {
  assert.equal(loadConfig({ CHAT_RETENTION_DAYS: '30' }).chat.retentionDays, 30);
  assert.throws(() => loadConfig({ CHAT_RETENTION_DAYS: '0' }), /CHAT_RETENTION_DAYS must be an integer from 1 to 3650\./);
});

test('a wrong VIDEO_PROVIDER is refused by name, for every value that is not meet or jitsi', () => {
  for (const value of ['zoom', 'Meet', ' jitsi', 'livekit']) {
    assert.throws(
      () => loadConfig({ VIDEO_PROVIDER: value }),
      /^Error: VIDEO_PROVIDER must be one of: meet, jitsi\.$/,
      value
    );
  }
});

test('DATABASE_URL is required and must be a mysql URL with a host', () => {
  assert.throws(() => requireDatabaseUrl(loadConfig({})), /^Error: DATABASE_URL is required\.$/);
  assert.equal(
    requireDatabaseUrl(loadConfig({ DATABASE_URL: 'mysql://127.0.0.1:3306/doctor7' })),
    'mysql://127.0.0.1:3306/doctor7'
  );
  for (const value of [`postgres://user:${MARKER}@127.0.0.1/doctor7`, `mysql:///${MARKER}`, `not a url ${MARKER}`]) {
    assert.throws(
      () => requireDatabaseUrl(loadConfig({ DATABASE_URL: value })),
      (err) => err.message.startsWith('DATABASE_URL') && !err.message.includes(MARKER),
      value
    );
  }
});

test('docs/OPERATIONS.md names every setting that the configuration reads', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'OPERATIONS.md'), 'utf8');
  const names = [
    'HOST',
    'PORT',
    'DATABASE_URL',
    'TRUST_PROXY',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_MAX',
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
    'OIDC_SCOPE',
    'AUTH_POST_LOGIN_PATH',
    'SESSION_COOKIE_NAME',
    'SESSION_ABSOLUTE_TTL_SECONDS',
    'SESSION_IDLE_TTL_SECONDS',
    'VIDEO_PROVIDER',
    'JITSI_BASE_URL',
    'JITSI_APP_ID',
    'JITSI_JWT_SECRET',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_MEET_DELEGATED_USER',
    'GOOGLE_MEET_API_BASE_URL',
    'MEET_TIMEOUT_MS',
    'CHAT_RETENTION_DAYS',
  ];
  for (const name of names) {
    assert.ok(doc.includes(`\`${name}\``), `${name} is documented`);
  }
});
