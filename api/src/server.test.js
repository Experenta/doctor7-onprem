'use strict';

// Tests of createServer, shutdown, and start. Each test starts its own server with
// in-memory stores, so no database is needed. The chat helpers come from the chat
// harness, which is not a test file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createServer, shutdown, start } = require('./server');
const { loadConfig } = require('./config');
const { createSessionService } = require('./auth/session');
const { createMemoryAuthStore } = require('./auth/memoryStore');
const { createMemoryCareStore } = require('./care/memoryStore');
const { createMemoryChatStore } = require('./chat/memoryStore');
const { createMemoryAuditStore } = require('./audit/memoryStore');
const { Client, Refusal, USERS, APPOINTMENTS, COOKIE_NAME, entriesFor } = require('./chat/harness');
const { fakeDb } = require('../test/helpers');

const quietLogger = { error() {}, warn() {} };
const SIGN_IN = {
  OIDC_ISSUER: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'doctor7-test-client',
  OIDC_REDIRECT_URI: 'https://clinic.example.test/auth/callback',
};
// The host and database name are invented. No password is part of the value.
const DATABASE_URL = 'mysql://127.0.0.1:1/doctor7_test';

// Rejects when `promise` does not settle within `ms`. The timer is cleared when
// the race ends, so it does not keep the test process alive.
function withTimeout(promise, ms, label) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}.`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Starts createServer on a free loopback port. With `signIn: false` the server has
// no sign-in settings, so it has no chat.
async function startServer({ signIn = true, env = {} } = {}) {
  const config = loadConfig(signIn ? { ...SIGN_IN, ...env } : { ...env });
  const authStore = createMemoryAuthStore({ users: USERS });
  const careStore = createMemoryCareStore({ users: USERS, appointments: APPOINTMENTS });
  const chatStore = createMemoryChatStore();
  const auditStore = createMemoryAuditStore();
  const db = fakeDb();
  db.closed = false;
  db.close = async () => {
    db.closed = true;
  };

  const server = createServer({
    db,
    config,
    authStore,
    careStore,
    chatStore,
    auditStore,
    oidc: {},
    sweepIntervalMs: 0,
    logger: quietLogger,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  // The session service of the server reads the same store, so a session made here is live there.
  const tokens = {};
  if (config.auth.enabled) {
    const sessions = createSessionService({ store: authStore, config: config.auth });
    for (const user of USERS) {
      tokens[user.id] = (await sessions.create(user)).token;
    }
  }

  const clients = [];

  // Opens /ws as `as` (a user id, or null for no cookie). Resolves with a Client,
  // or rejects with a Refusal.
  function connect(as, appointmentId) {
    const headers = as ? { Cookie: `${COOKIE_NAME}=${tokens[as]}` } : {};
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?appointment=${encodeURIComponent(appointmentId)}`, {
      headers,
    });
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
    config,
    server,
    db,
    port,
    tokens,
    auditStore,
    connect,
    stop: () => shutdown(server, { db, graceMs: 200 }),
  };
}

// Opens /ws with a raw socket and then stops reading, like a client that never
// answers a close frame. Resolves with the socket once the handshake is upgraded.
function silentChatSocket(port, token, appointmentId) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(
        [
          `GET /ws?appointment=${appointmentId} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          `Cookie: ${COOKIE_NAME}=${token}`,
          '',
          '',
        ].join('\r\n')
      );
    });
    socket.once('data', (chunk) => {
      if (chunk.toString('latin1').startsWith('HTTP/1.1 101')) {
        socket.pause();
        resolve(socket);
      } else {
        socket.destroy();
        reject(new Error('The handshake was not upgraded.'));
      }
    });
  });
}

test('createServer answers GET /healthz with 200 from the in-memory stores', async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    await ctx.stop();
  }
});

test('an upgrade of /ws without a session is refused with 401, and no chat socket opens', async () => {
  const ctx = await startServer();
  try {
    await assert.rejects(ctx.connect(null, 'a1'), (err) => err instanceof Refusal && err.status === 401);
    assert.equal(entriesFor(ctx.auditStore, 'chat.connect').length, 0);
  } finally {
    await ctx.stop();
  }
});

test('an upgrade of /ws from a participant of the appointment opens the chat and sends the history', async () => {
  const ctx = await startServer();
  try {
    const pro = await ctx.connect('u-pro1', 'a1');
    assert.equal(pro.ws.readyState, WebSocket.OPEN);
    assert.deepEqual((await pro.take('history')).items, []);

    const connects = entriesFor(ctx.auditStore, 'chat.connect');
    assert.equal(connects.length, 1);
    assert.equal(connects[0].outcome, 'success');
    assert.equal(connects[0].actorId, 'u-pro1');
  } finally {
    await ctx.stop();
  }
});

test('an administrator of the center gets the same 404 as for a missing appointment', async () => {
  const ctx = await startServer();
  try {
    const refusal = await ctx.connect('u-adm1', 'a1').then(
      () => assert.fail('the handshake was accepted'),
      (err) => err
    );
    assert.equal(refusal.status, 404);
    assert.equal(JSON.parse(refusal.body).error.code, 'not_found');
  } finally {
    await ctx.stop();
  }
});

test('without sign-in settings the probes answer and /ws has no handler', async () => {
  const ctx = await startServer({ signIn: false });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${ctx.port}/healthz`)).status, 200);
    assert.equal(ctx.server.listenerCount('upgrade'), 0);
    await assert.rejects(ctx.connect('u-pro1', 'a1'));
  } finally {
    await ctx.stop();
  }
});

test('shutdown closes every open chat socket with code 1001, stops the server, and closes the database', async () => {
  const ctx = await startServer();
  const pro = await ctx.connect('u-pro1', 'a1');
  const cli = await ctx.connect('u-cli1', 'a1');
  await pro.take('history');
  await cli.take('history');

  await withTimeout(ctx.stop(), 3000, 'shutdown did not finish');

  assert.equal((await pro.closedWith()).code, 1001);
  assert.equal((await cli.closedWith()).code, 1001);
  assert.equal(ctx.server.listening, false);
  assert.equal(ctx.db.closed, true);
});

test('shutdown destroys a connection that never answers the close frame, after the grace period', async () => {
  const ctx = await startServer();
  const socket = await silentChatSocket(ctx.port, ctx.tokens['u-pro1'], 'a1');
  try {
    const started = Date.now();
    await withTimeout(shutdown(ctx.server, { db: ctx.db, graceMs: 200 }), 5000, 'shutdown held the process');
    assert.ok(Date.now() - started >= 150, 'shutdown waited for the grace period before it forced the close');
    assert.equal(ctx.server.listening, false);
    assert.equal(ctx.db.closed, true);

    // The client paused its socket, so it sees the end of the stream only after it resumes.
    const closed = once(socket, 'close');
    socket.resume();
    await withTimeout(closed, 3000, 'the silent socket was not closed');
  } finally {
    socket.destroy();
  }
});

test('start refuses a wrong VIDEO_PROVIDER before it opens anything, and names the variable only', () => {
  const marker = 'provider-marker-5e2b';
  assert.throws(
    () => start({ DATABASE_URL, VIDEO_PROVIDER: marker }),
    (err) => err.message.includes('VIDEO_PROVIDER') && !err.message.includes(marker)
  );
});

test('start refuses a missing or non-MySQL DATABASE_URL before it opens anything', () => {
  assert.throws(() => start({}), /DATABASE_URL is required\./);
  const marker = 'database-marker-91aa';
  assert.throws(
    () => start({ DATABASE_URL: `postgres://user:${marker}@127.0.0.1:1/doctor7_test` }),
    (err) => err.message.startsWith('DATABASE_URL') && !err.message.includes(marker)
  );
});

test('the api test script runs the tests of src and of test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test "src/**/*.test.js" "test/**/*.test.js"');
});
