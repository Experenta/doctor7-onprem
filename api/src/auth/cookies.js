'use strict';

// Minimal Cookie header parsing and Set-Cookie building. Cookie values here are
// always base64url tokens, so no encoding is needed.

const NAME = /^[A-Za-z0-9_]+$/;

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') {
    return out;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    // The first occurrence wins, so a later duplicate cannot shadow it.
    if (name && !(name in out)) {
      out[name] = value;
    }
  }
  return out;
}

// Returns every value sent under `name`, in header order. A browser sends two
// cookies of one name when an old cookie with another Path is still stored.
// parseCookies keeps only the first one, so callers that must try each value use this.
function parseCookieValues(header, name) {
  const out = [];
  if (typeof header !== 'string' || typeof name !== 'string' || name === '') {
    return out;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      out.push(part.slice(index + 1).trim());
    }
  }
  return out;
}

// Every cookie this module sets is HttpOnly and Secure.
function serializeCookie(name, value, { maxAgeSeconds, sameSite, path = '/' }) {
  if (!NAME.test(name) || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError('Invalid cookie name or value.');
  }
  if (!['Strict', 'Lax'].includes(sameSite)) {
    throw new TypeError('sameSite must be Strict or Lax.');
  }
  return [
    `${name}=${value}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `Path=${path}`,
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`,
  ].join('; ');
}

function clearCookie(name, { sameSite, path = '/' }) {
  return serializeCookie(name, '', { maxAgeSeconds: 0, sameSite, path });
}

module.exports = { parseCookies, parseCookieValues, serializeCookie, clearCookie };
