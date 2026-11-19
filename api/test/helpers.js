'use strict';

// Shared test helpers. The file name does not end in .test.js, so the test
// runner does not execute it directly.

const { once } = require('node:events');

function silentLogger() {
  return { error() {} };
}

// Stand-in for the database wrapper. `pingError` makes readiness fail.
function fakeDb({ pingError = null } = {}) {
  const db = {
    pings: 0,
    async ping() {
      db.pings += 1;
      if (pingError) {
        throw pingError;
      }
    },
    async execute() {
      return [];
    },
    async run() {
      return [];
    },
    async close() {},
  };
  return db;
}

// Starts an Express app on a free loopback port. Call close() when done.
async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close() {
      return new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}

module.exports = { silentLogger, fakeDb, listen };
