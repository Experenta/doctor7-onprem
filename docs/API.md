# doctor7-onprem API contract

This document lists every HTTP endpoint of the API, with its method, path,
allowed roles, and an example. Clients and the front end depend on it.

Status: skeleton. The two probe endpoints, the sign-in endpoints, and the
appointment and consultation endpoints exist. The access rules are in
`docs/AUTHORIZATION.md`.

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
  `/healthz`, `/readyz` and `/version` are not rate limited. A request over the
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
| GET | `/version` | Public, no authentication | Package version and build date. Returns `buildDate: null` when no build date is known. |
| GET | `/auth/login` | Public | Starts sign-in. Redirects to the identity provider. |
| GET | `/auth/callback` | Public | Finishes sign-in. Opens a session and redirects. |
| POST | `/auth/logout` | Public (acts on the caller's own session) | Ends the current session, or all sessions of the user. |
| GET | `/auth/me` | Any signed-in role | Returns the signed-in user. |
| GET | `/appointments` | `professional`, `client`, `admin` | Lists the appointments the caller may read. |
| GET | `/appointments/:id` | `professional`, `client`, `admin` | Reads one appointment. |
| POST | `/appointments` | `professional`, `admin` | Creates an appointment in the caller's center. |
| POST | `/appointments/:id/meeting` | `professional` of the appointment | Creates the video meeting of an appointment, or returns the one that exists. See `docs/VIDEO.md`. |
| GET | `/appointments/:id/meeting` | `professional` and `client` of the appointment | Reads the stored video meeting of an appointment. See `docs/VIDEO.md`. |
| GET | `/demo/meet-outage` | `admin`, only with `DEMO_MODE=1` | Reads whether the simulated Google Meet outage is on. Demo only. See `docs/DEMO.md`. |
| POST | `/demo/meet-outage` | `admin`, only with `DEMO_MODE=1` | Turns the simulated Google Meet outage on or off. Demo only. |
| POST | `/consultations` | `professional` | Creates a consultation for an appointment of the caller. |
| GET | `/consultations/:id` | `professional`, `client`, `admin` | Reads one consultation. |
| GET (WebSocket upgrade) | `/ws?appointment=<id>` | `professional` and `client` of the appointment | Live chat of one appointment. See the Chat section. |
| GET | `/audit` | `auditor` | Lists audit entries of the caller's center. |

Every route not listed here answers `403`. The role column says which roles can
reach the route. The record itself is checked as well: a professional and a
client see only appointments they take part in, and nobody sees another center.
See `docs/AUTHORIZATION.md`.
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

### GET /version

Request:

```sh
curl -i http://127.0.0.1:3000/version
```

Response `200`:

```json
{"version":"0.0.0+git42.abc1234-1","buildDate":"2026-11-19T06:53:53.715Z"}
```

`version` is the package version, and `buildDate` is the time of the build. The API
reads both when it starts, from the file named by `D7_VERSION_FILE`. The default is
`/usr/lib/doctor7/VERSION`, which the `doctor7-api` package writes. The file has two
lines: `version=` and `build-date=`. See `docs/OPERATIONS.md`, section Build versions.

When the file is missing, `version` is the version of the API `package.json`, and
`buildDate` comes from `BUILD_DATE`. Without a valid `BUILD_DATE`, `buildDate` is
`null`. A file that cannot be read, or that has no version line, is logged once,
and the same fallback applies. The route does not query the database.

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

## Appointments and consultations

These routes need a signed-in session. Without one they answer `401`. They are
only mounted when sign-in is enabled. `POST` bodies must be sent with
`Content-Type: application/json`, otherwise the answer is `415`. Timestamps in
requests must be UTC, such as `2026-12-02T10:00:00.000Z`.

Appointment object:

```json
{
  "id": "5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f",
  "centerId": "center-1",
  "professionalId": "u-ana",
  "clientId": "u-luis",
  "startsAt": "2026-12-02T10:00:00.000Z",
  "endsAt": "2026-12-02T10:50:00.000Z",
  "status": "scheduled",
  "createdAt": "2026-11-19T03:26:00.123Z"
}
```

### GET /appointments

Roles: `professional`, `client`, `admin`. Supports `limit` and `offset`. A
professional gets the appointments where they are the professional, a client the
ones where they are the client, and an admin all of the center. Response `200`:
`{"items":[<appointment>, ...]}`, ordered by `startsAt`. Errors: `400
invalid_request` for a bad `limit` or `offset`, `403` for `auditor` and for a
user without a center.

### GET /appointments/:id

Roles: `professional`, `client`, `admin`. Response `200` with the appointment.
`404 not_found` when the id does not exist, and also when the caller may not read
the appointment, for example one of another center or one the caller does not take
part in. The two cases return the same body, so a caller cannot tell whether an id
exists in another center. The audit log keeps the real reason. An `auditor` gets
`403 forbidden` for every id, because the route does not admit that role.

### POST /appointments

Roles: `professional` (only for themselves) and `admin`. The center is always the
caller's center and cannot be sent.

```sh
curl -i -X POST http://127.0.0.1:3000/appointments \
  -H 'Content-Type: application/json' \
  -b 'd7_session=<token>' \
  -d '{"professionalId":"u-ana","clientId":"u-luis","startsAt":"2026-12-02T10:00:00.000Z","endsAt":"2026-12-02T10:50:00.000Z"}'
```

Response `201` with the appointment, with `status` set to `scheduled`. Errors:
`400 invalid_request` for a missing, unknown, or malformed field or when `endsAt`
is not after `startsAt`. `403 forbidden` when the caller may not create it, or
when `professionalId` or `clientId` is not a user of the caller's center with the
role `professional` or `client`.

### POST /consultations

Roles: `professional`, for an appointment where they are the professional.

```sh
curl -i -X POST http://127.0.0.1:3000/consultations \
  -H 'Content-Type: application/json' \
  -b 'd7_session=<token>' \
  -d '{"appointmentId":"5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f","body":{"note":"synthetic example"}}'
```

`body` is a JSON object. Response `201`:

```json
{
  "id": "0d3c1f52-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  "appointmentId": "5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f",
  "body": {"note": "synthetic example"},
  "createdAt": "2026-12-02T11:00:00.000Z"
}
```

Errors: `400 invalid_request`, `404 not_found` when the appointment does not exist
or the caller may not read it, and `403 forbidden` for a caller who may read the
appointment but may not create a consultation on it. A `client` or an `admin`
sends the request to a route that does not admit their role, so they also get
`403`, whatever the appointment id is.

### POST /appointments/:id/meeting

Roles: the `professional` of the appointment. The call is idempotent. An appointment
has at most one meeting. The first call creates it with the provider set by
`VIDEO_PROVIDER` (`meet` or `jitsi`), stores it, and answers `201`. Every later call
answers `200` with the stored `provider` and `url`, creates no room, and calls no
provider. The request takes no body fields, but it must be sent with
`Content-Type: application/json`. The client does not choose the provider.

```sh
curl -i -X POST http://127.0.0.1:3000/appointments/5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f/meeting \
  -H 'Content-Type: application/json' \
  -b 'd7_session=<token>' \
  -d '{}'
```

Response `201` (first call) or `200` (the meeting already exists), with
`Cache-Control: no-store`:

```json
{"provider":"jitsi","url":"https://jitsi.example.test/doctor70f1e2d3c4b5a69788796a5b4c3d2e1f0","fallback":false,"simulated":false}
```

`fallback` is `true` when `VIDEO_PROVIDER` is `meet` and the meeting is stored with
`provider` `jitsi`, so Jitsi took over from Meet. It comes from the configuration, not from the
database: a Jitsi meeting stored while the server is set to `jitsi` has `fallback: false`, and
the same stored meeting reads `true` after the server is set to `meet`. `simulated` is `true`
only when the API runs with `DEMO_MODE=1` and the meeting is stored with `provider` `meet`,
because the demo uses a simulator in place of Google. A server without `DEMO_MODE` always
answers `simulated: false`. Both fields are also in the `GET` answer.

`provider` is the provider that really created the meeting. It is `jitsi` when
`VIDEO_PROVIDER` is `jitsi`, and also when it is `meet` but Meet failed (error,
time limit, or quota). The failover is recorded in the audit log. A `meet` URL
opens in a separate tab. A `jitsi` URL may be embedded. The URL can contain a
token, so treat it as private. Two simultaneous first calls store one meeting: the
call that loses the race answers `200` with the stored meeting. See `docs/VIDEO.md`.

Errors: `400 invalid_request` when the body has fields. `404 not_found` when the
appointment does not exist or the caller may not read it, with the same body for
both cases. `403 forbidden` for a caller who may read the appointment but may not
create its meeting (an administrator of the center, who is not a participant), and
for the roles `client` and `auditor`. `409 appointment_closed` when the appointment is
`cancelled` or `completed`. Nothing is created. `503 video_not_configured` when
`VIDEO_PROVIDER` is not set and the appointment has no meeting yet.

### GET /appointments/:id/meeting

Roles: the `professional` and the `client` of the appointment.

```sh
curl -i http://127.0.0.1:3000/appointments/5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f/meeting \
  -b 'd7_session=<token>'
```

Response `200`, with `Cache-Control: no-store`, the same body as the `POST`:

```json
{"provider":"jitsi","url":"https://jitsi.example.test/doctor70f1e2d3c4b5a69788796a5b4c3d2e1f0","fallback":false,"simulated":false}
```

This is how the client enters the room that the professional started.

Errors: `404 no_meeting` when the appointment has no meeting yet. `404 not_found`
when the appointment does not exist or the caller may not read it, with the same
body for both cases. An `admin` and an `auditor` get this `404` too, because they do
not take part in the appointment. `401` without a session. Every successful read is
written to the audit log as `meeting.read`. A read that finds no meeting is not
written, because the client asks again every 15 seconds.

### GET /consultations/:id

Roles: `professional` and `client` of the appointment, and `admin` of its center.
Response `200` with the consultation. `404 not_found` when the consultation does
not exist or the caller may not read it. The body is the same for both cases. An
`auditor` gets `403 forbidden`. A successful read is written to the audit log
without the body (see `docs/AUDIT.md`).

### GET /audit

Roles: `auditor`. Lists the audit entries of the auditor's center, newest first.
Each entry records one event, such as a sign-in, a read of a consultation, or a
refused request. No entry contains clinical text. See `docs/AUDIT.md` for the
actions and reason codes.

Query parameters, all optional:

| Parameter | Meaning |
|---|---|
| `from`, `to` | ISO 8601 UTC instants, such as `2026-11-01T00:00:00.000Z`. `from` must not be after `to`. |
| `actorId` | Entries of one user. |
| `action` | Exact action name, such as `consultation.read`. |
| `outcome` | `success`, `denied`, or `failure`. |
| `limit` | Default 50, maximum 200. |
| `offset` | Default 0. |

```sh
curl -i 'http://127.0.0.1:3000/audit?outcome=denied&limit=20' \
  -b 'd7_session=<token>'
```

Response `200`:

```json
{
  "items": [
    {
      "id": "7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b",
      "occurredAt": "2026-11-19T03:26:00.123Z",
      "actorId": "u-luis",
      "centerId": "center-1",
      "action": "consultation.read",
      "targetType": "consultation",
      "targetId": "0d3c1f52-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
      "outcome": "denied",
      "reason": "not_participant",
      "ip": "127.0.0.1"
    }
  ]
}
```

`actorId`, `centerId`, `targetId`, and `reason` are `null` when they do not apply.
Errors: `400 invalid_request` for a bad parameter or for `from` after `to`. `403
forbidden` for any role other than `auditor`, and for an auditor without a center.
`401 unauthenticated` without a live session.

## Demo-only Meet outage switch

These two routes exist only when the API starts with `DEMO_MODE=1`. Without it, the gate
holds no rule for `/demo/meet-outage`, so the path answers `403` like any path without a
rule, signed in or not, and the API never contacts the simulator. A production server does
not set `DEMO_MODE`. See `docs/DEMO.md`.

### GET /demo/meet-outage

Roles: `admin`. The gate admits every role. The handler answers `404 not_found` to the
others, with the same body as a missing record, and writes `demo.read` with outcome
`denied`. `401` without a session.

```sh
curl -i http://127.0.0.1:3000/demo/meet-outage -b 'd7_session=<token>'
```

Response `200`, with `Cache-Control: no-store`:

```json
{"meetOutage":false}
```

`meetOutage` is `true` while the simulator answers `500` to the Meet endpoint. The value comes
from the simulator on each call. `502 demo_simulator_unavailable` when the simulator does
not answer.

### POST /demo/meet-outage

Roles: `admin` only. Every other role gets `403 forbidden` from the gate, and the refusal is
audited as `demo.update`. The body is exactly one boolean, sent as `application/json`.
The usual `Origin` check and the write rate limit apply.

```sh
curl -i -X POST http://127.0.0.1:3000/demo/meet-outage \
  -H 'Content-Type: application/json' \
  -b 'd7_session=<token>' \
  -d '{"meetOutage":true}'
```

Response `200`: `{"meetOutage":true}`. The simulator then answers `500` to the next meeting
creation, so the meeting is created in Jitsi (see `docs/VIDEO.md`). `{"meetOutage":false}`
restores the normal answer. Setting the same state twice is allowed.

Errors: `400 invalid_request` for a missing field, a field that is not a boolean, or any
other field. `415` for a body that is not JSON. `403 csrf_rejected` for a foreign `Origin`.
`429` over the write limit. `502 demo_simulator_unavailable` when the simulator does not
answer, or refuses the shared secret. Each change writes `demo.meet_outage_on` or
`demo.meet_outage_off` to the audit log (see `docs/AUDIT.md`).

## Chat (WebSocket)

Each appointment has one chat between its professional and its client. The chat
runs on a WebSocket at `/ws`, and every message is stored in the `chat_messages`
table. The chat exists only when sign-in is enabled, like the other routes.

### GET /ws

Open the chat with a WebSocket handshake. The browser sends the session cookie
with it, so the client does not handle the token. Use `wss://` in production:

```js
const socket = new WebSocket('wss://clinic.example.test/ws?appointment=5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f');
```

Roles: the `professional` and the `client` of the appointment, in its center. An
administrator of the center, an auditor, or a user of another center is refused,
even though they may read the appointment in other routes.

Refusals happen during the handshake, before the upgrade. The body has the error
shape of the rest of the API.

| Status | Code | Cause |
|---|---|---|
| 400 | `invalid_request` | The `appointment` parameter is missing or empty. |
| 401 | `unauthenticated` | No live session. Nothing is audited. |
| 403 | `forbidden` | The `Origin` header names another host than the `Host` header. |
| 404 | `not_found` | The appointment does not exist, is in another center, or the caller does not take part in it. The body is the same in every case. |
| 410 | `appointment_closed` | The appointment is not `scheduled`, so its chat is closed. |

The `Origin` check stops a page on another site from opening the chat with the
user's cookie. Behind Apache, keep the `Host` header (`ProxyPreserveHost On`), or
every browser handshake is refused.

### Frames

Every frame is JSON text.

The client sends a message:

```json
{"type":"message","body":"Synthetic text for the example"}
```

The server sends the recent history once, right after the handshake. It holds up
to 50 messages of the appointment, oldest first:

```json
{"type":"history","items":[{"id":"0d3c1f52-6a7b-4c8d-9e0f-1a2b3c4d5e6f","appointmentId":"5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f","senderId":"u-ana","body":"Synthetic text","sentAt":"2026-12-02T10:05:00.123Z"}]}
```

The server sends each stored message to every open connection of the appointment,
the sender included:

```json
{"type":"message","message":{"id":"0d3c1f52-6a7b-4c8d-9e0f-1a2b3c4d5e6f","appointmentId":"5b0f6c9e-2d1a-4a56-9d0e-0a1b2c3d4e5f","senderId":"u-ana","body":"Synthetic text","sentAt":"2026-12-02T10:05:00.123Z"}}
```

Errors go to the sender only:

```json
{"type":"error","error":{"code":"message_too_large","message":"The message body must be at most 2000 bytes of UTF-8."}}
```

| Error code | Meaning | Connection |
|---|---|---|
| `invalid_message` | Not JSON, not an object, another field or type, an empty body, or a binary frame. | Stays open. |
| `message_too_large` | The body is over 2000 UTF-8 bytes. Nothing is stored or sent. | Stays open. |
| `appointment_closed` | The appointment is no longer scheduled. | Closes with 4001. |
| `session_ended` | The session was revoked or expired. | Closes with 4002. |
| `access_lost` | The caller may no longer use this chat. | Closes with 4003. |
| `server_error` | The message could not be processed. | Stays open. |

### Ordering and reconnection

The server stores and sends messages of one appointment in one order. `sentAt`
increases from one message to the next. A client that reconnects gets the history
again, so it sees the messages sent while it was away, when they are among the
50 most recent.

### Limits and closing

| Limit | Value |
|---|---|
| Body | 2000 bytes of UTF-8 |
| One frame | 16 KiB. A larger frame closes the connection with 1009. |
| History on connect | 50 messages |
| Checks of open connections | Every 30 seconds |

The server checks the session on each message and on each check of open
connections. Each of those checks counts as activity, so an open chat keeps the
idle timer of the session running. The absolute limit still applies.

| Close code | Meaning |
|---|---|
| 1001 | The server is shutting down. |
| 1009 | The frame is larger than 16 KiB. |
| 4001 | The appointment is closed. |
| 4002 | The session ended or was revoked. |
| 4003 | The caller lost access to the appointment. |

### Retention

`node api/src/chat/purge.js` deletes messages older than `CHAT_RETENTION_DAYS`
days (default 90, from 1 to 3650). It needs `DATABASE_URL`, like the server. Run
it from a timer. Each run writes one `chat.purge` entry. The command prints only
the number of deleted messages. See `docs/AUDIT.md`.

## Error codes

| HTTP status | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | The request body is not valid JSON. |
| 400 | `invalid_request` | A field or query parameter is missing, unknown, or malformed. |
| 400 | `invalid_login_request` | The sign-in callback failed a state or browser check. |
| 401 | `unauthenticated` | A signed-in session is required and none is live. |
| 401 | `login_failed` | Sign-in did not complete. See `/auth/callback`. |
| 403 | `access_denied` | The verified email has no account in `users`. |
| 403 | `forbidden` | The signed-in role or account may not use this resource, or the route has no rule. |
| 404 | `not_found` | No route matches the path, or the record does not exist or is not readable by the caller. |
| 404 | `no_meeting` | The appointment is readable but has no video meeting yet. Only `GET /appointments/:id/meeting` answers it. |
| 409 | `appointment_closed` | The appointment is `cancelled` or `completed`, so a meeting cannot be started. Only `POST /appointments/:id/meeting` answers it. |
| 410 | `appointment_closed` | The appointment is not `scheduled`, so its chat is closed. Only the chat handshake answers it. |
| 413 | `payload_too_large` | The request body is larger than 100 KB. |
| 415 | `unsupported_media_type` | A `POST`, `PUT`, or `PATCH` to a protected route was not sent as `application/json`. |
| 429 | `rate_limited` | The client exceeded the rate limit. |
| 500 | `internal_error` | An unexpected failure. The details are in the server log only. |
| 503 | `database_unavailable` | The database did not answer the readiness check. |
| 503 | `video_not_configured` | `VIDEO_PROVIDER` is not set, so no meeting can be created. |
| 502 | `identity_provider_unavailable` | The identity provider could not be reached. |
| 502 | `demo_simulator_unavailable` | The Google Meet simulator did not answer. Only `/demo/meet-outage` answers it, and only with `DEMO_MODE=1`. |
