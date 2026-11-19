'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { loadAuthConfig } = require('./config');
const { loadConfig } = require('../config');
const { parseCookies, serializeCookie, clearCookie } = require('./cookies');
const { createSqlAuthStore } = require('./store');
const { createMemoryAuthStore } = require('./memoryStore');
const { createSessionService } = require('./session');
const { createRequireSession } = require('./router');
const { pkceChallenge, sha256Hex } = require('./tokens');
const { createErrorHandler } = require('../http/errors');
const { listen: listenApp } = require('../../test/helpers');

const OIDC_ENV = {
  OIDC_ISSUER: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'doctor7',
  OIDC_REDIRECT_URI: 'https://clinic.example.test/auth/callback',
};

test('config: sign-in is disabled when no OIDC variable is set', () => {
  assert.deepEqual(loadAuthConfig({}), { enabled: false });
});

test('config: the three OIDC variables must be set together', () => {
  assert.throws(() => loadAuthConfig({ OIDC_ISSUER: OIDC_ENV.OIDC_ISSUER }), /must be set together/);
});

test('config: defaults, and the issuer is kept exactly as given', () => {
  const config = loadAuthConfig(OIDC_ENV);
  assert.equal(config.enabled, true);
  assert.equal(config.issuer, 'https://idp.example.test');
  assert.equal(config.clientSecret, '');
  assert.equal(config.scope, 'openid email profile');
  assert.equal(config.absoluteTtlSeconds, 8 * 60 * 60);
  assert.equal(config.idleTtlSeconds, 30 * 60);
  assert.equal(config.sessionCookieName, 'd7_session');
  assert.equal(config.postLoginPath, '/');
});

test('config: http is accepted only for loopback hosts', () => {
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, OIDC_ISSUER: 'http://idp.example.test' }), /https/);
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, OIDC_REDIRECT_URI: 'http://clinic.example.test/cb' }), /https/);
  assert.doesNotThrow(() =>
    loadAuthConfig({
      ...OIDC_ENV,
      OIDC_ISSUER: 'http://127.0.0.1:4010',
      OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    })
  );
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, OIDC_ISSUER: 'not a url' }), /absolute URL/);
});

test('config: lifetimes, cookie name, and redirect path are validated', () => {
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, SESSION_IDLE_TTL_SECONDS: '0' }), /positive integer/);
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, SESSION_ABSOLUTE_TTL_SECONDS: 'abc' }), /positive integer/);
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, SESSION_COOKIE_NAME: 'bad name;' }), /SESSION_COOKIE_NAME/);
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, AUTH_POST_LOGIN_PATH: '//elsewhere.example.test' }), /single slash/);
  assert.throws(() => loadAuthConfig({ ...OIDC_ENV, AUTH_POST_LOGIN_PATH: 'https://elsewhere.example.test' }), /single slash/);
  assert.equal(loadAuthConfig({ ...OIDC_ENV, AUTH_POST_LOGIN_PATH: '/app' }).postLoginPath, '/app');
});

test('config: TRUST_PROXY defaults to 0 and must be a non-negative integer', () => {
  assert.equal(loadConfig({}).trustProxy, 0);
  assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  assert.throws(() => loadConfig({ TRUST_PROXY: 'yes' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ TRUST_PROXY: '-1' }), /TRUST_PROXY/);
});

test('config: loadConfig carries the sign-in settings', () => {
  assert.equal(loadConfig({}).auth.enabled, false);
  assert.equal(loadConfig(OIDC_ENV).auth.enabled, true);
});

test('tokens: the PKCE challenge matches the RFC 7636 example', () => {
  assert.equal(
    pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
});

test('cookies: parse reads pairs and the first duplicate wins', () => {
  assert.deepEqual(parseCookies('a=1; b=2; a=3'), { a: '1', b: '2' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('novalue; =x'), {});
});

test('cookies: serialize sets every protective attribute', () => {
  const line = serializeCookie('d7_session', 'abc-DEF_123', { maxAgeSeconds: 90.7, sameSite: 'Strict' });
  assert.equal(line, 'd7_session=abc-DEF_123; Max-Age=90; Path=/; HttpOnly; Secure; SameSite=Strict');
  assert.match(clearCookie('d7_session', { sameSite: 'Strict' }), /^d7_session=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
});

test('cookies: serialize refuses values that could inject attributes', () => {
  assert.throws(() => serializeCookie('d7_session', 'a; Domain=evil', { maxAgeSeconds: 1, sameSite: 'Strict' }), TypeError);
  assert.throws(() => serializeCookie('bad name', 'a', { maxAgeSeconds: 1, sameSite: 'Strict' }), TypeError);
  assert.throws(() => serializeCookie('d7_session', 'a', { maxAgeSeconds: 1, sameSite: 'None' }), TypeError);
});

// A fake database that records each statement and answers with queued results.
function recordingDb(...answers) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      return answers.length > 0 ? answers.shift() : [];
    },
  };
}

test('sql store: values travel as bound parameters, never inside the statement text', async () => {
  const hostile = "x'; DROP TABLE users; --";
  const db = recordingDb([], []);
  const store = createSqlAuthStore(db);
  await store.findUserByEmail(hostile);
  await store.findSession(hostile);
  await store.revokeSession(hostile, new Date('2026-11-19T00:00:00.000Z'));
  for (const { sql, params } of db.calls) {
    assert.ok(!sql.includes('DROP TABLE'), 'hostile text reached the SQL text');
    assert.ok(params.includes(hostile), 'hostile text was not bound');
  }
});

test('sql store: times are written as UTC DATETIME text', async () => {
  const db = recordingDb();
  const store = createSqlAuthStore(db);
  const at = new Date('2026-11-19T03:26:00.123Z');
  await store.createSession({
    idHash: 'h'.repeat(64),
    userId: 'u1',
    createdAt: at,
    lastSeenAt: at,
    expiresAt: new Date(at.getTime() + 1000),
  });
  assert.deepEqual(db.calls[0].params.slice(2), ['2026-11-19 03:26:00.123', '2026-11-19 03:26:00.123', '2026-11-19 03:26:01.123']);
});

test('sql store: a login attempt can be consumed once, and only when the delete wins', async () => {
  const row = { state_hash: 's', binding_hash: 'b', nonce: 'n', code_verifier: 'v', expires_at: new Date(5000) };
  const won = createSqlAuthStore(recordingDb([row], { affectedRows: 1 }));
  assert.deepEqual(await won.consumeLoginAttempt('s'), {
    stateHash: 's',
    bindingHash: 'b',
    nonce: 'n',
    codeVerifier: 'v',
    expiresAt: new Date(5000),
  });

  const lostRace = createSqlAuthStore(recordingDb([row], { affectedRows: 0 }));
  assert.equal(await lostRace.consumeLoginAttempt('s'), null);

  const unknown = createSqlAuthStore(recordingDb([]));
  assert.equal(await unknown.consumeLoginAttempt('s'), null);
});

test('sql store: a session read joins the users row for role and center', async () => {
  const at = new Date('2026-11-19T00:00:00.000Z');
  const db = recordingDb([
    {
      user_id: 'u1',
      created_at: at,
      last_seen_at: at,
      expires_at: at,
      revoked_at: null,
      email: 'ana.rivera@example.test',
      display_name: 'Ana Rivera',
      role: 'professional',
      center_id: 'c1',
    },
  ]);
  const session = await createSqlAuthStore(db).findSession('abc');
  assert.match(db.calls[0].sql, /JOIN users/);
  assert.deepEqual(session.user, {
    id: 'u1',
    email: 'ana.rivera@example.test',
    displayName: 'Ana Rivera',
    role: 'professional',
    centerId: 'c1',
  });
  assert.equal(session.revokedAt, null);
});

test('sql store: global revocation reports how many sessions it ended', async () => {
  const store = createSqlAuthStore(recordingDb({ affectedRows: 3 }));
  assert.equal(await store.revokeAllForUser('u1', new Date()), 3);
});

test('session service: only the digest of the token reaches the store', async () => {
  const store = createMemoryAuthStore({ users: [{ id: 'u1', email: 'a@example.test', role: 'client' }] });
  const service = createSessionService({
    store,
    config: { absoluteTtlSeconds: 100, idleTtlSeconds: 50 },
  });
  const { token } = await service.create({ id: 'u1' });
  assert.ok(store.sessions.has(sha256Hex(token)));
  assert.ok(!store.sessions.has(token));
  assert.equal((await service.authenticate(token)).user.id, 'u1');
  assert.equal(await service.authenticate(''), null);
  assert.equal(await service.authenticate('x'.repeat(300)), null);
});

test('requireSession: 401 without a session, 403 for the wrong role, and sets req.auth', async () => {
  let time = Date.now();
  const store = createMemoryAuthStore({
    users: [
      { id: 'u1', email: 'a@example.test', displayName: 'A', role: 'professional', centerId: 'c1' },
      { id: 'u2', email: 'b@example.test', displayName: 'B', role: 'client', centerId: 'c1' },
    ],
  });
  const config = { absoluteTtlSeconds: 100, idleTtlSeconds: 50, sessionCookieName: 'd7_session' };
  const sessions = createSessionService({ store, config, now: () => new Date(time) });
  const requireSession = createRequireSession({ config, sessions });

  const app = express();
  app.get('/any', requireSession(), (req, res) => res.json({ role: req.auth.user.role }));
  app.get('/pro', requireSession('professional', 'admin'), (req, res) => res.json({ ok: true }));
  app.use(createErrorHandler({ logger: { error() {} } }));
  const server = await listenApp(app);
  try {
    assert.equal((await fetch(`${server.url}/any`)).status, 401);

    const pro = (await sessions.create({ id: 'u1' })).token;
    const client = (await sessions.create({ id: 'u2' })).token;
    const get = (path, token) => fetch(`${server.url}${path}`, { headers: { cookie: `d7_session=${token}` } });

    assert.equal((await get('/any', client)).status, 200);
    assert.equal((await get('/pro', pro)).status, 200);
    const denied = await get('/pro', client);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'forbidden');

    time += 51 * 1000;
    assert.equal((await get('/pro', pro)).status, 401);
  } finally {
    await server.close();
  }
});
