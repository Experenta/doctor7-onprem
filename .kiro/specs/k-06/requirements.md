# K-06 Requirements: video meetings with Google Meet and Jitsi

## Introduction

A professional creates a video meeting for one of their appointments. The server
picks the video provider from configuration. When Google Meet fails, the new
meeting is created in Jitsi instead, the switch is audited, and the client learns
which provider was really used.

Google is never called for real in this repository or in its tests. The tests use
the simulator in `tools/mock-google/`.

## Requirements

### R1. Create a meeting

**User story:** As a professional, I want to create the video meeting of my
appointment, so that I and my client can meet online.

Acceptance criteria:

1. `POST /appointments/:id/meeting` answers `201` with `{"provider": "meet"|"jitsi", "url": "<string>"}` and no other field.
2. The response carries `Cache-Control: no-store`, because the URL can hold a meeting token.
3. The provider named in the response is the one that really created the meeting.
4. A body with fields is refused with `400 invalid_request`. The provider is never chosen by the client.

### R2. Provider selection

**User story:** As an administrator, I want to choose the provider in the
configuration, so that the clinic uses the service it prefers.

Acceptance criteria:

1. `VIDEO_PROVIDER=jitsi` creates the meeting in Jitsi.
2. `VIDEO_PROVIDER=meet` creates the meeting in Google Meet through a server-side adapter.
3. A `VIDEO_PROVIDER` value other than `meet` or `jitsi` makes startup fail with an error that names the variable and lists the allowed values. There is no silent default.
4. When `VIDEO_PROVIDER` is not set, the endpoint answers `503 video_not_configured` and writes an audit entry. The rest of the API works.
5. With `VIDEO_PROVIDER=meet`, the Google settings and `JITSI_BASE_URL` are required at startup, so a failover target always exists.
6. The application code outside `api/src/video/` does not name a provider.

### R3. Meet adapter

**User story:** As an administrator, I want the server to create Meet spaces with
a service account, so that no user has to sign in to Google.

Acceptance criteria:

1. The adapter signs a service-account assertion with domain-wide delegation for the user in `GOOGLE_MEET_DELEGATED_USER`, exchanges it for an access token, and creates the space.
2. All Google addresses are configurable, so the tests point them at `tools/mock-google/`.
3. The adapter sits behind the `VideoProvider` interface (`name`, `createMeeting`). Changing the Google call does not touch the router, the service, or the Jitsi adapter.
4. One time limit (`MEET_TIMEOUT_MS`, default 5000 ms) covers the whole Meet creation.
5. A response without an `https://meet.google.com/` meeting address counts as a failure.

### R4. Jitsi adapter

Acceptance criteria:

1. The URL is `JITSI_BASE_URL` plus a room name that cannot be guessed (random, at least 128 bits).
2. When `JITSI_APP_ID` and `JITSI_JWT_SECRET` are both set, the URL carries a signed token (`?jwt=`, HS256) for that room. When neither is set, the URL has no token. Setting only one of them makes startup fail.
3. The token expires one hour after the appointment ends, or one hour from now when that moment has already passed.

### R5. Failover

**User story:** As a professional, I want the meeting to be created even when Meet
is down, so that the consultation is not lost.

Acceptance criteria:

1. A Meet error (HTTP 4xx or 5xx, network failure, bad response), a timeout, or a quota refusal makes the server create the meeting in Jitsi. The answer is `201` with `provider: "jitsi"`.
2. Each failover writes exactly one audit entry with action `meeting.failover`, outcome `failure`, and reason `meet_error`, `meet_timeout`, or `meet_quota`.
3. Each created meeting writes one audit entry: `meeting.create_meet` or `meeting.create_jitsi`, outcome `success`.
4. Failover applies to the new meeting only. Nothing is stored that moves an earlier meeting, and the next request tries Meet again.
5. A failover is written to the server log with the reason only.

### R6. Credential protection

Acceptance criteria:

1. The service account credential is read only from `GOOGLE_SERVICE_ACCOUNT_JSON`. The variable name is documented. No value is in the repository.
2. The credential, the private key, and the Jitsi secret appear in no response, no log line, and no audit entry. A test searches for them.
3. Text from Google error bodies appears in no response, log line, or audit entry.
4. An invalid credential makes startup fail with a message that does not quote the value.
5. The credential and the Jitsi secret are not enumerable properties of the loaded configuration, so printing the configuration does not show them.

### R7. Authorization

**User story:** As a clinic, I want only the people of an appointment to create
its meeting.

Acceptance criteria:

1. The route has a rule in `api/src/authz/gate.js`, so it is closed to every role the rule does not name. Roles come from the policy matrix (`appointment`, `update`).
2. A caller who cannot read the appointment (missing id, other center, not a participant) gets `404 not_found`, the same body in every case.
3. A caller who can read the appointment but cannot act gets `403 forbidden`. This covers an administrator of the center who is not a participant, and a client, who has no update right.
4. Only the professional of the appointment can create its meeting.
5. Every refusal writes an audit entry with a reason, and no call is made to a video provider.
6. Without a session the answer is `401`. A body that is not JSON gets `415`.

### R8. Clients

Acceptance criteria:

1. `docs/VIDEO.md` states that a Meet URL opens in a separate browser tab and a Jitsi URL may be embedded. The API does not return an embed flag.
2. `docs/API.md` lists the endpoint and its errors.
3. The web front end is not changed by this task.
