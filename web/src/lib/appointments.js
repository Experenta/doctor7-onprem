// Small helpers for appointment lists.

export function isUpcoming(appointment, now = Date.now()) {
  return appointment.status === 'scheduled' && new Date(appointment.endsAt).getTime() > now;
}

export function isInProgress(appointment, now = Date.now()) {
  return (
    appointment.status === 'scheduled' &&
    new Date(appointment.startsAt).getTime() <= now &&
    new Date(appointment.endsAt).getTime() > now
  );
}

export function upcomingAppointments(items, now = Date.now()) {
  return items
    .filter((item) => isUpcoming(item, now))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function statusLabel(status) {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Only https addresses, or http on a loopback host, may be opened or embedded.
export function safeVideoUrl(value) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.toString();
  } catch {
    return null;
  }
  return null;
}
