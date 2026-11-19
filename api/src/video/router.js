'use strict';

const { Router } = require('express');
const { ApiError } = require('../http/errors');
const { can } = require('../authz/policy');
const { requestContext } = require('../audit/entry');
const { readDenialReason } = require('../care/router');
const { check, validateRequest } = require('../security/validate');
const { idSchema, noQuery, emptyBody } = require('../security/schemas');
const { DuplicateMeetingError } = require('./store');

const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');
const notFound = () => new ApiError(404, 'not_found', 'Resource not found.');
const noMeeting = () => new ApiError(404, 'no_meeting', 'The meeting has not been started yet.');
const appointmentClosed = () =>
  new ApiError(409, 'appointment_closed', 'The appointment is not scheduled, so no meeting can be started.');

function isId(value) {
  return check(idSchema, value, 'id').ok;
}

function appointmentResource(appointment) {
  return {
    type: 'appointment',
    centerId: appointment.centerId,
    professionalId: appointment.professionalId,
    clientId: appointment.clientId,
  };
}

// A meeting takes its center and participants from its appointment.
function meetingResource(appointment) {
  return { ...appointmentResource(appointment), type: 'meeting' };
}

// Handlers assume the authz gate ran first (session, JSON content type, role for POST).
// Every refusal and every outcome writes an audit entry before the response.
// `store` is the care store (appointments), `meetings` the meeting store.
// `service` is null when VIDEO_PROVIDER is not set.
function createVideoRouter({ store, meetings, audit, service, logger = console, now = () => new Date() }) {
  if (!audit) {
    throw new TypeError('createVideoRouter requires an audit sink.');
  }
  if (!meetings) {
    throw new TypeError('createVideoRouter requires a meeting store.');
  }
  const router = Router();

  async function record(req, entry) {
    await audit.record({ ...requestContext(req), targetType: 'appointment', ...entry });
  }

  async function refuse(req, action, entry, error) {
    await record(req, { ...entry, action, outcome: 'denied' });
    return error;
  }

  // Answers with a stored meeting. The audit entry is written first, because the
  // response carries the address.
  async function respondWithMeeting(req, res, known, meeting, status) {
    await record(req, { ...known, action: 'meeting.read', outcome: 'success' });
    res.set('Cache-Control', 'no-store');
    res.status(status).json({ provider: meeting.provider, url: meeting.url });
  }

  // The provider comes from the configuration only. A client cannot choose it,
  // so the body takes no fields. The request is idempotent: an appointment has at
  // most one meeting, and a repeated request returns it.
  router.post('/appointments/:id/meeting', validateRequest({ query: noQuery, body: emptyBody }), async (req, res) => {
    const { user } = req.auth;
    const create = 'meeting.create';

    if (!isId(req.params.id)) {
      throw await refuse(req, create, { reason: 'invalid_id' }, notFound());
    }
    const appointment = await store.findAppointment(req.params.id);
    if (!appointment) {
      throw await refuse(req, create, { targetId: req.params.id, reason: 'not_found' }, notFound());
    }
    const known = { targetId: appointment.id, centerId: appointment.centerId };

    // Without read access the answer is the same 404 as for a missing appointment.
    if (!can(user, 'read', appointmentResource(appointment))) {
      throw await refuse(req, create, { ...known, reason: readDenialReason(user, appointmentResource(appointment)) }, notFound());
    }
    // The caller can read the appointment. Only its professional may create the
    // meeting. An administrator of the center can read it but is not a participant.
    if (!can(user, 'create', meetingResource(appointment))) {
      throw await refuse(req, create, { ...known, reason: 'action_not_allowed' }, forbidden());
    }
    if (appointment.status !== 'scheduled') {
      throw await refuse(req, create, { ...known, reason: 'appointment_closed' }, appointmentClosed());
    }

    const existing = await meetings.findMeeting(appointment.id);
    if (existing) {
      await respondWithMeeting(req, res, known, existing, 200);
      return;
    }

    if (!service) {
      await record(req, { ...known, action: create, outcome: 'failure', reason: 'not_configured' });
      throw new ApiError(503, 'video_not_configured', 'Video meetings are not configured on this server.');
    }

    const created = await service.create(appointment, {
      onFailover: async (kind) => {
        await record(req, {
          ...known,
          action: 'meeting.failover',
          outcome: 'failure',
          reason: `meet_${kind}`,
        });
        logger.warn?.(`Video failover to jitsi: meet_${kind}.`);
      },
    });

    try {
      await meetings.insertMeeting({
        appointmentId: appointment.id,
        provider: created.provider,
        url: created.url,
        createdBy: user.id,
        createdAt: now(),
      });
    } catch (err) {
      if (!(err instanceof DuplicateMeetingError)) throw err;
      // A simultaneous request stored its meeting first. This request answers with that one
      // and drops the room it just made.
      const winner = await meetings.findMeeting(appointment.id);
      if (!winner) throw err;
      await respondWithMeeting(req, res, known, winner, 200);
      return;
    }
    await record(req, { ...known, action: `meeting.create_${created.provider}`, outcome: 'success' });

    res.set('Cache-Control', 'no-store');
    res.status(201).json({ provider: created.provider, url: created.url });
  });

  // The professional and the client of the appointment read the stored meeting.
  // Anyone else gets the same 404 as for a missing appointment. A missing meeting is
  // not audited, because the client asks again every few seconds and nothing is read.
  router.get('/appointments/:id/meeting', validateRequest({ query: noQuery }), async (req, res) => {
    const { user } = req.auth;
    const read = 'meeting.read';

    if (!isId(req.params.id)) {
      throw await refuse(req, read, { reason: 'invalid_id' }, notFound());
    }
    const appointment = await store.findAppointment(req.params.id);
    if (!appointment) {
      throw await refuse(req, read, { targetId: req.params.id, reason: 'not_found' }, notFound());
    }
    const resource = meetingResource(appointment);
    const known = { targetId: appointment.id, centerId: appointment.centerId };
    if (!can(user, 'read', resource)) {
      throw await refuse(req, read, { ...known, reason: readDenialReason(user, resource) }, notFound());
    }

    const meeting = await meetings.findMeeting(appointment.id);
    if (!meeting) throw noMeeting();
    await respondWithMeeting(req, res, known, meeting, 200);
  });

  return router;
}

module.exports = { createVideoRouter };
