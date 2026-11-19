'use strict';

const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const { ApiError } = require('../http/errors');
const { can, listScope, rolesFor } = require('../authz/policy');
const { requestContext } = require('../audit/entry');
const { check, validateRequest } = require('../security/validate');
const { idSchema, noQuery, pageQuery, appointmentCreateBody, consultationCreateBody } = require('../security/schemas');

const DEFAULT_LIMIT = 50;

const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');
const notFound = () => new ApiError(404, 'not_found', 'Resource not found.');
const invalid = (message) => new ApiError(400, 'invalid_request', message);

// A path id that fails the id schema is handled as a missing record (audited
// 404), so a caller cannot tell the two apart.
function isId(value) {
  return check(idSchema, value, 'id').ok;
}

// The page of a list request, from the validated query.
function pageOf(query) {
  return { limit: query.limit ?? DEFAULT_LIMIT, offset: query.offset ?? 0 };
}

function appointmentResource(appointment) {
  return {
    type: 'appointment',
    centerId: appointment.centerId,
    professionalId: appointment.professionalId,
    clientId: appointment.clientId,
  };
}

// A consultation takes its center and participants from its appointment.
function consultationResource(appointment) {
  return { ...appointmentResource(appointment), type: 'consultation' };
}

function appointmentJson(item) {
  return {
    id: item.id,
    centerId: item.centerId,
    professionalId: item.professionalId,
    clientId: item.clientId,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  };
}

function consultationJson(item) {
  return {
    id: item.id,
    appointmentId: item.appointmentId,
    body: item.body,
    createdAt: item.createdAt.toISOString(),
  };
}

// Why the caller may not read a record. The reason goes to the audit log only.
// A record of another center, a record that is missing, and a record the caller
// does not take part in all get the same 404, so a caller cannot probe ids.
function readDenialReason(user, resource) {
  if (!user.centerId) return 'no_center';
  if (resource.centerId !== user.centerId) return 'other_center';
  if (!rolesFor(resource.type, 'read').includes(user.role)) return 'role_not_allowed';
  return 'not_participant';
}

// Why a participant of a new appointment is refused. Null when the participant is valid.
function participantReason(found, role, centerId) {
  if (!found) return 'participant_not_found';
  if (found.centerId !== centerId) return 'participant_other_center';
  if (found.role !== role) return 'participant_wrong_role';
  return null;
}

// Handlers assume the authz gate ran first, so req.auth is set and the role
// is allowed on the route. They still check each object with `can`. Every
// refusal and every audited success writes one audit entry before the response.
function createCareRouter({ store, now = () => new Date(), newId = randomUUID, audit }) {
  if (!audit) {
    throw new TypeError('createCareRouter requires an audit sink.');
  }
  const router = Router();

  // Records a refusal and returns the error to throw. The response does not say why.
  async function refuse(req, entry, error) {
    await audit.record({ ...requestContext(req), ...entry, outcome: 'denied' });
    return error;
  }

  function succeed(req, entry) {
    return audit.record({ ...requestContext(req), ...entry, outcome: 'success' });
  }

  router.get('/appointments', validateRequest({ query: pageQuery }), async (req, res) => {
    const { user } = req.auth;
    const filter = listScope(user, 'appointment');
    if (!filter) {
      throw await refuse(
        req,
        { action: 'appointment.read', targetType: 'appointment', reason: user.centerId ? 'role_not_allowed' : 'no_center' },
        forbidden()
      );
    }
    const items = await store.listAppointments(filter, pageOf(req.valid.query));
    res.json({ items: items.map(appointmentJson) });
  });

  router.get('/appointments/:id', validateRequest({ query: noQuery }), async (req, res) => {
    const { user } = req.auth;
    const denied = { action: 'appointment.read', targetType: 'appointment' };
    if (!isId(req.params.id)) throw await refuse(req, { ...denied, reason: 'invalid_id' }, notFound());
    const item = await store.findAppointment(req.params.id);
    if (!item) throw await refuse(req, { ...denied, targetId: req.params.id, reason: 'not_found' }, notFound());
    const resource = appointmentResource(item);
    if (!can(user, 'read', resource)) {
      throw await refuse(
        req,
        { ...denied, targetId: item.id, centerId: item.centerId, reason: readDenialReason(user, resource) },
        notFound()
      );
    }
    res.json(appointmentJson(item));
  });

  router.post('/appointments', validateRequest({ query: noQuery, body: appointmentCreateBody }), async (req, res) => {
    const { user } = req.auth;
    const body = req.valid.body;
    const { startsAt, endsAt } = body;
    if (endsAt <= startsAt) {
      throw invalid('endsAt must be after startsAt.');
    }

    // The center is always the caller's. It is never read from the body.
    const candidate = {
      id: newId(),
      centerId: user.centerId,
      professionalId: body.professionalId,
      clientId: body.clientId,
      startsAt,
      endsAt,
      status: 'scheduled',
      createdAt: now(),
    };
    const target = { action: 'appointment.create', targetType: 'appointment' };
    if (!can(user, 'create', appointmentResource(candidate))) {
      throw await refuse(req, { ...target, reason: user.centerId ? 'action_not_allowed' : 'no_center' }, forbidden());
    }

    // Both participants must exist in the caller's center with the right role.
    // The response is the same for every reason. The audit entry keeps the reason.
    const [professional, client] = await Promise.all([
      store.findUser(candidate.professionalId),
      store.findUser(candidate.clientId),
    ]);
    const professionalReason = participantReason(professional, 'professional', user.centerId);
    if (professionalReason) {
      throw await refuse(req, { ...target, reason: professionalReason }, forbidden());
    }
    const clientReason = participantReason(client, 'client', user.centerId);
    if (clientReason) {
      throw await refuse(req, { ...target, reason: clientReason }, forbidden());
    }

    const created = await store.insertAppointment(candidate);
    await succeed(req, { ...target, targetId: created.id, centerId: created.centerId });
    res.status(201).json(appointmentJson(created));
  });

  router.post('/consultations', validateRequest({ query: noQuery, body: consultationCreateBody }), async (req, res) => {
    const { user } = req.auth;
    const body = req.valid.body;
    // The audit target is the appointment the caller named, because no consultation exists yet.
    const target = { action: 'consultation.create', targetType: 'appointment' };
    const appointment = await store.findAppointment(body.appointmentId);
    if (!appointment) {
      throw await refuse(req, { ...target, targetId: body.appointmentId, reason: 'not_found' }, notFound());
    }
    const resource = consultationResource(appointment);
    // Without read access to the appointment, the answer is the same 404 as for a missing one.
    if (!can(user, 'read', resource)) {
      throw await refuse(
        req,
        { ...target, targetId: appointment.id, centerId: appointment.centerId, reason: readDenialReason(user, resource) },
        notFound()
      );
    }
    // The caller can read the appointment but may not create a consultation on it.
    if (!can(user, 'create', resource)) {
      throw await refuse(
        req,
        { ...target, targetId: appointment.id, centerId: appointment.centerId, reason: 'action_not_allowed' },
        forbidden()
      );
    }

    const created = await store.insertConsultation({
      id: newId(),
      appointmentId: appointment.id,
      body: body.body,
      createdAt: now(),
    });
    await succeed(req, {
      action: 'consultation.create',
      targetType: 'consultation',
      targetId: created.id,
      centerId: appointment.centerId,
    });
    res.status(201).json(consultationJson(created));
  });

  router.get('/consultations/:id', validateRequest({ query: noQuery }), async (req, res) => {
    const { user } = req.auth;
    const target = { action: 'consultation.read', targetType: 'consultation' };
    if (!isId(req.params.id)) throw await refuse(req, { ...target, reason: 'invalid_id' }, notFound());
    const item = await store.findConsultation(req.params.id);
    if (!item) throw await refuse(req, { ...target, targetId: req.params.id, reason: 'not_found' }, notFound());
    const appointment = await store.findAppointment(item.appointmentId);
    if (!appointment) throw await refuse(req, { ...target, targetId: item.id, reason: 'not_found' }, notFound());
    const resource = consultationResource(appointment);
    if (!can(user, 'read', resource)) {
      throw await refuse(
        req,
        { ...target, targetId: item.id, centerId: appointment.centerId, reason: readDenialReason(user, resource) },
        notFound()
      );
    }
    // A successful read of a consultation is audited. The body is never copied into the entry.
    await succeed(req, { ...target, targetId: item.id, centerId: appointment.centerId });
    res.json(consultationJson(item));
  });

  return router;
}

module.exports = { createCareRouter, readDenialReason };
