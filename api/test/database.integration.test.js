'use strict';

// Integration tests against a real MariaDB instance. They run only when
// DATABASE_URL is set. They create and drop the schema, so the database name in
// DATABASE_URL must contain "test". The URL is never printed.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createDatabase, createPool } = require('../src/db/database');
const { loadMigrations, up, down, status } = require('../src/db/migrations');
const { createRepositories } = require('../src/repositories/tables');
const { listen, silentLogger } = require('./helpers');

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP_REASON = DATABASE_URL
  ? false
  : 'DATABASE_URL is not set; MariaDB integration tests skipped.';

function assertTestDatabase(url) {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/test/i.test(name)) {
    throw new Error(
      'Refusing to run destructive migration tests: the database name in DATABASE_URL must contain "test".'
    );
  }
}

const ALL = loadMigrations();
const CREATED_AT = new Date('2026-11-19T03:26:00.123Z');
const STARTS = new Date('2026-11-19T15:00:00.000Z');
const ENDS = new Date('2026-11-19T15:50:00.000Z');
const HOSTILE = "x'; DROP TABLE centers; -- \"quoted\" ñandú 🙂";

describe('MariaDB integration', { skip: SKIP_REASON }, () => {
  let pool;
  let db;
  let repos;

  before(async () => {
    assertTestDatabase(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDatabase(pool);
    repos = createRepositories(db);
    await up(pool, ALL);
  });

  after(async () => {
    if (!pool) return;
    while ((await status(pool, ALL)).applied.length > 0) {
      await down(pool, ALL, 1);
    }
    await db.close();
  });

  test('migrations are idempotent and reversible', async () => {
    assert.deepEqual(await up(pool, ALL), []);
    const version = ALL[ALL.length - 1].version;
    const rolledBack = await down(pool, ALL, 1);
    assert.deepEqual(rolledBack, [version]);
    assert.deepEqual(await up(pool, ALL), [version]);
  });

  test('the schema holds the six application tables', async () => {
    const rows = await db.execute(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    const names = new Set(rows.map((row) => row.name));
    for (const table of ['appointments', 'audit_log', 'centers', 'chat_messages', 'consultations', 'users']) {
      assert.ok(names.has(table), `missing table ${table}`);
    }
  });

  test('ids and emails use the binary collation', async () => {
    const rows = await db.execute(
      `SELECT table_name AS tableName, column_name AS columnName, collation_name AS collation
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND ((table_name = 'users' AND column_name IN ('id', 'email'))
            OR (table_name = 'centers' AND column_name = 'id'))`
    );
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.collation, 'utf8mb4_bin', `${row.tableName}.${row.columnName}`);
    }
  });

  test('ids and emails that differ only by letter case do not collide', async () => {
    await repos.centers.insert({ id: 'Case-Clinic', name: 'Upper', created_at: CREATED_AT });
    await repos.centers.insert({ id: 'case-clinic', name: 'Lower', created_at: CREATED_AT });
    assert.equal((await repos.centers.findById('Case-Clinic')).name, 'Upper');
    assert.equal((await repos.centers.findById('case-clinic')).name, 'Lower');

    await repos.centers.insert({ id: 'mail-center', name: 'Mail', created_at: CREATED_AT });
    await repos.users.insert({
      id: 'u-upper',
      center_id: 'mail-center',
      email: 'Ana@example.test',
      display_name: 'Ana Upper',
      role: 'professional',
      created_at: CREATED_AT,
    });
    await repos.users.insert({
      id: 'u-lower',
      center_id: 'mail-center',
      email: 'ana@example.test',
      display_name: 'Ana Lower',
      role: 'client',
      created_at: CREATED_AT,
    });
    assert.equal((await repos.users.findById('u-upper')).email, 'Ana@example.test');
    assert.equal((await repos.users.findById('u-lower')).email, 'ana@example.test');
  });

  test('hostile text is stored and returned exactly', async () => {
    await repos.centers.insert({ id: 'hostile-center', name: HOSTILE, created_at: CREATED_AT });
    const row = await repos.centers.findById('hostile-center');
    assert.equal(row.name, HOSTILE);
    const survivors = await repos.centers.list({ limit: 200 });
    assert.ok(survivors.length > 0, 'the centers table must still exist and hold rows');
  });

  test('timestamps round-trip as the same UTC instant', async () => {
    await repos.centers.insert({ id: 'time-center', name: 'Time', created_at: CREATED_AT });
    const row = await repos.centers.findById('time-center');
    assert.equal(row.created_at.getTime(), CREATED_AT.getTime());
  });

  test('a consultation body round-trips as JSON with hostile text', async () => {
    await repos.centers.insert({ id: 'json-center', name: 'Json', created_at: CREATED_AT });
    await repos.users.insert({
      id: 'json-pro',
      center_id: 'json-center',
      email: 'pro@example.test',
      display_name: 'Pro',
      role: 'professional',
      created_at: CREATED_AT,
    });
    await repos.users.insert({
      id: 'json-client',
      center_id: 'json-center',
      email: 'client@example.test',
      display_name: 'Client',
      role: 'client',
      created_at: CREATED_AT,
    });
    await repos.appointments.insert({
      id: 'json-appt',
      center_id: 'json-center',
      professional_id: 'json-pro',
      client_id: 'json-client',
      starts_at: STARTS,
      ends_at: ENDS,
      status: 'scheduled',
      created_at: CREATED_AT,
    });
    const body = { note: HOSTILE, items: [1, 2, 3] };
    await repos.consultations.insert({
      id: 'json-consult',
      appointment_id: 'json-appt',
      body,
      created_at: CREATED_AT,
    });
    assert.deepEqual((await repos.consultations.findById('json-consult')).body, body);
  });

  test('list pages through rows with limit and offset', async () => {
    const first = await repos.centers.list({ limit: 1, offset: 0 });
    const second = await repos.centers.list({ limit: 1, offset: 1 });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0].id, second[0].id);
  });

  test('the readiness probe answers 200 against the real database', async () => {
    const server = await listen(createApp({ db, logger: silentLogger() }));
    try {
      const res = await fetch(`${server.url}/readyz`);
      assert.equal(res.status, 200);
    } finally {
      await server.close();
    }
  });
});
