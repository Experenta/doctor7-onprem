'use strict';

// Integration test of the demo reset against a real MariaDB. It runs only when DATABASE_URL is
// set, like the other database tests, and the database name must contain "test".
//
// This test never deletes from audit_log or schema_migrations, and it never reverts a migration.
// It only applies migrations (up). It creates one table of its own, and drops only that table.
// Other database tests rebuild the schema in their own set-up, so rows that this test leaves in
// the audit log go away with them. Run the database test files one at a time.
//
// The demo marker ("_demo" at the end of the database name) is replaced by a test hook, because a
// test database does not end in _demo. A separate test checks that the real marker refuses.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const apiDatabase = require('../../api/src/db/database');
const apiMigrations = require('../../api/src/db/migrations');
const { main } = require('../reset-demo');
const { resetDemo, hasDemoMarker } = require('../lib/reset');
const { createMariaDbPool, createMariaDbStore } = require('../lib/mariadb-store');
const { COLLECTIONS } = require('../lib/collections');

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP_REASON = DATABASE_URL ? false : 'DATABASE_URL is not set; MariaDB reset tests skipped.';
const NOW = Date.UTC(2026, 10, 19, 5, 10, 51, 908);
const PROBE_TABLE = 'zz_reset_probe';

function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

describe('MariaDB demo reset', { skip: SKIP_REASON }, () => {
  let migrationPool;
  let pool;
  let store;
  const treatAsDemo = () => true;

  async function count(table) {
    const [rows] = await pool.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    return Number(rows[0].n);
  }

  async function snapshot() {
    const out = {};
    for (const def of COLLECTIONS) {
      if (def.table !== 'audit_log') out[def.table] = await store.readAll(def);
    }
    out.meetings = await count('meetings');
    out.sessions = await count('sessions');
    out[PROBE_TABLE] = await count(PROBE_TABLE);
    return out;
  }

  async function addVisitorData() {
    await pool.execute(
      "INSERT IGNORE INTO appointments (id, center_id, professional_id, client_id, starts_at, ends_at, status, created_at) VALUES ('apt-visitor', 'demo-center', 'u-ana', 'u-luis', '2026-11-20 15:00:00.000', '2026-11-20 15:50:00.000', 'scheduled', '2026-11-19 05:00:00.000')"
    );
    await pool.execute(
      "INSERT IGNORE INTO chat_messages (id, appointment_id, sender_id, body, sent_at) VALUES ('msg-visitor', 'apt-visitor', 'u-ana', 'Synthetic visitor message.', '2026-11-19 05:01:00.000')"
    );
    await pool.execute(
      "INSERT IGNORE INTO meetings (appointment_id, provider, url, created_by, created_at) VALUES ('apt-visitor', 'jitsi', 'https://meet.example.test/room', 'u-ana', '2026-11-19 05:02:00.000')"
    );
    await pool.execute(
      "INSERT IGNORE INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (REPEAT('a', 64), 'u-ana', '2026-11-19 05:03:00.000', '2026-11-19 05:03:00.000', '2026-11-19 13:03:00.000')"
    );
    await pool.execute(`INSERT INTO ${PROBE_TABLE} (id) VALUES ('probe-visitor')`);
  }

  before(async () => {
    const name = databaseName(DATABASE_URL);
    if (!/test/i.test(name)) {
      throw new Error('Refusing to run: the database name in DATABASE_URL must contain "test".');
    }
    migrationPool = apiDatabase.createPool(DATABASE_URL);
    pool = createMariaDbPool(DATABASE_URL);
    store = createMariaDbStore(pool);
    await apiMigrations.up(migrationPool, apiMigrations.loadMigrations());
    // A table that the reset code has never heard of, with no foreign key.
    await pool.query(`CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id VARCHAR(64) NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB`);
  });

  after(async () => {
    if (!pool) return;
    await pool.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    await pool.end();
    await migrationPool.end();
  });

  test('empties visitor data and a new table, keeps audit and migrations, reloads the seed, and a second run is the same', async () => {
    // The seed must be there before the visitor rows can reference its users and center.
    await resetDemo(pool, { store, now: NOW, isDemoMarker: treatAsDemo });
    await addVisitorData();
    // An audit row that is not part of the seed. It must still be there afterwards.
    await pool.execute(
      "INSERT INTO audit_log (id, actor_id, action, target_type, target_id, occurred_at, center_id, outcome) VALUES (?, NULL, 'reset.probe', 'demo', NULL, UTC_TIMESTAMP(3), NULL, 'success')",
      [`reset-probe-${Date.now()}`]
    );
    const auditBefore = await count('audit_log');
    const migrationsBefore = await count('schema_migrations');
    assert.ok(auditBefore > 0 && migrationsBefore > 0);

    const first = await resetDemo(pool, { store, now: NOW, isDemoMarker: treatAsDemo });
    assert.equal(first.rejected, 0, JSON.stringify(first.loaded));
    for (const table of ['appointments', 'chat_messages', 'meetings', 'sessions', PROBE_TABLE]) {
      assert.ok(table in first.deleted, `${table} is reported as emptied`);
    }
    assert.ok(!('audit_log' in first.deleted) && !('schema_migrations' in first.deleted));
    assert.equal(await count(PROBE_TABLE), 0);
    assert.equal(await count('meetings'), 0);
    assert.equal(await count('sessions'), 0);
    assert.equal(await count('audit_log'), auditBefore);
    assert.equal(await count('schema_migrations'), migrationsBefore);
    assert.deepEqual(first.kept, {
      audit_log: { before: auditBefore, after: auditBefore },
      schema_migrations: { before: migrationsBefore, after: migrationsBefore },
    });
    const [visitor] = await pool.execute("SELECT id FROM appointments WHERE id = 'apt-visitor'");
    assert.equal(visitor.length, 0);
    assert.ok((await count('appointments')) > 0, 'the seed is loaded');

    const afterFirst = await snapshot();
    await addVisitorData();
    const second = await resetDemo(pool, { store, now: NOW, isDemoMarker: treatAsDemo });
    assert.equal(second.rejected, 0);
    assert.deepEqual(await snapshot(), afterFirst);
    assert.equal(await count('audit_log'), auditBefore);
    assert.equal(await count('schema_migrations'), migrationsBefore);

    // Foreign key checks are on again for the session that pool connections use.
    const [setting] = await pool.query('SELECT @@foreign_key_checks AS value');
    assert.equal(Number(setting[0].value), 1);
  });

  test('with the real marker, a database that does not end in _demo is refused and left alone', async (t) => {
    if (hasDemoMarker(databaseName(DATABASE_URL))) {
      t.skip('the test database name ends in _demo');
      return;
    }
    await resetDemo(pool, { store, now: NOW, isDemoMarker: treatAsDemo });
    await addVisitorData();
    const before = await snapshot();
    const auditBefore = await count('audit_log');
    const out = { stderr: '' };
    const code = await main(
      [],
      { DEMO_MODE: '1', DEMO_RESET_CONFIRM: 'erase-demo-data', DEMO_RESET_DATABASE_URL: DATABASE_URL },
      { stdout() {}, stderr: (text) => { out.stderr += text; } },
      { now: NOW }
    );
    assert.equal(code, 1);
    assert.match(out.stderr, /not_demo_database/);
    assert.ok(!out.stderr.includes(DATABASE_URL));
    assert.deepEqual(await snapshot(), before);
    assert.equal(await count('audit_log'), auditBefore);
    // Remove the probe row that this test added. The table is the test's own.
    await pool.query(`DELETE FROM ${PROBE_TABLE}`);
  });
});
