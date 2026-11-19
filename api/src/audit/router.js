'use strict';

const { Router } = require('express');
const { ApiError } = require('../http/errors');
const { listScope } = require('../authz/policy');
const { requestContext } = require('./entry');
const { validateRequest } = require('../security/validate');
const { auditQuery } = require('../security/schemas');

// GET /audit. The gate admits only the auditor role. The query schema checks the
// filters and the page. This handler limits the rows to the auditor's center.
const DEFAULT_LIMIT = 50;

const invalid = (message) => new ApiError(400, 'invalid_request', message);
const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');

// Splits the validated query into the filter and the page.
function splitQuery(query) {
  const { limit, offset, ...filter } = query;
  if (filter.from && filter.to && filter.from > filter.to) {
    throw invalid('from must not be after to.');
  }
  return { filter, page: { limit: limit ?? DEFAULT_LIMIT, offset: offset ?? 0 } };
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

  router.get('/audit', validateRequest({ query: auditQuery }), async (req, res) => {
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
    const { filter, page } = splitQuery(req.valid.query);
    const entries = await store.list({ ...filter, centerId: scope.centerId }, page);
    res.json({ items: entries.map(entryJson) });
  });

  return router;
}

module.exports = { createAuditRouter };
