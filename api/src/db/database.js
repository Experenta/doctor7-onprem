'use strict';

const mysql = require('mysql2/promise');

// Creates a connection pool from a mysql:// URL such as DATABASE_URL.
// The URL carries credentials, so callers must never log it.
// timezone 'Z' makes DATETIME values read and write as UTC.
function createPool(url) {
  return mysql.createPool({
    uri: url,
    timezone: 'Z',
    connectTimeout: 5000,
    connectionLimit: 10,
    multipleStatements: false,
  });
}

// `execute` runs statements with bound parameters (server-side prepared).
// `run` runs a text statement without parameters, such as DDL.
function createDatabase(pool) {
  return {
    pool,
    async execute(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows;
    },
    async run(sql) {
      const [result] = await pool.query(sql);
      return result;
    },
    async ping() {
      await pool.query('SELECT 1');
    },
    close() {
      return pool.end();
    },
  };
}

module.exports = { createPool, createDatabase };
