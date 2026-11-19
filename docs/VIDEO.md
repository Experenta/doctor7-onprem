# Video meetings

A professional creates the video meeting of an appointment with
`POST /appointments/:id/meeting`. The server creates the meeting with Google Meet
or with Jitsi, as configured. When Meet fails, the new meeting is created in Jitsi.
The response says which provider was used.

The code is in `api/src/video/`. The specification is in `.kiro/specs/k-06/`.

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
| The professional of the appointment | `201` |
| No session | `401` |
| Body that is not `application/json` | `415` |
| A `client` or an `auditor` (the route does not admit the role) | `403` |
| An administrator of the center (can read the appointment, is not a participant) | `403` |
| A caller who cannot read the appointment: it does not exist, belongs to another center, or the caller does not take part in it | `404`, the same body for every reason |

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

The decision is made for each request. Nothing is stored, so a meeting that
exists is never moved, and the next request tries Meet again. The response has
`provider: "jitsi"`, so the client knows where the meeting is.

The server log gets one line per failover with the reason only
(`Video failover to jitsi: meet_timeout.`).

## Audit entries

All entries have target type `appointment` and the appointment id.

| Event | Action | Outcome | Reason |
|---|---|---|---|
| Meeting created in Meet | `meeting.create_meet` | `success` | none |
| Meeting created in Jitsi (chosen, or after a failover) | `meeting.create_jitsi` | `success` | none |
| Meet failed, Jitsi takes over | `meeting.failover` | `failure` | `meet_error`, `meet_timeout`, `meet_quota` |
| No provider configured | `meeting.create` | `failure` | `not_configured` |
| Request refused by the handler | `meeting.create` | `denied` | `invalid_id`, `not_found`, `other_center`, `no_center`, `not_participant`, `action_not_allowed` |
| Request refused by the gate | `appointment.update` | `denied` | `role_not_allowed` |

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
  Treat the URL as private. It is not stored by the server.

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

```sh
node --test "api/src/video/**/*.test.js" "tools/mock-google/**/*.test.js"
```
