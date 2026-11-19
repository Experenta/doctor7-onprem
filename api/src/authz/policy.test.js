'use strict';

// Tests of the authorization policy. The expected matrix below is written out
// by hand and does not import MATRIX, so a mistake in policy.js cannot hide
// itself. The same table must appear in docs/AUTHORIZATION.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { can, listScope, ROLES, RESOURCES, ACTIONS, MATRIX, rolesFor } = require('./policy');

// [role, resource, action, effect]. 4 roles x 4 resources x 3 actions = 48 cells.
const CELLS = [
  ['professional', 'appointment', 'read', 'own'],
  ['professional', 'appointment', 'create', 'own'],
  ['professional', 'appointment', 'update', 'own'],
  ['professional', 'consultation', 'read', 'own'],
  ['professional', 'consultation', 'create', 'own'],
  ['professional', 'consultation', 'update', 'own'],
  ['professional', 'audit', 'read', 'none'],
  ['professional', 'audit', 'create', 'none'],
  ['professional', 'audit', 'update', 'none'],

  ['client', 'appointment', 'read', 'own'],
  ['client', 'appointment', 'create', 'none'],
  ['client', 'appointment', 'update', 'none'],
  ['client', 'consultation', 'read', 'own'],
  ['client', 'consultation', 'create', 'none'],
  ['client', 'consultation', 'update', 'none'],
  ['client', 'audit', 'read', 'none'],
  ['client', 'audit', 'create', 'none'],
  ['client', 'audit', 'update', 'none'],

  ['admin', 'appointment', 'read', 'center'],
  ['admin', 'appointment', 'create', 'center'],
  ['admin', 'appointment', 'update', 'center'],
  ['admin', 'consultation', 'read', 'center'],
  ['admin', 'consultation', 'create', 'none'],
  ['admin', 'consultation', 'update', 'none'],
  ['admin', 'audit', 'read', 'none'],
  ['admin', 'audit', 'create', 'none'],
  ['admin', 'audit', 'update', 'none'],

  ['auditor', 'appointment', 'read', 'none'],
  ['auditor', 'appointment', 'create', 'none'],
  ['auditor', 'appointment', 'update', 'none'],
  ['auditor', 'consultation', 'read', 'none'],
  ['auditor', 'consultation', 'create', 'none'],
  ['auditor', 'consultation', 'update', 'none'],
  ['auditor', 'audit', 'read', 'center'],
  ['auditor', 'audit', 'create', 'none'],
  ['auditor', 'audit', 'update', 'none'],

  ['professional', 'meeting', 'read', 'own'],
  ['professional', 'meeting', 'create', 'own'],
  ['professional', 'meeting', 'update', 'none'],
  ['client', 'meeting', 'read', 'own'],
  ['client', 'meeting', 'create', 'none'],
  ['client', 'meeting', 'update', 'none'],
  ['admin', 'meeting', 'read', 'none'],
  ['admin', 'meeting', 'create', 'none'],
  ['admin', 'meeting', 'update', 'none'],
  ['auditor', 'meeting', 'read', 'none'],
  ['auditor', 'meeting', 'create', 'none'],
  ['auditor', 'meeting', 'update', 'none'],
];

const EXPECTED = new Map(CELLS.map(([role, resource, action, effect]) => [`${role}/${resource}/${action}`, effect]));

const USER_ID = 'u-self';
const OTHER_ID = 'u-other';

function userOf(role, centerId = 'c1') {
  return { id: USER_ID, email: 'self@example.test', displayName: 'Self', role, centerId };
}

// Resource variants around one user in center c1.
function resources(type) {
  const base = { type, centerId: 'c1', professionalId: OTHER_ID, clientId: OTHER_ID };
  return {
    asProfessional: { ...base, professionalId: USER_ID },
    asClient: { ...base, clientId: USER_ID },
    asBoth: { ...base, professionalId: USER_ID, clientId: USER_ID },
    strangers: base,
    otherCenterAsProfessional: { ...base, centerId: 'c2', professionalId: USER_ID },
    otherCenterAsClient: { ...base, centerId: 'c2', clientId: USER_ID },
    otherCenterStrangers: { ...base, centerId: 'c2' },
  };
}

test('the expected table covers every role, resource, and action once', () => {
  assert.equal(CELLS.length, ROLES.length * RESOURCES.length * ACTIONS.length);
  assert.equal(EXPECTED.size, CELLS.length);
});

for (const [role, resource, action, effect] of CELLS) {
  const label = `${role} / ${resource} / ${action}`;

  if (effect === 'none') {
    test(`denied cell: ${label}`, () => {
      for (const [name, res] of Object.entries(resources(resource))) {
        assert.equal(can(userOf(role), action, res), false, `${label} allowed for ${name}`);
      }
    });
  } else if (effect === 'own') {
    test(`allowed cell (own): ${label}`, () => {
      const r = resources(resource);
      const mine = role === 'professional' ? r.asProfessional : r.asClient;
      assert.equal(can(userOf(role), action, mine), true, `${label} refused for a participant`);
    });
    test(`denied cell (own, not a participant or other center): ${label}`, () => {
      const r = resources(resource);
      const wrongRoleSlot = role === 'professional' ? r.asClient : r.asProfessional;
      assert.equal(can(userOf(role), action, r.strangers), false, `${label} allowed for a stranger`);
      assert.equal(can(userOf(role), action, wrongRoleSlot), false, `${label} allowed in the other participant slot`);
      assert.equal(can(userOf(role), action, r.otherCenterAsProfessional), false, `${label} crossed centers`);
      assert.equal(can(userOf(role), action, r.otherCenterAsClient), false, `${label} crossed centers`);
      assert.equal(can(userOf(role), action, r.otherCenterStrangers), false, `${label} crossed centers`);
    });
  } else {
    test(`allowed cell (center): ${label}`, () => {
      const r = resources(resource);
      assert.equal(can(userOf(role), action, r.strangers), true);
      assert.equal(can(userOf(role), action, r.asBoth), true);
    });
    test(`denied cell (center, other center): ${label}`, () => {
      const r = resources(resource);
      assert.equal(can(userOf(role), action, r.otherCenterStrangers), false);
      assert.equal(can(userOf(role), action, r.otherCenterAsProfessional), false);
    });
  }

  test(`denied cell (user without a center): ${label}`, () => {
    const r = resources(resource);
    for (const res of Object.values(r)) {
      assert.equal(can(userOf(role, null), action, { ...res, centerId: null }), false);
      assert.equal(can(userOf(role, null), action, res), false);
    }
  });
}

test('MATRIX in policy.js equals the expected table', () => {
  for (const role of ROLES) {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        const actual = Object.hasOwn(MATRIX[role], resource) && Object.hasOwn(MATRIX[role][resource], action)
          ? MATRIX[role][resource][action]
          : 'none';
        assert.equal(actual, EXPECTED.get(`${role}/${resource}/${action}`), `${role}/${resource}/${action}`);
      }
    }
  }
});

test('rolesFor lists exactly the roles with an allowed cell', () => {
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      const expected = ROLES.filter((role) => EXPECTED.get(`${role}/${resource}/${action}`) !== 'none');
      assert.deepEqual(rolesFor(resource, action), expected);
    }
  }
});

test('docs/AUTHORIZATION.md lists every cell with the same effect', () => {
  const file = path.join(__dirname, '..', '..', '..', 'docs', 'AUTHORIZATION.md');
  const text = fs.readFileSync(file, 'utf8');
  const rows = [...text.matchAll(/^\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(own|center|none)\s*\|\s*$/gm)];
  const documented = new Map(rows.map((m) => [`${m[1]}/${m[2]}/${m[3]}`, m[4]]));
  assert.equal(rows.length, CELLS.length, 'the matrix table must have one row per cell');
  assert.deepEqual([...documented].sort(), [...EXPECTED].sort());
});

test('property: can() equals the matrix written in docs/AUTHORIZATION.md for any role, participation, and center', () => {
  const file = path.join(__dirname, '..', '..', '..', 'docs', 'AUTHORIZATION.md');
  const rows = [...fs.readFileSync(file, 'utf8').matchAll(/^\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(own|center|none)\s*\|\s*$/gm)];
  const documented = new Map(rows.map((m) => [`${m[1]}/${m[2]}/${m[3]}`, m[4]]));
  assert.ok(documented.size >= 48, 'the document lists the whole matrix');

  const participation = fc.constantFrom('professional', 'client', 'both', 'none');
  fc.assert(
    fc.property(
      fc.constantFrom(...ROLES),
      fc.constantFrom(...RESOURCES),
      fc.constantFrom(...ACTIONS),
      participation,
      fc.constantFrom('c1', 'c2'),
      fc.constantFrom('c1', 'c2'),
      (role, type, action, takesPart, userCenter, resourceCenter) => {
        const user = { id: 'u-me', email: 'me@example.test', displayName: 'Me', role, centerId: userCenter };
        const resource = {
          type,
          centerId: resourceCenter,
          professionalId: takesPart === 'professional' || takesPart === 'both' ? 'u-me' : 'u-other',
          clientId: takesPart === 'client' || takesPart === 'both' ? 'u-me' : 'u-other',
        };
        // The document says: nobody crosses centers. "own" means the professional of the
        // appointment (role professional) or its client (role client). "center" needs the
        // same center only. "none" is always denied.
        const effect = documented.get(`${role}/${type}/${action}`);
        let expected = false;
        if (effect !== 'none' && userCenter === resourceCenter) {
          expected =
            effect === 'center' ||
            (role === 'professional' && resource.professionalId === 'u-me') ||
            (role === 'client' && resource.clientId === 'u-me');
        }
        assert.equal(can(user, action, resource), expected, `${role}/${type}/${action} ${takesPart} ${userCenter}/${resourceCenter}`);
      }
    ),
    { numRuns: 3000 }
  );
});

test('the meeting resource: the professional reads and creates their own, the client reads their own, nobody else has a cell', () => {
  const meeting = { type: 'meeting', centerId: 'c1', professionalId: 'u-pro', clientId: 'u-cli' };
  const as = (role, id, centerId = 'c1') => ({ id, role, centerId });
  assert.equal(can(as('professional', 'u-pro'), 'read', meeting), true);
  assert.equal(can(as('professional', 'u-pro'), 'create', meeting), true);
  assert.equal(can(as('professional', 'u-pro'), 'update', meeting), false);
  assert.equal(can(as('client', 'u-cli'), 'read', meeting), true);
  assert.equal(can(as('client', 'u-cli'), 'create', meeting), false);
  assert.equal(can(as('professional', 'u-other'), 'read', meeting), false);
  assert.equal(can(as('client', 'u-other'), 'read', meeting), false);
  assert.equal(can(as('admin', 'u-adm'), 'read', meeting), false);
  assert.equal(can(as('auditor', 'u-aud'), 'read', meeting), false);
  assert.equal(can(as('professional', 'u-pro', 'c2'), 'read', meeting), false);
  assert.deepEqual(rolesFor('meeting', 'read'), ['professional', 'client']);
  assert.deepEqual(rolesFor('meeting', 'create'), ['professional']);
});

test('the policy fails closed for malformed users and resources', () => {
  const resource = { type: 'appointment', centerId: 'c1', professionalId: USER_ID, clientId: USER_ID };
  const good = userOf('professional');
  assert.equal(can(good, 'read', resource), true);
  for (const user of [null, undefined, 'professional', 42, [], {}, { ...good, id: '' }, { ...good, id: 7 },
    { ...good, role: 'root' }, { ...good, role: undefined }, { ...good, centerId: undefined }, { ...good, centerId: '' }]) {
    assert.equal(can(user, 'read', resource), false);
  }
  for (const res of [null, undefined, 'appointment', 7, [], {}, { ...resource, centerId: '' },
    { ...resource, centerId: undefined }, { ...resource, type: 'unknown' }]) {
    assert.equal(can(good, 'read', res), false);
  }
  assert.equal(can(good, 'delete', resource), false);
  assert.equal(can(good, undefined, resource), false);
});

// ---- Properties ----

const NAMES = ['', 'c1', 'c2', 'c3', 'u-1', 'u-2', 'u-3', '__proto__', 'constructor', 'toString', 'hasOwnProperty'];
const idArb = fc.oneof(fc.constantFrom(...NAMES), fc.string({ maxLength: 12 }));
const centerArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constantFrom('c1', 'c2', 'c3', ''),
  fc.string({ maxLength: 6 })
);
const roleArb = fc.oneof(fc.constantFrom(...ROLES), fc.constantFrom(...NAMES), fc.string({ maxLength: 12 }));
const actionArb = fc.oneof(fc.constantFrom(...ACTIONS), fc.constantFrom(...NAMES), fc.string({ maxLength: 12 }));
const typeArb = fc.oneof(fc.constantFrom(...RESOURCES), fc.constantFrom(...NAMES), fc.string({ maxLength: 12 }));
const userArb = fc.record({ id: idArb, email: fc.constant('x@example.test'), displayName: fc.constant('X'), role: roleArb, centerId: centerArb });
const resourceArb = fc.record({ type: typeArb, centerId: centerArb, professionalId: idArb, clientId: idArb });

// An independent statement of the rule, built only from EXPECTED.
function oracle(user, action, resource) {
  const id = (value) => typeof value === 'string' && value.length > 0;
  if (!user || !id(user.id) || !id(user.centerId) || !resource || !id(resource.centerId)) return false;
  const effect = EXPECTED.get(`${user.role}/${resource.type}/${action}`) ?? 'none';
  if (effect === 'none' || user.centerId !== resource.centerId) return false;
  if (effect === 'center') return true;
  return user.role === 'professional' ? resource.professionalId === user.id : resource.clientId === user.id;
}

test('property: can() equals the documented matrix for any role, action, resource, and center', () => {
  fc.assert(
    fc.property(userArb, actionArb, resourceArb, (user, action, resource) => {
      assert.equal(can(user, action, resource), oracle(user, action, resource));
    }),
    { numRuns: 2000 }
  );
});

test('property: an allowed request always has the same non-empty center on both sides', () => {
  fc.assert(
    fc.property(userArb, actionArb, resourceArb, (user, action, resource) => {
      if (can(user, action, resource)) {
        assert.equal(typeof user.centerId, 'string');
        assert.ok(user.centerId.length > 0);
        assert.equal(user.centerId, resource.centerId);
      }
    }),
    { numRuns: 2000 }
  );
});

test('property: a user never gets access to a resource of another center', () => {
  fc.assert(
    fc.property(userArb, actionArb, resourceArb, (user, action, resource) => {
      fc.pre(user.centerId !== resource.centerId);
      assert.equal(can(user, action, resource), false);
      // Making the user a participant does not help across centers.
      const asParticipant = { ...resource, professionalId: user.id, clientId: user.id };
      assert.equal(can(user, action, asParticipant), false);
    }),
    { numRuns: 1000 }
  );
});

test('property: an unknown role, action, or resource type is always denied', () => {
  const unknownRole = fc.string({ maxLength: 12 }).filter((s) => !ROLES.includes(s));
  const unknownAction = fc.string({ maxLength: 12 }).filter((s) => !ACTIONS.includes(s));
  const unknownType = fc.string({ maxLength: 12 }).filter((s) => !RESOURCES.includes(s));
  fc.assert(
    fc.property(userArb, actionArb, resourceArb, unknownRole, unknownAction, unknownType, (user, action, resource, r, a, t) => {
      assert.equal(can({ ...user, role: r }, action, resource), false);
      assert.equal(can(user, a, resource), false);
      assert.equal(can(user, action, { ...resource, type: t }), false);
    }),
    { numRuns: 1000 }
  );
});

test('property: listScope returns exactly the rows can() lets the user read', () => {
  const rowArb = fc.record({
    type: fc.constant('appointment'),
    centerId: fc.constantFrom('c1', 'c2', 'c3'),
    professionalId: fc.constantFrom('u-1', 'u-2', 'u-3'),
    clientId: fc.constantFrom('u-1', 'u-2', 'u-3'),
  });
  const listUserArb = fc.record({
    id: fc.constantFrom('u-1', 'u-2', 'u-3'),
    role: fc.constantFrom(...ROLES),
    centerId: fc.constantFrom('c1', 'c2', 'c3', null),
  });
  fc.assert(
    fc.property(listUserArb, rowArb, (user, row) => {
      const filter = listScope(user, 'appointment');
      const listed =
        filter !== null &&
        row.centerId === filter.centerId &&
        (filter.professionalId === undefined || row.professionalId === filter.professionalId) &&
        (filter.clientId === undefined || row.clientId === filter.clientId);
      assert.equal(listed, can(user, 'read', row));
    }),
    { numRuns: 1000 }
  );
});

test('listScope denies a resource type the user may not read', () => {
  assert.equal(listScope(userOf('auditor'), 'appointment'), null);
  assert.equal(listScope(userOf('client'), 'audit'), null);
  assert.equal(listScope(userOf('admin', null), 'appointment'), null);
  assert.equal(listScope(null, 'appointment'), null);
  assert.deepEqual(listScope(userOf('admin'), 'appointment'), { centerId: 'c1' });
  assert.deepEqual(listScope(userOf('professional'), 'appointment'), { centerId: 'c1', professionalId: USER_ID });
  assert.deepEqual(listScope(userOf('client'), 'appointment'), { centerId: 'c1', clientId: USER_ID });
});
