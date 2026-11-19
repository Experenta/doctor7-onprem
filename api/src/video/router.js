'use strict';

const { Router } = require('express');
const { ApiError } = require('../http/errors');
const { can } = require('../authz/policy');
const { requestContext } = require('../audit/entry');
const { readDenialReason } = require('../care/router');

const ID_MAX_LENGTH = 64;

const forbidden = () => new ApiError(403, 'forbidden', 'This account may not use this resource.');
const notFound = () => new ApiError(404, 'not_found', 'Resource not found.');

function isId(value) {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= ID_MAX_LENGTH;
}

function appointmentResource(appointment) {
  return {
    type: 'appointment',
    centerId: appointment.centerId,
    professionalId: appointment.professionalId,
    clientId: appointment.clientId,
  };
}

// Handlers assume the authz gate ran first (session, JSON content type, role).
// Every refusal and every outcome writes an audit entry before the response.
// `service` is null when VIDEO_PROVIDER is not set.
function createVideoRouter({ store, audit, service, logger = console }) {
  if (!audit) {
    throw new TypeError('createVideoRouter requires an audit sink.');
  }
  const router = Router();

  async function record(req, entry) {
    await audit.record({ ...requestContext(req), targetType: 'appointment', ...entry });
  }

  async function refuse(req, entry, error) {
    await record(req, { ...entry, action: 'meeting.create', outcome: 'denied' });
    return error;
  }

  router.post('/appointments/:id/meeting', async (req, res) => {
    const { user } = req.auth;

    // The provider comes from the configuration only. A client cannot choose it.
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      throw new ApiError(400, 'invalid_request', 'This request takes no body fields.');
    }
    if (!isId(req.params.id)) {
      throw await refuse(req, { reason: 'invalid_id' }, notFound());
    }
    const appointment = await store.findAppointment(req.params.id);
    if (!appointment) {
      throw await refuse(req, { targetId: req.params.id, reason: 'not_found' }, notFound());
    }
    const resource = appointmentResource(appointment);
    const known = { targetId: appointment.id, centerId: appointment.centerId };

    // Without read access the answer is the same 404 as for a missing appointment.
    if (!can(user, 'read', resource)) {
      throw await refuse(req, { ...known, reason: readDenialReason(user, resource) }, notFound());
    }
    // The caller can read the appointment. Only its professional may create the
    // meeting. An administrator of the center can read it but is not a participant.
    if (!can(user, 'update', resource) || appointment.professionalId !== user.id) {
      throw await refuse(req, { ...known, reason: 'action_not_allowed' }, forbidden());
    }

    if (!service) {
      await record(req, { ...known, action: 'meeting.create', outcome: 'failure', reason: 'not_configured' });
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
    await record(req, { ...known, action: `meeting.create_${created.provider}`, outcome: 'success' });

    res.set('Cache-Control', 'no-store');
    res.status(201).json({ provider: created.provider, url: created.url });
  });

  return router;
}

module.exports = { createVideoRouter };
