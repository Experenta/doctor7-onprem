const TIME_ZONE = 'America/Bogota';

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

function parse(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The API sends UTC. The screen shows Bogota time.
export function formatDateTime(iso) {
  const date = parse(iso);
  return date ? dateTimeFormat.format(date) : 'Unknown date';
}

export function formatTime(iso) {
  const date = parse(iso);
  return date ? timeFormat.format(date) : '';
}

// Bogota has no daylight saving time, so its offset is always -05:00.
// Returns a UTC ISO string, or null when the input is not a valid date and time.
export function bogotaToUtcIso(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
