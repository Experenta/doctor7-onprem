# K-16 Requirements: server wiring, configuration at startup, clean shutdown

## Introduction

The chat (`api/src/chat/`) and the video router (`api/src/video/`) are built and
tested, but `api/src/server.js` does not mount them. A running process has no
`/ws` and no video route. This task connects them, loads all configuration in one
place, and makes startup and shutdown predictable for the Debian service.

This task adds no API route, changes no authorization rule, and does not touch
`web/` or `packaging/`.

## Requirements

### R1. Server assembly

Acceptance criteria:

1. `createServer({ db, config, ... })` returns an HTTP server. The server answers
   every request with the Express application from `createApp`.
2. The same server handles the `upgrade` event for `/ws` with the chat from
   `createChat`. The chat uses the session service, the audit sink, and the cookie
   name of the sign-in module, so the same objects serve the API and the chat.
3. The chat is mounted only when sign-in is configured. Without sign-in, `/ws` has
   no handler, and the probes still answer.
4. `start()` builds the server with a connection pool created from `DATABASE_URL`,
   and listens on `HOST` and `PORT`.

### R2. Configuration loaded once, at startup

Acceptance criteria:

1. `loadConfig` reads every runtime setting: host, port, database address, proxy
   trust, rate limit, sign-in, video, and chat retention.
2. An invalid value stops the process before it opens a socket or a pool. The
   message names the variable.
3. No message contains a value. Values include credentials and signing keys, so
   the check is on the variable name only.
4. `DATABASE_URL` is required by `start()` and must be a `mysql://` URL with a
   host.
5. An invalid `VIDEO_PROVIDER` stops startup with a message that names the variable
   and does not repeat the value.
6. `TRUST_PROXY` must be a whole number from 0 to 10.
7. `PORT` must be a whole number from 1 to 65535. `RATE_LIMIT_WINDOW_MS` must be
   from 1 to 86400000. `RATE_LIMIT_MAX` must be from 1 to 1000000.
8. `CHAT_RETENTION_DAYS` is checked at startup with the rule of the purge command,
   so a bad value in the shared environment also stops the server.
9. Sign-in rules stay as they are in `api/src/auth/config.js`.

### R3. Clean shutdown

Acceptance criteria:

1. On `SIGTERM` or `SIGINT`, every open chat socket closes with WebSocket code
   1001.
2. The HTTP server stops accepting connections and waits for open requests to end.
3. A connection that is still open after 5 seconds is destroyed, so a client that
   never answers cannot hold the process.
4. The database pool closes. The process then exits with status 0.
5. A second signal ends the process at once, because the first handler is removed
   after it runs.

### R4. Chat purge timer

Acceptance criteria:

1. `docs/OPERATIONS.md` documents the purge command and a systemd timer for it.
2. The documented exit codes match `api/src/chat/purge.js`: 0 for success, 2 for a
   configuration error, 1 for a database error.

### R5. Tests and scripts

Acceptance criteria:

1. The `test` script of `api/package.json` runs `src/**/*.test.js` and
   `test/**/*.test.js`.
2. `.kiro/steering/tech.md` shows the same root test command as `package.json`.
3. The existing tests still pass.

### R6. Scope

Acceptance criteria:

1. Only the files named in the task change.
2. No dependency is added. No file in `web/` or `packaging/` changes.

## Out of scope

- `ALLOWED_ORIGINS`. The repository has no such variable, so there is nothing to
  load.
- The client IP in chat audit entries. The gateway reads the socket address. A fix
  needs a change to `api/src/chat/gateway.js`, which is not in this scope. See
  `design.md`, open item O1.
- The message of `api/src/video/config.js`, which quotes the rejected provider
  name. That file is not in this scope. See `design.md`, open item O2.
- Running `start()` in a test against a real database.
- Systemd unit files for the install. K-10 owns the packaging.
