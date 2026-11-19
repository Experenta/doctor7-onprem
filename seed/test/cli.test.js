'use strict';

// Command-line checks that never reach a database. Each case stops before a
// connection is opened, and the generator cases stop before any file is written.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { main: loadMain } = require('../load');
const { main: generateMain } = require('../generate');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      stdout: (text) => {
        out.stdout += text;
      },
      stderr: (text) => {
        out.stderr += text;
      },
    },
  };
}

// A URL with a host that does not resolve. It is never used, because every case
// below fails before the pool is created.
const UNUSED_URL = 'mysql://db.invalid/doctor7-test';

describe('load.js', () => {
  test('an unknown option prints usage and exits 1', async () => {
    const { io, out } = capture();
    const code = await loadMain(['--input', FIXTURES, '--force'], { DATABASE_URL: UNUSED_URL }, io);
    assert.equal(code, 1);
    assert.match(out.stderr, /Unknown or incomplete argument: --force/);
  });

  test('a missing --input prints usage and exits 1', async () => {
    const { io, out } = capture();
    assert.equal(await loadMain([], { DATABASE_URL: UNUSED_URL }, io), 1);
    assert.match(out.stderr, /Usage: DATABASE_URL=<url> node seed\/load\.js --input <directory>/);
  });

  test('without DATABASE_URL it exits 1 and does not print the value', async () => {
    const { io, out } = capture();
    assert.equal(await loadMain(['--input', FIXTURES], {}, io), 1);
    assert.match(out.stderr, /DATABASE_URL is not set\./);
  });

  test('a directory that does not exist stops before any connection', async () => {
    const { io, out } = capture();
    const missing = path.join(os.tmpdir(), 'doctor7-no-such-directory-k09');
    assert.equal(await loadMain(['--input', missing], { DATABASE_URL: UNUSED_URL }, io), 1);
    assert.match(out.stderr, /input_directory_missing/);
  });

  test('invalid JSON in an input file stops before any connection and names only the file', async () => {
    const { io, out } = capture();
    const code = await loadMain(['--input', path.join(FIXTURES, 'malformed')], { DATABASE_URL: UNUSED_URL }, io);
    assert.equal(code, 1);
    assert.match(out.stderr, /input_invalid_json in centers\.json/);
    assert.equal(out.stderr.includes(UNUSED_URL), false);
  });

  test('a file whose JSON is not an array stops before any connection', async () => {
    const { io, out } = capture();
    const code = await loadMain(['--input', path.join(FIXTURES, 'not-array')], { DATABASE_URL: UNUSED_URL }, io);
    assert.equal(code, 1);
    assert.match(out.stderr, /input_not_array in centers\.json/);
  });
});

describe('generate.js', () => {
  test('without --out it prints usage and writes nothing', () => {
    const { io, out } = capture();
    assert.equal(generateMain([], io), 1);
    assert.match(out.stderr, /Usage: node seed\/generate\.js --out <directory>/);
  });

  test('an invalid --now stops before any file is written', () => {
    const { io, out } = capture();
    const target = path.join(os.tmpdir(), 'doctor7-k09-never-written');
    assert.equal(generateMain(['--out', target, '--now', '2026-11-19 05:10'], io), 1);
    assert.match(out.stderr, /--now is not a valid instant \(invalid_timestamp\)/);
    assert.equal(fs.existsSync(target), false);
  });

  test('an unknown option is refused', () => {
    const { io, out } = capture();
    assert.equal(generateMain(['--out', 'x', '--seed', '1'], io), 1);
    assert.match(out.stderr, /Unknown or incomplete argument: --seed/);
  });
});
