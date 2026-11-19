# K-14 Requirements: end-to-end smoke test and health endpoints

Status: in progress. Depends on K-05 (API), K-06 (video), K-07 (appointments and
consultations), and K-09 (synthetic seed). K-08 (interface) is needed only for the
interface check, which this task does not add.

## Background

The API already has the probes `GET /healthz` (liveness, no database) and
`GET /readyz` (reads the database), documented in `docs/API.md`. The demo instance
runs on a Debian server behind Apache, with `/api` for the API, `/idp` for the mock
identity provider, and `/ws` for the chat. Nothing checks the whole flow after a
deployment. This task adds that check as a script with two modes: in process (run
by the tests) and remote (run by the project manager on the virtual machine after a
deployment).

## Requirements

### R1. Health and version endpoints

- R1.1 `GET /healthz` answers `200 {"status":"ok"}` and never touches the database.
- R1.2 `GET /readyz` answers `200 {"status":"ready"}` when `SELECT 1` succeeds, and
  `503 database_unavailable` otherwise.
- R1.3 `GET /version` answers `200` with exactly two fields:
  - `version`: the version of the API package (`api/package.json`).
  - `buildDate`: the build date as an ISO 8601 UTC instant, from the environment
    variable `BUILD_DATE`, or `null` when the variable is unset or not a valid
    instant. The endpoint returns no other value.
- R1.4 The three probes are public, outside the authorization gate, and not rate
  limited, as the probes already are.

### R2. Smoke flow

The smoke runs seven steps in this order. Each step names its result.

1. `sign-in`: signs in the four demo accounts through the mock identity provider.
   Each account is checked with `GET /auth/me` for its role. Then the two refusals
   are checked: `no.role@example.test` must get `403`, and `pending@example.test`
   must get `401`, and neither may open a session.
2. `appointment`: the professional creates an appointment with the client as the
   participant. The response has status `scheduled`.
3. `video meeting`: the professional creates the video meeting of the appointment.
   The provider is `meet` or `jitsi`. A Google failure must end in a Jitsi meeting,
   so either provider passes.
4. `chat`: the professional and the client open the chat WebSocket. The professional
   sends a message. Both participants receive it with the professional as sender.
5. `consultation create`: the professional creates a consultation record on the
   appointment. Its note starts with `smoke-`.
6. `consultation read`: the professional reads the record back and the note matches.
7. `audit`: the auditor reads `GET /audit`. In write mode the entries of the run are
   found: `appointment.create`, `consultation.create`, and the `meeting.create_*`
   entry of step 3.

### R3. Modes

- R3.1 In process (the default): the script starts the API, the mock identity
  provider, and the mock Google in one process, with in-memory stores filled from
  the synthetic seed generator (`seed/lib/generator.js`). No environment variable
  is read for the connection.
- R3.2 Remote (`--remote`): the script tests the instance at `SMOKE_BASE_URL`. The
  API is under `SMOKE_API_PREFIX` (default `/api`). The chat stays at `/ws`. The
  identity provider needs no prefix setting, because the API gives its absolute
  address in the redirect.
- R3.3 `--remote` without `SMOKE_BASE_URL` stops with a configuration error that
  names the variable. `SMOKE_BASE_URL` without `--remote` also stops, so a remote
  run cannot silently become an in-process run.
- R3.4 `SMOKE_READ_ONLY=1` runs only the steps that read: step 1, the listing and
  reading of an appointment in step 2, and step 7. Steps 3 to 6 are reported as
  `SKIP`. Without this variable, or with `0`, the run is a write run.
- R3.5 Write runs create one appointment, one meeting, one message, and one
  consultation record. The note and message text start with `smoke-`, and the
  output says so.

### R4. Sign-in without a browser

- R4.1 The script follows the redirects by hand, with its own cookie store. Each
  account has its own store. A cookie is sent only to the host that set it, and only
  on paths that match its `Path` attribute, as a browser does.
- R4.2 The cookies are `Secure` in production. The store keeps them anyway, so the
  in-process run over loopback HTTP works.
- R4.3 The script submits the account on the identity provider form. It picks the
  account by its e-mail address in the page, and it reads the form action and the
  hidden fields from the page.

### R5. Origin and content type

- R5.1 Every state-changing request (POST) sends `Origin` equal to the site origin
  (`SMOKE_BASE_URL`, or the local origin in process mode). The API refuses other
  origins (K-12).
- R5.2 JSON bodies are sent with `Content-Type: application/json`.

### R6. Chat

- R6.1 The chat uses the `ws` package from `api/`. Nothing is installed. The package
  is resolved from the `api/` directory.
- R6.2 The WebSocket handshake sends the session cookie and `Origin`.

### R7. Output and exit codes

- R7.1 One line per step: `OK`, `FAIL`, or `SKIP`, the step number and name, and a
  short result. A blocked step prints `FAIL` with the step that blocked it. The labels
  are English because all public text is English (CLAUDE.md, rule 4). The task text
  said `FALLO`.
- R7.2 The last line is the result: `Result: PASS` or `Result: FAIL`, with counts.
- R7.3 The output never holds a cookie, a token, an e-mail address, a URL, or a
  response body. It may hold the mode, the step names, HTTP status codes, API error
  codes, and resource identifiers (for example the appointment id).
- R7.4 Exit codes:
  - `0`: every step that ran passed.
  - `1`: at least one step failed or was blocked.
  - `2`: the script could not run: a configuration error, or the local stack did not
    start. No step ran.

### R8. In-process failure injection

- R8.1 `--google-mode=<mode>` (process mode only) sets the mock Google mode. For
  example `http_500` makes Meet fail, so the meeting falls back to Jitsi.
- R8.2 `--no-video-provider` (process mode only) starts the API without a video
  provider. The meeting step then fails with `503 video_not_configured`.
  See design decision D3 for why this stands in for "Google down without Jitsi".

### R9. Tests

- R9.1 A test runs the full process mode and expects exit code `0` and seven `OK`
  lines.
- R9.2 A test breaks the video step and expects exit code `1`, a `FALLO` line that
  names the video meeting step, and `OK` lines for the steps that do not depend on it.
- R9.3 A test shows that a Meet failure falls back to Jitsi, and the run passes.
- R9.4 A test shows that the output has no cookie, token, e-mail, or URL, for a pass
  and for a failure.
- R9.5 Tests cover the configuration errors of R3.3, invalid values, and the remote
  path against the local stack.
- R9.6 Tests cover the health and version endpoints (R1) in `api/src/http/health.test.js`.

### R10. Documentation

- R10.1 `docs/SMOKE.md` explains both modes, the variables by name, the exit codes,
  the read-only mode, the rate limit on sign-in, and the Apache cookie rule that the
  remote mode depends on.

## Out of scope

- Installing dependencies, calling external services, or running the remote mode
  from this task. The project manager runs it on the virtual machine.
- Changing an API contract. `/version` is an addition.
- Changing `docs/API.md`, `api/src/app.js`, `api/src/config.js`, or the simulators.
  Their gaps are reported in the run report.
- Storing or printing cookies, tokens, e-mail addresses, or keys.
- Real patient data. The data is synthetic.
