# K-23 Requirements: the meeting is stored per appointment so the client can join it

Status: written before the code. K-23 stacks after K-11.

## Background

- Each click on "Start video meeting" creates a new room with a random name
  (`api/src/video/jitsi.js`). The API returns the address only to the professional.
  The client has no way to receive it, so in a video consultation the client can
  never enter the professional's room.
- The fix is to store one meeting per appointment and let both participants read it.

## Requirements

### Data

- R1.1 Migration `api/migrations/0005_meetings.sql` creates the table `meetings`:
  `appointment_id` (primary key and foreign key to `appointments`, `ON DELETE CASCADE`,
  binary collation like the other ids), `provider` (`meet` or `jitsi`), `url` (`TEXT`),
  `created_by` (id of the user who created it, binary collation), `created_at`
  (`DATETIME(3)`, UTC).
- R1.2 The migration is reversible and valid in MariaDB and MySQL.
- R1.3 `api/src/repositories/tables.js` lists the table. `api/test/migrations.test.js`
  expects it.
- R1.4 A meeting store exists in two versions with one contract: SQL and in memory.
  One battery of tests covers both: create, read, duplicate primary key, and cascade
  when the appointment is deleted.

### `POST /appointments/:id/meeting`

- R2.1 When the appointment already has a meeting, the answer is `200` with the same
  `{provider, url}`. No room is created and no provider is called.
- R2.2 Otherwise the meeting is created as before, stored, and answered with `201`.
- R2.3 Two simultaneous requests end with one stored meeting. The request that loses
  the primary key race reads the stored meeting and answers `200`.
- R2.4 Only the professional of the appointment may create it (unchanged).
- R2.5 For a cancelled or completed appointment the answer is `409` with code
  `appointment_closed`, and nothing is created.
- R2.6 The Meet to Jitsi failover and its audit entries do not change. The stored
  meeting keeps the provider that was really used.

### `GET /appointments/:id/meeting`

- R3.1 The professional and the client of the appointment get `200 {provider, url}`.
- R3.2 When there is no meeting yet: `404` with code `no_meeting`.
- R3.3 A user who cannot read the appointment gets the usual `404 not_found`. The
  administrator and the auditor get `404`, because they do not take part.
- R3.4 Every successful read is audited as `meeting.read`.

### Authorization

- R4.1 The matrix gets the resource `meeting`: the professional reads and creates the
  meetings of their own appointments, the client reads their own, nobody else has a cell.
- R4.2 `api/src/authz/gate.js` has a rule for `GET /appointments/:id/meeting`.
- R4.3 `docs/AUTHORIZATION.md` lists the new rows. A property test checks that the matrix
  decides what that document says, for any role, participation, and center.

### Web

- R5.1 `VideoPanel` asks `GET .../meeting` when the appointment opens. A Jitsi meeting is
  embedded. A Meet meeting is a button that opens a new tab with
  `rel="noopener noreferrer"`. Meet is never in an iframe.
- R5.2 With no meeting, the professional sees "Start video meeting" (the idempotent
  `POST`). The client sees "Your professional has not started the meeting yet" and the
  panel asks again every 15 seconds while the tab is visible. The polling stops when the
  screen is left or when the meeting appears.
- R5.3 The panel has loading, empty, error, and no-permission states.

### Smoke

- R6.1 The video step also checks that the client reads, with `GET`, the same provider and
  the same address that the professional created, and that a second `POST` answers `200`
  with the same address. The output never prints an address.

### Documentation and K-11 leftovers

- R7.1 `README.md`, `docs/SUBMISSION.md`, and `docs/DEMO-SCRIPT.md` say that the
  professional starts the meeting and that the client, in a second or private window with
  their own demo account, opens the same appointment and joins the same room. The sentence
  that says the client panel only reports that the professional starts it is removed.
- R7.2 `docs/API.md` and `docs/VIDEO.md` describe the `GET`, the `200`, `201`, and `409` of
  the `POST`, and the table.
- R7.3 `scripts/judge-docs.test.js` checks the submission documents (see `design.md`).
- R7.4 `docs/DEMO.md`, "Node 3": the sentence that asks to confirm the debconf type
  against the Jitsi handbook is removed. The PM applied and verified that block.

## Out of scope

The chat, authentication, and the simulated provider do not change. No credential or token
is stored outside the `url` field of the meeting.
