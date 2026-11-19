'use strict';

// Tests of the input validators. The property tests check that a body or a query
// string that does not match its schema is refused with 400, and that the message
// never repeats what was sent.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fc = require('fast-check');
const v = require('./validate');
const schemas = require('./schemas');
const { ApiError } = require('../http/errors');
const { createApp } = require('../app');
const { createMemoryAuthStore } = require('../auth/memoryStore');
const { createMemoryCareStore } = require('../care/memoryStore');
const { createMemoryAuditStore } = require('../audit/memoryStore');
const { loadSecurityConfig } = require('./config');
const { fakeDb, listen } = require('../../test/helpers');

// Every generated text starts with this prefix, so a message that repeats any
// part of the input is found by a substring check.
const MARKER = 'ZQX';
const marked = (min = 4, max = 40) =>
  fc.string({ minLength: min, maxLength: max }).map((text) => `${MARKER}${text}`);

const VALID_APPOINTMENT = {
  professionalId: 'u-pro1',
  clientId: 'u-cli1',
  startsAt: '2026-12-01T15:00:00.000Z',
  endsAt: '2026-12-01T15:50:00.000Z',
};

// Runs a check and returns the thrown ApiError, or null when the value passes.
function refusal(schema, value, label = 'body') {
  try {
    v.parse(schema, value, label);
    return null;
  } catch (err) {
    assert.ok(err instanceof ApiError, 'only ApiError may be thrown');
    return err;
  }
}

function assertRefusedWithoutEcho(err) {
  assert.ok(err, 'the input must be refused');
  assert.equal(err.status, 400);
  assert.equal(err.code, 'invalid_request');
  assert.ok(!err.message.includes(MARKER), `message repeats the input: ${err.message}`);
}

test('the valid examples pass and are returned as parsed values', () => {
  const body = v.parse(schemas.appointmentCreateBody, VALID_APPOINTMENT, 'body');
  assert.equal(body.professionalId, 'u-pro1');
  assert.ok(body.startsAt instanceof Date);
  assert.deepEqual(v.parse(schemas.pageQuery, { limit: '5', offset: '10' }, 'query'), { limit: 5, offset: 10 });
  assert.deepEqual(v.parse(schemas.emptyBody, undefined, 'body'), {});
  assert.deepEqual(v.parse(schemas.logoutBody, { all: true }, 'body'), { all: true });
});

test('the parsed object has only the known keys, and __proto__ is refused', () => {
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "professionalId": "a"}');
  assert.ok(refusal(schemas.appointmentCreateBody, hostile));
  assert.equal({}.polluted, undefined);
});

test('property: a body with a key that is not allowed is refused, and the message does not name it', () => {
  fc.assert(
    fc.property(marked(), fc.anything(), (key, value) => {
      fc.pre(!Object.hasOwn(VALID_APPOINTMENT, key));
      const input = { ...VALID_APPOINTMENT };
      Object.defineProperty(input, key, { value, enumerable: true, writable: true, configurable: true });
      const err = refusal(schemas.appointmentCreateBody, input);
      assertRefusedWithoutEcho(err, { key });
    }),
    { numRuns: 200 }
  );
});

test('property: a field of the wrong type is refused, and the message does not repeat the value', () => {
  const wrong = fc.oneof(
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.constant(null),
    fc.array(marked()),
    fc.dictionary(marked(), marked()),
    marked().map((text) => ({ text }))
  );
  fc.assert(
    fc.property(fc.constantFrom(...Object.keys(VALID_APPOINTMENT)), wrong, (field, value) => {
      const err = refusal(schemas.appointmentCreateBody, { ...VALID_APPOINTMENT, [field]: value });
      assertRefusedWithoutEcho(err, value);
      assert.ok(err.message.startsWith(field), 'the message names the field of the schema');
    }),
    { numRuns: 300 }
  );
});

test('property: a text that is too long or has the wrong format is refused, and the message does not repeat it', () => {
  const tooLong = fc.integer({ min: 65, max: 3000 }).chain((length) =>
    fc.string({ minLength: length, maxLength: length }).map((text) => `${MARKER}${text}`)
  );
  fc.assert(
    fc.property(fc.constantFrom('professionalId', 'clientId'), tooLong, (field, text) => {
      assertRefusedWithoutEcho(refusal(schemas.appointmentCreateBody, { ...VALID_APPOINTMENT, [field]: text }), text);
    }),
    { numRuns: 100 }
  );
  fc.assert(
    fc.property(fc.constantFrom('startsAt', 'endsAt'), marked(0, 200), (field, text) => {
      assertRefusedWithoutEcho(refusal(schemas.appointmentCreateBody, { ...VALID_APPOINTMENT, [field]: text }), text);
    }),
    { numRuns: 100 }
  );
});

test('property: no input throws anything but ApiError, and a passing result holds only known keys', () => {
  const known = new Set(Object.keys(VALID_APPOINTMENT));
  fc.assert(
    fc.property(fc.anything({ withNullPrototype: true, withBigInt: false }), (input) => {
      let result = null;
      try {
        result = v.parse(schemas.appointmentCreateBody, input, 'body');
      } catch (err) {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 400);
        return;
      }
      for (const key of Object.keys(result)) assert.ok(known.has(key));
    }),
    { numRuns: 500 }
  );
});

test('property: a query string with a key that is not allowed, or a bad page value, is refused', () => {
  fc.assert(
    fc.property(marked(), marked(), (key, value) => {
      fc.pre(!['limit', 'offset'].includes(key));
      const err = refusal(schemas.pageQuery, { [key]: value }, 'query');
      assertRefusedWithoutEcho(err, { key, value });
    }),
    { numRuns: 150 }
  );
  fc.assert(
    fc.property(fc.constantFrom('limit', 'offset'), marked(), (name, value) => {
      assertRefusedWithoutEcho(refusal(schemas.pageQuery, { [name]: value }, 'query'), value);
      assertRefusedWithoutEcho(refusal(schemas.pageQuery, { [name]: [value, value] }, 'query'), value);
    }),
    { numRuns: 100 }
  );
  for (const bad of [{ limit: '0' }, { limit: '201' }, { limit: '-1' }, { limit: '1.5' }, { offset: '1000000000' }]) {
    assert.ok(refusal(schemas.pageQuery, bad, 'query'), JSON.stringify(bad));
  }
});

test('the audit query refuses unknown outcomes, bad actions, bad times, and inverted keys', () => {
  const ok = { from: '2026-11-01T00:00:00.000Z', outcome: 'denied', action: 'auth.login', actorId: 'u1' };
  assert.ok(!refusal(schemas.auditQuery, ok, 'query'));
  for (const bad of [{ outcome: 'maybe' }, { action: 'Auth Login' }, { from: 'yesterday' }, { actorId: '' }, { x: '1' }]) {
    assert.ok(refusal(schemas.auditQuery, bad, 'query'), JSON.stringify(bad));
  }
});

test('the callback query allows the keys of the identity provider and refuses the rest', () => {
  const state = 'a'.repeat(30);
  assert.ok(v.check(schemas.callbackQuery, { state, code: 'c', iss: 'https://idp.example.test' }, 'query').ok);
  assert.ok(v.check(schemas.callbackQuery, { state, error: 'access_denied', error_description: 'no' }, 'query').ok);
  assert.ok(!v.check(schemas.callbackQuery, { state, extra: '1' }, 'query').ok);
  assert.ok(!v.check(schemas.callbackQuery, { state: 'short' }, 'query').ok);
  assert.ok(!v.check(schemas.callbackQuery, { state, code: ['a', 'b'] }, 'query').ok);
});

test('the clinical body is limited in depth and in size, and must be an object', () => {
  const schema = v.jsonObject({ maxDepth: 3, maxNodes: 10 });
  assert.ok(schema.check({ a: { b: 1 } }).ok);
  assert.ok(!schema.check({ a: { b: { c: { d: 1 } } } }).ok);
  assert.ok(!schema.check(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i]))).ok);
  for (const value of [null, [], 'text', 4]) assert.ok(!schema.check(value).ok);
});

// ---- The same checks through HTTP ----

const USERS = [
  { id: 'u-pro1', email: 'u-pro1@example.test', displayName: 'u-pro1', role: 'professional', centerId: 'c1' },
  { id: 'u-cli1', email: 'u-cli1@example.test', displayName: 'u-cli1', role: 'client', centerId: 'c1' },
];

async function start() {
  const app = createApp({
    db: fakeDb(),
    logger: { error() {}, warn() {} },
    rateLimit: { limit: 1e9 },
    security: loadSecurityConfig({ RATE_LIMIT_WRITE_MAX: '1000000' }),
    auth: {
      config: { enabled: true, sessionCookieName: 'd7_session', absoluteTtlSeconds: 3600, idleTtlSeconds: 600, postLoginPath: '/' },
      store: createMemoryAuthStore({ users: USERS }),
      oidc: {},
    },
    careStore: createMemoryCareStore({ users: USERS, appointments: [] }),
    auditStore: createMemoryAuditStore(),
  });
  const token = (await app.locals.auth.sessions.create(USERS[0])).token;
  const server = await listen(app);
  const call = (method, path, body) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers = { Cookie: `d7_session=${token}` };
      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = http.request(`${server.url}${path}`, { method, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  return { server, call };
}

test('property: through HTTP, a bad body on each POST route gets 400 and is not repeated', async () => {
  const { server, call } = await start();
  try {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('/appointments', '/consultations'),
        fc.dictionary(marked(), marked(), { minKeys: 1, maxKeys: 5 }),
        async (path, body) => {
          const res = await call('POST', path, body);
          assert.equal(res.status, 400);
          assert.ok(!res.text.includes(MARKER), res.text);
        }
      ),
      { numRuns: 40 }
    );
    await fc.assert(
      fc.asyncProperty(marked(65, 300), async (text) => {
        const res = await call('POST', '/consultations', { appointmentId: text, body: {} });
        assert.equal(res.status, 400);
        assert.ok(!res.text.includes(MARKER), res.text);
        const meeting = await call('POST', '/appointments/a1/meeting', { [text]: text });
        assert.equal(meeting.status, 400);
        assert.ok(!meeting.text.includes(MARKER), meeting.text);
      }),
      { numRuns: 30 }
    );
  } finally {
    await server.close();
  }
});

test('property: through HTTP, a bad query string on each GET route gets 400 and is not repeated', async () => {
  const { server, call } = await start();
  try {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('/appointments', '/appointments/a1', '/consultations/k1', '/auth/me'),
        marked(),
        marked(),
        async (path, key, value) => {
          const res = await call('GET', `${path}?${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
          assert.equal(res.status, 400);
          assert.ok(!res.text.includes(MARKER), res.text);
        }
      ),
      { numRuns: 40 }
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('limit', 'offset'), marked(), async (name, value) => {
        const res = await call('GET', `/appointments?${name}=${encodeURIComponent(value)}`);
        assert.equal(res.status, 400);
        assert.ok(!res.text.includes(MARKER), res.text);
      }),
      { numRuns: 30 }
    );
  } finally {
    await server.close();
  }
});
