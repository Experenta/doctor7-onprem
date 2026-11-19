'use strict';

// HTTP tests of the audit hooks in the care routes. Each listed action writes one
// entry with its author and date. Each refusal writes one entry with its internal
// reason, and the response does not reveal that reason.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApi, entriesOf } = require('./harness');

const SENTINEL = 'SYNTHETIC-SENTINEL-7f3a9c';

// Runs `fn` and returns the entries it added, plus its result.
async function addedBy(auditStore, fn) {
  const before = auditStore.entries.length;
  const result = await fn();
  return { added: entriesOf(auditStore).slice(before), result };
}

test('a successful consultation read writes one entry with author, center, target, and date', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/consultations/k1', { as: 'u-pro1' }));
  assert.equal(result.status, 200);
  assert.equal(added.length, 1);
  const [entry] = added;
  assert.equal(entry.action, 'consultation.read');
  assert.equal(entry.outcome, 'success');
  assert.equal(entry.actorId, 'u-pro1');
  assert.equal(entry.centerId, 'c1');
  assert.equal(entry.targetType, 'consultation');
  assert.equal(entry.targetId, 'k1');
  assert.equal(entry.reason, null);
  assert.ok(entry.occurredAt instanceof Date && !Number.isNaN(entry.occurredAt.getTime()));
  assert.ok(entry.ip && entry.ip.length <= 45);
});

test('a consultation read entry never contains the consultation body', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  await call('GET', '/consultations/k1', { as: 'u-pro1' });
  const dump = JSON.stringify(entriesOf(auditStore));
  assert.equal(dump.includes('synthetic note k1'), false);
});

test('a successful appointment create writes one entry that names the new appointment', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/appointments', {
      as: 'u-pro1',
      body: { professionalId: 'u-pro1', clientId: 'u-cli1', startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T10:50:00.000Z' },
    })
  );
  assert.equal(result.status, 201);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'appointment.create');
  assert.equal(added[0].outcome, 'success');
  assert.equal(added[0].actorId, 'u-pro1');
  assert.equal(added[0].centerId, 'c1');
  assert.equal(added[0].targetId, result.json.id);
});

test('a successful consultation create writes one entry, and the note stays out of the log', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/consultations', { as: 'u-pro1', body: { appointmentId: 'a1', body: { note: SENTINEL } } })
  );
  assert.equal(result.status, 201);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'consultation.create');
  assert.equal(added[0].outcome, 'success');
  assert.equal(added[0].actorId, 'u-pro1');
  assert.equal(added[0].centerId, 'c1');
  assert.equal(added[0].targetId, result.json.id);
  assert.equal(JSON.stringify(entriesOf(auditStore)).includes(SENTINEL), false);
});

test('a successful appointment read writes no entry, because only refusals and the listed actions are logged', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/appointments/a1', { as: 'u-pro1' }));
  assert.equal(result.status, 200);
  assert.equal(added.length, 0);
});

test('a request that fails validation writes no entry', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/appointments', { as: 'u-pro1', body: { professionalId: 'u-pro1' } })
  );
  assert.equal(result.status, 400);
  assert.equal(added.length, 0);
});

test('another center and a missing record get the same 404, and the log tells them apart', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());

  const other = await addedBy(auditStore, () => call('GET', '/consultations/k3', { as: 'u-pro1' }));
  const missing = await addedBy(auditStore, () => call('GET', '/consultations/no-such-id', { as: 'u-pro1' }));

  assert.equal(other.result.status, 404);
  assert.equal(missing.result.status, 404);
  assert.equal(other.result.text, missing.result.text, 'the two 404 bodies must be identical');

  assert.equal(other.added.length, 1);
  assert.equal(other.added[0].outcome, 'denied');
  assert.equal(other.added[0].action, 'consultation.read');
  assert.equal(other.added[0].targetId, 'k3');
  assert.equal(other.added[0].reason, 'other_center');
  assert.equal(other.added[0].centerId, 'c2', 'the entry takes the center of the record');

  assert.equal(missing.added.length, 1);
  assert.equal(missing.added[0].reason, 'not_found');
  assert.equal(missing.added[0].targetId, 'no-such-id');
});

test('a same-center user who is not a participant gets 404 with reason not_participant', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  // u-pro1b is a professional of c1 but takes part in a2, not a1.
  const { added, result } = await addedBy(auditStore, () => call('GET', '/appointments/a1', { as: 'u-pro1b' }));
  assert.equal(result.status, 404);
  assert.equal(added.length, 1);
  assert.equal(added[0].reason, 'not_participant');
  assert.equal(added[0].actorId, 'u-pro1b');
});

test('an admin without a center is refused like another center, with reason no_center', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () => call('GET', '/appointments/a1', { as: 'u-adm0' }));
  assert.equal(result.status, 404);
  assert.equal(added.length, 1);
  assert.equal(added[0].reason, 'no_center');
  assert.equal(added[0].centerId, 'c1');
});

test('an invalid id is refused with reason invalid_id and no target id', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const longId = 'x'.repeat(65);
  const { added, result } = await addedBy(auditStore, () => call('GET', `/consultations/${longId}`, { as: 'u-pro1' }));
  assert.equal(result.status, 404);
  assert.equal(added.length, 1);
  assert.equal(added[0].reason, 'invalid_id');
  assert.equal(added[0].targetId, null);
});

test('a client who reads its own appointment but tries to create a consultation gets 403 with one entry', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/consultations', { as: 'u-cli1', body: { appointmentId: 'a1', body: { note: SENTINEL } } })
  );
  assert.equal(result.status, 403);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'consultation.create');
  assert.equal(added[0].outcome, 'denied');
  assert.equal(added[0].reason, 'role_not_allowed');
  assert.equal(added[0].actorId, 'u-cli1');
  assert.equal(JSON.stringify(entriesOf(auditStore)).includes(SENTINEL), false);
});

test('a professional who cannot read an appointment cannot create a consultation on it and gets 404', async (t) => {
  // u-pro1 cannot read a2, so the answer is 404 with reason not_participant, not 403.
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/consultations', { as: 'u-pro1', body: { appointmentId: 'a2', body: { note: 'x' } } })
  );
  assert.equal(result.status, 404);
  assert.equal(added[0].action, 'consultation.create');
  assert.equal(added[0].targetType, 'appointment');
  assert.equal(added[0].targetId, 'a2');
  assert.equal(added[0].reason, 'not_participant');
});

test('a consultation for a missing appointment is refused with reason not_found', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/consultations', { as: 'u-pro1', body: { appointmentId: 'missing', body: {} } })
  );
  assert.equal(result.status, 404);
  assert.equal(added[0].reason, 'not_found');
  assert.equal(added[0].targetId, 'missing');
});

test('an appointment create refused for a participant gets 403 with the reason, and one message for every cause', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const cases = [
    ['client of another center', { professionalId: 'u-pro1', clientId: 'u-cli2' }, 'participant_other_center'],
    ['unknown client', { professionalId: 'u-pro1', clientId: 'u-nobody' }, 'participant_not_found'],
    ['professional used as the client', { professionalId: 'u-pro1', clientId: 'u-pro1b' }, 'participant_wrong_role'],
  ];
  const texts = [];
  for (const [label, participants, reason] of cases) {
    const { added, result } = await addedBy(auditStore, () =>
      call('POST', '/appointments', {
        as: 'u-pro1',
        body: { ...participants, startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T10:50:00.000Z' },
      })
    );
    assert.equal(result.status, 403, label);
    assert.equal(added.length, 1, label);
    assert.equal(added[0].action, 'appointment.create', label);
    assert.equal(added[0].outcome, 'denied', label);
    assert.equal(added[0].reason, reason, label);
    texts.push(result.text);
  }
  assert.equal(new Set(texts).size, 1, 'every participant refusal must return the same body');
});

test('a professional who creates an appointment for another professional is refused with action_not_allowed', async (t) => {
  const { server, call, auditStore } = await startApi();
  t.after(() => server.close());
  const { added, result } = await addedBy(auditStore, () =>
    call('POST', '/appointments', {
      as: 'u-pro1',
      body: { professionalId: 'u-pro1b', clientId: 'u-cli1', startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T10:50:00.000Z' },
    })
  );
  assert.equal(result.status, 403);
  assert.equal(added[0].reason, 'action_not_allowed');
  assert.equal(added[0].centerId, 'c1');
});

test('a sink that fails closes the read: the request answers 500 and returns no record', async (t) => {
  const failing = {
    entries: [],
    async insert() {
      throw new Error('simulated write failure');
    },
    async list() {
      return [];
    },
  };
  const { server, call } = await startApi({ auditStore: failing });
  t.after(() => server.close());
  const res = await call('GET', '/consultations/k1', { as: 'u-pro1' });
  assert.equal(res.status, 500);
  assert.equal(res.text.includes('synthetic note k1'), false);
});
