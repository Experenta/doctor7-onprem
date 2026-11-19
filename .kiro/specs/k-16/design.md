# K-16 Design

## Layout

```
api/src/config.js     loadConfig(env), requireDatabaseUrl(config)
api/src/app.js        createApp; exposes app.locals.audit beside app.locals.auth
api/src/server.js     createServer({ db, config, ... }), shutdown(server, opts), start(env)
api/src/server.test.js     HTTP, upgrade, shutdown, and start tests (in-memory stores)
api/src/config.test.js     validation messages, DATABASE_URL, docs/OPERATIONS.md names
docs/OPERATIONS.md    variable names, startup, shutdown, proxy, purge timer
```

`api/src/chat/index.js` and `api/src/video/index.js` keep their contracts. Neither
needs a change for the wiring.

## Assembly

```
loadConfig(env) ──► config
                      │
createServer({ db, config, stores })
   ├─ createApp({ db, rateLimit, trustProxy, auth, careStore, auditStore, video })
   │     └─ when sign-in is on: app.locals.auth (sessions), app.locals.audit
   ├─ http.createServer(app)
   ├─ 'connection' listener: records every socket, for forced close
   └─ when sign-in is on: createChat({ sessions, audit, cookieName, ... }).attach(server)
```

`start(env)` does `loadConfig`, `requireDatabaseUrl`, `createPool`, `createDatabase`,
`createServer`, and `listen`. It registers the signal handlers.

The chat object and the set of sockets live in a `WeakMap` keyed by the server.
The server object itself is the plain `http.Server`, as the task asks.

## Configuration

`loadConfig` reads every setting in one function. It does not require
`DATABASE_URL`, because the existing test `auth.units.test.js` calls
`loadConfig({})` with no database. `requireDatabaseUrl` does that check, and
`start()` calls it.

Each error names the variable and never prints the value. The existing modules
already follow this, with one exception that `config.js` covers:

| Module | Behavior | Handled by |
|---|---|---|
| `video/config.js`, `VIDEO_PROVIDER` | Message ends with `Got "<value>"` | `config.js` checks the name before it calls `loadVideoConfig` |
| `video/config.js`, other variables | Fixed messages, names only | none needed |
| `auth/config.js` | Names only | none needed |
| `purge.js`, `CHAT_RETENTION_DAYS` | Fixed message | reused by `config.js` |

## Shutdown

`shutdown(server, { db, graceMs })`, in this order:

1. `chat.close()`. Each open chat socket gets close code 1001 with reason
   `server_shutdown`. The chat also clears its sweep timer.
2. `server.close(cb)`. The callback runs when every connection has ended. Node
   counts upgraded sockets too, so the callback waits for the WebSocket close.
3. A timer of `graceMs` (5000 ms in `start`) destroys every socket still open. It
   is cleared when the callback runs first.
4. `db.close()`, which ends the pool.

`start` calls `process.exit(0)` after `shutdown` resolves. A failure exits with 1.
The handlers are registered with `once`, so a second signal uses the default
behavior and ends the process.

## Decisions

| ID | Decision | Why |
|---|---|---|
| D1 | `DATABASE_URL` is required by `start()` and not by `loadConfig`. | Keeps `loadConfig({})` working in the existing tests. The check still runs on every real start. |
| D2 | The provider name is checked in `config.js` before `loadVideoConfig`. | `video/config.js` is out of scope. The check keeps the value out of the message. |
| D3 | Sign-in disabled means no chat and no protected routes. The server still starts. | This is the rule in `auth/config.js`. Whether a server without sign-in should refuse to start is open item O3. |
| D4 | `createServer` and `shutdown` are separate exports. Tests call `shutdown` with a 200 ms grace period. | Tests can check the close code and the timing without calling `process.exit`. |
| D5 | The chat and the API share one audit sink, `app.locals.audit`. | The chat audit must go to the same log as the API audit. |
| D6 | The grace period is 5 seconds. | The WebSocket close handshake finishes at once for a client that answers. Five seconds leaves room for a slow client without holding the service on a stopped one. |
| D7 | `TRUST_PROXY` allows 0 to 10. `PORT`, the rate-limit values, and the retention days have fixed ranges. | Bad values fail at startup, not in the first request. The ranges are a choice of this task. The PM can change them. |
| D8 | The chat audit records the socket address as `ip`, as before. | Fixing it means changing `gateway.js`, which is out of scope. See O1. |

## Open items

- **O1. Client address in chat audit entries.** `gateway.js` reads
  `req.socket.remoteAddress`. Behind Apache this is the proxy address. Reading
  `X-Forwarded-For` with the same rule as Express needs `gateway.js` to receive the
  `trust proxy` value and the request headers. The PM decides whether that
  change goes into a new task.
- **O2. Provider name echoed by `video/config.js`.** `loadVideoConfig` still quotes
  the value in its own message. Startup avoids it, but a direct caller of
  `loadVideoConfig` still gets the value. The fix is a one-line change in
  `video/config.js`. That file is outside this scope.
- **O3. Server without sign-in.** The server starts with only the probes when no
  OIDC variable is set. The PM decides whether a production start should require
  sign-in.
- **O4. Database reachable at startup.** `start()` does not ping the database. The
  first `/readyz` call reports the state.
- **O5. Two `createApp` fallbacks read `process.env`.** `app.js` reads
  `loadVideoConfig(process.env)` when no video config is passed. `createServer`
  always passes one, so the service does not use the fallback. The fallback
  remains for the existing tests.
