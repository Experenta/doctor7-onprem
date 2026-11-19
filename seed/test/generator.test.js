'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  generateSeed,
  bogotaDayStart,
  DEMO_CENTER_ID,
  DEMO_USERS,
  PARTICIPANTS,
} = require('../lib/generator');
const { loadCollections } = require('../lib/loader');
const { createMemoryStore } = require('./memory-store');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SAMPLE_NOW = [
  Date.UTC(2026, 10, 19, 5, 10, 51, 908), // 00:10 in Bogota, so today's slots are ahead
  Date.UTC(2026, 10, 19, 14, 0, 0), // 09:00 in Bogota, so the 08:00 slot has started
  Date.UTC(2026, 10, 19, 4, 59, 59, 999), // last millisecond of Bogota 18 November
];

// Calendar date in America/Bogota (UTC-05:00 all year).
function bogotaDate(ms) {
  return new Date(ms - 5 * HOUR_MS).toISOString().slice(0, 10);
}

function allSeeds() {
  return SAMPLE_NOW.map((nowMs) => [nowMs, generateSeed(nowMs)]);
}

describe('synthetic seed: validity', () => {
  for (const [nowMs, seed] of allSeeds()) {
    test(`loads with zero rejections and a second load changes nothing (now ${new Date(nowMs).toISOString()})`, async () => {
      const store = createMemoryStore();
      const first = await loadCollections(seed, store);
      assert.equal(first.totals.rejected, 0);
      assert.equal(first.totals.inserted, first.totals.read);

      const second = await loadCollections(seed, store);
      assert.equal(second.totals.inserted, 0);
      assert.equal(second.totals.unchanged, first.totals.read);
    });
  }

  test('a seed loads with zero rejections for any run date', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2032, 0, 1) }), async (nowMs) => {
        const report = await loadCollections(generateSeed(nowMs), createMemoryStore());
        assert.equal(report.totals.rejected, 0);
      }),
      { numRuns: 60 }
    );
  });

  test('a run date outside the supported range is refused', () => {
    assert.throws(() => generateSeed(Date.UTC(10000, 0, 1)));
    assert.throws(() => generateSeed(new Date('not a date')));
  });
});

describe('synthetic seed: demo accounts', () => {
  test('the four sign-in accounts are present once, in demo-center, with fixed roles', () => {
    const seed = generateSeed(SAMPLE_NOW[0]);
    const expected = [
      ['ana.rivera@example.test', 'professional'],
      ['luis.mora@example.test', 'client'],
      ['marta.solis@example.test', 'admin'],
      ['iris.vega@example.test', 'auditor'],
    ];
    for (const [email, role] of expected) {
      const matches = seed.users.filter((user) => user.email === email);
      assert.equal(matches.length, 1, email);
      assert.equal(matches[0].role, role);
      assert.equal(matches[0].centerId, DEMO_CENTER_ID);
    }
    assert.deepEqual(
      DEMO_USERS.map((user) => user.email),
      expected.map(([email]) => email)
    );
  });

  test('other participants are professionals and clients of demo-center only', () => {
    assert.deepEqual(
      PARTICIPANTS.map((user) => user.role).sort(),
      ['client', 'client', 'client', 'professional', 'professional']
    );
  });

  test('no row mentions no.role@example.test', () => {
    for (const [, seed] of allSeeds()) {
      assert.equal(JSON.stringify(seed).includes('no.role@'), false);
    }
  });

  test('every email is under example.test and every IP is in the RFC 5737 range', () => {
    for (const [, seed] of allSeeds()) {
      for (const user of seed.users) {
        assert.match(user.email, /@example\.test$/);
      }
      for (const entry of seed.audit) {
        if (entry.ip !== null) {
          assert.match(entry.ip, /^203\.0\.113\.\d{1,3}$/);
        }
      }
    }
  });
});

describe('synthetic seed: appointments and time', () => {
  test('appointments cover the past, today, and the future in Bogota time', () => {
    for (const [nowMs, seed] of allSeeds()) {
      const today = bogotaDate(nowMs);
      const dates = seed.appointments.map((apt) => bogotaDate(Date.parse(apt.startsAt)));
      assert.ok(dates.some((date) => date < today), 'past');
      assert.ok(dates.some((date) => date === today), 'today');
      assert.ok(dates.some((date) => date > today), 'future');
    }
  });

  test('bogotaDayStart is 05:00 UTC for every instant of the Bogota day', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2030, 0, 1) }), (nowMs) => {
        const start = bogotaDayStart(nowMs);
        assert.equal(new Date(start).getUTCHours(), 5);
        assert.equal(new Date(start).getUTCMinutes(), 0);
        assert.ok(start <= nowMs && nowMs < start + DAY_MS);
      }),
      { numRuns: 200 }
    );
  });

  test('status: cancelled as marked, completed when the end has passed, scheduled otherwise', () => {
    for (const [nowMs, seed] of allSeeds()) {
      for (const apt of seed.appointments) {
        if (apt.status === 'cancelled') {
          continue;
        }
        const ended = Date.parse(apt.endsAt) <= nowMs;
        assert.equal(apt.status, ended ? 'completed' : 'scheduled', apt.id);
      }
      assert.ok(seed.appointments.some((apt) => apt.status === 'cancelled'));
    }
  });

  test('every instant is an ISO 8601 UTC string with milliseconds', () => {
    const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    for (const [, seed] of allSeeds()) {
      for (const collection of Object.values(seed)) {
        for (const row of collection) {
          for (const [key, value] of Object.entries(row)) {
            if (/At$/.test(key) && value !== null) {
              assert.match(value, pattern, `${key} of ${row.id}`);
            }
          }
        }
      }
    }
  });
});

describe('synthetic seed: consultations, messages, and audit', () => {
  test('consultations belong to completed appointments and were created between start and now', () => {
    for (const [nowMs, seed] of allSeeds()) {
      const byId = new Map(seed.appointments.map((apt) => [apt.id, apt]));
      for (const consultation of seed.consultations) {
        const apt = byId.get(consultation.appointmentId);
        assert.equal(apt.status, 'completed', consultation.id);
        const createdMs = Date.parse(consultation.createdAt);
        assert.ok(createdMs >= Date.parse(apt.startsAt) && createdMs <= nowMs, consultation.id);
      }
    }
  });

  test('messages belong to started appointments, come from a participant, and rise in time', () => {
    for (const [nowMs, seed] of allSeeds()) {
      const byId = new Map(seed.appointments.map((apt) => [apt.id, apt]));
      const lastSent = new Map();
      for (const message of seed.messages) {
        const apt = byId.get(message.appointmentId);
        assert.notEqual(apt.status, 'cancelled', message.id);
        assert.ok([apt.professionalId, apt.clientId].includes(message.senderId), message.id);
        const sentMs = Date.parse(message.sentAt);
        assert.ok(sentMs >= Date.parse(apt.startsAt) && sentMs < Date.parse(apt.endsAt), message.id);
        assert.ok(sentMs <= nowMs, message.id);
        const previous = lastSent.get(apt.id) ?? -Infinity;
        assert.ok(sentMs > previous, `${message.id} order`);
        lastSent.set(apt.id, sentMs);
      }
      assert.ok(seed.messages.length > 0);
    }
  });

  test('audit entries occur at or before now and include the required kinds', () => {
    for (const [nowMs, seed] of allSeeds()) {
      for (const entry of seed.audit) {
        assert.ok(Date.parse(entry.occurredAt) <= nowMs, entry.id);
      }
      const logins = seed.audit.filter((entry) => entry.action === 'auth.login').map((entry) => entry.actorId);
      assert.deepEqual(logins.sort(), DEMO_USERS.map((user) => user.id).sort());

      const count = (action) => seed.audit.filter((entry) => entry.action === action).length;
      assert.equal(count('appointment.create'), seed.appointments.length);
      assert.equal(count('consultation.create'), seed.consultations.length);
      assert.ok(count('consultation.read') >= 1);
      assert.ok(
        seed.audit.some(
          (entry) =>
            entry.action === 'consultation.read' &&
            entry.outcome === 'denied' &&
            entry.reason === 'not_participant'
        )
      );
      assert.ok(
        seed.audit.some(
          (entry) =>
            entry.action === 'request.denied' &&
            entry.actorId === null &&
            entry.centerId === null &&
            entry.reason === 'no_rule'
        )
      );
    }
  });

  test('ids do not depend on the run date, so a later seed reuses them (R27)', () => {
    const first = generateSeed(SAMPLE_NOW[0]);
    const second = generateSeed(SAMPLE_NOW[0] + 3 * HOUR_MS);
    assert.deepEqual(
      first.appointments.map((apt) => apt.id),
      second.appointments.map((apt) => apt.id)
    );
    assert.equal(first.audit.length, second.audit.length);
  });
});
