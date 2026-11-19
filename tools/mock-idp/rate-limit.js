'use strict';

// Fixed-window request counter per key (for example, per client IP). It is in
// memory and resets when the process restarts. It is used by the demo provider
// only, to limit the login page and the token endpoint.

const MAX_TRACKED_KEYS = 10000;

function createRateLimiter({ windowMs, max, now = () => new Date() }) {
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new TypeError('windowMs must be a positive integer.');
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new TypeError('max must be a positive integer.');
  }
  const windows = new Map();

  function prune(at) {
    for (const [key, entry] of windows) {
      if (at - entry.start >= windowMs) windows.delete(key);
    }
  }

  // Returns { allowed, retryAfterSeconds }. retryAfterSeconds is 0 when allowed.
  function hit(key) {
    const at = now().getTime();
    let entry = windows.get(key);
    if (!entry || at - entry.start >= windowMs) {
      if (!entry && windows.size >= MAX_TRACKED_KEYS) {
        prune(at);
        // Still full: drop the oldest key so the map never grows past the bound.
        if (windows.size >= MAX_TRACKED_KEYS) windows.delete(windows.keys().next().value);
      }
      entry = { start: at, count: 0 };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count <= max) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + windowMs - at) / 1000)) };
  }

  return { hit, size: () => windows.size };
}

module.exports = { createRateLimiter, MAX_TRACKED_KEYS };
