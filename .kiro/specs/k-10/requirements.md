# K-10 Requirements: Debian packages, Apache, backups

Target: Debian 13, Apache 2.4, MariaDB 11.8, no containers. The administrator
builds and installs the packages on the server. This task only produces files.

## Packages

- R1. `doctor7-api` installs the API under `/usr/lib/doctor7/api` with production
  dependencies only. It runs no `npm` command at install time.
- R2. `doctor7-api` does not depend on the Debian `nodejs` package.
- R3. `/usr/lib/doctor7/start-api.sh` picks Node in this order: `NODE_BIN`,
  `/opt/node/current/bin/node`, `node` from `PATH`. A candidate must run and be
  version 22 or later. If none works, the script exits with status 1 and a message.
- R4. The systemd unit runs as the unprivileged user `doctor7` and sets
  `NoNewPrivileges=true` and `ProtectSystem=strict`. It reads
  `/etc/doctor7/api.env`.
- R5. `/etc/doctor7/api.env` is created from a names-only template with mode 0600,
  owner root. An existing file is never overwritten.
- R6. `doctor7-web` installs the static files from `web/dist` and an Apache
  virtual host with TLS.
- R7. `control`, `postinst`, `prerm` and `postrm` exist for each package and are
  valid: required fields set, scripts pass `sh -n` and start with `#!/bin/sh`.
- R8. `packaging/build-deb.js` builds with `dpkg-deb` when it exists. Without it,
  the builder validates and leaves the assembled tree. A missing input stops the
  builder with a message that names the missing item and how to fix it.

## Apache virtual host

- R9. `/api/` is proxied with the prefix removed (`/api/auth/me` reaches the API
  as `/auth/me`). `/ws` is proxied without a prefix over `mod_proxy_wstunnel`.
  `ProxyPreserveHost On` is set.
- R10. The vhost contains `ProxyPassReverseCookiePath /auth /api/auth` and
  `ProxyPassReverseCookiePath / /api/`, in that order.
- R11. HTML responses carry this `Content-Security-Policy`, with no `unsafe-inline`:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  font-src 'self'; connect-src 'self' wss://${SERVER_NAME}; frame-src 'self'
  ${JITSI_ORIGIN}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
- R12. Every response carries HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and `Permissions-Policy` with camera and microphone allowed
  for `self` and the Jitsi origin.
- R13. Server name, Jitsi origin, certificate path, key path, and API address are
  Apache variables set in `/etc/doctor7/web.vars.conf`. The vhost holds no value.
- R14. Unknown paths without a file fall back to `index.html` (client routing),
  except `/assets/`, `/api/` and `/ws`.

## Backup, restore, upgrade

- R15. `doctor7-backup` and `doctor7-restore` work per layer: `app`, `api`, `db`,
  `files`. `doctor7-backup all` runs the four.
- R16. Backups are written with mode 0600 and get a SHA-256 file. Restore checks
  the checksum, asks for confirmation, and rejects archives with absolute or `..`
  paths.
- R17. The database password is read from a client options file, never from a
  command line.
- R18. A documented procedure covers upgrade and rollback, with scripts
  `upgrade.sh` and `rollback.sh`.
- R19. `docs/PORTS.md` lists source, destination, port, protocol, and purpose for
  each flow, including the Jitsi media UDP port.

## Hygiene

- R20. No file under `packaging/` or `docs/` mentions container tooling, holds a
  secret, a certificate, or a customer name.
- R21. `node --test "packaging/**/*.test.js"` checks R2 to R5, R7 to R14 and R20,
  and runs `bash -n` on every shell script.

## Inherited fixes from K-08

- R22. `web/test/hygiene.test.js` reads forbidden words from the configured list
  and skips with a warning when none exists. The words are not in the repository.
- R23. `web/package.json` has `"private": true`, license `Apache-2.0`, and no
  `main`, `keywords`, or `author`.
- R24. The root `test` script is unchanged. A new `test:web` script runs the web
  tests, and `README.md` and `CLAUDE.md` document it.
