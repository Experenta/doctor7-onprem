'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BY_NAME,
  RowError,
  canonicalJson,
  characterCount,
  isValidId,
  sameRow,
} = require('../lib/collections');

// Returns the rejection {code, field} for a document, or null when it maps.
function rejectionOf(name, doc) {
  try {
    BY_NAME[name].map(doc);
    return null;
  } catch (error) {
    if (error instanceof RowError) {
      return { code: error.code, field: error.field };
    }
    throw error;
  }
}

const VALID_CENTER = { id: 'demo-center', name: 'Demo Center', createdAt: '2026-01-01T00:00:00.000Z' };
const VALID_USER = {
  id: 'u-ana',
  centerId: 'demo-center',
  email: 'ana.rivera@example.test',
  displayName: 'Ana Rivera',
  role: 'professional',
  createdAt: '2026-01-02T00:00:00.000Z',
};
const VALID_APPOINTMENT = {
  id: 'apt-1',
  centerId: 'demo-center',
  professionalId: 'u-ana',
  clientId: 'u-luis',
  startsAt: '2026-01-05T15:00:00.000Z',
  endsAt: '2026-01-05T15:50:00.000Z',
  status: 'scheduled',
  createdAt: '2026-01-03T10:00:00.000Z',
};
const VALID_AUDIT = {
  id: 'audit-1',
  actorId: null,
  action: 'request.denied',
  targetType: 'route',
  targetId: null,
  occurredAt: '2026-01-05T14:02:00.000Z',
  centerId: null,
  outcome: 'denied',
  ip: '203.0.113.10',
  reason: 'no_rule',
};

describe('row mapping: valid rows', () => {
  test('a valid center maps to its columns in UTC', () => {
    assert.deepEqual(BY_NAME.centers.map(VALID_CENTER), {
      id: 'demo-center',
      name: 'Demo Center',
      created_at: '2026-01-01 00:00:00.000',
    });
  });

  test('a user without centerId maps to NULL, and the email keeps its case', () => {
    const row = BY_NAME.users.map({ ...VALID_USER, centerId: undefined, email: 'Ana@Example.test' });
    assert.equal(row.center_id, null);
    assert.equal(row.email, 'Ana@Example.test');
  });

  test('an appointment maps its times to UTC literals', () => {
    const row = BY_NAME.appointments.map(VALID_APPOINTMENT);
    assert.equal(row.starts_at, '2026-01-05 15:00:00.000');
    assert.equal(row.ends_at, '2026-01-05 15:50:00.000');
  });

  test('audit optional fields may be null or missing', () => {
    const row = BY_NAME.audit.map({ ...VALID_AUDIT, ip: undefined, reason: null });
    assert.equal(row.ip, null);
    assert.equal(row.reason, null);
    assert.equal(row.actor_id, null);
  });
});

describe('row mapping: rejections', () => {
  test('invalid_id: non-string, empty, too long, or padded with whitespace', () => {
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, id: 42 }), { code: 'invalid_id', field: 'id' });
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, id: '' }), { code: 'invalid_id', field: 'id' });
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, id: 'x'.repeat(65) }), {
      code: 'invalid_id',
      field: 'id',
    });
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, id: ' demo' }), { code: 'invalid_id', field: 'id' });
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, id: 'demo ' }), { code: 'invalid_id', field: 'id' });
  });

  test('ids count characters, not UTF-16 units', () => {
    assert.equal(rejectionOf('centers', { ...VALID_CENTER, id: '😀'.repeat(64) }), null);
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, id: '😀'.repeat(65) }), {
      code: 'invalid_id',
      field: 'id',
    });
  });

  test('a reference that is not a usable id is an invalid field, not an invalid id', () => {
    assert.deepEqual(rejectionOf('users', { ...VALID_USER, centerId: '' }), {
      code: 'invalid_field',
      field: 'centerId',
    });
  });

  test('invalid_field: missing text, bad email, unknown role, unknown status', () => {
    assert.deepEqual(rejectionOf('centers', { ...VALID_CENTER, name: '' }), {
      code: 'invalid_field',
      field: 'name',
    });
    assert.deepEqual(rejectionOf('users', { ...VALID_USER, email: 'ana rivera@example.test' }), {
      code: 'invalid_field',
      field: 'email',
    });
    assert.deepEqual(rejectionOf('users', { ...VALID_USER, role: 'guest' }), {
      code: 'invalid_field',
      field: 'role',
    });
    assert.deepEqual(rejectionOf('appointments', { ...VALID_APPOINTMENT, status: 'done' }), {
      code: 'invalid_field',
      field: 'status',
    });
  });

  test('invalid_field: a text longer than its column allows', () => {
    assert.deepEqual(rejectionOf('audit', { ...VALID_AUDIT, action: 'a'.repeat(101) }), {
      code: 'invalid_field',
      field: 'action',
    });
    assert.equal(rejectionOf('audit', { ...VALID_AUDIT, action: 'a'.repeat(100) }), null);
  });

  test('invalid_timestamp and timestamp_precision carry the source field name', () => {
    assert.deepEqual(rejectionOf('appointments', { ...VALID_APPOINTMENT, startsAt: '2026-01-05 15:00' }), {
      code: 'invalid_timestamp',
      field: 'startsAt',
    });
    assert.deepEqual(rejectionOf('appointments', { ...VALID_APPOINTMENT, endsAt: '2026-01-05T15:50:00.000001Z' }), {
      code: 'timestamp_precision',
      field: 'endsAt',
    });
  });

  test('invalid_time_range: endsAt equal to or before startsAt', () => {
    assert.deepEqual(rejectionOf('appointments', { ...VALID_APPOINTMENT, endsAt: VALID_APPOINTMENT.startsAt }), {
      code: 'invalid_time_range',
      field: 'endsAt',
    });
  });

  test('a consultation body must be a plain object', () => {
    assert.deepEqual(rejectionOf('consultations', { id: 'c-1', appointmentId: 'apt-1', body: ['x'], createdAt: VALID_CENTER.createdAt }), {
      code: 'invalid_field',
      field: 'body',
    });
    assert.deepEqual(rejectionOf('consultations', { id: 'c-1', appointmentId: 'apt-1', body: null, createdAt: VALID_CENTER.createdAt }), {
      code: 'invalid_field',
      field: 'body',
    });
  });

  test('a chat message body must be non-empty and at most 65535 bytes', () => {
    const base = { id: 'm-1', appointmentId: 'apt-1', senderId: 'u-ana', sentAt: '2026-01-05T15:02:00.000Z' };
    assert.deepEqual(rejectionOf('messages', { ...base, body: '' }), { code: 'invalid_field', field: 'body' });
    assert.equal(rejectionOf('messages', { ...base, body: 'x'.repeat(65535) }), null);
    assert.deepEqual(rejectionOf('messages', { ...base, body: 'x'.repeat(65536) }), {
      code: 'invalid_field',
      field: 'body',
    });
    // Two bytes per character: 32768 characters is 65536 bytes.
    assert.deepEqual(rejectionOf('messages', { ...base, body: 'ñ'.repeat(32768) }), {
      code: 'invalid_field',
      field: 'body',
    });
  });
});

describe('comparison and helpers', () => {
  test('canonicalJson sorts keys at every level', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  });

  test('two consultation rows with the same body in another key order are equal', () => {
    const def = BY_NAME.consultations;
    const base = { id: 'c-1', appointment_id: 'apt-1', created_at: '2026-01-03 13:00:00.000' };
    const stored = { ...base, body: '{"mood":6,"note":"Synthetic."}' };
    const incoming = { ...base, body: canonicalJson({ note: 'Synthetic.', mood: 6 }) };
    assert.equal(sameRow(def, stored, incoming), true);
    assert.equal(sameRow(def, stored, { ...incoming, body: '{"mood":7,"note":"Synthetic."}' }), false);
  });

  test('isValidId and characterCount follow the id rules', () => {
    assert.equal(isValidId('a'), true);
    assert.equal(isValidId(''), false);
    assert.equal(isValidId(undefined), false);
    assert.equal(characterCount('ñandú'), 5);
  });
});
