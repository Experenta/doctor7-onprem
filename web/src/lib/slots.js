// Small helpers for the times of the new appointment form. A time is "HH:MM", as the
// native time field gives it. They are pure functions.

const DAY_MINUTES = 24 * 60;

function toMinutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Minutes from `start` to `end`, or null when a time is missing or the end is not after the start.
export function durationMinutes(start, end) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || to <= from) return null;
  return to - from;
}

// The time `minutes` after `time`, as "HH:MM". Null when the result is past midnight, because
// an appointment is on one day, or when the time is not valid.
export function addMinutes(time, minutes) {
  const from = toMinutes(time);
  if (from === null || !Number.isInteger(minutes) || minutes <= 0) return null;
  const total = from + minutes;
  if (total >= DAY_MINUTES) return null;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// "10:05" as "10:05 AM". An empty or invalid time gives an empty string.
export function formatClock(time) {
  const total = toMinutes(time);
  if (total === null) return '';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const shown = hours % 12 === 0 ? 12 : hours % 12;
  return `${shown}:${String(minutes).padStart(2, '0')} ${suffix}`;
}
