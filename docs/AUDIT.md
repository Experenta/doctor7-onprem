# Audit log

The audit log records who did what, when, and with what result. It holds no
clinical content: no consultation body, no note, no chat text, no password, no
token, and no authorization code. Entries answer questions such as "who read this
consultation" and "why was this request refused".

The table is `audit_log`. Migration `0001` creates it and migration `0003` adds
its `center_id`, `outcome`, `ip`, and `reason` columns.

## What is recorded

Each event writes one entry, except where a row says otherwise.

| Event | Action | Outcome | Target | Center |
|---|---|---|---|---|
| Sign-in succeeds | `auth.login` | `success` | `user`, with the user id | the user's center |
| Sign-in is refused, because the verified email has no `users` row | `auth.login` | `denied`, reason `user_not_found` | `user`, no id | none |
| Sign-in fails at the callback or with the provider | `auth.login` | `failure`, with a fixed reason code | `user`, no id | none |
| Logout of the current session | `auth.logout` | `success`, or `failure` with reason `no_session` | `session`, no id | the user's center, or none on failure |
| Logout of every session of the user (`{"all":true}`) | `auth.logout_all` | `success`, or `failure` with reason `no_session` | `session`, no id | the user's center, or none on failure |
| A consultation is read | `consultation.read` | `success` | `consultation`, with the id | the center of its appointment |
| An appointment is created | `appointment.create` | `success` | `appointment`, with the new id | the caller's center |
| A consultation is created | `consultation.create` | `success` | `consultation`, with the new id | the center of its appointment |
| A video meeting is created in Google Meet or Jitsi | `meeting.create_meet` or `meeting.create_jitsi` | `success` | `appointment`, with the id | the center of the appointment |
| A stored video meeting is read by a participant, or a repeated `POST` returns the stored meeting | `meeting.read` | `success` | `appointment`, with the id | the center of the appointment |
| A meeting read is refused with 404 | `meeting.read` | `denied`, with reason | `appointment`, with the id when it is known | see the center rule below |
| A meeting is refused because the appointment is not `scheduled` (`cancelled` or `completed`) | `meeting.create` | `denied`, reason `appointment_closed` | `appointment`, with the id | the center of the appointment |
| Google Meet fails, times out, or hits its quota, and the meeting moves to Jitsi | `meeting.failover` | `failure`, with reason `meet_error`, `meet_timeout`, or `meet_quota` | `appointment`, with the id | the center of the appointment |
| A meeting request is refused, or no video provider is configured | `meeting.create` | `denied`, with a reason, or `failure` with reason `not_configured` | `appointment`, with the id when it is known | see the center rule below |
| A chat connection opens | `chat.connect` | `success` | `appointment`, with the id | the center of the appointment |
| A chat connection is refused | `chat.connect` | `denied`, with a reason | `appointment`, with the id when it is known | see the center rule below |
| A chat message is stored | `chat.send` | `success` | `appointment`, with the id | the center of the appointment |
| A chat message is refused because the appointment is closed | `chat.send` | `denied`, reason `appointment_closed` | `appointment`, with the id | the center of the appointment |
| The chat retention purge runs | `chat.purge` | `success` | `chat`, no id | none |
| A read of an appointment or consultation is refused with 404 | `appointment.read` or `consultation.read` | `denied`, with reason | the requested type and id | see the center rule below |
| A write is refused with 403 | the route action, such as `appointment.create` | `denied`, with reason | the type the route names | see the center rule below |
| A request matches no route rule | `request.denied` | `denied`, reason `no_rule` | `route`, no id | none |
| `GET /audit` is refused | `audit.read` | `denied`, with reason | `audit`, no id | the caller's center |

Successful appointment reads are not logged. Successful consultation reads and successful
meeting reads are. A meeting read that finds no meeting is not logged, because the client
asks again every 15 seconds.

No administration routes exist yet, so nothing is logged for them. A route added
later for administration must write its entries here.

A request refused with 401 (no live session) and a request refused with 415 (a
body that is not `application/json`) write no entry.

### Center rule

The center of an entry is the center of the record it concerns, when that center is
known. Otherwise it is the caller's center. For a read refused with 404, the record's
center is the one that owns the data, so an auditor of that center sees the attempt.
A caller from another center does not see it.

## Fields

| Field | Meaning |
|---|---|
| `id` | Random UUID. |
| `occurred_at` | UTC time, with milliseconds. |
| `actor_id` | The signed-in user who made the request. `NULL` when no user was signed in, for example a failed sign-in or a request with no route rule. |
| `center_id` | The center the entry belongs to. `NULL` when no center is known. |
| `action` | What was attempted, such as `consultation.read`. |
| `target_type` | The kind of record: `consultation`, `appointment`, `user`, `session`, `route`, `audit`, or `chat`. |
| `target_id` | The id of the record. `NULL` when the record is not known. |
| `outcome` | `success`, `denied` (refused by the authorization rules), or `failure` (the action did not complete). |
| `reason` | Internal code for a `denied` or `failure` entry. Never sent to the caller. |
| `ip` | The client address as the API sees it. It depends on `TRUST_PROXY`. |

### Reason codes

| Reason | Meaning |
|---|---|
| `not_found` | The record does not exist. |
| `invalid_id` | The id in the path is empty or longer than 64 characters. |
| `other_center` | The record belongs to another center. |
| `no_center` | The caller has no center. |
| `not_participant` | The record is in the caller's center, but the caller is not its professional or client. |
| `role_not_allowed` | The route does not admit the caller's role. |
| `action_not_allowed` | The caller can read the record but may not act on it. |
| `participant_not_found` | A participant of a new appointment does not exist. |
| `participant_other_center` | A participant of a new appointment belongs to another center. |
| `participant_wrong_role` | A participant of a new appointment has the wrong role. |
| `no_rule` | No route rule matches the request. |
| `appointment_closed` | The appointment is not `scheduled`. A chat message or connection is refused, and a video meeting is not created. |
| `not_configured` | `VIDEO_PROVIDER` is not set, so no meeting can be created. |
| `meet_error`, `meet_timeout`, `meet_quota` | Google Meet failed, hit its time limit, or hit its quota. The meeting moves to Jitsi. |
| `user_not_found` | The verified email has no `users` row. |
| `no_session` | A logout named no live session. |
| `state_unknown`, `attempt_expired`, `binding_mismatch`, `invalid_request`, `provider_returned_error` | The sign-in callback refused the request. |
| Provider codes, such as `email_not_verified`, `nonce_mismatch`, `token_expired`, `token_invalid`, `token_exchange_failed`, `provider_unreachable`, `discovery_failed` | An identity provider check failed. The codes are listed in `api/src/auth/oidc.js`. |

Every 404 for an id the caller may not read carries the same response body as a
404 for a missing id. The reason is kept only in the log.

## Who can read it

`GET /audit` answers only to the `auditor` role. Other roles get `403`, and an
auditor without a center gets `403` too. The endpoint returns the entries of the
auditor's center only, newest first. Entries with `center_id` `NULL`, such as a
failed sign-in for an unknown email, are not visible through the endpoint. Query
parameters are in `docs/API.md`.

## Append-only in the database

The application has no route that changes or removes an entry, and its code has no
`UPDATE` or `DELETE` statement for `audit_log`. The database account of the
application must also lack those privileges, so that a bug or a stolen application
session cannot rewrite the log. Grant only what the application needs:

```sql
-- Run as a database administrator. Replace the placeholders. Do not commit real names.
GRANT SELECT, INSERT ON <database>.audit_log TO '<app_user>'@'<app_host>';
```

Check the result:

```sql
SHOW GRANTS FOR '<app_user>'@'<app_host>';
```

The output must not show `UPDATE` or `DELETE` on `audit_log`. A grant such as
`ALL ON <database>.*` or `UPDATE ON <database>.*` gives those privileges on
`audit_log` too, so replace it with the table grant above.

Limits of this control:

- The migration account needs `ALTER` to apply `0003`. That account can also
  change or drop `audit_log`. Keep it separate from the application account.
- A database administrator can always change the table. Protecting against an
  administrator needs a copy of the log outside the server. That is not built.

## Failures

The write happens before the response. If the database refuses the write, the
request fails with `500` and returns no record. A read is never served without its
audit entry.

## Known gaps

- A request that matches no route rule has no actor. The gate refuses it before the
  session is read, and reading the session there would extend the idle timer of a
  refused request.
- There is no retention job. Entries stay until someone removes them by hand, which
  the application never does.
- The query filters on `center_id` and sorts by `occurred_at`. The only index on the
  table covers `occurred_at`. A large log may need an index on
  `(center_id, occurred_at)` in a later migration.
- A chat message is stored before its `chat.send` entry is written. If the entry write fails, the message stays stored, the sender gets `server_error`, and the other participants do not receive it live. It appears in the history on the next connect.
- A chat connection that ends while it is open, because its session was revoked or its appointment closed, writes no entry. Only the refused attempt to connect again is audited.
- A chat entry records the socket address as `ip`. Behind Apache this is the proxy address, not the client. The REST routes read the client address from `TRUST_PROXY`.
