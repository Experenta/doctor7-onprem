'use strict';

const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const { ApiError } = require('../http/errors');
const { can, listScope } = require('../authz/policy');

const ID_MAX_LENGTH = 64;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');
const notFound = () => new ApiError(404, 'not_found', 'Resource not found.');
const invalid = (message) => new ApiError(400, 'invalid_request', message);

function isId(value) {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= ID_MAX_LENGTH;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
    offset: read('offset', 0, 0, 999999999),
  };
}

// Rejects a body that is not an object with exactly the allowed keys. Unknown
// keys fail, so a client cannot try to set fields such as centerId.
function readBody(req, allowed) {
  const body = req.body;
  if (!isPlainObject(body)) {
    throw invalid('The request body must be a JSON object.');
  }
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw invalid(`Unknown field: ${key.slice(0, 40)}.`);
    }
  }
  return body;
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

// Handlers assume the authz gate ran first, so req.auth is set and the role
// is allowed on the route. They still check each object with `can`.
function createCareRouter({ store, now = () => new Date(), newId = randomUUID }) {
  const router = Router();

  router.get('/appointments', async (req, res) => {
    const filter = listScope(req.auth.user, 'appointment');
    if (!filter) throw forbidden();
    const items = await store.listAppointments(filter, parsePage(req.query));
    res.json({ items: items.map(appointmentJson) });
  });

  router.get('/appointments/:id', async (req, res) => {
    if (!isId(req.params.id)) throw notFound();
    const item = await store.findAppointment(req.params.id);
    if (!item) throw notFound();
    if (!can(req.auth.user, 'read', appointmentResource(item))) throw forbidden();
    res.json(appointmentJson(item));
  });

  router.post('/appointments', async (req, res) => {
    const { user } = req.auth;
    const body = readBody(req, ['professionalId', 'clientId', 'startsAt', 'endsAt']);
    if (!isId(body.professionalId) || !isId(body.clientId)) {
      throw invalid('professionalId and clientId must be non-empty ids.');
    }
    const startsAt = parseTime(body.startsAt, 'startsAt');
    const endsAt = parseTime(body.endsAt, 'endsAt');
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
    if (!can(user, 'create', appointmentResource(candidate))) throw forbidden();

    // Both participants must exist in the caller's center with the right role.
    // A missing user and a user elsewhere give the same answer.
    const [professional, client] = await Promise.all([
      store.findUser(candidate.professionalId),
      store.findUser(candidate.clientId),
    ]);
    const inCenter = (found, role) =>
      found && found.role === role && found.centerId === user.centerId;
    if (!inCenter(professional, 'professional') || !inCenter(client, 'client')) {
      throw forbidden();
    }

    const created = await store.insertAppointment(candidate);
    res.status(201).json(appointmentJson(created));
  });

  router.post('/consultations', async (req, res) => {
    const body = readBody(req, ['appointmentId', 'body']);
    if (!isId(body.appointmentId)) {
      throw invalid('appointmentId must be a non-empty id.');
    }
    if (!isPlainObject(body.body)) {
      throw invalid('body must be a JSON object.');
    }
    const appointment = await store.findAppointment(body.appointmentId);
    if (!appointment) throw notFound();
    if (!can(req.auth.user, 'create', consultationResource(appointment))) throw forbidden();

    const created = await store.insertConsultation({
      id: newId(),
      appointmentId: appointment.id,
      body: body.body,
      createdAt: now(),
    });
    res.status(201).json(consultationJson(created));
  });

  router.get('/consultations/:id', async (req, res) => {
    if (!isId(req.params.id)) throw notFound();
    const item = await store.findConsultation(req.params.id);
    if (!item) throw notFound();
    const appointment = await store.findAppointment(item.appointmentId);
    if (!appointment) throw notFound();
    if (!can(req.auth.user, 'read', consultationResource(appointment))) throw forbidden();
    res.json(consultationJson(item));
  });

  return router;
}

module.exports = { createCareRouter };
