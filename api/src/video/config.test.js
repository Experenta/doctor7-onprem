'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const { loadVideoConfig } = require('./config');

// The marker lines are joined at run time, so this file holds no key block.
const KEY_BLOCK = ['-----BEGIN PRIV' + 'ATE KEY-----', 'TESTONLYKEYBODY', '-----END PRIV' + 'ATE KEY-----', ''].join('\n');
const CREDENTIAL = JSON.stringify({
  client_email: 'meet-sa@doctor7-test.example.test',
  private_key: KEY_BLOCK,
});
const JITSI = { JITSI_BASE_URL: 'https://jitsi.example.test' };
const MEET = {
  VIDEO_PROVIDER: 'meet',
  ...JITSI,
  GOOGLE_SERVICE_ACCOUNT_JSON: CREDENTIAL,
  GOOGLE_MEET_DELEGATED_USER: 'clinic.organizer@example.test',
};

test('an unset or empty VIDEO_PROVIDER means no provider', () => {
  assert.equal(loadVideoConfig({}).provider, null);
  assert.equal(loadVideoConfig({ VIDEO_PROVIDER: '' }).provider, null);
});

test('an invalid VIDEO_PROVIDER stops with a clear error', () => {
  for (const value of ['zoom', 'Meet', 'JITSI', ' meet', 'meet ', 'teams', 'livekit']) {
    assert.throws(
      () => loadVideoConfig({ VIDEO_PROVIDER: value, ...JITSI }),
      (err) => err.message.includes('VIDEO_PROVIDER must be one of: meet, jitsi'),
      JSON.stringify(value)
    );
  }
});

test('jitsi needs JITSI_BASE_URL', () => {
  assert.throws(() => loadVideoConfig({ VIDEO_PROVIDER: 'jitsi' }), /JITSI_BASE_URL is required/);
  const config = loadVideoConfig({ VIDEO_PROVIDER: 'jitsi', ...JITSI });
  assert.equal(config.provider, 'jitsi');
  assert.equal(config.jitsi.baseUrl, 'https://jitsi.example.test');
  assert.equal(config.meet, null);
});

test('meet needs the credential, the delegated user, and the Jitsi failover address', () => {
  assert.throws(() => loadVideoConfig({ ...MEET, JITSI_BASE_URL: '' }), /JITSI_BASE_URL is required/);
  assert.throws(() => loadVideoConfig({ ...MEET, GOOGLE_SERVICE_ACCOUNT_JSON: '' }), /GOOGLE_SERVICE_ACCOUNT_JSON is required/);
  assert.throws(() => loadVideoConfig({ ...MEET, GOOGLE_MEET_DELEGATED_USER: '' }), /GOOGLE_MEET_DELEGATED_USER is required/);
  const config = loadVideoConfig(MEET);
  assert.equal(config.provider, 'meet');
  assert.equal(config.meet.apiBaseUrl, 'https://meet.googleapis.com');
  assert.equal(config.timeoutMs, 5000);
});

test('an invalid credential fails without quoting its value', () => {
  const secret = 'SUPER-SECRET-MARKER-123';
  const broken = [
    `{"private_key": "${secret}"`, // not JSON
    JSON.stringify({ client_email: 'x@example.test', private_key: secret }), // not a key
    JSON.stringify({ private_key: `PRIVATE KEY ${secret}` }), // no email
    JSON.stringify([secret]),
    secret,
  ];
  for (const value of broken) {
    assert.throws(
      () => loadVideoConfig({ ...MEET, GOOGLE_SERVICE_ACCOUNT_JSON: value }),
      (err) => err.message.startsWith('GOOGLE_SERVICE_ACCOUNT_JSON') && !err.message.includes(secret),
      value
    );
  }
  assert.throws(
    () =>
      loadVideoConfig({
        ...MEET,
        GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...JSON.parse(CREDENTIAL), token_uri: 'http://evil.example.test/token' }),
      }),
    /token_uri/
  );
});

test('the token_uri of the credential is kept, so tests can point it at the mock', () => {
  const withUri = JSON.stringify({ ...JSON.parse(CREDENTIAL), token_uri: 'http://127.0.0.1:4020/token' });
  assert.equal(loadVideoConfig({ ...MEET, GOOGLE_SERVICE_ACCOUNT_JSON: withUri }).meet.credential.tokenUri, 'http://127.0.0.1:4020/token');
  assert.equal(loadVideoConfig(MEET).meet.credential.tokenUri, undefined);
});

test('secrets are not enumerable, so printing the config does not show them', () => {
  const config = loadVideoConfig({ ...MEET, JITSI_APP_ID: 'app-1', JITSI_JWT_SECRET: 'JITSI-SECRET-MARKER' });
  assert.equal(config.meet.credential.clientEmail, 'meet-sa@doctor7-test.example.test');
  assert.equal(config.jitsi.jwtSecret, 'JITSI-SECRET-MARKER');
  for (const view of [JSON.stringify(config), util.inspect(config, { depth: 10 }), String(Object.values(config.meet))]) {
    assert.ok(!view.includes('TESTONLYKEYBODY'));
    assert.ok(!view.includes('JITSI-SECRET-MARKER'));
    assert.ok(!view.includes('meet-sa@doctor7-test'));
  }
});

test('Jitsi token settings come in a pair', () => {
  assert.throws(() => loadVideoConfig({ VIDEO_PROVIDER: 'jitsi', ...JITSI, JITSI_APP_ID: 'app-1' }), /set together/);
  assert.throws(() => loadVideoConfig({ VIDEO_PROVIDER: 'jitsi', ...JITSI, JITSI_JWT_SECRET: 'x' }), /set together/);
  const config = loadVideoConfig({ VIDEO_PROVIDER: 'jitsi', ...JITSI, JITSI_APP_ID: 'app-1', JITSI_JWT_SECRET: 'x' });
  assert.equal(config.jitsi.appId, 'app-1');
});

test('addresses must be https, or http on loopback, with no credentials or query', () => {
  const bad = [
    'http://jitsi.example.test',
    'ftp://jitsi.example.test',
    'not a url',
    'https://user:pass@jitsi.example.test',
    'https://jitsi.example.test/?a=b',
    'https://jitsi.example.test/#frag',
  ];
  for (const value of bad) {
    assert.throws(() => loadVideoConfig({ VIDEO_PROVIDER: 'jitsi', JITSI_BASE_URL: value }), /JITSI_BASE_URL/, value);
  }
  assert.equal(
    loadVideoConfig({ VIDEO_PROVIDER: 'jitsi', JITSI_BASE_URL: 'http://127.0.0.1:8000/' }).jitsi.baseUrl,
    'http://127.0.0.1:8000'
  );
  assert.throws(() => loadVideoConfig({ ...MEET, GOOGLE_MEET_API_BASE_URL: 'http://meet.example.test' }), /GOOGLE_MEET_API_BASE_URL/);
});

test('MEET_TIMEOUT_MS is validated', () => {
  for (const value of ['abc', '-1', '99', '60001', '1.5']) {
    assert.throws(() => loadVideoConfig({ MEET_TIMEOUT_MS: value }), /MEET_TIMEOUT_MS/, value);
  }
  assert.equal(loadVideoConfig({ MEET_TIMEOUT_MS: '250' }).timeoutMs, 250);
});
