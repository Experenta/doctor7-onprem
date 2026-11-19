'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRetentionDays, purgeExpiredMessages, DEFAULT_RETENTION_DAYS } = require('./purge');
const { createMemoryChatStore } = require('./memoryStore');
const { createAudit } = require('../audit');
const { createMemoryAuditStore } = require('../audit/memoryStore');

const NOW = new Date('2026-12-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function message(id, daysAgo, body = `text of ${id}`) {
  return {
    id,
    appointmentId: 'a1',
    senderId: 'u-cli1',
    body,
    sentAt: new Date(NOW.getTime() - daysAgo * DAY),
  };
}

test('the purge deletes messages older than the retention period and keeps the rest', async () => {
  const store = createMemoryChatStore({
    messages: [message('old', 100), message('edge', 90), message('recent', 2)],
  });
  const auditStore = createMemoryAuditStore();
  const { removed, cutoff } = await purgeExpiredMessages({
    store,
    audit: createAudit({ store: auditStore }),
    now: () => NOW,
    retentionDays: 90,
  });
  assert.equal(removed, 1);
  assert.equal(cutoff.getTime(), NOW.getTime() - 90 * DAY);
  assert.deepEqual(
    store.messages.map((item) => item.id).sort(),
    ['edge', 'recent']
  );
});

test('each purge writes one chat.purge entry with success, and no message text', async () => {
  const store = createMemoryChatStore({ messages: [message('old', 100, 'private text 42')] });
  const auditStore = createMemoryAuditStore();
  await purgeExpiredMessages({ store, audit: createAudit({ store: auditStore }), now: () => NOW, retentionDays: 90 });
  assert.equal(auditStore.entries.length, 1);
  const [entry] = auditStore.entries;
  assert.equal(entry.action, 'chat.purge');
  assert.equal(entry.outcome, 'success');
  assert.equal(entry.targetType, 'chat');
  assert.equal(entry.targetId, null);
  assert.equal(entry.actorId, null);
  assert.ok(!JSON.stringify(auditStore.entries).includes('private text 42'));
});

test('an empty run still writes its audit entry', async () => {
  const store = createMemoryChatStore();
  const auditStore = createMemoryAuditStore();
  const { removed } = await purgeExpiredMessages({
    store,
    audit: createAudit({ store: auditStore }),
    now: () => NOW,
    retentionDays: 90,
  });
  assert.equal(removed, 0);
  assert.equal(auditStore.entries.length, 1);
});

test('CHAT_RETENTION_DAYS accepts integers from 1 to 3650, and an unset value means the default', () => {
  assert.equal(parseRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
  assert.equal(parseRetentionDays(''), DEFAULT_RETENTION_DAYS);
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
  assert.equal(parseRetentionDays('1'), 1);
  assert.equal(parseRetentionDays('3650'), 3650);
  for (const raw of ['0', '3651', '-5', '1.5', 'ninety', ' 90', '99999']) {
    assert.throws(() => parseRetentionDays(raw), /CHAT_RETENTION_DAYS must be an integer from 1 to 3650\./, raw);
  }
});
