'use strict';

const { can } = require('../authz/policy');
const { readDenialReason } = require('../care/router');

// Chat access. A user may use the chat of an appointment only when the
// authorization matrix lets them read it and they are its professional or its
// client. An administrator of the center can read the appointment, but is not a
// participant, so is refused with not_participant.

// Returns the reason the user may not use the chat, or null when the user may.
// The reasons are the ones listed in docs/AUDIT.md.
function chatDenialReason(user, appointment) {
  const resource = {
    type: 'appointment',
    centerId: appointment.centerId,
    professionalId: appointment.professionalId,
    clientId: appointment.clientId,
  };
  if (!can(user, 'read', resource)) {
    return readDenialReason(user, resource);
  }
  const participates =
    (user.role === 'professional' && appointment.professionalId === user.id) ||
    (user.role === 'client' && appointment.clientId === user.id);
  return participates ? null : 'not_participant';
}

// A closed appointment is one that is no longer scheduled. The schema has
// completed and cancelled as the other two states.
function isClosed(appointment) {
  return appointment.status !== 'scheduled';
}

module.exports = { chatDenialReason, isClosed };
