'use strict';

const { ApiError } = require('../http/errors');

// Small schema validator. A schema is { expect, check(value, ctx) }. `check`
// returns { ok: true, value } or { ok: false, message? }. Messages are built
// from schema names and fixed text only. They never hold the received value or
// a received key name.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const FAIL = Object.freeze({ ok: false });

const pass = (value) => ({ ok: true, value });

function schema(expect, check) {
  return Object.freeze({ expect, check });
}

function codePoints(text) {
  return Array.from(text).length;
}

// Text of min to max characters (code points) without control characters.
function string({ min = 1, max, pattern, expect } = {}) {
  if (!Number.isInteger(max) || max < 1) {
    throw new TypeError('string needs a positive integer max.');
  }
  return schema(expect ?? `must be text of ${min} to ${max} characters`, (value) => {
    // A code point is at most two UTF-16 units, so this rejects before counting.
    if (typeof value !== 'string' || value.length > max * 2) return FAIL;
    const length = codePoints(value);
    if (length < min || length > max || CONTROL_CHARS.test(value)) return FAIL;
    if (pattern && !pattern.test(value)) return FAIL;
    return pass(value);
  });
}

function id() {
  return string({ max: 64, expect: 'must be an id of 1 to 64 characters' });
}

// An ISO 8601 UTC timestamp. The result is a Date.
function timestamp() {
  return schema('must be an ISO 8601 UTC timestamp such as 2026-11-19T15:00:00.000Z', (value) => {
    if (typeof value !== 'string' || !ISO_UTC.test(value)) return FAIL;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? FAIL : pass(date);
  });
}

// A JSON number that is a whole number from min to max.
function integer({ min, max }) {
  return schema(`must be an integer from ${min} to ${max}`, (value) =>
    Number.isInteger(value) && value >= min && value <= max ? pass(value) : FAIL
  );
}

// Whole number written in a query string. The result is a Number.
function integerText({ min, max }) {
  return schema(`must be an integer from ${min} to ${max}`, (value) => {
    if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return FAIL;
    const number = Number(value);
    return number >= min && number <= max ? pass(number) : FAIL;
  });
}

function boolean() {
  return schema('must be true or false', (value) => (typeof value === 'boolean' ? pass(value) : FAIL));
}

function oneOf(values) {
  return schema(`must be one of: ${values.join(', ')}`, (value) =>
    typeof value === 'string' && values.includes(value) ? pass(value) : FAIL
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A free-form JSON object (the clinical body). Its depth and its number of
// values are limited. The value is returned unchanged.
function jsonObject({ maxDepth = 10, maxNodes = 5000 } = {}) {
  return schema('must be a JSON object of limited depth and size', (value) => {
    if (!isPlainObject(value)) return FAIL;
    let nodes = 0;
    const stack = [[value, 1]];
    while (stack.length > 0) {
      const [current, depth] = stack.pop();
      if (depth > maxDepth) return FAIL;
      for (const child of Object.values(current)) {
        nodes += 1;
        if (nodes > maxNodes) return FAIL;
        if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
      }
    }
    return pass(value);
  });
}

function optional(inner) {
  return Object.freeze({ optional: true, inner });
}

// An object with exactly the keys of `shape`. Each entry is a schema or
// optional(schema). A key that is not in `shape` fails. The result holds only
// the known keys. With `allowMissing`, an absent value (no body) counts as {}.
function object(shape, { allowMissing = false } = {}) {
  const names = Object.keys(shape);
  const known = new Set(names);
  return schema('must be an object', (value, ctx = {}) => {
    const label = ctx.label ?? 'request';
    const source = value === undefined && allowMissing ? {} : value;
    if (!isPlainObject(source)) {
      return { ok: false, message: `The ${label} must be an object.` };
    }
    for (const key of Object.keys(source)) {
      if (!known.has(key)) {
        return { ok: false, message: `The ${label} contains a field that is not allowed.` };
      }
    }
    const result = {};
    for (const name of names) {
      const entry = shape[name];
      const field = entry.optional ? entry.inner : entry;
      const present = Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined;
      if (!present) {
        if (entry.optional) continue;
        return { ok: false, message: `${name} is required.` };
      }
      const checked = field.check(source[name], ctx);
      if (!checked.ok) {
        return { ok: false, message: `${name} ${field.expect}.` };
      }
      result[name] = checked.value;
    }
    return pass(result);
  });
}

function check(target, value, label) {
  return target.check(value, { label });
}

// Returns the checked value or throws ApiError 400.
function parse(target, value, label) {
  const result = check(target, value, label);
  if (!result.ok) {
    throw new ApiError(400, 'invalid_request', result.message ?? `The ${label ?? 'request'} is not valid.`);
  }
  return result.value;
}

// Route middleware. Sets req.valid.query and req.valid.body for the schemas given.
function validateRequest({ query, body } = {}) {
  return function validateInput(req, res, next) {
    try {
      req.valid = {};
      if (query) req.valid.query = parse(query, req.query, 'query');
      if (body) req.valid.body = parse(body, req.body, 'body');
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  string,
  id,
  timestamp,
  integer,
  integerText,
  boolean,
  oneOf,
  jsonObject,
  optional,
  object,
  check,
  parse,
  validateRequest,
};
