'use strict';

// Persistence for the audit log. The application only inserts and reads rows.
// It has no UPDATE or DELETE for this table. docs/AUDIT.md gives the GRANT that
// enforces this in the database.
//
// Store contract (memoryStore.js has the same one):
//   insert(entry)            -> void. entry uses the camelCase fields of entry.js.
//   list(filter, page)       -> entries, newest first. filter: { centerId, from?,
//                               to?, actorId?, action?, outcome? }. page: { limit, offset }.

const { createRepositories } = require('../repositories/tables');
const { toUtcDateTime } = require('../repositories/createRepository');

const COLUMNS =
  'id, actor_id, center_id, action, target_type, target_id, outcome, reason, ip, occurred_at';

function toDate(value) {
  if (value instanceof Date) return value;
  return new Date(`${String(value).replace(' ', 'T')}Z`);
}

function toEntry(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    centerId: row.center_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    reason: row.reason,
    ip: row.ip,
    occurredAt: toDate(row.occurred_at),
  };
}

// LIMIT and OFFSET are interpolated, so they must be validated integers first.
function assertPage({ limit, offset }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError('limit must be an integer from 1 to 200.');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('offset must be a non-negative integer.');
  }
}

function createSqlAuditStore(db) {
  const repositories = createRepositories(db);

  return {
    async insert(entry) {
      await repositories.audit_log.insert({
        id: entry.id,
        actor_id: entry.actorId,
        center_id: entry.centerId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        outcome: entry.outcome,
        reason: entry.reason,
        ip: entry.ip,
        occurred_at: entry.occurredAt,
      });
    },

    // The WHERE parts are fixed strings. Filter values travel as parameters.
    async list(filter, page) {
      assertPage(page);
      const where = ['center_id = ?'];
      const params = [filter.centerId];
      if (filter.from !== undefined) {
        where.push('occurred_at >= ?');
        params.push(toUtcDateTime(filter.from));
      }
      if (filter.to !== undefined) {
        where.push('occurred_at <= ?');
        params.push(toUtcDateTime(filter.to));
      }
      if (filter.actorId !== undefined) {
        where.push('actor_id = ?');
        params.push(filter.actorId);
      }
      if (filter.action !== undefined) {
        where.push('action = ?');
        params.push(filter.action);
      }
      if (filter.outcome !== undefined) {
        where.push('outcome = ?');
        params.push(filter.outcome);
      }
      const rows = await db.execute(
        `SELECT ${COLUMNS} FROM audit_log WHERE ${where.join(' AND ')}
          ORDER BY occurred_at DESC, id DESC LIMIT ${page.limit} OFFSET ${page.offset}`,
        params
      );
      return rows.map(toEntry);
    },
  };
}

module.exports = { createSqlAuditStore, toEntry };
