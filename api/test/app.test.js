'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createDatabase, createPool } = require('../src/db/database');
const { fakeDb, listen, silentLogger } = require('./helpers');

const STACK_PATTERN = /\n\s+at\s|stack/i;

test('GET /healthz returns 200 and does not touch the database', async () => {
  const db = fakeDb();
  const server = await listen(createApp({ db, logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
    assert.equal(db.pings, 0);
  } finally {
    await server.close();
  }
});

test('GET /readyz returns 200 when the database answers', async () => {
  const db = fakeDb();
  const server = await listen(createApp({ db, logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/readyz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ready' });
    assert.equal(db.pings, 1);
  } finally {
    await server.close();
  }
});

test('GET /readyz returns 503 with a uniform error when the database fails', async () => {
  const failure = new Error('connect ECONNREFUSED 10.20.30.40:3306 internal-detail');
  const db = fakeDb({ pingError: failure });
  const server = await listen(createApp({ db, logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/readyz`);
    const text = await res.text();
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(text), {
      error: { code: 'database_unavailable', message: 'Database is not reachable.' },
    });
    assert.ok(!text.includes('10.20.30.40'), 'driver detail leaked');
    assert.ok(!STACK_PATTERN.test(text), 'stack trace leaked');
  } finally {
    await server.close();
  }
});

test('GET /readyz returns 503 when a real driver cannot reach the host', async () => {
  // Port 1 refuses connections, so no database needs to run for this check.
  const db = createDatabase(createPool('mysql://127.0.0.1:1/unused'));
  const server = await listen(createApp({ db, logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/readyz`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'database_unavailable');
  } finally {
    await server.close();
    await db.close();
  }
});

test('responses carry security headers and no X-Powered-By', async () => {
  const server = await listen(createApp({ db: fakeDb(), logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/healthz`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options'), 'X-Frame-Options missing');
    assert.ok(res.headers.get('content-security-policy'), 'Content-Security-Policy missing');
    assert.ok(res.headers.get('strict-transport-security'), 'Strict-Transport-Security missing');
    assert.equal(res.headers.get('x-powered-by'), null);
  } finally {
    await server.close();
  }
});

test('requests over the rate limit receive 429 with a JSON error', async () => {
  const app = createApp({
    db: fakeDb(),
    logger: silentLogger(),
    rateLimit: { windowMs: 60 * 1000, limit: 2 },
  });
  const server = await listen(app);
  try {
    assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
    assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
    const res = await fetch(`${server.url}/healthz`);
    const text = await res.text();
    assert.equal(res.status, 429);
    assert.deepEqual(JSON.parse(text), {
      error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
    });
    assert.ok(!STACK_PATTERN.test(text));
  } finally {
    await server.close();
  }
});

test('unknown routes return a JSON 404 without a stack trace', async () => {
  const server = await listen(createApp({ db: fakeDb(), logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/no-such-route`);
    const text = await res.text();
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(text), {
      error: { code: 'not_found', message: 'Route not found.' },
    });
    assert.ok(!STACK_PATTERN.test(text));
  } finally {
    await server.close();
  }
});

test('malformed JSON bodies return a JSON 400 without a stack trace', async () => {
  const server = await listen(createApp({ db: fakeDb(), logger: silentLogger() }));
  try {
    const res = await fetch(`${server.url}/healthz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": ',
    });
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(text), {
      error: { code: 'invalid_json', message: 'Request body is not valid JSON.' },
    });
    assert.ok(!STACK_PATTERN.test(text));
  } finally {
    await server.close();
  }
});

test('createApp refuses to start without a database dependency', () => {
  assert.throws(() => createApp({}), TypeError);
});
