'use strict';

const http = require('node:http');
const { createApp } = require('./app');
const { createChat } = require('./chat');
const { loadConfig, requireDatabaseUrl } = require('./config');
const { createDatabase, createPool } = require('./db/database');

// Each server from createServer keeps its chat and its open sockets here, so the
// returned value is the plain http.Server.
const handles = new WeakMap();
const DEFAULT_GRACE_MS = 5000;

// Builds the HTTP server. Every request goes to the API application. The chat is
// attached to the upgrade event for /ws, and only when sign-in is configured,
// because the chat needs the session service. `config` is the result of
// loadConfig. The stores and `oidc` can be replaced, which tests do. Each store
// that is not given is the SQL store on `db`.
function createServer({
  db,
  config,
  careStore,
  auditStore,
  authStore,
  chatStore,
  oidc,
  sweepIntervalMs,
  logger = console,
} = {}) {
  if (!db) {
    throw new TypeError('createServer requires a db dependency.');
  }
  if (!config) {
    throw new TypeError('createServer requires a config.');
  }

  const app = createApp({
    db,
    rateLimit: config.rateLimit,
    trustProxy: config.trustProxy,
    auth: { config: config.auth, store: authStore, oidc },
    careStore,
    auditStore,
    video: { config: config.video },
    logger,
  });
  const server = http.createServer(app);

  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  let chat = null;
  if (app.locals.auth) {
    chat = createChat({
      db,
      store: chatStore,
      careStore,
      sessions: app.locals.auth.sessions,
      audit: app.locals.audit,
      cookieName: config.auth.sessionCookieName,
      sweepIntervalMs,
      logger,
    });
    chat.attach(server);
  }

  handles.set(server, { chat, sockets });
  return server;
}

// Stops a server from createServer, in this order: the chat sockets close with
// code 1001, the HTTP server stops, and the database closes. A connection still
// open after `graceMs` is destroyed, so a client that never answers cannot hold
// the process. The promise resolves when all of that is done.
async function shutdown(server, { db, graceMs = DEFAULT_GRACE_MS } = {}) {
  const { chat = null, sockets = new Set() } = handles.get(server) ?? {};
  if (chat) {
    chat.close();
  }

  const closed = new Promise((resolve) => {
    server.close(() => resolve());
  });
  const force = setTimeout(() => {
    for (const socket of [...sockets]) {
      socket.destroy();
    }
  }, graceMs);
  try {
    await closed;
  } finally {
    clearTimeout(force);
  }

  if (db && typeof db.close === 'function') {
    await db.close();
  }
}

// Starts the server with the real connection pool. Configuration errors throw
// before anything is opened. The database URL is never written to output.
function start(env = process.env, { write = (text) => process.stdout.write(text) } = {}) {
  const config = loadConfig(env);
  requireDatabaseUrl(config);

  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);
  const server = createServer({ db, config });

  server.once('error', (err) => {
    process.stderr.write(`The server could not listen (${err.code ?? 'error'}).\n`);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    write(`doctor7-onprem API listening on ${config.host}:${config.port}\n`);
  });

  // The handlers run once. A second signal uses the default behavior and ends the process.
  const stop = () => {
    shutdown(server, { db }).then(
      () => process.exit(0),
      () => {
        process.stderr.write('The server did not stop cleanly.\n');
        process.exit(1);
      }
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

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

module.exports = { createServer, shutdown, start };
