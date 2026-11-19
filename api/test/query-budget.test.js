'use strict';

// Counts the statements that each request sends to the database, and fixes a cap
// for each route. The SQL stores run on a counting wrapper around a scripted fake
// database. The fake keeps rows in memory and answers the statement shapes that
// this code base uses. Any other statement returns no rows. Each test also checks
// the status code and the number of rows, so an empty fake cannot pass by
// accident.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createApp } = require('../src/app');
const { createSqlAuditStore } = require('../src/audit/store');
const { createSqlAuthStore } = require('../src/auth/store');
const { sha256Hex } = require('../src/auth/tokens');
const { createSqlCareStore } = require('../src/care/store');
const { createChat } = require('../src/chat');
const { silentLogger } = require('./helpers');

// Caps: the statements each request makes today. Each cap is the number of
// statements in the path, counted by reading the code (see docs/PERFORMANCE.md).
const CAP = Object.freeze({
  listAppointments: 3, // session join, session touch, list
  readAppointment: 3, // session join, session touch, appointment
  readConsultation: 6, // session join, touch, consultation, appointment, audit insert, audit read-back
  listAudit: 3, // session join, touch, audit list
  chatConnect: 6, // session join, touch, appointment, audit insert, audit read-back, history
  chatMessage: 7, // session join, touch, appointment, message insert, read-back, audit insert, read-back
});

const AUTH_CONFIG = {
  enabled: true,
  sessionCookieName: 'd7_session',
  absoluteTtlSeconds: 3600,
  idleTtlSeconds: 600,
  postLoginPath: '/',
};

const USERS = [
  { id: 'u-pro1', email: 'pro1@example.test', display_name: 'Professional One', role: 'professional', center_id: 'c1' },
  { id: 'u-cli1', email: 'cli1@example.test', display_name: 'Client One', role: 'client', center_id: 'c1' },
  { id: 'u-aud1', email: 'aud1@example.test', display_name: 'Auditor One', role: 'auditor', center_id: 'c1' },
];
const TOKEN = Object.fromEntries(USERS.map((user) => [user.id, `synthetic-token-${user.id}`]));
const COOKIE = (userId) => `d7_session=${TOKEN[userId]}`;

// Builds the scripted fake. `answer(sql, params)` returns rows for SELECT, or a
// result object for UPDATE and INSERT.
function scriptedDatabase({ appointments = 1, audit = 0, messages = 0 } = {}) {
  const sessions = new Map();
  const users = new Map(USERS.map((user) => [user.id, user]));
  const appointmentRows = new Map();
  const consultationRows = new Map();
  const auditRows = [];
  const messageRows = [];
  const now = Date.now();

  for (const user of USERS) {
    sessions.set(sha256Hex(TOKEN[user.id]), {
      user_id: user.id,
      created_at: new Date(now),
      last_seen_at: new Date(now),
      expires_at: new Date(now + 3600 * 1000),
      revoked_at: null,
    });
  }
  for (let i = 1; i <= appointments; i += 1) {
    appointmentRows.set(`a-${i}`, {
      id: `a-${i}`,
      center_id: 'c1',
      professional_id: 'u-pro1',
      client_id: 'u-cli1',
      starts_at: new Date(Date.UTC(2026, 11, 1, 15) + i * 3600 * 1000),
      ends_at: new Date(Date.UTC(2026, 11, 1, 15) + i * 3600 * 1000 + 50 * 60 * 1000),
      status: 'scheduled',
      created_at: new Date(Date.UTC(2026, 10, 1)),
    });
  }
  consultationRows.set('k-1', {
    id: 'k-1',
    appointment_id: 'a-1',
    body: '{"note":"synthetic note"}',
    created_at: new Date(Date.UTC(2026, 11, 1, 16)),
  });
  for (let i = 1; i <= audit; i += 1) {
    auditRows.push({
      id: `e-${i}`,
      actor_id: 'u-aud1',
      center_id: 'c1',
      action: 'auth.login',
      target_type: 'user',
      target_id: 'u-aud1',
      outcome: 'success',
      reason: null,
      ip: '127.0.0.1',
      occurred_at: new Date(Date.UTC(2026, 10, 1) + i * 1000),
    });
  }
  for (let i = 1; i <= messages; i += 1) {
    messageRows.push({
      id: `m-${i}`,
      appointment_id: 'a-1',
      sender_id: 'u-pro1',
      body: `synthetic message ${i}`,
      sent_at: new Date(Date.UTC(2026, 11, 1, 10) + i * 1000),
    });
  }

  const byStartThenId = (a, b) => a.starts_at - b.starts_at || (a.id < b.id ? -1 : 1);
  const page = (sql, rows) => {
    const match = sql.match(/LIMIT (\d+) OFFSET (\d+)/) || sql.match(/LIMIT (\d+)/);
    if (!match) return rows;
    const limit = Number(match[1]);
    const offset = match[2] === undefined ? 0 : Number(match[2]);
    return rows.slice(offset, offset + limit);
  };

  function answer(sql, params) {
    // Session join, run on every authenticated request.
    if (/FROM sessions s JOIN users u/.test(sql)) {
      const session = sessions.get(params[0]);
      if (!session) return [];
      const user = users.get(session.user_id);
      return [{ ...session, email: user.email, display_name: user.display_name, role: user.role, center_id: user.center_id }];
    }
    if (/^UPDATE sessions/.test(sql)) return { affectedRows: 1 };

    // Appointment list. The filters are bound in the order of the SQL text.
    if (/FROM appointments WHERE center_id = \?/.test(sql)) {
      const conditions = [['center_id', params[0]]];
      let index = 1;
      if (sql.includes('professional_id = ?')) conditions.push(['professional_id', params[index++]]);
      if (sql.includes('client_id = ?')) conditions.push(['client_id', params[index++]]);
      const rows = [...appointmentRows.values()]
        .filter((row) => conditions.every(([column, value]) => row[column] === value))
        .sort(byStartThenId);
      return page(sql, rows);
    }

    // Audit list, newest first.
    if (/FROM audit_log WHERE center_id = \?/.test(sql)) {
      const rows = auditRows.filter((row) => row.center_id === params[0]).sort((a, b) => b.occurred_at - a.occurred_at);
      return page(sql, rows);
    }

    // Chat history, newest first, then returned oldest first by the store.
    if (/FROM chat_messages WHERE appointment_id = \?/.test(sql)) {
      const rows = messageRows
        .filter((row) => row.appointment_id === params[0])
        .sort((a, b) => b.sent_at - a.sent_at);
      return page(sql, rows);
    }

    // Repository lookup by primary key.
    const lookup = sql.match(/^SELECT .* FROM `(\w+)` WHERE `id` = \? LIMIT 1/);
    if (lookup) {
      const table = { appointments: appointmentRows, consultations: consultationRows, users }[lookup[1]];
      const row = table ? table.get(params[0]) : undefined;
      return row ? [row] : [];
    }

    // Inserts report one affected row. The read-back that follows finds nothing,
    // because only the statement count matters here.
    if (/^INSERT INTO /.test(sql)) return { affectedRows: 1 };

    return [];
  }

  return { answer };
}

// Wraps the scripted fake. Every statement increments `count`.
function countingDatabase(script) {
  const db = {
    count: 0,
    async execute(sql, params = []) {
      db.count += 1;
      return script.answer(sql, params);
    },
    async run() {
      db.count += 1;
      return {};
    },
    async ping() {},
    async close() {},
  };
  return db;
}

// Builds the app and the chat on a loopback port, with SQL stores on the counting database.
async function setup(options) {
  const script = scriptedDatabase(options);
  const db = countingDatabase(script);
  const app = createApp({
    db,
    logger: silentLogger(),
    rateLimit: { limit: 1e9 },
    auth: { config: AUTH_CONFIG, store: createSqlAuthStore(db), oidc: {} },
    careStore: createSqlCareStore(db),
    auditStore: createSqlAuditStore(db),
  });
  const server = http.createServer(app);
  const chat = createChat({
    db,
    sessions: app.locals.auth.sessions,
    audit: app.locals.audit,
    cookieName: AUTH_CONFIG.sessionCookieName,
    logger: silentLogger(),
    sweepIntervalMs: 0,
  });
  chat.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function get(path, userId) {
    db.count = 0;
    const res = await fetch(`${base}${path}`, { headers: { Cookie: COOKIE(userId) } });
    const json = await res.json();
    return { status: res.status, json, count: db.count };
  }

  // Resolves with the next frame received on the socket.
  function nextFrame(ws) {
    return new Promise((resolve, reject) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString('utf8'))));
      ws.once('error', reject);
    });
  }

  async function close() {
    chat.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  return { db, base, get, nextFrame, close };
}

test('GET /appointments: the same bounded count for 1 row and for a full page of 50', async (t) => {
  const counts = [];
  for (const rows of [1, 50]) {
    const env = await setup({ appointments: rows });
    try {
      const res = await env.get('/appointments', 'u-pro1');
      assert.equal(res.status, 200);
      assert.equal(res.json.items.length, rows, 'the fake must return the rows, or the count proves nothing');
      counts.push(res.count);
    } finally {
      await env.close();
    }
  }
  t.diagnostic(`GET /appointments: ${counts[0]} statements with 1 row, ${counts[1]} with 50 rows (cap ${CAP.listAppointments})`);
  assert.ok(counts[0] <= CAP.listAppointments, `${counts[0]} statements, cap ${CAP.listAppointments}`);
  assert.equal(counts[1], counts[0], 'the count must not grow with the number of rows');
});

test('GET /appointments/:id stays within its cap', async (t) => {
  const env = await setup({ appointments: 1 });
  try {
    const res = await env.get('/appointments/a-1', 'u-pro1');
    assert.equal(res.status, 200);
    assert.equal(res.json.id, 'a-1');
    t.diagnostic(`GET /appointments/:id: ${res.count} statements (cap ${CAP.readAppointment})`);
    assert.ok(res.count <= CAP.readAppointment, `${res.count} statements, cap ${CAP.readAppointment}`);
  } finally {
    await env.close();
  }
});

test('GET /consultations/:id stays within its cap', async (t) => {
  const env = await setup({ appointments: 1 });
  try {
    const res = await env.get('/consultations/k-1', 'u-pro1');
    assert.equal(res.status, 200);
    assert.equal(res.json.id, 'k-1');
    t.diagnostic(`GET /consultations/:id: ${res.count} statements (cap ${CAP.readConsultation})`);
    assert.ok(res.count <= CAP.readConsultation, `${res.count} statements, cap ${CAP.readConsultation}`);
  } finally {
    await env.close();
  }
});

test('GET /audit: the same bounded count for 1 row and for a full page of 50', async (t) => {
  const counts = [];
  for (const rows of [1, 50]) {
    const env = await setup({ audit: rows });
    try {
      const res = await env.get('/audit', 'u-aud1');
      assert.equal(res.status, 200);
      assert.equal(res.json.items.length, rows, 'the fake must return the rows, or the count proves nothing');
      counts.push(res.count);
    } finally {
      await env.close();
    }
  }
  t.diagnostic(`GET /audit: ${counts[0]} statements with 1 row, ${counts[1]} with 50 rows (cap ${CAP.listAudit})`);
  assert.ok(counts[0] <= CAP.listAudit, `${counts[0]} statements, cap ${CAP.listAudit}`);
  assert.equal(counts[1], counts[0], 'the count must not grow with the number of rows');
});

test('chat: a connection and a message each stay within their caps, and the history is one query', async (t) => {
  const env = await setup({ appointments: 1, messages: 60 });
  try {
    const url = `${env.base.replace('http', 'ws')}/ws?appointment=a-1`;
    env.db.count = 0;
    const ws = new WebSocket(url, { headers: { Cookie: COOKIE('u-pro1') } });
    const history = await env.nextFrame(ws);
    const connectCount = env.db.count;
    assert.equal(history.type, 'history');
    assert.equal(history.items.length, 50, 'the history holds the 50 newest messages');
    t.diagnostic(`chat connect: ${connectCount} statements (cap ${CAP.chatConnect})`);
    assert.ok(connectCount <= CAP.chatConnect, `connect: ${connectCount} statements, cap ${CAP.chatConnect}`);

    env.db.count = 0;
    const echoed = env.nextFrame(ws);
    ws.send(JSON.stringify({ type: 'message', body: 'synthetic hello' }));
    const frame = await echoed;
    assert.equal(frame.type, 'message');
    t.diagnostic(`chat message: ${env.db.count} statements (cap ${CAP.chatMessage})`);
    assert.ok(env.db.count <= CAP.chatMessage, `message: ${env.db.count} statements, cap ${CAP.chatMessage}`);

    ws.terminate();
  } finally {
    await env.close();
  }
});
