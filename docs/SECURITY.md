# Security

This page lists the threats the API and the web client defend against, the
defense for each, and the settings. Authentication and authorization are
described in `docs/AUTHORIZATION.md` and `docs/API.md`.

## Threats and defenses

| Threat | Defense |
| --- | --- |
| A page on another site makes the browser send a state-changing request with the session cookie (CSRF). | `SameSite=Strict` on the session cookie. The authorization gate requires `Content-Type: application/json` (415). An origin check refuses the request with 403 `csrf_rejected` when `Origin` is not in `ALLOWED_ORIGINS`. |
| Injected script or style, framing, MIME sniffing, referrer leaks, unwanted camera access. | Content policy without `unsafe-inline` and `unsafe-eval`, and the headers below. |
| Brute force of the sign-in routes. One account flooding the write routes. | Per-route rate limits. |
| Malformed or oversized input, or input echoed back. | Every body and every query string of every route passes a validator. A failure is 400 and the message never repeats the input. |
| Error responses that reveal internals. | One fixed error shape. Driver errors and stack traces go to the log only. |
| A production server that starts without sign-in. | `NODE_ENV=production` stops startup without the `OIDC_*` settings. |
| A client bundle that calls an outside server or uses inline script or style. | The test `web/test/external-requests.test.js` builds the client and checks the output. |

## Session cookie

When a request carries several `d7_session` cookies (for example an old one with `Path=/api/` next to the current `Path=/`), the API tries each value in order until a live session is found, checking every value fully, and answers 401 only when none is live. Sign-in and logout also delete the legacy `Path=/api/` cookie.

## Origin check

Applies to every method except GET, HEAD, and OPTIONS. It runs before the body
is read and before the session check.

1. `Origin` present: it must be exactly one of the allowed origins (scheme, host,
   and port). `Origin: null` is refused.
2. `Origin` absent: `Sec-Fetch-Site` of `cross-site` or `same-site` is refused.
   `same-origin`, `none`, or no header passes. A request with neither header is
   not from a browser. It has no ambient cookie, and it still needs a session.

The chat WebSocket handshake keeps its own check (the host of `Origin` must be
the `Host`).

The demo-only Meet outage switch (`/demo/meet-outage`, `docs/DEMO.md`) is not mounted unless the API
starts with `DEMO_MODE=1`, so a production server has no route, no gate rule, and no client for the
simulator. With it on, only an administrator can use it, and it speaks to the simulator over loopback
with a shared secret that is kept in the settings file and never in the repository.

## Headers

The API sends these on every response, including errors and the probes:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <wss form of each allowed origin>; frame-src <Jitsi origin or 'none'>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(self "<Jitsi origin>"), microphone=(self "<Jitsi origin>"), geolocation=()`. Without Jitsi: `self` only. |
| `Cross-Origin-Opener-Policy` | `same-origin` |

The Jitsi origin is the origin of `JITSI_BASE_URL`.

### Headers Apache must repeat

Apache serves the static files, so the API headers do not reach the HTML. The
virtual host (`packaging/web/etc/apache2/sites-available/doctor7.conf`) must set
these on every response, with `Header always set`:

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy` with camera and microphone for `self` and the Jitsi origin
- `Cross-Origin-Opener-Policy: same-origin`

And on HTML files, `Content-Security-Policy` with the same directives as above,
where `connect-src` carries `wss://` plus the server name and `frame-src`
carries the Jitsi origin. The policy must not contain `unsafe-inline` or
`unsafe-eval`. The client has no inline script and no inline style, so none is
needed.

## Rate limits

| Limit | Key | Default | Settings |
| --- | --- | --- | --- |
| All routes except the probes | client IP | 120 per minute | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` |
| `/auth/login` and `/auth/callback` | client IP | 20 per 15 minutes | `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS` |
| POST, PUT, and PATCH on protected routes | signed-in user id | 60 per minute | `RATE_LIMIT_WRITE_MAX`, `RATE_LIMIT_WRITE_WINDOW_MS` |

All answer 429 with the code `rate_limited`. Set `TRUST_PROXY=1` behind Apache,
or every client shares the IP of the proxy.

## Input validation

The validators are in `api/src/security/` (`validate.js` and `schemas.js`). A
schema fixes the type, the length, the format, and the allowed keys. A key that
is not in the schema is refused, so a client cannot set a field such as
`centerId`. The message names the field from the schema and never repeats the
received value or key.

A path id that is not a valid id answers 404, the same as a missing record, so a
caller cannot probe ids. The refusal is audited with the reason `invalid_id`.

## Settings

| Variable | Meaning |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated list of origins that may send state-changing requests, such as `https://clinic.example.test`. Each is https, or http on localhost, with no path. Default: the origin of `OIDC_REDIRECT_URI`. For local development, list the Vite origin. |
| `NODE_ENV` | With `production`, the server refuses to start unless `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_REDIRECT_URI` are set. |
| `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS` | Sign-in limit. |
| `RATE_LIMIT_WRITE_MAX`, `RATE_LIMIT_WRITE_WINDOW_MS` | Write limit per user. |

A configuration error names the variable and never prints its value.

## Not covered here

- `npm audit` is run by the project manager.
- The chat WebSocket handshake check, described in `docs/API.md`.
