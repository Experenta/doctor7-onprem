# K-06 Design

## Layout

```
api/src/video/
  provider.js   VideoProvider interface, VideoProviderError, failure kinds
  config.js     loadVideoConfig(env): validates VIDEO_PROVIDER and the settings
  meet.js       Meet adapter (service account, domain-wide delegation)
  jitsi.js      Jitsi adapter (room URL, optional HS256 token)
  service.js    chooses the provider and runs the failover
  router.js     POST /appointments/:id/meeting
  index.js      createVideo({ db, store, audit, config, logger })
  harness.js    test setup (not a test file)
  *.test.js     tests
tools/mock-google/
  server.js     simulator of the Google token and Meet endpoints
  server.test.js
```

The gate (`api/src/authz/gate.js`) gets one rule. `api/src/app.js` mounts the
router after the care router.

## VideoProvider interface

```js
{
  name: 'meet' | 'jitsi',
  // input: { appointment: { id, startsAt, endsAt, ... } }
  // returns { url }. Throws VideoProviderError on any failure.
  async createMeeting(input)
}
```

`VideoProviderError` has a fixed message and a `kind`: `error`, `timeout`, or
`quota`. It never holds an upstream message, body, or credential.

## Meet adapter

1. Build a JWT assertion with RS256 (node:crypto): `iss` is the service account
   email, `sub` is `GOOGLE_MEET_DELEGATED_USER`, `scope` is
   `https://www.googleapis.com/auth/meetings.space.created`, `aud` is the token
   address, lifetime 300 s.
2. `POST <token_uri>` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
   and the assertion. Read `access_token`.
3. `POST <GOOGLE_MEET_API_BASE_URL>/v2/spaces` with `Authorization: Bearer`.
   Read `meetingUri`.

Assumption for the PM to verify: the endpoint, scope, and response field names
above follow the Google Meet REST API v2 as understood when this was written.
Only `meet.js` has to change if they differ.

Both calls share one `AbortSignal.timeout(MEET_TIMEOUT_MS)`. Redirects are not
followed, so the bearer token cannot be sent elsewhere.

Failure classification:

| Cause | kind |
|---|---|
| Abort by the time limit | `timeout` |
| HTTP 429, or an error status `RESOURCE_EXHAUSTED` | `quota` |
| Any other HTTP status outside 2xx, network failure, bad JSON, missing or foreign `meetingUri`, any exception while signing | `error` |

The token is not cached. Meeting creation is rare, and a cache is state to get
wrong.

## Jitsi adapter

Room name: `doctor7-` plus 16 random bytes in hex. URL: `JITSI_BASE_URL` path plus
the room. Signed mode adds `?jwt=`. Claims: `iss` and `aud` are `JITSI_APP_ID`,
`sub` is the host of `JITSI_BASE_URL`, `room`, `iat`, `exp`. The token is for the
room, not for one person.

## Configuration

| Variable | Meaning |
|---|---|
| `VIDEO_PROVIDER` | `meet` or `jitsi`. Unset means the endpoint answers 503. |
| `JITSI_BASE_URL` | Required for `jitsi` and for `meet` (failover target). |
| `JITSI_APP_ID`, `JITSI_JWT_SECRET` | Both or neither. Both turn on signed tokens. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account key as JSON. Required for `meet`. |
| `GOOGLE_MEET_DELEGATED_USER` | Workspace user the service account acts as. Required for `meet`. |
| `GOOGLE_MEET_API_BASE_URL` | Optional. Default `https://meet.googleapis.com`. |
| `MEET_TIMEOUT_MS` | Optional. Default 5000, range 100 to 60000. |

Addresses must be `https`, or `http` on a loopback host (the tests).
`loadVideoConfig` throws plain `Error`s. Its messages name the variable and never
include the value of a secret. `JSON.parse` messages can quote input, so they are
caught and replaced.

The secrets are defined as non-enumerable properties.

## Service and failover

```
create(appointment, { onFailover }):
  if selected is jitsi:  return jitsi
  try meet
  catch VideoProviderError e:
     await onFailover(e.kind)      // audit entry + log line
     return jitsi
```

The audit entry is written before the Jitsi meeting is created. If the audit write
fails, the request fails and no meeting is created (fail closed, like the rest of
the API).

## Router

Order of checks for `POST /appointments/:id/meeting` (the gate has already checked
session, JSON content type, and role):

1. Reject a body with fields (400).
2. Invalid id or missing appointment: audit `not_found`/`invalid_id`, 404.
3. `can(user, 'read')` false: audit with the read denial reason, 404.
4. `can(user, 'update')` false, or the user is not the professional of the
   appointment: audit `action_not_allowed`, 403.
5. Provider not configured: audit failure `not_configured`, 503.
6. Create (with failover). Audit success. Answer 201.

The administrator passes step 3 and the matrix check in step 4 (`update` is
`center` for administrators). The explicit participant check in step 4 is what
keeps administrators out, as R7.3 requires. The matrix is not changed.

## Audit entries

| Event | action | outcome | reason | target |
|---|---|---|---|---|
| Refusal | `meeting.create` | `denied` | `not_found`, `invalid_id`, `other_center`, `no_center`, `role_not_allowed`, `not_participant`, `action_not_allowed` | `appointment` and id |
| Not configured | `meeting.create` | `failure` | `not_configured` | `appointment` and id |
| Failover | `meeting.failover` | `failure` | `meet_error`, `meet_timeout`, `meet_quota` | `appointment` and id |
| Created | `meeting.create_meet` or `meeting.create_jitsi` | `success` | none | `appointment` and id |

A successful entry cannot carry a reason, so the provider is part of the action name.

## Simulator

`createMockGoogle({ publicKeyPem, serviceAccountEmail, delegatedUsers })` starts a
loopback server with `POST /token` (verifies the RS256 assertion) and
`POST /v2/spaces`. The `mode` property drives the failure cases: `ok`, `http_400`,
`http_500`, `quota`, `hang`, `no_uri`, `delegation_denied`. It records
`{method, path, status}` for each request and never the body.

The tests generate an RSA key pair at run time. No key is committed.

## Decisions to confirm

- No meeting is stored. Each call creates a new meeting. "Already created meetings
  do not move" holds because nothing is stored.
- Meeting creation is not blocked for `cancelled` or `completed` appointments.
- Only the professional of the appointment may create the meeting.
