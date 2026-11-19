'use strict';

// Authorization policy. Everything is denied unless a rule below allows it.
// The policy is pure: it takes the signed-in user and a description of the
// resource, and answers true or false. It does no I/O.
//
// Matrix cell values:
//   'own'    the user must take part in the resource (professional or client of
//            the appointment) and be in the same center.
//   'center' the user must be in the same center as the resource.
// A cell that is missing means the action is denied.

const ROLES = Object.freeze(['professional', 'client', 'admin', 'auditor']);
const RESOURCES = Object.freeze(['appointment', 'consultation', 'audit', 'meeting']);
const ACTIONS = Object.freeze(['read', 'create', 'update']);

const MATRIX = deepFreeze({
  professional: {
    appointment: { read: 'own', create: 'own', update: 'own' },
    consultation: { read: 'own', create: 'own', update: 'own' },
    meeting: { read: 'own', create: 'own' },
  },
  client: {
    appointment: { read: 'own' },
    consultation: { read: 'own' },
    meeting: { read: 'own' },
  },
  admin: {
    appointment: { read: 'center', create: 'center', update: 'center' },
    consultation: { read: 'center' },
  },
  auditor: {
    audit: { read: 'center' },
  },
});

function deepFreeze(value) {
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === 'object') {
      deepFreeze(value[key]);
    }
  }
  return Object.freeze(value);
}

function isId(value) {
  return typeof value === 'string' && value.length > 0;
}

// Reads one matrix cell. Own-property lookups keep names such as "__proto__"
// or "constructor" from resolving to something inherited.
function cell(role, resourceType, action) {
  if (!Object.hasOwn(MATRIX, role)) return null;
  const byResource = MATRIX[role];
  if (!Object.hasOwn(byResource, resourceType)) return null;
  const byAction = byResource[resourceType];
  if (!Object.hasOwn(byAction, action)) return null;
  return byAction[action];
}

// The user must have a role, an id, and a center. A user without a center is
// denied everything, because every rule is scoped to a center.
function isUsable(user) {
  return (
    user !== null &&
    typeof user === 'object' &&
    ROLES.includes(user.role) &&
    isId(user.id) &&
    isId(user.centerId)
  );
}

// resource: { type, centerId, professionalId?, clientId? }
function can(user, action, resource) {
  if (!isUsable(user) || resource === null || typeof resource !== 'object') {
    return false;
  }
  const scope = cell(user.role, resource.type, action);
  if (scope === null) {
    return false;
  }
  // Nobody crosses centers, whatever the scope.
  if (!isId(resource.centerId) || resource.centerId !== user.centerId) {
    return false;
  }
  if (scope === 'center') {
    return true;
  }
  if (scope === 'own') {
    if (user.role === 'professional') return resource.professionalId === user.id;
    if (user.role === 'client') return resource.clientId === user.id;
  }
  return false;
}

// The filter a list query must apply so it returns only rows the user may read.
// Returns null when the user may not list this resource at all.
function listScope(user, resourceType) {
  if (!isUsable(user)) {
    return null;
  }
  const scope = cell(user.role, resourceType, 'read');
  if (scope === null) {
    return null;
  }
  const filter = { centerId: user.centerId };
  if (scope === 'own') {
    if (user.role === 'professional') filter.professionalId = user.id;
    else if (user.role === 'client') filter.clientId = user.id;
    else return null;
  }
  return filter;
}

// Roles that hold at least one allowed cell for the action on the resource.
function rolesFor(resourceType, action) {
  return ROLES.filter((role) => cell(role, resourceType, action) !== null);
}

module.exports = { ROLES, RESOURCES, ACTIONS, MATRIX, can, listScope, rolesFor };
