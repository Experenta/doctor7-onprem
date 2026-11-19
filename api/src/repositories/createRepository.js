'use strict';

// Data access for one table. Table and column names come from code, never from
// request input. They must match a strict pattern and are quoted. Values always
// travel as bound parameters. Lists are paged, and LIMIT/OFFSET are validated
// integers, because placeholders in LIMIT are not reliable across MariaDB and MySQL
// with server-side prepared statements.

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const ID_MAX_LENGTH = 64;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function quoteIdentifier(name) {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw new TypeError(`Invalid SQL identifier: ${String(name)}`);
  }
  return `\`${name}\``;
}

function assertInteger(name, value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0 || Array.from(id).length > ID_MAX_LENGTH) {
    throw new TypeError(`id must be a non-empty string of at most ${ID_MAX_LENGTH} characters.`);
  }
}

// Converts a Date to the UTC text MariaDB and MySQL read as DATETIME(3).
function toUtcDateTime(date) {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid Date value.');
  }
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function toDbValue(column, value, jsonColumns) {
  if (value === undefined) {
    throw new TypeError(`Missing value for column ${column}.`);
  }
  if (value === null) {
    return null;
  }
  if (jsonColumns.has(column)) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return toUtcDateTime(value);
  }
  if (typeof value === 'object') {
    throw new TypeError(`Column ${column} does not accept an object value.`);
  }
  return value;
}

function fromDbRow(row, jsonColumns) {
  const out = { ...row };
  for (const column of jsonColumns) {
    if (typeof out[column] === 'string') {
      out[column] = JSON.parse(out[column]);
    }
  }
  return out;
}

function createRepository(db, spec) {
  const { table, columns, jsonColumns: jsonList = [] } = spec;
  const primaryKey = spec.primaryKey || 'id';

  if (!Array.isArray(columns) || columns.length === 0) {
    throw new TypeError(`Repository ${String(table)} needs a non-empty column list.`);
  }
  if (!columns.includes(primaryKey)) {
    throw new TypeError(`Repository ${table} must list its primary key ${primaryKey}.`);
  }
  const jsonColumns = new Set(jsonList);
  for (const column of jsonColumns) {
    if (!columns.includes(column)) {
      throw new TypeError(`JSON column ${column} is not in the column list of ${table}.`);
    }
  }

  const tableSql = quoteIdentifier(table);
  const pkSql = quoteIdentifier(primaryKey);
  const selectSql = columns.map(quoteIdentifier).join(', ');
  const columnSet = new Set(columns);

  async function findById(id) {
    assertId(id);
    const rows = await db.execute(
      `SELECT ${selectSql} FROM ${tableSql} WHERE ${pkSql} = ? LIMIT 1`,
      [id]
    );
    return rows.length === 0 ? null : fromDbRow(rows[0], jsonColumns);
  }

  async function list({ limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const safeLimit = assertInteger('limit', limit, 1, MAX_LIMIT);
    const safeOffset = assertInteger('offset', offset, 0, Number.MAX_SAFE_INTEGER);
    const rows = await db.execute(
      `SELECT ${selectSql} FROM ${tableSql} ORDER BY ${pkSql} ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`
    );
    return rows.map((row) => fromDbRow(row, jsonColumns));
  }

  async function insert(row) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('insert expects a plain object.');
    }
    const keys = Object.keys(row);
    for (const key of keys) {
      if (!columnSet.has(key)) {
        throw new TypeError(`Unknown column for ${table}: ${key}`);
      }
    }
    if (!keys.includes(primaryKey)) {
      throw new TypeError(`insert into ${table} requires ${primaryKey}.`);
    }
    assertId(row[primaryKey]);

    const names = keys.map(quoteIdentifier).join(', ');
    const marks = keys.map(() => '?').join(', ');
    const values = keys.map((key) => toDbValue(key, row[key], jsonColumns));
    await db.execute(`INSERT INTO ${tableSql} (${names}) VALUES (${marks})`, values);
    return findById(row[primaryKey]);
  }

  return { table, findById, list, insert };
}

module.exports = {
  createRepository,
  quoteIdentifier,
  toUtcDateTime,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
