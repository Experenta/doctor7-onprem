'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqlChatStore } = require('./store');

// A database stand-in that records every statement and its parameters. SELECT
// statements return `rows`. DELETE statements return a result with affectedRows.
function recordingDb(rows = []) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('DELETE')) return { affectedRows: 3 };
      if (sql.startsWith('INSERT')) return { affectedRows: 1 };
      return rows;
    },
  };
}

const HOSTILE = "x'); DROP TABLE chat_messages; --";

test('a stored message binds every value as a parameter, so the text never enters the statement', async () => {
  const db = recordingDb([
    { id: 'm-1', appointment_id: 'a1', sender_id: 'u-cli1', body: HOSTILE, sent_at: '2026-12-01 15:00:00.000' },
  ]);
  const store = createSqlChatStore(db);
  await store.insertMessage({
    id: 'm-1',
    appointmentId: 'a1',
    senderId: 'u-cli1',
    body: HOSTILE,
    sentAt: new Date('2026-12-01T15:00:00.000Z'),
  });
  const insert = db.calls.find((call) => call.sql.startsWith('INSERT'));
  assert.ok(insert, 'an INSERT is issued');
  assert.ok(!insert.sql.includes('DROP'), 'the body is not in the statement text');
  assert.ok(insert.params.includes(HOSTILE), 'the body travels as a parameter');
  assert.ok(insert.params.includes('2026-12-01 15:00:00.000'), 'sent_at is written as UTC text');
});

test('the history query filters by appointment, orders newest first, and returns oldest first', async () => {
  const db = recordingDb([
    { id: 'm-3', appointment_id: 'a1', sender_id: 'u-pro1', body: 'third', sent_at: '2026-12-01 15:00:02.000' },
    { id: 'm-2', appointment_id: 'a1', sender_id: 'u-cli1', body: 'second', sent_at: '2026-12-01 15:00:01.000' },
  ]);
  const store = createSqlChatStore(db);
  const items = await store.listRecent('a1', 50);
  const select = db.calls.find((call) => call.sql.startsWith('SELECT'));
  assert.match(select.sql, /WHERE appointment_id = \?/);
  assert.match(select.sql, /ORDER BY sent_at DESC, id DESC LIMIT 50/);
  assert.deepEqual(select.params, ['a1']);
  assert.deepEqual(
    items.map((item) => item.body),
    ['second', 'third']
  );
  assert.ok(items[0].sentAt instanceof Date);
});

test('the history limit must be an integer from 1 to 200, and nothing reaches the database when it is not', async () => {
  const db = recordingDb();
  const store = createSqlChatStore(db);
  for (const limit of [0, -1, 201, 1.5, Number.NaN, '5']) {
    await assert.rejects(store.listRecent('a1', limit), RangeError, String(limit));
  }
  assert.equal(db.calls.length, 0);
});

test('a purge deletes messages older than the cutoff, bound as UTC text, and reports the count', async () => {
  const db = recordingDb();
  const store = createSqlChatStore(db);
  const removed = await store.deleteSentBefore(new Date('2026-09-01T00:00:00.000Z'));
  assert.equal(removed, 3);
  const del = db.calls[0];
  assert.equal(del.sql, 'DELETE FROM chat_messages WHERE sent_at < ?');
  assert.deepEqual(del.params, ['2026-09-01 00:00:00.000']);
});
