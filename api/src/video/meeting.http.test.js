'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startVideoApi, JITSI_BASE_URL } = require('./harness');

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const JITSI_URL = new RegExp(`^${JITSI_BASE_URL.replace(/\./g, '\\.')}/doctor7[0-9a-f]{32}$`);
const MEETING = '/appointments/a1/meeting';

async function withApi(options, fn) {
  const api = await startVideoApi(options);
  try {
    await fn(api);
  } finally {
    await api.close();
  }
}

// action, outcome, reason, targetId of each entry, for compact assertions.
const summary = (entries) =>
  entries.map((entry) => [entry.action, entry.outcome, entry.reason, entry.targetId, entry.actorId]);

test('meet: the professional creates a Meet meeting and one audit entry records it', async () => {
  await withApi({}, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.json).sort(), ['fallback', 'provider', 'simulated', 'url']);
    assert.equal(res.json.fallback, false);
    assert.equal(res.json.simulated, false, 'outside the demo a Meet meeting is real');
    assert.equal(res.json.provider, 'meet');
    assert.match(res.json.url, MEET_URL);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(summary(api.entries('meeting')), [['meeting.create_meet', 'success', null, 'a1', 'u-pro1']]);
    assert.equal(api.entries('meeting')[0].centerId, 'c1');
  });
});

test('jitsi: the meeting is a Jitsi room and Google is never called', async () => {
  await withApi({ env: { VIDEO_PROVIDER: 'jitsi' } }, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.json.provider, 'jitsi');
    assert.match(res.json.url, JITSI_URL);
    assert.deepEqual(summary(api.entries('meeting')), [['meeting.create_jitsi', 'success', null, 'a1', 'u-pro1']]);
    assert.equal(api.google.requests.length, 0);
  });
});

test('jitsi with a signed token puts the token in the URL', async () => {
  await withApi(
    { env: { VIDEO_PROVIDER: 'jitsi', JITSI_APP_ID: 'app-1', JITSI_JWT_SECRET: 'test-only-secret' } },
    async (api) => {
      const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
      assert.equal(res.status, 201);
      assert.ok(new URL(res.json.url).searchParams.get('jwt'));
      assert.ok(!res.text.includes('test-only-secret'));
    }
  );
});

const FAILURES = {
  http_400: 'meet_error',
  http_500: 'meet_error',
  quota: 'meet_quota',
  hang: 'meet_timeout',
  delegation_denied: 'meet_error',
  no_uri: 'meet_error',
};

for (const [mode, reason] of Object.entries(FAILURES)) {
  test(`failover (${mode}): Jitsi creates the meeting and one failover entry is written`, async () => {
    await withApi({ googleMode: mode }, async (api) => {
      const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
      assert.equal(res.status, 201);
      assert.equal(res.json.provider, 'jitsi');
      assert.match(res.json.url, JITSI_URL);
      // The room the failover creates is alphanumeric, as the Jitsi Apache rule requires.
      assert.match(new URL(res.json.url).pathname.slice(1), /^[a-zA-Z0-9]+$/);
      assert.deepEqual(summary(api.entries('meeting')), [
        ['meeting.failover', 'failure', reason, 'a1', 'u-pro1'],
        ['meeting.create_jitsi', 'success', null, 'a1', 'u-pro1'],
      ]);
      assert.equal(api.entries('meeting.failover').length, 1);
      assert.ok(api.logger.lines.some((line) => line.includes(`Video failover to jitsi: ${reason}`)));
    });
  });
}

test('failover applies to the new meeting only, and the next new meeting tries Meet again', async () => {
  await withApi({}, async (api) => {
    const first = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    // A stored meeting is never moved, so each new meeting needs the previous one gone.
    api.meetingStore.deleteForAppointment('a1');
    api.google.mode = 'http_500';
    const second = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    api.meetingStore.deleteForAppointment('a1');
    api.google.mode = 'ok';
    const third = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.deepEqual([first.json.provider, second.json.provider, third.json.provider], ['meet', 'jitsi', 'meet']);
    assert.match(first.json.url, MEET_URL);
    assert.deepEqual(
      api.entries('meeting').map((entry) => entry.action),
      ['meeting.create_meet', 'meeting.failover', 'meeting.create_jitsi', 'meeting.create_meet']
    );
  });
});

test('a wrong VIDEO_PROVIDER stops startup with a clear error', async () => {
  await assert.rejects(startVideoApi({ env: { VIDEO_PROVIDER: 'zoom' } }), /VIDEO_PROVIDER must be one of: meet, jitsi/);
});

test('an invalid VIDEO_PROVIDER in the process environment stops createApp', () => {
  const { createApp } = require('../app');
  const { fakeDb } = require('../../test/helpers');
  const { createMemoryAuthStore } = require('../auth/memoryStore');
  const { USERS, AUTH_CONFIG } = require('../audit/harness');
  const previous = process.env.VIDEO_PROVIDER;
  process.env.VIDEO_PROVIDER = 'zoom';
  try {
    assert.throws(
      () => createApp({ db: fakeDb(), auth: { config: AUTH_CONFIG, store: createMemoryAuthStore({ users: USERS }), oidc: {} } }),
      /VIDEO_PROVIDER must be one of/
    );
  } finally {
    if (previous === undefined) delete process.env.VIDEO_PROVIDER;
    else process.env.VIDEO_PROVIDER = previous;
  }
});

test('without VIDEO_PROVIDER the route answers 503 and is audited', async () => {
  await withApi({ env: { VIDEO_PROVIDER: '' } }, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, 'video_not_configured');
    assert.deepEqual(summary(api.entries('meeting')), [['meeting.create', 'failure', 'not_configured', 'a1', 'u-pro1']]);
  });
});

// Refusals. None of them may reach Google.
const REFUSALS = [
  { name: 'the professional of another appointment of the center', as: 'u-pro1b', id: 'a1', status: 404, action: 'meeting.create', reason: 'not_participant' },
  { name: 'a professional of another center', as: 'u-pro2', id: 'a1', status: 404, action: 'meeting.create', reason: 'other_center' },
  { name: 'a missing appointment', as: 'u-pro1', id: 'nope', status: 404, action: 'meeting.create', reason: 'not_found' },
  { name: 'an appointment of another center', as: 'u-pro1', id: 'a3', status: 404, action: 'meeting.create', reason: 'other_center' },
  { name: 'the client of the appointment (reads, cannot act)', as: 'u-cli1', id: 'a1', status: 403, action: 'appointment.update', reason: 'role_not_allowed' },
  { name: 'another client', as: 'u-cli1b', id: 'a1', status: 403, action: 'appointment.update', reason: 'role_not_allowed' },
  { name: 'the administrator of the center (reads, not a participant)', as: 'u-adm1', id: 'a1', status: 403, action: 'meeting.create', reason: 'action_not_allowed' },
  { name: 'an administrator without a center', as: 'u-adm0', id: 'a1', status: 404, action: 'meeting.create', reason: 'no_center' },
  { name: 'an auditor', as: 'u-aud1', id: 'a1', status: 403, action: 'appointment.update', reason: 'role_not_allowed' },
];

for (const refusal of REFUSALS) {
  test(`refused: ${refusal.name}`, async () => {
    await withApi({}, async (api) => {
      const res = await api.call('POST', `/appointments/${refusal.id}/meeting`, { as: refusal.as, body: {} });
      assert.equal(res.status, refusal.status);
      assert.equal(res.json.url, undefined);
      assert.equal(res.json.provider, undefined);
      const denied = api.auditStore.entries.filter((entry) => entry.outcome === 'denied');
      assert.equal(denied.length, 1);
      assert.equal(denied[0].action, refusal.action);
      assert.equal(denied[0].reason, refusal.reason);
      assert.equal(denied[0].actorId, refusal.as);
      assert.equal(api.entries('meeting.create_').length, 0);
      assert.equal(api.google.requests.length, 0);
    });
  });
}

test('every 404 has the same body, whatever the reason', async () => {
  await withApi({}, async (api) => {
    const bodies = new Set();
    for (const [as, id] of [['u-pro1b', 'a1'], ['u-pro2', 'a1'], ['u-pro1', 'nope'], ['u-pro1', 'a3']]) {
      const res = await api.call('POST', `/appointments/${id}/meeting`, { as, body: {} });
      assert.equal(res.status, 404);
      bodies.add(res.text);
    }
    assert.equal(bodies.size, 1);
  });
});

test('an id that is too long is refused as not found', async () => {
  await withApi({}, async (api) => {
    const res = await api.call('POST', `/appointments/${'x'.repeat(65)}/meeting`, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 404);
    assert.equal(api.entries('meeting.create')[0].reason, 'invalid_id');
  });
});

test('no session gets 401, a body that is not JSON gets 415, and neither reaches Google', async () => {
  await withApi({}, async (api) => {
    assert.equal((await api.call('POST', MEETING, { body: {} })).status, 401);
    const wrongType = await api.call('POST', MEETING, { as: 'u-pro1', raw: '{}', contentType: 'text/plain' });
    assert.equal(wrongType.status, 415);
    assert.equal(api.google.requests.length, 0);
    assert.equal(api.entries('meeting').length, 0);
  });
});

test('other methods and a body that picks the provider are refused', async () => {
  await withApi({ env: { VIDEO_PROVIDER: 'jitsi' } }, async (api) => {
    const picked = await api.call('POST', MEETING, { as: 'u-pro1', body: { provider: 'meet' } });
    assert.equal(picked.status, 400);
    assert.equal(picked.json.error.code, 'invalid_request');
    assert.equal(api.entries('meeting.create_').length, 0);
    // The gate has no rule for DELETE on this path.
    assert.equal((await api.call('DELETE', MEETING, { as: 'u-pro1' })).status, 403);
  });
});

test('a request with an empty JSON body works', async () => {
  await withApi({ env: { VIDEO_PROVIDER: 'jitsi' } }, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', raw: '', contentType: 'application/json' });
    assert.equal(res.status, 201);
  });
});

test('the credential appears in no response, log line, or audit entry', async () => {
  await withApi({ env: { JITSI_APP_ID: 'app-1', JITSI_JWT_SECRET: 'JITSI-SECRET-MARKER-XYZ' } }, async (api) => {
    const secrets = [
      api.account.privateKeyBody,
      api.account.privateKeyId,
      api.account.email,
      api.account.credentialJson(api.google.issuer),
      'JITSI-SECRET-MARKER-XYZ',
    ];
    // Success, every failure mode, and refusals, with all output collected.
    const outputs = [];
    for (const mode of ['ok', ...Object.keys(FAILURES)]) {
      api.google.mode = mode;
      api.meetingStore.deleteForAppointment('a1');
      const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
      outputs.push(res.text, JSON.stringify([...res.headers]));
    }
    for (const as of ['u-pro1b', 'u-cli1', 'u-adm1', 'u-pro2']) {
      const res = await api.call('POST', MEETING, { as, body: {} });
      outputs.push(res.text, JSON.stringify([...res.headers]));
    }
    outputs.push((await api.call('POST', MEETING, { as: 'u-pro1', body: { x: 1 } })).text);
    outputs.push(api.logger.lines.join('\n'));
    outputs.push(JSON.stringify(api.auditStore.entries));
    outputs.push(JSON.stringify(api.config), String(api.config.meet.credential && Object.keys(api.config.meet)));

    const everything = outputs.join('\n');
    assert.ok(everything.length > 0);
    for (const secret of secrets) {
      assert.ok(!everything.includes(secret), `leaked: ${secret.slice(0, 16)}`);
    }
    // The key body can appear in other encodings. Check its first line and its URL-encoded form too.
    const head = api.account.privateKeyBody.slice(0, 40);
    assert.ok(!everything.includes(head));
    assert.ok(!everything.includes(encodeURIComponent(head)));
    assert.ok(!everything.includes(Buffer.from(head).toString('base64')));
  });
});

test('the meeting URL is only in the response of the caller, never in the audit log or the log', async () => {
  await withApi({}, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    const code = res.json.url.split('/').pop();
    assert.ok(!JSON.stringify(api.auditStore.entries).includes(code));
    assert.ok(!api.logger.lines.join('\n').includes(code));
  });
});

test('if the failover audit write fails, no Jitsi meeting is created', async () => {
  await withApi({ googleMode: 'http_500' }, async (api) => {
    const original = api.auditStore.insert;
    api.auditStore.insert = async (entry) => {
      if (entry.action === 'meeting.failover') throw new Error('audit store down');
      return original(entry);
    };
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 500);
    assert.equal(res.json.error.code, 'internal_error');
    assert.equal(api.entries('meeting.create_').length, 0);
  });
});
