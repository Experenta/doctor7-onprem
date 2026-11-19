'use strict';

// Shape and validation of audit entries. Every entry is built by buildEntry,
// which copies only the fields listed here. No request body and no clinical
// text can reach the log, because the callers never pass one.

const OUTCOMES = Object.freeze(['success', 'denied', 'failure']);
const ID_MAX_LENGTH = 64;
const ACTION_MAX_LENGTH = 100;
const TARGET_TYPE_MAX_LENGTH = 50;
const REASON_MAX_LENGTH = 100;
const IP_MAX_LENGTH = 45;

function isText(value, max) {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= max;
}

function nullableId(value, name) {
  if (value === null || value === undefined) return null;
  if (!isText(value, ID_MAX_LENGTH)) {
    throw new TypeError(`${name} must be a non-empty id of at most ${ID_MAX_LENGTH} characters.`);
  }
  return value;
}

// Builds one entry. `id` and `at` (a Date) come from the caller, so tests control them.
// A denied or failed entry must carry a reason. A successful entry must not.
function buildEntry(input, { id, at }) {
  const { action, targetType, outcome } = input;
  const reason = input.reason ?? null;
  if (!OUTCOMES.includes(outcome)) {
    throw new TypeError('outcome must be success, denied, or failure.');
  }
  if (!isText(action, ACTION_MAX_LENGTH)) {
    throw new TypeError(`action must be a non-empty string of at most ${ACTION_MAX_LENGTH} characters.`);
  }
  if (!isText(targetType, TARGET_TYPE_MAX_LENGTH)) {
    throw new TypeError(`targetType must be a non-empty string of at most ${TARGET_TYPE_MAX_LENGTH} characters.`);
  }
  if (outcome === 'success' && reason !== null) {
    throw new TypeError('A successful entry has no reason.');
  }
  if (outcome !== 'success' && !isText(reason, REASON_MAX_LENGTH)) {
    throw new TypeError('A denied or failed entry needs a reason.');
  }
  return {
    id,
    occurredAt: at,
    actorId: nullableId(input.actorId, 'actorId'),
    centerId: nullableId(input.centerId, 'centerId'),
    action,
    targetType,
    targetId: nullableId(input.targetId, 'targetId'),
    outcome,
    reason: outcome === 'success' ? null : reason,
    // A client address that is too long or missing is stored as NULL. It never fails a request.
    ip: isText(input.ip, IP_MAX_LENGTH) ? input.ip : null,
  };
}

// The actor and network fields of an entry, read from a request. The caller adds
// the action, the target, the outcome, and the reason. Before the session check
// the request has no actor, so both actor fields are NULL.
function requestContext(req) {
  const user = req.auth ? req.auth.user : null;
  return {
    actorId: user ? user.id : null,
    centerId: user ? user.centerId : null,
    ip: req.ip,
  };
}

// A sink that drops every entry. Only modules built without an audit sink use it.
// The application always passes the real sink (see app.js).
const discardingAudit = Object.freeze({
  async record() {},
});

module.exports = { OUTCOMES, buildEntry, requestContext, discardingAudit };
