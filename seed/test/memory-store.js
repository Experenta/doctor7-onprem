'use strict';

// In-memory store for tests. It applies the same rules as the K-02 schema: primary
// keys, the unique email on users, and the foreign keys. The MariaDB integration
// test checks that the real schema agrees with these rules.

const { COLLECTIONS, StoreError, normalizeForCompare } = require('../lib/collections');

const DEF_BY_TABLE = Object.fromEntries(COLLECTIONS.map((def) => [def.table, def]));

function createMemoryStore() {
  const tables = new Map();

  function rowsOf(def) {
    if (!tables.has(def.table)) {
      tables.set(def.table, new Map());
    }
    return tables.get(def.table);
  }

  return {
    async get(def, id) {
      const row = rowsOf(def).get(id);
      return row ? { ...row } : null;
    },

    async insert(def, row) {
      const rows = rowsOf(def);
      if (rows.has(row.id)) {
        throw new StoreError('duplicate');
      }
      for (const column of def.unique) {
        for (const existing of rows.values()) {
          if (existing[column] === row[column]) {
            throw new StoreError('duplicate');
          }
        }
      }
      for (const reference of def.references) {
        const value = row[reference.column];
        if (value !== null && !rowsOf(DEF_BY_TABLE[reference.table]).has(value)) {
          throw new StoreError('missing_reference');
        }
      }
      rows.set(row.id, { ...row });
    },

    async readAll(def) {
      return [...rowsOf(def).values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((row) => normalizeForCompare(def, row));
    },

    // Every table, normalized, for state comparisons.
    async snapshot() {
      const out = {};
      for (const def of COLLECTIONS) {
        out[def.table] = await this.readAll(def);
      }
      return out;
    },
  };
}

module.exports = { createMemoryStore };
