'use strict';

// Sign-in settings read from environment variables. No secret has a default in
// code. When none of the OIDC variables is set, sign-in is disabled and the
// /auth routes are not mounted.

const DEFAULTS = {
  scope: 'openid email profile',
  sessionCookieName: 'd7_session',
  absoluteTtlSeconds: 8 * 60 * 60,
  idleTtlSeconds: 30 * 60,
  postLoginPath: '/',
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function readPositiveInteger(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(raw);
}

// URLs must use https. Plain http is accepted only for a loopback host, which
// is how the mock identity provider runs during development.
function readUrl(env, name) {
  let url;
  try {
    url = new URL(env[name]);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  const secure = url.protocol === 'https:';
  const loopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !loopback) {
    throw new Error(`${name} must use https (http is allowed only for localhost).`);
  }
  // Return the value as given. The issuer is compared as a string with the
  // token claim, and the redirect URI must match the provider registration.
  return env[name];
}

function loadAuthConfig(env = process.env) {
  const required = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_REDIRECT_URI'];
  const present = required.filter((name) => env[name]);
  if (present.length === 0) {
    return { enabled: false };
  }
  if (present.length !== required.length) {
    throw new Error(`${required.join(', ')} must be set together.`);
  }

  const postLoginPath = env.AUTH_POST_LOGIN_PATH || DEFAULTS.postLoginPath;
  if (!/^\/(?![/\\])/.test(postLoginPath)) {
    throw new Error('AUTH_POST_LOGIN_PATH must be a path that starts with a single slash.');
  }
  const cookieName = env.SESSION_COOKIE_NAME || DEFAULTS.sessionCookieName;
  if (!/^[A-Za-z0-9_]+$/.test(cookieName)) {
    throw new Error('SESSION_COOKIE_NAME may contain only letters, digits, and underscores.');
  }

  return {
    enabled: true,
    issuer: readUrl(env, 'OIDC_ISSUER'),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    redirectUri: readUrl(env, 'OIDC_REDIRECT_URI'),
    scope: env.OIDC_SCOPE || DEFAULTS.scope,
    sessionCookieName: cookieName,
    absoluteTtlSeconds: readPositiveInteger(env, 'SESSION_ABSOLUTE_TTL_SECONDS', DEFAULTS.absoluteTtlSeconds),
    idleTtlSeconds: readPositiveInteger(env, 'SESSION_IDLE_TTL_SECONDS', DEFAULTS.idleTtlSeconds),
    postLoginPath,
  };
}

module.exports = { loadAuthConfig, DEFAULTS };
