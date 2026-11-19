'use strict';

// HTTP tests of the stored meeting: the idempotent POST and the GET that lets the
// client enter the same room as the professional.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startVideoApi, JITSI_BASE_URL } = require('./harness');

const MEETING = '/appointments/a1/meeting';
const JITSI_URL = new RegExp(`^${JITSI_BASE_URL.replace(/\./g, '\\.')}/doctor7-[0-9a-f]{32}$`);

async function withApi(options, fn) {
  const api = await startVideoApi(options);
  try {
    await fn(api);
  } finally {
    await api.close();
  }
}

const jitsi = { env: { VIDEO_PROVIDER: 'jitsi' } };

test('the first POST answers 201 and stores the meeting with its provider and creator', async () => {
  await withApi({}, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 201);
    const stored = api.meetingStore.meetings.get('a1');
    assert.equal(stored.provider, res.json.provider);
    assert.equal(stored.url, res.json.url);
    assert.equal(stored.createdBy, 'u-pro1');
    assert.ok(stored.createdAt instanceof Date);
    assert.equal(api.meetingStore.meetings.size, 1);
  });
});

test('a second POST answers 200 with the same address and calls no provider', async () => {
  await withApi({}, async (api) => {
    const first = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    const requestsAfterFirst = api.google.requests.length;
    assert.ok(requestsAfterFirst > 0, 'the first POST called Google');
    const second = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    const third = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    for (const again of [second, third]) {
      assert.equal(again.status, 200);
      assert.deepEqual(again.json, first.json);
      assert.equal(again.headers.get('cache-control'), 'no-store');
    }
    assert.equal(api.google.requests.length, requestsAfterFirst, 'no further provider call');
    assert.equal(api.meetingStore.meetings.size, 1);
    assert.equal(api.entries('meeting.create_').length, 1);
    assert.equal(api.entries('meeting.read').length, 2);
  });
});

test('a repeated POST answers 200 for a stored meeting even when no provider is configured', async () => {
  await withApi({ env: { VIDEO_PROVIDER: '' } }, async (api) => {
    await api.meetingStore.insertMeeting({
      appointmentId: 'a1',
      provider: 'jitsi',
      url: `${JITSI_BASE_URL}/doctor7-stored`,
      createdBy: 'u-pro1',
      createdAt: new Date(),
    });
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.json.url, `${JITSI_BASE_URL}/doctor7-stored`);
  });
});

test('two simultaneous POSTs end with one stored meeting and the same address in both answers', async () => {
  await withApi(jitsi, async (api) => {
    // Both requests find no meeting before either one stores its own.
    const original = api.meetingStore.findMeeting;
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    api.meetingStore.findMeeting = async (id) => {
      calls += 1;
      const turn = calls;
      const found = await original(id);
      if (turn <= 2) {
        if (turn === 2) release();
        await gate;
      }
      return found;
    };

    const [one, two] = await Promise.all([
      api.call('POST', MEETING, { as: 'u-pro1', body: {} }),
      api.call('POST', MEETING, { as: 'u-pro1', body: {} }),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [200, 201]);
    assert.equal(api.meetingStore.meetings.size, 1);
    const stored = api.meetingStore.meetings.get('a1');
    assert.equal(one.json.url, stored.url);
    assert.equal(two.json.url, stored.url);
    assert.match(stored.url, JITSI_URL);
    assert.equal(api.entries('meeting.create_').length, 1, 'only the stored meeting is audited as created');
  });
});

test('the client reads the same provider and address the professional created', async () => {
  await withApi({}, async (api) => {
    const created = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    const read = await api.call('GET', MEETING, { as: 'u-cli1' });
    assert.equal(read.status, 200);
    assert.deepEqual(read.json, created.json);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    const own = await api.call('GET', MEETING, { as: 'u-pro1' });
    assert.deepEqual(own.json, created.json);
    assert.deepEqual(
      api.entries('meeting.read').map((entry) => [entry.actorId, entry.outcome, entry.targetId, entry.centerId]),
      [
        ['u-cli1', 'success', 'a1', 'c1'],
        ['u-pro1', 'success', 'a1', 'c1'],
      ]
    );
  });
});

test('the stored meeting keeps the provider that was really used after a failover', async () => {
  await withApi({ googleMode: 'http_500' }, async (api) => {
    const created = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(created.json.provider, 'jitsi');
    const read = await api.call('GET', MEETING, { as: 'u-cli1' });
    assert.deepEqual(read.json, created.json);
    assert.equal(api.meetingStore.meetings.get('a1').provider, 'jitsi');
  });
});

test('before the meeting exists, GET answers 404 no_meeting and writes no audit entry', async () => {
  await withApi({}, async (api) => {
    for (const as of ['u-pro1', 'u-cli1']) {
      const res = await api.call('GET', MEETING, { as });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, 'no_meeting');
    }
    assert.equal(api.entries('meeting').length, 0);
  });
});

test('an administrator and an auditor get 404 whether or not the meeting exists', async () => {
  await withApi({}, async (api) => {
    for (const exists of [false, true]) {
      if (exists) await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
      for (const as of ['u-adm1', 'u-aud1']) {
        const res = await api.call('GET', MEETING, { as });
        assert.equal(res.status, 404, `${as} exists=${exists}`);
        assert.equal(res.json.error.code, 'not_found');
        assert.equal(res.json.url, undefined);
      }
    }
    const denied = api.entries('meeting.read').filter((entry) => entry.outcome === 'denied');
    assert.deepEqual(
      denied.map((entry) => [entry.actorId, entry.reason]),
      [
        ['u-adm1', 'role_not_allowed'],
        ['u-aud1', 'role_not_allowed'],
        ['u-adm1', 'role_not_allowed'],
        ['u-aud1', 'role_not_allowed'],
      ]
    );
  });
});

const READ_REFUSALS = [
  { name: 'another professional of the center', as: 'u-pro1b', id: 'a1', reason: 'not_participant' },
  { name: 'another client of the center', as: 'u-cli1b', id: 'a1', reason: 'not_participant' },
  { name: 'a professional of another center', as: 'u-pro2', id: 'a1', reason: 'other_center' },
  { name: 'an appointment of another center', as: 'u-pro1', id: 'a3', reason: 'other_center' },
  { name: 'a client asking for an appointment of another center', as: 'u-cli1', id: 'a3', reason: 'other_center' },
  { name: 'a missing appointment', as: 'u-pro1', id: 'nope', reason: 'not_found' },
  { name: 'an administrator without a center', as: 'u-adm0', id: 'a1', reason: 'no_center' },
];

for (const refusal of READ_REFUSALS) {
  test(`GET is refused with the usual 404: ${refusal.name}`, async () => {
    await withApi({}, async (api) => {
      await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
      const res = await api.call('GET', `/appointments/${refusal.id}/meeting`, { as: refusal.as });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, 'not_found');
      assert.equal(res.json.url, undefined);
      const denied = api.entries('meeting.read');
      assert.equal(denied.length, 1);
      assert.equal(denied[0].outcome, 'denied');
      assert.equal(denied[0].reason, refusal.reason);
      assert.equal(denied[0].actorId, refusal.as);
    });
  });
}

test('every refused GET has the same body, and it is not the no_meeting body', async () => {
  await withApi({}, async (api) => {
    const bodies = new Set();
    for (const [as, id] of [['u-pro1b', 'a1'], ['u-pro2', 'a1'], ['u-pro1', 'nope'], ['u-pro1', 'a3'], ['u-adm1', 'a1']]) {
      const res = await api.call('GET', `/appointments/${id}/meeting`, { as });
      assert.equal(res.status, 404);
      bodies.add(res.text);
    }
    assert.equal(bodies.size, 1);
  });
});

test('GET without a session answers 401, and a query string is refused', async () => {
  await withApi({}, async (api) => {
    assert.equal((await api.call('GET', MEETING)).status, 401);
    const res = await api.call('GET', `${MEETING}?x=1`, { as: 'u-pro1' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_request');
  });
});

test('a client cannot create the meeting: 403 and nothing is stored', async () => {
  await withApi({}, async (api) => {
    for (const as of ['u-cli1', 'u-cli1b']) {
      const res = await api.call('POST', MEETING, { as, body: {} });
      assert.equal(res.status, 403);
    }
    assert.equal(api.meetingStore.meetings.size, 0);
    assert.equal(api.google.requests.length, 0);
  });
});

for (const status of ['cancelled', 'completed']) {
  test(`a ${status} appointment answers 409 appointment_closed and creates nothing`, async () => {
    await withApi({}, async (api) => {
      api.careStore.appointmentsById.get('a1').status = status;
      const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'appointment_closed');
      assert.equal(res.json.url, undefined);
      assert.equal(api.meetingStore.meetings.size, 0);
      assert.equal(api.google.requests.length, 0);
      const entries = api.entries('meeting');
      assert.deepEqual(
        entries.map((entry) => [entry.action, entry.outcome, entry.reason]),
        [['meeting.create', 'denied', 'appointment_closed']]
      );
    });
  });
}

test('a refusal for a caller who may not act comes before the closed check', async () => {
  await withApi({}, async (api) => {
    api.careStore.appointmentsById.get('a1').status = 'cancelled';
    assert.equal((await api.call('POST', MEETING, { as: 'u-cli1', body: {} })).status, 403);
    assert.equal((await api.call('POST', MEETING, { as: 'u-pro1b', body: {} })).status, 404);
  });
});

test('the address is never written to the audit log or the log', async () => {
  await withApi(jitsi, async (api) => {
    const created = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    await api.call('GET', MEETING, { as: 'u-cli1' });
    const room = created.json.url.split('/').pop();
    assert.ok(!JSON.stringify(api.auditStore.entries).includes(room));
    assert.ok(!api.logger.lines.join('\n').includes(room));
  });
});
