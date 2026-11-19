'use strict';

const { toUtcDateTime } = require('../repositories/createRepository');

// Persistence for sign-in. Every statement uses bound parameters. Times are
// passed in by the caller (not read from the database clock), so one clock
// governs expiry and tests can move it.
//
// Store contract (the in-memory store in memoryStore.js has the same one):
//   createLoginAttempt(attempt)        -> void
//   consumeLoginAttempt(stateHash)     -> attempt or null. It deletes the row, so a state works once.
//   findUserByEmail(email)             -> { id, email, displayName, role, centerId } or null
//   createSession(session)             -> void
//   findSession(idHash)                -> session joined with its user, or null
//   touchSession(idHash, now)          -> void
//   revokeSession(idHash, now)         -> void
//   revokeAllForUser(userId, now)      -> number of sessions revoked
//   purgeExpired(now)                  -> void

function toUser(row) {
  return {
    id: row.user_id ?? row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    centerId: row.center_id ?? null,
  };
}

function createSqlAuthStore(db) {
  return {
    async createLoginAttempt({ stateHash, bindingHash, nonce, codeVerifier, createdAt, expiresAt }) {
      await db.execute(
        `INSERT INTO login_attempts
           (state_hash, binding_hash, nonce, code_verifier, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [stateHash, bindingHash, nonce, codeVerifier, toUtcDateTime(createdAt), toUtcDateTime(expiresAt)]
      );
    },

    async consumeLoginAttempt(stateHash) {
      const rows = await db.execute(
        `SELECT state_hash, binding_hash, nonce, code_verifier, expires_at
           FROM login_attempts WHERE state_hash = ? LIMIT 1`,
        [stateHash]
      );
      if (rows.length === 0) {
        return null;
      }
      // Only the request that deletes the row may continue, so a replay or a
      // concurrent request with the same state fails.
      const result = await db.execute('DELETE FROM login_attempts WHERE state_hash = ?', [stateHash]);
      if (result.affectedRows !== 1) {
        return null;
      }
      const row = rows[0];
      return {
        stateHash: row.state_hash,
        bindingHash: row.binding_hash,
        nonce: row.nonce,
        codeVerifier: row.code_verifier,
        expiresAt: new Date(row.expires_at),
      };
    },

    // The email column uses a binary collation, so this match is exact.
    async findUserByEmail(email) {
      const rows = await db.execute(
        'SELECT id, email, display_name, role, center_id FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      return rows.length === 0 ? null : toUser(rows[0]);
    },

    async createSession({ idHash, userId, createdAt, lastSeenAt, expiresAt }) {
      await db.execute(
        `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [idHash, userId, toUtcDateTime(createdAt), toUtcDateTime(lastSeenAt), toUtcDateTime(expiresAt)]
      );
    },

    // Role and center come from the users row on every read, so a change or a
    // deletion there takes effect on the next request.
    async findSession(idHash) {
      const rows = await db.execute(
        `SELECT s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
                u.email, u.display_name, u.role, u.center_id
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id_hash = ? LIMIT 1`,
        [idHash]
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0];
      return {
        idHash,
        user: toUser(row),
        createdAt: new Date(row.created_at),
        lastSeenAt: new Date(row.last_seen_at),
        expiresAt: new Date(row.expires_at),
        revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      };
    },

    async touchSession(idHash, now) {
      await db.execute(
        'UPDATE sessions SET last_seen_at = ? WHERE id_hash = ? AND revoked_at IS NULL',
        [toUtcDateTime(now), idHash]
      );
    },

    async revokeSession(idHash, now) {
      await db.execute(
        'UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL',
        [toUtcDateTime(now), idHash]
      );
    },

    async revokeAllForUser(userId, now) {
      const result = await db.execute(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [toUtcDateTime(now), userId]
      );
      return result.affectedRows;
    },

    async purgeExpired(now) {
      const cutoff = toUtcDateTime(now);
      await db.execute('DELETE FROM login_attempts WHERE expires_at < ?', [cutoff]);
      await db.execute('DELETE FROM sessions WHERE expires_at < ?', [cutoff]);
    },
  };
}

module.exports = { createSqlAuthStore };
