'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createHealthRouter, readBuildDate, readBuildInfo, parseVersionFile, DEFAULT_VERSION_FILE } = require('./health');
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


// A temporary folder for the version file tests. It is removed after each test.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor7-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A logger that keeps each error line, so a test can read it.
function recordingLogger() {
  const lines = [];
  return { lines, error: (line) => lines.push(String(line)) };
}

test('DEFAULT_VERSION_FILE is the path that the package writes', () => {
  assert.equal(DEFAULT_VERSION_FILE, '/usr/lib/doctor7/VERSION');
});

test('parseVersionFile reads the version and the build date, and ignores other lines', () => {
  assert.deepEqual(parseVersionFile('version=0.0.0+git42.abc1234-1\nbuild-date=2026-11-19T06:53:53.715Z\n'), {
    version: '0.0.0+git42.abc1234-1',
    buildDate: '2026-11-19T06:53:53.715Z',
  });
  assert.equal(parseVersionFile('build-date=2026-11-19T06:53:53Z\n'), null, 'no version line');
  assert.equal(parseVersionFile('version=\n'), null, 'an empty version');
  assert.deepEqual(parseVersionFile('# note\r\nversion=1.2.3-1\r\nbuild-date=bad\r\n'), { version: '1.2.3-1', buildDate: null });
});

test('readBuildInfo takes the version and the build date from the version file, not from BUILD_DATE', (t) => {
  const file = path.join(tempDir(t), 'VERSION');
  fs.writeFileSync(file, 'version=0.0.0+git42.abc1234-1\nbuild-date=2026-11-19T06:53:53.715Z\n');
  const info = readBuildInfo({ env: { D7_VERSION_FILE: file, BUILD_DATE: '2020-01-01T00:00:00Z' }, logger: recordingLogger() });
  assert.deepEqual(info, { version: '0.0.0+git42.abc1234-1', buildDate: '2026-11-19T06:53:53.715Z' });
});

test('readBuildInfo falls back to package.json and BUILD_DATE when the version file is missing', (t) => {
  const missing = path.join(tempDir(t), 'VERSION');
  const logger = recordingLogger();
  assert.deepEqual(readBuildInfo({ env: { D7_VERSION_FILE: missing, BUILD_DATE: '2026-11-19T03:26:00Z' }, logger }), {
    version: packageJson.version,
    buildDate: '2026-11-19T03:26:00.000Z',
  });
  assert.deepEqual(readBuildInfo({ env: { D7_VERSION_FILE: missing }, logger }), { version: packageJson.version, buildDate: null });
  assert.deepEqual(logger.lines, [], 'a missing file is not an error');
});

test('a version file with no version line, or that cannot be read, is logged and skipped', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'VERSION');
  fs.writeFileSync(file, 'build-date=2026-11-19T03:26:00Z\n');
  const noVersion = recordingLogger();
  assert.deepEqual(readBuildInfo({ env: { D7_VERSION_FILE: file }, logger: noVersion }), {
    version: packageJson.version,
    buildDate: null,
  });
  assert.equal(noVersion.lines.length, 1);
  assert.match(noVersion.lines[0], /has no version line/);

  // A folder in place of the file cannot be read as a file.
  const unreadable = recordingLogger();
  assert.deepEqual(readBuildInfo({ env: { D7_VERSION_FILE: dir }, logger: unreadable }), {
    version: packageJson.version,
    buildDate: null,
  });
  assert.equal(unreadable.lines.length, 1);
  assert.match(unreadable.lines[0], /cannot read the version file/);
});

test('GET /version answers the values of the version file it is given', async (t) => {
  const file = path.join(tempDir(t), 'VERSION');
  fs.writeFileSync(file, 'version=0.0.0+git42.abc1234-1\nbuild-date=2026-11-19T06:53:53.715Z\n');
  const db = fakeDb();
  const server = await startRouter({ db, build: readBuildInfo({ env: { D7_VERSION_FILE: file }, logger: quietLogger }) });
  try {
    const res = await fetch(`${server.url}/version`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { version: '0.0.0+git42.abc1234-1', buildDate: '2026-11-19T06:53:53.715Z' });
    assert.equal(db.pings, 0);
  } finally {
    await server.close();
  }
});

test('the router reads D7_VERSION_FILE from the process environment when no build is passed', async (t) => {
  const file = path.join(tempDir(t), 'VERSION');
  fs.writeFileSync(file, 'version=9.9.9-1\nbuild-date=2026-11-19T06:53:53.715Z\n');
  const saved = process.env.D7_VERSION_FILE;
  process.env.D7_VERSION_FILE = file;
  t.after(() => {
    if (saved === undefined) delete process.env.D7_VERSION_FILE;
    else process.env.D7_VERSION_FILE = saved;
  });
  const server = await startRouter({ db: fakeDb() });
  try {
    assert.deepEqual(await (await fetch(`${server.url}/version`)).json(), {
      version: '9.9.9-1',
      buildDate: '2026-11-19T06:53:53.715Z',
    });
  } finally {
    await server.close();
  }
});
