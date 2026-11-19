'use strict';

// One HTTP request for the smoke, with manual redirects, the cookie jar, and the
// Origin header on state-changing requests. Failures carry messages that name
// the check, the HTTP status, or the API error code, and never a response body.

const TIMEOUT_MS = 10000;
const ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

// A failed check of one step. The message is safe to print.
class SmokeFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmokeFailure';
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The `error.code` of a JSON error answer, or `none`. Codes are fixed words of the API.
function errorCode(text) {
  const body = safeJson(text);
  const code = body && body.error && typeof body.error.code === 'string' ? body.error.code : '';
  return ERROR_CODE_PATTERN.test(code) ? code : 'none';
}

// Sends one request. `origin` goes out on POST requests, which change state.
// `json` sends a JSON body, and `form` sends an urlencoded body (a list of pairs
// or an object). Returns { status, location, text, setCookies }.
async function send(url, { method = 'GET', jar = null, origin = null, json, form, headers = {} } = {}) {
  const requestHeaders = { Accept: '*/*', ...headers };
  if (jar) {
    const cookie = jar.headerFor(url);
    if (cookie !== '') requestHeaders.Cookie = cookie;
  }
  if (method === 'POST' && origin) {
    requestHeaders.Origin = origin;
  }
  let body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    requestHeaders['Content-Type'] = 'application/json';
  } else if (form !== undefined) {
    body = new URLSearchParams(form).toString();
    requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  let response;
  let text;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
  } catch (err) {
    const reason = err && err.name === 'TimeoutError' ? 'timeout' : 'network error';
    throw new SmokeFailure(`no answer from the server (${reason})`);
  }

  const setCookies = response.headers.getSetCookie();
  if (jar) jar.store(url, setCookies);
  return { status: response.status, location: response.headers.get('location'), text, setCookies };
}

module.exports = { send, SmokeFailure, safeJson, errorCode };
