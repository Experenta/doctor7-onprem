'use strict';

// Refusals decided by the authorization gate are audited too: a role the route
// does not admit, and a request that matches no route rule. A request without a
// session gets 401 from the gate and writes nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApi, entriesOf } = require('./harness');

async function addedBy(auditStore, fn) {
  const before = auditStore.entries.length;
  const result = await fn();
  return { added: entriesOf(auditStore).slice(before), result };
}

test('a role the gate refuses writes one entry that names the route action and the id in the path', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/appointments/a1', { as: 'u-aud1' }));
  assert.equal(result.status, 403);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'appointment.read');
  assert.equal(added[0].targetType, 'appointment');
  assert.equal(added[0].targetId, 'a1');
  assert.equal(added[0].outcome, 'denied');
  assert.equal(added[0].reason, 'role_not_allowed');
  assert.equal(added[0].actorId, 'u-aud1');
  assert.equal(added[0].centerId, 'c1');
});

test('a refused role on a route without an id writes an entry with no target id', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/audit', { as: 'u-pro1' }));
  assert.equal(result.status, 403);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'audit.read');
  assert.equal(added[0].targetType, 'audit');
  assert.equal(added[0].targetId, null);
  assert.equal(added[0].reason, 'role_not_allowed');
  assert.equal(added[0].actorId, 'u-pro1');
});

test('a client refused on POST /appointments writes one entry with the route action', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/appointments', {
      as: 'u-cli1',
      body: { professionalId: 'u-pro1', clientId: 'u-cli1', startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T10:50:00.000Z' },
    })
  );
  assert.equal(result.status, 403);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'appointment.create');
  assert.equal(added[0].reason, 'role_not_allowed');
  assert.equal(added[0].actorId, 'u-cli1');
});

test('a route with no rule writes one entry with reason no_rule and the route as target', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('DELETE', '/appointments/a1', { as: 'u-pro1' }));
  assert.equal(result.status, 403);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'request.denied');
  assert.equal(added[0].targetType, 'route');
  assert.equal(added[0].targetId, null);
  assert.equal(added[0].reason, 'no_rule');
  assert.equal(added[0].outcome, 'denied');
  // The gate runs before the session is read, so this entry has no actor. Known limit (docs/AUDIT.md).
  assert.equal(added[0].actorId, null);
});

test('a request with no session to a route with no rule is also audited', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/no-such-route'));
  assert.equal(result.status, 403);
  assert.equal(added.length, 1);
  assert.equal(added[0].reason, 'no_rule');
});

test('a request with no session to a protected route gets 401 and writes nothing', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/consultations/k1'));
  assert.equal(result.status, 401);
  assert.equal(added.length, 0);
});

test('a request without a JSON content type gets 415 and writes nothing', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/appointments', { as: 'u-pro1', raw: '{}', contentType: 'text/plain' })
  );
  assert.equal(result.status, 415);
  assert.equal(added.length, 0);
});
