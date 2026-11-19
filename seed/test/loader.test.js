'use strict';

const path = require('node:path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { readInputDirectory, loadCollections, InputError } = require('../lib/loader');
const { generateSeed } = require('../lib/generator');
const { BY_NAME } = require('../lib/collections');
const { createMemoryStore } = require('./memory-store');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const REJECTIONS = path.join(FIXTURES, 'rejections');

// Expected rejections for seed/fixtures/rejections. Each row is explained in the
// fixture files and in docs/MIGRATION.md. Field values are never reported.
const EXPECTED_REJECTIONS = {
  centers: [
    { index: 1, id: 'rej-center', code: 'invalid_timestamp', field: 'createdAt' },
    { index: 2, id: null, code: 'invalid_id', field: 'id' },
    { index: 3, id: 'demo-center', code: 'duplicate_id', field: 'id' },
  ],
  users: [
    { index: 2, id: 'u-iris', code: 'conflict', field: null },
    { index: 3, id: 'u-marta', code: 'missing_reference', field: null },
    { index: 4, id: 'u-bad', code: 'invalid_field', field: 'email' },
  ],
  appointments: [
    { index: 1, id: 'apt-backwards', code: 'invalid_time_range', field: 'endsAt' },
    { index: 2, id: 'apt-swapped', code: 'participant_role', field: 'professionalId' },
    { index: 3, id: 'apt-no-client', code: 'missing_reference', field: 'clientId' },
  ],
  consultations: [
    { index: 1, id: 'cons-orphan', code: 'missing_reference', field: null },
    { index: 2, id: 'cons-array', code: 'invalid_field', field: 'body' },
  ],
  messages: [
    { index: 1, id: 'msg-precision', code: 'timestamp_precision', field: 'sentAt' },
    { index: 2, id: 'msg-stranger', code: 'not_participant', field: 'senderId' },
  ],
  audit: [
    { index: 1, id: 'audit-2', code: 'invalid_field', field: 'outcome' },
    { index: 3, id: null, code: 'not_object', field: null },
  ],
};

const EXPECTED_INSERTED = { centers: 1, users: 2, appointments: 1, consultations: 1, messages: 1, audit: 2 };

function rejectionsOf(report) {
  return Object.fromEntries(
    Object.entries(report.collections).map(([name, stats]) => [name, stats.rejections])
  );
}

describe('input files', () => {
  test('reads one array per collection from a directory', () => {
    const { documents, absent } = readInputDirectory(REJECTIONS);
    assert.deepEqual(absent, []);
    assert.equal(documents.centers.length, 4);
    assert.equal(documents.audit.length, 4);
  });

  test('a missing file counts as an absent, empty collection', () => {
    const { documents, absent } = readInputDirectory(FIXTURES);
    assert.deepEqual(absent, ['centers', 'users', 'appointments', 'consultations', 'messages', 'audit']);
    assert.deepEqual(documents.users, []);
  });

  test('invalid JSON stops the read with a code that names the file only', () => {
    assert.throws(
      () => readInputDirectory(path.join(FIXTURES, 'malformed')),
      (error) => error instanceof InputError && error.code === 'input_invalid_json' && error.collection === 'centers'
    );
  });

  test('a JSON value that is not an array stops the read', () => {
    assert.throws(
      () => readInputDirectory(path.join(FIXTURES, 'not-array')),
      (error) => error instanceof InputError && error.code === 'input_not_array' && error.collection === 'centers'
    );
  });
});

describe('loading the rejection fixture', () => {
  test('exact counts and rejection codes', async () => {
    const { documents } = readInputDirectory(REJECTIONS);
    const report = await loadCollections(documents, createMemoryStore());

    assert.deepEqual(rejectionsOf(report), EXPECTED_REJECTIONS);
    for (const [name, inserted] of Object.entries(EXPECTED_INSERTED)) {
      const stats = report.collections[name];
      assert.equal(stats.inserted, inserted, `${name} inserted`);
      assert.equal(stats.unchanged, 0, `${name} unchanged`);
      assert.equal(stats.inserted + stats.unchanged + stats.rejected, stats.read, `${name} adds up`);
    }
    assert.deepEqual(report.totals, { read: 23, inserted: 8, unchanged: 0, rejected: 15 });
  });

  test('a second load inserts nothing, counts the valid rows as unchanged, and repeats the rejections', async () => {
    const { documents } = readInputDirectory(REJECTIONS);
    const store = createMemoryStore();
    const first = await loadCollections(documents, store);
    const stateAfterFirst = await store.snapshot();

    const second = await loadCollections(documents, store);
    assert.equal(second.totals.inserted, 0);
    assert.equal(second.totals.unchanged, first.totals.inserted);
    assert.equal(second.totals.rejected, first.totals.rejected);
    assert.deepEqual(rejectionsOf(second), rejectionsOf(first));
    assert.deepEqual(await store.snapshot(), stateAfterFirst);
  });
});

describe('idempotency: properties', () => {
  test('N loads of the same generated seed leave the state of one load', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2032, 0, 1) }),
        fc.integer({ min: 2, max: 4 }),
        async (nowMs, loads) => {
          const seed = generateSeed(nowMs);
          const once = createMemoryStore();
          const first = await loadCollections(seed, once);
          assert.equal(first.totals.rejected, 0);

          const repeated = createMemoryStore();
          let last = null;
          for (let index = 0; index < loads; index += 1) {
            last = await loadCollections(seed, repeated);
          }
          assert.equal(last.totals.inserted, 0);
          assert.equal(last.totals.unchanged, first.totals.read);
          assert.deepEqual(await repeated.snapshot(), await once.snapshot());
        }
      ),
      { numRuns: 40 }
    );
  });
});

describe('conflicts and participant rules', () => {
  const center = (id) => ({ id, name: id, createdAt: '2026-01-01T00:00:00.000Z' });
  const user = (id, centerId, role, email) => ({
    id,
    centerId,
    email,
    displayName: id,
    role,
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  const appointment = (id, centerId, professionalId, clientId) => ({
    id,
    centerId,
    professionalId,
    clientId,
    startsAt: '2026-01-05T15:00:00.000Z',
    endsAt: '2026-01-05T15:50:00.000Z',
    status: 'scheduled',
    createdAt: '2026-01-03T10:00:00.000Z',
  });

  test('a changed row with a stored id is a conflict, and the stored row stays', async () => {
    const store = createMemoryStore();
    const docs = { centers: [center('c-1')] };
    await loadCollections(docs, store);

    const changed = { centers: [{ ...center('c-1'), name: 'Renamed' }] };
    const report = await loadCollections(changed, store);
    assert.deepEqual(report.collections.centers.rejections, [
      { index: 0, id: 'c-1', code: 'conflict', field: null },
    ]);
    const [stored] = await store.readAll(BY_NAME.centers);
    assert.equal(stored.name, 'c-1');
  });

  test('a professional from another center is rejected as participant_center', async () => {
    const docs = {
      centers: [center('c-1'), center('c-2')],
      users: [user('u-pro', 'c-1', 'professional', 'pro@example.test'), user('u-cli', 'c-2', 'client', 'cli@example.test')],
      appointments: [appointment('apt-x', 'c-1', 'u-pro', 'u-cli')],
    };
    const report = await loadCollections(docs, createMemoryStore());
    assert.deepEqual(report.collections.appointments.rejections, [
      { index: 0, id: 'apt-x', code: 'participant_center', field: 'clientId' },
    ]);
  });

  test('a second user with a used email is a conflict with the first', async () => {
    const docs = {
      centers: [center('c-1')],
      users: [
        user('u-1', 'c-1', 'client', 'same@example.test'),
        user('u-2', 'c-1', 'client', 'same@example.test'),
      ],
    };
    const report = await loadCollections(docs, createMemoryStore());
    assert.deepEqual(report.collections.users.rejections, [
      { index: 1, id: 'u-2', code: 'conflict', field: null },
    ]);
  });

  test('emails differing only by case are distinct users', async () => {
    const docs = {
      centers: [center('c-1')],
      users: [
        user('u-1', 'c-1', 'client', 'Same@example.test'),
        user('u-2', 'c-1', 'client', 'same@example.test'),
      ],
    };
    const report = await loadCollections(docs, createMemoryStore());
    assert.equal(report.totals.rejected, 0);
  });

  test('a store failure that is not a row error stops the load', async () => {
    const store = createMemoryStore();
    store.insert = async () => {
      throw new Error('connection lost');
    };
    await assert.rejects(() => loadCollections({ centers: [center('c-1')] }, store), /connection lost/);
  });
});
