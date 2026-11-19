# Operations

This page is for the administrator who installs and runs the API on the server.
It names every setting. It never gives a value. Values belong in the environment
of the service, never in this repository.

## Requirements

- Debian with Node.js 22 or later, as `api/package.json` declares.
- Apache in front of the API as the reverse proxy.
- MariaDB, with one database and one user for the API.

## Settings

The reference setup is a systemd `EnvironmentFile` that root owns and that the
service user can read, with mode 0640 or stricter. Each line has the form
`NAME=value`.

### Server

| Variable | Required | Meaning |
|---|---|---|
| `HOST` | No | Address to listen on. Default `127.0.0.1`. |
| `PORT` | No | Port to listen on, from 1 to 65535. Default 3000. |
| `DATABASE_URL` | Yes | MariaDB address in the `mysql://` form. It holds the database password. |
| `TRUST_PROXY` | No | Number of reverse proxies in front of the API, from 0 to 10. Default 0. Use 1 behind Apache. |
| `RATE_LIMIT_WINDOW_MS` | No | Length of the rate-limit window, from 1 to 86400000. Default 60000. |
| `RATE_LIMIT_MAX` | No | Requests allowed per client in one window, from 1 to 1000000. Default 120. |

### Sign-in

Sign-in is on only when `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_REDIRECT_URI`
are all set. Setting only some of them stops the server at startup. Addresses
must use `https`, except `http` for `localhost`.

| Variable | Required | Meaning |
|---|---|---|
| `OIDC_ISSUER` | With sign-in | Address of the identity provider. |
| `OIDC_CLIENT_ID` | With sign-in | Client identifier at the provider. |
| `OIDC_REDIRECT_URI` | With sign-in | Callback address registered at the provider. |
| `OIDC_CLIENT_SECRET` | No | Client secret, when the provider uses one. |
| `OIDC_SCOPE` | No | Requested scopes. Default `openid email profile`. |
| `AUTH_POST_LOGIN_PATH` | No | Path to open after sign-in. It starts with one slash. Default `/`. |
| `SESSION_COOKIE_NAME` | No | Cookie name. Letters, digits, and underscores only. Default `d7_session`. |
| `SESSION_ABSOLUTE_TTL_SECONDS` | No | Longest life of a session. Default 28800 (8 hours). |
| `SESSION_IDLE_TTL_SECONDS` | No | Time without activity before a session ends. Default 1800 (30 minutes). |

An open chat socket counts as activity, so it keeps its session alive. The
absolute limit still ends the session.

### Video

The video settings are described in `docs/VIDEO.md`. Only the names are listed here.

| Variable | Required | Meaning |
|---|---|---|
| `VIDEO_PROVIDER` | No | `meet` or `jitsi`. Any other value stops the server at startup. |
| `JITSI_BASE_URL` | With a provider | Address of the Jitsi server. |
| `JITSI_APP_ID` | No | Set together with `JITSI_JWT_SECRET`, or leave both unset. |
| `JITSI_JWT_SECRET` | No | Signing secret for Jitsi tokens. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | With `meet` | Service account key, as JSON text. |
| `GOOGLE_MEET_DELEGATED_USER` | With `meet` | Workspace user that owns the meetings. |
| `GOOGLE_MEET_API_BASE_URL` | No | Meet API address. Default `https://meet.googleapis.com`. |
| `MEET_TIMEOUT_MS` | No | Time limit for creating a Meet meeting, from 100 to 60000. Default 5000. |

### Chat

| Variable | Required | Meaning |
|---|---|---|
| `CHAT_RETENTION_DAYS` | No | Days a chat message is kept, from 1 to 3650. Default 90. The server checks it at startup, and so does the purge command. |

## Startup

Run the API from the `api` directory with `npm start`, which runs
`node src/server.js`. A systemd unit runs the same command with `WorkingDirectory`
set to that directory and `EnvironmentFile` set to the settings file.

The server checks every setting before it opens a port or a database connection.
An invalid or missing setting stops the process with exit status 1. The process
prints one line that names the variable, and it never prints the value.

Without the `OIDC_*` variables, the server starts with the health probes only.
There is no sign-in, no `/ws` chat route, and no protected API route. Check the
sign-in variables after every install.

- `GET /healthz` answers 200 without touching the database.
- `GET /readyz` answers 200 when the database answers a ping. The server does not
  ping the database at startup.

## Shutdown

`SIGTERM` (sent by `systemctl stop`) and `SIGINT` (Ctrl+C in a terminal) start an
ordered shutdown:

1. Every open chat socket closes with WebSocket code 1001. Clients reconnect and
   receive the recent history.
2. The HTTP server stops accepting connections and lets requests in progress finish.
3. A connection still open after 5 seconds is closed by force.
4. The database pool closes. The process exits with status 0.

A second signal ends the process at once.

## Apache and the client address

- Set `TRUST_PROXY=1` when Apache is the only proxy. Then the rate limit uses the
  client address from `X-Forwarded-For`.
- Keep the `Host` header with `ProxyPreserveHost On`. The chat refuses a WebSocket
  handshake whose `Origin` host differs from the `Host` header.
- Known gap: a chat audit entry records the address of the socket. Behind Apache
  that is the proxy address. Entries of the REST routes record the client address.
  `docs/AUDIT.md` lists this gap.

## Chat retention timer

`api/src/chat/purge.js` deletes the chat messages older than
`CHAT_RETENTION_DAYS`. It writes one `chat.purge` audit entry per run. Run it once
a day with a systemd timer. The paths and the user below are examples. The
packaging task (K-10) sets the real install path and the unit names.

`/etc/systemd/system/doctor7-chat-purge.service`:

```ini
[Unit]
Description=doctor7-onprem chat retention purge

[Service]
Type=oneshot
User=doctor7
WorkingDirectory=/opt/doctor7-onprem/api
EnvironmentFile=/etc/doctor7-onprem/env
ExecStart=/usr/bin/node src/chat/purge.js
```

`/etc/systemd/system/doctor7-chat-purge.timer`:

```ini
[Unit]
Description=Run the doctor7-onprem chat purge every day

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable the timer with `systemctl enable --now doctor7-chat-purge.timer`. Read the
result of the last run with `journalctl -u doctor7-chat-purge.service`.

The command prints one line with the number of deleted messages and exits with:

| Status | Meaning |
|---|---|
| 0 | The purge ran. |
| 2 | A setting is missing or invalid: `DATABASE_URL` or `CHAT_RETENTION_DAYS`. |
| 1 | The database failed. The line holds the error code only. |
