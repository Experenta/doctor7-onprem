'use strict';

const { createRepositories } = require('../repositories/tables');

// Persistence for appointments and consultations. Every statement uses bound
// parameters. Rows are returned as camelCase objects with Date values.
//
// Store contract (memoryStore.js has the same one):
//   findUser(id)                         -> { id, centerId, role } or null
//   findAppointment(id)                  -> appointment or null
//   listAppointments(filter, page)       -> appointments. filter has centerId and
//                                           optionally professionalId or clientId.
//   insertAppointment(appointment)       -> appointment
//   findConsultation(id)                 -> consultation or null
//   insertConsultation(consultation)     -> consultation

const APPOINTMENT_COLUMNS =
  'id, center_id, professional_id, client_id, starts_at, ends_at, status, created_at';

function toDate(value) {
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

function toAppointment(row) {
  return {
    id: row.id,
    centerId: row.center_id,
    professionalId: row.professional_id,
    clientId: row.client_id,
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    status: row.status,
    createdAt: toDate(row.created_at),
  };
}

function toConsultation(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    body: row.body,
    createdAt: toDate(row.created_at),
  };
}

function assertPage({ limit, offset }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError('limit must be an integer from 1 to 200.');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('offset must be a non-negative integer.');
  }
}

function createSqlCareStore(db) {
  const repositories = createRepositories(db);

  return {
    async findUser(id) {
      const row = await repositories.users.findById(id);
      return row ? { id: row.id, centerId: row.center_id ?? null, role: row.role } : null;
    },

    async findAppointment(id) {
      const row = await repositories.appointments.findById(id);
      return row ? toAppointment(row) : null;
    },

    // The WHERE parts are fixed strings. Filter values travel as parameters.
    async listAppointments(filter, page) {
      assertPage(page);
      const where = ['center_id = ?'];
      const params = [filter.centerId];
      if (filter.professionalId !== undefined) {
        where.push('professional_id = ?');
        params.push(filter.professionalId);
      }
      if (filter.clientId !== undefined) {
        where.push('client_id = ?');
        params.push(filter.clientId);
      }
      const rows = await db.execute(
        `SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE ${where.join(' AND ')}
          ORDER BY starts_at ASC, id ASC LIMIT ${page.limit} OFFSET ${page.offset}`,
        params
      );
      return rows.map(toAppointment);
    },

    async insertAppointment(appointment) {
      const row = await repositories.appointments.insert({
        id: appointment.id,
        center_id: appointment.centerId,
        professional_id: appointment.professionalId,
        client_id: appointment.clientId,
        starts_at: appointment.startsAt,
        ends_at: appointment.endsAt,
        status: appointment.status,
        created_at: appointment.createdAt,
      });
      return toAppointment(row);
    },

    async findConsultation(id) {
      const row = await repositories.consultations.findById(id);
      return row ? toConsultation(row) : null;
    },

    async insertConsultation(consultation) {
      const row = await repositories.consultations.insert({
        id: consultation.id,
        appointment_id: consultation.appointmentId,
        body: consultation.body,
        created_at: consultation.createdAt,
      });
      return toConsultation(row);
    },
  };
}

module.exports = { createSqlCareStore };
