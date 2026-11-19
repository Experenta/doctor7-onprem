'use strict';

const { createSqlAuthStore } = require('./store');
const { createSessionService } = require('./session');
const { createOidcClient } = require('./oidc');
const { createAuthRouter, createRequireSession } = require('./router');

// Builds the sign-in router and the requireSession middleware factory.
// `store`, `oidc`, `now`, and `audit` can be replaced, which tests do.
function createAuth({ config, db, store, oidc, logger = console, now = () => new Date(), audit }) {
  const authStore = store || createSqlAuthStore(db);
  const authOidc = oidc || createOidcClient(config, { now });
  const sessions = createSessionService({ store: authStore, config, now });
  return {
    sessions,
    router: createAuthRouter({ config, store: authStore, sessions, oidc: authOidc, logger, now, audit }),
    requireSession: createRequireSession({ config, sessions }),
  };
}

module.exports = { createAuth };
