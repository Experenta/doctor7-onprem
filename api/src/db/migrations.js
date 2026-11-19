'use strict';

// Applies and reverts SQL migrations. Each file in api/migrations has an
// "-- migrate:up" section and an "-- migrate:down" section. Applied versions are
// recorded in schema_migrations. The runner splits statements on semicolons, so
// a migration must not use a semicolon inside a comment or a string literal.

const fs = require('node:fs');
const path = require('node:path');
const { createPool } = require('./database');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const UP_MARKER = '-- migrate:up';
const DOWN_MARKER = '-- migrate:down';
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_NAME = 'doctor7_onprem_migrations';
const LOCK_TIMEOUT_SECONDS = 30;
const USAGE = 'Usage: node src/db/migrations.js up | down [steps] | status\n';

function splitStatements(section) {
  return section
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function parseMigration(version, text) {
  const lines = text.split(/\r?\n/);
  const upIndex = lines.findIndex((line) => line.trim() === UP_MARKER);
  const downIndex = lines.findIndex((line) => line.trim() === DOWN_MARKER);
  if (upIndex === -1 || downIndex === -1 || downIndex < upIndex) {
    throw new Error(`Migration ${version} must contain ${UP_MARKER} followed by ${DOWN_MARKER}.`);
  }

  const up = splitStatements(lines.slice(upIndex + 1, downIndex).join('\n'));
  const down = splitStatements(lines.slice(downIndex + 1).join('\n'));
  if (up.length === 0 || down.length === 0) {
    throw new Error(`Migration ${version} has an empty up or down section.`);
  }
  return { version, up, down };
}

function loadMigrations(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name))
    .sort()
    .map((name) => {
      const version = name.slice(0, -'.sql'.length);
      return parseMigration(version, fs.readFileSync(path.join(dir, name), 'utf8'));
    });
}

async function ensureVersionTable(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    applied_at DATETIME(3) NOT NULL,
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function appliedVersions(connection) {
  const [rows] = await connection.query('SELECT version FROM schema_migrations ORDER BY version ASC');
  return rows.map((row) => row.version);
}

// Runs fn while holding a named server lock, so two processes cannot migrate at once.
async function withMigrationLock(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await ensureVersionTable(connection);
    const [rows] = await connection.execute('SELECT GET_LOCK(?, ?) AS locked', [
      LOCK_NAME,
      LOCK_TIMEOUT_SECONDS,
    ]);
    if (Number(rows[0].locked) !== 1) {
      throw new Error('Could not acquire the migration lock.');
    }
    try {
      return await fn(connection);
    } finally {
      await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    connection.release();
  }
}

// Applies every migration that is not recorded yet. Returns the versions applied.
// DDL statements commit implicitly, so a failed run can leave partial tables. Each
// CREATE uses IF NOT EXISTS, so running `up` again completes the work.
async function up(pool, migrations = loadMigrations()) {
  return withMigrationLock(pool, async (connection) => {
    const applied = new Set(await appliedVersions(connection));
    const pending = migrations.filter((migration) => !applied.has(migration.version));
    for (const migration of pending) {
      for (const statement of migration.up) {
        await connection.query(statement);
      }
      await connection.execute(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP(3))',
        [migration.version]
      );
    }
    return pending.map((migration) => migration.version);
  });
}

// Reverts the most recently applied migrations. Returns the versions reverted.
async function down(pool, migrations = loadMigrations(), steps = 1) {
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new RangeError('steps must be a positive integer.');
  }
  return withMigrationLock(pool, async (connection) => {
    const applied = await appliedVersions(connection);
    const targets = applied.slice(-steps).reverse();
    for (const version of targets) {
      const migration = migrations.find((candidate) => candidate.version === version);
      if (!migration) {
        throw new Error(`Applied migration ${version} has no matching file.`);
      }
      for (const statement of migration.down) {
        await connection.query(statement);
      }
      await connection.execute('DELETE FROM schema_migrations WHERE version = ?', [version]);
    }
    return targets;
  });
}

async function status(pool, migrations = loadMigrations()) {
  return withMigrationLock(pool, async (connection) => {
    const applied = await appliedVersions(connection);
    const pending = migrations
      .map((migration) => migration.version)
      .filter((version) => !applied.includes(version));
    return { applied, pending };
  });
}

async function main(argv, env = process.env) {
  const [command, stepsArg = '1'] = argv;
  if (!['up', 'down', 'status'].includes(command)) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (command === 'down' && (!/^\d+$/.test(stepsArg) || Number(stepsArg) < 1)) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (!env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 1;
  }

  const migrations = loadMigrations();
  const pool = createPool(env.DATABASE_URL);
  try {
    if (command === 'up') {
      const applied = await up(pool, migrations);
      process.stdout.write(`applied: ${applied.length > 0 ? applied.join(', ') : 'none'}\n`);
    } else if (command === 'down') {
      const reverted = await down(pool, migrations, Number(stepsArg));
      process.stdout.write(`reverted: ${reverted.length > 0 ? reverted.join(', ') : 'none'}\n`);
    } else {
      const state = await status(pool, migrations);
      process.stdout.write(`applied: ${state.applied.join(', ') || 'none'}\n`);
      process.stdout.write(`pending: ${state.pending.join(', ') || 'none'}\n`);
    }
  } finally {
    await pool.end();
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`migration failed: ${err.message}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = { MIGRATIONS_DIR, parseMigration, loadMigrations, up, down, status, main };
