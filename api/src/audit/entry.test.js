'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEntry, requestContext } = require('./entry');
const { createSqlAuditStore } = require('./store');
const { createMemoryAuditStore } = require('./memoryStore');
const { createAudit } = require('./index');

const ID = { id: 'e-1', at: new Date('2026-11-19T03:26:00.123Z') };

// Records every statement and returns the rows it was given.
function recordingDb(rows = []) {
  const db = {
    calls: [],
    async execute(sql, params = []) {
      db.calls.push({ sql, params });
      return rows;
    },
  };
  return db;
}

const DENIED = { action: 'appointment.read', targetType: 'appointment', outcome: 'denied', reason: 'not_participant' };

test('buildEntry copies only the listed fields, so a body or any other field never reaches the log', () => {
  const entry = buildEntry(
    {
      ...DENIED,
      actorId: 'u-pro1',
      centerId: 'c1',
      targetId: 'a1',
      ip: '203.0.113.7',
      body: { note: 'synthetic clinical text' },
      password: 'must-not-be-stored',
    },
    ID
  );
  assert.deepEqual(Object.keys(entry).sort(), [
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
  assert.equal(JSON.stringify(entry).includes('synthetic clinical text'), false);
  assert.equal(JSON.stringify(entry).includes('must-not-be-stored'), false);
});

test('buildEntry sets the id and the UTC date it was given', () => {
  const entry = buildEntry({ action: 'auth.logout', targetType: 'session', outcome: 'success' }, ID);
  assert.equal(entry.id, 'e-1');
  assert.ok(entry.occurredAt instanceof Date);
  assert.equal(entry.occurredAt.toISOString(), '2026-11-19T03:26:00.123Z');
  assert.equal(entry.reason, null);
});

test('buildEntry requires a reason for denied and failed entries, and forbids one for success', () => {
  assert.throws(() => buildEntry({ ...DENIED, reason: undefined }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, reason: '' }, ID), TypeError);
  assert.throws(
    () => buildEntry({ action: 'auth.login', targetType: 'user', outcome: 'failure' }, ID),
    TypeError
  );
  assert.throws(
    () => buildEntry({ action: 'auth.login', targetType: 'user', outcome: 'success', reason: 'x' }, ID),
    TypeError
  );
});

test('buildEntry rejects an unknown outcome, an empty action, and oversized names', () => {
  assert.throws(() => buildEntry({ ...DENIED, outcome: 'maybe' }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, action: '' }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, action: 'a'.repeat(101) }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, targetType: 't'.repeat(51) }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, reason: 'r'.repeat(101) }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, actorId: 'x'.repeat(65) }, ID), TypeError);
  assert.throws(() => buildEntry({ ...DENIED, targetId: 'x'.repeat(65) }, ID), TypeError);
});

test('buildEntry keeps an address that fits and stores NULL for one that does not, without failing', () => {
  assert.equal(buildEntry({ ...DENIED, ip: '::ffff:127.0.0.1' }, ID).ip, '::ffff:127.0.0.1');
  assert.equal(buildEntry({ ...DENIED, ip: 'x'.repeat(46) }, ID).ip, null);
  assert.equal(buildEntry({ ...DENIED, ip: undefined }, ID).ip, null);
});

test('requestContext reads the actor from the session and the address from the request', () => {
  const user = { id: 'u-pro1', centerId: 'c1', role: 'professional' };
  assert.deepEqual(requestContext({ auth: { user }, ip: '10.0.0.5' }), {
    actorId: 'u-pro1',
    centerId: 'c1',
    ip: '10.0.0.5',
  });
  // Before the session check there is no actor.
  assert.deepEqual(requestContext({ ip: '10.0.0.5' }), { actorId: null, centerId: null, ip: '10.0.0.5' });
});

test('the SQL store inserts every column as a bound parameter, with a UTC time and NULL for absent values', async () => {
  const db = recordingDb();
  const store = createSqlAuditStore(db);
  await store.insert({
    id: 'e-1',
    actorId: null,
    centerId: null,
    action: 'request.denied',
    targetType: 'route',
    targetId: null,
    outcome: 'denied',
    reason: 'no_rule',
    ip: '::1',
    occurredAt: new Date('2026-11-19T03:26:00.123Z'),
  });
  const [insert] = db.calls;
  assert.match(insert.sql, /^INSERT INTO `audit_log` \(/);
  assert.deepEqual(insert.params, [
    'e-1',
    null,
    null,
    'request.denied',
    'route',
    null,
    'denied',
    'no_rule',
    '::1',
    '2026-11-19 03:26:00.123',
  ]);
});

test('the SQL store never inserts a value into the statement text', async () => {
  const db = recordingDb();
  const store = createSqlAuditStore(db);
  const hostile = "x'); DROP TABLE audit_log; --";
  await store.insert({
    id: 'e-2',
    actorId: hostile,
    centerId: 'c1',
    action: 'auth.login',
    targetType: 'user',
    targetId: null,
    outcome: 'failure',
    reason: 'state_unknown',
    ip: null,
    occurredAt: new Date(0),
  });
  assert.equal(db.calls[0].sql.includes(hostile), false);
  assert.equal(db.calls[0].params[1], hostile);
});

test('the SQL list binds the filter, orders newest first, and interpolates only validated paging', async () => {
  const db = recordingDb();
  const store = createSqlAuditStore(db);
  const hostileAction = "x' OR '1'='1";
  await store.list(
    {
      centerId: 'c1',
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-30T00:00:00.000Z'),
      actorId: 'u-pro1',
      action: hostileAction,
      outcome: 'denied',
    },
    { limit: 25, offset: 50 }
  );
  const [query] = db.calls;
  assert.equal(query.sql.includes(hostileAction), false);
  assert.match(query.sql, /ORDER BY occurred_at DESC, id DESC LIMIT 25 OFFSET 50$/);
  assert.deepEqual(query.params, [
    'c1',
    '2026-11-01 00:00:00.000',
    '2026-11-30 00:00:00.000',
    'u-pro1',
    hostileAction,
    'denied',
  ]);
});

test('the SQL list rejects out-of-range paging before it reaches the database', async () => {
  const db = recordingDb();
  const store = createSqlAuditStore(db);
  for (const page of [{ limit: 0, offset: 0 }, { limit: 201, offset: 0 }, { limit: 10, offset: -1 }, { limit: 1.5, offset: 0 }]) {
    await assert.rejects(() => store.list({ centerId: 'c1' }, page), RangeError);
  }
  assert.equal(db.calls.length, 0);
});

test('the SQL list maps rows to entries with Date values', async () => {
  const db = recordingDb([
    {
      id: 'e-1',
      actor_id: 'u-pro1',
      center_id: 'c1',
      action: 'consultation.read',
      target_type: 'consultation',
      target_id: 'k1',
      outcome: 'success',
      reason: null,
      ip: '::1',
      occurred_at: new Date('2026-11-19T03:26:00.123Z'),
    },
  ]);
  const [entry] = await createSqlAuditStore(db).list({ centerId: 'c1' }, { limit: 10, offset: 0 });
  assert.equal(entry.actorId, 'u-pro1');
  assert.equal(entry.targetId, 'k1');
  assert.equal(entry.occurredAt.toISOString(), '2026-11-19T03:26:00.123Z');
});

test('the memory store lists by center, filters, sorts newest first, and pages', async () => {
  const store = createMemoryAuditStore();
  const base = { reason: null, ip: null, targetType: 'consultation', targetId: null, action: 'consultation.read' };
  await store.insert({ ...base, id: 'e-a', actorId: 'u-pro1', centerId: 'c1', outcome: 'success', occurredAt: new Date('2026-11-19T10:00:00.000Z') });
  await store.insert({ ...base, id: 'e-b', actorId: 'u-pro1', centerId: 'c1', outcome: 'success', occurredAt: new Date('2026-11-19T12:00:00.000Z') });
  await store.insert({ ...base, id: 'e-c', actorId: 'u-cli1', centerId: 'c1', outcome: 'success', occurredAt: new Date('2026-11-19T11:00:00.000Z') });
  await store.insert({ ...base, id: 'e-d', actorId: 'u-pro2', centerId: 'c2', outcome: 'success', occurredAt: new Date('2026-11-19T13:00:00.000Z') });

  const all = await store.list({ centerId: 'c1' }, { limit: 10, offset: 0 });
  assert.deepEqual(all.map((e) => e.id), ['e-b', 'e-c', 'e-a']);
  assert.deepEqual((await store.list({ centerId: 'c1', actorId: 'u-pro1' }, { limit: 10, offset: 0 })).map((e) => e.id), ['e-b', 'e-a']);
  assert.deepEqual(
    (await store.list({ centerId: 'c1', from: new Date('2026-11-19T10:30:00.000Z'), to: new Date('2026-11-19T11:30:00.000Z') }, { limit: 10, offset: 0 })).map((e) => e.id),
    ['e-c']
  );
  assert.deepEqual((await store.list({ centerId: 'c1' }, { limit: 1, offset: 1 })).map((e) => e.id), ['e-c']);
});

test('createAudit writes one entry per record call, with the injected clock and id', async () => {
  const store = createMemoryAuditStore();
  let n = 0;
  const audit = createAudit({
    store,
    now: () => new Date('2026-11-19T03:26:00.123Z'),
    newId: () => `id-${++n}`,
  });
  const id = await audit.record({ action: 'auth.logout', targetType: 'session', outcome: 'success', actorId: 'u-pro1', centerId: 'c1' });
  assert.equal(id, 'id-1');
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].occurredAt.toISOString(), '2026-11-19T03:26:00.123Z');
});

test('createAudit refuses to start without a database or a store', () => {
  assert.throws(() => createAudit({}), TypeError);
});

test('a refused entry is not written', async () => {
  const store = createMemoryAuditStore();
  const audit = createAudit({ store });
  await assert.rejects(() => audit.record({ action: 'x', targetType: 'y', outcome: 'denied' }), TypeError);
  assert.equal(store.entries.length, 0);
});
