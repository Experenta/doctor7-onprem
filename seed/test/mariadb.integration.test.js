'use strict';

// Integration tests against a real MariaDB. They run only when DATABASE_URL is set.
// They create and drop the schema, so the database name in DATABASE_URL must
// contain "test". The URL is never printed. The schema comes from the API migration
// runner, so this file tests the loader against the K-02 schema itself.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const apiDatabase = require('../../api/src/db/database');
const apiMigrations = require('../../api/src/db/migrations');
const { loadCollections } = require('../lib/loader');
const { generateSeed } = require('../lib/generator');
const { createMariaDbPool, createMariaDbStore } = require('../lib/mariadb-store');
const { COLLECTIONS, BY_NAME } = require('../lib/collections');
const { toSqlDatetime } = require('../lib/instant');

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP_REASON = DATABASE_URL
  ? false
  : 'DATABASE_URL is not set; MariaDB loader tests skipped.';
const ALL = apiMigrations.loadMigrations();
const NOW = Date.UTC(2026, 10, 19, 5, 10, 51, 908);

function assertTestDatabase(url) {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/test/i.test(name)) {
    throw new Error(
      'Refusing to run destructive schema tests: the database name in DATABASE_URL must contain "test".'
    );
  }
}

// Renders a UTC instant as local wall-clock text with an explicit offset.
function renderWithOffset(utcMs, offsetMinutes) {
  const wallClock = new Date(utcMs + offsetMinutes * 60000).toISOString().slice(0, -1);
  if (offsetMinutes === 0) {
    return `${wallClock}Z`;
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const pad = (value) => String(value).padStart(2, '0');
  return `${wallClock}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

describe('MariaDB loader', { skip: SKIP_REASON }, () => {
  let migrationPool;
  let pool;
  let store;

  async function clearSchema() {
    while ((await apiMigrations.status(migrationPool, ALL)).applied.length > 0) {
      await apiMigrations.down(migrationPool, ALL, 1);
    }
  }

  async function resetSchema() {
    await clearSchema();
    await apiMigrations.up(migrationPool, ALL);
  }

  async function snapshot() {
    const out = {};
    for (const def of COLLECTIONS) {
      out[def.table] = await store.readAll(def);
    }
    return out;
  }

  before(async () => {
    assertTestDatabase(DATABASE_URL);
    migrationPool = apiDatabase.createPool(DATABASE_URL);
    pool = createMariaDbPool(DATABASE_URL);
    store = createMariaDbStore(pool);
    await resetSchema();
  });

  after(async () => {
    if (!migrationPool) return;
    await clearSchema();
    await pool.end();
    await migrationPool.end();
  });

  test('a generated seed loads with zero rejections, and a second load writes nothing', async () => {
    await resetSchema();
    const seed = generateSeed(NOW);
    const first = await loadCollections(seed, store);
    assert.equal(first.totals.rejected, 0, JSON.stringify(first.totals));
    assert.equal(first.totals.inserted, first.totals.read);
    const stateAfterFirst = await snapshot();

    const second = await loadCollections(seed, store);
    assert.equal(second.totals.inserted, 0);
    assert.equal(second.totals.unchanged, first.totals.read);
    assert.deepEqual(await snapshot(), stateAfterFirst);
  });

  test('N loads of the same seed leave the state of one load', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 4 }), async (loads) => {
        const seed = generateSeed(NOW);
        await resetSchema();
        await loadCollections(seed, store);
        const once = await snapshot();

        await resetSchema();
        for (let index = 0; index < loads; index += 1) {
          await loadCollections(seed, store);
        }
        assert.deepEqual(await snapshot(), once);
      }),
      { numRuns: 3 }
    );
  });

  test('instants are stored in UTC and read back as the same instant', async () => {
    await resetSchema();
    let counter = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2040, 0, 1) }),
        fc.integer({ min: -(23 * 60 + 59), max: 23 * 60 + 59 }),
        async (utcMs, offsetMinutes) => {
          counter += 1;
          const id = `c-${counter}`;
          const docs = { centers: [{ id, name: 'Offset Check', createdAt: renderWithOffset(utcMs, offsetMinutes) }] };
          const report = await loadCollections(docs, store);
          assert.equal(report.totals.inserted, 1, JSON.stringify(report.collections.centers.rejections));

          const [raw] = await pool.execute(
            "SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS literal FROM centers WHERE id = ?",
            [id]
          );
          assert.equal(raw[0].literal, `${toSqlDatetime(utcMs)}000`);
          const stored = await store.get(BY_NAME.centers, id);
          assert.equal(stored.created_at, toSqlDatetime(utcMs));
        }
      ),
      { numRuns: 25 }
    );
  });

  test('a changed appointment in a later load is a conflict, and the stored row stays', async () => {
    await resetSchema();
    const seed = generateSeed(NOW);
    await loadCollections(seed, store);
    const original = await store.get(BY_NAME.appointments, seed.appointments[0].id);

    const changed = generateSeed(NOW);
    changed.appointments[0].status = original.status === 'cancelled' ? 'scheduled' : 'cancelled';
    const report = await loadCollections(changed, store);
    assert.deepEqual(report.collections.appointments.rejections, [
      { index: 0, id: original.id, code: 'conflict', field: null },
    ]);
    assert.equal((await store.get(BY_NAME.appointments, original.id)).status, original.status);
  });
});
