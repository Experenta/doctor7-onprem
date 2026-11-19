'use strict';

// HTTP tests of the deny-by-default gate and the appointment and consultation
// routes. The API runs with in-memory stores. Sessions are created directly
// through the session service, so no identity provider is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fc = require('fast-check');
const { createApp } = require('../app');
const { createAuth } = require('../auth');
const { createMemoryAuthStore } = require('../auth/memoryStore');
const { createMemoryCareStore } = require('./memoryStore');
const { createAuthzGate } = require('../authz/gate');
const { createErrorHandler, notFound } = require('../http/errors');
const { fakeDb, listen } = require('../../test/helpers');

const quietLogger = { error() {}, warn() {} };
const AUTH_CONFIG = {
  enabled: true,
  sessionCookieName: 'd7_session',
  absoluteTtlSeconds: 3600,
  idleTtlSeconds: 600,
  postLoginPath: '/',
};

const person = (id, role, centerId) => ({
  id,
  email: `${id}@example.test`,
  displayName: id,
  role,
  centerId,
});

const USERS = [
  person('u-pro1', 'professional', 'c1'),
  person('u-pro1b', 'professional', 'c1'),
  person('u-cli1', 'client', 'c1'),
  person('u-cli1b', 'client', 'c1'),
  person('u-adm1', 'admin', 'c1'),
  person('u-aud1', 'auditor', 'c1'),
  person('u-pro2', 'professional', 'c2'),
  person('u-cli2', 'client', 'c2'),
  person('u-adm2', 'admin', 'c2'),
  person('u-aud2', 'auditor', 'c2'),
  person('u-adm0', 'admin', null),
];
const CENTER_OF = new Map(USERS.map((user) => [user.id, user.centerId]));
const ROLE_OF = new Map(USERS.map((user) => [user.id, user.role]));

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

const consultation = (id, appointmentId) => ({
  id,
  appointmentId,
  body: { note: `synthetic note ${id}` },
  createdAt: new Date('2026-12-01T16:00:00.000Z'),
});

const APPOINTMENTS = [
  appointment('a1', 'c1', 'u-pro1', 'u-cli1'),
  appointment('a2', 'c1', 'u-pro1b', 'u-cli1b'),
  appointment('a3', 'c2', 'u-pro2', 'u-cli2'),
];
const CONSULTATIONS = [consultation('k1', 'a1'), consultation('k2', 'a2'), consultation('k3', 'a3')];
const APPOINTMENT_CENTER = new Map(APPOINTMENTS.map((item) => [item.id, item.centerId]));
const CONSULTATION_CENTER = new Map(CONSULTATIONS.map((item) => [item.id, APPOINTMENT_CENTER.get(item.appointmentId)]));

async function setup() {
  const careStore = createMemoryCareStore({
    users: USERS,
    appointments: APPOINTMENTS,
    consultations: CONSULTATIONS,
  });
  const app = createApp({
    db: fakeDb(),
    logger: quietLogger,
    rateLimit: { limit: 1e9 },
    auth: { config: AUTH_CONFIG, store: createMemoryAuthStore({ users: USERS }), oidc: {} },
    careStore,
  });
  const tokens = {};
  for (const user of USERS) {
    tokens[user.id] = (await app.locals.auth.sessions.create(user)).token;
  }
  const server = await listen(app);

  // Sends a request as `as` (a user id, or null for no session).
  async function call(method, path, { as = null, body, contentType = 'application/json', raw } = {}) {
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
    return { status: res.status, json, text };
  }

  return { app, careStore, server, call, tokens };
}

const NEW_APPOINTMENT = (professionalId, clientId) => ({
  professionalId,
  clientId,
  startsAt: '2026-12-02T10:00:00.000Z',
  endsAt: '2026-12-02T10:50:00.000Z',
});

test('GET /appointments returns only the rows each role may read', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  const ids = async (as) => (await call('GET', '/appointments', { as })).json.items.map((item) => item.id);

  assert.deepEqual(await ids('u-pro1'), ['a1']);
  assert.deepEqual(await ids('u-pro1b'), ['a2']);
  assert.deepEqual(await ids('u-cli1'), ['a1']);
  assert.deepEqual((await ids('u-adm1')).sort(), ['a1', 'a2']);
  assert.deepEqual(await ids('u-adm2'), ['a3']);
  assert.deepEqual(await ids('u-pro2'), ['a3']);
  for (const as of ['u-aud1', 'u-aud2', 'u-adm0']) {
    const res = await call('GET', '/appointments', { as });
    assert.equal(res.status, 403, as);
    assert.equal(res.json.error.code, 'forbidden');
  }
  assert.equal((await call('GET', '/appointments')).status, 401);
});

test('GET /appointments validates paging', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  assert.equal((await call('GET', '/appointments?limit=1', { as: 'u-adm1' })).json.items.length, 1);
  assert.equal((await call('GET', '/appointments?limit=1&offset=1', { as: 'u-adm1' })).json.items.length, 1);
  for (const query of ['limit=0', 'limit=201', 'limit=x', 'offset=-1', 'limit=1&limit=2']) {
    const res = await call('GET', `/appointments?${query}`, { as: 'u-adm1' });
    assert.equal(res.status, 400, query);
    assert.equal(res.json.error.code, 'invalid_request');
  }
});

test('GET /appointments/:id allows participants and the center admin only', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  const expectations = [
    // [user, appointment, status]. A 404 covers another center, a missing record,
    // and a record the caller does not take part in. An auditor gets 403 from the gate.
    ['u-pro1', 'a1', 200],
    ['u-cli1', 'a1', 200],
    ['u-adm1', 'a1', 200],
    ['u-adm1', 'a2', 200],
    ['u-pro1', 'a2', 404],
    ['u-pro1b', 'a1', 404],
    ['u-cli1', 'a2', 404],
    ['u-cli1b', 'a1', 404],
    ['u-aud1', 'a1', 403],
    ['u-adm0', 'a1', 404],
    ['u-adm1', 'a3', 404],
    ['u-pro1', 'a3', 404],
    ['u-cli1', 'a3', 404],
    ['u-adm2', 'a1', 404],
    ['u-pro2', 'a1', 404],
    ['u-cli2', 'a1', 404],
    ['u-pro2', 'a3', 200],
    ['u-adm2', 'a3', 200],
  ];
  for (const [as, id, status] of expectations) {
    const res = await call('GET', `/appointments/${id}`, { as });
    assert.equal(res.status, status, `${as} reading ${id}`);
    if (status === 200) assert.equal(res.json.id, id);
    else assert.ok(!res.text.includes('"startsAt"'), 'a denied response must not carry the record');
  }
  assert.equal((await call('GET', '/appointments/a1')).status, 401);
  assert.equal((await call('GET', '/appointments/missing', { as: 'u-adm1' })).status, 404);
});

test('POST /appointments: who may create, and in which center', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());

  const own = await call('POST', '/appointments', { as: 'u-pro1', body: NEW_APPOINTMENT('u-pro1', 'u-cli1') });
  assert.equal(own.status, 201);
  assert.equal(own.json.centerId, 'c1');
  assert.equal(own.json.status, 'scheduled');
  assert.equal(careStore.appointmentsById.get(own.json.id).centerId, 'c1');

  const byAdmin = await call('POST', '/appointments', { as: 'u-adm1', body: NEW_APPOINTMENT('u-pro1b', 'u-cli1') });
  assert.equal(byAdmin.status, 201);
  assert.equal(byAdmin.json.centerId, 'c1');

  const denied = [
    ['professional for another professional', 'u-pro1', NEW_APPOINTMENT('u-pro1b', 'u-cli1')],
    ['professional with a client of another center', 'u-pro1', NEW_APPOINTMENT('u-pro1', 'u-cli2')],
    ['professional with a professional as the client', 'u-pro1', NEW_APPOINTMENT('u-pro1', 'u-pro1b')],
    ['professional with an unknown client', 'u-pro1', NEW_APPOINTMENT('u-pro1', 'u-nobody')],
    ['admin with a professional of another center', 'u-adm1', NEW_APPOINTMENT('u-pro2', 'u-cli1')],
    ['admin with a client of another center', 'u-adm1', NEW_APPOINTMENT('u-pro1', 'u-cli2')],
    ['admin without a center', 'u-adm0', NEW_APPOINTMENT('u-pro1', 'u-cli1')],
    ['client', 'u-cli1', NEW_APPOINTMENT('u-pro1', 'u-cli1')],
    ['auditor', 'u-aud1', NEW_APPOINTMENT('u-pro1', 'u-cli1')],
  ];
  const before = careStore.appointmentsById.size;
  for (const [label, as, body] of denied) {
    const res = await call('POST', '/appointments', { as, body });
    assert.equal(res.status, 403, label);
  }
  assert.equal(careStore.appointmentsById.size, before, 'a denied request created a record');

  assert.equal((await call('POST', '/appointments', { body: NEW_APPOINTMENT('u-pro1', 'u-cli1') })).status, 401);
});

test('POST /appointments rejects bad bodies and never takes the center from the body', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());
  const good = NEW_APPOINTMENT('u-pro1', 'u-cli1');
  const bad = [
    { ...good, centerId: 'c2' },
    { ...good, status: 'completed' },
    { ...good, startsAt: 'tomorrow' },
    { ...good, startsAt: '2026-12-02T10:00:00+02:00' },
    { ...good, endsAt: good.startsAt },
    { ...good, professionalId: '' },
    { ...good, clientId: 5 },
    { ...good, clientId: 'x'.repeat(65) },
    { professionalId: 'u-pro1' },
    [],
    'text',
    null,
  ];
  const before = careStore.appointmentsById.size;
  for (const body of bad) {
    const res = await call('POST', '/appointments', { as: 'u-pro1', body });
    assert.equal(res.status, 400, JSON.stringify(body));
    // The JSON parser rejects a bare string or null before the route runs.
    assert.ok(['invalid_request', 'invalid_json'].includes(res.json.error.code), res.text);
  }
  assert.equal(careStore.appointmentsById.size, before);
});

test('POST /consultations: only the professional of the appointment may create', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());
  const body = (appointmentId) => ({ appointmentId, body: { note: 'synthetic' } });

  const created = await call('POST', '/consultations', { as: 'u-pro1', body: body('a1') });
  assert.equal(created.status, 201);
  assert.equal(created.json.appointmentId, 'a1');
  assert.deepEqual(careStore.consultationsById.get(created.json.id).body, { note: 'synthetic' });

  const before = careStore.consultationsById.size;
  // [user, appointment, status]. The gate admits only the professional role on this route,
  // so every other role gets 403 before the record is looked at. A professional who cannot
  // read the appointment gets 404. A professional who can read it may always create on it.
  const denied = [
    ['u-pro1', 'a2', 404],
    ['u-pro1', 'a3', 404],
    ['u-pro2', 'a1', 404],
    ['u-cli1', 'a1', 403],
    ['u-adm1', 'a1', 403],
    ['u-adm2', 'a1', 403],
    ['u-aud1', 'a1', 403],
    ['u-adm0', 'a1', 403],
  ];
  for (const [as, id, status] of denied) {
    assert.equal((await call('POST', '/consultations', { as, body: body(id) })).status, status, `${as} on ${id}`);
  }
  assert.equal(careStore.consultationsById.size, before);
  assert.equal((await call('POST', '/consultations', { body: body('a1') })).status, 401);
  assert.equal((await call('POST', '/consultations', { as: 'u-pro1', body: body('missing') })).status, 404);
  for (const bad of [{ appointmentId: 'a1' }, { appointmentId: 'a1', body: [] }, { appointmentId: 'a1', body: {}, x: 1 }, { body: {} }]) {
    assert.equal((await call('POST', '/consultations', { as: 'u-pro1', body: bad })).status, 400, JSON.stringify(bad));
  }
});

test('GET /consultations/:id allows the participants and the center admin only', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  const expectations = [
    ['u-pro1', 'k1', 200],
    ['u-cli1', 'k1', 200],
    ['u-adm1', 'k1', 200],
    ['u-adm1', 'k2', 200],
    ['u-pro1', 'k2', 404],
    ['u-cli1', 'k2', 404],
    ['u-pro1b', 'k1', 404],
    ['u-cli1b', 'k1', 404],
    ['u-aud1', 'k1', 403],
    ['u-adm0', 'k1', 404],
    ['u-adm1', 'k3', 404],
    ['u-pro2', 'k1', 404],
    ['u-cli2', 'k1', 404],
    ['u-adm2', 'k1', 404],
    ['u-aud2', 'k3', 403],
    ['u-pro2', 'k3', 200],
    ['u-cli2', 'k3', 200],
  ];
  for (const [as, id, status] of expectations) {
    const res = await call('GET', `/consultations/${id}`, { as });
    assert.equal(res.status, status, `${as} reading ${id}`);
    if (status === 200) assert.equal(res.json.id, id);
    else assert.ok(!res.text.includes('synthetic note'), 'a denied response must not carry the record');
  }
  assert.equal((await call('GET', '/consultations/k1')).status, 401);
  assert.equal((await call('GET', '/consultations/missing', { as: 'u-adm1' })).status, 404);
});

test('a route without a rule answers 403, signed in or not', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  const unruled = [
    ['GET', '/no-such-route'],
    ['GET', '/appointments/'],
    ['GET', '/Appointments'],
    ['GET', '/appointments/a1/consultations'],
    ['GET', '/users'],
    ['GET', '/auth/unknown'],
    ['DELETE', '/appointments/a1'],
    ['HEAD', '/appointments'],
    ['OPTIONS', '/appointments'],
    ['POST', '/no-such-route'],
    ['POST', '/consultations/k1'],
  ];
  for (const [method, path] of unruled) {
    for (const as of [null, 'u-pro1', 'u-adm1', 'u-aud1']) {
      const res = await call(method, path, { as, body: method === 'POST' ? {} : undefined });
      assert.equal(res.status, 403, `${as} ${method} ${path}`);
      if (method !== 'HEAD') assert.equal(res.json.error.code, 'forbidden');
    }
  }
});

test('a route added without a rule stays closed to every role', async (t) => {
  const authStore = createMemoryAuthStore({ users: USERS });
  const auth = createAuth({ config: AUTH_CONFIG, db: fakeDb(), store: authStore, oidc: {}, logger: quietLogger });
  const app = express();
  app.use(express.json());
  app.use(createAuthzGate({ requireSession: auth.requireSession }));
  app.get('/appointments', (req, res) => res.json({ reached: true }));
  app.get('/secret', (req, res) => res.json({ reached: true }));
  app.use(notFound);
  app.use(createErrorHandler({ logger: quietLogger }));
  const server = await listen(app);
  t.after(() => server.close());

  for (const user of USERS) {
    const { token } = await auth.sessions.create(user);
    const secret = await fetch(`${server.url}/secret`, { headers: { Cookie: `d7_session=${token}` } });
    assert.equal(secret.status, 403, `${user.id} on a route without a rule`);
  }
  const anonymous = await fetch(`${server.url}/secret`);
  assert.equal(anonymous.status, 403);
  // A route that has a rule is reached by an allowed role and refused for an auditor.
  const { token: proToken } = await auth.sessions.create(USERS[0]);
  const { token: audToken } = await auth.sessions.create(USERS[5]);
  assert.equal((await fetch(`${server.url}/appointments`, { headers: { Cookie: `d7_session=${proToken}` } })).status, 200);
  assert.equal((await fetch(`${server.url}/appointments`, { headers: { Cookie: `d7_session=${audToken}` } })).status, 403);
});

test('the gate refuses a rule that no role can satisfy', () => {
  const requireSession = () => (req, res, next) => next();
  assert.throws(
    () => createAuthzGate({ requireSession, rules: [{ method: 'GET', path: '/x', resource: 'appointment', action: 'delete' }] }),
    TypeError
  );
});

test('POST, PUT, and PATCH without a JSON content type answer 415', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());
  const targets = [
    ['POST', '/appointments', JSON.stringify(NEW_APPOINTMENT('u-pro1', 'u-cli1'))],
    ['POST', '/consultations', JSON.stringify({ appointmentId: 'a1', body: {} })],
    ['PUT', '/appointments/a1', JSON.stringify({ status: 'cancelled' })],
    ['PATCH', '/appointments/a1', JSON.stringify({ status: 'cancelled' })],
    ['PUT', '/consultations/k1', '{}'],
    ['PATCH', '/consultations/k1', '{}'],
    ['PUT', '/no-such-route', '{}'],
  ];
  const types = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/xml', 'application/jsonx', 'text/json', null];
  const appointmentsBefore = careStore.appointmentsById.size;
  const consultationsBefore = careStore.consultationsById.size;
  for (const [method, path, raw] of targets) {
    for (const contentType of types) {
      for (const as of ['u-pro1', 'u-adm1', null]) {
        const res = await call(method, path, { as, raw, contentType });
        assert.equal(res.status, 415, `${as} ${method} ${path} as ${contentType}`);
        assert.equal(res.json.error.code, 'unsupported_media_type');
      }
    }
  }
  assert.equal(careStore.appointmentsById.size, appointmentsBefore);
  assert.equal(careStore.consultationsById.size, consultationsBefore);
  assert.equal(careStore.appointmentsById.get('a1').status, 'scheduled');

  // A body-less POST without a content type is refused too.
  assert.equal((await call('POST', '/appointments', { as: 'u-pro1', contentType: null })).status, 415);
  // JSON with a charset parameter is accepted.
  const ok = await call('POST', '/appointments', {
    as: 'u-pro1',
    body: NEW_APPOINTMENT('u-pro1', 'u-cli1'),
    contentType: 'application/json; charset=utf-8',
  });
  assert.equal(ok.status, 201);
  // Reads do not need a content type.
  assert.equal((await call('GET', '/appointments', { as: 'u-pro1', contentType: null })).status, 200);
});

test('the /auth routes and the probes stay outside the gate', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  assert.equal((await call('GET', '/healthz')).status, 200);
  assert.equal((await call('GET', '/auth/me')).status, 401);
  assert.equal((await call('GET', '/auth/me', { as: 'u-pro1' })).status, 200);
  assert.equal((await call('POST', '/auth/logout', { contentType: null })).status, 204);
});

// ---- Properties over HTTP ----

const NUM_RUNS = 250;
const userIdArb = fc.constantFrom(...USERS.map((user) => user.id));
const knownOrRandomId = (known) =>
  fc.oneof(fc.constantFrom(...known), fc.string({ maxLength: 80 }), fc.constantFrom('', '.', '..', '%2e', '__proto__'));

test('property: nobody reads an appointment or consultation of another center', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  await fc.assert(
    fc.asyncProperty(
      userIdArb,
      fc.constantFrom('appointments', 'consultations'),
      knownOrRandomId([...APPOINTMENT_CENTER.keys(), ...CONSULTATION_CENTER.keys()]),
      async (as, kind, id) => {
        const res = await call('GET', `/${kind}/${encodeURIComponent(id)}`, { as });
        const centers = kind === 'appointments' ? APPOINTMENT_CENTER : CONSULTATION_CENTER;
        if (res.status === 200) {
          assert.equal(CENTER_OF.get(as), centers.get(id), `${as} read ${kind}/${id} of another center`);
          assert.equal(res.json.id, id);
        } else if (centers.has(id) && CENTER_OF.get(as) !== centers.get(id)) {
          // Another center answers exactly like a missing record. An auditor is refused
          // by the route rule first, so it gets 403 for every id.
          assert.equal(res.status, ROLE_OF.get(as) === 'auditor' ? 403 : 404);
        }
        assert.ok([200, 400, 403, 404].includes(res.status), `unexpected status ${res.status}`);
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

test('property: lists never contain a row of another center', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  await fc.assert(
    fc.asyncProperty(userIdArb, fc.integer({ min: 1, max: 200 }), fc.integer({ min: 0, max: 5 }), async (as, limit, offset) => {
      const res = await call('GET', `/appointments?limit=${limit}&offset=${offset}`, { as });
      if (res.status === 200) {
        for (const item of res.json.items) {
          assert.equal(item.centerId, CENTER_OF.get(as), `${as} listed ${item.id}`);
          assert.equal(APPOINTMENT_CENTER.get(item.id), CENTER_OF.get(as));
        }
      } else {
        assert.equal(res.status, 403);
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

test('property: a created appointment always belongs to the center of its creator and both participants', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());
  const creatorArb = userIdArb;
  const personArb = fc.oneof(userIdArb, fc.constant('u-nobody'));
  await fc.assert(
    fc.asyncProperty(creatorArb, personArb, personArb, fc.constantFrom(undefined, 'c1', 'c2', 'c3'), async (as, professionalId, clientId, centerId) => {
      const body = NEW_APPOINTMENT(professionalId, clientId);
      if (centerId !== undefined) body.centerId = centerId;
      const before = new Set(careStore.appointmentsById.keys());
      const res = await call('POST', '/appointments', { as, body });
      if (res.status === 201) {
        const created = careStore.appointmentsById.get(res.json.id);
        assert.equal(created.centerId, CENTER_OF.get(as));
        assert.equal(CENTER_OF.get(professionalId), created.centerId);
        assert.equal(CENTER_OF.get(clientId), created.centerId);
        assert.ok(!before.has(created.id));
        assert.equal(centerId, undefined, 'the body carried a centerId');
      } else {
        assert.ok([400, 403].includes(res.status), `unexpected status ${res.status}`);
        assert.deepEqual(new Set(careStore.appointmentsById.keys()), before, 'a refused request wrote a record');
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

test('property: nobody writes a consultation into an appointment of another center', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());
  await fc.assert(
    fc.asyncProperty(userIdArb, knownOrRandomId([...APPOINTMENT_CENTER.keys()]), async (as, appointmentId) => {
      const before = new Set(careStore.consultationsById.keys());
      const res = await call('POST', '/consultations', { as, body: { appointmentId, body: { note: 'synthetic' } } });
      if (res.status === 201) {
        assert.equal(CENTER_OF.get(as), APPOINTMENT_CENTER.get(appointmentId), `${as} wrote into ${appointmentId}`);
        assert.equal(res.json.appointmentId, appointmentId);
      } else {
        assert.deepEqual(new Set(careStore.consultationsById.keys()), before, 'a refused request wrote a record');
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

test('property: a state-changing request without a JSON content type never reaches a handler', async (t) => {
  const { server, call, careStore } = await setup();
  t.after(() => server.close());
  const typeArb = fc.oneof(
    fc.constantFrom('text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/xml', null),
    fc.string({ maxLength: 20 }).filter((s) => s.split(';')[0].trim().toLowerCase() !== 'application/json' && /^[\x21-\x7e]*$/.test(s))
  );
  await fc.assert(
    fc.asyncProperty(
      userIdArb,
      fc.constantFrom('POST', 'PUT', 'PATCH'),
      fc.constantFrom('/appointments', '/consultations', '/appointments/a1', '/anything'),
      typeArb,
      async (as, method, path, contentType) => {
        const appointmentsBefore = careStore.appointmentsById.size;
        const consultationsBefore = careStore.consultationsById.size;
        const res = await call(method, path, { as, raw: JSON.stringify({ appointmentId: 'a1', body: {} }), contentType });
        assert.equal(res.status, 415);
        assert.equal(careStore.appointmentsById.size, appointmentsBefore);
        assert.equal(careStore.consultationsById.size, consultationsBefore);
      }
    ),
    { numRuns: NUM_RUNS }
  );
});
