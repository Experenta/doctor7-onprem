'use strict';

const { ApiError } = require('../http/errors');
const { ROLES, rolesFor } = require('./policy');

// Route rules. A request reaches a handler only if a rule here matches its
// method and path. Roles come from the policy matrix, so the two cannot drift.
// Object-level checks (own, center) still run in the handlers through `can`.
const ROUTE_RULES = Object.freeze([
  { method: 'GET', path: '/appointments', resource: 'appointment', action: 'read' },
  { method: 'GET', path: '/appointments/:id', resource: 'appointment', action: 'read' },
  { method: 'POST', path: '/appointments', resource: 'appointment', action: 'create' },
  { method: 'POST', path: '/consultations', resource: 'consultation', action: 'create' },
  { method: 'GET', path: '/consultations/:id', resource: 'consultation', action: 'read' },
]);

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH']);

// Turns rules into { method, segments, roles } and refuses a rule that would
// let every role through (an empty role list means "any role" to requireSession).
function compileRules(rules) {
  return rules.map((rule) => {
    const roles = rolesFor(rule.resource, rule.action);
    if (roles.length === 0 || roles.some((role) => !ROLES.includes(role))) {
      throw new TypeError(`Rule ${rule.method} ${rule.path} has no role in the matrix.`);
    }
    return { method: rule.method, segments: rule.path.split('/'), roles };
  });
}

function matches(rule, method, path) {
  if (rule.method !== method) return false;
  const parts = path.split('/');
  if (parts.length !== rule.segments.length) return false;
  return rule.segments.every((segment, index) =>
    segment.startsWith(':') ? parts[index].length > 0 : segment === parts[index]
  );
}

function isJson(req) {
  const header = req.headers['content-type'];
  if (typeof header !== 'string') return false;
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

// Deny-by-default gate. Mount it after the public routers (probes and /auth)
// and before every protected router. In order:
//   1. A state-changing request without a JSON content type gets 415. This is
//      an extra CSRF defense on top of SameSite=Strict, because a cross-site
//      form cannot send application/json.
//   2. A request that matches no rule gets 403, signed in or not.
//   3. requireSession answers 401 without a live session and 403 for a role
//      the rule does not allow.
function createAuthzGate({ requireSession, rules = ROUTE_RULES }) {
  const compiled = compileRules(rules);
  return function authzGate(req, res, next) {
    if (STATE_CHANGING.has(req.method) && !isJson(req)) {
      next(new ApiError(415, 'unsupported_media_type', 'Send the request body as application/json.'));
      return;
    }
    const rule = compiled.find((candidate) => matches(candidate, req.method, req.path));
    if (!rule) {
      next(new ApiError(403, 'forbidden', 'This account may not use this resource.'));
      return;
    }
    requireSession(...rule.roles)(req, res, next);
  };
}

module.exports = { ROUTE_RULES, createAuthzGate };
