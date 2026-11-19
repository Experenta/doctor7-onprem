# doctor7-onprem API contract

This document lists every HTTP endpoint of the API, with its method, path,
allowed roles, and an example. Clients and the front end depend on it.

Status: skeleton. The two probe endpoints and the sign-in endpoints exist. Later
tasks add the domain endpoints and fill in the allowed roles for them.

## Conventions

- Format: JSON in UTF-8. Send request bodies with `Content-Type: application/json`.
- Timestamps: ISO 8601 in UTC with milliseconds, for example `2026-11-19T03:26:00.123Z`.
- Errors: every error response has this shape:

  ```json
  {"error":{"code":"not_found","message":"Route not found."}}
  ```

  Responses never include stack traces, SQL text, or database driver messages.
- Pagination: list endpoints accept `limit` (default 50, maximum 200) and
  `offset` (default 0).
- Rate limit: 120 requests per client IP per 60 seconds by default. Set
  `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` to change it. The probe endpoints
  `/healthz` and `/readyz` are not rate limited. A request over the
  limit gets `429` with code `rate_limited`.
- Security headers: every response carries the headers set by helmet, including
  `Content-Security-Policy`, `Strict-Transport-Security`, and
  `X-Content-Type-Options: nosniff`. The `X-Powered-By` header is removed.
- Roles: the values stored in `users.role` are `professional`, `client`,
  `admin`, and `auditor`.

## Endpoints

| Method | Path | Allowed roles | Description |
|---|---|---|---|
| GET | `/healthz` | Public, no authentication | Liveness. Returns `ok` without querying the database. |
| GET | `/readyz` | Public, no authentication | Readiness. Returns `503` when the database does not answer `SELECT 1`. |
| GET | `/auth/login` | Public | Starts sign-in. Redirects to the identity provider. |
| GET | `/auth/callback` | Public | Finishes sign-in. Opens a session and redirects. |
| POST | `/auth/logout` | Public (acts on the caller's own session) | Ends the current session, or all sessions of the user. |
| GET | `/auth/me` | Any signed-in role | Returns the signed-in user. |

### GET /healthz

Request:

```sh
curl -i http://127.0.0.1:3000/healthz
```

Response `200`:

```json
{"status":"ok"}
```

### GET /readyz

Request:

```sh
curl -i http://127.0.0.1:3000/readyz
```

Response `200`:

```json
{"status":"ready"}
```

Response `503` when the database is down:

```json
{"error":{"code":"database_unavailable","message":"Database is not reachable."}}
```

## Authentication

Sign-in uses OpenID Connect, authorization code flow with PKCE (S256). The API
stores no passwords. In development the identity provider is the mock server in
`tools/mock-idp/`. In production, set the `OIDC_*` variables to point at the real
provider. The application code does not change.

The `/auth` routes exist only when `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and
`OIDC_REDIRECT_URI` are all set. Otherwise they answer `404`.

### Sessions

- After a successful callback the API sets a session cookie (`d7_session` by
  default) with `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`. The cookie
  holds a random token. The database stores only its SHA-256 digest, in the
  `sessions` table.
- A session ends at the first of: the absolute limit, the idle limit, or
  revocation. Each authenticated request resets the idle timer.
- Role and center are read from the `users` table on every request, matched on
  the verified email. The match is exact and case-sensitive, like the column. A
  verified email with no `users` row is denied. Changing or deleting the row
  affects the next request.
- Send `Cookie` from the browser. Cross-site requests do not carry the cookie
  because of `SameSite=Strict`.

### GET /auth/login

Creates a login attempt (random `state`, `nonce`, and PKCE verifier, kept on the
server for 10 minutes) and answers `302` with a `Location` that points at the
provider's authorization endpoint. It also sets a short-lived binding cookie
(`d7_login`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/auth`) that ties the
callback to the same browser. That cookie is `Lax` because the callback arrives
as a navigation from the provider.

Errors: `502 identity_provider_unavailable` when the provider cannot be reached.

### GET /auth/callback

The provider redirects the browser here with `code` and `state`. The API checks,
in this order: the `state` exists and has not been used (it is deleted when read),
it has not expired, and the binding cookie belongs to it. It then exchanges the
code with the PKCE verifier, and verifies the ID token signature, issuer,
audience, expiry, and `nonce`. The token must have `email_verified` set to
`true`. On success it sets the session cookie and answers `302` to
`AUTH_POST_LOGIN_PATH` (default `/`). The ID token and code never appear in a
response.

| Status | Code | Cause |
|---|---|---|
| 400 | `invalid_login_request` | `state` is missing, unknown, used, expired, or does not match the browser. |
| 401 | `login_failed` | The provider returned an error, the code exchange failed, or the token failed a check (signature, expiry, audience, nonce, unverified email). |
| 403 | `access_denied` | The email is verified but has no row in `users`. |
| 502 | `identity_provider_unavailable` | The provider cannot be reached. |

The response never says which check failed. The server log records a fixed reason
code, without tokens or emails.

### POST /auth/logout

Ends the session named by the cookie and clears the cookie. With the JSON body
`{"all": true}` it ends every session of that user, on all devices. For `all`, the
cookie must belong to a live session. Otherwise only the named session is ended.
It answers `204` with no body, also when there was no session.

```sh
curl -i -X POST http://127.0.0.1:3000/auth/logout \
  -H 'Content-Type: application/json' \
  -b 'd7_session=<token>' \
  -d '{"all":true}'
```

### GET /auth/me

Returns the signed-in user. Roles: any.

Response `200`:

```json
{
  "user": {
    "id": "u-ana",
    "email": "ana.rivera@example.test",
    "displayName": "Ana Rivera",
    "role": "professional",
    "centerId": "center-1"
  },
  "session": {
    "expiresAt": "2026-11-19T11:26:00.123Z",
    "idleExpiresAt": "2026-11-19T03:56:00.123Z"
  }
}
```

`expiresAt` is the absolute limit. `idleExpiresAt` moves forward with activity.
The session ends at whichever comes first. `centerId` is `null` for accounts that
are not tied to a center.

Response `401` when there is no live session:

```json
{"error":{"code":"unauthenticated","message":"Sign-in is required."}}
```

### Settings

Names only. Values come from the environment and are never stored in the
repository.

| Variable | Required | Meaning |
|---|---|---|
| `OIDC_ISSUER` | Yes | Provider base URL. Discovery is read from `/.well-known/openid-configuration`. Must be `https`, or `http` on a loopback host. |
| `OIDC_CLIENT_ID` | Yes | Client identifier registered at the provider. |
| `OIDC_REDIRECT_URI` | Yes | Absolute URL of `/auth/callback`, as registered at the provider. |
| `OIDC_CLIENT_SECRET` | No | Sent in the code exchange when the provider requires it. |
| `OIDC_SCOPE` | No | Default `openid email profile`. |
| `SESSION_ABSOLUTE_TTL_SECONDS` | No | Default 28800 (8 hours). |
| `SESSION_IDLE_TTL_SECONDS` | No | Default 1800 (30 minutes). |
| `SESSION_COOKIE_NAME` | No | Default `d7_session`. |
| `AUTH_POST_LOGIN_PATH` | No | Default `/`. Must start with a single `/`. |
| `TRUST_PROXY` | No | Number of reverse proxies in front of the API, default 0. Use 1 behind Apache so the rate limit sees the client IP. |

### Mock identity provider

`node tools/mock-idp/server.js` starts it on `127.0.0.1:4010`. It lists synthetic
users on a login page and signs tokens with a key created at start. It is for
development and tests only. Its settings are `MOCK_IDP_PORT`,
`MOCK_IDP_CLIENT_ID`, and `MOCK_IDP_REDIRECT_URIS`.

## Error codes

| HTTP status | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | The request body is not valid JSON. |
| 400 | `invalid_login_request` | The sign-in callback failed a state or browser check. |
| 401 | `unauthenticated` | A signed-in session is required and none is live. |
| 401 | `login_failed` | Sign-in did not complete. See `/auth/callback`. |
| 403 | `access_denied` | The verified email has no account in `users`. |
| 403 | `forbidden` | The signed-in role may not use this resource. |
| 404 | `not_found` | No route matches the path. |
| 413 | `payload_too_large` | The request body is larger than 100 KB. |
| 429 | `rate_limited` | The client exceeded the rate limit. |
| 500 | `internal_error` | An unexpected failure. The details are in the server log only. |
| 503 | `database_unavailable` | The database did not answer the readiness check. |
| 502 | `identity_provider_unavailable` | The identity provider could not be reached. |
