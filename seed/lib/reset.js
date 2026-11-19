'use strict';

// Resets the demo database to the synthetic seed. Demo only, never production.
//
// What it does: it deletes every row of every table of the schema, except the audit log and
// the migration table, and then loads the seed again with the idempotent loader. The list of
// tables comes from information_schema, so a table added later is emptied with no change here.
//
// What it never does: delete from the audit log or from schema_migrations, truncate, or drop.
// It also refuses to run unless the environment and the database both say "demo".
// Nothing in this file prints the database URL or a driver message.

const { generateSeed } = require('./generator');
const { loadCollections } = require('./loader');

const DEMO_MODE_VALUE = '1';
const CONFIRM_VALUE = 'erase-demo-data';
const DEMO_DATABASE_SUFFIX = '_demo';
const MIGRATIONS_TABLE = 'schema_migrations';
const SAFE_TABLE_NAME = /^[A-Za-z0-9_]+$/;

// A refusal. `code` is a fixed word. It never carries a value from the environment.
class ResetRefused extends Error {
  constructor(code) {
    super(code);
    this.name = 'ResetRefused';
    this.code = code;
  }
}

// Returns the reason code when the environment does not allow a reset, or null.
function checkEnvironment(env) {
  if (env.DEMO_MODE !== DEMO_MODE_VALUE) return 'demo_mode_not_set';
  if (env.DEMO_RESET_CONFIRM !== CONFIRM_VALUE) return 'confirm_not_set';
  if (!env.DEMO_RESET_DATABASE_URL) return 'reset_database_url_not_set';
  return null;
}

// The demo marker: the database name ends in _demo.
function hasDemoMarker(databaseName) {
  return typeof databaseName === 'string' && databaseName.endsWith(DEMO_DATABASE_SUFFIX);
}

// Tables that are never deleted from: the migration table and the audit log. A name that
// starts with "audit" is kept as well, so a future audit table fails safe.
function isKeptTable(name) {
  const lower = name.toLowerCase();
  return lower === MIGRATIONS_TABLE || lower.startsWith('audit');
}

function quote(name) {
  return `\`${name}\``;
}

async function currentDatabase(connection) {
  const [rows] = await connection.query('SELECT DATABASE() AS name');
  return rows.length > 0 ? rows[0].name : null;
}

async function listTables(connection) {
  const [rows] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  return rows.map((row) => row.name);
}

async function countRows(queryable, table) {
  const [rows] = await queryable.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`);
  return Number(rows[0].n);
}

// Deletes the rows of the given tables in one transaction, with foreign key checks off only
// around it. Returns the deleted row count of each table, by name.
async function deleteRows(connection, tables) {
  const deleted = {};
  let checksOff = false;
  let restored = true;
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    checksOff = true;
    await connection.query('START TRANSACTION');
    try {
      for (const table of tables) {
        const [result] = await connection.query(`DELETE FROM ${quote(table)}`);
        deleted[table] = Number(result.affectedRows);
      }
      await connection.query('COMMIT');
    } catch (error) {
      try {
        await connection.query('ROLLBACK');
      } catch {
        // The original error is the one to report.
      }
      throw error;
    }
  } finally {
    if (checksOff) {
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch {
        restored = false;
      }
    }
    if (!restored && typeof connection.destroy === 'function') {
      // Never hand a connection with the checks off back to the pool.
      connection.destroy();
      connection.destroyed = true;
    }
  }
  return deleted;
}

// The seed that the reset loads. The audit collection is left out: the audit rows stay, and
// the same ids with other times would conflict with them.
function seedDocuments(now) {
  return { ...generateSeed(now), audit: [] };
}

// Resets the database behind `pool`. `store` is the loader store. `isDemoMarker` is a test hook.
async function resetDemo(pool, { store, now = Date.now(), isDemoMarker = hasDemoMarker } = {}) {
  const connection = await pool.getConnection();
  let deleted;
  let keptTables;
  const keptBefore = {};
  try {
    if (!isDemoMarker(await currentDatabase(connection))) {
      throw new ResetRefused('not_demo_database');
    }
    const tables = await listTables(connection);
    if (!tables.includes(MIGRATIONS_TABLE)) {
      throw new ResetRefused('schema_missing');
    }
    keptTables = tables.filter(isKeptTable);
    const targets = tables.filter((name) => !isKeptTable(name));
    if (!targets.every((name) => SAFE_TABLE_NAME.test(name)) || !keptTables.every((name) => SAFE_TABLE_NAME.test(name))) {
      throw new ResetRefused('unsafe_table_name');
    }
    for (const table of keptTables) {
      keptBefore[table] = await countRows(connection, table);
    }
    deleted = await deleteRows(connection, targets);
  } finally {
    if (!connection.destroyed) connection.release();
  }

  const report = await loadCollections(seedDocuments(now), store);

  const kept = {};
  for (const table of keptTables) {
    kept[table] = { before: keptBefore[table], after: await countRows(pool, table) };
  }
  const loaded = {};
  for (const [name, stats] of Object.entries(report.collections)) {
    loaded[name] = { read: stats.read, inserted: stats.inserted, unchanged: stats.unchanged, rejected: stats.rejected };
  }
  return { deleted, loaded, kept, rejected: report.totals.rejected };
}

module.exports = {
  ResetRefused,
  checkEnvironment,
  hasDemoMarker,
  isKeptTable,
  resetDemo,
  seedDocuments,
  MIGRATIONS_TABLE,
};
