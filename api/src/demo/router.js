'use strict';

const { Router } = require('express');
const { ApiError } = require('../http/errors');
const { can } = require('../authz/policy');
const { requestContext } = require('../audit/entry');
const v = require('../security/validate');
const { noQuery } = require('../security/schemas');
const { DemoControlError } = require('./control');

const PATH = '/demo/meet-outage';

// Route rules of the switch. app.js adds them to the gate only when DEMO_MODE=1, so with the
// switch off no rule matches and the gate answers like it does for every unknown path.
// The read is open to every role at the gate on purpose, like the meeting read: the handler
// answers 404 to a role that cannot read, so the route does not announce itself to them.
// The write uses the matrix, so only the role with an update cell (admin) passes the gate.
const DEMO_ROUTE_RULES = Object.freeze([
  { method: 'GET', path: PATH, resource: 'demo', action: 'read', anyRole: true },
  { method: 'POST', path: PATH, resource: 'demo', action: 'update' },
]);

const outageBody = v.object({ meetOutage: v.boolean() });

const notFound = () => new ApiError(404, 'not_found', 'Resource not found.');
const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');
const unavailable = () =>
  new ApiError(502, 'demo_simulator_unavailable', 'The Google Meet simulator did not answer. Check that its service runs.');

function resourceOf(user) {
  return { type: 'demo', centerId: user.centerId };
}

// Handlers assume the gate ran first (session, JSON content type, role for POST).
// `control` is the simulator client (control.js). `audit` is the audit sink.
function createDemoRouter({ control, audit }) {
  if (!control || !audit) {
    throw new TypeError('createDemoRouter requires a control client and an audit sink.');
  }
  const router = Router();

  async function record(req, entry) {
    await audit.record({ ...requestContext(req), targetType: 'demo', ...entry });
  }

  function noAccessReason(user) {
    return user.centerId ? 'role_not_allowed' : 'no_center';
  }

  router.get(PATH, v.validateRequest({ query: noQuery }), async (req, res) => {
    const { user } = req.auth;
    if (!can(user, 'read', resourceOf(user))) {
      await record(req, { action: 'demo.read', outcome: 'denied', reason: noAccessReason(user) });
      throw notFound();
    }
    let meetOutage;
    try {
      meetOutage = await control.getOutage();
    } catch (err) {
      if (!(err instanceof DemoControlError)) throw err;
      throw unavailable();
    }
    res.set('Cache-Control', 'no-store');
    res.json({ meetOutage });
  });

  // The body takes one boolean. The entry holds the action, the actor, and the outcome, and
  // nothing of the request.
  router.post(PATH, v.validateRequest({ query: noQuery, body: outageBody }), async (req, res) => {
    const { user } = req.auth;
    if (!can(user, 'update', resourceOf(user))) {
      await record(req, { action: 'demo.update', outcome: 'denied', reason: noAccessReason(user) });
      throw forbidden();
    }
    const wanted = req.valid.body.meetOutage;
    const action = wanted ? 'demo.meet_outage_on' : 'demo.meet_outage_off';
    let meetOutage;
    try {
      meetOutage = await control.setOutage(wanted);
    } catch (err) {
      if (!(err instanceof DemoControlError)) throw err;
      await record(req, { action, outcome: 'failure', reason: 'simulator_unreachable' });
      throw unavailable();
    }
    await record(req, { action, outcome: 'success' });
    res.set('Cache-Control', 'no-store');
    res.json({ meetOutage });
  });

  return router;
}

module.exports = { createDemoRouter, DEMO_ROUTE_RULES, PATH };
