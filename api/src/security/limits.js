'use strict';

const { rateLimit } = require('express-rate-limit');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MESSAGE = Object.freeze({
  error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
});

function limiter({ windowMs, limit }, extra = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: MESSAGE,
    ...extra,
  });
}

// Limit per client IP for the sign-in routes. Counts every method.
function createLoginLimiter(options) {
  return limiter(options);
}

// Limit per signed-in user for state-changing routes. Mount it after the
// authorization gate, which sets req.auth. The key is the user id, so a user
// who reaches the limit does not affect another user.
function createWriteLimiter(options) {
  return limiter(options, {
    skip: (req) => SAFE_METHODS.has(req.method) || !req.auth,
    keyGenerator: (req) => `user:${req.auth.user.id}`,
  });
}

module.exports = { createLoginLimiter, createWriteLimiter };
