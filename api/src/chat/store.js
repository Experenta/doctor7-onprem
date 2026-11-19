'use strict';

const { createRepositories } = require('../repositories/tables');
const { toUtcDateTime } = require('../repositories/createRepository');

// Persistence for chat messages. Every statement uses bound parameters. The
// only text in a statement is fixed, and LIMIT is a validated integer, because
// placeholders in LIMIT are not reliable with server-side prepared statements.
//
// Store contract (memoryStore.js has the same one):
//   insertMessage(message)           -> void. message: { id, appointmentId, senderId, body, sentAt }
//   listRecent(appointmentId, limit) -> messages, oldest first, at most `limit` of the newest
//   deleteSentBefore(cutoff)         -> number of messages deleted

const COLUMNS = 'id, appointment_id, sender_id, body, sent_at';
const MAX_LIMIT = 200;

function toDate(value) {
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

function toMessage(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    senderId: row.sender_id,
    body: row.body,
    sentAt: toDate(row.sent_at),
  };
}

function assertLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }
}

function createSqlChatStore(db) {
  const repositories = createRepositories(db);

  return {
    async insertMessage(message) {
      await repositories.chat_messages.insert({
        id: message.id,
        appointment_id: message.appointmentId,
        sender_id: message.senderId,
        body: message.body,
        sent_at: message.sentAt,
      });
    },

    async listRecent(appointmentId, limit) {
      assertLimit(limit);
      const rows = await db.execute(
        `SELECT ${COLUMNS} FROM chat_messages WHERE appointment_id = ?
          ORDER BY sent_at DESC, id DESC LIMIT ${limit}`,
        [appointmentId]
      );
      return rows.map(toMessage).reverse();
    },

    async deleteSentBefore(cutoff) {
      const result = await db.execute('DELETE FROM chat_messages WHERE sent_at < ?', [toUtcDateTime(cutoff)]);
      return result.affectedRows;
    },
  };
}

module.exports = { createSqlChatStore };
