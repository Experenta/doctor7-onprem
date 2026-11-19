'use strict';

const { PROVIDER_NAMES } = require('./provider');

// Video settings, read from environment variables. Errors name the variable and
// never quote the value of a secret. See docs/VIDEO.md for the list.

const DEFAULT_MEET_API_BASE_URL = 'https://meet.googleapis.com';
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function text(env, name) {
  const value = env[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// An https address, or http on a loopback host (used by the simulators in tests).
function parseUrl(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an https URL (http only on a loopback host) without credentials, query, or fragment.`);
  }
  return url.href.replace(/\/+$/, '');
}

function readUrl(env, name, fallback) {
  const raw = text(env, name) ?? fallback;
  return raw === undefined ? undefined : parseUrl(raw, name);
}

function readTimeout(env) {
  const raw = text(env, 'MEET_TIMEOUT_MS');
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const value = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS)) {
    throw new Error(`MEET_TIMEOUT_MS must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

// Parses the service account key. The JSON parser can quote its input in an
// error message, so a failure is replaced with a fixed message.
function readCredential(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
  const valid =
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof parsed.client_email === 'string' &&
    parsed.client_email !== '' &&
    typeof parsed.private_key === 'string' &&
    parsed.private_key.includes('PRIVATE KEY');
  if (!valid) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must hold a service account key with client_email and private_key.');
  }
  let tokenUri;
  if (parsed.token_uri !== undefined) {
    try {
      tokenUri = parseUrl(parsed.token_uri, 'token_uri');
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON has a token_uri that is not an https URL.');
    }
  }
  return { clientEmail: parsed.client_email, privateKey: parsed.private_key, tokenUri };
}

// Defines a property that console.log, util.inspect, and JSON.stringify skip.
function hidden(target, name, value) {
  Object.defineProperty(target, name, { value, enumerable: false, writable: false });
}

// Returns { provider, timeoutMs, jitsi, meet }. `provider` is null when
// VIDEO_PROVIDER is not set. `meet` is null unless provider is meet. The secret
// values (credential, jitsi jwt secret) are not enumerable.
function loadVideoConfig(env = process.env) {
  const selected = text(env, 'VIDEO_PROVIDER');
  if (selected !== undefined && !PROVIDER_NAMES.includes(selected)) {
    throw new Error(
      `VIDEO_PROVIDER must be one of: ${PROVIDER_NAMES.join(', ')}.`
    );
  }

  const config = { provider: selected ?? null, timeoutMs: readTimeout(env), jitsi: null, meet: null };
  if (!config.provider) {
    return config;
  }

  // Jitsi is the provider, or the failover target of Meet. Both need its address.
  const baseUrl = readUrl(env, 'JITSI_BASE_URL');
  if (!baseUrl) {
    throw new Error(`JITSI_BASE_URL is required when VIDEO_PROVIDER is ${config.provider}.`);
  }
  const appId = text(env, 'JITSI_APP_ID');
  const secret = text(env, 'JITSI_JWT_SECRET');
  if ((appId === undefined) !== (secret === undefined)) {
    throw new Error('JITSI_APP_ID and JITSI_JWT_SECRET must be set together, or both left unset.');
  }
  config.jitsi = { baseUrl, appId: appId ?? null };
  hidden(config.jitsi, 'jwtSecret', secret ?? null);

  if (config.provider === 'meet') {
    const rawCredential = text(env, 'GOOGLE_SERVICE_ACCOUNT_JSON');
    if (rawCredential === undefined) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is required when VIDEO_PROVIDER is meet.');
    }
    const delegatedUser = text(env, 'GOOGLE_MEET_DELEGATED_USER');
    if (delegatedUser === undefined) {
      throw new Error('GOOGLE_MEET_DELEGATED_USER is required when VIDEO_PROVIDER is meet.');
    }
    config.meet = {
      delegatedUser,
      apiBaseUrl: readUrl(env, 'GOOGLE_MEET_API_BASE_URL', DEFAULT_MEET_API_BASE_URL),
    };
    hidden(config.meet, 'credential', readCredential(rawCredential));
  }
  return config;
}

module.exports = { loadVideoConfig, DEFAULT_TIMEOUT_MS };
