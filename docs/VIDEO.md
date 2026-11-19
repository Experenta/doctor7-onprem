# Video meetings

A professional starts the video meeting of an appointment with
`POST /appointments/:id/meeting`. The server creates the meeting with Google Meet
or with Jitsi, as configured, and stores it with the appointment. When Meet fails, the
new meeting is created in Jitsi. The response says which provider was used. The client of
the appointment reads the stored meeting with `GET /appointments/:id/meeting` and enters
the same room.

The code is in `api/src/video/`. The specifications are in `.kiro/specs/k-06/` and
`.kiro/specs/k-23/`.

## The stored meeting

The table `meetings` (migration `api/migrations/0005_meetings.sql`) has one row per
appointment.

| Column | Meaning |
|---|---|
| `appointment_id` | Primary key, and foreign key to `appointments` with `ON DELETE CASCADE`. Deleting an appointment deletes its meeting. |
| `provider` | `meet` or `jitsi`: the provider that really created the meeting, after any failover. |
| `url` | The meeting address (`TEXT`). A signed Jitsi address carries a token. This column is the only place where the server keeps it. |
| `created_by` | The id of the professional who created it. |
| `created_at` | UTC, `DATETIME(3)`. |

`POST /appointments/:id/meeting` is idempotent:

| Case | Answer |
|---|---|
| The appointment has no meeting | The server creates it, stores it, and answers `201 {provider, url, fallback, simulated}`. |
| The appointment already has one | `200` with the same `{provider, url, fallback, simulated}`. No room is created and no provider is called. |
| Two requests arrive together | One meeting is stored. The request that hits the primary key answers `200` with the stored one. The room it made is dropped. |
| The appointment is `cancelled` or `completed` | `409 appointment_closed`. Nothing is created. |

`GET /appointments/:id/meeting` answers `200 {provider, url, fallback, simulated}` to the professional and the
client of the appointment, and `404 no_meeting` while the professional has not started the
meeting. A user who cannot read the appointment gets the usual `404 not_found`, and so do
the administrator and the auditor, who do not take part. The web client of the client asks
again every 15 seconds while its tab is visible.

## Settings

Names only. Values come from the service environment and are never stored in the
repository.

| Variable | Required | Meaning |
|---|---|---|
| `VIDEO_PROVIDER` | No | `meet` or `jitsi`. Any other value stops the server at startup. When it is not set, the endpoint answers `503 video_not_configured`. |
| `JITSI_BASE_URL` | When `VIDEO_PROVIDER` is set | Address of the Jitsi server, such as `https://jitsi.clinic.example`. With `meet` it is the failover target, so it is required there too. |
| `JITSI_APP_ID`, `JITSI_JWT_SECRET` | No | Set both to put a signed token in every Jitsi URL. Setting only one stops the server at startup. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | With `meet` | The service account key, as the JSON text that Google issues. |
| `GOOGLE_MEET_DELEGATED_USER` | With `meet` | The Workspace user on whose behalf the service account creates the space. It owns the meetings. |
| `GOOGLE_MEET_API_BASE_URL` | No | Default `https://meet.googleapis.com`. Tests point it at the simulator. |
| `MEET_TIMEOUT_MS` | No | Time limit for the whole Meet creation. Default 5000, from 100 to 60000. |

Addresses must be `https`. `http` is accepted only for a loopback host, which the
tests use.

### The Google credential

- It is read only from `GOOGLE_SERVICE_ACCOUNT_JSON`. Set it in the environment of
  the service (for example a systemd `EnvironmentFile` that only root and the
  service user can read), never in a file of this repository.
- The loaded configuration holds it as a property that is not enumerable. Printing
  or serializing the configuration does not show it.
- It does not appear in responses, in log lines, or in audit entries. A test in
  `api/src/video/meeting.http.test.js` searches all of them for the key.
- An invalid value stops the server at startup with a message that does not quote
  the value.
- Domain-wide delegation must be granted to the service account in the Google
  Workspace admin console, for the scope
  `https://www.googleapis.com/auth/meetings.space.created`. That setup is outside
  this repository.

## Who may create a meeting

Only the professional of the appointment. The route is in the gate
(`api/src/authz/gate.js`) as `appointment` / `update`, so it admits `professional`
and `admin`. The handler then requires the caller to be the professional of the
appointment.

| Caller | Answer |
|---|---|
| The professional of the appointment | `201` for the first call, `200` for a repeated one |
| No session | `401` |
| Body that is not `application/json` | `415` |
| A `client` or an `auditor` (the route does not admit the role) | `403` |
| An administrator of the center (can read the appointment, is not a participant) | `403` |
| A caller who cannot read the appointment: it does not exist, belongs to another center, or the caller does not take part in it | `404`, the same body for every reason |
| The professional, for a `cancelled` or `completed` appointment | `409 appointment_closed` |

The audit log keeps the real reason of every refusal. A refused request never
calls a video provider.

## Failover

With `VIDEO_PROVIDER=meet`, a failed Meet creation makes the server create the
meeting in Jitsi. These count as a failure:

| Cause | Audit reason |
|---|---|
| Time limit reached (`MEET_TIMEOUT_MS`) | `meet_timeout` |
| HTTP 429, or an error status `RESOURCE_EXHAUSTED` | `meet_quota` |
| Any other HTTP error (4xx or 5xx), network error, invalid answer, a meeting address that is not on `meet.google.com`, or a delegation that Google refuses | `meet_error` |

The decision to fail over is made for each new meeting, and it is not remembered. The next new meeting tries Meet again. The meeting that is created is stored per
appointment in the `meetings` table, with the provider that really created it. A stored meeting is never moved: a repeated
request returns it as it is, and the response has `provider: "jitsi"` when Jitsi
created it, so the client knows where the meeting is.

The server log gets one line per failover with the reason only
(`Video failover to jitsi: meet_timeout.`).

### What the client is told

The answer has two booleans next to `provider` and `url`, so the web client can name the
provider and explain a failover. Neither is stored. The database schema is unchanged.

| Field | Value |
|---|---|
| `fallback` | `selected === 'meet' && provider === 'jitsi'`, where `selected` is `VIDEO_PROVIDER` now. Jitsi created the meeting while the server is set to Meet. A meeting stored while the server was set to `jitsi` reads `false`. If an administrator later changes the server from `jitsi` to `meet`, such a meeting reads `true`, because the flag follows the configuration. |
| `simulated` | `true` only when the API runs with `DEMO_MODE=1` and `provider` is `meet`: in the demo a simulator stands in for Google. Always `false` on a server without `DEMO_MODE`. |

The web client shows the chip "Google Meet (simulated)", "Google Meet", "Jitsi (fallback)", or
"Jitsi", and, when `fallback` is `true`, the notice "Google Meet was not available, so this meeting
was created in Jitsi."

## Audit entries

All entries have target type `appointment` and the appointment id.

| Event | Action | Outcome | Reason |
|---|---|---|---|
| Meeting created in Meet | `meeting.create_meet` | `success` | none |
| Meeting created in Jitsi (chosen, or after a failover) | `meeting.create_jitsi` | `success` | none |
| Meet failed, Jitsi takes over | `meeting.failover` | `failure` | `meet_error`, `meet_timeout`, `meet_quota` |
| No provider configured | `meeting.create` | `failure` | `not_configured` |
| Request refused by the handler | `meeting.create` | `denied` | `invalid_id`, `not_found`, `other_center`, `no_center`, `not_participant`, `action_not_allowed`, `appointment_closed` |
| Request refused by the gate | `appointment.update` | `denied` | `role_not_allowed` |
| The address is returned: a successful `GET`, or a repeated `POST` that answers `200` | `meeting.read` | `success` | none |
| `GET` refused by the handler | `meeting.read` | `denied` | `invalid_id`, `not_found`, `other_center`, `no_center`, `not_participant`, `role_not_allowed` |

A `GET` that finds no meeting (`404 no_meeting`) writes no entry. The client asks again
every 15 seconds and nothing is read.

A failover writes two entries: `meeting.failover`, then `meeting.create_jitsi`.
The failover entry is written before the Jitsi meeting is created. If that write
fails, the request fails and no meeting is created. A successful entry cannot hold
a reason, so the provider is part of the action name. The meeting URL is never
written to the log or the audit table.

## Clients

- A Meet URL opens in a separate browser tab. Do not embed it.
- A Jitsi URL can be embedded in an iframe. The page that embeds it needs the Jitsi
  address in its `frame-src` (Content Security Policy) and the `camera` and
  `microphone` permissions on the iframe. The Apache and front end settings are
  outside this task.
- The URL of a signed Jitsi meeting holds a token for that room. It works until one
  hour after the appointment ends. The response has `Cache-Control: no-store`.
  Treat the URL as private. The server stores it in the `meetings` table and returns it
  only to the professional and the client of the appointment.

## Adapter interface

```js
// VideoProvider (api/src/video/provider.js)
{
  name: 'meet' | 'jitsi',
  async createMeeting({ appointment }) // -> { url }, or throws VideoProviderError
}
```

`VideoProviderError.kind` is `error`, `timeout`, or `quota`. Its message is fixed
text and never holds anything from the provider.

`api/src/video/meet.js` holds every Google call: the assertion (RS256, `iss` is the
service account, `sub` is the delegated user), the token exchange, and
`POST /v2/spaces`. If Google's API differs from what is written there, change that
file only.

## Simulator

`tools/mock-google/` is a loopback simulator of the token endpoint and the Meet
space endpoint. It verifies the signature of the assertion with a public key. Its
`mode` property selects `ok`, `http_400`, `http_500`, `quota`, `hang`, `no_uri`, or
`delegation_denied`. The tests create a fresh RSA key pair at run time, so no key
is stored in the repository. The real Google is never called by the tests.

To run it by hand, set `MOCK_GOOGLE_PUBLIC_KEY_FILE` to a PEM public key and run
`node tools/mock-google/server.js`. `MOCK_GOOGLE_PORT` changes the port (default 4020).

The demo adds a control endpoint (K-36). With `MOCK_GOOGLE_CONTROL_SECRET` set (at least 16
characters), `GET` and `POST /control/mode` read and set `mode`. It answers only a peer on
loopback that sends the header `x-demo-control-secret` with that secret, and it refuses a request
that carries `X-Forwarded-For` or `Forwarded`. `POST` accepts `{"mode":"ok"}` and
`{"mode":"http_500"}` only. Without the secret setting, the path answers `404`. The API uses this
endpoint through the demo-only switch of `docs/DEMO.md`, which turns a Meet outage on and off so
that the failover above can be shown.

```sh
node --test "api/src/video/**/*.test.js" "tools/mock-google/**/*.test.js"
```
