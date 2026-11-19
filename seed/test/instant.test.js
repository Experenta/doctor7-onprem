'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { MIN_MS, MAX_MS, InstantError, parseInstant, toSqlDatetime } = require('../lib/instant');

const DAY_MS = 24 * 60 * 60 * 1000;
const RUNS = { numRuns: 300 };

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

// Renders a UTC instant as wall-clock text with the given offset in minutes.
function renderWithOffset(utcMs, offsetMinutes) {
  const wallClock = new Date(utcMs + offsetMinutes * 60000).toISOString();
  const body = wallClock.slice(0, -1);
  if (offsetMinutes === 0) {
    return `${body}Z`;
  }
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `${body}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function expectInstantError(value, code) {
  assert.throws(
    () => parseInstant(value),
    (error) => error instanceof InstantError && error.code === code
  );
}

describe('instant parsing: properties', () => {
  test('text with any explicit offset stores the same UTC instant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_MS + DAY_MS, max: MAX_MS - DAY_MS }),
        fc.integer({ min: -(23 * 60 + 59), max: 23 * 60 + 59 }),
        (utcMs, offsetMinutes) => {
          assert.equal(parseInstant(renderWithOffset(utcMs, offsetMinutes)), utcMs);
        }
      ),
      RUNS
    );
  });

  test('a UTC instant read back from its DATETIME literal is the same instant', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_MS, max: MAX_MS }), (utcMs) => {
        const literal = toSqlDatetime(utcMs);
        assert.match(literal, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
        assert.equal(parseInstant(`${literal.replace(' ', 'T')}Z`), utcMs);
      }),
      RUNS
    );
  });

  test('the object form {seconds, nanoseconds} equals seconds plus nanoseconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3e10, max: 2.5e11 }),
        fc.integer({ min: 0, max: 999 }),
        (seconds, millis) => {
          assert.equal(parseInstant({ seconds, nanoseconds: millis * 1000000 }), seconds * 1000 + millis);
          assert.equal(parseInstant({ seconds }), seconds * 1000);
        }
      ),
      RUNS
    );
  });

  test('fraction digits past the third: non-zero rejects, zeros are accepted', () => {
    // Three digits for milliseconds plus 1 to 6 more: 4 to 9 digits in total.
    const digitsArb = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), digitsArb, (millis, tail) => {
        const fraction = `${pad(millis, 3)}${tail.join('')}`;
        const text = `2026-11-19T05:10:51.${fraction}Z`;
        if (tail.some((digit) => digit !== 0)) {
          expectInstantError(text, 'timestamp_precision');
        } else {
          assert.equal(parseInstant(text), Date.UTC(2026, 10, 19, 5, 10, 51, millis));
        }
      }),
      RUNS
    );
  });
});

describe('instant parsing: examples', () => {
  test('keeps milliseconds and converts the offset to UTC', () => {
    assert.equal(
      parseInstant('2026-11-18T23:10:51.908-05:00'),
      Date.UTC(2026, 10, 19, 4, 10, 51, 908)
    );
    assert.equal(toSqlDatetime(parseInstant('2026-11-18T23:10:51.908-05:00')), '2026-11-19 04:10:51.908');
  });

  test('accepts a leap day and the range limits', () => {
    assert.equal(parseInstant('2028-02-29T00:00:00Z'), Date.UTC(2028, 1, 29));
    assert.equal(parseInstant('1000-01-01T00:00:00Z'), MIN_MS);
    assert.equal(parseInstant('9999-12-31T23:59:59.999Z'), MAX_MS);
  });

  test('rejects text without an offset', () => {
    expectInstantError('2026-11-19T05:10:51.908', 'invalid_timestamp');
    expectInstantError('2026-11-19 05:10:51Z', 'invalid_timestamp');
  });

  test('rejects impossible dates and times', () => {
    expectInstantError('2026-02-30T00:00:00Z', 'invalid_timestamp');
    expectInstantError('2026-13-01T00:00:00Z', 'invalid_timestamp');
    expectInstantError('2026-11-19T24:00:00Z', 'invalid_timestamp');
    expectInstantError('2026-11-19T05:10:60Z', 'invalid_timestamp');
    expectInstantError('2026-11-19T05:10:51+24:00', 'invalid_timestamp');
  });

  test('rejects lower-case separators and missing seconds', () => {
    expectInstantError('2026-11-19t05:10:51Z', 'invalid_timestamp');
    expectInstantError('2026-11-19T05:10Z', 'invalid_timestamp');
  });

  test('rejects instants outside years 1000 to 9999 in UTC', () => {
    expectInstantError('0999-12-31T23:59:59.999Z', 'invalid_timestamp');
    expectInstantError('9999-12-31T23:59:59.999-01:00', 'invalid_timestamp');
    expectInstantError({ seconds: 253402300800 }, 'invalid_timestamp');
  });

  test('rejects values that are neither text nor the object form', () => {
    expectInstantError(1763528451908, 'invalid_timestamp');
    expectInstantError(null, 'invalid_timestamp');
    expectInstantError(undefined, 'invalid_timestamp');
    expectInstantError(['2026-11-19T05:10:51Z'], 'invalid_timestamp');
    expectInstantError({ seconds: 1.5 }, 'invalid_timestamp');
    expectInstantError({ seconds: 1, nanoseconds: -1 }, 'invalid_timestamp');
    expectInstantError({ seconds: 1, nanoseconds: 1e9 }, 'invalid_timestamp');
    expectInstantError({ seconds: 1, extra: true }, 'invalid_timestamp');
  });

  test('rejects nanoseconds finer than a millisecond', () => {
    expectInstantError({ seconds: 1, nanoseconds: 1500 }, 'timestamp_precision');
  });

  test('toSqlDatetime rejects values outside the supported range', () => {
    assert.throws(() => toSqlDatetime(MAX_MS + 1), InstantError);
    assert.throws(() => toSqlDatetime(1.5), InstantError);
  });
});
