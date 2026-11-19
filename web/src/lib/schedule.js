// Day and week helpers for the schedule screens. They are pure functions.
// Bogota has no daylight saving time, so its offset from UTC is always -05:00.
// A "day key" is the Bogota calendar day of an instant, as YYYY-MM-DD.

const OFFSET_MS = 5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const longDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const shortWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const monthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const atNoon = (key) => new Date(`${key}T12:00:00Z`);

// The Bogota day of an ISO string or of a number of milliseconds. Null for a bad date.
export function dayKey(value) {
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(key, count) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

// The Monday of the week that holds the day.
export function weekStart(key) {
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(key, -((weekday + 6) % 7));
}

// Seven day keys, Monday to Sunday.
export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function formatDayKey(key) {
  return longDay.format(atNoon(key));
}

export function weekdayShort(key) {
  return shortWeekday.format(atNoon(key));
}

export function dayNumber(key) {
  return Number(key.slice(8, 10));
}

// "Nov 30 to Dec 6" for the seven days of a week.
export function formatWeekRange(days) {
  return `${monthDay.format(atNoon(days[0]))} to ${monthDay.format(atNoon(days[6]))}`;
}

// "Today", "Tomorrow", "Yesterday", or the weekday and date.
export function dayHeading(key, todayKey) {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, 1)) return 'Tomorrow';
  if (key === addDays(todayKey, -1)) return 'Yesterday';
  return formatDayKey(key);
}

// The date line of the page header, in Bogota time.
export function formatToday(now = Date.now()) {
  return formatDayKey(dayKey(now));
}

// Groups appointments by day. Today and later days come first, oldest day first. Earlier
// days follow, newest day first. Inside a day the order is by start time. An appointment
// with an unreadable date goes last, in its own group.
export function groupByDay(items, now = Date.now()) {
  const today = dayKey(now);
  const sorted = [...items].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const byKey = new Map();
  for (const item of sorted) {
    const key = dayKey(item.startsAt) || 'unknown';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const groups = [...byKey.entries()].map(([key, list]) => ({
    key,
    label: key === 'unknown' ? 'Unknown date' : dayHeading(key, today),
    section: key !== 'unknown' && key >= today ? 'upcoming' : 'earlier',
    items: list,
  }));
  const upcoming = groups.filter((group) => group.section === 'upcoming');
  const earlier = groups.filter((group) => group.section === 'earlier' && group.key !== 'unknown').reverse();
  const unknown = groups.filter((group) => group.key === 'unknown');
  return [...upcoming, ...earlier, ...unknown];
}

export function onDay(items, key) {
  return items
    .filter((item) => dayKey(item.startsAt) === key)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

// Text for the time left before a start. `ms` is the start minus now.
export function countdownText(ms) {
  if (ms <= 0) return 'Starting now';
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return 'Starts in less than a minute';
  if (minutes < 60) return `Starts in ${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `Starts in ${hours} h` : `Starts in ${hours} h ${rest} min`;
  }
  const days = Math.floor(minutes / (24 * 60));
  return `Starts in ${days} ${days === 1 ? 'day' : 'days'}`;
}

// Matches the filter chips of the Appointments screen.
export function matchesFilter(appointment, filter) {
  if (filter === 'scheduled') return appointment.status === 'scheduled';
  if (filter === 'closed') return appointment.status !== 'scheduled';
  return true;
}
