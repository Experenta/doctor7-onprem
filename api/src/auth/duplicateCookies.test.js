'use strict';

// Duplicate session cookies. A browser that still holds an old d7_session cookie
// with Path=/api/ sends it next to the current one. Every value is tried in order,
// and each attempt is a full session check.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fc = require('fast-check');
const { createApp } = require('../app');
const { loadAuthConfig } = require('./config');
const { createMemoryAuthStore } = require('./memoryStore');
const { createSessionService } = require('./session');
const { createRequireSession } = require('./router');
const { parseCookies, parseCookieValues } = require('./cookies');
const { resolveSession, MAX_CANDIDATES } = require('./requestSession');
const { createErrorHandler } = require('../http/errors');
const { fakeDb, listen } = require('../../test/helpers');

const NAME = 'd7_session';
const IDLE_TTL = 600;
const ABSOLUTE_TTL = 3600;
const USERS = [
  { id: 'u-ana', email: 'ana.rivera@example.test', displayName: 'Ana Rivera', role: 'professional', centerId: 'center-1' },
  { id: 'u-luis', email: 'luis.mora@example.test', displayName: 'Luis Mora', role: 'client', centerId: 'center-1' },
];
const BAD = 'Z'.repeat(43);

async function withApp(fn) {
  let time = Date.now();
  const clock = {
    now: () => new Date(time),
    advance(seconds) {
      time += seconds * 1000;
    },
  };
  const config = loadAuthConfig({
    OIDC_ISSUER: 'http://127.0.0.1:1',
    OIDC_CLIENT_ID: 'doctor7-test',
    OIDC_REDIRECT_URI: 'http://127.0.0.1:3000/auth/callback',
    SESSION_ABSOLUTE_TTL_SECONDS: String(ABSOLUTE_TTL),
    SESSION_IDLE_TTL_SECONDS: String(IDLE_TTL),
  });
  const store = createMemoryAuthStore({ users: USERS });
  const sessions = createSessionService({ store, config, now: clock.now });
  const logs = [];
  const logger = { error: (err) => logs.push(String(err && err.message)), warn: (m) => logs.push(String(m)) };
  const api = await listen(createApp({ db: fakeDb(), logger, auth: { config, store, now: clock.now } }));
  const call = (path, cookie, method = 'GET') =>
    fetch(`${api.url}${path}`, { method, headers: cookie ? { cookie } : {}, redirect: 'manual' });
  try {
    await fn({ clock, store, sessions, call, logs });
  } finally {
    await api.close();
  }
}

test('cookies: parseCookieValues returns every value of a name, in order', () => {
  assert.deepEqual(parseCookieValues('a=1; d7_session=x; b=2; d7_session=y', NAME), ['x', 'y']);
  assert.deepEqual(parseCookieValues('d7_session=; d7_session=y', NAME), ['', 'y']);
  assert.deepEqual(parseCookieValues('other=1', NAME), []);
  assert.deepEqual(parseCookieValues(undefined, NAME), []);
  assert.deepEqual(parseCookieValues('d7_session_x=1; xd7_session=2', NAME), []);
});

test('cookies: parseCookies still keeps the first duplicate', () => {
  assert.deepEqual(parseCookies('d7_session=x; d7_session=y'), { d7_session: 'x' });
});

test('/auth/me: an invalid cookie first and a valid one second authenticates', async () => {
  await withApp(async ({ sessions, call }) => {
    const { token } = await sessions.create(USERS[0]);
    const res = await call('/auth/me', `${NAME}=${BAD}; ${NAME}=${token}`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.id, 'u-ana');
  });
});

test('/auth/me: an expired cookie first and a fresh one second authenticates', async () => {
  await withApp(async ({ clock, sessions, call }) => {
    const old = await sessions.create(USERS[0]);
    clock.advance(IDLE_TTL + 1);
    const fresh = await sessions.create(USERS[0]);
    const res = await call('/auth/me', `${NAME}=${old.token}; ${NAME}=${fresh.token}`);
    assert.equal(res.status, 200);
  });
});

test('/auth/me: the valid cookie first still works', async () => {
  await withApp(async ({ sessions, call }) => {
    const { token } = await sessions.create(USERS[0]);
    assert.equal((await call('/auth/me', `${NAME}=${token}; ${NAME}=${BAD}`)).status, 200);
  });
});

test('/auth/me: every cookie invalid answers 401 with the usual error', async () => {
  await withApp(async ({ call, logs }) => {
    const res = await call('/auth/me', `${NAME}=${BAD}; ${NAME}=${'Y'.repeat(43)}`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'unauthenticated');
    assert.ok(!logs.some((line) => line.includes(BAD)));
  });
});

test('/auth/me: a revoked cookie stays dead even next to an invalid one', async () => {
  await withApp(async ({ sessions, call }) => {
    const { token } = await sessions.create(USERS[0]);
    await sessions.revoke(token);
    assert.equal((await call('/auth/me', `${NAME}=${BAD}; ${NAME}=${token}`)).status, 401);
    assert.equal((await call('/auth/me', `${NAME}=${token}; ${NAME}=${BAD}`)).status, 401);
  });
});

test('requireSession: a valid cookie after an invalid one opens a protected route', async () => {
  const store = createMemoryAuthStore({ users: USERS });
  const config = { absoluteTtlSeconds: 100, idleTtlSeconds: 50, sessionCookieName: NAME };
  const sessions = createSessionService({ store, config });
  const requireSession = createRequireSession({ config, sessions });
  const app = express();
  app.get('/any', requireSession(), (req, res) => res.json({ id: req.auth.user.id }));
  app.get('/pro', requireSession('professional'), (req, res) => res.json({ ok: true }));
  app.use(createErrorHandler({ logger: { error() {} } }));
  const server = await listen(app);
  try {
    const pro = (await sessions.create(USERS[0])).token;
    const client = (await sessions.create(USERS[1])).token;
    const get = (path, cookie) => fetch(`${server.url}${path}`, { headers: { cookie } });

    assert.equal((await get('/any', `${NAME}=${BAD}; ${NAME}=${pro}`)).status, 200);
    assert.equal((await get('/any', `${NAME}=${BAD}; ${NAME}=${BAD}`)).status, 401);
    // The role check still applies to the session that was found.
    assert.equal((await get('/pro', `${NAME}=${BAD}; ${NAME}=${client}`)).status, 403);
  } finally {
    await server.close();
  }
});

test('logout: revokes the session that was used and clears both paths', async () => {
  await withApp(async ({ store, sessions, call }) => {
    const used = await sessions.create(USERS[0]);
    const other = await sessions.create(USERS[0]);
    const res = await call('/auth/logout', `${NAME}=${BAD}; ${NAME}=${used.token}`, 'POST');
    assert.equal(res.status, 204);

    const cleared = res.headers.getSetCookie().filter((line) => line.startsWith(`${NAME}=;`));
    assert.equal(cleared.length, 2);
    for (const line of cleared) {
      assert.match(line, /Max-Age=0/);
      assert.match(line, /; HttpOnly/);
      assert.match(line, /; Secure/);
      assert.match(line, /; SameSite=Strict/);
    }
    assert.ok(cleared.some((line) => line.includes('; Path=/;')));
    assert.ok(cleared.some((line) => line.includes('; Path=/api/;')));

    assert.equal((await call('/auth/me', `${NAME}=${used.token}`)).status, 401);
    assert.equal((await call('/auth/me', `${NAME}=${other.token}`)).status, 200);
    assert.equal(store.sessions.size, 2);
  });
});

test('logout without a live session still answers 204 and clears both paths', async () => {
  await withApp(async ({ call }) => {
    const res = await call('/auth/logout', `${NAME}=${BAD}; ${NAME}=${'Y'.repeat(43)}`, 'POST');
    assert.equal(res.status, 204);
    const paths = res.headers
      .getSetCookie()
      .filter((line) => line.startsWith(`${NAME}=;`))
      .map((line) => /Path=([^;]+)/.exec(line)[1]);
    assert.deepEqual(paths.sort(), ['/', '/api/']);
  });
});

test('resolveSession: it tries values in order and stops at the first live session', async () => {
  const seen = [];
  const sessions = {
    async authenticate(token) {
      seen.push(token);
      return token === 'good' ? { user: { id: 'u' } } : null;
    },
  };
  const found = await resolveSession(sessions, `${NAME}=a; ${NAME}=good; ${NAME}=c`, NAME);
  assert.equal(found.token, 'good');
  assert.deepEqual(seen, ['a', 'good']);
});

test('resolveSession: it tries at most MAX_CANDIDATES values', async () => {
  const sessions = { authenticate: async (token) => (token === 'good' ? { user: { id: 'u' } } : null) };
  const bad = Array.from({ length: MAX_CANDIDATES }, (_, i) => `${NAME}=b${i}`);
  const header = [...bad, `${NAME}=good`].join('; ');
  assert.equal((await resolveSession(sessions, header, NAME)).auth, null);
  assert.equal((await resolveSession(sessions, [...bad.slice(1), `${NAME}=good`].join('; '), NAME)).token, 'good');
});

test('property: invalid duplicates in any order never grant access without a valid value', async () => {
  const live = 'LIVE'.repeat(10);
  const sessions = { authenticate: async (token) => (token === live ? { user: { id: 'u' } } : null) };
  const invalid = fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/).filter((value) => value !== live);
  const limit = MAX_CANDIDATES - 1;
  await fc.assert(
    fc.asyncProperty(fc.array(invalid, { maxLength: limit }), fc.array(invalid, { maxLength: limit }), async (before, after) => {
      const header = (values) => values.map((value) => `${NAME}=${value}`).join('; ');
      const without = await resolveSession(sessions, header([...before, ...after]), NAME);
      assert.equal(without.auth, null);
      const room = Math.max(0, limit - before.length);
      const withLive = await resolveSession(sessions, header([...before, live, ...after.slice(0, room)]), NAME);
      assert.equal(withLive.token, live);
    })
  );
});
