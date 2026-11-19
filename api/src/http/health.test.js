'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHealthRouter, readBuildDate } = require('./health');
const { createErrorHandler } = require('./errors');
const { createApp } = require('../app');
const { fakeDb, listen } = require('../../test/helpers');
const packageJson = require('../../package.json');

const quietLogger = { error() {} };

// A bare express app with only the probe router and the API error handler, so the
// test sees the router alone, with the same error shape as the API.
async function startRouter(options) {
  const app = express();
  app.use(createHealthRouter({ logger: quietLogger, ...options }));
  app.use(createErrorHandler({ logger: quietLogger }));
  return listen(app);
}

test('readBuildDate returns the BUILD_DATE instant in milliseconds, and null for anything else', () => {
  assert.equal(readBuildDate({}), null);
  assert.equal(readBuildDate({ BUILD_DATE: '' }), null);
  assert.equal(readBuildDate({ BUILD_DATE: '2026-11-19T03:26:00Z' }), '2026-11-19T03:26:00.000Z');
  assert.equal(readBuildDate({ BUILD_DATE: '2026-11-19T03:26:00.5Z' }), '2026-11-19T03:26:00.500Z');
  for (const bad of ['2026-11-19', 'yesterday', '2026-11-19T03:26:00+05:00', '2026-11-19 03:26:00Z', 'x'.repeat(40)]) {
    assert.equal(readBuildDate({ BUILD_DATE: bad }), null, `"${bad}" must give null`);
  }
});

test('GET /version answers the version and the build date, and nothing else', async () => {
  const build = { version: packageJson.version, buildDate: readBuildDate({ BUILD_DATE: '2026-11-19T03:26:00Z' }) };
  const server = await startRouter({ db: fakeDb(), build });
  try {
    const res = await fetch(`${server.url}/version`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['buildDate', 'version']);
    assert.equal(body.version, packageJson.version);
    assert.equal(body.buildDate, '2026-11-19T03:26:00.000Z');
  } finally {
    await server.close();
  }
});

test('GET /version gives a null build date when BUILD_DATE is not set', async () => {
  const db = fakeDb();
  const server = await startRouter({ db, build: { version: '1.2.3', buildDate: readBuildDate({}) } });
  try {
    const body = await (await fetch(`${server.url}/version`)).json();
    assert.deepEqual(body, { version: '1.2.3', buildDate: null });
    assert.equal(db.pings, 0);
  } finally {
    await server.close();
  }
});

test('the probes keep their answers: healthz never reads the database, readyz does', async () => {
  const db = fakeDb();
  const server = await startRouter({ db });
  try {
    assert.deepEqual(await (await fetch(`${server.url}/healthz`)).json(), { status: 'ok' });
    assert.equal(db.pings, 0);
    assert.deepEqual(await (await fetch(`${server.url}/readyz`)).json(), { status: 'ready' });
    assert.equal(db.pings, 1);
  } finally {
    await server.close();
  }
});

test('GET /readyz answers 503 with a fixed message when the database fails', async () => {
  const server = await startRouter({ db: fakeDb({ pingError: new Error('secret driver text') }) });
  try {
    const res = await fetch(`${server.url}/readyz`);
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.equal(JSON.parse(text).error.code, 'database_unavailable');
    assert.equal(text.includes('secret driver text'), false);
  } finally {
    await server.close();
  }
});

test('the probes and /version are public and not rate limited, through createApp', async () => {
  const app = createApp({
    db: fakeDb(),
    logger: quietLogger,
    rateLimit: { limit: 1 },
    security: { allowedOrigins: [], jitsiOrigin: null, loginLimit: { windowMs: 1000, limit: 5 }, writeLimit: { windowMs: 1000, limit: 5 } },
  });
  const server = await listen(app);
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await fetch(`${server.url}/version`)).status, 200);
      assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
      assert.equal((await fetch(`${server.url}/readyz`)).status, 200);
    }
  } finally {
    await server.close();
  }
});
