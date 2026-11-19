'use strict';

// In-memory implementation of the auth store contract (see store.js). It is a
// test aid: it lets the sign-in flow run without a database.

function createMemoryAuthStore({ users = [] } = {}) {
  const attempts = new Map();
  const sessions = new Map();
  const usersByEmail = new Map(users.map((user) => [user.email, { ...user }]));

  return {
    // Test-only inspection and mutation.
    attempts,
    sessions,
    usersByEmail,

    async createLoginAttempt(attempt) {
      attempts.set(attempt.stateHash, { ...attempt });
    },

    async consumeLoginAttempt(stateHash) {
      const attempt = attempts.get(stateHash);
      attempts.delete(stateHash);
      return attempt ? { ...attempt } : null;
    },

    async findUserByEmail(email) {
      const user = usersByEmail.get(email);
      return user ? { ...user } : null;
    },

    async createSession({ idHash, userId, createdAt, lastSeenAt, expiresAt }) {
      sessions.set(idHash, { idHash, userId, createdAt, lastSeenAt, expiresAt, revokedAt: null });
    },

    async findSession(idHash) {
      const session = sessions.get(idHash);
      if (!session) {
        return null;
      }
      const user = [...usersByEmail.values()].find((candidate) => candidate.id === session.userId);
      if (!user) {
        return null;
      }
      return { ...session, user: { ...user } };
    },

    async touchSession(idHash, now) {
      const session = sessions.get(idHash);
      if (session && !session.revokedAt) {
        session.lastSeenAt = now;
      }
    },

    async revokeSession(idHash, now) {
      const session = sessions.get(idHash);
      if (session && !session.revokedAt) {
        session.revokedAt = now;
      }
    },

    async revokeAllForUser(userId, now) {
      let count = 0;
      for (const session of sessions.values()) {
        if (session.userId === userId && !session.revokedAt) {
          session.revokedAt = now;
          count += 1;
        }
      }
      return count;
    },

    async purgeExpired(now) {
      for (const [key, attempt] of attempts) {
        if (attempt.expiresAt < now) attempts.delete(key);
      }
      for (const [key, session] of sessions) {
        if (session.expiresAt < now) sessions.delete(key);
      }
    },
  };
}

module.exports = { createMemoryAuthStore };
