'use strict';

// Tests of the demo reset with a fake database. They always run. The fake applies the rules that
// matter here: it lists tables like information_schema, it keeps a statement log, and it throws if
// the audit log or schema_migrations is ever deleted from.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { main } = require('../reset-demo');
const { isKeptTable, hasDemoMarker, checkEnvironment } = require('../lib/reset');
const { COLLECTIONS, StoreError } = require('../lib/collections');

const NOW = Date.UTC(2026, 10, 19, 5, 10, 51, 908);
const FAKE_URL = 'mysql://reset:placeholder-pw@db.example.test/doctor7_demo';
const GOOD_ENV = { DEMO_MODE: '1', DEMO_RESET_CONFIRM: 'erase-demo-data', DEMO_RESET_DATABASE_URL: FAKE_URL };
const TABLES = [
  'appointments', 'audit_log', 'centers', 'chat_messages', 'consultations',
  'login_attempts', 'meetings', 'schema_migrations', 'sessions', 'users',
];

// A database with the tables of the K-02 to K-35 schema, visitor rows, audit rows, and migration rows.
function createFakeDatabase({ name = 'doctor7_demo', extraTables = [], withMigrationTable = true } = {}) {
  const tables = new Map();
  const names = TABLES.filter((table) => withMigrationTable || table !== 'schema_migrations');
  for (const table of [...names, ...extraTables]) tables.set(table, new Map());
  const log = [];
  const state = { checksOn: true, inTransaction: false, forbidden: 0, inserts: 0 };

  function put(table, id, row = { id }) {
    tables.get(table).set(id, row);
  }

  const connection = {
    destroyed: false,
    async query(sql) {
      log.push(sql);
      let match;
      if (sql === 'SELECT DATABASE() AS name') return [[{ name }]];
      if (sql.includes('information_schema.tables')) {
        return [[...tables.keys()].sort().map((table) => ({ name: table }))];
      }
      if ((match = /^SELECT COUNT\(\*\) AS n FROM `(\w+)`$/.exec(sql))) return [[{ n: tables.get(match[1]).size }]];
      if (sql === 'SET FOREIGN_KEY_CHECKS = 0') { state.checksOn = false; return [{}]; }
      if (sql === 'SET FOREIGN_KEY_CHECKS = 1') { state.checksOn = true; return [{}]; }
      if (sql === 'START TRANSACTION') { state.inTransaction = true; return [{}]; }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') { state.inTransaction = false; return [{}]; }
      if ((match = /^DELETE FROM `(\w+)`$/.exec(sql))) {
        const table = match[1];
        if (table === 'audit_log' || table === 'schema_migrations') {
          state.forbidden += 1;
          throw new Error('forbidden delete');
        }
        assert.ok(state.inTransaction, 'DELETE runs inside the transaction');
        assert.equal(state.checksOn, false, 'DELETE runs with foreign key checks off');
        const count = tables.get(table).size;
        tables.get(table).clear();
        return [{ affectedRows: count }];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
    release() { log.push('release'); },
    destroy() { this.destroyed = true; },
  };
  const pool = {
    async getConnection() { return connection; },
    query: (sql) => connection.query(sql),
    async end() { log.push('end'); },
  };

  // The loader store over the same tables.
  const store = {
    async get(def, id) {
      const row = tables.get(def.table).get(id);
      return row ? { ...row } : null;
    },
    async insert(def, row) {
      if (tables.get(def.table).has(row.id)) throw new StoreError('duplicate');
      state.inserts += 1;
      tables.get(def.table).set(row.id, { ...row });
    },
  };

  function addVisitorData() {
    put('appointments', 'apt-visitor');
    put('chat_messages', 'msg-visitor');
    put('consultations', 'cons-visitor');
    put('meetings', 'apt-visitor');
    put('sessions', 'session-hash');
    put('login_attempts', 'state-hash');
    for (const table of extraTables) put(table, 'visitor-row');
  }
  function addKeptData() {
    put('audit_log', 'audit-old-1');
    put('audit_log', 'audit-old-2');
    put('audit_log', 'audit-old-3');
    if (tables.has('schema_migrations')) {
      for (const version of ['0001_initial_schema', '0002_sessions']) put('schema_migrations', version, { version });
    }
  }
  const sizes = () => Object.fromEntries([...tables].map(([table, rows]) => [table, rows.size]));
  const mutating = () => log.filter((sql) => /^(SET|START|DELETE|COMMIT|ROLLBACK)/.test(sql));
  // Rows of the tables the reset owns, for comparing two runs.
  const snapshot = () =>
    JSON.stringify([...tables].filter(([table]) => !isKeptTable(table)).map(([table, rows]) => [table, [...rows.entries()].sort()]));

  return { tables, log, state, pool, store, connection, addVisitorData, addKeptData, sizes, mutating, snapshot };
}

function run(env, fake, extraDeps = {}) {
  const out = { stdout: '', stderr: '' };
  const created = { pools: 0 };
  const deps = {
    createPool: () => { created.pools += 1; return fake.pool; },
    createStore: () => fake.store,
    now: NOW,
    ...extraDeps,
  };
  return main([], env, { stdout: (t) => { out.stdout += t; }, stderr: (t) => { out.stderr += t; } }, deps).then((code) => ({ code, ...out, created }));
}

describe('safeguards: the script refuses and changes nothing', () => {
  const refusals = [
    ['no variable at all', {}, 'demo_mode_not_set'],
    ['DEMO_MODE missing', { ...GOOD_ENV, DEMO_MODE: undefined }, 'demo_mode_not_set'],
    ['DEMO_MODE is not exactly 1', { ...GOOD_ENV, DEMO_MODE: 'true' }, 'demo_mode_not_set'],
    ['confirmation missing', { ...GOOD_ENV, DEMO_RESET_CONFIRM: undefined }, 'confirm_not_set'],
    ['confirmation wrong', { ...GOOD_ENV, DEMO_RESET_CONFIRM: 'yes' }, 'confirm_not_set'],
    ['reset URL missing', { ...GOOD_ENV, DEMO_RESET_DATABASE_URL: undefined }, 'reset_database_url_not_set'],
    ['reset URL empty', { ...GOOD_ENV, DEMO_RESET_DATABASE_URL: '' }, 'reset_database_url_not_set'],
    ['only the API URL is set', { DEMO_MODE: '1', DEMO_RESET_CONFIRM: 'erase-demo-data', DATABASE_URL: FAKE_URL }, 'reset_database_url_not_set'],
  ];
  for (const [title, env, code] of refusals) {
    test(`${title}: exit 1, no connection, no statement`, async () => {
      const fake = createFakeDatabase();
      fake.addVisitorData();
      fake.addKeptData();
      const before = fake.sizes();
      const result = await run(env, fake);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`Reset refused: ${code}`));
      assert.equal(result.created.pools, 0, 'no pool was created');
      assert.deepEqual(fake.log, []);
      assert.deepEqual(fake.sizes(), before);
      assert.equal(result.stdout, '');
    });
  }

  test('a database without the demo marker: exit 1 and no write statement', async () => {
    for (const name of ['doctor7', 'doctor7_prod', 'doctor7_demo_old', 'demo', null]) {
      const fake = createFakeDatabase({ name });
      fake.addVisitorData();
      fake.addKeptData();
      const before = fake.sizes();
      const result = await run(GOOD_ENV, fake);
      assert.equal(result.code, 1, String(name));
      assert.match(result.stderr, /Reset refused: not_demo_database/);
      assert.deepEqual(fake.mutating(), [], String(name));
      assert.equal(fake.state.inserts, 0);
      assert.deepEqual(fake.sizes(), before);
      assert.ok(fake.log.includes('release') && fake.log.includes('end'), 'connection released and pool closed');
    }
  });

  test('a database without schema_migrations: exit 1 and no write statement', async () => {
    const fake = createFakeDatabase({ withMigrationTable: false });
    fake.addVisitorData();
    const before = fake.sizes();
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Reset refused: schema_missing/);
    assert.deepEqual(fake.mutating(), []);
    assert.deepEqual(fake.sizes(), before);
  });

  test('a table name that is not plain stops the run before any delete', async () => {
    const fake = createFakeDatabase({ extraTables: ['odd`name'] });
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unsafe_table_name/);
    assert.deepEqual(fake.mutating(), []);
  });

  test('the marker is a name ending in _demo, and the environment check is exact', () => {
    assert.equal(hasDemoMarker('doctor7_demo'), true);
    assert.equal(hasDemoMarker('doctor7_demo2'), false);
    assert.equal(hasDemoMarker('doctor7'), false);
    assert.equal(hasDemoMarker(null), false);
    assert.equal(checkEnvironment(GOOD_ENV), null);
  });

  test('arguments are not accepted', async () => {
    const fake = createFakeDatabase();
    const out = { stderr: '' };
    const code = await main(['--force'], GOOD_ENV, { stdout() {}, stderr: (t) => { out.stderr += t; } }, { createPool: () => fake.pool });
    assert.equal(code, 1);
    assert.deepEqual(fake.log, []);
  });
});

describe('the reset', () => {
  test('deletes in one transaction with checks off, restores them, and never touches the audit log or migrations', async () => {
    const fake = createFakeDatabase();
    fake.addVisitorData();
    fake.addKeptData();
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fake.state.forbidden, 0);

    const writes = fake.mutating();
    const expectedTables = ['appointments', 'centers', 'chat_messages', 'consultations', 'login_attempts', 'meetings', 'sessions', 'users'];
    assert.deepEqual(writes, [
      'SET FOREIGN_KEY_CHECKS = 0',
      'START TRANSACTION',
      ...expectedTables.map((table) => `DELETE FROM \`${table}\``),
      'COMMIT',
      'SET FOREIGN_KEY_CHECKS = 1',
    ]);
    assert.equal(fake.state.checksOn, true);
    assert.equal(fake.state.inTransaction, false);
    assert.ok(!fake.log.some((sql) => /audit_log|schema_migrations/.test(sql) && !/^SELECT COUNT/.test(sql) && !sql.includes('information_schema')));
    assert.ok(!fake.log.some((sql) => /TRUNCATE|DROP/i.test(sql)));

    // Visitor rows are gone, the seed is back, the kept tables are intact.
    for (const table of ['meetings', 'sessions', 'login_attempts']) assert.equal(fake.tables.get(table).size, 0, table);
    assert.equal(fake.tables.get('appointments').has('apt-visitor'), false);
    assert.equal(fake.tables.get('appointments').has('apt-01'), true);
    assert.equal(fake.tables.get('users').has('u-ana'), true);
    assert.equal(fake.tables.get('audit_log').size, 3);
    assert.equal(fake.tables.get('schema_migrations').size, 2);
  });

  test('the report names every deleted table and every loaded table, and the kept counts', async () => {
    const fake = createFakeDatabase();
    fake.addVisitorData();
    fake.addKeptData();
    const result = await run(GOOD_ENV, fake);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(report.deleted).sort(), ['appointments', 'centers', 'chat_messages', 'consultations', 'login_attempts', 'meetings', 'sessions', 'users']);
    assert.equal(report.deleted.appointments, 1);
    assert.deepEqual(Object.keys(report.loaded).sort(), COLLECTIONS.map((def) => def.name).sort());
    assert.equal(report.loaded.audit.read, 0, 'the audit seed is not reloaded');
    assert.ok(report.loaded.appointments.inserted > 0);
    assert.deepEqual(report.kept, { audit_log: { before: 3, after: 3 }, schema_migrations: { before: 2, after: 2 } });
  });

  test('a table that did not exist when the script was written is emptied too, with no change to the script', async () => {
    const fake = createFakeDatabase({ extraTables: ['clients', 'records', 'form_revisions'] });
    fake.addVisitorData();
    fake.addKeptData();
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 0, result.stderr);
    for (const table of ['clients', 'records', 'form_revisions']) {
      assert.equal(fake.tables.get(table).size, 0, table);
      assert.ok(fake.log.includes(`DELETE FROM \`${table}\``), table);
      assert.equal(JSON.parse(result.stdout).deleted[table], 1);
    }
    assert.equal(fake.tables.get('audit_log').size, 3);
    assert.equal(fake.tables.get('schema_migrations').size, 2);
  });

  test('an audit table added later is kept as well', async () => {
    const fake = createFakeDatabase({ extraTables: ['audit_archive'] });
    fake.addVisitorData();
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fake.tables.get('audit_archive').size, 1);
    assert.ok(!fake.log.includes('DELETE FROM `audit_archive`'));
  });

  test('a second run leaves the same state', async () => {
    const fake = createFakeDatabase({ extraTables: ['clients'] });
    fake.addVisitorData();
    fake.addKeptData();
    assert.equal((await run(GOOD_ENV, fake)).code, 0);
    const first = fake.snapshot();
    const keptFirst = fake.sizes();
    fake.addVisitorData();
    const second = await run(GOOD_ENV, fake);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(fake.snapshot(), first);
    assert.deepEqual(fake.sizes(), keptFirst);
  });

  test('a failed delete rolls back, restores the checks, and does not load the seed', async () => {
    const fake = createFakeDatabase();
    fake.addVisitorData();
    const original = fake.connection.query;
    fake.connection.query = async (sql) => {
      if (sql === 'DELETE FROM `meetings`') {
        fake.log.push(sql);
        throw Object.assign(new Error(`driver text with ${FAKE_URL}`), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      }
      return original(sql);
    };
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Reset stopped: ER_LOCK_WAIT_TIMEOUT/);
    assert.ok(fake.log.includes('ROLLBACK'));
    assert.equal(fake.state.checksOn, true);
    assert.equal(fake.state.inserts, 0);
    assert.ok(!result.stderr.includes('placeholder-pw'));
  });

  test('a connection that cannot restore the checks is destroyed, never reused', async () => {
    const fake = createFakeDatabase();
    const original = fake.connection.query;
    fake.connection.query = async (sql) => {
      if (sql === 'SET FOREIGN_KEY_CHECKS = 1') throw new Error('lost connection');
      return original(sql);
    };
    await run(GOOD_ENV, fake);
    assert.equal(fake.connection.destroyed, true);
    assert.ok(!fake.log.includes('release'));
  });

  test('exit code 2 when seed rows are rejected', async () => {
    const fake = createFakeDatabase();
    const original = fake.store.insert;
    fake.store.insert = async (def, row) => {
      if (def.name === 'messages') throw new StoreError('missing_reference');
      return original(def, row);
    };
    const result = await run(GOOD_ENV, fake);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /seed rows were rejected/);
  });
});

describe('output never carries the URL or a credential', () => {
  test('stdout and stderr hold neither the URL nor its parts, on success or failure', async () => {
    const pieces = ['placeholder-pw', 'db.example.test', 'mysql://'];
    const ok = createFakeDatabase();
    const success = await run(GOOD_ENV, ok);
    const refused = await run(GOOD_ENV, createFakeDatabase({ name: 'other' }));
    const badUrl = await run(GOOD_ENV, ok, { createPool: () => { throw new Error(`bad ${FAKE_URL}`); } });
    assert.equal(badUrl.code, 1);
    assert.match(badUrl.stderr, /invalid_database_url/);
    for (const result of [success, refused, badUrl]) {
      for (const piece of pieces) {
        assert.ok(!result.stdout.includes(piece) && !result.stderr.includes(piece), piece);
      }
    }
  });
});

describe('the source', () => {
  const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  test('the reset holds no table list, no TRUNCATE, no DROP, and no DELETE on a written table name', () => {
    const text = `${source('lib/reset.js')}\n${source('reset-demo.js')}`;
    // SQL keywords are upper case in this code, so the checks are case-sensitive.
    assert.doesNotMatch(text, /TRUNCATE|DROP\s/);
    assert.doesNotMatch(text, /DELETE FROM\s+[^$`]/);
    assert.doesNotMatch(text, /DELETE FROM `?(audit_log|schema_migrations)/i);
    for (const table of ['appointments', 'chat_messages', 'consultations', 'meetings', 'sessions', 'users', 'centers']) {
      assert.ok(!text.includes(table), `${table} is not written in the reset code`);
    }
    assert.ok(text.includes('information_schema.tables'));
  });

  test('no URL, host, or credential is written in the reset code', () => {
    const text = `${source('lib/reset.js')}\n${source('reset-demo.js')}`;
    assert.doesNotMatch(text, /mysql:\/\/|mariadb:\/\/|https?:\/\//i);
  });
});
