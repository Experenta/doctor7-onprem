# Authorization

The API denies every request unless a rule allows it. Authorization has three
layers. A request must pass all of them.

1. **Route rule.** `api/src/authz/gate.js` lists the protected routes. A request
   that matches no rule gets `403`, signed in or not. A new route stays closed
   until someone adds a rule for it.
2. **Role.** Each rule names a resource and an action. The allowed roles come
   from the matrix below. A signed-in user whose role has no allowed cell gets
   `403`. A request without a live session gets `401`.
3. **Object.** The handler checks the record itself with `can()` from
   `api/src/authz/policy.js`: the user must be in the same center as the record,
   and for `own` cells must take part in the appointment.

The user's role and center come from the `users` table on every request
(`req.auth.user`). Nothing in a request body or header can change them.

## Roles

| Role | Meaning |
|---|---|
| `professional` | A clinician. Works with the appointments and consultations where they are the professional. |
| `client` | A person who attends consultations. Sees only their own appointments and consultations. |
| `admin` | Administers one center. Works with the appointments and consultations of that center. |
| `auditor` | Reads the audit log of one center. Has no access to appointments or consultations. |

## Matrix

Effects:

- `own`: allowed when the user is in the same center as the record and is the
  professional (role `professional`) or the client (role `client`) of the
  appointment. For a consultation, the appointment it belongs to decides.
- `center`: allowed when the user is in the same center as the record.
- `none`: always denied.

A user without a center (`centerId` is `null`) is denied every action, because
every rule is scoped to a center. Nobody crosses centers, whatever the effect.

| Role | Resource | Action | Effect |
|---|---|---|---|
| professional | appointment | read | own |
| professional | appointment | create | own |
| professional | appointment | update | own |
| professional | consultation | read | own |
| professional | consultation | create | own |
| professional | consultation | update | own |
| professional | audit | read | none |
| professional | audit | create | none |
| professional | audit | update | none |
| client | appointment | read | own |
| client | appointment | create | none |
| client | appointment | update | none |
| client | consultation | read | own |
| client | consultation | create | none |
| client | consultation | update | none |
| client | audit | read | none |
| client | audit | create | none |
| client | audit | update | none |
| admin | appointment | read | center |
| admin | appointment | create | center |
| admin | appointment | update | center |
| admin | consultation | read | center |
| admin | consultation | create | none |
| admin | consultation | update | none |
| admin | audit | read | none |
| admin | audit | create | none |
| admin | audit | update | none |
| auditor | appointment | read | none |
| auditor | appointment | create | none |
| auditor | appointment | update | none |
| auditor | consultation | read | none |
| auditor | consultation | create | none |
| auditor | consultation | update | none |
| auditor | audit | read | center |
| auditor | audit | create | none |
| auditor | audit | update | none |
| professional | meeting | read | own |
| professional | meeting | create | own |
| professional | meeting | update | none |
| client | meeting | read | own |
| client | meeting | create | none |
| client | meeting | update | none |
| admin | meeting | read | none |
| admin | meeting | create | none |
| admin | meeting | update | none |
| auditor | meeting | read | none |
| auditor | meeting | create | none |
| auditor | meeting | update | none |
| professional | demo | read | none |
| professional | demo | create | none |
| professional | demo | update | none |
| client | demo | read | none |
| client | demo | create | none |
| client | demo | update | none |
| admin | demo | read | center |
| admin | demo | create | none |
| admin | demo | update | center |
| auditor | demo | read | none |
| auditor | demo | create | none |
| auditor | demo | update | none |

The test `api/src/authz/policy.test.js` holds a hand-written copy of this table.
It checks every row against `can()` (an allowed and a denied case for each
effect), checks that this file lists the same 60 rows, and fails if either
differs from `MATRIX` in `policy.js`. A property test reads this table and checks,
for any role, any participation in the appointment, and any pair of centers, that
`can()` decides what the table says.

The `meeting` resource is the video meeting of an appointment. It takes its center
and participants from the appointment, like a consultation. The professional of the
appointment reads and creates it, the client of the appointment reads it, and nobody
else has a cell. An administrator can read the appointment, but not its meeting.

The `demo` resource is the demo-only Meet outage switch (K-36). It has no record and
no participants. Only an administrator of a center has cells, `read` and `update`, and
the `center` effect only checks that the administrator has a center. The routes of
this resource exist only when the API starts with `DEMO_MODE=1` (see the Routes
table and `docs/DEMO.md`). Without `DEMO_MODE`, the gate holds no rule for them, so a
request to their path answers `403` like any path without a rule, and the audit log
records `no_rule`.

### Choices where the rules were silent

These cells are `none` because the task rules did not grant them. Change them
only with a decision from the product owner.

- A `client` cannot create or change appointments.
- An `admin` can read consultations of the center but cannot create or change
  them. Clinical notes are written by the professional of the appointment.
- No role can update a consultation except the professional of the appointment.
  There is no update route yet, so the `update` cells have no endpoint.
- The `audit` resource has no endpoint yet. When one is added, it must supply the
  center of each entry, because `audit_log` has no `center_id` column.

## Routes

| Method | Path | Resource and action | Roles with a cell |
|---|---|---|---|
| GET | `/appointments` | appointment read | professional, client, admin |
| GET | `/appointments/:id` | appointment read | professional, client, admin |
| POST | `/appointments` | appointment create | professional, admin |
| POST | `/consultations` | consultation create | professional |
| GET | `/consultations/:id` | consultation read | professional, client, admin |
| POST | `/appointments/:id/meeting` | meeting create (the gate checks appointment update) | professional |
| GET | `/appointments/:id/meeting` | meeting read | professional and client in the matrix. The gate admits every role. |
| GET | `/demo/meet-outage` | demo read (only with `DEMO_MODE=1`) | admin in the matrix. The gate admits every role. |
| POST | `/demo/meet-outage` | demo update (only with `DEMO_MODE=1`) | admin |

The gate admits every role on `GET /appointments/:id/meeting` on purpose (the rule
has `anyRole`). The handler checks the meeting with `can()`, so an administrator or an
auditor gets the same `404` as a user who cannot read the appointment. A `403` there
would tell them that a meeting route exists for that record.

`GET /demo/meet-outage` follows the same pattern. The gate admits every role, and the
handler answers `404` to a role without the `demo read` cell. `POST /demo/meet-outage`
uses the matrix at the gate, so every role but `admin` gets `403`, and the refusal is
audited as `demo.update` with reason `role_not_allowed`. An administrator without a
center is refused by the handler with `403` (`POST`) or `404` (`GET`), reason `no_center`.

Public routes are outside the gate: `/healthz`, `/readyz`, and the `/auth`
routes. Any other path or method answers `403`, including `HEAD`, `OPTIONS`,
`DELETE`, a trailing slash, and a different letter case.

## Object-level behavior

- Lists apply the filter from `listScope()` in the query, so a user never
  receives a row they may not read. A professional gets their appointments, a
  client gets theirs, and an admin gets those of the center.
- `GET /appointments/:id` and `GET /consultations/:id` answer `404` when the id
  does not exist and `403` when it exists but the user may not read it.
- `POST /appointments` takes the center from the signed-in user, never from the
  body. A body with `centerId` or any other unknown field is rejected with `400`.
  Both participants must exist in the user's center with the roles
  `professional` and `client`. A missing user, a user of another center, and a
  user with the wrong role all give the same `403`.
- `POST /consultations` takes the center and participants from the appointment.
- `GET /appointments/:id/meeting` answers `200` to the professional and the client of
  the appointment, `404 no_meeting` when the meeting does not exist yet, and the usual
  `404 not_found` to everyone else, including the administrator and the auditor of the
  center. `POST /appointments/:id/meeting` answers `404` when the caller
  cannot read the appointment, `403` to a reader who is not its professional, and `409` when
  the appointment is not scheduled.

## Content type

`POST`, `PUT`, and `PATCH` requests to protected routes must send
`Content-Type: application/json` (a `charset` parameter is allowed). Any other
type, or none, answers `415` with code `unsupported_media_type`, before the
route rule and the session are checked. A cross-site HTML form cannot send this
type, so this check adds to the `SameSite=Strict` session cookie as a defense
against cross-site request forgery. The `/auth` routes are not affected.

## Tests

- `api/src/authz/policy.test.js`: one test per matrix cell, the documentation
  check, and property tests (2000 generated cases for the rule itself and for
  the center check, 1000 for the unknown-name and list-scope checks).
- `api/src/care/care.http.test.js`: HTTP tests of each route for each role and
  center, the no-rule `403`, the `415` check, and property tests with 250
  generated requests each: nobody reads, lists, or writes across centers, and
  a request without a JSON content type never reaches a handler.
