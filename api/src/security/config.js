'use strict';

// Security settings read from environment variables. An error names the
// variable and never prints its value.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_ORIGINS = 20;

const DEFAULTS = Object.freeze({
  login: { windowMs: 15 * 60 * 1000, limit: 20 },
  write: { windowMs: 60 * 1000, limit: 60 },
});

function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= min && value <= max)) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

// The origin of an absolute http(s) URL, or null. Plain http is allowed only on
// a loopback host. Credentials are refused.
function originOf(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password) return null;
  return url.origin;
}

// Parses ALLOWED_ORIGINS. Each entry must already be an origin: scheme, host,
// and optional port, with no path.
function parseAllowedOrigins(raw) {
  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.length > MAX_ORIGINS) {
    throw new Error(`ALLOWED_ORIGINS may list at most ${MAX_ORIGINS} origins.`);
  }
  return entries.map((entry) => {
    const origin = originOf(entry);
    if (origin === null || origin !== entry) {
      throw new Error(
        'ALLOWED_ORIGINS must be a comma-separated list of origins such as https://clinic.example.test (https, or http on localhost, with no path).'
      );
    }
    return origin;
  });
}

// Returns { allowedOrigins, jitsiOrigin, loginLimit, writeLimit }.
// `redirectUri` is the sign-in redirect URI. It is the default origin when
// ALLOWED_ORIGINS is not set. `jitsiBaseUrl` defaults to JITSI_BASE_URL.
function loadSecurityConfig(env = process.env, { redirectUri, jitsiBaseUrl } = {}) {
  let allowedOrigins = [];
  if (typeof env.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS.trim() !== '') {
    allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  } else if (redirectUri) {
    const fallback = originOf(redirectUri);
    allowedOrigins = fallback === null ? [] : [fallback];
  }

  // An unusable Jitsi address is reported by the video settings, so it is
  // ignored here.
  const jitsiRaw = jitsiBaseUrl ?? env.JITSI_BASE_URL;
  const jitsiOrigin = typeof jitsiRaw === 'string' && jitsiRaw !== '' ? originOf(jitsiRaw) : null;

  return {
    allowedOrigins: [...new Set(allowedOrigins)],
    jitsiOrigin,
    loginLimit: {
      windowMs: readInteger(env, 'RATE_LIMIT_LOGIN_WINDOW_MS', DEFAULTS.login.windowMs, { min: 1, max: 86400000 }),
      limit: readInteger(env, 'RATE_LIMIT_LOGIN_MAX', DEFAULTS.login.limit, { min: 1, max: 1000000 }),
    },
    writeLimit: {
      windowMs: readInteger(env, 'RATE_LIMIT_WRITE_WINDOW_MS', DEFAULTS.write.windowMs, { min: 1, max: 86400000 }),
      limit: readInteger(env, 'RATE_LIMIT_WRITE_MAX', DEFAULTS.write.limit, { min: 1, max: 1000000 }),
    },
  };
}

module.exports = { loadSecurityConfig, originOf, parseAllowedOrigins, DEFAULTS };
