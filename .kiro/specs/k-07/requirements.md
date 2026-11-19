# K-07 Requirements: per-appointment chat over WebSocket

## Introduction

Each appointment has one chat between its professional and its client. The chat
runs on a WebSocket at `/ws`. Every message is stored in `chat_messages`. The
client and the server agree on the order of messages, and a client that
reconnects receives the recent history. The chat closes when the appointment
closes.

This task adds no attachments, notifications, or presence, and it changes
nothing in `web/`.

## Requirements

### R1. Who may connect

Acceptance criteria:

1. `GET /ws?appointment=<id>` with an Upgrade request opens the chat. Any other path answers `404` and does not upgrade.
2. Without a live session the handshake answers `401 unauthenticated`. No audit entry is written.
3. Only the professional or the client of the appointment, in the appointment's center, may connect. Every other caller gets `404 not_found` with the same body: a missing appointment, an appointment of another center, a same-center user who is not a participant (an administrator, for example), and an auditor. Each refusal is audited as `chat.connect` with outcome `denied` and a reason from `docs/AUDIT.md`.
4. A handshake whose `Origin` header names a host other than the `Host` header answers `403 forbidden`. A handshake without `Origin` is not refused for this reason.
5. A missing or empty `appointment` parameter answers `400 invalid_request`.
6. A closed appointment answers `410 appointment_closed` and is audited as `denied` with reason `appointment_closed`.
7. A connection that opens writes one `chat.connect` entry with outcome `success`.

### R2. History on connect and reconnect

Acceptance criteria:

1. On connect the server sends `{"type":"history","items":[...]}` with the 50 most recent messages of the appointment, oldest first.
2. Messages of other appointments are never included.
3. A client that reconnects receives the messages stored while it was away, when they are among the 50 most recent.

### R3. Sending and persistence

Acceptance criteria:

1. A client sends `{"type":"message","body":"<text>"}`.
2. The server stores the message in `chat_messages` with the sender's user id, the body, and `sent_at`. Then it sends `{"type":"message","message":{...}}` to every open connection of the appointment, the sender included.
3. Each stored message writes one `chat.send` entry with outcome `success`. The entry never contains the body.
4. No connection receives a message before it is stored.

### R4. Order

Acceptance criteria:

1. Within one appointment, `sent_at` strictly increases for every stored message, even when the clock repeats a millisecond.
2. The broadcast order, the stored order, and the history order are the same, also when several connections send at the same time.

### R5. Limits and invalid input

Acceptance criteria:

1. A body longer than 2000 UTF-8 bytes is refused with `{"type":"error","error":{"code":"message_too_large","message":"..."}}`. The message is not stored, nobody receives it, and the connection stays open.
2. A frame larger than 16 KiB closes the connection with WebSocket close code 1009.
3. A frame that is not JSON, is not an object, has a field other than `type` and `body`, has another type, or has an empty body is refused with error code `invalid_message`. It writes no audit entry.

### R6. Closing the chat

Acceptance criteria:

1. An appointment is closed when its status is not `scheduled`, which means `completed` or `cancelled`.
2. When a participant sends a message to a closed appointment, the server answers `appointment_closed`, writes a `chat.send` entry with outcome `denied` and reason `appointment_closed`, and closes the connection with code 4001. Nothing is stored.
3. Open connections of a closed appointment close within one sweep interval, 30 seconds by default, even when nobody sends a message.

### R7. Session end

Acceptance criteria:

1. A revoked or expired session closes its open chat connections with code 4002 on the next message or within one sweep interval.

### R8. Retention

Acceptance criteria:

1. `node api/src/chat/purge.js` deletes messages whose `sent_at` is older than `CHAT_RETENTION_DAYS` days. The default is 90. The value must be an integer from 1 to 3650.
2. Each run writes one `chat.purge` entry with outcome `success`.
3. The command prints only the number of deleted messages. It never prints `DATABASE_URL` or message text.

### R9. Corrections carried over from K-06

Acceptance criteria:

1. `npm test` runs `tools/**/*.test.js`. `README.md` and `CLAUDE.md` show the same command.
2. `docs/AUDIT.md` lists `meeting.create_meet`, `meeting.create_jitsi`, `meeting.failover`, and `meeting.create` (refusals and the not-configured failure), together with the chat actions and their reason codes.
3. `readDenialReason` is defined once, in `api/src/care/router.js`. `api/src/video/router.js` imports it.

### R10. Documentation and scope

Acceptance criteria:

1. `docs/API.md` documents `/ws`, its refusals, its close codes, and its frame formats.
2. Only the files named in the task change. `web/` does not change. `ws` is the only dependency added, and the PM installed it.

## Out of scope

- Attachments, notifications, and presence.
- Any change to `web/`.
- Mounting the WebSocket in `api/src/server.js` or `api/src/app.js`. Those files are not in the task scope. See `design.md`, open item O1.
