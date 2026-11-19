'use strict';

// End-to-end tests of the sign-in flow. The mock identity provider runs on a
// loopback port, the API runs with an in-memory store, and the test plays the
// part of the browser with a small cookie jar.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { createMockIdp } = require('../../../tools/mock-idp/server');
const { createMemoryAuthStore } = require('./memoryStore');
const { loadAuthConfig } = require('./config');
const { fakeDb, listen } = require('../../test/helpers');

const REDIRECT_URI = 'http://127.0.0.1:3000/auth/callback';
const CLIENT_ID = 'doctor7-test';
const ABSOLUTE_TTL = 3600;
const IDLE_TTL = 600;

const USERS = [
  { id: 'u-ana', email: 'ana.rivera@example.test', displayName: 'Ana Rivera', role: 'professional', centerId: 'center-1' },
  { id: 'u-luis', email: 'luis.mora@example.test', displayName: 'Luis Mora', role: 'client', centerId: 'center-1' },
  { id: 'u-marta', email: 'marta.solis@example.test', displayName: 'Marta Solis', role: 'admin', centerId: null },
  { id: 'u-pending', email: 'pending@example.test', displayName: 'Pending Verify', role: 'client', centerId: 'center-1' },
];

class Jar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const maxAge = attributes.find((attribute) => /^max-age=/i.test(attribute));
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  clone() {
    const copy = new Jar();
    copy.cookies = new Map(this.cookies);
    return copy;
  }
}

// Sets up the provider, the API, and the recording of everything the API says.
async function setup({ idp: idpOptions = {}, config: configOverrides = {}, now: startAt } = {}) {
  const idp = await createMockIdp({
    clientId: CLIENT_ID,
    redirectUris: [REDIRECT_URI],
    ...idpOptions,
  }).start();

  let time = (startAt || new Date()).getTime();
  const clock = {
    now: () => new Date(time),
    advance(seconds) {
      time += seconds * 1000;
    },
  };

  const config = {
    ...loadAuthConfig({
      OIDC_ISSUER: idp.issuer,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_REDIRECT_URI: REDIRECT_URI,
      SESSION_ABSOLUTE_TTL_SECONDS: String(ABSOLUTE_TTL),
      SESSION_IDLE_TTL_SECONDS: String(IDLE_TTL),
    }),
    ...configOverrides,
  };

  const store = createMemoryAuthStore({ users: USERS });
  const logs = [];
  const logger = {
    error: (err) => logs.push(`error: ${err && err.message}`),
    warn: (message) => logs.push(message),
  };
  const api = await listen(createApp({ db: fakeDb(), logger, auth: { config, store, now: clock.now } }));

  // Everything the API sent in a body, a Location header, or a log line.
  const transcript = [];

  async function call(path, { jar, method = 'GET', body } = {}) {
    const headers = {};
    if (jar && jar.header()) headers.cookie = jar.header();
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${api.url}${path}`, {
      method,
      headers,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (jar) jar.absorb(res);
    const text = await res.text();
    // The redirect from /auth/login carries state and nonce to the provider by
    // design, in the Location header and in the redirect body.
    if (!path.startsWith('/auth/login')) {
      transcript.push(text, res.headers.get('location') || '');
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not every response has a JSON body.
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  // Runs the browser part up to the callback request and returns it ready to send.
  async function begin(sub, jar = new Jar()) {
    const start = await call('/auth/login', { jar });
    assert.equal(start.status, 302, `login start failed: ${start.text}`);
    const authUrl = new URL(start.headers.get('location'));
    const form = new URLSearchParams(authUrl.searchParams);
    form.set('user', sub);
    const granted = await fetch(`${idp.issuer}/authorize`, { method: 'POST', body: form, redirect: 'manual' });
    assert.equal(granted.status, 302);
    const callbackUrl = new URL(granted.headers.get('location'));
    return { jar, authUrl, callbackUrl, callback: () => call(callbackUrl.pathname + callbackUrl.search, { jar }) };
  }

  async function signIn(sub, jar = new Jar()) {
    const attempt = await begin(sub, jar);
    const res = await attempt.callback();
    return { jar, res };
  }

  return {
    idp,
    api,
    clock,
    config,
    store,
    logs,
    transcript,
    call,
    begin,
    signIn,
    async close() {
      await api.close();
      await idp.close();
    },
  };
}

async function withEnv(options, fn) {
  const env = await setup(options);
  try {
    await fn(env);
  } finally {
    await env.close();
  }
}

test('a successful sign-in opens a session and /auth/me returns the user from the users table', async () => {
  await withEnv({}, async (env) => {
    const { jar, res } = await env.signIn('mock-ana');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');

    const me = await env.call('/auth/me', { jar });
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.user, {
      id: 'u-ana',
      email: 'ana.rivera@example.test',
      displayName: 'Ana Rivera',
      role: 'professional',
      centerId: 'center-1',
    });
    assert.ok(Date.parse(me.json.session.expiresAt) > env.clock.now().getTime());
    assert.equal(me.headers.get('cache-control'), 'no-store');
  });
});

test('the authorization request carries PKCE S256, state, and nonce', async () => {
  await withEnv({}, async (env) => {
    const { authUrl } = await env.begin('mock-ana');
    const p = authUrl.searchParams;
    assert.equal(authUrl.origin, env.idp.issuer);
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('client_id'), CLIENT_ID);
    assert.equal(p.get('redirect_uri'), REDIRECT_URI);
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.match(p.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.match(p.get('state'), /^[A-Za-z0-9_-]{43}$/);
    assert.match(p.get('nonce'), /^[A-Za-z0-9_-]{43}$/);
  });
});

test('cookie headers: session is HttpOnly, Secure, SameSite=Strict, with a lifetime', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    const res = await attempt.callback();
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((line) => line.startsWith('d7_session='));
    assert.ok(session, 'session cookie missing');
    assert.match(session, /; HttpOnly/);
    assert.match(session, /; Secure/);
    assert.match(session, /; SameSite=Strict/);
    assert.match(session, /; Path=\//);
    assert.match(session, new RegExp(`; Max-Age=${ABSOLUTE_TTL}(;|$)`));

    // The login binding cookie is cleared by the callback.
    const cleared = cookies.find((line) => line.startsWith('d7_login='));
    assert.match(cleared, /Max-Age=0/);
  });
});

test('cookie headers: the login binding cookie is HttpOnly, Secure, and SameSite=Lax', async () => {
  await withEnv({}, async (env) => {
    const start = await env.call('/auth/login');
    const login = start.headers.getSetCookie().find((line) => line.startsWith('d7_login='));
    assert.ok(login, 'login cookie missing');
    assert.match(login, /; HttpOnly/);
    assert.match(login, /; Secure/);
    assert.match(login, /; SameSite=Lax/);
    assert.match(login, /; Path=\/auth/);
  });
});

test('state: a changed, missing, or malformed state is rejected', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    const code = attempt.callbackUrl.searchParams.get('code');

    const changed = await env.call(`/auth/callback?code=${code}&state=${'A'.repeat(43)}`, { jar: attempt.jar });
    assert.equal(changed.status, 400);
    assert.equal(changed.json.error.code, 'invalid_login_request');

    const missing = await env.call(`/auth/callback?code=${code}`, { jar: attempt.jar });
    assert.equal(missing.status, 400);

    const malformed = await env.call(`/auth/callback?code=${code}&state=x`, { jar: attempt.jar });
    assert.equal(malformed.status, 400);

    // None of the bad attempts burned the real one, and no session was opened.
    assert.equal(env.store.sessions.size, 0);
    assert.equal(env.store.attempts.size, 1);
  });
});

test('state: a callback cannot be replayed', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    const jarCopy = attempt.jar.clone();

    assert.equal((await attempt.callback()).status, 302);
    const replay = await env.call(attempt.callbackUrl.pathname + attempt.callbackUrl.search, { jar: jarCopy });
    assert.equal(replay.status, 400);
    assert.equal(env.store.sessions.size, 1);
  });
});

test('state: a callback from a browser without the binding cookie is rejected', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    const stranger = await env.call(attempt.callbackUrl.pathname + attempt.callbackUrl.search, { jar: new Jar() });
    assert.equal(stranger.status, 400);
    assert.equal(stranger.json.error.code, 'invalid_login_request');

    // The state is spent, so the real browser cannot finish either.
    assert.equal((await attempt.callback()).status, 400);
    assert.equal(env.store.sessions.size, 0);
  });
});

test('state: an expired login attempt is rejected', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    env.clock.advance(11 * 60);
    const res = await attempt.callback();
    assert.equal(res.status, 400);
    assert.equal(env.store.sessions.size, 0);
  });
});

test('PKCE: a code verifier that does not match the challenge is rejected', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    for (const stored of env.store.attempts.values()) {
      stored.codeVerifier = 'B'.repeat(43);
    }
    const res = await attempt.callback();
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'login_failed');
    assert.equal(env.store.sessions.size, 0);
    assert.ok(env.logs.some((line) => line.includes('token_exchange_failed')));
  });
});

test('nonce: a token with a different nonce is rejected', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    for (const stored of env.store.attempts.values()) {
      stored.nonce = 'C'.repeat(43);
    }
    // The provider signed the original nonce, so the stored one no longer matches.
    const res = await attempt.callback();
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'login_failed');
    assert.equal(env.store.sessions.size, 0);
    assert.ok(env.logs.some((line) => line.includes('nonce_mismatch')));
  });
});

test('nonce: a token without a nonce is rejected', async () => {
  const tamperClaims = ({ nonce, ...rest }) => rest;
  await withEnv({ idp: { tamperClaims } }, async (env) => {
    const { res } = await env.signIn('mock-ana');
    assert.equal(res.status, 401);
    assert.equal(env.store.sessions.size, 0);
  });
});

test('an expired ID token is rejected', async () => {
  await withEnv({ idp: { tokenTtlSeconds: -120 } }, async (env) => {
    const { res } = await env.signIn('mock-ana');
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'login_failed');
    assert.equal(env.store.sessions.size, 0);
    assert.ok(env.logs.some((line) => line.includes('token_expired')));
  });
});

test('an ID token signed with an unknown key is rejected', async () => {
  await withEnv({}, async (env) => {
    env.idp.forgeSignature = true;
    const { res } = await env.signIn('mock-ana');
    assert.equal(res.status, 401);
    assert.equal(env.store.sessions.size, 0);
  });
});

test('an ID token for another audience or issuer is rejected', async () => {
  await withEnv({ idp: { tamperClaims: (claims) => ({ ...claims, aud: 'another-client' }) } }, async (env) => {
    assert.equal((await env.signIn('mock-ana')).res.status, 401);
  });
  await withEnv({ idp: { tamperClaims: (claims) => ({ ...claims, iss: 'http://127.0.0.1:9' }) } }, async (env) => {
    assert.equal((await env.signIn('mock-ana')).res.status, 401);
  });
});

test('an ID token without an expiry is rejected', async () => {
  const tamperClaims = ({ exp, ...rest }) => rest;
  await withEnv({ idp: { tamperClaims } }, async (env) => {
    assert.equal((await env.signIn('mock-ana')).res.status, 401);
  });
});

test('an email the provider did not verify is rejected, even when a users row exists', async () => {
  await withEnv({}, async (env) => {
    const { res } = await env.signIn('mock-pending');
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'login_failed');
    assert.equal(env.store.sessions.size, 0);
    assert.ok(env.logs.some((line) => line.includes('email_not_verified')));
  });
});

test('a missing email_verified claim is treated as not verified', async () => {
  const tamperClaims = ({ email_verified, ...rest }) => rest;
  await withEnv({ idp: { tamperClaims } }, async (env) => {
    assert.equal((await env.signIn('mock-ana')).res.status, 401);
  });
});

test('a verified user without a users row is denied', async () => {
  await withEnv({}, async (env) => {
    const { res } = await env.signIn('mock-norole');
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'access_denied');
    assert.equal(env.store.sessions.size, 0);
    assert.equal(res.headers.getSetCookie().some((line) => line.startsWith('d7_session=')), false);
  });
});

test('an error returned by the provider ends the attempt', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    const state = attempt.callbackUrl.searchParams.get('state');
    const res = await env.call(`/auth/callback?error=access_denied&state=${state}`, { jar: attempt.jar });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'login_failed');
    assert.equal(env.store.attempts.size, 0);
  });
});

test('an unreachable provider gives 502 and no stack trace', async () => {
  await withEnv({ config: { issuer: 'http://127.0.0.1:1' } }, async (env) => {
    const res = await env.call('/auth/login');
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, 'identity_provider_unavailable');
  });
});

test('/auth/me without a cookie or with a made-up token answers 401', async () => {
  await withEnv({}, async (env) => {
    assert.equal((await env.call('/auth/me')).status, 401);
    const jar = new Jar();
    jar.cookies.set('d7_session', 'Z'.repeat(43));
    const res = await env.call('/auth/me', { jar });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'unauthenticated');
  });
});

test('session expiry: inactivity ends a session and activity extends it', async () => {
  await withEnv({}, async (env) => {
    const { jar } = await env.signIn('mock-ana');

    env.clock.advance(IDLE_TTL - 1);
    assert.equal((await env.call('/auth/me', { jar })).status, 200);
    env.clock.advance(IDLE_TTL - 1);
    assert.equal((await env.call('/auth/me', { jar })).status, 200);

    env.clock.advance(IDLE_TTL + 1);
    const idle = await env.call('/auth/me', { jar });
    assert.equal(idle.status, 401);
    assert.equal(idle.json.error.code, 'unauthenticated');
  });
});

test('session expiry: the absolute limit ends a session that stays active', async () => {
  await withEnv({}, async (env) => {
    const { jar } = await env.signIn('mock-ana');
    let status = 200;
    let elapsed = 0;
    while (elapsed + 500 <= ABSOLUTE_TTL) {
      env.clock.advance(500);
      elapsed += 500;
      status = (await env.call('/auth/me', { jar })).status;
      assert.equal(status, 200, `session ended early at ${elapsed}s`);
    }
    env.clock.advance(500);
    assert.equal((await env.call('/auth/me', { jar })).status, 401);
  });
});

test('individual revocation: logout ends only the current session and clears the cookie', async () => {
  await withEnv({}, async (env) => {
    const { jar: laptop } = await env.signIn('mock-ana');
    const { jar: phone } = await env.signIn('mock-ana');
    const other = (await env.signIn('mock-luis')).jar;
    const laptopBefore = laptop.clone();

    const out = await env.call('/auth/logout', { jar: laptop, method: 'POST' });
    assert.equal(out.status, 204);
    const cleared = out.headers.getSetCookie().find((line) => line.startsWith('d7_session='));
    assert.match(cleared, /Max-Age=0/);
    assert.match(cleared, /; HttpOnly/);
    assert.match(cleared, /; Secure/);
    assert.match(cleared, /; SameSite=Strict/);

    assert.equal((await env.call('/auth/me', { jar: laptopBefore })).status, 401);
    assert.equal((await env.call('/auth/me', { jar: phone })).status, 200);
    assert.equal((await env.call('/auth/me', { jar: other })).status, 200);
  });
});

test('a revoked token stays dead even if the cookie is sent again', async () => {
  await withEnv({}, async (env) => {
    const { jar } = await env.signIn('mock-ana');
    const saved = jar.header();
    await env.call('/auth/logout', { jar, method: 'POST' });

    const replay = new Jar();
    replay.cookies.set('d7_session', saved.split('=')[1]);
    assert.equal((await env.call('/auth/me', { jar: replay })).status, 401);
  });
});

test('global revocation: logout with all=true ends every session of the user only', async () => {
  await withEnv({}, async (env) => {
    const { jar: laptop } = await env.signIn('mock-ana');
    const { jar: phone } = await env.signIn('mock-ana');
    const other = (await env.signIn('mock-luis')).jar;
    const laptopBefore = laptop.clone();
    const phoneBefore = phone.clone();

    const out = await env.call('/auth/logout', { jar: laptop, method: 'POST', body: { all: true } });
    assert.equal(out.status, 204);

    assert.equal((await env.call('/auth/me', { jar: laptopBefore })).status, 401);
    assert.equal((await env.call('/auth/me', { jar: phoneBefore })).status, 401);
    assert.equal((await env.call('/auth/me', { jar: other })).status, 200);
  });
});

test('logout without a session still answers 204', async () => {
  await withEnv({}, async (env) => {
    const res = await env.call('/auth/logout', { method: 'POST' });
    assert.equal(res.status, 204);
  });
});

test('logout with all=true and an expired session revokes only that session', async () => {
  // The token lifetime must outlast the clock jump below.
  await withEnv({ idp: { tokenTtlSeconds: 7200 } }, async (env) => {
    const { jar: first } = await env.signIn('mock-ana');
    env.clock.advance(IDLE_TTL + 1);
    const { jar: second } = await env.signIn('mock-ana');
    // The first session is idle-expired, so it cannot authorize a global revocation.
    await env.call('/auth/logout', { jar: first, method: 'POST', body: { all: true } });
    assert.equal((await env.call('/auth/me', { jar: second })).status, 200);
  });
});

test('role and center are read from the users table on every request', async () => {
  await withEnv({}, async (env) => {
    const { jar } = await env.signIn('mock-ana');
    env.store.usersByEmail.get('ana.rivera@example.test').role = 'auditor';
    env.store.usersByEmail.get('ana.rivera@example.test').centerId = 'center-2';
    const me = await env.call('/auth/me', { jar });
    assert.equal(me.json.user.role, 'auditor');
    assert.equal(me.json.user.centerId, 'center-2');

    env.store.usersByEmail.delete('ana.rivera@example.test');
    assert.equal((await env.call('/auth/me', { jar })).status, 401);
  });
});

test('a new sign-in issues a new session token', async () => {
  await withEnv({}, async (env) => {
    const first = (await env.signIn('mock-ana')).jar.cookies.get('d7_session');
    const second = (await env.signIn('mock-ana')).jar.cookies.get('d7_session');
    assert.notEqual(first, second);
    assert.equal(env.store.sessions.size, 2);
  });
});

test('the store keeps only a digest of the session token', async () => {
  await withEnv({}, async (env) => {
    const { jar } = await env.signIn('mock-ana');
    const token = jar.cookies.get('d7_session');
    for (const key of env.store.sessions.keys()) {
      assert.notEqual(key, token);
      assert.match(key, /^[0-9a-f]{64}$/);
    }
  });
});

test('no secret, token, or code appears in responses or logs', async () => {
  await withEnv({}, async (env) => {
    const attempt = await env.begin('mock-ana');
    const state = attempt.callbackUrl.searchParams.get('state');
    const code = attempt.callbackUrl.searchParams.get('code');
    const nonce = attempt.authUrl.searchParams.get('nonce');
    const binding = attempt.jar.cookies.get('d7_login');
    const verifier = [...env.store.attempts.values()][0].codeVerifier;

    const ok = await attempt.callback();
    const sessionToken = attempt.jar.cookies.get('d7_session');
    await env.call('/auth/me', { jar: attempt.jar });

    // Failure paths: bad state, and a user with no row.
    await env.call(`/auth/callback?code=${code}&state=${state}`, { jar: attempt.jar });
    await env.signIn('mock-norole');
    await env.signIn('mock-pending');
    await env.call('/auth/logout', { jar: attempt.jar, method: 'POST' });

    const everything = [...env.transcript, ...env.logs].join('\n');
    assert.equal(ok.status, 302);
    for (const [label, secret] of Object.entries({ state, code, nonce, binding, verifier, sessionToken })) {
      assert.ok(secret && secret.length >= 20, `${label} was not captured`);
      assert.ok(!everything.includes(secret), `${label} leaked into a response or a log`);
    }
    assert.ok(!everything.includes('eyJ'), 'a JWT leaked');
    assert.ok(!env.logs.join('\n').includes('example.test'), 'an email leaked into a log');
  });
});

test('/auth routes do not exist when sign-in is not configured', async () => {
  const api = await listen(createApp({ db: fakeDb(), logger: { error() {} }, auth: { config: { enabled: false } } }));
  try {
    assert.equal((await fetch(`${api.url}/auth/login`, { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(`${api.url}/auth/me`)).status, 404);
  } finally {
    await api.close();
  }
});
