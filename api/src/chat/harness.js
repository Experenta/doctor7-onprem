'use strict';

// Shared setup for the chat tests. The file name does not end in .test.js, so the
// runner does not execute it. It starts a plain HTTP server with the chat attached,
// creates real sessions through the session service, and opens WebSocket clients
// that send those sessions as cookies. The stores are in memory.

const http = require('node:http');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createChat } = require('./index');
const { createSessionService } = require('../auth/session');
const { createMemoryAuthStore } = require('../auth/memoryStore');
const { createMemoryCareStore } = require('../care/memoryStore');
const { createMemoryChatStore } = require('./memoryStore');
const { createAudit } = require('../audit');
const { createMemoryAuditStore } = require('../audit/memoryStore');

const COOKIE_NAME = 'd7_session';
const quietLogger = { error() {}, warn() {} };

// Synthetic people. Two centers, two professionals and two clients in center c1.
const person = (id, role, centerId) => ({ id, email: `${id}@example.test`, displayName: id, role, centerId });
const USERS = [
  person('u-pro1', 'professional', 'c1'),
  person('u-pro1b', 'professional', 'c1'),
  person('u-cli1', 'client', 'c1'),
  person('u-cli1b', 'client', 'c1'),
  person('u-adm1', 'admin', 'c1'),
  person('u-aud1', 'auditor', 'c1'),
  person('u-pro2', 'professional', 'c2'),
  person('u-cli2', 'client', 'c2'),
];

const appointment = (id, centerId, professionalId, clientId, status = 'scheduled') => ({
  id,
  centerId,
  professionalId,
  clientId,
  startsAt: new Date('2026-12-01T15:00:00.000Z'),
  endsAt: new Date('2026-12-01T15:50:00.000Z'),
  status,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
});

// a1: u-pro1 and u-cli1 in c1. a2: u-pro1b and u-cli1b in c1. a3: u-pro2 and u-cli2 in c2.
const APPOINTMENTS = [
  appointment('a1', 'c1', 'u-pro1', 'u-cli1'),
  appointment('a2', 'c1', 'u-pro1b', 'u-cli1b'),
  appointment('a3', 'c2', 'u-pro2', 'u-cli2'),
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls `read` until it returns something other than undefined.
async function waitUntil(read, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await delay(5);
  }
}

// A handshake the server refused. `status` and `body` are what the server sent.
class Refusal extends Error {
  constructor(status, body) {
    super(`Handshake refused with ${status}.`);
    this.status = status;
    this.body = body;
  }
}

// One connected chat client. Frames arrive in `frames`, and `take` removes the
// first unread frame of a type.
class Client {
  constructor(ws) {
    this.ws = ws;
    this.frames = [];
    this.inbox = [];
    this.closeInfo = null;
    this.closed = new Promise((resolve) => {
      ws.once('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString('utf8') };
        resolve(this.closeInfo);
      });
    });
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString('utf8'));
      this.frames.push(frame);
      this.inbox.push(frame);
    });
    // Protocol errors close the socket with a code. The tests check the code, so the error is not rethrown.
    ws.on('error', () => {});
  }

  send(value) {
    this.ws.send(typeof value === 'string' ? value : JSON.stringify(value));
  }

  // Returns the next unread frame of `type`, waiting up to the timeout.
  take(type, timeoutMs = 3000) {
    return waitUntil(() => {
      const index = this.inbox.findIndex((frame) => frame.type === type);
      return index === -1 ? undefined : this.inbox.splice(index, 1)[0];
    }, `a ${type} frame`, timeoutMs);
  }

  // Resolves with { code, reason } once the socket has closed, or rejects on timeout.
  async closedWith(timeoutMs = 3000) {
    if (this.closeInfo) return this.closeInfo;
    return Promise.race([
      this.closed,
      delay(timeoutMs).then(() => {
        throw new Error('Timed out waiting for the socket to close.');
      }),
    ]);
  }

  terminate() {
    this.ws.terminate();
  }
}

async function startChat({ sweepIntervalMs = 0, messages = [], appointments = APPOINTMENTS } = {}) {
  const authStore = createMemoryAuthStore({ users: USERS });
  const sessions = createSessionService({
    store: authStore,
    config: { absoluteTtlSeconds: 3600, idleTtlSeconds: 600 },
  });
  const careStore = createMemoryCareStore({
    users: USERS,
    appointments: appointments.map((item) => ({ ...item })),
  });
  const chatStore = createMemoryChatStore({ messages });
  const auditStore = createMemoryAuditStore();
  const audit = createAudit({ store: auditStore });
  const chat = createChat({
    store: chatStore,
    careStore,
    sessions,
    audit,
    cookieName: COOKIE_NAME,
    sweepIntervalMs,
    logger: quietLogger,
  });

  const server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.end();
  });
  chat.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const tokens = {};
  for (const user of USERS) {
    tokens[user.id] = (await sessions.create(user)).token;
  }
  const clients = [];

  // Opens a chat socket as `as`. Options: cookie (a raw Cookie header, or null for
  // none), origin, path, and query (a raw query string). Resolves with a Client,
  // or rejects with a Refusal.
  function connect(as, appointmentId, options = {}) {
    const { cookie, origin, path = '/ws', query } = options;
    const headers = {};
    if (cookie !== null) headers.Cookie = cookie ?? `${COOKIE_NAME}=${tokens[as]}`;
    if (origin) headers.Origin = origin;
    const search =
      query ?? (appointmentId === null ? '' : `?appointment=${encodeURIComponent(appointmentId)}`);
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}${search}`, { headers });
    return new Promise((resolve, reject) => {
      ws.once('open', () => {
        const client = new Client(ws);
        clients.push(client);
        resolve(client);
      });
      ws.once('unexpected-response', (req, res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => reject(new Refusal(res.statusCode, Buffer.concat(chunks).toString('utf8'))));
      });
      ws.on('error', reject);
    });
  }

  return {
    chat,
    port,
    tokens,
    sessions,
    careStore,
    chatStore,
    auditStore,
    connect,
    close: async () => {
      for (const client of clients) client.terminate();
      chat.close();
      server.close();
      server.closeAllConnections();
    },
  };
}

// The audit entries of one action, as plain objects.
function entriesFor(auditStore, action) {
  return auditStore.entries.filter((entry) => entry.action === action).map((entry) => ({ ...entry }));
}

module.exports = {
  USERS,
  APPOINTMENTS,
  COOKIE_NAME,
  Refusal,
  Client,
  delay,
  waitUntil,
  startChat,
  entriesFor,
  appointment,
};
