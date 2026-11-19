'use strict';

// Runtime settings come from environment variables. Secrets have no defaults in
// code: DATABASE_URL must be provided by the environment.

function readInteger(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number(raw);
}

function loadConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: readInteger(env, 'PORT', 3000),
    databaseUrl: env.DATABASE_URL || '',
    rateLimit: {
      windowMs: readInteger(env, 'RATE_LIMIT_WINDOW_MS', 60 * 1000),
      limit: readInteger(env, 'RATE_LIMIT_MAX', 120),
    },
  };
}

module.exports = { loadConfig };
