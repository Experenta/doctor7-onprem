'use strict';

const { parseCookieValues } = require('./cookies');

// A browser holds at most a few cookies of one name (one per Path). The cap keeps
// a forged header with hundreds of duplicates from causing hundreds of lookups.
const MAX_CANDIDATES = 8;

// Finds the live session named by the cookie header. Every value of the session
// cookie is tried in header order, and the first one that the session service
// accepts wins. Each attempt is a full `sessions.authenticate` call, so hash,
// expiry, idle time, and revocation are checked exactly as for a single cookie.
// Cookie values are never logged or returned in an error.
//
// Returns { auth, token, presented }. `auth` and `token` are null when no value
// is a live session. `presented` lists the values that were tried, for logout.
async function resolveSession(sessions, header, cookieName) {
  const presented = parseCookieValues(header, cookieName)
    .filter((value) => value.length > 0)
    .slice(0, MAX_CANDIDATES);
  for (const token of presented) {
    const auth = await sessions.authenticate(token);
    if (auth) {
      return { auth, token, presented };
    }
  }
  return { auth: null, token: null, presented };
}

module.exports = { resolveSession, MAX_CANDIDATES };
