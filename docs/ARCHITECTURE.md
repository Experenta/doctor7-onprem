# Architecture

This page names the parts of doctor7-onprem, how a request moves through them, and
the decisions behind the design. Setting names are listed in `docs/OPERATIONS.md`.
This page gives no values and no real host names.

## Purpose

doctor7-onprem rebuilds the hosted Doctor7 service for on-premise use. A clinic runs
it on a Debian server with Apache and MariaDB, and no container runtime is used. Video
is a replaceable part: the clinic picks Google Meet or Jitsi in the configuration, and
if a Meet meeting fails, the API creates the meeting in Jitsi and reports the provider
it used.

## Nodes

A node here is a part that runs on its own machine or service. The reference install
is one Debian server for the site and the API. MariaDB runs on that server or on its
own service, as the administrator chooses. A Jitsi server is optional.

| Node | What runs | Where it is described |
| --- | --- | --- |
| Browser | The web application, a React single-page app built with Vite. It calls only `/api` and `/ws` on the site host. | `web/`, `docs/API.md` |
| Site host | Apache 2.4 with TLS. It serves the static files, proxies `/api/` and `/ws` to the API, and sends the security headers. | `docs/OPERATIONS.md`, `packaging/web/` |
| API | Node.js 22 service `doctor7-api.service`, listening on `127.0.0.1`. It runs as the `doctor7` user with systemd sandboxing. A timer deletes old chat messages once a day. | `docs/OPERATIONS.md`, `docs/API.md` |
| Database | MariaDB, with one database and one application account. It holds centers, users, appointments, consultations, chat messages, sessions, and the audit log. | `api/migrations/`, `docs/AUDIT.md` |
| Identity provider | The clinic's OpenID Connect provider. The demo uses a mock provider on the demo host. The mock accepts any account without a password. | `docs/API.md`, `docs/DEMO.md` |
| Google Meet | The Google Meet API, called from the API with a service account. The demo uses a simulator in `tools/mock-google/`. | `docs/VIDEO.md` |
| Jitsi server | A self-hosted Jitsi installation. The API builds the meeting address and can sign a token for it. The API never connects to the Jitsi server. The verified Jitsi install ran on its own Debian 13 virtual machine. | `docs/VIDEO.md`, `docs/PORTS.md`, `docs/DEMO.md` |

Operator tools: `doctor7-backup` and `doctor7-restore` run as root on the API host, for
the four backup layers. `seed/load.js` loads a JSON export into the database.
`scripts/smoke.js` runs the end-to-end check from a shell after each deployment.

## Data flow

### Sign-in

1. The browser opens `/api/auth/login`. The API stores a login attempt for 10 minutes,
   with a random state, a nonce, and a PKCE verifier. It sets a short-lived binding
   cookie and redirects to the identity provider.
2. The provider redirects the browser to `/api/auth/callback` with a code and the state.
3. The API checks that the state exists, has not been used or expired, and belongs to
   this browser. It then exchanges the code and verifies the ID token: signature,
   issuer, audience, expiry, nonce, and `email_verified` set to `true`.
4. The API looks up the verified email in the `users` table. Without a row, it refuses
   the sign-in.
5. The API opens a session. The cookie holds a random token with `HttpOnly`, `Secure`,
   and `SameSite=Strict`. The database keeps only the SHA-256 digest of the token.

Source: `docs/API.md`, `docs/AUDIT.md`.

### Reads and writes of records

1. Apache forwards `/api/...` to the API and removes the prefix.
2. The API checks, in this order: the origin of state-changing requests, the content
   type of `POST`, `PUT`, and `PATCH`, the route rule, the session, the role, and the
   record itself.
3. The handler reads or writes MariaDB with parameterized queries.
4. The audit entry is written before the response is sent. If that write fails, the
   request fails with `500` and returns no data.

Source: `docs/AUTHORIZATION.md`, `docs/SECURITY.md`, `docs/AUDIT.md`.

### Chat

The browser opens a WebSocket at `/ws?appointment=<id>`. The API accepts it only for
the professional or the client of a scheduled appointment in the caller's center. Each
message is stored in the `chat_messages` table and then sent to every open connection
of that appointment. The API checks the session and the access of open connections every
30 seconds.

Source: `docs/API.md`.

### Video meeting

1. The professional calls `POST /appointments/:id/meeting`.
2. With `VIDEO_PROVIDER=meet`, the API asks Google Meet for a space. If Meet times out,
   hits its quota, or fails, the API writes a `meeting.failover` audit entry and creates
   a Jitsi meeting.
3. The response names the provider that created the meeting and gives its address. The
   response has `Cache-Control: no-store`.
4. A Meet address opens in a new browser tab. A Jitsi address is embedded in an iframe,
   and the content policy allows only the Jitsi origin.

Source: `docs/VIDEO.md`, `docs/API.md`.

### Packages and upgrades

The build script `packaging/build-deb.js` produces `doctor7-api`, `doctor7-web`, and
`doctor7-demo`. The demo package is built on its own. The upgrade script backs up every
layer before it installs the new packages, runs the migrations, and checks `/readyz`.
The rollback script installs the older packages.

Source: `docs/OPERATIONS.md`.

## Decisions

| Decision | Reason | Where |
| --- | --- | --- |
| No containers. Debian packages, systemd units, and an Apache virtual host. | The product runs on one Debian server with Apache and MariaDB, without containers. | `.kiro/steering/tech.md`, `docs/OPERATIONS.md` |
| The video provider is a configured adapter with one interface, used by both Meet and Jitsi. | The clinic picks the provider. The application code does not depend on one provider. | `docs/VIDEO.md` |
| The failover runs on each request and stores nothing. A meeting that exists is never moved. | Each request tries Meet first. Nothing is kept between requests, so the outcome is easy to audit. | `docs/VIDEO.md` |
| Meet opens in a new tab and is never embedded. Jitsi is embedded in an iframe. | The frontend rules set this split. The content policy allows the Jitsi origin only. | `.kiro/steering/frontend-design.md`, `docs/SECURITY.md` |
| Deny by default. A route with no rule answers `403`. | A new route stays closed until someone writes its rule. | `docs/AUTHORIZATION.md` |
| Three checks on each request: route rule, role, and the record itself. | A role alone does not show that a user may read one record of their own center. | `docs/AUTHORIZATION.md` |
| Sign-in through OpenID Connect. The API stores no passwords. | The clinic keeps its own identity provider. The mock provider exists for the demo and the tests only. | `docs/API.md` |
| Server-side sessions with a stored digest of the token. | A copy of the sessions table holds no usable session token. | `docs/API.md` |
| Audit log in an append-only table, with no update or delete in the code. | The record of who did what must not change. The database grant is also restricted, as described in the audit document. | `docs/AUDIT.md` |
| Chat messages kept in MariaDB and deleted after `CHAT_RETENTION_DAYS` (default 90) by a daily timer. | Chat history has a fixed limit, set in the settings. | `docs/OPERATIONS.md`, `docs/API.md` |
| Settings come from the environment, read from an `EnvironmentFile` owned by root. The repository holds names, not values. | Secrets do not enter the repository. | `docs/OPERATIONS.md`, `CLAUDE.md` |
| Every request body and query string passes a fixed schema. Unknown keys are refused. | A client cannot set fields such as the center. | `docs/SECURITY.md` |
| The seed loader is idempotent. It never updates or deletes a row. | A repeated load changes nothing, and a conflict keeps the stored row. | `docs/MIGRATION.md` |

## Known gaps

These gaps are described in the documents named in each row. They are not fixed.

- A chat audit entry records the socket address. Behind Apache that is the proxy
  address, not the client. `docs/AUDIT.md`.
- The audit log has no retention job. Entries stay until someone removes them by hand.
  `docs/AUDIT.md`.
- The application database account can be restricted so it cannot change the audit
  table. A database administrator can still change it. `docs/AUDIT.md`.
- The backup `files` layer is empty today, because the API does not write to
  `/var/lib/doctor7`. `docs/OPERATIONS.md`.
- Jitsi media uses UDP port 10000. When a client network blocks UDP, the fallback on TCP
  port 4443 is needed, and the verified Jitsi install does not open that port.
  `docs/PORTS.md` and `docs/DEMO.md` describe it.

## Verification status

The Jitsi install was checked on its own Debian 13 virtual machine. The meeting room
page loads over HTTPS, four services are active, and the API creates a meeting and
embeds it in an iframe (`docs/DEMO.md`, Node 3). A real audio and video call between
two participants has not been verified. The demo uses the Google Meet simulator, so no
real Meet call has been made.

How the project was built and which checks were run by people is in
`docs/HOW-WE-USED-KIRO.md`.
