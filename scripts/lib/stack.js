'use strict';

// Starts the API, the mock identity provider, and the mock Google in this process,
// with in-memory stores filled from the synthetic seed. Nothing is written to disk,
// and no key is stored: the Google service account is made in memory.

const net = require('node:net');
const { once } = require('node:events');
const { createServer, shutdown } = require('../../api/src/server');
const { loadConfig } = require('../../api/src/config');
const { createMemoryAuthStore } = require('../../api/src/auth/memoryStore');
const { createMemoryCareStore } = require('../../api/src/care/memoryStore');
const { createMemoryChatStore } = require('../../api/src/chat/memoryStore');
const { createMemoryAuditStore } = require('../../api/src/audit/memoryStore');
const { createMockIdp } = require('../../tools/mock-idp/server');
const { createMockGoogle } = require('../../tools/mock-google/server');
const { createTestServiceAccount } = require('../../tools/mock-google/testing');
const { generateSeed } = require('../../seed/lib/generator');

const CLIENT_ID = 'doctor7-smoke';
const JITSI_BASE_URL = 'https://jitsi.example.test';
const DB_STUB = { async ping() {}, async close() {} };
const quietLogger = { error() {}, warn() {}, info() {} };

// Asks the system for a free loopback port. The port is released before the API
// listens on it.
function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// The seed holds ISO text. The memory stores expect Date objects.
function revive(rows, fields) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (copy[field] !== undefined && copy[field] !== null) copy[field] = new Date(copy[field]);
    }
    return copy;
  });
}

// Returns { origin, apiPrefix, close }. `googleMode` sets the mock Google mode.
// `videoProvider` false starts the API with no video provider configured.
async function startStack({ googleMode = 'ok', videoProvider = true } = {}) {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const redirectUri = `${origin}/auth/callback`;

  const idp = await createMockIdp({ clientId: CLIENT_ID, redirectUris: [redirectUri] }).start();
  let google = null;
  let server = null;
  try {
    const account = createTestServiceAccount();
    google = await createMockGoogle({
      publicKeyPem: account.publicKeyPem,
      serviceAccountEmail: account.email,
      delegatedUsers: [account.delegatedUser],
    }).start();
    google.mode = googleMode;

    const env = { OIDC_ISSUER: idp.issuer, OIDC_CLIENT_ID: CLIENT_ID, OIDC_REDIRECT_URI: redirectUri };
    if (videoProvider) {
      Object.assign(env, {
        VIDEO_PROVIDER: 'meet',
        JITSI_BASE_URL,
        GOOGLE_SERVICE_ACCOUNT_JSON: account.credentialJson(google.issuer),
        GOOGLE_MEET_DELEGATED_USER: account.delegatedUser,
        GOOGLE_MEET_API_BASE_URL: google.issuer,
      });
    }
    const config = loadConfig(env);

    const seed = generateSeed(new Date());
    const auditStore = createMemoryAuditStore();
    auditStore.entries.push(...revive(seed.audit, ['occurredAt']));
    server = createServer({
      db: DB_STUB,
      config,
      authStore: createMemoryAuthStore({ users: seed.users }),
      careStore: createMemoryCareStore({
        users: seed.users,
        appointments: revive(seed.appointments, ['startsAt', 'endsAt', 'createdAt']),
        consultations: revive(seed.consultations, ['createdAt']),
      }),
      chatStore: createMemoryChatStore({ messages: revive(seed.messages, ['sentAt']) }),
      auditStore,
      logger: quietLogger,
    });
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
  } catch (err) {
    if (server) await shutdown(server, { db: DB_STUB, graceMs: 200 }).catch(() => {});
    if (google) await google.close();
    await idp.close();
    throw err;
  }

  return {
    origin,
    apiPrefix: '',
    async close() {
      await shutdown(server, { db: DB_STUB, graceMs: 200 });
      await google.close();
      await idp.close();
    },
  };
}

module.exports = { startStack };
