'use strict';

const helmet = require('helmet');

// Security headers for every API response. The content policy is written out
// in full (no helmet defaults), so no 'unsafe-inline' or 'unsafe-eval' can come
// from a default. docs/SECURITY.md lists the headers that Apache repeats.

// The WebSocket origin that matches an allowed origin.
function socketOrigin(origin) {
  return origin.replace(/^http/, 'ws');
}

function buildContentPolicy({ allowedOrigins = [], jitsiOrigin = null } = {}) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'", ...allowedOrigins.map(socketOrigin)],
    frameSrc: jitsiOrigin ? [jitsiOrigin] : ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
}

// Camera and microphone: this origin and the Jitsi origin only.
function buildPermissionsPolicy({ jitsiOrigin = null } = {}) {
  const allow = jitsiOrigin ? `(self "${jitsiOrigin}")` : '(self)';
  return `camera=${allow}, microphone=${allow}, geolocation=()`;
}

// Returns an array of middleware for app.use.
function createSecurityHeaders(options = {}) {
  const permissions = buildPermissionsPolicy(options);
  return [
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: buildContentPolicy(options) },
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
    }),
    function permissionsPolicy(req, res, next) {
      res.setHeader('Permissions-Policy', permissions);
      next();
    },
  ];
}

module.exports = { createSecurityHeaders, buildContentPolicy, buildPermissionsPolicy };
