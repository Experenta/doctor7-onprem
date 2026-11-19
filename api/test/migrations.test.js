'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMigrations, parseMigration } = require('../src/db/migrations');

const migrations = loadMigrations();

function createdTables(statements) {
  return statements.map((statement) => {
    const match = statement.match(/^CREATE TABLE IF NOT EXISTS (\w+)/);
    return match ? match[1] : null;
  });
}

test('the migration directory has at least one migration with unique, sorted versions', () => {
  assert.ok(migrations.length >= 1);
  const versions = migrations.map((m) => m.version);
  assert.deepEqual(versions, [...new Set(versions)].sort());
});

test('every migration has non-empty up and down sections', () => {
  for (const migration of migrations) {
    assert.ok(migration.up.length > 0, `${migration.version} has no up statements`);
    assert.ok(migration.down.length > 0, `${migration.version} has no down statements`);
  }
});

test('the down section drops exactly the tables the up section creates', () => {
  for (const migration of migrations.filter((m) => m.up.every((s) => s.startsWith('CREATE TABLE')))) {
    const created = createdTables(migration.up);
    assert.ok(created.every(Boolean), `${migration.version} has a non-CREATE up statement`);
    const dropped = migration.down.map((statement) => {
      const match = statement.match(/^DROP TABLE IF EXISTS (\w+)$/);
      assert.ok(match, `${migration.version} down statement is not DROP TABLE IF EXISTS: ${statement}`);
      return match[1];
    });
    assert.deepEqual([...dropped].sort(), [...created].sort());
  }
});

test('CREATE statements are idempotent, and ALTER statements touch only the tables they may', () => {
  for (const migration of migrations) {
    for (const statement of migration.up) {
      if (statement.startsWith('CREATE')) {
        assert.match(statement, /^CREATE TABLE IF NOT EXISTS /);
      } else if (migration.version === '0004_query_indexes') {
        assert.match(statement, /^ALTER TABLE (appointments|audit_log|chat_messages)\n/, `${migration.version} alters another table`);
      } else {
        assert.match(statement, /^ALTER TABLE audit_log\n/, `${migration.version} alters another table`);
      }
    }
  }
});

// The indexes that 0004 adds: name -> table and columns. Each one has a query in docs/PERFORMANCE.md.
const QUERY_INDEXES = {
  ix_appointments_center_professional_start: { table: 'appointments', columns: ['center_id', 'professional_id', 'starts_at'] },
  ix_appointments_center_client_start: { table: 'appointments', columns: ['center_id', 'client_id', 'starts_at'] },
  ix_audit_log_center_occurred: { table: 'audit_log', columns: ['center_id', 'occurred_at'] },
  ix_chat_messages_sent: { table: 'chat_messages', columns: ['sent_at'] },
};

test('the index migration only adds and drops indexes, one ALTER TABLE per table', () => {
  const indexes = migrations.find((m) => m.version === '0004_query_indexes');
  assert.ok(indexes, '0004_query_indexes is missing');
  for (const statement of [...indexes.up, ...indexes.down]) {
    assert.match(statement, /^ALTER TABLE \w+\n/);
    for (const line of statement.split('\n').slice(1)) {
      assert.match(line.trim(), /^(ADD INDEX \w+ \([\w, ]+\)|DROP INDEX \w+),?$/, `unexpected line: ${line}`);
    }
  }
  assert.doesNotMatch(indexes.up.join('\n') + indexes.down.join('\n'), /IF (NOT )?EXISTS/i);
});

test('the index migration adds exactly the agreed indexes, and its down direction reverts them', () => {
  const indexes = migrations.find((m) => m.version === '0004_query_indexes');
  const added = new Map();
  for (const statement of indexes.up) {
    const table = statement.match(/^ALTER TABLE (\w+)/)[1];
    for (const [, name, columns] of statement.matchAll(/ADD INDEX (\w+) \(([^)]+)\)/g)) {
      added.set(name, { table, columns: columns.split(', ') });
    }
  }
  assert.deepEqual(added, new Map(Object.entries(QUERY_INDEXES)));

  const dropped = new Map();
  for (const statement of indexes.down) {
    const table = statement.match(/^ALTER TABLE (\w+)/)[1];
    for (const [, name] of statement.matchAll(/DROP INDEX (\w+)/g)) {
      dropped.set(name, table);
    }
  }
  assert.deepEqual(
    [...dropped].sort(),
    Object.entries(QUERY_INDEXES).map(([name, { table }]) => [name, table]).sort()
  );
});

test('every index the migration adds is justified in docs/PERFORMANCE.md', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'PERFORMANCE.md'), 'utf8');
  for (const name of Object.keys(QUERY_INDEXES)) {
    assert.match(doc, new RegExp(`^\\|.*\`${name}\``, 'm'), `${name} has no row in docs/PERFORMANCE.md`);
  }
});

test('the audit columns migration has one ALTER per direction and no IF EXISTS on DROP COLUMN', () => {
  const audit = migrations.find((m) => m.version === '0003_audit_columns');
  assert.ok(audit, '0003_audit_columns is missing');
  assert.equal(audit.up.length, 1, 'the up direction must be a single statement');
  assert.equal(audit.down.length, 1, 'the down direction must be a single statement');
  assert.ok(!/IF EXISTS/i.test(audit.down[0]), 'DROP COLUMN must not use IF EXISTS');
});

test('the audit columns migration adds exactly the agreed columns with the agreed types', () => {
  const [up] = migrations.find((m) => m.version === '0003_audit_columns').up;
  assert.match(up, /ADD COLUMN center_id VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL/);
  assert.match(up, /ADD COLUMN outcome ENUM\('success', 'denied', 'failure'\) NOT NULL/);
  assert.match(up, /ADD COLUMN ip VARCHAR\(45\) NULL/);
  assert.match(up, /ADD COLUMN reason VARCHAR\(100\) NULL/);
  assert.equal((up.match(/ADD COLUMN/g) || []).length, 4, 'expected exactly four added columns');
});

test('the audit columns migration reverts exactly the columns it adds', () => {
  const [down] = migrations.find((m) => m.version === '0003_audit_columns').down;
  const dropped = [...down.matchAll(/DROP COLUMN (\w+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(dropped, ['center_id', 'ip', 'outcome', 'reason']);
});


test('ids, foreign keys, and emails use the binary collation', () => {
  const columnLine = /^\s*(\w+)\s+(VARCHAR|CHAR)\(\d+\)(.*)$/;
  let checked = 0;
  for (const migration of migrations) {
    for (const statement of migration.up) {
      for (const line of statement.split('\n')) {
        const match = line.match(columnLine);
        if (!match) continue;
        const [, name, , rest] = match;
        if (name === 'id' || name === 'email' || name.endsWith('_id')) {
          checked += 1;
          assert.match(rest, /COLLATE utf8mb4_bin/, `${name} must use utf8mb4_bin`);
        }
      }
    }
  }
  assert.ok(checked >= 10, `expected to check many id columns, checked ${checked}`);
});

test('the schema declares exactly the application and sign-in tables', () => {
  const names = migrations.flatMap((m) => createdTables(m.up)).filter(Boolean);
  assert.deepEqual(
    [...names].sort(),
    [
      'appointments',
      'audit_log',
      'centers',
      'chat_messages',
      'consultations',
      'login_attempts',
      'meetings',
      'sessions',
      'users',
    ]
  );
});

test('the meetings migration keys the table by appointment, cascades on delete, and drops only that table', () => {
  const meetings = migrations.find((m) => m.version === '0005_meetings');
  assert.ok(meetings, '0005_meetings is missing');
  assert.equal(meetings.up.length, 1);
  const [up] = meetings.up;
  assert.match(up, /^CREATE TABLE IF NOT EXISTS meetings /);
  assert.match(up, /appointment_id VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
  assert.match(up, /provider ENUM\('meet', 'jitsi'\) NOT NULL/);
  assert.match(up, /url TEXT NOT NULL/);
  assert.match(up, /created_by VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
  assert.match(up, /created_at DATETIME\(3\) NOT NULL/);
  assert.match(up, /PRIMARY KEY \(appointment_id\)/);
  assert.match(up, /FOREIGN KEY \(appointment_id\) REFERENCES appointments \(id\) ON DELETE CASCADE/);
  assert.deepEqual(meetings.down, ['DROP TABLE IF EXISTS meetings']);
});

test('the meetings migration runs after the tables it references', () => {
  const versions = migrations.map((m) => m.version);
  assert.ok(versions.indexOf('0005_meetings') > versions.indexOf('0001_initial_schema'));
});

test('parseMigration rejects a file without a down section', () => {
  assert.throws(
    () => parseMigration('9999_broken', '-- migrate:up\nCREATE TABLE IF NOT EXISTS t (id INT);\n'),
    /must contain/
  );
});

test('parseMigration rejects markers in the wrong order', () => {
  assert.throws(
    () => parseMigration('9999_order', '-- migrate:down\nDROP TABLE IF EXISTS t;\n-- migrate:up\nCREATE TABLE IF NOT EXISTS t (id INT);\n'),
    /must contain/
  );
});

test('parseMigration splits statements and drops comment lines', () => {
  const parsed = parseMigration(
    '9999_sample',
    '-- header; ignored\n-- migrate:up\n-- note inside up\nCREATE TABLE IF NOT EXISTS a (id INT);\nCREATE TABLE IF NOT EXISTS b (id INT);\n-- migrate:down\nDROP TABLE IF EXISTS b;\nDROP TABLE IF EXISTS a;\n'
  );
  assert.equal(parsed.up.length, 2);
  assert.equal(parsed.down.length, 2);
  assert.ok(parsed.up.every((s) => !s.includes('note inside up')));
});
