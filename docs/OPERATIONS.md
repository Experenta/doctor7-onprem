# Operations

This page is for the administrator who installs and runs the API on the server.
It names every setting. It never gives a value. Values belong in the environment
of the service, never in this repository.

## Requirements

- Debian 13 with Apache 2.4. The server runs without containers.
- Node.js 22 or later, as `api/package.json` declares. The packages do not
  install it. The service looks for Node in this order: `NODE_BIN` from
  `/etc/doctor7/api.env`, then `/opt/node/current/bin/node`, then `node` in
  `PATH`. It starts with the first one that runs and is version 22 or later.
- MariaDB, with one database and one user for the API. The packages do not
  install it. It runs on its own node or service.

## Packages

| Package | Content |
|---|---|
| `doctor7-api` | API code with production dependencies, `doctor7-api.service`, the chat purge service and timer, backup and restore commands, the `doctor7` service user. |
| `doctor7-web` | Static files of the web application and the Apache virtual host. |

| Path | Content |
|---|---|
| `/usr/lib/doctor7/api` | API code. `start-api.sh` and `run-task.sh` sit one level above. |
| `/usr/lib/doctor7/node_modules` | Production dependencies. |
| `/etc/doctor7/api.env` | API settings. Root-owned, mode 0600. |
| `/etc/doctor7/backup.conf`, `/etc/doctor7/backup.cnf` | Backup settings and database client options. Mode 0600. |
| `/etc/doctor7/web.vars.conf` | Apache variables of the virtual host. |
| `/var/lib/doctor7` | State directory of the service (the files layer). |
| `/usr/share/doctor7/web` | Static files. |
| `/etc/apache2/sites-available/doctor7.conf` | Apache virtual host. |

### Build

Run these on a machine with Node.js, npm and, for real `.deb` files, `dpkg-deb`:

```sh
npm run build --workspace=web
node packaging/build-deb.js all --out /tmp/doctor7-debs
```

The builder runs `npm ci --omit=dev` for the API, so the package carries its
dependencies and the install runs no `npm`. Without `dpkg-deb`, the builder
checks every input and leaves the package trees in the output directory. A
missing input stops the build with a message that says what to fix.

### Install

```sh
sudo packaging/scripts/install.sh /tmp/doctor7-debs
```

Then, for the API:

1. Set `DATABASE_URL` and the sign-in variables in `/etc/doctor7/api.env`. The
   callback address registered at the identity provider is
   `https://<host>/api/auth/callback`, and `OIDC_REDIRECT_URI` must be the same.
2. Run the migrations:
   `systemd-run --wait --pipe --collect -p User=doctor7 -p EnvironmentFile=/etc/doctor7/api.env /usr/lib/doctor7/run-task.sh migrate up`
3. `systemctl start doctor7-api`

For the web package, set the values in `/etc/doctor7/web.vars.conf`, then
`a2ensite doctor7 && apache2ctl configtest && systemctl reload apache2`.
The package enables the Apache modules `proxy`, `proxy_http`, `proxy_wstunnel`,
`headers`, `rewrite`, `deflate`, `expires` and `ssl`. It does not enable the
site and it does not create a certificate.

### Apache variables

| Variable | Meaning |
|---|---|
| `SERVER_NAME` | Host name of the site. It is also the WebSocket host in the content policy. |
| `JITSI_ORIGIN` | Origin of the Jitsi server, such as `https://jitsi.clinic.example`. It goes into `frame-src` and into the camera and microphone permissions. Without Jitsi, use the site origin. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Certificate chain and private key. The certificate is managed outside the packages. |
| `API_UPSTREAM` | Host and port of the API. |

What the virtual host does:

- `/api/` goes to the API with the prefix removed: `/api/auth/me` reaches the API
  as `/auth/me`. `/ws` goes to the API without a prefix.
- The API sets cookies with `Path=/auth` (sign-in attempt) and `Path=/` (session).
  `ProxyPassReverseCookiePath /auth /api/auth` and
  `ProxyPassReverseCookiePath / /api/` map them to the public paths. Without them
  the browser does not send the sign-in cookie to `/api/auth/callback`, and sign-in
  fails. Keep the two lines in this order.
- HTML responses carry a `Content-Security-Policy` that allows only the site, the
  WebSocket host and the Jitsi origin, with no inline script or style. Every
  response carries HSTS, `X-Content-Type-Options`, `Referrer-Policy` and
  `Permissions-Policy`.
- A path without a file gets `index.html`, so client-side routes work on reload.

## Settings

The reference setup is a systemd `EnvironmentFile`: `/etc/doctor7/api.env`, owned
by root, mode 0600. systemd reads it as root before it drops privileges, so the
service user does not need to read it. The package creates it from a template
that holds names only, and never overwrites an existing file. Each line has the
form `NAME=value`. A value with spaces or JSON goes in single quotes.
`/usr/share/doctor7/api.env.example` is the template.


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

The unit `doctor7-api.service` runs `/usr/lib/doctor7/start-api.sh`, which
starts `node src/server.js` in `/usr/lib/doctor7/api` with the Node it found.
It runs as the user `doctor7` with `NoNewPrivileges=true` and
`ProtectSystem=strict`. Only `/var/lib/doctor7` is writable. In a development
checkout, `npm start` in `api` runs the same command.

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
a day with a systemd timer. The `doctor7-api` package installs and enables it:
`doctor7-chat-purge.timer` runs `doctor7-chat-purge.service` every day at 03:15
as the user `doctor7`, with the same settings file as the API.

Run it once by hand with `systemctl start doctor7-chat-purge.service`. Read the
result of the last run with `journalctl -u doctor7-chat-purge.service`.

The command prints one line with the number of deleted messages and exits with:

| Status | Meaning |
|---|---|
| 0 | The purge ran. |
| 2 | A setting is missing or invalid: `DATABASE_URL` or `CHAT_RETENTION_DAYS`. |
| 1 | The database failed. The line holds the error code only. |

## Backup and restore

`doctor7-backup` and `doctor7-restore` work on one layer at a time. Run them as
root on the API host.

| Layer | Content | Archive |
|---|---|---|
| `app` | `/usr/share/doctor7/web`, the Apache virtual host, `/etc/doctor7/web.vars.conf` | `app/app-<time>.tar.gz` |
| `api` | `/usr/lib/doctor7` (code and dependencies), `/etc/doctor7/api.env` | `api/api-<time>.tar.gz` |
| `db` | Dump of the MariaDB database | `db/db-<time>.sql.gz` |
| `files` | `/var/lib/doctor7` | `files/files-<time>.tar.gz` |

Set up once:

1. Copy `/usr/share/doctor7/backup.cnf.example` to `/etc/doctor7/backup.cnf`, fill
   in host, user and password, set mode 0600. The scripts pass it with
   `--defaults-extra-file`, so the password never shows in the process list.
2. Edit `/etc/doctor7/backup.conf`: backup directory, database name, retention.

```sh
doctor7-backup db          # one layer
doctor7-backup all         # app, api, db and files, in this order
doctor7-restore db /var/backups/doctor7/db/db-20260101T020000Z.sql.gz
```

- Archives and their `.sha256` files have mode 0600. The `api` archive holds
  `api.env`, which holds secrets. Encrypt it before it leaves the server.
- `all` stops at the first layer that fails. On a host without the web package,
  the `app` layer fails because its paths do not exist: back up the other
  layers one by one.
- `doctor7-restore` checks the checksum, refuses archives with absolute or `..`
  paths, and asks you to type `restore`. `--yes` skips the question.
- Restoring `api`, `files` or `db` stops the API and starts it again if it was
  running. If the restore fails, the API stays stopped.
- The `files` layer is empty today: the API does not write to `/var/lib/doctor7`.
  The layer exists so the procedure stays the same when it does.
- Schedule `doctor7-backup all` with cron or a systemd timer, and copy the
  backup directory to another machine. Test a restore on a spare host.
- A backup user needs `SELECT`, `SHOW VIEW`, `TRIGGER`, `EVENT` and
  `LOCK TABLES`. A restore needs more rights on the database.

## Upgrade and rollback

Keep the `.deb` files of every release in a directory of their own, for example
`/srv/doctor7-releases/<version>/`.

Upgrade:

```sh
sudo packaging/scripts/upgrade.sh /srv/doctor7-releases/<new-version>
```

The script backs up all layers, installs the new packages, runs the database
migrations, restarts the API, and checks `/readyz`
(`DOCTOR7_HEALTH_URL` changes the address). It stops at the first failure and
prints the rollback command. It never rolls back by itself. Apache keeps the
changed virtual host file as a conffile: `dpkg` asks before it replaces a file
you edited.

Rollback:

```sh
sudo packaging/scripts/rollback.sh /srv/doctor7-releases/<old-version> [db-archive]
```

The script installs the older packages (a downgrade). Pass the `db` archive that
the upgrade made first when the new release changed the schema, because older
code may not work with a newer schema. Restoring it discards every change made
after that backup. Without a schema change, leave the archive out. Check the
migration list with `run-task.sh migrate status` before you decide.

Settings files in `/etc/doctor7` are not touched by an upgrade or a rollback.
`apt-get remove` keeps them. `apt-get purge` deletes `api.env`, `backup.conf` and
`web.vars.conf`. It keeps `/var/lib/doctor7`, the backups, and the `doctor7`
user.
