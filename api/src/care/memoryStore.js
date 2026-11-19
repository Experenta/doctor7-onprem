'use strict';

// In-memory implementation of the care store contract (see store.js). It is a
// test aid: it lets the routes run without a database.

function createMemoryCareStore({ users = [], appointments = [], consultations = [] } = {}) {
  const usersById = new Map(users.map((user) => [user.id, { ...user }]));
  const appointmentsById = new Map(appointments.map((item) => [item.id, { ...item }]));
  const consultationsById = new Map(consultations.map((item) => [item.id, { ...item }]));

  return {
    // Test-only inspection.
    usersById,
    appointmentsById,
    consultationsById,

    async findUser(id) {
      const user = usersById.get(id);
      return user ? { id: user.id, centerId: user.centerId ?? null, role: user.role } : null;
    },

    async findAppointment(id) {
      const item = appointmentsById.get(id);
      return item ? { ...item } : null;
    },

    async listAppointments(filter, { limit, offset }) {
      return [...appointmentsById.values()]
        .filter(
          (item) =>
            item.centerId === filter.centerId &&
            (filter.professionalId === undefined || item.professionalId === filter.professionalId) &&
            (filter.clientId === undefined || item.clientId === filter.clientId)
        )
        .sort((a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : 1))
        .slice(offset, offset + limit)
        .map((item) => ({ ...item }));
    },

    async insertAppointment(appointment) {
      appointmentsById.set(appointment.id, { ...appointment });
      return { ...appointment };
    },

    async findConsultation(id) {
      const item = consultationsById.get(id);
      return item ? { ...item } : null;
    },

    async insertConsultation(consultation) {
      consultationsById.set(consultation.id, { ...consultation });
      return { ...consultation };
    },
  };
}

module.exports = { createMemoryCareStore };
