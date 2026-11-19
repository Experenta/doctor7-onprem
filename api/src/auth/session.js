'use strict';

const { randomToken, sha256Hex } = require('./tokens');

// Server-side sessions. The cookie carries a random token. The database holds
// only its SHA-256 digest, so a database read does not yield a usable cookie.
// A session ends at its absolute expiry, after the idle period, or when revoked.
function createSessionService({ store, config, now = () => new Date() }) {
  const absoluteMs = config.absoluteTtlSeconds * 1000;
  const idleMs = config.idleTtlSeconds * 1000;

  function idleExpiry(session) {
    return new Date(session.lastSeenAt.getTime() + idleMs);
  }

  function isActive(session, at) {
    return !session.revokedAt && at < session.expiresAt && at < idleExpiry(session);
  }

  // Creates a session with a fresh token and returns the raw token once.
  async function create(user) {
    const at = now();
    const token = randomToken();
    const expiresAt = new Date(at.getTime() + absoluteMs);
    await store.createSession({
      idHash: sha256Hex(token),
      userId: user.id,
      createdAt: at,
      lastSeenAt: at,
      expiresAt,
    });
    return { token, expiresAt };
  }

  // Returns { user, session } for a live session and records the activity.
  // Returns null for an unknown, revoked, or expired session.
  async function authenticate(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
      return null;
    }
    const idHash = sha256Hex(token);
    const found = await store.findSession(idHash);
    const at = now();
    if (!found || !isActive(found, at)) {
      return null;
    }
    await store.touchSession(idHash, at);
    return {
      user: found.user,
      session: {
        idHash,
        expiresAt: found.expiresAt,
        idleExpiresAt: new Date(at.getTime() + idleMs),
      },
    };
  }

  async function revoke(token) {
    if (typeof token === 'string' && token.length > 0 && token.length <= 256) {
      await store.revokeSession(sha256Hex(token), now());
    }
  }

  function revokeAllForUser(userId) {
    return store.revokeAllForUser(userId, now());
  }

  return { create, authenticate, revoke, revokeAllForUser };
}

module.exports = { createSessionService };
