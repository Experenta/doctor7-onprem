# End-to-end smoke

`scripts/smoke.js` checks the whole flow of the platform in seven steps: sign-in,
an appointment, a video meeting, a chat message, a consultation record and its
read-back, and an audit read. It runs in two modes. The tests run the in-process
mode. The project manager runs the remote mode on the virtual machine after each
deployment.

## The steps

| # | Step | What it checks |
|---|---|---|
| 1 | sign-in | The four demo accounts sign in through the identity provider and read their role with `/auth/me`. `no.role@example.test` gets `403`, and `pending@example.test` gets `401`. Neither opens a session. |
| 2 | appointment | The professional creates a scheduled appointment with the client. Read-only mode lists the professional's appointments and reads the first one. |
| 3 | video meeting | The professional creates the meeting. Provider `meet` or `jitsi` passes, so a Meet failure that falls back to Jitsi passes too. |
| 4 | chat | The professional sends a message on `/ws`, and both participants receive it. |
| 5 | consultation create | The professional creates a consultation record on the appointment. |
| 6 | consultation read | The professional reads the record back, and the note matches. |
| 7 | audit | The auditor reads `/audit`. In write mode, the entries of this run must be there. |

## Output

One line per step, then the result:

```text
doctor7 smoke: in process, write run
Records created by this run have text that starts with smoke-.
OK   1/7 sign-in: 4 demo roles signed in; 2 refusals as expected
OK   2/7 appointment: appointment <id> created, status scheduled
OK   3/7 video meeting: meeting created, provider meet
OK   4/7 chat: message sent by the professional and read by both participants
OK   5/7 consultation create: consultation record <id> created on appointment <id>
OK   6/7 consultation read: consultation record <id> read back, note matches
OK   7/7 audit: audit log read as auditor, 3 entries of this run found
Result: PASS (7 of 7 steps run passed)
```

- `OK`: the step passed.
- `FAIL`: the step failed, or it did not run because an earlier step it needs failed.
  The line names the failure, such as an HTTP status or an API error code.
- `SKIP`: a write step in read-only mode. A skip is not a failure.

The output never holds a cookie, a token, an e-mail address, or a URL. It holds
statuses, error codes, and record identifiers.

## Running in process

The tests run this mode. It needs no server and no database. It starts the API, the
mock identity provider, and the mock Google in one process, with the synthetic seed
in memory.

```sh
node --test "scripts/**/*.test.js"
node scripts/smoke.js
```

Two flags break a step on purpose, to check that the run fails by name:

| Flag | Effect | Expected result |
|---|---|---|
| `--google-mode=<mode>` | Sets the mock Google mode. `http_500` makes Meet fail. | The meeting falls back to Jitsi, and the run passes. |
| `--no-video-provider` | Starts the API without a video provider. | Step 3 fails with `503 video_not_configured`. Exit code `1`. |

The Google modes are the ones of `tools/mock-google/server.js`: `ok`, `http_400`,
`http_500`, `quota`, `hang`, `no_uri`, and `delegation_denied`.

## Running against a deployed instance

Run this on the virtual machine, after a deployment. Kiro does not run it.

```sh
SMOKE_BASE_URL=https://<host> node scripts/smoke.js --remote
```

The instance needs the synthetic seed of `seed/` (K-09), with the four demo accounts.
The run uses the same origin on every write request, so the API accepts it.

### Variables

Names only. Values stay in the environment of the shell that runs the smoke.

| Variable | Used by | Meaning |
|---|---|---|
| `SMOKE_BASE_URL` | Remote mode (required) | The origin of the site, such as `https://<host>`. `https` is required, except `http` on `localhost`. No path, query, or credentials. |
| `SMOKE_API_PREFIX` | Remote mode | The path where the API sits behind Apache. Default `/api`. Empty means no prefix. The chat is always at `/ws`. |
| `SMOKE_READ_ONLY` | Both modes | `1` runs only the read steps: 1, 2 (list and read), and 7. `0` or unset is a write run. |

The identity provider is found through the redirect that the API gives, so it needs
no variable. The Google keys are made in memory in process mode, and the remote mode
uses none.

### Read-only runs

`SMOKE_READ_ONLY=1` creates nothing. The run signs in, lists and reads one
appointment, and reads the audit log. Steps 3 to 6 print `SKIP`. The demo is shared,
so use this mode when the records must not change.

```sh
SMOKE_BASE_URL=https://<host> SMOKE_READ_ONLY=1 node scripts/smoke.js --remote
```

### Write runs

A write run creates one appointment, one meeting, one chat message, and one
consultation record on the demo. Their text starts with `smoke-`, and the output
says so. Use a read-only run when the records must not change.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every step that ran passed. |
| `1` | A step failed, or a step did not run because an earlier step failed. The output names the step. |
| `2` | The smoke could not run. The message on stderr names the setting. No request was sent, or the local stack did not start. |

Configuration errors that give `2`:

- `--remote` without `SMOKE_BASE_URL`.
- `SMOKE_BASE_URL` without `--remote`. The smoke refuses this so a remote run cannot
  become an in-process run by mistake.
- `SMOKE_BASE_URL` that is not a site origin, or uses plain `http` off `localhost`.
- `SMOKE_API_PREFIX` with a trailing slash.
- `SMOKE_READ_ONLY` with a value other than `0` or `1`.
- An unknown option, or a `--google-mode` value that the mock does not have.
- `--no-video-provider` or `--google-mode` with `--remote`.

## Limits

- **Sign-in rate limit.** One run makes 12 requests to `/auth/login` and
  `/auth/callback`: six sign-ins, two requests each. The API allows 20 of them per
  client address every 15 minutes (`RATE_LIMIT_LOGIN_MAX` and
  `RATE_LIMIT_LOGIN_WINDOW_MS`). Two remote runs within 15 minutes can hit the limit
  and fail step 1 with `HTTP 429`. Wait, or raise `RATE_LIMIT_LOGIN_MAX` for the test.
- **Cookie path behind Apache.** The sign-in cookie `d7_login` has `Path=/auth`. Apache
  must rewrite it to `/api/auth` (`ProxyPassReverseCookiePath /auth /api/auth`), as the
  virtual host of the demo does. Without the rewrite, the callback does not get the
  binding cookie and step 1 fails with `HTTP 400`.
- **No browser.** The smoke does not open the meeting page or the Jitsi frame. It
  checks that a meeting exists and has a provider. Audio and video are not tested.
- **Health probes.** The smoke does not call `/healthz`, `/readyz`, or `/version`.
  Check them with `curl` after a deployment.

## Health endpoints

The API has three public probes. None needs a session, and none is rate limited.

| Path | Answer | Database |
|---|---|---|
| `GET /healthz` | `200 {"status":"ok"}` | Not read. |
| `GET /readyz` | `200 {"status":"ready"}`, or `503 database_unavailable`. | Reads `SELECT 1`. |
| `GET /version` | `200 {"version":"<api version>","buildDate":<ISO 8601 UTC or null>}` | Not read. |

`buildDate` comes from the environment variable `BUILD_DATE`. It is `null` when the
variable is unset or is not a UTC instant such as `2026-11-19T03:26:00Z`. The
Debian build does not set it yet.

## Tests

`scripts/smoke.test.js` runs the in-process flow, the injected failures, the read-only
run, a remote run against the local stack, the configuration errors, and a check that
no secret or address reaches the output. `api/src/http/health.test.js` tests the
probes and `/version`.
