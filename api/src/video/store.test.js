'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createSqlMeetingStore, DuplicateMeetingError } = require('./store');
const { createMemoryMeetingStore } = require('./memoryStore');
const { runMeetingStoreContract } = require('./storeContract');

// ---- The same battery against both stores ----

runMeetingStoreContract('meeting store (memory)', async () => {
  const store = createMemoryMeetingStore();
  let count = 0;
  return {
    store,
    newAppointment: async () => `a-mem-${(count += 1)}`,
    deleteAppointment: async (id) => store.deleteForAppointment(id),
    cleanup: async () => {},
  };
});

// The SQL run needs a MariaDB database. The database name must contain "test", because
// the setup applies the migrations. The URL is never printed.
const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP_SQL = DATABASE_URL ? false : 'DATABASE_URL is not set; the SQL meeting store tests are skipped.';

let sqlContext = null;

if (!SKIP_SQL) {
  const { createDatabase, createPool } = require('../db/database');
  const { loadMigrations, up } = require('../db/migrations');

  before(async () => {
    const name = decodeURIComponent(new URL(DATABASE_URL).pathname.replace(/^\//, ''));
    if (!/test/i.test(name)) {
      throw new Error('Refusing to run: the database name in DATABASE_URL must contain "test".');
    }
    const pool = createPool(DATABASE_URL);
    const db = createDatabase(pool);
    await up(pool, loadMigrations());
    sqlContext = { pool, db };
  });

  after(async () => {
    if (sqlContext) await sqlContext.db.close();
  });
}

runMeetingStoreContract(
  'meeting store (SQL)',
  async () => {
    const { db } = sqlContext;
    const { createRepositories } = require('../repositories/tables');
    const repos = createRepositories(db);
    const suffix = randomUUID().slice(0, 8);
    const centerId = `mc-${suffix}`;
    const professionalId = `mp-${suffix}`;
    const clientId = `mu-${suffix}`;
    const at = new Date('2026-12-01T15:00:00.000Z');
    const appointmentIds = [];
    await repos.centers.insert({ id: centerId, name: 'Meeting test center', created_at: at });
    for (const [id, role] of [[professionalId, 'professional'], [clientId, 'client']]) {
      await repos.users.insert({
        id,
        center_id: centerId,
        email: `${id}@example.test`,
        display_name: id,
        role,
        created_at: at,
      });
    }

    return {
      store: createSqlMeetingStore(db),
      async newAppointment() {
        const id = `ma-${suffix}-${appointmentIds.length}`;
        appointmentIds.push(id);
        await repos.appointments.insert({
          id,
          center_id: centerId,
          professional_id: professionalId,
          client_id: clientId,
          starts_at: at,
          ends_at: new Date(at.getTime() + 50 * 60 * 1000),
          status: 'scheduled',
          created_at: at,
        });
        return id;
      },
      deleteAppointment: (id) => db.execute('DELETE FROM appointments WHERE id = ?', [id]),
      async cleanup() {
        for (const id of appointmentIds) await db.execute('DELETE FROM appointments WHERE id = ?', [id]);
        await db.execute('DELETE FROM users WHERE center_id = ?', [centerId]);
        await db.execute('DELETE FROM centers WHERE id = ?', [centerId]);
      },
    };
  },
  { skip: SKIP_SQL }
);

// ---- SQL text and error mapping, without a database ----

function recordingDb({ rows = [], failInsert = null } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT') && failInsert) throw failInsert;
      return rows;
    },
  };
}

test('the SQL store binds every value, so hostile text never enters the statement', async () => {
  const hostile = "x'); DROP TABLE meetings; --";
  const row = {
    appointment_id: 'a1',
    provider: 'jitsi',
    url: hostile,
    created_by: 'u-pro1',
    created_at: '2026-12-01 15:00:00.123',
  };
  const db = recordingDb({ rows: [row] });
  const stored = await createSqlMeetingStore(db).insertMeeting({
    appointmentId: 'a1',
    provider: 'jitsi',
    url: hostile,
    createdBy: 'u-pro1',
    createdAt: new Date('2026-12-01T15:00:00.123Z'),
  });
  const insert = db.calls.find((call) => call.sql.startsWith('INSERT'));
  assert.match(insert.sql, /^INSERT INTO `meetings` \(`appointment_id`, `provider`, `url`, `created_by`, `created_at`\) VALUES \(\?, \?, \?, \?, \?\)$/);
  assert.deepEqual(insert.params, ['a1', 'jitsi', hostile, 'u-pro1', '2026-12-01 15:00:00.123']);
  assert.equal(stored.url, hostile);
  assert.equal(stored.createdAt.toISOString(), '2026-12-01T15:00:00.123Z');
});

test('the SQL store turns a duplicate primary key into DuplicateMeetingError and keeps other errors', async () => {
  const meeting = { appointmentId: 'a1', provider: 'jitsi', url: 'u', createdBy: 'u-pro1', createdAt: new Date(0) };
  for (const failure of [{ code: 'ER_DUP_ENTRY' }, { errno: 1062 }]) {
    const store = createSqlMeetingStore(recordingDb({ failInsert: Object.assign(new Error('driver text'), failure) }));
    await assert.rejects(store.insertMeeting(meeting), DuplicateMeetingError);
  }
  const other = Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
  await assert.rejects(createSqlMeetingStore(recordingDb({ failInsert: other })).insertMeeting(meeting), /connection lost/);
});

test('the SQL store reads null when no row matches', async () => {
  assert.equal(await createSqlMeetingStore(recordingDb({ rows: [] })).findMeeting('missing'), null);
});
