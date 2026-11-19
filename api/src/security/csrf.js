'use strict';

const { ApiError } = require('../http/errors');

// Origin check for requests that change state. It adds to SameSite=Strict on
// the session cookie and to the JSON content type that the authorization gate
// requires.
//   - Origin present: it must be in the allowed list.
//   - Origin absent: a browser that says the request is cross-site or same-site
//     (not same-origin) is refused. A client that sends neither header is not a
//     browser, has no ambient cookie to abuse, and still needs a session.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REFUSED_FETCH_SITES = new Set(['cross-site', 'same-site']);

function createCsrfGuard({ allowedOrigins = [] } = {}) {
  const allowed = new Set(allowedOrigins);
  const refusal = () => new ApiError(403, 'csrf_rejected', 'This request came from an origin that is not allowed.');

  return function csrfGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      next(typeof origin === 'string' && allowed.has(origin) ? undefined : refusal());
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && REFUSED_FETCH_SITES.has(site.trim().toLowerCase())) {
      next(refusal());
      return;
    }
    next();
  };
}

module.exports = { createCsrfGuard };
