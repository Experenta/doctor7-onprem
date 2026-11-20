'use strict';

// Tests of the demo-only Meet outage switch (K-36), with the real simulator in process.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startVideoApi, DEMO_SECRET } = require('../video/harness');
const { loadDemoConfig } = require('./config');
const { createMeetControl, DemoControlError } = require('./control');

const SWITCH = '/demo/meet-outage';
const MEETING = '/appointments/a1/meeting';

async function withApi(options, fn) {
  const api = await startVideoApi(options);
  try {
    await fn(api);
  } finally {
    await api.close();
  }
}

const controlCalls = (api) => api.google.requests.filter((entry) => entry.path === '/control/mode');
const summary = (entries) => entries.map((entry) => [entry.action, entry.outcome, entry.reason, entry.actorId]);

// ---- Configuration ----

test('config: DEMO_MODE unset, empty, or 0 means off, whatever else is set', () => {
  const rest = { DEMO_MEET_CONTROL_URL: 'http://127.0.0.1:4020', DEMO_MEET_CONTROL_SECRET: DEMO_SECRET };
  assert.equal(loadDemoConfig({}), null);
  assert.equal(loadDemoConfig({ ...rest }), null);
  assert.equal(loadDemoConfig({ ...rest, DEMO_MODE: '' }), null);
  assert.equal(loadDemoConfig({ ...rest, DEMO_MODE: '0' }), null);
});

test('config: any other DEMO_MODE value stops startup, without quoting it', () => {
  for (const value of ['true', 'yes', '2', ' 1', '1 ']) {
    assert.throws(() => loadDemoConfig({ DEMO_MODE: value }), (err) => /DEMO_MODE must be 1/.test(err.message) && !err.message.includes(`"${value}"`));
  }
});

test('config: with DEMO_MODE=1 the control URL and the secret are required and checked', () => {
  const ok = { DEMO_MODE: '1', DEMO_MEET_CONTROL_URL: 'http://127.0.0.1:4020', DEMO_MEET_CONTROL_SECRET: DEMO_SECRET };
  const config = loadDemoConfig(ok);
  assert.equal(config.controlUrl, 'http://127.0.0.1:4020');
  assert.equal(config.controlSecret, DEMO_SECRET);

  assert.throws(() => loadDemoConfig({ ...ok, DEMO_MEET_CONTROL_URL: undefined }), /DEMO_MEET_CONTROL_URL is required/);
  assert.throws(() => loadDemoConfig({ ...ok, DEMO_MEET_CONTROL_SECRET: undefined }), /DEMO_MEET_CONTROL_SECRET is required/);
  for (const url of [
    'https://127.0.0.1:4020',
    'http://example.test:4020',
    'http://10.0.0.5:4020',
    'http://127.0.0.1:4020/control',
    'http://user:pw@127.0.0.1:4020',
    'http://127.0.0.1:4020/?a=1',
    'not a url',
  ]) {
    assert.throws(() => loadDemoConfig({ ...ok, DEMO_MEET_CONTROL_URL: url }), /DEMO_MEET_CONTROL_URL/, url);
  }
  for (const secret of ['short', 'x'.repeat(31), 'abcdefgh ijklmnopqrstuvwxyz0123456789 spaces', 'x'.repeat(257)]) {
    assert.throws(
      () => loadDemoConfig({ ...ok, DEMO_MEET_CONTROL_SECRET: secret }),
      (err) => /DEMO_MEET_CONTROL_SECRET must be/.test(err.message) && !err.message.includes('abcdefgh') && !err.message.includes('short'),
      secret.slice(0, 8)
    );
  }
});

test('config: the secret is not enumerable, so printing the config does not show it', () => {
  const config = loadDemoConfig({ DEMO_MODE: '1', DEMO_MEET_CONTROL_URL: 'http://localhost:4020', DEMO_MEET_CONTROL_SECRET: DEMO_SECRET });
  assert.ok(!JSON.stringify(config).includes(DEMO_SECRET));
  assert.ok(!Object.keys(config).includes('controlSecret'));
});

test('createApp: DEMO_MODE=1 in the environment without the control settings stops startup', () => {
  const { createApp } = require('../app');
  const { fakeDb } = require('../../test/helpers');
  const { createMemoryAuthStore } = require('../auth/memoryStore');
  const { USERS, AUTH_CONFIG } = require('../audit/harness');
  const previous = { ...process.env };
  process.env.DEMO_MODE = '1';
  delete process.env.DEMO_MEET_CONTROL_URL;
  delete process.env.DEMO_MEET_CONTROL_SECRET;
  try {
    assert.throws(
      () => createApp({ db: fakeDb(), auth: { config: AUTH_CONFIG, store: createMemoryAuthStore({ users: USERS }), oidc: {} } }),
      /DEMO_MEET_CONTROL_URL is required/
    );
  } finally {
    for (const name of ['DEMO_MODE', 'DEMO_MEET_CONTROL_URL', 'DEMO_MEET_CONTROL_SECRET']) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

// ---- Without DEMO_MODE the switch does not exist ----

test('without DEMO_MODE the route does not exist, for every role and without a session', async () => {
  await withApi({ demo: 'off' }, async (api) => {
    for (const as of ['u-adm1', 'u-pro1', 'u-cli1', 'u-aud1', null]) {
      for (const [method, body] of [['GET'], ['POST', { meetOutage: true }]]) {
        const res = await api.call(method, SWITCH, { as, body });
        // The gate has no rule for the path, so it answers like it does for any unknown path.
        const unknown = await api.call(method, '/demo/other-path', { as, body });
        assert.equal(res.status, unknown.status, `${as} ${method}`);
        assert.equal(res.status, 403);
        assert.deepEqual(res.json, unknown.json);
      }
    }
    // The simulator was never reached, and it still runs in its normal mode.
    assert.equal(api.google.requests.length, 0);
    assert.equal(api.google.mode, 'ok');
    assert.equal(api.entries('demo').length, 0);
    assert.ok(api.entries('request.denied').every((entry) => entry.reason === 'no_rule'));
  });
});

test('without DEMO_MODE, creating a meeting never touches the control endpoint', async () => {
  await withApi({ demo: 'off' }, async (api) => {
    const res = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(res.status, 201);
    assert.equal(controlCalls(api).length, 0);
  });
});

// ---- With DEMO_MODE=1 ----

test('only the administrator reads the state, and the others get the usual 404', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    const admin = await api.call('GET', SWITCH, { as: 'u-adm1' });
    assert.equal(admin.status, 200);
    assert.deepEqual(admin.json, { meetOutage: false });
    assert.equal(admin.headers.get('cache-control'), 'no-store');

    for (const as of ['u-pro1', 'u-cli1', 'u-aud1']) {
      const res = await api.call('GET', SWITCH, { as });
      assert.equal(res.status, 404, as);
      assert.equal(res.json.error.code, 'not_found');
    }
    const noCenter = await api.call('GET', SWITCH, { as: 'u-adm0' });
    assert.equal(noCenter.status, 404);
    assert.equal((await api.call('GET', SWITCH)).status, 401);

    assert.deepEqual(summary(api.entries('demo')), [
      ['demo.read', 'denied', 'role_not_allowed', 'u-pro1'],
      ['demo.read', 'denied', 'role_not_allowed', 'u-cli1'],
      ['demo.read', 'denied', 'role_not_allowed', 'u-aud1'],
      ['demo.read', 'denied', 'no_center', 'u-adm0'],
    ]);
    // Only the administrator's read reached the simulator.
    assert.equal(controlCalls(api).length, 1);
  });
});

test('only the administrator changes the switch, and every refusal is audited and changes nothing', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    for (const as of ['u-pro1', 'u-cli1', 'u-aud1']) {
      const res = await api.call('POST', SWITCH, { as, body: { meetOutage: true } });
      assert.equal(res.status, 403, as);
      assert.equal(res.json.error.code, 'forbidden');
    }
    assert.equal((await api.call('POST', SWITCH, { body: { meetOutage: true } })).status, 401);
    const noCenter = await api.call('POST', SWITCH, { as: 'u-adm0', body: { meetOutage: true } });
    assert.equal(noCenter.status, 403);

    assert.deepEqual(summary(api.entries('demo')), [
      ['demo.update', 'denied', 'role_not_allowed', 'u-pro1'],
      ['demo.update', 'denied', 'role_not_allowed', 'u-cli1'],
      ['demo.update', 'denied', 'role_not_allowed', 'u-aud1'],
      ['demo.update', 'denied', 'no_center', 'u-adm0'],
    ]);
    assert.equal(api.google.mode, 'ok');
    assert.equal(controlCalls(api).length, 0);
  });
});

test('the administrator turns the outage on and off, and each change is audited without a body', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    const on = await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: true } });
    assert.equal(on.status, 200);
    assert.deepEqual(on.json, { meetOutage: true });
    assert.equal(api.google.mode, 'http_500');
    assert.deepEqual((await api.call('GET', SWITCH, { as: 'u-adm1' })).json, { meetOutage: true });

    const off = await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: false } });
    assert.deepEqual(off.json, { meetOutage: false });
    assert.equal(api.google.mode, 'ok');
    assert.deepEqual((await api.call('GET', SWITCH, { as: 'u-adm1' })).json, { meetOutage: false });

    const entries = api.entries('demo');
    assert.deepEqual(summary(entries), [
      ['demo.meet_outage_on', 'success', null, 'u-adm1'],
      ['demo.meet_outage_off', 'success', null, 'u-adm1'],
    ]);
    for (const entry of entries) {
      assert.equal(entry.centerId, 'c1');
      assert.equal(entry.targetType, 'demo');
      assert.equal(entry.targetId, null);
    }
    const everything = JSON.stringify([entries, api.logger.lines]);
    assert.ok(!everything.includes(DEMO_SECRET));
    assert.ok(!everything.includes('meetOutage'));
  });
});

test('setting the same state twice is allowed and audited each time', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: true } });
    const again = await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: true } });
    assert.deepEqual(again.json, { meetOutage: true });
    assert.equal(api.entries('demo.meet_outage_on').length, 2);
  });
});

test('the input is validated: one boolean, JSON only, no query', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    const bad = [
      {},
      { meetOutage: 'true' },
      { meetOutage: 1 },
      { meetOutage: null },
      { meetOutage: true, extra: 1 },
      { mode: 'http_500' },
      [true],
    ];
    for (const body of bad) {
      const res = await api.call('POST', SWITCH, { as: 'u-adm1', body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error.code, 'invalid_request');
    }
    const empty = await api.call('POST', SWITCH, { as: 'u-adm1', raw: '' });
    assert.equal(empty.status, 400);
    assert.equal((await api.call('POST', `${SWITCH}?mode=ok`, { as: 'u-adm1', body: { meetOutage: true } })).status, 400);
    const text = await api.call('POST', SWITCH, { as: 'u-adm1', raw: '{"meetOutage":true}', contentType: 'text/plain' });
    assert.equal(text.status, 415);
    const noType = await api.call('POST', SWITCH, { as: 'u-adm1', raw: '{"meetOutage":true}', contentType: null });
    assert.equal(noType.status, 415);
    assert.equal(api.google.mode, 'ok');
    assert.equal(controlCalls(api).length, 0);
  });
});

test('a request from another origin is refused before anything changes', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    const res = await api.call('POST', SWITCH, {
      as: 'u-adm1',
      body: { meetOutage: true },
      headers: { Origin: 'https://evil.example.test' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'csrf_rejected');
    assert.equal(api.google.mode, 'ok');
    assert.equal(api.entries('demo').length, 0);
  });
});

test('the switch is rate limited like the other state-changing routes', async () => {
  const security = {
    allowedOrigins: [],
    jitsiOrigin: null,
    loginLimit: { windowMs: 60000, limit: 1000 },
    writeLimit: { windowMs: 60000, limit: 2 },
  };
  await withApi({ demo: 'on', security }, async (api) => {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: i % 2 === 0 } })).status);
    }
    assert.deepEqual(statuses, [200, 200, 429, 429]);
  });
});

test('the simulator needs the shared secret: a wrong one is refused, audited as a failure, and changes nothing', async () => {
  const wrongSecret = (input, init) =>
    fetch(input, { ...init, headers: { ...init.headers, 'x-demo-control-secret': `${DEMO_SECRET}-wrong` } });
  await withApi({ demo: 'on', demoFetch: wrongSecret }, async (api) => {
    const res = await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: true } });
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, 'demo_simulator_unavailable');
    assert.equal(api.google.mode, 'ok');
    assert.deepEqual(summary(api.entries('demo')), [['demo.meet_outage_on', 'failure', 'simulator_unreachable', 'u-adm1']]);
    assert.deepEqual(controlCalls(api).map((entry) => entry.status), [401]);
    assert.ok(!res.text.includes(DEMO_SECRET));
    assert.equal((await api.call('GET', SWITCH, { as: 'u-adm1' })).status, 502);
  });
});

test('the API asks the simulator for the modes ok and http_500 only, with the secret in a header', async () => {
  const seen = [];
  const spy = (input, init) => {
    seen.push({ url: String(input), method: init.method, headers: init.headers, body: init.body });
    return fetch(input, init);
  };
  await withApi({ demo: 'on', demoFetch: spy }, async (api) => {
    await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: true } });
    await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: false } });
    await api.call('GET', SWITCH, { as: 'u-adm1' });
    assert.deepEqual(
      seen.map((call) => [call.method, new URL(call.url).hostname, new URL(call.url).pathname, call.body]),
      [
        ['POST', '127.0.0.1', '/control/mode', '{"mode":"http_500"}'],
        ['POST', '127.0.0.1', '/control/mode', '{"mode":"ok"}'],
        ['GET', '127.0.0.1', '/control/mode', undefined],
      ]
    );
    assert.ok(seen.every((call) => call.headers['x-demo-control-secret'] === DEMO_SECRET));
    assert.ok(seen.every((call) => !call.url.includes(DEMO_SECRET)));
  });
});

test('when the simulator is down the switch answers 502 and audits the failure', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    await api.google.close();
    const read = await api.call('GET', SWITCH, { as: 'u-adm1' });
    assert.equal(read.status, 502);
    const write = await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: false } });
    assert.equal(write.status, 502);
    assert.equal(write.json.error.code, 'demo_simulator_unavailable');
    assert.deepEqual(summary(api.entries('demo')), [['demo.meet_outage_off', 'failure', 'simulator_unreachable', 'u-adm1']]);
  });
});

test('the control client turns every failure into one fixed error', async () => {
  const config = loadDemoConfig({ DEMO_MODE: '1', DEMO_MEET_CONTROL_URL: 'http://127.0.0.1:4020', DEMO_MEET_CONTROL_SECRET: DEMO_SECRET });
  const answers = [
    () => Promise.reject(new Error(`boom ${DEMO_SECRET}`)),
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => ({ ok: true, status: 200, json: async () => ({ mode: 7 }) }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
  ];
  for (const fetchImpl of answers) {
    await assert.rejects(createMeetControl({ config, fetchImpl }).getOutage(), (err) => err instanceof DemoControlError && !err.message.includes(DEMO_SECRET));
  }
  const quota = createMeetControl({ config, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ mode: 'quota' }) }) });
  assert.equal(await quota.getOutage(), true, 'any mode but ok counts as an outage');
});

// ---- The whole flow ----

test('flow: outage on, the meeting is created in Jitsi with fallback; outage off, it is created in Meet', async () => {
  await withApi({ demo: 'on' }, async (api) => {
    await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: true } });

    const failed = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(failed.status, 201);
    assert.equal(failed.json.provider, 'jitsi');
    assert.equal(failed.json.fallback, true);
    assert.deepEqual(summary(api.entries('meeting')), [
      ['meeting.failover', 'failure', 'meet_error', 'u-pro1'],
      ['meeting.create_jitsi', 'success', null, 'u-pro1'],
    ]);

    // The client reads the stored meeting with the same flag.
    const read = await api.call('GET', MEETING, { as: 'u-cli1' });
    assert.deepEqual(read.json, failed.json);
    const again = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(again.status, 200);
    assert.equal(again.json.fallback, true);

    // A stored meeting is not moved. The next new meeting tries Meet again.
    api.meetingStore.deleteForAppointment('a1');
    await api.call('POST', SWITCH, { as: 'u-adm1', body: { meetOutage: false } });
    const restored = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(restored.status, 201);
    assert.equal(restored.json.provider, 'meet');
    assert.equal(restored.json.fallback, false);
    assert.equal(restored.json.simulated, true, 'in the demo a Meet meeting is marked as simulated');
    assert.equal(failed.json.simulated, false, 'a Jitsi meeting is never marked as simulated');
    assert.match(restored.json.url, /^https:\/\/meet\.google\.com\//);
    assert.equal(api.entries('meeting.failover').length, 1);
  });
});

test('fallback is false when the server is set to Jitsi, and true after a failure without the switch', async () => {
  await withApi({ env: { VIDEO_PROVIDER: 'jitsi' } }, async (api) => {
    const created = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(created.json.provider, 'jitsi');
    assert.equal(created.json.fallback, false);
    assert.equal((await api.call('GET', MEETING, { as: 'u-cli1' })).json.fallback, false);
  });
  await withApi({ googleMode: 'http_500' }, async (api) => {
    const created = await api.call('POST', MEETING, { as: 'u-pro1', body: {} });
    assert.equal(created.json.fallback, true);
  });
  await withApi({ env: { VIDEO_PROVIDER: '' } }, async (api) => {
    await api.meetingStore.insertMeeting({ appointmentId: 'a1', provider: 'jitsi', url: 'https://jitsi.example.test/doctor7abc', createdBy: 'u-pro1', createdAt: new Date() });
    assert.equal((await api.call('GET', MEETING, { as: 'u-cli1' })).json.fallback, false);
  });
});
