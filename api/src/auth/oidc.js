'use strict';

// OpenID Connect relying-party client: discovery, the authorization URL, the
// code exchange, and ID token verification. Signature, issuer, audience, and
// expiry checks are done by `jose`. The nonce check is done here.

const { safeEqual } = require('./tokens');

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const ALLOWED_ALGORITHMS = ['RS256', 'ES256'];
const CLOCK_TOLERANCE_SECONDS = 5;

// `reason` is a short fixed code for the server log. It is never built from
// token content, so it is safe to log.
class OidcError extends Error {
  constructor(reason, { unavailable = false } = {}) {
    super(reason);
    this.name = 'OidcError';
    this.reason = reason;
    this.unavailable = unavailable;
  }
}

// jose is published as an ES module, so it is loaded with import().
let josePromise;
function loadJose() {
  josePromise ??= import('jose');
  return josePromise;
}

function createOidcClient(config, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  let discovery = null;
  let discoveredAt = 0;

  async function request(url, init) {
    try {
      return await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new OidcError('provider_unreachable', { unavailable: true });
    }
  }

  async function getDiscovery() {
    if (discovery && now().getTime() - discoveredAt < DISCOVERY_TTL_MS) {
      return discovery;
    }
    const url = `${config.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const res = await request(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new OidcError('discovery_failed', { unavailable: true });
    }
    let doc;
    try {
      doc = await res.json();
    } catch {
      throw new OidcError('discovery_invalid', { unavailable: true });
    }
    if (
      !doc ||
      doc.issuer !== config.issuer ||
      typeof doc.authorization_endpoint !== 'string' ||
      typeof doc.token_endpoint !== 'string' ||
      typeof doc.jwks_uri !== 'string'
    ) {
      throw new OidcError('discovery_invalid', { unavailable: true });
    }
    const { createRemoteJWKSet } = await loadJose();
    discovery = {
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      jwks: createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: REQUEST_TIMEOUT_MS }),
    };
    discoveredAt = now().getTime();
    return discovery;
  }

  async function authorizationUrl({ state, nonce, codeChallenge }) {
    const { authorizationEndpoint } = await getDiscovery();
    const url = new URL(authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.href;
  }

  async function exchangeCode({ code, codeVerifier }) {
    const { tokenEndpoint } = await getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: codeVerifier,
    });
    if (config.clientSecret) {
      body.set('client_secret', config.clientSecret);
    }
    const res = await request(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) {
      throw new OidcError('token_exchange_failed');
    }
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new OidcError('token_response_invalid');
    }
    if (!payload || typeof payload.id_token !== 'string') {
      throw new OidcError('token_response_invalid');
    }
    return payload.id_token;
  }

  async function verifyIdToken(idToken, { nonce }) {
    const { jwks } = await getDiscovery();
    const { jwtVerify } = await loadJose();
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ALLOWED_ALGORITHMS,
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: now(),
      }));
    } catch (err) {
      if (err && err.code === 'ERR_JWT_EXPIRED') {
        throw new OidcError('token_expired');
      }
      if (err && err.code === 'ERR_JWKS_TIMEOUT') {
        throw new OidcError('provider_unreachable', { unavailable: true });
      }
      throw new OidcError('token_invalid');
    }

    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId) {
      throw new OidcError('token_invalid');
    }
    if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce)) {
      throw new OidcError('nonce_mismatch');
    }
    if (payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email) {
      throw new OidcError('email_not_verified');
    }
    return { subject: payload.sub, email: payload.email };
  }

  return { authorizationUrl, exchangeCode, verifyIdToken, getDiscovery };
}

module.exports = { createOidcClient, OidcError };
