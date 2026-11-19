import { request } from '../api/client.js';

// Reads the stored meeting of an appointment: { provider, url }. Answers 404 when the
// appointment has no meeting yet, and 404 too when the caller may not read it.
export function getMeeting(appointmentId) {
  return request(`/appointments/${encodeURIComponent(appointmentId)}/meeting`);
}

// How often the client asks again while the professional has not started the meeting.
export const MEETING_POLL_MS = 15000;

// What the Home screen says when the API refuses to start a meeting of a closed appointment.
// It is the same sentence as the video panel of the appointment screen.
export const MEETING_CLOSED_MESSAGE = 'This appointment is not scheduled, so a meeting cannot be started.';
