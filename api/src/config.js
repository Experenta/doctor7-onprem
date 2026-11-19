'use strict';

const { loadAuthConfig } = require('./auth/config');
const { loadVideoConfig } = require('./video/config');
const { PROVIDER_NAMES } = require('./video/provider');
const { parseRetentionDays } = require('./chat/purge');

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

// video/config.js quotes the rejected provider name in its own message. This
// check runs first, so a wrong name stops startup without repeating it.
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
    auth: loadAuthConfig(env),
    video: loadVideoSettings(env),
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
