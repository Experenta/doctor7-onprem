'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  for (const migration of migrations) {
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

test('CREATE and DROP statements are idempotent', () => {
  for (const migration of migrations) {
    for (const statement of migration.up) {
      assert.match(statement, /^CREATE TABLE IF NOT EXISTS /);
    }
  }
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
  const names = migrations.flatMap((m) => createdTables(m.up));
  assert.deepEqual(
    [...names].sort(),
    [
      'appointments',
      'audit_log',
      'centers',
      'chat_messages',
      'consultations',
      'login_attempts',
      'sessions',
      'users',
    ]
  );
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
