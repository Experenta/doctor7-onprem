'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createMockIdp, configFromEnv, parsePublicUrl, DEMO_RATE_LIMIT } = require('./server');
const { DEMO_USERS, PARTICIPANTS } = require('../../seed/lib/generator');

const PUBLIC = 'https://demo.example.test/idp';
const CALLBACK = 'https://demo.example.test/api/auth/callback';
const CLIENT_ID = 'doctor7-demo';

const verifier = () => crypto.randomBytes(32).toString('base64url');
const challenge = (value) => crypto.createHash('sha256').update(value, 'ascii').digest('base64url');

function authorizeParams(overrides = {}, codeVerifier = verifier()) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    scope: 'openid email profile',
    state: 'state-value-123',
    nonce: 'nonce-value-123',
    code_challenge: challenge(codeVerifier),
    code_challenge_method: 'S256',
    ...overrides,
  });
}

async function withIdp(options, fn) {
  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [CALLBACK], ...options }).start();
  try {
    await fn(idp);
  } finally {
    await idp.close();
  }
}

const ROLE_LABEL_FOR_SEED = { professional: 'Professional', client: 'Client', admin: 'Administrator', auditor: 'Auditor' };

test('without MOCK_IDP_PUBLIC_URL the issuer and the endpoints stay on the loopback origin', async () => {
  await withIdp({}, async (idp) => {
    assert.match(idp.localUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(idp.issuer, idp.localUrl);
    const doc = await (await fetch(`${idp.localUrl}/.well-known/openid-configuration`)).json();
    assert.equal(doc.issuer, idp.localUrl);
    assert.equal(doc.authorization_endpoint, `${idp.localUrl}/authorize`);
    assert.equal(doc.token_endpoint, `${idp.localUrl}/token`);
    assert.equal(doc.jwks_uri, `${idp.localUrl}/jwks.json`);
    // Without a public URL there is no prefix to remove.
    assert.equal((await fetch(`${idp.localUrl}/idp/.well-known/openid-configuration`)).status, 404);
  });
});

test('with MOCK_IDP_PUBLIC_URL the discovery document uses the public issuer', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    assert.equal(idp.issuer, PUBLIC);
    const doc = await (await fetch(`${idp.localUrl}/.well-known/openid-configuration`)).json();
    assert.equal(doc.issuer, PUBLIC);
    assert.equal(doc.authorization_endpoint, `${PUBLIC}/authorize`);
    assert.equal(doc.token_endpoint, `${PUBLIC}/token`);
    assert.equal(doc.jwks_uri, `${PUBLIC}/jwks.json`);
  });
});

test('with MOCK_IDP_PUBLIC_URL the ID token iss is the public issuer', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    const codeVerifier = verifier();
    const body = authorizeParams({}, codeVerifier);
    body.set('user', 'mock-ana');
    const signIn = await fetch(`${idp.localUrl}/authorize`, { method: 'POST', body, redirect: 'manual' });
    const code = new URL(signIn.headers.get('location')).searchParams.get('code');
    const res = await fetch(`${idp.localUrl}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CALLBACK,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
      }),
    });
    const { decodeJwt } = await import('jose');
    const claims = decodeJwt((await res.json()).id_token);
    assert.equal(claims.iss, PUBLIC);
    assert.equal(claims.aud, CLIENT_ID);
  });
});

test('the provider answers the paths with and without the public prefix', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    for (const path of ['/.well-known/openid-configuration', '/idp/.well-known/openid-configuration']) {
      assert.equal((await fetch(`${idp.localUrl}${path}`)).status, 200, path);
    }
    for (const path of ['/jwks.json', '/idp/jwks.json']) {
      assert.equal((await fetch(`${idp.localUrl}${path}`)).status, 200, path);
    }
    const query = authorizeParams().toString();
    for (const path of ['/authorize', '/idp/authorize']) {
      assert.equal((await fetch(`${idp.localUrl}${path}?${query}`)).status, 200, path);
    }
    // The prefix is removed only as a whole segment.
    assert.equal((await fetch(`${idp.localUrl}/idpx/jwks.json`)).status, 404);
  });
});

test('the provider listens on loopback only, in both modes', async () => {
  await withIdp({}, async (idp) => assert.equal(new URL(idp.localUrl).hostname, '127.0.0.1'));
  await withIdp({ publicUrl: PUBLIC }, async (idp) => assert.equal(new URL(idp.localUrl).hostname, '127.0.0.1'));
});

test('parsePublicUrl accepts an https issuer with or without a path, and checks the rest', () => {
  assert.deepEqual(parsePublicUrl(PUBLIC), { issuer: PUBLIC, prefix: '/idp' });
  assert.deepEqual(parsePublicUrl('https://demo.example.test'), { issuer: 'https://demo.example.test', prefix: '' });
  assert.deepEqual(parsePublicUrl('http://localhost:4010/idp'), { issuer: 'http://localhost:4010/idp', prefix: '/idp' });
  for (const bad of [
    'not a url',
    'http://demo.example.test/idp',
    `${PUBLIC}/`,
    `${PUBLIC}?x=1`,
    `${PUBLIC}#x`,
    'https://user:secret@demo.example.test/idp',
  ]) {
    assert.throws(() => parsePublicUrl(bad), /MOCK_IDP_PUBLIC_URL/, bad);
  }
});

test('a bad MOCK_IDP_PUBLIC_URL stops the provider before it starts', () => {
  assert.throws(() => createMockIdp({ publicUrl: 'http://demo.example.test/idp' }), /must use https/);
});

test('configFromEnv maps the demo variables, including the callback of the demo', () => {
  const env = {
    MOCK_IDP_PUBLIC_URL: PUBLIC,
    MOCK_IDP_REDIRECT_URIS: `${CALLBACK}, http://127.0.0.1:3000/auth/callback`,
    MOCK_IDP_CLIENT_ID: CLIENT_ID,
  };
  const { port, options } = configFromEnv(env);
  assert.equal(port, 4010);
  assert.equal(options.publicUrl, PUBLIC);
  assert.deepEqual(options.redirectUris, [CALLBACK, 'http://127.0.0.1:3000/auth/callback']);
  assert.equal(options.clientId, CLIENT_ID);
  assert.deepEqual(options.rateLimit, DEMO_RATE_LIMIT);
  assert.equal(options.trustForwardedFor, true);
});

test('configFromEnv without the public URL keeps the development defaults', () => {
  const { port, options } = configFromEnv({});
  assert.equal(port, 4010);
  assert.equal(options.publicUrl, undefined);
  assert.equal(options.rateLimit, undefined);
  assert.equal(options.trustForwardedFor, undefined);
  assert.equal(options.clientId, 'doctor7-local');
  assert.deepEqual(options.redirectUris, ['http://127.0.0.1:3000/auth/callback']);
  assert.equal(configFromEnv({ MOCK_IDP_PORT: '4555' }).port, 4555);
  assert.throws(() => configFromEnv({ MOCK_IDP_PORT: 'abc' }), /MOCK_IDP_PORT/);
});

test('the login page lists the four demo accounts with their roles, in English', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    const html = await (await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`)).text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /synthetic demonstration accounts/);
    assert.match(html, /Their data is invented\./);
    assert.doesNotMatch(html, /resets regularly/);
    assert.doesNotMatch(html, /reset/i);
    for (const seedUser of DEMO_USERS) {
      const label = ROLE_LABEL_FOR_SEED[seedUser.role];
      assert.ok(html.includes(seedUser.displayName), `${seedUser.email} name`);
      assert.ok(html.includes(seedUser.email), `${seedUser.email} email`);
      assert.match(html, new RegExp(`<span class="role">${label}</span>`), `${seedUser.email} role`);
      assert.ok(html.includes(`value="mock-${seedUser.id.slice(2)}"`), `${seedUser.email} button`);
    }
  });
});

test('the login page shows the two refused accounts as No access and no seed participant', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    const html = await (await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`)).text();
    assert.match(html, /<span class="role role-none">No access<\/span>\s*<span>no\.role@example\.test<\/span>/);
    assert.match(html, /<span class="role role-none">No access<\/span>\s*<span>pending@example\.test<\/span>/);
    for (const participant of PARTICIPANTS) {
      assert.ok(!html.includes(participant.email), `${participant.email} must not be listed`);
    }
    assert.equal((html.match(/<button type="submit" name="user"/g) || []).length, 6);
  });
});

test('the login page posts to the public issuer, not to a relative path', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    const html = await (await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`)).text();
    assert.ok(html.includes(`<form method="post" action="${PUBLIC}/authorize">`));
  });
});

test('the login page escapes every value it prints', async () => {
  const users = [
    { sub: 'mock-x', name: '<img src=x onerror=alert(1)>', email: 'a&b"c@example.test', emailVerified: true },
    { sub: 'constructor', name: 'Plain', email: 'plain@example.test', emailVerified: true },
  ];
  await withIdp({ users }, async (idp) => {
    const html = await (await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`)).text();
    assert.ok(!html.includes('<img src=x'), 'name is not escaped');
    assert.ok(html.includes('&#60;img src=x onerror=alert(1)&#62;'));
    assert.ok(!html.includes('a&b"c@example.test'), 'email is not escaped');
    assert.ok(html.includes('a&#38;b&#34;c@example.test'));
    // Both accounts have no role entry, so both are labelled No access.
    assert.equal((html.match(/<span class="role role-none">No access<\/span>/g) || []).length, 2);
  });
});

test('limits: the login page answers 429 with Retry-After after the limit', async () => {
  await withIdp(
    { publicUrl: PUBLIC, trustForwardedFor: true, rateLimit: { windowMs: 60000, loginPageMax: 2, tokenMax: 1 } },
    async (idp) => {
      const get = (address) =>
        fetch(`${idp.localUrl}/authorize?${authorizeParams()}`, {
          headers: { 'X-Forwarded-For': address },
        });
      assert.equal((await get('198.51.100.7')).status, 200);
      assert.equal((await get('198.51.100.7')).status, 200);
      const refused = await get('198.51.100.7');
      assert.equal(refused.status, 429);
      const retry = Number(refused.headers.get('retry-after'));
      assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 60, 'Retry-After is set');
      assert.equal((await get('198.51.100.8')).status, 200, 'another address has its own count');
    }
  );
});

test('limits: the token endpoint answers 429 with a JSON error after the limit', async () => {
  await withIdp({ rateLimit: { windowMs: 60000, loginPageMax: 5, tokenMax: 1 } }, async (idp) => {
    const post = () => fetch(`${idp.localUrl}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'x' }) });
    assert.equal((await post()).status, 400);
    const refused = await post();
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: 'rate_limited' });
    assert.ok(refused.headers.get('retry-after'));
  });
});

test('limits: X-Forwarded-For is ignored unless the provider trusts the proxy', async () => {
  await withIdp({ rateLimit: { windowMs: 60000, loginPageMax: 1, tokenMax: 1 } }, async (idp) => {
    const get = (address) =>
      fetch(`${idp.localUrl}/authorize?${authorizeParams()}`, { headers: { 'X-Forwarded-For': address } });
    assert.equal((await get('198.51.100.7')).status, 200);
    assert.equal((await get('198.51.100.8')).status, 429, 'the socket address is counted, not the header');
  });
});

test('limits are off when no rate limit is configured', async () => {
  await withIdp({}, async (idp) => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`)).status, 200);
    }
  });
});


// A sentence claims a scheduled reset when it names a reset and a schedule word.
const RESET_WORD = /\breset|\brestor|\bwipe|\bcleared\b/i;
const SCHEDULE_WORD = /regular|schedul|\bevery\b|daily|hourly|weekly|periodic|automatic|nightly|\beach (day|hour|week)/i;

function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function scheduledResetClaims(text) {
  return sentences(text).filter((sentence) => RESET_WORD.test(sentence) && SCHEDULE_WORD.test(sentence));
}

test('neither the login page nor DEMO.md says that the data is reset on a schedule', async () => {
  await withIdp({ publicUrl: PUBLIC }, async (idp) => {
    const html = await (await fetch(`${idp.localUrl}/authorize?${authorizeParams()}`)).text();
    const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
    assert.deepEqual(scheduledResetClaims(visible), []);
  });
  const demo = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DEMO.md'), 'utf8');
  assert.deepEqual(scheduledResetClaims(demo), []);
});
