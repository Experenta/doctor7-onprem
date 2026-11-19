'use strict';

// Collection definitions: source field names, table columns, row validation, and
// the participant rules. Columns and rules follow the K-02 schema in
// api/migrations. Source fields use the camelCase names of the API.

const { parseInstant, toSqlDatetime, InstantError } = require('./instant');

const ROLES = ['professional', 'client', 'admin', 'auditor'];
const APPOINTMENT_STATUSES = ['scheduled', 'cancelled', 'completed'];
const AUDIT_OUTCOMES = ['success', 'denied', 'failure'];
const ID_MAX_LENGTH = 64;
const MESSAGE_MAX_BYTES = 65535;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

// A rejected row. `code` is documented in docs/MIGRATION.md. `field` is the source
// field name, never a value.
class RowError extends Error {
  constructor(code, field = null) {
    super(code);
    this.name = 'RowError';
    this.code = code;
    this.field = field;
  }
}

// A failure reported by a store. `kind` is one of: duplicate, missing_reference,
// check_violation.
class StoreError extends Error {
  constructor(kind) {
    super(kind);
    this.name = 'StoreError';
    this.kind = kind;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Length in characters, counted the way VARCHAR counts them in utf8mb4.
function characterCount(text) {
  return Array.from(text).length;
}

// Ids are strings of 1 to 64 characters with no leading or trailing whitespace.
// The binary collation of K-02 pads with spaces, so such ids would collide.
function isValidId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    characterCount(value) <= ID_MAX_LENGTH &&
    value === value.trim()
  );
}

function readId(doc) {
  if (!isValidId(doc.id)) {
    throw new RowError('invalid_id', 'id');
  }
  return doc.id;
}

// A reference to another row (center, user, appointment). Same rules as an id,
// but the failure is reported as an invalid field.
function readRefId(doc, field) {
  if (!isValidId(doc[field])) {
    throw new RowError('invalid_field', field);
  }
  return doc[field];
}

function readOptionalRefId(doc, field) {
  if (doc[field] === undefined || doc[field] === null) {
    return null;
  }
  return readRefId(doc, field);
}

function readText(doc, field, maxLength) {
  const value = doc[field];
  if (typeof value !== 'string' || value.length === 0 || characterCount(value) > maxLength) {
    throw new RowError('invalid_field', field);
  }
  return value;
}

function readOptionalText(doc, field, maxLength) {
  if (doc[field] === undefined || doc[field] === null) {
    return null;
  }
  return readText(doc, field, maxLength);
}

function readEmail(doc, field) {
  const value = readText(doc, field, 254);
  if (!EMAIL_PATTERN.test(value)) {
    throw new RowError('invalid_field', field);
  }
  return value;
}

function readEnum(doc, field, allowed) {
  if (!allowed.includes(doc[field])) {
    throw new RowError('invalid_field', field);
  }
  return doc[field];
}

function readInstant(doc, field) {
  try {
    return parseInstant(doc[field]);
  } catch (error) {
    if (error instanceof InstantError) {
      throw new RowError(error.code, field);
    }
    throw error;
  }
}

function readSqlDatetime(doc, field) {
  return toSqlDatetime(readInstant(doc, field));
}

// Canonical JSON: object keys sorted at every level, so equal documents compare equal.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJsonObject(doc, field) {
  if (!isPlainObject(doc[field])) {
    throw new RowError('invalid_field', field);
  }
  return canonicalJson(doc[field]);
}

function readMessageBody(doc, field) {
  const value = doc[field];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MESSAGE_MAX_BYTES
  ) {
    throw new RowError('invalid_field', field);
  }
  return value;
}

function mapCenter(doc) {
  const id = readId(doc);
  return {
    id,
    name: readText(doc, 'name', 200),
    created_at: readSqlDatetime(doc, 'createdAt'),
  };
}

function mapUser(doc) {
  const id = readId(doc);
  return {
    id,
    center_id: readOptionalRefId(doc, 'centerId'),
    email: readEmail(doc, 'email'),
    display_name: readText(doc, 'displayName', 200),
    role: readEnum(doc, 'role', ROLES),
    created_at: readSqlDatetime(doc, 'createdAt'),
  };
}

function mapAppointment(doc) {
  const id = readId(doc);
  const centerId = readRefId(doc, 'centerId');
  const professionalId = readRefId(doc, 'professionalId');
  const clientId = readRefId(doc, 'clientId');
  const startsMs = readInstant(doc, 'startsAt');
  const endsMs = readInstant(doc, 'endsAt');
  if (endsMs <= startsMs) {
    throw new RowError('invalid_time_range', 'endsAt');
  }
  return {
    id,
    center_id: centerId,
    professional_id: professionalId,
    client_id: clientId,
    starts_at: toSqlDatetime(startsMs),
    ends_at: toSqlDatetime(endsMs),
    status: readEnum(doc, 'status', APPOINTMENT_STATUSES),
    created_at: readSqlDatetime(doc, 'createdAt'),
  };
}

function mapConsultation(doc) {
  const id = readId(doc);
  return {
    id,
    appointment_id: readRefId(doc, 'appointmentId'),
    body: readJsonObject(doc, 'body'),
    created_at: readSqlDatetime(doc, 'createdAt'),
  };
}

function mapMessage(doc) {
  const id = readId(doc);
  return {
    id,
    appointment_id: readRefId(doc, 'appointmentId'),
    sender_id: readRefId(doc, 'senderId'),
    body: readMessageBody(doc, 'body'),
    sent_at: readSqlDatetime(doc, 'sentAt'),
  };
}

function mapAudit(doc) {
  const id = readId(doc);
  return {
    id,
    actor_id: readOptionalRefId(doc, 'actorId'),
    action: readText(doc, 'action', 100),
    target_type: readText(doc, 'targetType', 50),
    target_id: readOptionalRefId(doc, 'targetId'),
    occurred_at: readSqlDatetime(doc, 'occurredAt'),
    center_id: readOptionalRefId(doc, 'centerId'),
    outcome: readEnum(doc, 'outcome', AUDIT_OUTCOMES),
    ip: readOptionalText(doc, 'ip', 45),
    reason: readOptionalText(doc, 'reason', 100),
  };
}

// The professional and the client of an appointment must exist, hold the right
// role, and belong to the appointment's center. The store returns referenced rows.
async function checkAppointmentParticipants(row, store) {
  const checks = [
    ['professionalId', row.professional_id, 'professional'],
    ['clientId', row.client_id, 'client'],
  ];
  for (const [field, userId, role] of checks) {
    const user = await store.get(BY_NAME.users, userId);
    if (!user) {
      throw new RowError('missing_reference', field);
    }
    if (user.role !== role) {
      throw new RowError('participant_role', field);
    }
    if (user.center_id !== row.center_id) {
      throw new RowError('participant_center', field);
    }
  }
}

// A chat message is sent by the professional or the client of its appointment.
async function checkMessageSender(row, store) {
  const appointment = await store.get(BY_NAME.appointments, row.appointment_id);
  if (!appointment) {
    throw new RowError('missing_reference', 'appointmentId');
  }
  if (row.sender_id !== appointment.professional_id && row.sender_id !== appointment.client_id) {
    throw new RowError('not_participant', 'senderId');
  }
}

// Order matters: a collection loads after the collections it references.
const COLLECTIONS = [
  {
    name: 'centers',
    table: 'centers',
    columns: ['id', 'name', 'created_at'],
    datetime: ['created_at'],
    json: [],
    unique: [],
    references: [],
    map: mapCenter,
    participants: null,
  },
  {
    name: 'users',
    table: 'users',
    columns: ['id', 'center_id', 'email', 'display_name', 'role', 'created_at'],
    datetime: ['created_at'],
    json: [],
    unique: ['email'],
    references: [{ column: 'center_id', table: 'centers' }],
    map: mapUser,
    participants: null,
  },
  {
    name: 'appointments',
    table: 'appointments',
    columns: [
      'id',
      'center_id',
      'professional_id',
      'client_id',
      'starts_at',
      'ends_at',
      'status',
      'created_at',
    ],
    datetime: ['starts_at', 'ends_at', 'created_at'],
    json: [],
    unique: [],
    references: [
      { column: 'center_id', table: 'centers' },
      { column: 'professional_id', table: 'users' },
      { column: 'client_id', table: 'users' },
    ],
    map: mapAppointment,
    participants: checkAppointmentParticipants,
  },
  {
    name: 'consultations',
    table: 'consultations',
    columns: ['id', 'appointment_id', 'body', 'created_at'],
    datetime: ['created_at'],
    json: ['body'],
    unique: [],
    references: [{ column: 'appointment_id', table: 'appointments' }],
    map: mapConsultation,
    participants: null,
  },
  {
    name: 'messages',
    table: 'chat_messages',
    columns: ['id', 'appointment_id', 'sender_id', 'body', 'sent_at'],
    datetime: ['sent_at'],
    json: [],
    unique: [],
    references: [
      { column: 'appointment_id', table: 'appointments' },
      { column: 'sender_id', table: 'users' },
    ],
    map: mapMessage,
    participants: checkMessageSender,
  },
  {
    name: 'audit',
    table: 'audit_log',
    columns: [
      'id',
      'actor_id',
      'action',
      'target_type',
      'target_id',
      'occurred_at',
      'center_id',
      'outcome',
      'ip',
      'reason',
    ],
    datetime: ['occurred_at'],
    json: [],
    unique: [],
    references: [],
    map: mapAudit,
    participants: null,
  },
];

const BY_NAME = Object.fromEntries(COLLECTIONS.map((def) => [def.name, def]));

// Compares two rows column by column. JSON columns are canonicalized first, so
// key order and spacing do not matter.
function normalizeForCompare(def, row) {
  const out = {};
  for (const column of def.columns) {
    const value = row[column];
    if (value === undefined || value === null) {
      out[column] = null;
    } else if (def.json.includes(column)) {
      out[column] = canonicalJson(typeof value === 'string' ? JSON.parse(value) : value);
    } else {
      out[column] = value;
    }
  }
  return out;
}

function sameRow(def, stored, incoming) {
  const a = normalizeForCompare(def, stored);
  const b = normalizeForCompare(def, incoming);
  return def.columns.every((column) => a[column] === b[column]);
}

module.exports = {
  COLLECTIONS,
  BY_NAME,
  RowError,
  StoreError,
  canonicalJson,
  characterCount,
  isValidId,
  normalizeForCompare,
  sameRow,
};
