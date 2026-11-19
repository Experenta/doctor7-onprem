'use strict';

const { randomUUID } = require('node:crypto');
const { buildEntry, requestContext, discardingAudit, OUTCOMES } = require('./entry');
const { createSqlAuditStore } = require('./store');
const { createAuditRouter } = require('./router');

// Builds the audit service. `record` is the only write path. `store` replaces the
// SQL store, which tests do. `now` and `newId` can be replaced too.
function createAudit({ db, store, now = () => new Date(), newId = randomUUID } = {}) {
  if (!store && !db) {
    throw new TypeError('createAudit requires a db or a store.');
  }
  const sink = store || createSqlAuditStore(db);

  async function record(input) {
    const entry = buildEntry(input, { id: newId(), at: now() });
    await sink.insert(entry);
    return entry.id;
  }

  return { record, router: createAuditRouter({ record, store: sink }) };
}

module.exports = { createAudit, requestContext, discardingAudit, OUTCOMES };
