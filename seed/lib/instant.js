'use strict';

// Instants for DATETIME(3) columns. Input forms: an ISO 8601 string with an
// explicit offset, or {seconds, nanoseconds}. Everything is kept as integer
// milliseconds since the Unix epoch, in UTC. Sub-millisecond input is rejected,
// never truncated, so a stored instant always equals the input instant.

const MIN_MS = Date.UTC(1000, 0, 1, 0, 0, 0, 0);
const MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const MAX_ABS_SECONDS = 1e12;

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

class InstantError extends Error {
  constructor(code) {
    super(code);
    this.name = 'InstantError';
    this.code = code;
  }
}

function invalid() {
  return new InstantError('invalid_timestamp');
}

function checkRange(ms) {
  if (!Number.isInteger(ms) || ms < MIN_MS || ms > MAX_MS) {
    throw invalid();
  }
  return ms;
}

function parseIsoInstant(text) {
  const match = ISO_PATTERN.exec(text);
  if (!match) {
    throw invalid();
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw invalid();
  }
  // Date.UTC rolls over impossible days such as February 30, so compare back.
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) {
    throw invalid();
  }

  if (/[1-9]/.test(fraction.slice(3))) {
    throw new InstantError('timestamp_precision');
  }
  const milliseconds = Number(fraction.slice(0, 3).padEnd(3, '0'));

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw invalid();
    }
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  return checkRange(wallClockMs - offsetMinutes * 60000);
}

function parseObjectInstant(value) {
  const allowed = new Set(['seconds', 'nanoseconds']);
  if (!Object.keys(value).every((key) => allowed.has(key))) {
    throw invalid();
  }
  if (!Number.isSafeInteger(value.seconds) || Math.abs(value.seconds) > MAX_ABS_SECONDS) {
    throw invalid();
  }
  const nanoseconds = value.nanoseconds === undefined ? 0 : value.nanoseconds;
  if (!Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999999999) {
    throw invalid();
  }
  if (nanoseconds % 1000000 !== 0) {
    throw new InstantError('timestamp_precision');
  }
  return checkRange(value.seconds * 1000 + nanoseconds / 1000000);
}

// Returns integer milliseconds since the epoch. Throws InstantError.
function parseInstant(value) {
  if (typeof value === 'string') {
    return parseIsoInstant(value);
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return parseObjectInstant(value);
  }
  throw invalid();
}

// SQL literal for a DATETIME(3) column, in UTC: 'YYYY-MM-DD HH:mm:ss.SSS'.
function toSqlDatetime(ms) {
  checkRange(ms);
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

module.exports = { MIN_MS, MAX_MS, InstantError, parseInstant, toSqlDatetime };
