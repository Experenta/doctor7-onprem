'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockGoogle } = require('../../../tools/mock-google/server');
const { createTestServiceAccount } = require('../../../tools/mock-google/testing');
const { loadVideoConfig } = require('./config');
const { createMeetProvider } = require('./meet');
const { VideoProviderError, assertVideoProvider } = require('./provider');

const appointment = { id: 'a1', startsAt: new Date('2026-12-01T15:00:00.000Z'), endsAt: new Date('2026-12-01T15:50:00.000Z') };

async function withMeet(fn, { timeoutMs = 300, credentialOverride } = {}) {
  const account = createTestServiceAccount();
  const google = await createMockGoogle({
    publicKeyPem: account.publicKeyPem,
    serviceAccountEmail: account.email,
    delegatedUsers: [account.delegatedUser],
  }).start();
  try {
    const config = loadVideoConfig({
      VIDEO_PROVIDER: 'meet',
      JITSI_BASE_URL: 'https://jitsi.example.test',
      GOOGLE_SERVICE_ACCOUNT_JSON: credentialOverride ? credentialOverride(account, google) : account.credentialJson(google.issuer),
      GOOGLE_MEET_DELEGATED_USER: account.delegatedUser,
      GOOGLE_MEET_API_BASE_URL: google.issuer,
    });
    await fn(createMeetProvider({ config: config.meet, timeoutMs }), google, account);
  } finally {
    await google.close();
  }
}

async function failureOf(meet) {
  try {
    await meet.createMeeting({ appointment });
  } catch (err) {
    return err;
  }
  return assert.fail('createMeeting should have failed');
}

test('the Meet adapter follows the VideoProvider interface', async () => {
  await withMeet(async (meet) => {
    assert.doesNotThrow(() => assertVideoProvider(meet));
    assert.equal(meet.name, 'meet');
  });
});

test('it creates a space with a signed assertion and the delegated user', async () => {
  await withMeet(async (meet, google) => {
    const { url } = await meet.createMeeting({ appointment });
    assert.match(url, /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    assert.equal(google.spaces.length, 1);
    assert.deepEqual(
      google.requests.map((entry) => `${entry.path} ${entry.status}`),
      ['/token 200', '/v2/spaces 200']
    );
  });
});

test('failures map to the failure kinds', async () => {
  const expected = {
    http_400: 'error',
    http_500: 'error',
    quota: 'quota',
    no_uri: 'error',
    delegation_denied: 'error',
  };
  await withMeet(async (meet, google) => {
    for (const [mode, kind] of Object.entries(expected)) {
      google.mode = mode;
      const err = await failureOf(meet);
      assert.ok(err instanceof VideoProviderError, mode);
      assert.equal(err.kind, kind, mode);
    }
  });
});

test('a Google call that does not answer ends as a timeout', async () => {
  await withMeet(
    async (meet, google) => {
      google.mode = 'hang';
      const started = Date.now();
      const err = await failureOf(meet);
      assert.equal(err.kind, 'timeout');
      assert.ok(Date.now() - started < 3000);
    },
    { timeoutMs: 150 }
  );
});

test('an unreachable Google ends as an error', async () => {
  await withMeet(async (meet, google) => {
    await google.close();
    const err = await failureOf(meet);
    assert.equal(err.kind, 'error');
  });
});

test('a key that does not match the service account is refused by Google', async () => {
  await withMeet(
    async (meet) => {
      assert.equal((await failureOf(meet)).kind, 'error');
    },
    {
      credentialOverride: (account, google) =>
        createTestServiceAccount().credentialJson(google.issuer),
    }
  );
});

test('a meeting address outside meet.google.com is refused', async () => {
  const account = createTestServiceAccount();
  const config = loadVideoConfig({
    VIDEO_PROVIDER: 'meet',
    JITSI_BASE_URL: 'https://jitsi.example.test',
    GOOGLE_SERVICE_ACCOUNT_JSON: account.credentialJson('http://127.0.0.1:9'),
    GOOGLE_MEET_DELEGATED_USER: account.delegatedUser,
  });
  for (const meetingUri of ['https://evil.example.test/abc-defg-hij', 'http://meet.google.com/abc', 'meet.google.com/abc', 42, 'https://meet.google.com/']) {
    const fetchImpl = async (url) =>
      new Response(JSON.stringify(String(url).endsWith('/token') ? { access_token: 'tok' } : { meetingUri }), { status: 200 });
    const err = await failureOf(createMeetProvider({ config: config.meet, timeoutMs: 300, fetchImpl }));
    assert.equal(err.kind, 'error', String(meetingUri));
  }
});

test('requests do not follow redirects and carry the bearer token only to the API address', async () => {
  const account = createTestServiceAccount();
  const config = loadVideoConfig({
    VIDEO_PROVIDER: 'meet',
    JITSI_BASE_URL: 'https://jitsi.example.test',
    GOOGLE_SERVICE_ACCOUNT_JSON: account.credentialJson('https://oauth.example.test'),
    GOOGLE_MEET_DELEGATED_USER: account.delegatedUser,
  });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), redirect: init.redirect, auth: init.headers.Authorization });
    return new Response(JSON.stringify(String(url).endsWith('/token') ? { access_token: 'tok' } : { meetingUri: 'https://meet.google.com/abc-defg-hij' }), { status: 200 });
  };
  await createMeetProvider({ config: config.meet, timeoutMs: 300, fetchImpl }).createMeeting({ appointment });
  assert.deepEqual(
    seen.map((entry) => [entry.url, entry.redirect, entry.auth]),
    [
      ['https://oauth.example.test/token', 'error', undefined],
      ['https://meet.googleapis.com/v2/spaces', 'error', 'Bearer tok'],
    ]
  );
});

test('errors never carry the credential or text from Google', async () => {
  await withMeet(async (meet, google, account) => {
    const marker = 'UPSTREAM-DETAIL-MARKER';
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: marker, status: 'INTERNAL' } }), { status: 500 });
    const config = loadVideoConfig({
      VIDEO_PROVIDER: 'meet',
      JITSI_BASE_URL: 'https://jitsi.example.test',
      GOOGLE_SERVICE_ACCOUNT_JSON: account.credentialJson(google.issuer),
      GOOGLE_MEET_DELEGATED_USER: account.delegatedUser,
    });
    const err = await failureOf(createMeetProvider({ config: config.meet, timeoutMs: 300, fetchImpl }));
    const view = `${err.message} ${err.stack} ${JSON.stringify(err)} ${Object.keys(err).join()}`;
    for (const secret of [marker, account.privateKeyBody, account.privateKeyId, account.email]) {
      assert.ok(!view.includes(secret), secret.slice(0, 12));
    }
  });
});
