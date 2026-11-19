'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../config');
const { start } = require('../server');
const { loadVideoConfig } = require('../video/config');
const { loadSecurityConfig, parseAllowedOrigins } = require('./config');

const MARKER = 'MARKER-VALUE-5f2a';
const SIGN_IN = {
  OIDC_ISSUER: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'doctor7-test-client',
  OIDC_REDIRECT_URI: 'https://clinic.example.test/auth/callback',
};

test('production stops without sign-in, and the message names the variables', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    (err) => /NODE_ENV=production requires sign-in/.test(err.message) && err.message.includes('OIDC_ISSUER')
  );
  assert.throws(() => loadConfig({ NODE_ENV: 'production', VIDEO_PROVIDER: '' }), /requires sign-in/);
});

test('production starts with sign-in, and other environments start without it', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production', ...SIGN_IN }).auth.enabled, true);
  assert.equal(loadConfig({}).auth.enabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'development' }).auth.enabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'test' }).auth.enabled, false);
});

test('start refuses a production environment without sign-in before it opens anything', () => {
  const output = [];
  assert.throws(
    () => start({ NODE_ENV: 'production', DATABASE_URL: 'mysql://127.0.0.1:1/doctor7_test' }, { write: (text) => output.push(text) }),
    /NODE_ENV=production requires sign-in/
  );
  assert.deepEqual(output, []);
});

test('video config does not repeat the received VIDEO_PROVIDER value', () => {
  for (const value of [MARKER, 'zoom', ' meet']) {
    assert.throws(
      () => loadVideoConfig({ VIDEO_PROVIDER: value }),
      (err) => err.message === 'VIDEO_PROVIDER must be one of: meet, jitsi.',
      value
    );
  }
});

test('ALLOWED_ORIGINS: a list of origins is read, and a bad entry stops loading without its value', () => {
  assert.deepEqual(parseAllowedOrigins('https://a.example.test, https://b.example.test:8443'), [
    'https://a.example.test',
    'https://b.example.test:8443',
  ]);
  assert.deepEqual(parseAllowedOrigins('http://localhost:5173'), ['http://localhost:5173']);
  for (const bad of [
    `https://${MARKER}.example.test/path`,
    `https://${MARKER}.example.test/`,
    `http://${MARKER}.example.test`,
    `ftp://${MARKER}.example.test`,
    `https://user:${MARKER}@example.test`,
    MARKER,
    `https://ok.example.test,${MARKER}`,
  ]) {
    assert.throws(
      () => loadConfig({ ALLOWED_ORIGINS: bad }),
      (err) => err.message.startsWith('ALLOWED_ORIGINS') && !err.message.includes(MARKER),
      bad
    );
  }
});

test('ALLOWED_ORIGINS defaults to the origin of the sign-in redirect, and an explicit list replaces it', () => {
  assert.deepEqual(loadConfig(SIGN_IN).security.allowedOrigins, ['https://clinic.example.test']);
  assert.deepEqual(loadConfig({ ...SIGN_IN, ALLOWED_ORIGINS: 'https://other.example.test' }).security.allowedOrigins, [
    'https://other.example.test',
  ]);
  assert.deepEqual(loadConfig({}).security.allowedOrigins, []);
});

test('the Jitsi origin comes from JITSI_BASE_URL, and the limits have strict defaults', () => {
  const security = loadSecurityConfig({ JITSI_BASE_URL: 'https://jitsi.example.test/meet/' });
  assert.equal(security.jitsiOrigin, 'https://jitsi.example.test');
  assert.deepEqual(security.loginLimit, { windowMs: 15 * 60 * 1000, limit: 20 });
  assert.deepEqual(security.writeLimit, { windowMs: 60 * 1000, limit: 60 });
  assert.equal(loadSecurityConfig({}).jitsiOrigin, null);
});

test('the limit settings are validated by name, without their value', () => {
  for (const name of ['RATE_LIMIT_LOGIN_MAX', 'RATE_LIMIT_LOGIN_WINDOW_MS', 'RATE_LIMIT_WRITE_MAX', 'RATE_LIMIT_WRITE_WINDOW_MS']) {
    assert.throws(
      () => loadConfig({ [name]: MARKER }),
      (err) => err.message.includes(name) && !err.message.includes(MARKER),
      name
    );
    assert.throws(() => loadConfig({ [name]: '0' }), new RegExp(name));
  }
  assert.equal(loadSecurityConfig({ RATE_LIMIT_LOGIN_MAX: '5' }).loginLimit.limit, 5);
});

test('docs/SECURITY.md names every setting, header, and defense of this layer', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'SECURITY.md'), 'utf8');
  for (const name of [
    'ALLOWED_ORIGINS',
    'NODE_ENV',
    'RATE_LIMIT_LOGIN_MAX',
    'RATE_LIMIT_LOGIN_WINDOW_MS',
    'RATE_LIMIT_WRITE_MAX',
    'RATE_LIMIT_WRITE_WINDOW_MS',
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Cross-Origin-Opener-Policy',
    'Sec-Fetch-Site',
    'csrf_rejected',
    'rate_limited',
  ]) {
    assert.ok(doc.includes(name), `${name} is documented`);
  }
});
