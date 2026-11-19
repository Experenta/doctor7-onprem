'use strict';

// Retention for chat messages. Run it from cron or a systemd timer:
//
//   DATABASE_URL=... CHAT_RETENTION_DAYS=90 node api/src/chat/purge.js
//
// The command prints one line with the number of deleted messages. It never
// prints DATABASE_URL or the text of a message.

const { createSqlChatStore } = require('./store');
const { createAudit } = require('../audit');
const { createPool, createDatabase } = require('../db/database');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;

// Reads CHAT_RETENTION_DAYS. An unset value means the default.
function parseRetentionDays(raw) {
  if (raw === undefined || raw === '') {
    return DEFAULT_RETENTION_DAYS;
  }
  const days = /^\d{1,4}$/.test(raw) ? Number(raw) : 0;
  if (days < 1 || days > MAX_RETENTION_DAYS) {
    throw new Error(`CHAT_RETENTION_DAYS must be an integer from 1 to ${MAX_RETENTION_DAYS}.`);
  }
  return days;
}

// Deletes messages sent before now minus the retention period, then writes one
// chat.purge entry. Returns the number of deleted messages and the cutoff.
async function purgeExpiredMessages({ store, audit, now = () => new Date(), retentionDays = DEFAULT_RETENTION_DAYS }) {
  const cutoff = new Date(now().getTime() - retentionDays * DAY_MS);
  const removed = await store.deleteSentBefore(cutoff);
  await audit.record({
    actorId: null,
    centerId: null,
    ip: null,
    action: 'chat.purge',
    targetType: 'chat',
    outcome: 'success',
  });
  return { removed, cutoff };
}

// Runs the purge with the database from the environment. Returns the count.
async function runPurge(env = process.env) {
  const retentionDays = parseRetentionDays(env.CHAT_RETENTION_DAYS);
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }
  const pool = createPool(env.DATABASE_URL);
  try {
    const db = createDatabase(pool);
    const { removed } = await purgeExpiredMessages({
      store: createSqlChatStore(db),
      audit: createAudit({ db }),
      retentionDays,
    });
    return removed;
  } finally {
    await pool.end();
  }
}

async function commandLine(env) {
  let removed;
  try {
    removed = await runPurge(env);
  } catch (err) {
    if (err instanceof Error && /^(CHAT_RETENTION_DAYS|DATABASE_URL) /.test(err.message)) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = 2;
      return;
    }
    // Driver errors can carry connection details. Print the code only.
    process.stderr.write(`chat purge failed (${err?.code ?? 'error'}).\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`chat purge: deleted ${removed} messages.\n`);
}

if (require.main === module) {
  commandLine(process.env);
}

module.exports = { parseRetentionDays, purgeExpiredMessages, runPurge, DEFAULT_RETENTION_DAYS };
