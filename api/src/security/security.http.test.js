'use strict';

// HTTP tests of the security layer: origin check, headers, rate limits, errors.
// The API runs with in-memory stores. Sessions are created through the session
// service, so no identity provider is needed. Requests use node:http because
// fetch does not let a test set Origin or Sec-Fetch-Site freely.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../app');
const { createMemoryAuthStore } = require('../auth/memoryStore');
const { createMemoryCareStore } = require('../care/memoryStore');
const { createMemoryAuditStore } = require('../audit/memoryStore');
const { loadSecurityConfig } = require('./config');
const { fakeDb, listen } = require('../../test/helpers');

const quietLogger = { error() {}, warn() {} };
const SITE = 'https://clinic.example.test';
const JITSI = 'https://jitsi.example.test';
const AUTH_CONFIG = {
  enabled: true,
  sessionCookieName: 'd7_session',
  absoluteTtlSeconds: 3600,
  idleTtlSeconds: 600,
  postLoginPath: '/',
  redirectUri: `${SITE}/auth/callback`,
};

const person = (id, role, centerId) => ({ id, email: `${id}@example.test`, displayName: id, role, centerId });
const USERS = [
  person('u-pro1', 'professional', 'c1'),
  person('u-pro1b', 'professional', 'c1'),
  person('u-cli1', 'client', 'c1'),
];

function securityOptions(env = {}, overrides = {}) {
  return { ...loadSecurityConfig({ ALLOWED_ORIGINS: SITE, JITSI_BASE_URL: JITSI, ...env }), ...overrides };
}

async function setup({ security = securityOptions(), careStore, oidc = {} } = {}) {
  const store = careStore || createMemoryCareStore({ users: USERS, appointments: [] });
  const app = createApp({
    db: fakeDb(),
    logger: quietLogger,
    rateLimit: { limit: 1e9 },
    security,
    auth: { config: AUTH_CONFIG, store: createMemoryAuthStore({ users: USERS }), oidc },
    careStore: store,
    auditStore: createMemoryAuditStore(),
  });
  const tokens = {};
  for (const user of USERS) {
    tokens[user.id] = (await app.locals.auth.sessions.create(user)).token;
  }
  const server = await listen(app);
  return { server, tokens, store };
}

// Sends one request and resolves { status, headers, text, json }.
function send(server, { method = 'GET', path, headers = {}, body, as, tokens }) {
  return new Promise((resolve, reject) => {
    const sent = { ...headers };
    if (as) sent.Cookie = `d7_session=${tokens[as]}`;
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      sent['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(`${server.url}${path}`, { method, headers: sent }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const JSON_TYPE = { 'Content-Type': 'application/json' };
const APPOINTMENT = {
  professionalId: 'u-pro1',
  clientId: 'u-cli1',
  startsAt: '2026-12-01T15:00:00.000Z',
  endsAt: '2026-12-01T15:50:00.000Z',
};

function post(ctx, headers, body = APPOINTMENT, path = '/appointments') {
  return send(ctx.server, {
    method: 'POST',
    path,
    headers: { ...JSON_TYPE, ...headers },
    body,
    as: 'u-pro1',
    tokens: ctx.tokens,
  });
}

// ---- CSRF ----

test('a POST with a foreign Origin gets 403 and changes nothing', async () => {
  const ctx = await setup();
  try {
    for (const origin of [
      'https://evil.example.test',
      'null',
      'http://clinic.example.test',
      'https://clinic.example.test:8443',
      'https://clinic.example.test.evil.test',
      'https://CLINIC.example.test.',
    ]) {
      const res = await post(ctx, { Origin: origin });
      assert.equal(res.status, 403, origin);
      assert.equal(res.json.error.code, 'csrf_rejected', origin);
      assert.ok(!res.text.includes('evil'), 'the origin is not echoed');
    }
    const list = await send(ctx.server, { path: '/appointments', as: 'u-pro1', tokens: ctx.tokens });
    assert.deepEqual(list.json.items, []);
  } finally {
    await ctx.server.close();
  }
});

test('every state-changing method is checked, and safe methods are not', async () => {
  const ctx = await setup();
  try {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await send(ctx.server, {
        method,
        path: '/appointments',
        headers: { ...JSON_TYPE, Origin: 'https://evil.example.test' },
        body: {},
        as: 'u-pro1',
        tokens: ctx.tokens,
      });
      assert.equal(res.status, 403, method);
      assert.equal(res.json.error.code, 'csrf_rejected', method);
    }
    const read = await send(ctx.server, {
      path: '/appointments',
      headers: { Origin: 'https://evil.example.test' },
      as: 'u-pro1',
      tokens: ctx.tokens,
    });
    assert.equal(read.status, 200);
  } finally {
    await ctx.server.close();
  }
});

test('without Origin, Sec-Fetch-Site cross-site or same-site gets 403', async () => {
  const ctx = await setup();
  try {
    for (const site of ['cross-site', 'same-site', 'Cross-Site']) {
      const res = await post(ctx, { 'Sec-Fetch-Site': site });
      assert.equal(res.status, 403, site);
      assert.equal(res.json.error.code, 'csrf_rejected', site);
    }
  } finally {
    await ctx.server.close();
  }
});

test('an allowed Origin passes, and so do same-origin, none, and a client without either header', async () => {
  const ctx = await setup();
  try {
    assert.equal((await post(ctx, { Origin: SITE })).status, 201);
    assert.equal((await post(ctx, { 'Sec-Fetch-Site': 'same-origin' })).status, 201);
    assert.equal((await post(ctx, { 'Sec-Fetch-Site': 'none' })).status, 201);
    assert.equal((await post(ctx, {})).status, 201);
    // An allowed Origin wins over a cross-site hint, because the list is the rule.
    assert.equal((await post(ctx, { Origin: SITE, 'Sec-Fetch-Site': 'cross-site' })).status, 201);
  } finally {
    await ctx.server.close();
  }
});

test('the origin check runs before the session check, and it applies to /auth/logout', async () => {
  const ctx = await setup();
  try {
    const res = await send(ctx.server, {
      method: 'POST',
      path: '/auth/logout',
      headers: { ...JSON_TYPE, Origin: 'https://evil.example.test' },
      body: {},
      as: 'u-pro1',
      tokens: ctx.tokens,
    });
    assert.equal(res.status, 403);
    const stillValid = await send(ctx.server, { path: '/auth/me', as: 'u-pro1', tokens: ctx.tokens });
    assert.equal(stillValid.status, 200);
  } finally {
    await ctx.server.close();
  }
});

test('with no list and no sign-in redirect, every Origin is refused', async () => {
  const ctx = await setup({ security: securityOptions({ ALLOWED_ORIGINS: '' }, { allowedOrigins: [] }) });
  try {
    assert.equal((await post(ctx, { Origin: SITE })).status, 403);
    assert.equal((await post(ctx, {})).status, 201);
  } finally {
    await ctx.server.close();
  }
});

// ---- Headers ----

function directives(policy) {
  return Object.fromEntries(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name, values])
  );
}

test('the content policy has no unsafe-inline and no unsafe-eval, and the other headers are present', async () => {
  const ctx = await setup();
  try {
    // A normal answer, an error, and a probe all carry the same headers.
    for (const path of ['/healthz', '/no-such-route', '/appointments']) {
      const res = await send(ctx.server, { path });
      const policy = res.headers['content-security-policy'];
      assert.ok(policy, `${path}: policy present`);
      assert.ok(!policy.includes('unsafe-inline'), `${path}: ${policy}`);
      assert.ok(!policy.includes('unsafe-eval'), `${path}: ${policy}`);
      assert.match(res.headers['strict-transport-security'], /max-age=\d+/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.ok(res.headers['referrer-policy']);
      assert.ok(res.headers['permissions-policy']);
      assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(res.headers['x-powered-by'], undefined);
    }
  } finally {
    await ctx.server.close();
  }
});

test('the content policy defaults to self, frames only Jitsi, and connects to self and its own wss', async () => {
  const ctx = await setup();
  try {
    const res = await send(ctx.server, { path: '/healthz' });
    const policy = directives(res.headers['content-security-policy']);
    assert.deepEqual(policy['default-src'], ["'self'"]);
    assert.deepEqual(policy['frame-src'], [JITSI]);
    assert.deepEqual(policy['connect-src'], ["'self'", 'wss://clinic.example.test']);
    assert.deepEqual(policy['script-src'], ["'self'"]);
    assert.deepEqual(policy['style-src'], ["'self'"]);
    assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
    assert.deepEqual(policy['object-src'], ["'none'"]);
    assert.equal(res.headers['permissions-policy'], `camera=(self "${JITSI}"), microphone=(self "${JITSI}"), geolocation=()`);
  } finally {
    await ctx.server.close();
  }
});

test('without a Jitsi origin, frames are refused and camera and microphone are for self only', async () => {
  const ctx = await setup({ security: securityOptions({ JITSI_BASE_URL: '' }, { jitsiOrigin: null }) });
  try {
    const res = await send(ctx.server, { path: '/healthz' });
    const policy = directives(res.headers['content-security-policy']);
    assert.deepEqual(policy['frame-src'], ["'none'"]);
    assert.equal(res.headers['permissions-policy'], 'camera=(self), microphone=(self), geolocation=()');
  } finally {
    await ctx.server.close();
  }
});

// ---- Rate limits ----

function loginApp(limit) {
  return setup({
    security: securityOptions({}, { loginLimit: { windowMs: 60000, limit } }),
    oidc: { authorizationUrl: async () => 'https://idp.example.test/authorize' },
  });
}

test('the sign-in routes answer 429 after the limit, and the limit is shared by /auth/login and /auth/callback', async () => {
  const ctx = await loginApp(3);
  try {
    assert.equal((await send(ctx.server, { path: '/auth/login' })).status, 302);
    assert.equal((await send(ctx.server, { path: '/auth/login' })).status, 302);
    assert.equal((await send(ctx.server, { path: '/auth/callback' })).status, 400);
    const blocked = await send(ctx.server, { path: '/auth/login' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'rate_limited');
    assert.equal((await send(ctx.server, { path: '/auth/callback?state=x' })).status, 429);
  } finally {
    await ctx.server.close();
  }
});

test('the sign-in limit does not apply to other routes', async () => {
  const ctx = await loginApp(1);
  try {
    assert.equal((await send(ctx.server, { path: '/auth/login' })).status, 302);
    assert.equal((await send(ctx.server, { path: '/auth/login' })).status, 429);
    assert.equal((await send(ctx.server, { path: '/auth/me', as: 'u-pro1', tokens: ctx.tokens })).status, 200);
    assert.equal((await send(ctx.server, { path: '/appointments', as: 'u-pro1', tokens: ctx.tokens })).status, 200);
  } finally {
    await ctx.server.close();
  }
});

test('the write limit is per user: one user reaching it does not affect another', async () => {
  const ctx = await setup({ security: securityOptions({}, { writeLimit: { windowMs: 60000, limit: 2 } }) });
  try {
    const write = (user, body = {}) =>
      send(ctx.server, { method: 'POST', path: '/appointments', headers: JSON_TYPE, body, as: user, tokens: ctx.tokens });
    assert.notEqual((await write('u-pro1')).status, 429);
    assert.notEqual((await write('u-pro1')).status, 429);
    const blocked = await write('u-pro1');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'rate_limited');
    // Another user still writes, and the first user still reads.
    assert.notEqual((await write('u-pro1b')).status, 429);
    assert.notEqual((await write('u-pro1b')).status, 429);
    assert.equal((await write('u-pro1b')).status, 429);
    assert.equal((await send(ctx.server, { path: '/appointments', as: 'u-pro1', tokens: ctx.tokens })).status, 200);
  } finally {
    await ctx.server.close();
  }
});

// ---- Errors ----

test('a driver error answers a fixed 500 without the table name or the driver text', async () => {
  const careStore = createMemoryCareStore({ users: USERS, appointments: [] });
  careStore.listAppointments = async () => {
    throw Object.assign(new Error("Table 'doctor7.appointments' doesn't exist (SELECT * FROM appointments)"), {
      code: 'ER_NO_SUCH_TABLE',
      sql: 'SELECT * FROM appointments',
    });
  };
  const ctx = await setup({ careStore });
  try {
    const res = await send(ctx.server, { path: '/appointments', as: 'u-pro1', tokens: ctx.tokens });
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: { code: 'internal_error', message: 'Internal server error.' } });
    for (const leak of ['appointments', 'doctor7', 'ER_NO_SUCH_TABLE', 'SELECT', 'Table']) {
      assert.ok(!res.text.includes(leak), leak);
    }
  } finally {
    await ctx.server.close();
  }
});

test('a body the parser cannot read answers a fixed error without parser text', async () => {
  const ctx = await setup();
  try {
    const res = await send(ctx.server, {
      method: 'POST',
      path: '/appointments',
      headers: { 'Content-Type': 'application/json; charset=iso-8859-1' },
      body: '{}',
      as: 'u-pro1',
      tokens: ctx.tokens,
    });
    assert.equal(res.status, 415);
    assert.deepEqual(res.json, {
      error: { code: 'unsupported_media_type', message: 'The request encoding is not supported.' },
    });
    assert.ok(!/8859/i.test(res.text));

    const broken = await send(ctx.server, {
      method: 'POST',
      path: '/appointments',
      headers: JSON_TYPE,
      body: '{"professionalId": "ZQX-secret-marker"',
      as: 'u-pro1',
      tokens: ctx.tokens,
    });
    assert.equal(broken.status, 400);
    assert.ok(!broken.text.includes('ZQX-secret-marker'));
  } finally {
    await ctx.server.close();
  }
});

test('a rejected body never appears in the answer, not even as a key name', async () => {
  const ctx = await setup();
  try {
    const marker = 'ZQX-marker-4471';
    const cases = [
      { ...APPOINTMENT, [marker]: 'value' },
      { ...APPOINTMENT, professionalId: marker.repeat(10) },
      { ...APPOINTMENT, startsAt: marker },
      { ...APPOINTMENT, clientId: { [marker]: marker } },
      [marker],
      marker,
    ];
    for (const body of cases) {
      const res = await post(ctx, {}, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      // A bare JSON string is refused by the parser, everything else by the schema.
      assert.ok(['invalid_request', 'invalid_json'].includes(res.json.error.code), res.text);
      assert.ok(!res.text.includes(marker), res.text);
    }
    const query = await send(ctx.server, {
      path: `/appointments?${marker}=1&limit=${marker}`,
      as: 'u-pro1',
      tokens: ctx.tokens,
    });
    assert.equal(query.status, 400);
    assert.ok(!query.text.includes(marker), query.text);
  } finally {
    await ctx.server.close();
  }
});
