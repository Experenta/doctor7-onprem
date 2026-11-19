'use strict';

// Reads the smoke settings from the arguments and the environment. Every error
// names the flag or the variable, and never prints its value. Values can hold
// site addresses that PMs do not want in logs.

const { MODES: GOOGLE_MODES } = require('../../tools/mock-google/server');

const DEFAULT_API_PREFIX = '/api';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const API_PREFIX_PATTERN = /^(\/[A-Za-z0-9_-]+)*$/;

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// An unset or empty variable counts as unset.
function text(env, name) {
  const value = env[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readOnlyFlag(env) {
  const raw = text(env, 'SMOKE_READ_ONLY');
  if (raw === undefined || raw === '0') return false;
  if (raw === '1') return true;
  throw new ConfigError('SMOKE_READ_ONLY must be 1 (read only) or 0 (write run).');
}

// A site origin: https, or http on a loopback host, with no path, query, or credentials.
function siteOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('SMOKE_BASE_URL must be an absolute URL, such as https://<host>.');
  }
  const secure = url.protocol === 'https:';
  const loopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !loopback) {
    throw new ConfigError('SMOKE_BASE_URL must use https (http is allowed only for localhost).');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) {
    throw new ConfigError('SMOKE_BASE_URL must be the site origin only, without a path, query, or credentials.');
  }
  return url.origin;
}

// Reads the flags. Unknown arguments are refused without being echoed.
function parseArguments(argv) {
  const flags = { remote: false, noVideoProvider: false, googleMode: 'ok' };
  for (const arg of argv) {
    if (arg === '--remote') {
      flags.remote = true;
    } else if (arg === '--no-video-provider') {
      flags.noVideoProvider = true;
    } else if (arg.startsWith('--google-mode=')) {
      flags.googleMode = arg.slice('--google-mode='.length);
    } else {
      throw new ConfigError('Unknown option. Use --remote, --no-video-provider, or --google-mode=<mode>.');
    }
  }
  if (!GOOGLE_MODES.includes(flags.googleMode)) {
    throw new ConfigError(`--google-mode must be one of: ${GOOGLE_MODES.join(', ')}.`);
  }
  return flags;
}

// Returns the run settings. In process mode, `origin` and `apiPrefix` are filled
// in later, when the local stack has started.
function resolveConfig(argv, env) {
  const flags = parseArguments(argv);
  const readOnly = readOnlyFlag(env);
  const baseUrl = text(env, 'SMOKE_BASE_URL');

  if (flags.remote) {
    if (baseUrl === undefined) {
      throw new ConfigError('SMOKE_BASE_URL is required with --remote: the origin of the deployed site.');
    }
    if (flags.noVideoProvider || flags.googleMode !== 'ok') {
      throw new ConfigError('--no-video-provider and --google-mode work only in process mode.');
    }
    const apiPrefix = env.SMOKE_API_PREFIX === undefined ? DEFAULT_API_PREFIX : env.SMOKE_API_PREFIX;
    if (!API_PREFIX_PATTERN.test(apiPrefix)) {
      throw new ConfigError('SMOKE_API_PREFIX must be empty or a path such as /api, without a trailing slash.');
    }
    return { mode: 'remote', readOnly, origin: siteOrigin(baseUrl), apiPrefix };
  }

  if (baseUrl !== undefined) {
    throw new ConfigError('SMOKE_BASE_URL is set but --remote is not given. Add --remote to test the deployed instance.');
  }
  return {
    mode: 'process',
    readOnly,
    googleMode: flags.googleMode,
    noVideoProvider: flags.noVideoProvider,
  };
}

module.exports = { resolveConfig, ConfigError };
