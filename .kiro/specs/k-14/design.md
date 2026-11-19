# K-14 Design: end-to-end smoke test and health endpoints

## Files

| File | Role |
| --- | --- |
| `api/src/http/health.js` | Adds `GET /version`. Exports `readBuildDate` for the test. |
| `api/src/http/health.test.js` | Tests the probes and `/version`, through `createApp`. |
| `scripts/smoke.js` | CLI and runner: argument and environment checks, the step loop, the output, the exit code. Exports `main`. |
| `scripts/lib/config.js` | Reads the flags and the variables. Throws `ConfigError` with the name of the variable, never its value. |
| `scripts/lib/cookies.js` | `CookieJar`: a cookie store with host and path matching. |
| `scripts/lib/http.js` | `send()`: one request with manual redirects, `Origin`, the JSON or form body, and the jar. `SmokeFailure`: the error type for a failed check, with a safe message. |
| `scripts/lib/login.js` | `signIn()`: the sign-in redirect chain by hand. `parseAccountForm()`: reads the identity provider page. |
| `scripts/lib/steps.js` | The seven steps, the chat client, and the dependency list. |
| `scripts/lib/stack.js` | `startStack()`: the API, the mock identity provider, and the mock Google, in one process, with memory stores filled from the seed. |
| `scripts/smoke.test.js` | The tests of R9. |
| `docs/SMOKE.md` | How to run each mode, the variables, the exit codes. |

## Health and version (R1)

`createHealthRouter` already holds `/healthz` and `/readyz`. It gains `/version`,
which returns `{ version, buildDate }`. `version` comes from `api/package.json`.
`buildDate` comes from `BUILD_DATE`, validated by the pattern
`YYYY-MM-DDTHH:MM:SS(.fff)Z` and normalized with `toISOString()`. An invalid value
gives `null`. The router is mounted before the rate limit and the authorization
gate, so the endpoint stays public and unlimited.

## Modes and configuration (R3, R7.4)

Mode is chosen by the flag `--remote`, not by whether `SMOKE_BASE_URL` is set (D1).
`resolveConfig(argv, env)` checks everything before any network call:

- `--remote`: `SMOKE_BASE_URL` must be a site origin: `https`, or `http` on a
  loopback host, with no path, query, or credentials. `SMOKE_API_PREFIX` defaults to
  `/api` and must be empty or a path without a trailing slash.
- process mode: `SMOKE_BASE_URL` must be empty. `--google-mode` must be one of the
  modes of `tools/mock-google`.
- `SMOKE_READ_ONLY` is `1`, `0`, or empty.
- Unknown arguments are refused without echoing them.

Any `ConfigError` gives exit `2`, and nothing else runs.

## Sign-in (R4)

`signIn(ctx, email)` uses a new `CookieJar` for the account:

1. `GET <api>/auth/login`: expects `302` and a `Location` (the identity provider
   authorization address). The binding cookie `d7_login` is stored.
2. `GET <Location>`: expects `200`, the sign-in page.
3. `parseAccountForm(html, email)` reads the form action, the hidden fields, and the
   `name="user"` value of the button in the account block that shows the e-mail.
4. `POST <action>` with the hidden fields and `user`, and `Origin` set. Expects `302`
   and a `Location` with `code` and `state`.
5. `GET <Location>`: the API callback. The result is the status (`302` opens a
   session, `401` and `403` are the refusals). The callback deletes `d7_login` and,
   on success, sets the session cookie. A cookie with a value and no `Max-Age=0`
   counts as the session.

The script never follows the last redirect to the site, because the callback answers
with `302` to the post-login path, and that path is not part of the smoke.

## Steps and dependencies (R2)

Each step is `{ name, requires, run, readOnlyRun?, writeOnly? }`. The runner keeps the
set of failed steps. A step whose `requires` contains a failed step prints `FAIL`
with the message "not run, step N failed". Read-only runs print `SKIP` for steps
with `writeOnly`. `SKIP` does not fail the run.

| # | Step | Requires | Read-only |
| --- | --- | --- | --- |
| 1 | sign-in | none | runs |
| 2 | appointment | 1 | lists and reads one existing appointment |
| 3 | video meeting | 2 | SKIP |
| 4 | chat | 2 | SKIP |
| 5 | consultation create | 2 | SKIP |
| 6 | consultation read | 5 | SKIP |
| 7 | audit | 1 | runs; in write mode it checks the entries of the run |

The chat uses `ws` (R6). It opens both sockets with the session cookie and `Origin`,
waits for each `history` frame, sends the message from the professional, and waits
for a `message` frame on both sockets. The sockets are always closed in a `finally`.

## Process mode (R3.1, R8)

`startStack()`:

1. Reserves a loopback port, so the redirect URI (`http://127.0.0.1:<port>/auth/callback`)
   is known before the API configuration is built (D7).
2. Starts `tools/mock-idp` with the redirect URI registered.
3. Starts `tools/mock-google` with a throwaway service account from
   `tools/mock-google/testing.js`. The key is generated in memory.
4. Builds the configuration with `loadConfig` from an explicit object, never from
   `process.env`, so host settings cannot change the run.
5. Fills the memory stores from `generateSeed(now)` (D6). Dates are converted back to
   `Date` objects.
6. Calls `createServer` and listens on the reserved port.

`close()` calls `shutdown` with a short grace period, then closes the identity
provider and Google.

## Output and exit codes (R7)

Each line is `<STATUS> <n>/7 <name>: <detail>`. The details are fixed messages with
HTTP status codes, API error codes, and resource identifiers. Response bodies are
never printed. The last line is `Result: PASS` or `Result: FAIL`, with the counts.

## Decisions

- D1. The mode is chosen by `--remote`. Choosing it by the presence of
  `SMOKE_BASE_URL` would turn a missing variable into a silent in-process run, which
  contradicts R3.3.
- D2. The build date comes from the environment variable `BUILD_DATE`, read in
  `health.js`. The repository has no build date source: `packaging/build-deb.js`
  takes the version from the root `package.json` and does not record a date. The
  project manager decides where the value comes from. Moving the read into
  `config.js` would be the usual place, but that file is outside this task.
- D3. "Google down without Jitsi" cannot be built with the current configuration.
  `loadVideoConfig` requires `JITSI_BASE_URL` whenever `VIDEO_PROVIDER` is `meet`, so
  a meeting service with Meet and no Jitsi does not exist. The failing case is built
  by starting without a video provider (`--no-video-provider`). The meeting then
  answers `503 video_not_configured`, and the step fails by name. The project manager
  should confirm this stand-in.
- D4. Step 2 in read-only mode lists the appointments of the professional and reads
  the first one. The demo seed provides them.
- D5. Steps 3 to 6 are `SKIP` in read-only mode. They are not counted as failures.
- D6. Process mode loads the users, appointments, consultations, messages, and audit
  rows from `generateSeed`, so it runs with the same accounts and shapes as the demo.
- D7. The reserved port is released before the API listens. The window is small, and
  a clash would show as a startup error with exit `2`.
- D8. Sign-in attempts count against the sign-in rate limit of the API (20 requests
  per 15 minutes per client address, `RATE_LIMIT_LOGIN_MAX`). One run sends 12 of
  them (6 sign-ins, each with `/auth/login` and `/auth/callback`). Two remote runs
  within 15 minutes can hit the limit. This is documented in `docs/SMOKE.md`.
