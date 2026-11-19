'use strict';

const { createRepositories } = require('../repositories/tables');

// Persistence for the video meeting of an appointment. Every statement uses bound
// parameters. An appointment has at most one meeting, because appointment_id is the
// primary key.
//
// Store contract (memoryStore.js has the same one):
//   findMeeting(appointmentId) -> { appointmentId, provider, url, createdBy, createdAt } or null
//   insertMeeting(meeting)     -> the stored meeting. Throws DuplicateMeetingError when the
//                                 appointment already has a meeting.

class DuplicateMeetingError extends Error {
  constructor() {
    super('The appointment already has a meeting.');
    this.name = 'DuplicateMeetingError';
  }
}

const MYSQL_DUPLICATE_ENTRY = 1062;

function isDuplicateKey(err) {
  return Boolean(err) && (err.code === 'ER_DUP_ENTRY' || err.errno === MYSQL_DUPLICATE_ENTRY);
}

function toDate(value) {
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

function toMeeting(row) {
  return {
    appointmentId: row.appointment_id,
    provider: row.provider,
    url: row.url,
    createdBy: row.created_by,
    createdAt: toDate(row.created_at),
  };
}

function createSqlMeetingStore(db) {
  const repositories = createRepositories(db);

  return {
    async findMeeting(appointmentId) {
      const row = await repositories.meetings.findById(appointmentId);
      return row ? toMeeting(row) : null;
    },

    async insertMeeting(meeting) {
      try {
        const row = await repositories.meetings.insert({
          appointment_id: meeting.appointmentId,
          provider: meeting.provider,
          url: meeting.url,
          created_by: meeting.createdBy,
          created_at: meeting.createdAt,
        });
        return toMeeting(row);
      } catch (err) {
        if (isDuplicateKey(err)) throw new DuplicateMeetingError();
        throw err;
      }
    },
  };
}

module.exports = { createSqlMeetingStore, DuplicateMeetingError };
