'use strict';

// Store backed by MariaDB through mysql2. Only SELECT and INSERT statements run,
// with bound parameters. Table and column names come from the fixed definitions in
// collections.js, never from input. The pool uses timezone 'Z', so DATETIME values
// are read as UTC and written as the literal text that the loader builds.

const mysql = require('mysql2/promise');
const { StoreError, normalizeForCompare } = require('./collections');
const { toSqlDatetime } = require('./instant');

// MariaDB error codes that the loader treats as row rejections or as a missing schema.
const MARIADB_ERRORS = {
  ER_DUP_ENTRY: 'duplicate',
  ER_NO_REFERENCED_ROW: 'missing_reference',
  ER_NO_REFERENCED_ROW_2: 'missing_reference',
  ER_CHECK_CONSTRAINT_VIOLATED: 'check_violation',
  ER_NO_SUCH_TABLE: 'schema_missing',
};

// The URL carries credentials. Callers must never log it.
function createMariaDbPool(url) {
  return mysql.createPool({
    uri: url,
    timezone: 'Z',
    connectTimeout: 5000,
    connectionLimit: 5,
    multipleStatements: false,
  });
}

function toStoreError(error) {
  const kind = error && MARIADB_ERRORS[error.code];
  return kind ? new StoreError(kind) : error;
}

// DATETIME values come back as Date objects in UTC. Convert them to the SQL literal
// that the loader compares against.
function fromDatabase(def, row) {
  const out = {};
  for (const column of def.columns) {
    const value = row[column];
    out[column] = value instanceof Date ? toSqlDatetime(value.getTime()) : value;
  }
  return out;
}

function createMariaDbStore(pool) {
  return {
    async get(def, id) {
      let rows;
      try {
        [rows] = await pool.execute(
          `SELECT ${def.columns.join(', ')} FROM ${def.table} WHERE id = ?`,
          [id]
        );
      } catch (error) {
        throw toStoreError(error);
      }
      return rows.length === 0 ? null : fromDatabase(def, rows[0]);
    },

    async insert(def, row) {
      const placeholders = def.columns.map(() => '?').join(', ');
      const values = def.columns.map((column) => (row[column] === undefined ? null : row[column]));
      try {
        await pool.execute(
          `INSERT INTO ${def.table} (${def.columns.join(', ')}) VALUES (${placeholders})`,
          values
        );
      } catch (error) {
        throw toStoreError(error);
      }
    },

    async readAll(def) {
      let rows;
      try {
        [rows] = await pool.execute(
          `SELECT ${def.columns.join(', ')} FROM ${def.table} ORDER BY id`
        );
      } catch (error) {
        throw toStoreError(error);
      }
      return rows.map((row) => normalizeForCompare(def, fromDatabase(def, row)));
    },
  };
}

module.exports = { createMariaDbPool, createMariaDbStore };
