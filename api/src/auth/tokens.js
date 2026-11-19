'use strict';

const crypto = require('node:crypto');

// Random URL-safe value with 256 bits of entropy.
function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Hex SHA-256. The database stores this digest, never the raw token.
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// PKCE S256 challenge: BASE64URL(SHA-256(verifier)).
function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { randomToken, sha256Hex, pkceChallenge, safeEqual };
