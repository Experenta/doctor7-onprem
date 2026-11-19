'use strict';

// A light load generator for the API. It builds the API in this process with the
// in-memory stores, listens on a loopback port, and sends concurrent requests to
// it. It never sends a request to another host. The default load is small, so
// the test is quick. A larger load can be run by passing `requests` and
// `concurrency` to runLoad.

const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { createApp } = require('../../api/src/app');
const { createMemoryAuditStore } = require('../../api/src/audit/memoryStore');
const { createMemoryAuthStore } = require('../../api/src/auth/memoryStore');
const { createMemoryCareStore } = require('../../api/src/care/memoryStore');

const DEFAULTS = Object.freeze({
  requests: 120,
  concurrency: 4,
  appointments: 200,
  timeoutMs: 5000,
});
const LIMITS = Object.freeze({ requests: [1, 100000], concurrency: [1, 64], appointments: [1, 5000] });
const AUTH_CONFIG = Object.freeze({
  enabled: true,
  sessionCookieName: 'd7_session',
  absoluteTtlSeconds: 3600,
  idleTtlSeconds: 600,
  postLoginPath: '/',
});
const QUIET_LOGGER = Object.freeze({ error() {}, warn() {} });
// The database is not used by the memory stores. The stub only satisfies createApp.
const NO_DATABASE = Object.freeze({
  async ping() {},
  async execute() {
    return [];
  },
  async run() {
    return [];
  },
  async close() {},
});

// The value at rank ceil(p / 100 * n) of an ascending list (nearest-rank method).
function percentile(sorted, p) {
  if (sorted.length === 0) {
    throw new RangeError('percentile needs at least one value.');
  }
  if (!(p > 0 && p <= 100)) {
    throw new RangeError('p must be above 0 and at most 100.');
  }
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

function assertInRange(name, value) {
  const [min, max] = LIMITS[name];
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
}

// Synthetic data: one center, one professional, one client, and `appointments`
// appointments between them, plus one consultation on the first appointment.
function fixtures(count) {
  const users = [
    { id: 'u-pro1', email: 'pro1@example.test', displayName: 'Professional One', role: 'professional', centerId: 'c1' },
    { id: 'u-cli1', email: 'cli1@example.test', displayName: 'Client One', role: 'client', centerId: 'c1' },
  ];
  const base = Date.UTC(2026, 11, 1, 15);
  const appointments = Array.from({ length: count }, (_, index) => ({
    id: `a-${index + 1}`,
    centerId: 'c1',
    professionalId: 'u-pro1',
    clientId: 'u-cli1',
    startsAt: new Date(base + index * 3600 * 1000),
    endsAt: new Date(base + index * 3600 * 1000 + 50 * 60 * 1000),
    status: 'scheduled',
    createdAt: new Date(Date.UTC(2026, 10, 1)),
  }));
  const consultations = [
    {
      id: 'k-1',
      appointmentId: 'a-1',
      body: { note: 'synthetic note for the load test' },
      createdAt: new Date(Date.UTC(2026, 11, 1, 16)),
    },
  ];
  return { users, appointments, consultations };
}

// The three reads that the load mixes, as the professional of the appointments.
function pathFor(index, appointmentCount) {
  switch (index % 3) {
    case 0:
      return '/appointments';
    case 1:
      return `/appointments/a-${(index % appointmentCount) + 1}`;
    default:
      return '/consultations/k-1';
  }
}

// Sends `requests` GET requests with `concurrency` workers. Resolves with the report.
// `token` replaces the session token. The generator tests use a wrong token to
// check that errors are counted.
async function runLoad(options = {}) {
  const settings = { ...DEFAULTS, ...options };
  for (const name of Object.keys(LIMITS)) assertInRange(name, settings[name]);

  const data = fixtures(settings.appointments);
  const app = createApp({
    db: NO_DATABASE,
    logger: QUIET_LOGGER,
    // The default limit is per client address. This load comes from one address.
    rateLimit: { limit: 1e9 },
    auth: { config: AUTH_CONFIG, store: createMemoryAuthStore({ users: data.users }), oidc: {} },
    careStore: createMemoryCareStore({
      users: data.users,
      appointments: data.appointments,
      consultations: data.consultations,
    }),
    auditStore: createMemoryAuditStore(),
  });

  const token =
    settings.token !== undefined
      ? settings.token
      : (await app.locals.auth.sessions.create(data.users[0])).token;
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const latencies = [];
  let errors = 0;
  let next = 0;

  async function one(index) {
    const started = performance.now();
    try {
      const res = await fetch(`${base}${pathFor(index, settings.appointments)}`, {
        headers: { Cookie: `${AUTH_CONFIG.sessionCookieName}=${token}` },
        signal: AbortSignal.timeout(settings.timeoutMs),
      });
      await res.arrayBuffer();
      if (res.status !== 200) errors += 1;
    } catch {
      errors += 1;
    }
    latencies.push(performance.now() - started);
  }

  async function worker() {
    while (next < settings.requests) {
      const index = next;
      next += 1;
      await one(index);
    }
  }

  const started = performance.now();
  try {
    await Promise.all(Array.from({ length: settings.concurrency }, worker));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const durationMs = performance.now() - started;

  const sorted = [...latencies].sort((a, b) => a - b);
  const round = (value) => Math.round(value * 100) / 100;
  return {
    requests: settings.requests,
    concurrency: settings.concurrency,
    errors,
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    durationMs: round(durationMs),
  };
}

module.exports = { runLoad, percentile, DEFAULTS, LIMITS };
