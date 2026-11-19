'use strict';

// Tests of GET /audit: only the auditor role reads the log, and only its own
// center. Also covers the filters, the paging, and the input checks.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApi } = require('./harness');

const SENTINEL = 'SYNTHETIC-SENTINEL-query-51d2';

// Creates a few entries in both centers: reads, denials, and a create.
async function seed(call) {
  await call('GET', '/consultations/k1', { as: 'u-pro1' });
  await call('GET', '/consultations/k1', { as: 'u-cli1' });
  // u-pro1b is a professional of c1 who does not take part in a1: a denial inside c1.
  await call('GET', '/consultations/k1', { as: 'u-pro1b' });
  await call('GET', '/consultations/k3', { as: 'u-pro1' });
  await call('GET', '/consultations/k3', { as: 'u-pro2' });
  await call('POST', '/consultations', { as: 'u-pro1', body: { appointmentId: 'a1', body: { note: SENTINEL } } });
}

test('an auditor reads the entries of its own center only', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);

  const c1 = await call('GET', '/audit', { as: 'u-aud1' });
  assert.equal(c1.status, 200);
  assert.ok(c1.json.items.length > 0);
  for (const item of c1.json.items) assert.equal(item.centerId, 'c1', item.id);

  const c2 = await call('GET', '/audit', { as: 'u-aud2' });
  assert.equal(c2.status, 200);
  for (const item of c2.json.items) assert.equal(item.centerId, 'c2', item.id);
  assert.ok(c2.json.items.some((item) => item.action === 'consultation.read' && item.targetId === 'k3'));
});

test('an auditor sees the refusals of its center, with their reasons', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);
  const { json } = await call('GET', '/audit?outcome=denied', { as: 'u-aud1' });
  const refusal = json.items.find((item) => item.targetId === 'k1' && item.actorId === 'u-pro1b');
  assert.ok(refusal, 'the refusal by u-pro1b is in the auditor center');
  assert.equal(refusal.reason, 'not_participant');
  assert.equal(refusal.outcome, 'denied');
});

test('every role other than auditor is refused with 403, and no session gets 401', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  for (const as of ['u-pro1', 'u-cli1', 'u-adm1', 'u-adm0']) {
    const res = await call('GET', '/audit', { as });
    assert.equal(res.status, 403, as);
    assert.equal(res.json.error.code, 'forbidden', as);
  }
  assert.equal((await call('GET', '/audit')).status, 401);
});

test('an auditor without a center is refused with 403 and reason no_center', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const before = auditStore.entries.length;
  const res = await call('GET', '/audit', { as: 'u-aud0' });
  assert.equal(res.status, 403);
  assert.equal(auditStore.entries.length, before + 1);
  assert.equal(auditStore.entries[before].reason, 'no_center');
  assert.equal(auditStore.entries[before].actorId, 'u-aud0');
});

test('the log cannot be changed through the API: writing to it has no route', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  await seed(call);
  const before = auditStore.entries.length;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await call(method, '/audit', { as: 'u-aud1', body: {} });
    assert.equal(res.status, 403, method);
  }
  const single = await call('DELETE', '/audit/anything', { as: 'u-aud1' });
  assert.equal(single.status, 403);
  // Each refusal adds an entry. Nothing is removed or changed.
  assert.ok(auditStore.entries.length >= before);
  assert.ok(auditStore.entries.slice(0, before).every((entry) => entry.id));
});

test('the entries never carry clinical text', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);
  const res = await call('GET', '/audit?limit=200', { as: 'u-aud1' });
  assert.equal(res.text.includes(SENTINEL), false);
});

test('the filters narrow the entries by actor, action, and outcome', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);

  const byActor = await call('GET', '/audit?actorId=u-pro1', { as: 'u-aud1' });
  assert.ok(byActor.json.items.length > 0);
  assert.ok(byActor.json.items.every((item) => item.actorId === 'u-pro1'));

  const byAction = await call('GET', '/audit?action=consultation.read', { as: 'u-aud1' });
  assert.ok(byAction.json.items.length > 0);
  assert.ok(byAction.json.items.every((item) => item.action === 'consultation.read'));

  const byOutcome = await call('GET', '/audit?outcome=denied', { as: 'u-aud1' });
  assert.ok(byOutcome.json.items.length > 0);
  assert.ok(byOutcome.json.items.every((item) => item.outcome === 'denied'));

  const none = await call('GET', '/audit?action=auth.login', { as: 'u-aud1' });
  assert.deepEqual(none.json.items, []);
});

test('the time filters use UTC instants, and from must not be after to', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);
  const future = await call('GET', '/audit?from=2999-01-01T00:00:00.000Z', { as: 'u-aud1' });
  assert.deepEqual(future.json.items, []);
  const past = await call('GET', '/audit?to=2000-01-01T00:00:00.000Z', { as: 'u-aud1' });
  assert.deepEqual(past.json.items, []);
  const reversed = await call('GET', '/audit?from=2026-12-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z', { as: 'u-aud1' });
  assert.equal(reversed.status, 400);
});

test('the paging returns the newest entries first, with limit and offset', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);

  const all = (await call('GET', '/audit?limit=200', { as: 'u-aud1' })).json.items;
  assert.ok(all.length >= 3, 'the seed should write several entries');
  for (let i = 1; i < all.length; i += 1) {
    assert.ok(Date.parse(all[i - 1].occurredAt) >= Date.parse(all[i].occurredAt), 'newest first');
  }

  const first = (await call('GET', '/audit?limit=2', { as: 'u-aud1' })).json.items;
  const second = (await call('GET', '/audit?limit=2&offset=2', { as: 'u-aud1' })).json.items;
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((item) => item.id), all.slice(0, 2).map((item) => item.id));
  assert.deepEqual(second.map((item) => item.id), all.slice(2, 4).map((item) => item.id));
});

test('bad filters and paging answer 400', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  const bad = [
    'limit=0',
    'limit=201',
    'limit=x',
    'offset=-1',
    'limit=1&limit=2',
    'from=tomorrow',
    'to=2026-11-19',
    'actorId=' + 'x'.repeat(65),
    'action=Bad%20Action',
    'action=' + 'a'.repeat(101),
    'outcome=maybe',
  ];
  for (const query of bad) {
    const res = await call('GET', `/audit?${query}`, { as: 'u-aud1' });
    assert.equal(res.status, 400, query);
    assert.equal(res.json.error.code, 'invalid_request', query);
  }
});

test('each entry has the agreed fields and no other', async (t) => {
  const { server, call } = await startApi();
  t.after(() => server.close());
  await seed(call);
  const [item] = (await call('GET', '/audit?limit=1', { as: 'u-aud1' })).json.items;
  assert.deepEqual(Object.keys(item).sort(), [
    'action',
    'actorId',
    'centerId',
    'id',
    'ip',
    'occurredAt',
    'outcome',
    'reason',
    'targetId',
    'targetType',
  ]);
  assert.match(item.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
