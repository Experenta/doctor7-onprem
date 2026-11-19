'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMockIdp } = require('./server');

const REDIRECT_URI = 'http://127.0.0.1:3000/auth/callback';
const CLIENT_ID = 'doctor7-test';

const verifier = () => crypto.randomBytes(32).toString('base64url');
const challenge = (value) => crypto.createHash('sha256').update(value, 'ascii').digest('base64url');

function authorizeParams(overrides = {}, codeVerifier = verifier()) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    state: 'state-value-123',
    nonce: 'nonce-value-123',
    code_challenge: challenge(codeVerifier),
    code_challenge_method: 'S256',
    ...overrides,
  });
}

async function withIdp(options, fn) {
  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI], ...options }).start();
  try {
    await fn(idp);
  } finally {
    await idp.close();
  }
}

// Picks a user on the login page and returns the authorization code.
async function signInAs(idp, sub, params) {
  const body = new URLSearchParams(params);
  body.set('user', sub);
  const res = await fetch(`${idp.issuer}/authorize`, { method: 'POST', body, redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  return { location, code: location.searchParams.get('code') };
}

function tokenRequest(idp, fields) {
  return fetch(`${idp.issuer}/token`, { method: 'POST', body: new URLSearchParams(fields) });
}

test('discovery and JWKS describe the provider and expose no private key', async () => {
  await withIdp({}, async (idp) => {
    const doc = await (await fetch(`${idp.issuer}/.well-known/openid-configuration`)).json();
    assert.equal(doc.issuer, idp.issuer);
    assert.equal(doc.authorization_endpoint, `${idp.issuer}/authorize`);
    assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);

    const jwks = await (await fetch(doc.jwks_uri)).json();
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0].d, undefined);
    assert.equal(jwks.keys[0].alg, 'ES256');
  });
});

test('the login page lists the synthetic users and escapes request values', async () => {
  await withIdp({}, async (idp) => {
    const params = authorizeParams({ state: 'a"><b>x' });
    const res = await fetch(`${idp.issuer}/authorize?${params}`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Ana Rivera/);
    assert.ok(!html.includes('"><b>'), 'request value was not escaped');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  });
});

test('the code flow with PKCE returns a signed ID token for the chosen user', async () => {
  await withIdp({}, async (idp) => {
    const codeVerifier = verifier();
    const params = authorizeParams({}, codeVerifier);
    const { location, code } = await signInAs(idp, 'mock-ana', params);
    assert.equal(location.origin + location.pathname, REDIRECT_URI);
    assert.equal(location.searchParams.get('state'), 'state-value-123');

    const res = await tokenRequest(idp, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    });
    assert.equal(res.status, 200);
    const { id_token: idToken } = await res.json();

    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(`${idp.issuer}/jwks.json`)), {
      issuer: idp.issuer,
      audience: CLIENT_ID,
    });
    assert.equal(payload.sub, 'mock-ana');
    assert.equal(payload.email, 'ana.rivera@example.test');
    assert.equal(payload.email_verified, true);
    assert.equal(payload.nonce, 'nonce-value-123');
  });
});

test('a wrong PKCE verifier is rejected', async () => {
  await withIdp({}, async (idp) => {
    const { code } = await signInAs(idp, 'mock-ana', authorizeParams());
    const res = await tokenRequest(idp, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier(),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_grant');
  });
});

test('an authorization code works only once', async () => {
  await withIdp({}, async (idp) => {
    const codeVerifier = verifier();
    const { code } = await signInAs(idp, 'mock-ana', authorizeParams({}, codeVerifier));
    const fields = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    };
    assert.equal((await tokenRequest(idp, fields)).status, 200);
    assert.equal((await tokenRequest(idp, fields)).status, 400);
  });
});

test('an unregistered redirect_uri is refused without a redirect', async () => {
  await withIdp({}, async (idp) => {
    const params = authorizeParams({ redirect_uri: 'http://127.0.0.1:9/evil' });
    const res = await fetch(`${idp.issuer}/authorize?${params}`, { redirect: 'manual' });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('location'), null);
  });
});

test('a request without PKCE is refused', async () => {
  await withIdp({}, async (idp) => {
    const params = authorizeParams();
    params.delete('code_challenge');
    const res = await fetch(`${idp.issuer}/authorize?${params}`);
    assert.equal(res.status, 400);
  });
});

test('tamperClaims changes the issued token and forgeSignature breaks verification', async () => {
  await withIdp({ tamperClaims: (claims) => ({ ...claims, email_verified: false }) }, async (idp) => {
    const codeVerifier = verifier();
    const { code } = await signInAs(idp, 'mock-ana', authorizeParams({}, codeVerifier));
    const res = await tokenRequest(idp, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    });
    const { decodeJwt } = await import('jose');
    assert.equal(decodeJwt((await res.json()).id_token).email_verified, false);
  });

  await withIdp({}, async (idp) => {
    idp.forgeSignature = true;
    const codeVerifier = verifier();
    const { code } = await signInAs(idp, 'mock-ana', authorizeParams({}, codeVerifier));
    const res = await tokenRequest(idp, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    });
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    await assert.rejects(
      jwtVerify((await res.json()).id_token, createRemoteJWKSet(new URL(`${idp.issuer}/jwks.json`)))
    );
  });
});
