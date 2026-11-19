'use strict';

const { loadAuthConfig } = require('./auth/config');
const { loadVideoConfig } = require('./video/config');
const { PROVIDER_NAMES } = require('./video/provider');
const { parseRetentionDays } = require('./chat/purge');
const { loadSecurityConfig } = require('./security/config');

// Every runtime setting is read here, at startup. Secrets have no defaults in
// code. An error names the variable and never prints its value, because values
// can hold credentials or signing keys. docs/OPERATIONS.md lists the variables.

// A whole number from min to max. An unset or empty variable gets the fallback.
function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= min && value <= max)) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

// video/config.js also refuses a wrong provider without repeating it. This
// check runs first and gives the same message.
function loadVideoSettings(env) {
  const provider = env.VIDEO_PROVIDER;
  if (provider !== undefined && provider !== '' && !PROVIDER_NAMES.includes(provider)) {
    throw new Error(`VIDEO_PROVIDER must be one of: ${PROVIDER_NAMES.join(', ')}.`);
  }
  return loadVideoConfig(env);
}

// Reads the settings of the whole process. DATABASE_URL is not required here, so
// the API can be loaded without a database. start() calls requireDatabaseUrl.
function loadConfig(env = process.env) {
  const auth = loadAuthConfig(env);
  // A production server never runs without sign-in. Without OIDC settings the
  // API would start with the probes only, which hides a missing configuration.
  if (env.NODE_ENV === 'production' && !auth.enabled) {
    throw new Error(
      'NODE_ENV=production requires sign-in: set OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_REDIRECT_URI.'
    );
  }
  const video = loadVideoSettings(env);
  return {
    host: env.HOST || '127.0.0.1',
    port: readInteger(env, 'PORT', 3000, { min: 1, max: 65535 }),
    databaseUrl: env.DATABASE_URL || '',
    // Number of reverse proxies in front of the API. Use 1 behind Apache.
    trustProxy: readInteger(env, 'TRUST_PROXY', 0, { min: 0, max: 10 }),
    rateLimit: {
      windowMs: readInteger(env, 'RATE_LIMIT_WINDOW_MS', 60 * 1000, { min: 1, max: 86400000 }),
      limit: readInteger(env, 'RATE_LIMIT_MAX', 120, { min: 1, max: 1000000 }),
    },
    auth,
    video,
    security: loadSecurityConfig(env, {
      redirectUri: auth.enabled ? auth.redirectUri : undefined,
      jitsiBaseUrl: video.jitsi ? video.jitsi.baseUrl : undefined,
    }),
    chat: { retentionDays: parseRetentionDays(env.CHAT_RETENTION_DAYS) },
  };
}

// Throws unless DATABASE_URL is a mysql:// URL with a host. Returns the URL.
function requireDatabaseUrl(config) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  let url;
  try {
    url = new URL(config.databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a mysql:// URL.');
  }
  if (url.protocol !== 'mysql:' || url.hostname === '') {
    throw new Error('DATABASE_URL must be a mysql:// URL with a host.');
  }
  return config.databaseUrl;
}

module.exports = { loadConfig, requireDatabaseUrl };
