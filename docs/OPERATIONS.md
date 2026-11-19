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
| `doctor7-demo` | Demo only. Mock identity provider, its unit, the `/idp/` fragment of the virtual host, and the Google Meet simulator with its unit. Not in `all`. See the Demo package section. |

| Path | Content |
|---|---|
| `/usr/lib/doctor7/api` | API code. `start-api.sh` and `run-task.sh` sit one level above. |
| `/usr/lib/doctor7/VERSION` | Package version and build date, read by `GET /version`. |
| `/usr/lib/doctor7/node_modules` | Production dependencies. |
| `/etc/doctor7/api.env` | API settings. Root-owned, mode 0600. |
| `/etc/doctor7/backup.conf`, `/etc/doctor7/backup.cnf` | Backup settings and database client options. Mode 0600. |
| `/etc/doctor7/web.vars.conf` | Apache variables of the virtual host. |
| `/etc/doctor7/vhost-demo.conf` | `/idp/` lines, from `doctor7-demo`. |
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

### Build versions

The builder takes the package version from the first source that is set:

1. `--version V`.
2. The environment variable `D7_VERSION`. An empty value counts as unset.
3. git: `<version of the root package.json>+git<commit count>.<short hash>-1`, for
   example `0.0.0+git42.abc1234-1`. The commit count is the number of commits that
   `HEAD` reaches. The tree must be the top of its own git repository.
4. No git: `<version of the root package.json>-1`, with a warning.

Every version must start with a digit and use only letters, digits, and `. + ~ -`.
Any other value stops the build, and the message names the source of the value.

`apt` installs a package as an upgrade only when its version is newer. The commit
count rises with each commit on one branch. A build from another branch can have a
lower count, so build releases from one branch, or set `D7_VERSION` to a version of
your own:

```sh
D7_VERSION=2026.11.1-1 node packaging/build-deb.js all --out /tmp/doctor7-debs
```

The `doctor7-api` package also holds `/usr/lib/doctor7/VERSION`. It has two lines,
`version=` and `build-date=`, with the version and the time of the build. `GET /version`
reads that file (see `docs/API.md`).

### Install

```sh
sudo packaging/scripts/install.sh /tmp/doctor7-debs
```

Then, for the API:

1. Set `DATABASE_URL` and the sign-in variables in `/etc/doctor7/api.env`. The
   callback address registered at the identity provider is
   `https://<host>/api/auth/callback`, and `OIDC_REDIRECT_URI` must be the same.
2. Run the migrations. They create every table, including `meetings` from
   `0005_meetings.sql`, which stores one video meeting per appointment:
   `systemd-run --wait --pipe --collect -p User=doctor7 -p EnvironmentFile=/etc/doctor7/api.env /usr/lib/doctor7/run-task.sh migrate up`
3. `systemctl start doctor7-api`

For the web package, set the values in `/etc/doctor7/web.vars.conf`, then
`a2ensite doctor7 && apache2ctl configtest && systemctl reload apache2`.
The package enables the Apache modules `proxy`, `proxy_http`, `proxy_wstunnel`,
`headers`, `rewrite`, `deflate`, `expires` and `ssl`. It does not enable the
site and it does not create a certificate.

### Configuration files and reinstall

A conffile is a package file that dpkg tracks. When a new package version changes
it, dpkg decides whether the file on the server or the file of the package wins.
A local value is a settings file that the administrator fills in. No package ships
a local value. The postinst creates it from a template when it is missing, and it
never overwrites it.

| File | Kind | Package | Created by | On reinstall or upgrade |
|---|---|---|---|---|
| `/etc/apache2/sites-available/doctor7.conf` | conffile | `doctor7-web` | the package | dpkg asks when you changed the file, unless you pass an option below. |
| `/etc/doctor7/web.vars.conf` | local value | `doctor7-web` | postinst, from `web.vars.conf.example`, when missing | Not touched. |
| `/etc/doctor7/api.env` | local value | `doctor7-api` | postinst, from `api.env.example`, when missing | Not touched. |
| `/etc/doctor7/backup.conf` | local value | `doctor7-api` | postinst, from `backup.conf.example`, when missing | Not touched. |
| `/etc/doctor7/backup.cnf` | local value | none | the administrator, from `backup.cnf.example` | Not touched. It holds the database password. |
| `/etc/doctor7/idp-demo.env` | local value | `doctor7-demo` | postinst, from `idp-demo.env.example`, when missing | Not touched. |
| `/etc/doctor7/vhost-demo.conf` | package file, not a conffile | `doctor7-demo` | the package | Replaced on each install. It holds no value, so no local edit is kept. |
| `/usr/share/doctor7/*.example` | package file | all | the package | Replaced on each install. They are templates. |

Two options answer the dpkg question about a conffile without a prompt:

- `--force-confold` keeps the local file, the one on the server. Use it when you
  changed the virtual host here and want to keep the change. dpkg keeps a copy of the
  file it did not install beside it, with a `.dpkg-` suffix. Read that copy before the
  next upgrade.
- `--force-confnew` takes the file of the package. Use it to go back to the package
  version. Your edits are lost from the file, and dpkg keeps a copy of them beside it,
  with a `.dpkg-` suffix.

```sh
sudo dpkg -i --force-confold ./doctor7-web_<version>_all.deb
sudo dpkg -i --force-confnew ./doctor7-web_<version>_all.deb
```

Neither option changes a local value, because local values are not conffiles.
The install and upgrade scripts in `packaging/scripts/` pass neither option to
`apt-get`. Check the dpkg question on the terminal, or pass one of the options when
you run the package tools by hand.

### Apache variables

| Variable | Meaning |
|---|---|
| `SERVER_NAME` | Host name of the site. It is also the WebSocket host in the content policy. |
| `JITSI_ORIGIN` | Origin of the Jitsi server, such as `https://meet.demo.example.test`. It is not the origin of the site: the `frame-src` policy checks the Jitsi iframe against it, so an iframe from any other origin is blocked. It also goes into the camera and microphone permissions. Required even when Jitsi is not used. `docs/DEMO.md` describes the Jitsi node. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Certificate chain and private key. The certificate is managed outside the packages. |
| `API_UPSTREAM` | Host and port of the API. |

What the virtual host does:

- `/api/` goes to the API with the prefix removed: `/api/auth/me` reaches the API
  as `/auth/me`. `/ws` goes to the API without a prefix.
- The API sets the sign-in cookie with `Path=/auth` and the session cookie with
  `Path=/`. `ProxyPassReverseCookiePath /auth /api/auth` maps the sign-in cookie to
  the public path, so the browser sends it back to `/api/auth/callback`. Without
  that rule, sign-in fails. The session cookie keeps `Path=/`, so the browser also
  sends it to `/ws`. Do not add `ProxyPassReverseCookiePath / /api/`. It hides the
  session cookie from `/ws`, and the chat then fails with 401 and "chat could not
  stay connected".
- HTML responses carry a `Content-Security-Policy` that allows only the site, the
  WebSocket host and the Jitsi origin, with no inline script or style. Every
  response carries HSTS with `includeSubDomains`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`.
- A path without a file gets `index.html`, so client-side routes work on reload.
  `/api`, `/ws` and `/idp` are excluded from that rule.
- The virtual host includes `/etc/doctor7/vhost-demo.conf` at the end of the TLS host,
  with `IncludeOptional`. `doctor7-demo` installs that file, and it holds the `/idp/`
  proxy rules. Without the file the site works, and `/idp/` is not proxied.

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

### Version

| Variable | Required | Meaning |
|---|---|---|
| `D7_VERSION_FILE` | No | File with the package version and the build date, read by `GET /version`. Default `/usr/lib/doctor7/VERSION`, which `doctor7-api` installs. When the file is missing, `/version` reports the version of `package.json` and the build date from `BUILD_DATE`. |
| `BUILD_DATE` | No | Build date, used only when the version file is missing. An ISO 8601 UTC instant with a time, such as `2026-11-19T03:26:00Z`. A date without a time is ignored, and `/version` answers `null`. |

### Security

| Variable | Required | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | No | Comma-separated origins that may send state-changing requests, such as `https://demo.example.test`. Each one is https, or http on localhost, with no path. Default: the origin of `OIDC_REDIRECT_URI`. |
| `NODE_ENV` | No | With `production`, the server refuses to start unless `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_REDIRECT_URI` are set. Sign-in is required in production. |
| `RATE_LIMIT_LOGIN_WINDOW_MS` | No | Length of the sign-in limit window, from 1 to 86400000. Default 900000 (15 minutes). |
| `RATE_LIMIT_LOGIN_MAX` | No | Sign-in requests (`/auth/login` and `/auth/callback`) allowed per client address in one window, from 1 to 1000000. Default 20. |
| `RATE_LIMIT_WRITE_WINDOW_MS` | No | Length of the write limit window, from 1 to 86400000. Default 60000. |
| `RATE_LIMIT_WRITE_MAX` | No | POST, PUT, and PATCH requests allowed per signed-in user in one window, from 1 to 1000000. Default 60. |

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

### Demo mode (demo host only)

Never set these on a production server. Without `DEMO_MODE`, the API has no demo route, no gate
rule for one, and no client for the simulator. `docs/DEMO.md` describes the switch these settings
turn on. The package `doctor7-demo` generates them (see the Demo package section).

| Variable | Required | Meaning |
|---|---|---|
| `DEMO_MODE` | No | `1` turns on the demo-only Meet outage switch. Unset, empty, and `0` mean off. Any other value stops the server at startup. |
| `DEMO_MEET_CONTROL_URL` | With `DEMO_MODE=1` | Address of the Google Meet simulator control endpoint, `http` on a loopback host with no path, such as `http://127.0.0.1:4020`. Any other address stops the server at startup. |
| `DEMO_MEET_CONTROL_SECRET` | With `DEMO_MODE=1` | Secret shared with the simulator, 32 to 256 printable characters without spaces. The simulator reads the same value as `MOCK_GOOGLE_CONTROL_SECRET`. It is generated on the host and is never in the repository. |

On the demo host the simulator also uses `MOCK_GOOGLE_CONTROL_SECRET`, `MOCK_GOOGLE_PUBLIC_KEY_FILE`,
`MOCK_GOOGLE_PORT` (fixed at 4020 in the unit), and `NODE_BIN`, all in `/etc/doctor7/mock-google.env`.

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
- `GET /version` answers the package version and the build date. See `docs/API.md`.

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
you edited. The section "Configuration files and reinstall" lists the options that
answer that question without a prompt.

The migrations must run before the new API answers requests. The new release adds the
table `meetings` (migration `0005_meetings.sql`), which the video meeting routes use.
The upgrade script runs `migrate up` after the install and before its restart. The
`doctor7-api` postinst, however, restarts the API while the install runs, so during an
upgrade the new code can run against the old schema until `migrate up` finishes. Check the
result with `run-task.sh migrate status`.

Rollback:

```sh
sudo packaging/scripts/rollback.sh /srv/doctor7-releases/<old-version> [db-archive]
```

The script installs the older packages (a downgrade). Pass the `db` archive that
the upgrade made first when the new release changed the schema, because older
code may not work with a newer schema. Restoring it discards every change made
after that backup. Without a schema change, leave the archive out. Check the
migration list with `run-task.sh migrate status` before you decide. The release that
adds `0005_meetings.sql` is a schema change, so a rollback to an older release needs the
`db` archive.

Settings files in `/etc/doctor7` are not touched by an upgrade or a rollback.
`apt-get remove` keeps them. `apt-get purge` deletes `api.env`, `backup.conf` and
`web.vars.conf`. It keeps `/var/lib/doctor7`, the backups, and the `doctor7`
user.


## Demo package

`doctor7-demo` runs the mock identity provider for the public demo. Install it on
the demo host only. Never install it on a production server. `docs/DEMO.md`
describes the whole demo.

- Build it on its own: `node packaging/build-deb.js demo --out /tmp/doctor7-debs`.
  `all` does not include it. It depends on `doctor7-api`, which provides the
  Node.js lookup, and on `adduser` and `systemd`.
- It installs `/usr/lib/doctor7/mock-idp/`, `/usr/lib/doctor7/start-idp.sh`, and
  the unit `doctor7-mock-idp.service`. It creates the system user `doctor7-idp`
  when that user is missing. It also installs the `/idp/` fragment, described below.
- It creates `/etc/doctor7/idp-demo.env` from a template that holds names only. The
  file has mode 0640 and group `doctor7-idp`. The package creates it only when it
  is missing.
- The install does not enable or start the unit. On the demo host, run
  `systemctl enable --now doctor7-mock-idp.service`.
- The `/idp/` lines of `idp-demo.conf.example` are in `/etc/doctor7/vhost-demo.conf`.
  The TLS host of `doctor7-web` includes that file, so no edit is needed. It is not a conffile:
  the package replaces it on each install, and dpkg removes it on remove. After an
  install or a removal, run `apache2ctl configtest && systemctl reload apache2`.
- `apt-get remove` stops and disables the unit and keeps the settings file.
  `apt-get purge` removes `/etc/doctor7/idp-demo.env`, and removes `/etc/doctor7`
  only when it is empty. It keeps the `doctor7-idp` user and every other file.

### Google Meet simulator (demo only)

The same package holds a simulator of the two Google endpoints that the API calls to create a Meet
meeting. It lets the demo show the failover from Meet to Jitsi. `docs/DEMO.md` explains how it is
used. The package also depends on `openssl`.

- It installs `/usr/lib/doctor7/mock-google/server.js`, `/usr/lib/doctor7/start-google.sh`, and the
  unit `doctor7-mock-google.service`. The unit runs as the system user `doctor7-meet` (created when
  missing), listens on `127.0.0.1:4020` only, and has the same hardening as the identity provider unit,
  plus `IPAddressDeny=any` with `IPAddressAllow=localhost`. It is not enabled or started by the install.
- The install generates, only when none of these files exists yet, a synthetic RSA key pair and a shared
  secret on the host with `openssl`. The key never leaves the host and is never in the package:

  | File | Mode and owner | Content |
  |---|---|---|
  | `/etc/doctor7/mock-google.env` | 0640, `root:doctor7-meet` | `MOCK_GOOGLE_CONTROL_SECRET` and the path of the public key. |
  | `/etc/doctor7/meet-demo-public-key.pem` | 0640, `root:doctor7-meet` | The public key that the simulator uses to check the assertion. |
  | `/etc/doctor7/meet-demo-credentials.env` | 0640, `root:doctor7` | The API settings of the demo: `VIDEO_PROVIDER=meet`, `DEMO_MODE=1`, the simulator addresses, the secret, and the synthetic service account key. |

  These are local values like `idp-demo.env`: an upgrade never replaces them. If some of the three files
  exist and others do not, the install generates nothing and says so.
- Nothing reads `meet-demo-credentials.env` until an administrator installs the drop-in
  `/usr/share/doctor7/doctor7-api-demo-meet.conf.example` into
  `/etc/systemd/system/doctor7-api.service.d/`. `docs/DEMO.md` lists the commands.
- `apt-get remove` stops and disables the simulator unit. `apt-get purge` also removes the three generated
  files. It keeps the `doctor7-meet` user.
