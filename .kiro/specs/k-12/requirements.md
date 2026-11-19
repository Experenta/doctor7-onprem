# K-12 Requirements: security hardening

Scope: the API (`api/src/`) and a check of the built web client. Authentication
and authorization models do not change.

## Threats covered

| Id | Threat | Defense |
| --- | --- | --- |
| T1 | A page on another site makes the browser send a state-changing request with the session cookie (CSRF). | R1 to R3 |
| T2 | Injected script or style, framing, MIME sniffing, leaking referrers, unwanted camera access. | R4 to R6 |
| T3 | Password-less brute force of the sign-in endpoints, or one account flooding write routes. | R7, R8 |
| T4 | Malformed or oversized input reaches business logic or is echoed back (reflected content, log injection). | R9 to R11 |
| T5 | Error responses reveal internals (table names, driver text, stack traces, configuration values). | R12 |
| T6 | A production server starts without sign-in, or an error message repeats a configuration value. | R13, R14 |
| T7 | The built client calls an outside server, or uses inline script or style, which the content policy forbids. | R15 |

## Requirements

- R1. A request with a method other than GET, HEAD, or OPTIONS and an `Origin`
  header that is not in `ALLOWED_ORIGINS` gets 403 (`csrf_rejected`). `Origin:
  null` is not allowed.
- R2. A state-changing request without `Origin` and with `Sec-Fetch-Site` of
  `cross-site` or `same-site` gets 403. `same-origin`, `none`, or no header
  passes the check.
- R3. A state-changing request whose `Origin` is in the list passes this check.
  The list comes from `ALLOWED_ORIGINS` (comma separated origins). When the
  variable is unset and sign-in is configured, the list holds the origin of
  `OIDC_REDIRECT_URI`. An invalid entry stops startup and the message names the
  variable only.
- R4. Every API response has a content policy without `unsafe-inline` and
  without `unsafe-eval`. By default `default-src 'self'`. `frame-src` lists
  only the configured Jitsi origin (or `'none'`). `connect-src` is `'self'` plus
  the `wss:` (or `ws:` for http) form of the allowed origins.
- R5. Every API response has `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
  (camera and microphone for `self` and the Jitsi origin only), and
  `Cross-Origin-Opener-Policy`.
- R6. `docs/SECURITY.md` lists the headers Apache must repeat.
- R7. `/auth/login` and `/auth/callback` have their own limit per client IP,
  stricter than the global limit. Defaults: 20 requests per 15 minutes.
  Settings: `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS`.
- R8. Each authenticated user has a limit on state-changing requests. The limit
  is per user id, so one user reaching it does not affect another. Defaults: 60
  requests per minute. Settings: `RATE_LIMIT_WRITE_MAX`,
  `RATE_LIMIT_WRITE_WINDOW_MS`.
- R9. Every body and every query string of every route passes a validator with
  types, lengths, formats, and allowed keys. A failure is 400 `invalid_request`.
- R10. A 400 message never contains the received value, and never the received
  key name. It names the field of the schema.
- R11. The validators are written in this repository. No new dependency.
- R12. Error responses use only fixed text. A driver or unknown error is 500
  `internal_error`. A client error from the body parser that has no fixed
  mapping is not turned into a 500 and carries no parser text.
- R13. With `NODE_ENV=production`, `loadConfig` throws unless sign-in is
  configured (the three `OIDC_*` variables).
- R14. `api/src/video/config.js` does not repeat the received `VIDEO_PROVIDER`
  value in its error.
- R15. A test reads `web/` and checks that its HTML output has no external
  `http://` or `https://` address, no inline `<script>`, and no `style=`.
- R16. Existing tests keep passing.

## Out of scope

- Authentication model, authorization policy, new services, new dependencies.
- `npm audit` (the PM runs it).
- The WebSocket handshake origin check of the chat (K-07) stays as it is.
