'use strict';

// Full sign-in through the public path. The API's OIDC client (api/src/auth/oidc.js)
// does discovery, the code exchange, and the token check. A fake Apache stands
// between them and the provider: it accepts only the demo host with the /idp
// prefix, removes the prefix, and forwards to the loopback provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMockIdp } = require('./server');
const { createOidcClient } = require('../../api/src/auth/oidc');

const PUBLIC_ORIGIN = 'https://demo.example.test';
const PUBLIC = `${PUBLIC_ORIGIN}/idp`;
const CALLBACK = `${PUBLIC_ORIGIN}/api/auth/callback`;
const CLIENT_ID = 'doctor7-demo';

const realFetch = globalThis.fetch;

function fakeApache(localUrl) {
  return (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== PUBLIC_ORIGIN || !url.pathname.startsWith('/idp/')) {
      throw new Error(`not routed by the vhost: ${url.origin}${url.pathname}`);
    }
    const path = url.pathname.slice('/idp'.length);
    return realFetch(`${localUrl}${path}${url.search}`, init);
  };
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');

test('a sign-in through the public path ends with a token that the API accepts', async () => {
  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [CALLBACK], publicUrl: PUBLIC }).start();
  const forward = fakeApache(idp.localUrl);
  const savedFetch = globalThis.fetch;
  // jose fetches the JWKS with the global fetch, so the fake Apache replaces it for this test.
  globalThis.fetch = forward;
  try {
    const oidc = createOidcClient(
      { issuer: PUBLIC, clientId: CLIENT_ID, redirectUri: CALLBACK, scope: 'openid email profile', clientSecret: '' },
      { fetchImpl: forward }
    );
    const codeVerifier = randomToken();
    const state = randomToken();
    const nonce = randomToken();
    const authorizeUrl = await oidc.authorizationUrl({ state, nonce, codeChallenge: challengeOf(codeVerifier) });
    assert.ok(authorizeUrl.startsWith(`${PUBLIC}/authorize?`), 'the browser is sent to the public path');

    // The browser loads the login page and submits the form with the chosen account.
    const page = await forward(authorizeUrl);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(`<form method="post" action="${PUBLIC}/authorize">`));
    const form = new URLSearchParams(
      [...html.matchAll(/<input type="hidden" name="(\w+)" value="([^"]*)">/g)].map((match) => [match[1], match[2]])
    );
    form.set('user', 'mock-ana');
    const signIn = await forward(`${PUBLIC}/authorize`, { method: 'POST', body: form, redirect: 'manual' });
    assert.equal(signIn.status, 302);

    // The browser follows the redirect to the callback of the demo.
    const back = new URL(signIn.headers.get('location'));
    assert.equal(back.origin + back.pathname, CALLBACK);
    assert.equal(back.searchParams.get('state'), state);

    // The API exchanges the code and verifies the ID token.
    const idToken = await oidc.exchangeCode({ code: back.searchParams.get('code'), codeVerifier });
    const { decodeJwt } = await import('jose');
    assert.equal(decodeJwt(idToken).iss, PUBLIC);
    const identity = await oidc.verifyIdToken(idToken, { nonce });
    assert.deepEqual(identity, { subject: 'mock-ana', email: 'ana.rivera@example.test' });
  } finally {
    globalThis.fetch = savedFetch;
    await idp.close();
  }
});

test('the API refuses a token whose nonce does not match the sign-in attempt', async () => {
  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [CALLBACK], publicUrl: PUBLIC }).start();
  const forward = fakeApache(idp.localUrl);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = forward;
  try {
    const oidc = createOidcClient(
      { issuer: PUBLIC, clientId: CLIENT_ID, redirectUri: CALLBACK, scope: 'openid email profile', clientSecret: '' },
      { fetchImpl: forward }
    );
    const codeVerifier = randomToken();
    const nonce = randomToken();
    const url = await oidc.authorizationUrl({ state: randomToken(), nonce, codeChallenge: challengeOf(codeVerifier) });
    const params = new URL(url).searchParams;
    const body = new URLSearchParams(params);
    body.set('user', 'mock-ana');
    const signIn = await forward(`${PUBLIC}/authorize`, { method: 'POST', body, redirect: 'manual' });
    const code = new URL(signIn.headers.get('location')).searchParams.get('code');
    const idToken = await oidc.exchangeCode({ code, codeVerifier });
    await assert.rejects(oidc.verifyIdToken(idToken, { nonce: randomToken() }), { reason: 'nonce_mismatch' });
  } finally {
    globalThis.fetch = savedFetch;
    await idp.close();
  }
});
