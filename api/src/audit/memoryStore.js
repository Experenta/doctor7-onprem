'use strict';

// In-memory implementation of the audit store contract (see store.js). It is a
// test aid. `entries` is exposed so tests can inspect what was written.

function createMemoryAuditStore() {
  const entries = [];

  return {
    entries,

    async insert(entry) {
      entries.push({ ...entry });
    },

    async list(filter, { limit, offset }) {
      return entries
        .filter(
          (entry) =>
            entry.centerId === filter.centerId &&
            (filter.from === undefined || entry.occurredAt >= filter.from) &&
            (filter.to === undefined || entry.occurredAt <= filter.to) &&
            (filter.actorId === undefined || entry.actorId === filter.actorId) &&
            (filter.action === undefined || entry.action === filter.action) &&
            (filter.outcome === undefined || entry.outcome === filter.outcome)
        )
        .sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? 1 : -1))
        .slice(offset, offset + limit)
        .map((entry) => ({ ...entry }));
    },
  };
}

module.exports = { createMemoryAuditStore };
