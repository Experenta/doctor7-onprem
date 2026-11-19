'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMockGoogle, MODES, SPACE_SCOPE } = require('./server');
const { createTestServiceAccount } = require('./testing');

const account = createTestServiceAccount();

async function withGoogle(fn, options = {}) {
  const google = await createMockGoogle({
    publicKeyPem: account.publicKeyPem,
    serviceAccountEmail: account.email,
    delegatedUsers: [account.delegatedUser],
    ...options,
  }).start();
  try {
    await fn(google);
  } finally {
    await google.close();
  }
}

function assertion(google, overrides = {}, privateKeyPem = account.privateKeyPem) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.email,
    sub: account.delegatedUser,
    scope: SPACE_SCOPE,
    aud: `${google.issuer}/token`,
    iat,
    exp: iat + 300,
    ...overrides,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), privateKeyPem).toString('base64url');
  return `${input}.${signature}`;
}

function tokenRequest(google, jwt, grant = 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
  return fetch(`${google.issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: grant, assertion: jwt }),
  });
}

async function accessToken(google) {
  const res = await tokenRequest(google, assertion(google));
  assert.equal(res.status, 200);
  return (await res.json()).access_token;
}

function spaceRequest(google, token) {
  return fetch(`${google.issuer}/v2/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: '{}',
  });
}

test('a valid assertion gets a token, and the token creates a space', async () => {
  await withGoogle(async (google) => {
    const token = await accessToken(google);
    const res = await spaceRequest(google, token);
    assert.equal(res.status, 200);
    const space = await res.json();
    assert.match(space.name, /^spaces\//);
    assert.match(space.meetingUri, /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    assert.deepEqual(
      google.requests.map((entry) => `${entry.method} ${entry.path} ${entry.status}`),
      ['POST /token 200', 'POST /v2/spaces 200']
    );
  });
});

test('the token endpoint rejects a bad signature, issuer, user, scope, audience, expiry, and grant type', async () => {
  await withGoogle(async (google) => {
    const other = createTestServiceAccount();
    const cases = {
      'signed by another key': assertion(google, {}, other.privateKeyPem),
      'wrong issuer': assertion(google, { iss: 'someone@example.test' }),
      'user without delegation': assertion(google, { sub: 'stranger@example.test' }),
      'wrong scope': assertion(google, { scope: 'https://example.test/other' }),
      'wrong audience': assertion(google, { aud: 'https://example.test/token' }),
      expired: assertion(google, { exp: Math.floor(Date.now() / 1000) - 10 }),
      'not a jwt': 'abc',
    };
    for (const [name, jwt] of Object.entries(cases)) {
      const res = await tokenRequest(google, jwt);
      assert.equal(res.status, 400, name);
      assert.equal((await res.json()).error, 'invalid_grant', name);
    }
    const grant = await tokenRequest(google, assertion(google), 'authorization_code');
    assert.equal(grant.status, 400);
  });
});

test('the space endpoint refuses a missing or unknown token', async () => {
  await withGoogle(async (google) => {
    assert.equal((await spaceRequest(google, null)).status, 401);
    assert.equal((await spaceRequest(google, 'not-a-token')).status, 401);
  });
});

test('failure modes answer as documented', async () => {
  await withGoogle(async (google) => {
    const expected = { http_400: 400, http_500: 500, quota: 429 };
    for (const [mode, status] of Object.entries(expected)) {
      google.mode = mode;
      const res = await spaceRequest(google, await accessToken(google));
      assert.equal(res.status, status, mode);
    }
    google.mode = 'quota';
    assert.equal((await (await spaceRequest(google, await accessToken(google))).json()).error.status, 'RESOURCE_EXHAUSTED');

    google.mode = 'no_uri';
    const noUri = await (await spaceRequest(google, await accessToken(google))).json();
    assert.equal(noUri.meetingUri, undefined);

    google.mode = 'delegation_denied';
    const denied = await tokenRequest(google, assertion(google));
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error, 'unauthorized_client');
  });
});

test('hang mode never answers the space request', async () => {
  await withGoogle(async (google) => {
    const token = await accessToken(google);
    google.mode = 'hang';
    await assert.rejects(
      fetch(`${google.issuer}/v2/spaces`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: '{}',
        signal: AbortSignal.timeout(200),
      }),
      { name: 'TimeoutError' }
    );
    assert.equal(google.requests.at(-1).status, 0);
  });
});

test('the mock records no bodies and no tokens', async () => {
  await withGoogle(async (google) => {
    const jwt = assertion(google);
    const res = await tokenRequest(google, jwt);
    const { access_token: token } = await res.json();
    const recorded = JSON.stringify(google.requests);
    assert.ok(!recorded.includes(jwt));
    assert.ok(!recorded.includes(token));
    assert.deepEqual(Object.keys(google.requests[0]).sort(), ['method', 'path', 'status']);
  });
});

test('every documented mode is covered by these tests', () => {
  assert.deepEqual([...MODES].sort(), ['delegation_denied', 'hang', 'http_400', 'http_500', 'no_uri', 'ok', 'quota']);
});

test('createMockGoogle requires a public key', () => {
  assert.throws(() => createMockGoogle({}), TypeError);
});


// ---- Demo control (K-36) ----

const SECRET = 'test-only-control-secret-0123456789abcdef';

function control(google, { method = 'POST', secret = SECRET, body, headers = {} } = {}) {
  return fetch(`${google.issuer}/control/mode`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(secret === null ? {} : { 'x-demo-control-secret': secret }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('control: without a secret configured the control path does not exist', async () => {
  await withGoogle(async (google) => {
    const res = await control(google, { body: { mode: 'http_500' } });
    assert.equal(res.status, 404);
    assert.equal(google.mode, 'ok');
  });
});

test('control: a secret shorter than 16 characters is refused at construction', () => {
  assert.throws(() => createMockGoogle({ publicKeyPem: account.publicKeyPem, controlSecret: 'short' }), /controlSecret/);
});

test('control: the right secret reads and sets the mode, and the mode drives the space endpoint', async () => {
  await withGoogle(async (google) => {
    const token = await accessToken(google);
    assert.deepEqual(await (await control(google, { method: 'GET' })).json(), { mode: 'ok' });

    const down = await control(google, { body: { mode: 'http_500' } });
    assert.equal(down.status, 200);
    assert.deepEqual(await down.json(), { mode: 'http_500' });
    assert.equal(google.mode, 'http_500');
    assert.equal((await spaceRequest(google, token)).status, 500);

    const up = await control(google, { body: { mode: 'ok' } });
    assert.equal(up.status, 200);
    assert.equal((await spaceRequest(google, token)).status, 200);
  }, { controlSecret: SECRET });
});

test('control: a missing or wrong secret is refused and changes nothing', async () => {
  await withGoogle(async (google) => {
    for (const secret of [null, '', 'wrong', `${SECRET}x`, SECRET.slice(1)]) {
      const res = await control(google, { secret, body: { mode: 'http_500' } });
      assert.equal(res.status, 401, `secret ${JSON.stringify(secret)}`);
    }
    assert.equal((await control(google, { method: 'GET', secret: 'wrong' })).status, 401);
    assert.equal(google.mode, 'ok');
  }, { controlSecret: SECRET });
});

test('control: only the modes ok and http_500 are accepted', async () => {
  await withGoogle(async (google) => {
    for (const mode of MODES.filter((name) => name !== 'ok' && name !== 'http_500')) {
      assert.equal((await control(google, { body: { mode } })).status, 400, mode);
    }
    for (const body of [{}, { mode: 7 }, { mode: null }, { mode: ['ok'] }, []]) {
      assert.equal((await control(google, { body })).status, 400, JSON.stringify(body));
    }
    const bad = await fetch(`${google.issuer}/control/mode`, {
      method: 'POST',
      headers: { 'x-demo-control-secret': SECRET },
      body: 'not json',
    });
    assert.equal(bad.status, 400);
    assert.equal(google.mode, 'ok');
  }, { controlSecret: SECRET });
});

test('control: a request that carries a forwarding header is refused, even with the secret', async () => {
  await withGoogle(async (google) => {
    for (const headers of [{ 'X-Forwarded-For': '203.0.113.9' }, { Forwarded: 'for=203.0.113.9' }]) {
      const res = await control(google, { body: { mode: 'http_500' }, headers });
      assert.equal(res.status, 403);
    }
    assert.equal(google.mode, 'ok');
  }, { controlSecret: SECRET });
});

test('control: other methods are refused, and control requests are recorded without the secret', async () => {
  await withGoogle(async (google) => {
    assert.equal((await control(google, { method: 'DELETE' })).status, 405);
    await control(google, { body: { mode: 'http_500' } });
    const recorded = google.requests.filter((entry) => entry.path === '/control/mode');
    assert.deepEqual(recorded.map((entry) => [entry.method, entry.status]), [['DELETE', 405], ['POST', 200]]);
    assert.ok(!JSON.stringify(google.requests).includes(SECRET));
  }, { controlSecret: SECRET });
});

test('control: the simulator listens on 127.0.0.1 only', () => {
  const source = require('node:fs').readFileSync(require.resolve('./server'), 'utf8');
  assert.match(source, /const HOST = '127\.0\.0\.1';/);
  assert.doesNotMatch(source, /0\.0\.0\.0|'::'/);
});
