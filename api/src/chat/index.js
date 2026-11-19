'use strict';

const { createSqlChatStore } = require('./store');
const { createChatGateway } = require('./gateway');
const { createSqlCareStore } = require('../care/store');

// Builds the chat. `attach(server)` connects it to an HTTP server, which must
// be the server that serves the API. `sessions` is the session service of the
// sign-in module (app.locals.auth.sessions), and `cookieName` is the session
// cookie name from the auth config. `audit` is required. `store`, `careStore`,
// `now`, `newId`, `logger`, and `sweepIntervalMs` can be replaced, which tests do.
// A sweepIntervalMs of 0 starts no timer, so tests call sweep() themselves.
function createChat({
  db,
  store,
  careStore,
  sessions,
  audit,
  cookieName,
  now,
  newId,
  logger,
  sweepIntervalMs,
}) {
  if (!sessions) {
    throw new TypeError('createChat requires the session service.');
  }
  if (!audit) {
    throw new TypeError('createChat requires an audit sink.');
  }
  if (typeof cookieName !== 'string' || cookieName.length === 0) {
    throw new TypeError('createChat requires the session cookie name.');
  }
  const gateway = createChatGateway({
    store: store || createSqlChatStore(db),
    careStore: careStore || createSqlCareStore(db),
    sessions,
    audit,
    cookieName,
    now,
    newId,
    logger,
    sweepIntervalMs,
  });
  return { attach: gateway.attach, sweep: gateway.sweep, close: gateway.close };
}

module.exports = { createChat };
