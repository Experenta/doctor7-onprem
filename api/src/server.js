'use strict';

const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createDatabase, createPool } = require('./db/database');

// The DATABASE_URL value carries credentials, so it is never written to output.
function start(env = process.env) {
  const config = loadConfig(env);
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);
  const app = createApp({
    db,
    rateLimit: config.rateLimit,
    trustProxy: config.trustProxy,
    auth: { config: config.auth },
  });

  const server = app.listen(config.port, config.host, () => {
    process.stdout.write(`doctor7-onprem API listening on ${config.host}:${config.port}\n`);
  });

  const shutdown = () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { start };
