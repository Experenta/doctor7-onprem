# K-23 Design

## Storage

`meetings` has one row per appointment, so `appointment_id` is the primary key. The
foreign key uses `ON DELETE CASCADE`: a deleted appointment takes its meeting with it.
`created_by` has no foreign key, like `audit_log.actor_id`, so the row does not depend on
the user row. `url` is `TEXT` because a signed Jitsi address carries a token.

`api/src/video/store.js` is the SQL store and `api/src/video/memoryStore.js` the in-memory
one. Contract:

```
findMeeting(appointmentId) -> { appointmentId, provider, url, createdBy, createdAt } | null
insertMeeting(meeting)     -> the stored meeting. Throws DuplicateMeetingError when the
                              appointment already has one.
```

The SQL store maps the MariaDB duplicate-key error (`ER_DUP_ENTRY`, errno 1062) to
`DuplicateMeetingError`. The in-memory store throws the same error. One battery
(`api/src/video/storeContract.js`) runs against both. The SQL run needs `DATABASE_URL`.

## POST flow

1. Validate the id, find the appointment, check read (404) and `meeting` create (403).
2. A cancelled or completed appointment answers `409 appointment_closed`.
3. If a meeting is stored, answer `200` with it. No provider call.
4. If no provider is configured, answer `503`.
5. Create through the service (failover unchanged), then `insertMeeting`.
   On `DuplicateMeetingError` another request won: read the stored meeting and answer
   `200`. Otherwise answer `201`.

The room that the losing request created is discarded. Nothing refers to it.

Order of 2 and 3: a closed appointment answers `409` even when it has a meeting. This
keeps "nothing is created for a closed appointment" simple. The client can still read an
existing meeting with `GET`.

## GET flow

The gate admits every role on this route, because an administrator and an auditor must
get the same `404` as any user who cannot read the appointment. The handler checks
`can(user, 'read', meeting resource)`. The matrix has no cell for them, so the answer is
`404` with a denied audit entry. A route rule can say `anyRole`, and the other rules do
not change.

With no stored meeting the answer is `404 no_meeting`. It is not audited: the client asks
every 15 seconds, and no data was read.

## Authorization

New resource `meeting`, cells:

| Role | read | create |
| --- | --- | --- |
| professional | own | own |
| client | own | none |
| admin, auditor | none | none |

The `update` action has no cell. The POST route rule stays `appointment` / `update`, so
the existing refusals and audit entries do not change. The handler checks the `meeting`
create cell.

## Audit

`meeting.read` (`success`) on every successful `GET`, and on a repeated `POST` that answers
`200`, because both return the address. Refusals of `GET` are `meeting.read` with `denied`.
`docs/AUDIT.md` is outside this task's file scope, so it needs the new action added later.

## In-process stores

`createApp` builds the SQL meeting store from `db`. When a test or the smoke passes its own
`careStore`, there is no real database, so the meeting store defaults to a fresh in-memory
store. `video.meetingStore` overrides both.

## Web

`web/src/lib/meeting.js` has `getMeeting`. `VideoPanel` keeps one state value:
`loading`, `empty`, `ready`, `error`, `forbidden`, `starting`. Polling is an interval that
exists only while the client waits in `empty`. Each tick is skipped when the tab is hidden
or the previous request has not finished. `AppointmentPage` shows the panel to the
professional and the client only.

## Smoke

Step 3 runs three requests: professional `POST` (201), client `GET` (200, same provider and
address), professional `POST` again (200, same address). A failure message names the check
and the status, never an address.

## `scripts/judge-docs.test.js`

- `README.md` and `docs/SUBMISSION.md` contain the exact marker for the demo address.
- `README.md`, `docs/*.md`, and `.kiro/` hold no public IPv4 address and no web address whose
  host is not allowed. Allowed hosts: names under `example.test`, the reserved `.example`,
  `localhost`, `127.0.0.1`, placeholders such as `<host>`, `download.jitsi.org`, the
  repository site, and the public endpoints of Google that the API documents.
- The demo script has segments whose lengths add up to at most 180 seconds, and its table
  agrees.
- No file holds a term of the external list (`FORBIDDEN_WORDS_FILE`, or
  `scripts/forbidden-words.local.txt`). Without a list, this check is skipped with a notice.
