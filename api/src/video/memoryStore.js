'use strict';

// In-memory implementation of the meeting store contract (see store.js). It is a
// test aid: it lets the routes run without a database.

const { DuplicateMeetingError } = require('./store');

function createMemoryMeetingStore({ meetings = [] } = {}) {
  const byAppointment = new Map(meetings.map((item) => [item.appointmentId, { ...item }]));

  return {
    // Test-only inspection.
    meetings: byAppointment,

    async findMeeting(appointmentId) {
      const item = byAppointment.get(appointmentId);
      return item ? { ...item } : null;
    },

    async insertMeeting(meeting) {
      if (byAppointment.has(meeting.appointmentId)) throw new DuplicateMeetingError();
      byAppointment.set(meeting.appointmentId, { ...meeting });
      return { ...meeting };
    },

    // Test-only. Stands for the ON DELETE CASCADE of the foreign key to appointments.
    deleteForAppointment(appointmentId) {
      byAppointment.delete(appointmentId);
    },
  };
}

module.exports = { createMemoryMeetingStore };
