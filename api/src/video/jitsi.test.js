'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJitsiProvider, ROOM_PREFIX } = require('./jitsi');
const { assertVideoProvider } = require('./provider');

const NOW = new Date('2026-12-01T14:00:00.000Z');
const appointment = (endsAt) => ({ id: 'a1', startsAt: new Date('2026-12-01T15:00:00.000Z'), endsAt: new Date(endsAt) });
const END = '2026-12-01T15:50:00.000Z';

function provider(config) {
  return createJitsiProvider({ config, now: () => NOW });
}

function secretOf(config) {
  const copy = { ...config };
  Object.defineProperty(copy, 'jwtSecret', { value: config.jwtSecret, enumerable: false });
  return copy;
}

test('the provider follows the VideoProvider interface', () => {
  assert.doesNotThrow(() => assertVideoProvider(provider({ baseUrl: 'https://jitsi.example.test' })));
  assert.throws(() => assertVideoProvider({ name: 'zoom', createMeeting() {} }), TypeError);
  assert.throws(() => assertVideoProvider({ name: 'jitsi' }), TypeError);
});

test('an unsigned meeting is the base URL plus a random room, with no token', async () => {
  const jitsi = provider({ baseUrl: 'https://jitsi.example.test' });
  const { url } = await jitsi.createMeeting({ appointment: appointment(END) });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://jitsi.example.test');
  assert.match(parsed.pathname, new RegExp(`^/${ROOM_PREFIX}[0-9a-f]{32}$`));
  assert.equal(parsed.search, '');
});

test('rooms are unique and keep a path in the base URL', async () => {
  const jitsi = provider({ baseUrl: 'https://example.test/jitsi' });
  const urls = await Promise.all(Array.from({ length: 50 }, () => jitsi.createMeeting({ appointment: appointment(END) })));
  assert.equal(new Set(urls.map((entry) => entry.url)).size, 50);
  assert.ok(urls.every((entry) => entry.url.startsWith('https://example.test/jitsi/doctor7-')));
});

test('a signed meeting carries an HS256 token for its room', async () => {
  const secret = 'test-only-jitsi-secret';
  const jitsi = provider(secretOf({ baseUrl: 'https://jitsi.example.test', appId: 'app-1', jwtSecret: secret }));
  const { url } = await jitsi.createMeeting({ appointment: appointment(END) });
  const parsed = new URL(url);
  const token = parsed.searchParams.get('jwt');
  const [header, payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  assert.equal(signature, expected);
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, 'app-1');
  assert.equal(claims.aud, 'app-1');
  assert.equal(claims.sub, 'jitsi.example.test');
  assert.equal(claims.room, parsed.pathname.slice(1));
  assert.equal(claims.exp, Math.floor(new Date(END).getTime() / 1000) + 3600);
  assert.ok(!url.includes(secret));
});

test('the token of a past appointment still lasts one hour from now', async () => {
  const jitsi = provider(secretOf({ baseUrl: 'https://jitsi.example.test', appId: 'app-1', jwtSecret: 'x' }));
  const { url } = await jitsi.createMeeting({ appointment: appointment('2026-11-01T10:00:00.000Z') });
  const claims = JSON.parse(Buffer.from(new URL(url).searchParams.get('jwt').split('.')[1], 'base64url'));
  assert.equal(claims.exp, Math.floor(NOW.getTime() / 1000) + 3600);
});
