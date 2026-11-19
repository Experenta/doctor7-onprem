'use strict';

// Sign-in and sign-out tests against the mock identity provider. Each sign-in
// outcome and each logout writes one entry. No token or code reaches the log.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockIdp } = require('../../../tools/mock-idp/server');
const { startApi, entriesOf, providerAuth } = require('./harness');

const REDIRECT_URI = 'http://127.0.0.1:3000/auth/callback';
const CLIENT_ID = 'doctor7-audit-test';

// Starts the browser part of the flow. Returns the login cookie and the authorization URL.
async function startLogin(server) {
  const res = await fetch(`${server.url}/auth/login`, { redirect: 'manual' });
  const cookie = res.headers.getSetCookie().find((line) => line.startsWith('d7_login=')).split(';')[0];
  return { cookie, authUrl: new URL(res.headers.get('location')) };
}

// The provider grants the code for the chosen synthetic user and redirects.
async function grant(idp, authUrl, sub) {
  const form = new URLSearchParams(authUrl.searchParams);
  form.set('user', sub);
  const res = await fetch(`${idp.issuer}/authorize`, { method: 'POST', body: form, redirect: 'manual' });
  return new URL(res.headers.get('location'));
}

function finish(server, callbackUrl, cookie) {
  return fetch(`${server.url}${callbackUrl.pathname}${callbackUrl.search}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
}

async function signIn(server, idp, sub) {
  const { cookie, authUrl } = await startLogin(server);
  const callbackUrl = await grant(idp, authUrl, sub);
  return finish(server, callbackUrl, cookie);
}

function sessionCookieOf(res) {
  return res.headers.getSetCookie().find((line) => line.startsWith('d7_session=')).split(';')[0];
}

async function setup(t) {
  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }).start();
  const started = await startApi({ auth: providerAuth(idp, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI }) });
  t.after(async () => {
    await started.server.close();
    await idp.close();
  });
  return { ...started, idp };
}

test('a successful sign-in writes one entry for the user, and the session token is not in it', async (t) => {
  const { server, idp, auditStore } = await setup(t);
  const before = auditStore.entries.length;
  const res = await signIn(server, idp, 'mock-ana');
  assert.equal(res.status, 302);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'auth.login');
  assert.equal(added[0].outcome, 'success');
  assert.equal(added[0].actorId, 'u-ana');
  assert.equal(added[0].centerId, 'c1');
  assert.equal(added[0].targetId, 'u-ana');
  assert.equal(added[0].reason, null);
  assert.ok(added[0].occurredAt instanceof Date);

  const token = sessionCookieOf(res).split('=')[1];
  const everything = JSON.stringify(entriesOf(auditStore));
  assert.equal(everything.includes(token), false, 'the session token leaked into the log');
  assert.equal(everything.includes('ana.rivera@example.test'), false, 'the email leaked into the log');
});

test('a verified account with no users row is refused, with reason user_not_found and no actor', async (t) => {
  const { server, idp, auditStore } = await setup(t);
  const before = auditStore.entries.length;
  const res = await signIn(server, idp, 'mock-norole');
  assert.equal(res.status, 403);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'auth.login');
  assert.equal(added[0].outcome, 'denied');
  assert.equal(added[0].reason, 'user_not_found');
  assert.equal(added[0].actorId, null);
  assert.equal(added[0].centerId, null);
});

test('an unverified email fails the sign-in with the provider reason code', async (t) => {
  const { server, idp, auditStore } = await setup(t);
  const before = auditStore.entries.length;
  const res = await signIn(server, idp, 'mock-pending');
  assert.equal(res.status, 401);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].outcome, 'failure');
  assert.equal(added[0].reason, 'email_not_verified');
});

test('a callback with an unknown state is a failure with reason state_unknown', async (t) => {
  const { server, auditStore } = await setup(t);
  const before = auditStore.entries.length;
  const res = await fetch(`${server.url}/auth/callback?code=abc&state=${'A'.repeat(43)}`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].outcome, 'failure');
  assert.equal(added[0].reason, 'state_unknown');
  assert.equal(added[0].actorId, null);
});

test('a callback from a browser without the binding cookie is a failure with reason binding_mismatch', async (t) => {
  const { server, idp, auditStore } = await setup(t);
  const { authUrl } = await startLogin(server);
  const callbackUrl = await grant(idp, authUrl, 'mock-ana');
  const before = auditStore.entries.length;
  const res = await finish(server, callbackUrl, null);
  assert.equal(res.status, 400);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].reason, 'binding_mismatch');
});

test('an unreachable provider after the code is granted is a failure with reason provider_unreachable', async (t) => {
  const { server, idp, auditStore } = await setup(t);
  const { cookie, authUrl } = await startLogin(server);
  const callbackUrl = await grant(idp, authUrl, 'mock-ana');
  await idp.close();
  const before = auditStore.entries.length;
  const res = await finish(server, callbackUrl, cookie);
  assert.equal(res.status, 502);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].outcome, 'failure');
  assert.equal(added[0].reason, 'provider_unreachable');
});

test('starting a sign-in writes no entry', async (t) => {
  const { server, auditStore } = await setup(t);
  const before = auditStore.entries.length;
  await startLogin(server);
  assert.equal(auditStore.entries.length, before);
});

test('a logout writes one entry for the user, and a logout with all=true writes auth.logout_all', async (t) => {
  const { server, idp, auditStore, call } = await setup(t);
  const cookie = sessionCookieOf(await signIn(server, idp, 'mock-ana'));

  let before = auditStore.entries.length;
  let res = await call('POST', '/auth/logout', { cookie });
  assert.equal(res.status, 204);
  let added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'auth.logout');
  assert.equal(added[0].outcome, 'success');
  assert.equal(added[0].actorId, 'u-ana');
  assert.equal(added[0].centerId, 'c1');

  const second = sessionCookieOf(await signIn(server, idp, 'mock-ana'));
  before = auditStore.entries.length;
  res = await call('POST', '/auth/logout', { cookie: second, body: { all: true } });
  assert.equal(res.status, 204);
  added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'auth.logout_all');
  assert.equal(added[0].outcome, 'success');
  assert.equal(added[0].actorId, 'u-ana');
});

test('a logout without a live session still answers 204, with one failure entry and no actor', async (t) => {
  const { call, auditStore } = await setup(t);
  const before = auditStore.entries.length;
  const res = await call('POST', '/auth/logout', {});
  assert.equal(res.status, 204);
  const added = entriesOf(auditStore).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].action, 'auth.logout');
  assert.equal(added[0].outcome, 'failure');
  assert.equal(added[0].reason, 'no_session');
  assert.equal(added[0].actorId, null);
});
