'use strict';

// Builds the synthetic seed for the public demo instance. Every instant is derived
// from `now`, so the seed is coherent for any run date. Every name, email, and
// address is invented: emails use example.test, and IPs use the RFC 5737 range.
// Output uses the source field names of the loader (see docs/MIGRATION.md).

const { toSqlDatetime } = require('./instant');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// America/Bogota is UTC-05:00 all year, with no daylight saving time.
const BOGOTA_OFFSET_MS = 5 * HOUR_MS;
const APPOINTMENT_MS = 50 * MINUTE_MS;
const MESSAGES_PER_APPOINTMENT = 4;
const SOURCE_IP = '203.0.113.10';
const DEMO_CENTER_ID = 'demo-center';

// The four accounts that the mock identity provider offers for sign-in (K-18).
const DEMO_USERS = [
  { id: 'u-ana', email: 'ana.rivera@example.test', displayName: 'Ana Rivera', role: 'professional' },
  { id: 'u-luis', email: 'luis.mora@example.test', displayName: 'Luis Mora', role: 'client' },
  { id: 'u-marta', email: 'marta.solis@example.test', displayName: 'Marta Solis', role: 'admin' },
  { id: 'u-iris', email: 'iris.vega@example.test', displayName: 'Iris Vega', role: 'auditor' },
];

// Participants of appointments. They have no sign-in use in the demo.
const PARTICIPANTS = [
  { id: 'u-diego', email: 'diego.parra@example.test', displayName: 'Diego Parra', role: 'professional' },
  { id: 'u-nina', email: 'nina.correa@example.test', displayName: 'Nina Correa', role: 'professional' },
  { id: 'u-teo', email: 'teo.ruiz@example.test', displayName: 'Teo Ruiz', role: 'client' },
  { id: 'u-alma', email: 'alma.ortiz@example.test', displayName: 'Alma Ortiz', role: 'client' },
  { id: 'u-hugo', email: 'hugo.bell@example.test', displayName: 'Hugo Bell', role: 'client' },
];

// Day offset is counted from the Bogota calendar date of `now`. Hour and minute are
// Bogota wall-clock time.
const APPOINTMENT_SLOTS = [
  { day: -14, hour: 9, minute: 0, professional: 'u-ana', client: 'u-luis' },
  { day: -10, hour: 10, minute: 0, professional: 'u-diego', client: 'u-hugo' },
  { day: -7, hour: 14, minute: 0, professional: 'u-ana', client: 'u-teo' },
  { day: -5, hour: 11, minute: 0, professional: 'u-ana', client: 'u-alma', cancelled: true },
  { day: -3, hour: 9, minute: 30, professional: 'u-ana', client: 'u-luis' },
  { day: -1, hour: 15, minute: 0, professional: 'u-diego', client: 'u-alma' },
  { day: 0, hour: 8, minute: 0, professional: 'u-ana', client: 'u-luis' },
  { day: 0, hour: 16, minute: 0, professional: 'u-diego', client: 'u-hugo' },
  { day: 1, hour: 10, minute: 0, professional: 'u-ana', client: 'u-luis' },
  { day: 3, hour: 15, minute: 0, professional: 'u-ana', client: 'u-teo', createdBy: 'u-marta' },
  { day: 4, hour: 10, minute: 0, professional: 'u-nina', client: 'u-teo' },
  { day: 6, hour: 9, minute: 0, professional: 'u-diego', client: 'u-hugo' },
];

const MESSAGE_TEXTS = [
  'Synthetic message: can we confirm the time?',
  'Synthetic reply: yes, the time works for me.',
  'Synthetic message: I will join from the clinic room.',
  'Synthetic reply: thank you, see you soon.',
];

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// Start of today in Bogota, as UTC milliseconds.
function bogotaDayStart(nowMs) {
  return Math.floor((nowMs - BOGOTA_OFFSET_MS) / DAY_MS) * DAY_MS + BOGOTA_OFFSET_MS;
}

function generateSeed(now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  toSqlDatetime(nowMs); // throws when `now` is outside the supported range
  const todayStart = bogotaDayStart(nowMs);

  const centers = [
    { id: DEMO_CENTER_ID, name: 'Demo Center', createdAt: iso(nowMs - 365 * DAY_MS) },
  ];

  const users = [...DEMO_USERS, ...PARTICIPANTS].map((user) => ({
    id: user.id,
    centerId: DEMO_CENTER_ID,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: iso(nowMs - 90 * DAY_MS),
  }));

  const appointments = [];
  const consultations = [];
  const messages = [];
  const auditRows = [];
  const consultationMeta = [];

  function audit(entry) {
    auditRows.push({
      ms: entry.occurredMs,
      row: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        occurredAt: iso(entry.occurredMs),
        centerId: entry.centerId === undefined ? DEMO_CENTER_ID : entry.centerId,
        outcome: entry.outcome ?? 'success',
        ip: SOURCE_IP,
        reason: entry.reason ?? null,
      },
    });
  }

  APPOINTMENT_SLOTS.forEach((slot, index) => {
    const number = pad(index + 1, 2);
    const id = `apt-${number}`;
    const startsMs = todayStart + slot.day * DAY_MS + slot.hour * HOUR_MS + (slot.minute ?? 0) * MINUTE_MS;
    const endsMs = startsMs + APPOINTMENT_MS;
    let status = 'scheduled';
    if (slot.cancelled) {
      status = 'cancelled';
    } else if (endsMs <= nowMs) {
      status = 'completed';
    }
    const createdMs = Math.min(startsMs - 2 * DAY_MS, nowMs - MINUTE_MS);

    appointments.push({
      id,
      centerId: DEMO_CENTER_ID,
      professionalId: slot.professional,
      clientId: slot.client,
      startsAt: iso(startsMs),
      endsAt: iso(endsMs),
      status,
      createdAt: iso(createdMs),
    });
    audit({
      actorId: slot.createdBy ?? slot.professional,
      action: 'appointment.create',
      targetType: 'appointment',
      targetId: id,
      occurredMs: createdMs,
    });

    if (status === 'completed') {
      const consultationId = `cons-${number}`;
      const consultationMs = Math.min(endsMs + 5 * MINUTE_MS, nowMs);
      consultations.push({
        id: consultationId,
        appointmentId: id,
        body: { note: `Synthetic session note ${number}.`, mood: 4 + (index % 5) },
        createdAt: iso(consultationMs),
      });
      consultationMeta.push({ consultationId, professional: slot.professional, client: slot.client, createdMs: consultationMs });
      audit({
        actorId: slot.professional,
        action: 'consultation.create',
        targetType: 'consultation',
        targetId: consultationId,
        occurredMs: consultationMs,
      });
    }

    if (status !== 'cancelled' && startsMs <= nowMs) {
      for (let i = 0; i < MESSAGES_PER_APPOINTMENT; i += 1) {
        const sentMs = startsMs + (2 + 4 * i) * MINUTE_MS;
        if (sentMs > nowMs) {
          break;
        }
        messages.push({
          id: `msg-${number}-${i + 1}`,
          appointmentId: id,
          senderId: i % 2 === 0 ? slot.professional : slot.client,
          body: MESSAGE_TEXTS[i % MESSAGE_TEXTS.length],
          sentAt: iso(sentMs),
        });
      }
    }
  });

  DEMO_USERS.forEach((user, index) => {
    audit({
      actorId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      occurredMs: nowMs - 3 * HOUR_MS + index * 10 * MINUTE_MS,
    });
  });

  const firstRead = consultationMeta[0];
  if (firstRead && firstRead.createdMs + HOUR_MS <= nowMs) {
    audit({
      actorId: firstRead.professional,
      action: 'consultation.read',
      targetType: 'consultation',
      targetId: firstRead.consultationId,
      occurredMs: firstRead.createdMs + HOUR_MS,
    });
  }

  const refused = consultationMeta.find((meta) => meta.client !== 'u-luis');
  if (refused) {
    audit({
      actorId: 'u-luis',
      action: 'consultation.read',
      targetType: 'consultation',
      targetId: refused.consultationId,
      outcome: 'denied',
      reason: 'not_participant',
      occurredMs: nowMs - 30 * MINUTE_MS,
    });
  }

  audit({
    actorId: null,
    action: 'request.denied',
    targetType: 'route',
    targetId: null,
    centerId: null,
    outcome: 'denied',
    reason: 'no_rule',
    occurredMs: nowMs - HOUR_MS,
  });

  // Stable sort by time, then fixed ids in that order.
  auditRows.sort((a, b) => a.ms - b.ms);
  const audited = auditRows.map((entry, index) => ({ id: `audit-${pad(index + 1, 3)}`, ...entry.row }));

  return { centers, users, appointments, consultations, messages, audit: audited };
}

module.exports = {
  generateSeed,
  bogotaDayStart,
  DEMO_CENTER_ID,
  DEMO_USERS,
  PARTICIPANTS,
  APPOINTMENT_SLOTS,
};
