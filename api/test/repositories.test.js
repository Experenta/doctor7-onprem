'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../src/repositories/createRepository');
const { createRepositories, TABLE_SPECS } = require('../src/repositories/tables');

// Records every statement and returns the rows it was given.
function recordingDb(rows = []) {
  const db = {
    calls: [],
    async execute(sql, params = []) {
      db.calls.push({ sql, params });
      return rows;
    },
  };
  return db;
}

const HOSTILE_IDS = [
  "x' OR '1'='1",
  'a;DROP TABLE users;--',
  'Ñandú-🙂',
  '"quoted"\\backslash',
];

test('hostile ids are bound as parameters and never change the SQL text', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await repos.users.findById('plain-id');
  for (const id of HOSTILE_IDS) {
    await repos.users.findById(id);
  }

  const sqlTexts = new Set(db.calls.map((call) => call.sql));
  assert.equal(sqlTexts.size, 1, 'the SQL text changed with the input');
  const [sql] = sqlTexts;
  for (const id of HOSTILE_IDS) {
    assert.ok(!sql.includes(id), `request value appears in SQL text: ${id}`);
  }
  assert.deepEqual(
    db.calls.slice(1).map((call) => call.params[0]),
    HOSTILE_IDS
  );
});

test('ids that differ only by letter case reach the database unchanged', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await repos.centers.findById('Clinic-A');
  await repos.centers.findById('clinic-a');
  assert.deepEqual(db.calls.map((call) => call.params[0]), ['Clinic-A', 'clinic-a']);
});

test('list applies the default page and binds nothing from the caller', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await repos.centers.list();
  assert.match(db.calls[0].sql, /LIMIT 50 OFFSET 0$/);
});

test('list accepts valid paging values and rejects out-of-range ones', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await repos.centers.list({ limit: 200, offset: 10 });
  assert.match(db.calls[0].sql, /LIMIT 200 OFFSET 10$/);

  for (const options of [
    { limit: 0 },
    { limit: 201 },
    { limit: 1.5 },
    { limit: '10' },
    { offset: -1 },
  ]) {
    await assert.rejects(() => repos.centers.list(options), RangeError);
  }
  assert.equal(db.calls.length, 1, 'rejected requests must not reach the database');
});

test('insert rejects unknown columns before touching the database', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await assert.rejects(
    () =>
      repos.centers.insert({
        id: 'c-1',
        name: 'Clinic',
        created_at: new Date(),
        'name; DROP TABLE centers': 'x',
      }),
    TypeError
  );
  assert.equal(db.calls.length, 0);
});

test('insert requires the primary key and rejects object values for plain columns', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await assert.rejects(() => repos.centers.insert({ name: 'No id', created_at: new Date() }), TypeError);
  await assert.rejects(
    () => repos.centers.insert({ id: 'c-2', name: { nested: true }, created_at: new Date() }),
    TypeError
  );
  assert.equal(db.calls.length, 0);
});

test('insert stores Dates as UTC text and JSON bodies as JSON text', async () => {
  const db = recordingDb();
  const repos = createRepositories(db);
  await repos.consultations.insert({
    id: 'k-1',
    appointment_id: 'a-1',
    body: { note: "O'Brien; DROP TABLE users; -- ñ 🙂" },
    created_at: new Date('2026-11-19T03:26:00.123Z'),
  });

  const [insert] = db.calls;
  assert.match(insert.sql, /^INSERT INTO `consultations` \(`id`, `appointment_id`, `body`, `created_at`\) VALUES \(\?, \?, \?, \?\)$/);
  assert.deepEqual(insert.params, [
    'k-1',
    'a-1',
    JSON.stringify({ note: "O'Brien; DROP TABLE users; -- ñ 🙂" }),
    '2026-11-19 03:26:00.123',
  ]);
});

test('findById parses JSON text returned by MariaDB', async () => {
  const db = recordingDb([
    { id: 'k-1', appointment_id: 'a-1', body: '{"score":3}', created_at: new Date(0) },
  ]);
  const repos = createRepositories(db);
  const row = await repos.consultations.findById('k-1');
  assert.deepEqual(row.body, { score: 3 });
});

test('findById returns null when no row matches', async () => {
  const repos = createRepositories(recordingDb([]));
  assert.equal(await repos.users.findById('missing'), null);
});

test('createRepository rejects identifiers that are not plain names', async () => {
  const db = recordingDb();
  assert.throws(() => createRepository(db, { table: 'users; DROP TABLE users', columns: ['id'] }), TypeError);
  assert.throws(() => createRepository(db, { table: 'users', columns: ['id', 'x`y'] }), TypeError);
  assert.throws(() => createRepository(db, { table: 'users', columns: ['name'] }), TypeError);
});

test('createRepositories exposes exactly the six tables', () => {
  const repos = createRepositories(recordingDb());
  assert.deepEqual(
    Object.keys(repos).sort(),
    ['appointments', 'audit_log', 'centers', 'chat_messages', 'consultations', 'users']
  );
  assert.equal(TABLE_SPECS.length, 6);
});
