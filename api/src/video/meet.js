'use strict';

const crypto = require('node:crypto');
const { VideoProviderError } = require('./provider');

// Google Meet adapter. A service account with domain-wide delegation creates a
// Meet space on behalf of one Workspace user.
//
//   1. Sign an RS256 assertion (iss: service account, sub: delegated user).
//   2. Exchange it at the token address for an access token.
//   3. POST /v2/spaces with the access token and read meetingUri.
//
// The Google calls follow the Meet REST API v2 as understood when this was
// written. If Google differs, change this file only (see the design notes).
//
// Every failure becomes a VideoProviderError with a fixed message. Upstream
// bodies, the assertion, the token, and the key never leave this file.

const SPACE_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const ASSERTION_LIFETIME_SECONDS = 300;
const MEET_HOST = 'meet.google.com';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signAssertion({ credential, delegatedUser, tokenUri, nowSeconds }) {
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: credential.clientEmail,
    sub: delegatedUser,
    scope: SPACE_SCOPE,
    aud: tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
  })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), credential.privateKey).toString('base64url');
  return `${input}.${signature}`;
}

// Reads the JSON body of a response, or null. Used for the error status only.
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isQuota(status, body) {
  return status === 429 || (body && body.error && body.error.status === 'RESOURCE_EXHAUSTED') === true;
}

function isMeetUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === MEET_HOST && url.pathname.length > 1;
  } catch {
    return false;
  }
}

// `config` is the `meet` part of loadVideoConfig. `timeoutMs` limits the whole
// creation, both calls together. `fetchImpl` can be replaced in tests.
function createMeetProvider({ config, timeoutMs, fetchImpl = fetch, now = () => new Date() }) {
  const { credential, delegatedUser, apiBaseUrl } = config;
  const tokenUri = credential.tokenUri || DEFAULT_TOKEN_URI;

  async function call(url, init, signal) {
    const response = await fetchImpl(url, { ...init, signal, redirect: 'error' });
    if (response.ok) return response;
    const body = await readJson(response);
    throw new VideoProviderError(isQuota(response.status, body) ? 'quota' : 'error');
  }

  async function requestAccessToken(signal) {
    const assertion = signAssertion({
      credential,
      delegatedUser,
      tokenUri,
      nowSeconds: Math.floor(now().getTime() / 1000),
    });
    const response = await call(
      tokenUri,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }),
      },
      signal
    );
    const body = await readJson(response);
    if (!body || typeof body.access_token !== 'string' || body.access_token === '') {
      throw new VideoProviderError('error');
    }
    return body.access_token;
  }

  async function createSpace(accessToken, signal) {
    const response = await call(
      `${apiBaseUrl}/v2/spaces`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{}',
      },
      signal
    );
    const body = await readJson(response);
    if (!body || !isMeetUrl(body.meetingUri)) {
      throw new VideoProviderError('error');
    }
    return body.meetingUri;
  }

  return {
    name: 'meet',

    async createMeeting() {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const url = await createSpace(await requestAccessToken(signal), signal);
        return { url };
      } catch (err) {
        const kind = err instanceof VideoProviderError ? err.kind : 'error';
        // An abort can surface as a read failure after the answer started.
        throw new VideoProviderError(signal.aborted && kind === 'error' ? 'timeout' : kind);
      }
    },
  };
}

module.exports = { createMeetProvider, SPACE_SCOPE };
