// The only module that talks to the API. Everything goes through `/api`.

const BASE = '/api';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function request(path, { method = 'GET', body } = {}) {
  const options = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server.');
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload && payload.error ? payload.error : {};
    throw new ApiError(
      response.status,
      error.code || 'unknown_error',
      error.message || 'The server could not complete the request.',
    );
  }
  return payload;
}

const id = encodeURIComponent;

export function getMe() {
  return request('/auth/me');
}

export function logout() {
  return request('/auth/logout', { method: 'POST', body: {} });
}

export function listAppointments() {
  return request('/appointments?limit=200');
}

export function getAppointment(appointmentId) {
  return request(`/appointments/${id(appointmentId)}`);
}

export function createAppointment(input) {
  return request('/appointments', { method: 'POST', body: input });
}

export function createMeeting(appointmentId) {
  return request(`/appointments/${id(appointmentId)}/meeting`, { method: 'POST', body: {} });
}

export function createConsultation(input) {
  return request('/consultations', { method: 'POST', body: input });
}

export function getConsultation(consultationId) {
  return request(`/consultations/${id(consultationId)}`);
}

export function listAudit(filters = {}) {
  const query = new URLSearchParams({ limit: '100' });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  return request(`/audit?${query.toString()}`);
}


// The demo-only Meet outage switch. The API answers 404 to every role when it does not run
// with DEMO_MODE=1, so a caller that gets an error shows nothing.
export function getMeetOutage() {
  return request('/demo/meet-outage');
}

export function setMeetOutage(meetOutage) {
  return request('/demo/meet-outage', { method: 'POST', body: { meetOutage } });
}
