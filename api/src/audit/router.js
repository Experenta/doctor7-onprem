'use strict';

const { Router } = require('express');
const { ApiError } = require('../http/errors');
const { listScope } = require('../authz/policy');
const { OUTCOMES, requestContext } = require('./entry');

// GET /audit. The gate admits only the auditor role. This handler limits the
// rows to the auditor's center and checks the filters and the page.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 999999999;
const ID_MAX_LENGTH = 64;
const ACTION_PATTERN = /^[a-z][a-z0-9_.]{0,99}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const invalid = (message) => new ApiError(400, 'invalid_request', message);
const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');

function parseTime(value, name) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) {
    throw invalid(`${name} must be an ISO 8601 UTC timestamp such as 2026-11-19T15:00:00.000Z.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw invalid(`${name} must be an ISO 8601 UTC timestamp such as 2026-11-19T15:00:00.000Z.`);
  }
  return date;
}

function parseFilter(query) {
  const filter = {};
  if (query.from !== undefined) filter.from = parseTime(query.from, 'from');
  if (query.to !== undefined) filter.to = parseTime(query.to, 'to');
  if (filter.from && filter.to && filter.from > filter.to) {
    throw invalid('from must not be after to.');
  }
  if (query.actorId !== undefined) {
    if (typeof query.actorId !== 'string' || query.actorId.length === 0 || Array.from(query.actorId).length > ID_MAX_LENGTH) {
      throw invalid('actorId must be a non-empty id of at most 64 characters.');
    }
    filter.actorId = query.actorId;
  }
  if (query.action !== undefined) {
    if (typeof query.action !== 'string' || !ACTION_PATTERN.test(query.action)) {
      throw invalid('action must be a lowercase dotted name such as auth.login.');
    }
    filter.action = query.action;
  }
  if (query.outcome !== undefined) {
    if (!OUTCOMES.includes(query.outcome)) {
      throw invalid('outcome must be success, denied, or failure.');
    }
    filter.outcome = query.outcome;
  }
  return filter;
}

function parsePage(query) {
  const read = (name, fallback, min, max) => {
    const raw = query[name];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      throw invalid(`${name} must be an integer from ${min} to ${max}.`);
    }
    return Number(raw);
  };
  return {
    limit: read('limit', DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: read('offset', 0, 0, MAX_OFFSET),
  };
}

function entryJson(entry) {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    actorId: entry.actorId,
    centerId: entry.centerId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    outcome: entry.outcome,
    reason: entry.reason,
    ip: entry.ip,
  };
}

function createAuditRouter({ record, store }) {
  const router = Router();

  router.get('/audit', async (req, res) => {
    const { user } = req.auth;
    const scope = listScope(user, 'audit');
    if (!scope) {
      // Only an auditor without a center reaches this point. The gate has already
      // refused every other role.
      await record({
        ...requestContext(req),
        action: 'audit.read',
        targetType: 'audit',
        outcome: 'denied',
        reason: user.centerId ? 'role_not_allowed' : 'no_center',
      });
      throw forbidden();
    }
    const filter = { ...parseFilter(req.query), centerId: scope.centerId };
    const entries = await store.list(filter, parsePage(req.query));
    res.json({ items: entries.map(entryJson) });
  });

  return router;
}

module.exports = { createAuditRouter };
