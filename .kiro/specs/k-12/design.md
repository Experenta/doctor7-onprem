# K-12 Design

## Modules (`api/src/security/`)

| File | Contents |
| --- | --- |
| `config.js` | `loadSecurityConfig(env, { redirectUri, jitsiBaseUrl })`. Returns `{ allowedOrigins, jitsiOrigin, loginLimit, writeLimit }`. |
| `csrf.js` | `createCsrfGuard({ allowedOrigins })`. |
| `headers.js` | `createSecurityHeaders({ allowedOrigins, jitsiOrigin })`. Returns middleware: helmet with an explicit policy, plus `Permissions-Policy`. |
| `limits.js` | `createLoginLimiter`, `createWriteLimiter`. |
| `validate.js` | Schema builders, `check`, `parse`, `validateRequest`. |
| `schemas.js` | One schema per route input. |

## CSRF

Placed after the probes and the global rate limit, before the body parser.

1. Safe methods (GET, HEAD, OPTIONS) pass.
2. `Origin` present: normalized and compared with the list. Not in the list: 403.
3. `Origin` absent: `Sec-Fetch-Site` of `cross-site` or `same-site` is 403.
   Anything else passes. A client with neither header is not a browser. It has
   no ambient cookie to abuse, and the session check still applies.

This is on top of `SameSite=Strict` and the JSON content type (415) that the
gate enforces. The WebSocket handshake keeps its own check.

## Headers

Helmet runs with `useDefaults: false` for the policy, so no `unsafe-inline` can
come from a default:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self' <ws form of each allowed origin>;
frame-src <jitsi origin | 'none'>; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'
```

Other headers: HSTS (one year, includeSubDomains), `nosniff`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, and
`Permissions-Policy: camera=(self "<jitsi>"), microphone=(self "<jitsi>"),
geolocation=()`. Without Jitsi the allow list holds `self` only.

Apache sets the same headers on static files (the API does not serve them).
`docs/SECURITY.md` lists them.

## Rate limits

- Login limiter: key is the client IP (`trust proxy` applies). Mounted on
  `/auth/login` and `/auth/callback` inside the sign-in block.
- Write limiter: mounted after the authorization gate, so `req.auth` is set.
  Key is `req.auth.user.id`. It skips safe methods.
- The global limiter stays as it is.

## Validation

A schema is `{ expect, check(value, ctx) }` and `check` returns `{ ok, value }`
or `{ ok: false, message }`. The builders are `string`, `id`, `timestamp`,
`integer`, `integerText` (query digits), `boolean`, `oneOf`, `jsonObject`,
`object`, and `optional`. `object` builds a fresh result with only the known
keys, so no unknown key and no `__proto__` reaches a handler.

Messages are built from schema field names and fixed text. They never include
input, not even key names.

`validateRequest({ query, body })` runs in the route chain and sets
`req.valid`. Every route has one. Routes that take no input use `noQuery` or
`emptyBody`.

Exceptions that keep the existing contract:

- A path id that fails the `id` schema stays an audited 404 with reason
  `invalid_id` (care and video routes). The 404 is the documented answer that
  stops id probing, and existing tests rely on it.
- `/auth/callback` validates its query inside the handler with `check`, because
  a refusal there must be audited and use the sign-in error code. Allowed keys:
  `state`, `code`, `error`, `error_description`, `error_uri`, `iss`,
  `session_state` (identity providers add these).

## Errors

`createErrorHandler` keeps the fixed shape. Added: a body-parser client error
(`unsupported charset`, `unsupported encoding`, aborted request) maps to a fixed
400 or 415 text instead of a logged 500. Driver errors stay 500 with the generic
message.

## Production startup

`loadConfig` throws `NODE_ENV=production requires sign-in...` when `auth.enabled`
is false. `video/config.js` drops the `Got ...` suffix.

## Wiring

`server.js` is not in this task's scope and does not pass `security` to
`createApp`. `createApp` therefore reads `security` from its option, or else
from `process.env` (the same fallback that video already uses). `loadConfig`
also builds `config.security`, which validates the variables at startup.
