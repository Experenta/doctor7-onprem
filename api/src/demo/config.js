'use strict';

// Settings of the demo-only Meet outage switch (K-36). The switch exists only when
// DEMO_MODE=1. Any other state of DEMO_MODE (unset, empty, 0) means that the API holds no
// route, no rule, and no client for the simulator. Errors name the variable and never quote
// a value, because the secret is one of them. See docs/DEMO.md.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 256;
const DEFAULT_TIMEOUT_MS = 3000;
// Printable ASCII only, so the value is safe in a header.
const SECRET_PATTERN = /^[\x21-\x7e]+$/;

function text(env, name) {
  const value = env[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readControlUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DEMO_MEET_CONTROL_URL must be an absolute URL.');
  }
  const valid =
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash;
  if (!valid) {
    throw new Error('DEMO_MEET_CONTROL_URL must be an http URL on a loopback host, without path, credentials, query, or fragment.');
  }
  return url.origin;
}

// Returns null when the demo switch is off, or { controlUrl, timeoutMs } with a hidden
// `controlSecret` property (not enumerable, so printing the config does not show it).
function loadDemoConfig(env = process.env) {
  const mode = env.DEMO_MODE;
  if (mode === undefined || mode === '' || mode === '0') {
    return null;
  }
  if (mode !== '1') {
    throw new Error('DEMO_MODE must be 1 to turn the demo switch on, or unset.');
  }
  const rawUrl = text(env, 'DEMO_MEET_CONTROL_URL');
  if (rawUrl === undefined) {
    throw new Error('DEMO_MEET_CONTROL_URL is required when DEMO_MODE is 1.');
  }
  const secret = text(env, 'DEMO_MEET_CONTROL_SECRET');
  if (secret === undefined) {
    throw new Error('DEMO_MEET_CONTROL_SECRET is required when DEMO_MODE is 1.');
  }
  if (secret.length < MIN_SECRET_LENGTH || secret.length > MAX_SECRET_LENGTH || !SECRET_PATTERN.test(secret)) {
    throw new Error(`DEMO_MEET_CONTROL_SECRET must be ${MIN_SECRET_LENGTH} to ${MAX_SECRET_LENGTH} printable characters without spaces.`);
  }
  const config = { controlUrl: readControlUrl(rawUrl), timeoutMs: DEFAULT_TIMEOUT_MS };
  Object.defineProperty(config, 'controlSecret', { value: secret, enumerable: false, writable: false });
  return config;
}

module.exports = { loadDemoConfig, MIN_SECRET_LENGTH };
