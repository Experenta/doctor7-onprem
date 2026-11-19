# K-07 Design

## Layout

```
api/src/chat/
  protocol.js     wire formats, size limits, close codes, error texts, parser
  sequence.js     per-appointment queue and strictly increasing send times
  access.js       who may use the chat, and whether the appointment is closed
  store.js        SQL store for chat_messages (bound parameters only)
  memoryStore.js  in-memory store with the same contract (tests)
  gateway.js      WebSocket server: handshake, frames, broadcast, sweep
  index.js        createChat({ ... }) -> { attach, sweep, close }
  purge.js        purgeExpiredMessages and the command-line entry point
  harness.js      test setup (not a test file)
  *.test.js       tests
.kiro/specs/k-07/ requirements.md, design.md, tasks.md
docs/API.md       /ws section and the refusals
docs/AUDIT.md     chat actions, K-06 meeting actions, reason codes
```

Other changes, all listed in the task: `api/src/care/router.js` exports
`readDenialReason`, `api/src/video/router.js` imports it, the root `npm test`
script and the commands in `README.md` and `CLAUDE.md` include `tools/`.
`api/package.json` and `package-lock.json` declare `ws`, which the PM installed.

## Handshake

The upgrade runs these checks in order. Each refusal is answered before the
upgrade, with the API error shape in the body.

| Step | Check | Refusal |
|---|---|---|
| 1 | Path is `/ws` | `404 not_found`, no audit |
| 2 | `Origin`, when sent, has the same host as `Host` | `403 forbidden`, no audit |
| 3 | Session cookie names a live session (`sessions.authenticate`) | `401 unauthenticated`, no audit |
| 4 | `appointment` query parameter is a valid id | `400 invalid_request`, no audit |
| 5 | Appointment exists | `404 not_found`, audit `denied` with reason `not_found` |
| 6 | Caller may read it and is its professional or client | `404 not_found`, audit `denied` with the reason from `readDenialReason`, or `not_participant` |
| 7 | Appointment is `scheduled` | `410 appointment_closed`, audit `denied` with reason `appointment_closed` |
| 8 | Write audit `chat.connect` success, then upgrade | |

Refusals 5 and 6 use one body, so a caller cannot tell a missing id from another
center's id. The same rule as `GET /appointments/:id`.

## Messages

Client frame: `{"type":"message","body":"<text>"}`. The parser accepts only these
two keys. The body must be a non-empty string of at most 2000 UTF-8 bytes.

Server frames:

- `{"type":"history","items":[<message>...]}`, sent once after the upgrade.
- `{"type":"message","message":<message>}`, sent to every open connection of the
  appointment, the sender included.
- `{"type":"error","error":{"code":"...","message":"..."}}`.

`<message>` is `{"id","appointmentId","senderId","body","sentAt"}`. `sentAt` is ISO
8601 UTC.

Per frame, in the appointment queue (see Ordering):

1. Session still live (`sessions.authenticate`). If not: close 4002.
2. Appointment read again. If it is closed: `appointment_closed`, audit `chat.send`
   denied, close 4001. If it is no longer readable by the caller: close 4003.
3. Binary frame or invalid JSON: `invalid_message`. Body too large:
   `message_too_large`. Neither writes an audit entry, the same as validation
   failures on the REST routes.
4. Insert into `chat_messages`, then write audit `chat.send` success.
5. Broadcast to the room.

## Ordering

`sequence.js` keeps one promise chain per appointment. Every task of one
appointment runs after the previous one finishes. The chat uses the chain for:

- Each join, which loads the history and then joins the room. A broadcast queued
  before the join runs before it, so it is covered by the history. A broadcast
  queued after the join is sent live. Neither case duplicates or misses a message.
- Each inbound frame, so frames of one connection keep their arrival order.
- Each send, which stamps `sent_at` and inserts the row before the next task runs.

`stamp(appointmentId)` returns `now()`, or one millisecond after the previous
stamp of the same appointment when the clock repeats. Stamps therefore strictly
increase in the process. The chain is per process, so the design assumes one API
process writes the chat. The on-prem install runs one process. A second process
would need a database sequence, which is a later decision.

## Closing and sweeps

`sweep()` runs every `sweepIntervalMs` (30 s by default, `unref`'d so it does not
keep the process alive). For each open connection it does two checks, in order:

1. `sessions.authenticate(token)`. A null result closes the connection with 4002.
2. The appointment is read again. Missing or no longer readable closes with 4003.
   Closed closes with 4001.

Closing a connection removes it from the room at once, so it receives nothing
more.

## Retention

`purge.js` deletes `chat_messages` rows with `sent_at` older than
`now - CHAT_RETENTION_DAYS`, then writes one `chat.purge` entry. It is a command
for cron or a systemd timer:

```sh
DATABASE_URL=... CHAT_RETENTION_DAYS=90 node api/src/chat/purge.js
```

The command prints one line with the count and exits with status 0. A
configuration error exits with 2 and prints the fixed configuration message. A
database error exits with 1 and prints the error code only.

## Decisions and assumptions

These choices were made in the spec. The PM should confirm each one.

| ID | Assumption | Why |
|---|---|---|
| A1 | An appointment is closed when its status is `completed` or `cancelled`. | The schema has no `closed` state, and no route changes the status yet. |
| A2 | Default retention is 90 days, per message. | The task asks for a purge but gives no period. The PM sets the real value through `CHAT_RETENTION_DAYS`. |
| A3 | Limits: 2000 UTF-8 bytes per message, 16 KiB per frame, 50 messages of history, 30 s sweep. | The task gives no numbers. |
| A4 | Each frame and each sweep call `sessions.authenticate`, which counts as activity. | Revocation and absolute expiry must stop a chat within one sweep. The trade-off: an open chat socket extends the idle timer, so the 30-minute idle limit does not end a session while its chat socket is open. The 8-hour absolute limit still applies. |
| A5 | The `Origin` host must equal the `Host` header. | Stops cross-site WebSocket hijacking. Apache must keep the `Host` header, which needs `ProxyPreserveHost On`. K-10 documents this. |
| A6 | Chat audit entries store the socket address as `ip`. | Frames have no Express request. Behind Apache this is the proxy address, while the REST routes read `req.ip` with `TRUST_PROXY`. Listed in `docs/AUDIT.md` as a known gap. |
| A7 | Chat messages are stored as sent. The server does not sanitize HTML. | The clients must escape text on display. Input checks stay at size and shape. |

## Open items

- **O1, blocking for a running server.** `api/src/server.js` or `api/src/app.js`
  must call `createChat({...}).attach(server)` after `createApp`, with
  `sessions` from `app.locals.auth`, `cookieName` from the auth config, and the
  database. Those files are not in the K-07 scope. The module is complete and
  tested without that wiring. Until the wiring lands, `/ws` does not exist on a
  running server.
- **O2.** The purge needs a schedule (cron or systemd timer). The packaging task
  (K-10) owns it.
- **O3.** A message is stored before its `chat.send` entry is written. If the
  entry write fails, the message stays stored, the sender gets `server_error`,
  and nobody receives it live. It appears in the history on the next connect.
  Making both writes atomic needs one transaction across the chat and audit
  stores. This is a design choice for the PM.
- **O4.** The chat queue and the sequence stamps live in one process. See the
  Ordering section.

## Error and close codes

| Where | Code | Meaning |
|---|---|---|
| HTTP handshake | 400 `invalid_request` | `appointment` parameter missing or invalid |
| HTTP handshake | 401 `unauthenticated` | No live session |
| HTTP handshake | 403 `forbidden` | `Origin` host differs from `Host` |
| HTTP handshake | 404 `not_found` | Missing, other center, not a participant, or auditor |
| HTTP handshake | 410 `appointment_closed` | Appointment not `scheduled` |
| Frame error | `invalid_message`, `message_too_large`, `appointment_closed`, `session_ended`, `access_lost`, `server_error` | Per frame, the socket stays open unless a close follows |
| WebSocket close | 1001 | Server shutdown |
| WebSocket close | 1009 | Frame larger than 16 KiB (set by `ws`) |
| WebSocket close | 4001 | Appointment closed |
| WebSocket close | 4002 | Session ended or revoked |
| WebSocket close | 4003 | Caller lost access to the appointment |
