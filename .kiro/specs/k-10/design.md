# K-10 Design

## Source tree

```
packaging/
  build-deb.js              builder (CommonJS, no dependencies)
  build-deb.test.js         tests
  api/                      files of doctor7-api, laid out as on the target
    DEBIAN/{control,postinst,prerm,postrm}
    usr/lib/doctor7/{resolve-node.sh,start-api.sh,run-task.sh}
    usr/lib/systemd/system/{doctor7-api.service,doctor7-chat-purge.service,doctor7-chat-purge.timer}
    usr/sbin/{doctor7-backup,doctor7-restore}
    usr/share/doctor7/{api.env.example,backup.conf.example,backup.cnf.example}
  web/
    DEBIAN/{control,conffiles,postinst,prerm,postrm}
    etc/apache2/sites-available/doctor7.conf
    usr/share/doctor7/web.vars.conf.example
  scripts/{install.sh,upgrade.sh,rollback.sh}
```

The builder adds what the repository does not hold as package files: the
`api/src`, `api/migrations` and `api/package.json` copy, the production
`node_modules`, and `web/dist`.

## Installed layout

| Path | Package | Content |
| --- | --- | --- |
| `/usr/lib/doctor7/api` | api | `src`, `migrations`, `package.json` |
| `/usr/lib/doctor7/node_modules` | api | production dependencies |
| `/etc/doctor7/api.env` | api (postinst) | settings, mode 0600 |
| `/var/lib/doctor7` | api (systemd `StateDirectory`) | files layer |
| `/usr/share/doctor7/web` | web | static files |
| `/etc/apache2/sites-available/doctor7.conf` | web | virtual host |
| `/etc/doctor7/web.vars.conf` | web (postinst) | Apache variables |

`node_modules` sits one level above `api`, so Node finds it by walking up. The
builder runs `npm ci --omit=dev --workspace=api` in a staged copy of the
workspace root (root manifest, lockfile, `api` and `web` manifests), then removes
the workspace links.

## Decisions

- Node resolution lives in `resolve-node.sh` and is sourced by `start-api.sh`
  and `run-task.sh`, so the service, the migration and the purge find Node the
  same way. A candidate that is set but unusable gets a warning, then the next
  one is tried.
- systemd reads `api.env` as root, so the file can be 0600 and still give the
  service its `NODE_BIN`.
- The vhost uses Apache's own `${VAR}` expansion with `Define` lines in
  `web.vars.conf`. No templating step exists, and `apache2ctl configtest`
  checks the result.
- The web `postinst` enables the Apache modules and creates the variables file.
  It does not enable the site: the certificate paths must be set first.
- The API `postinst` enables the units but starts them only when the service was
  already running, because `DATABASE_URL` is empty after a first install.
- Backups use a client options file (`--defaults-extra-file`) so no password
  appears in the process list. Archives live under `BACKUP_DIR`, one directory
  per layer.
- `files` layer is `/var/lib/doctor7`. The API writes nothing there today. The
  layer exists so the procedure does not change when it does.
- `dpkg-deb` is called with `--root-owner-group -Zxz`. The builder sets file
  modes itself, since the development checkout may not preserve them.

## Builder behavior

1. Check inputs: package sources, `web/dist/index.html` (web), `api/src` (api).
2. Copy files into `<out>/<name>_<version>/`, apply the mode table, write
   `Installed-Size` into `control`.
3. For `api`, run `npm ci` unless dependencies are disabled.
4. If `dpkg-deb` exists, build `<out>/<name>_<version>_all.deb`. If not, print
   that the tree is ready and stop with status 0.

## Tests (`packaging/*.test.js`)

- `bash -n` on each shell script, `sh -n` on maintainer scripts. Skipped with a
  note when the shell is not on the machine.
- Unit file checks, env template names-only check, `control` fields.
- Vhost checks: both cookie path lines in order, CSP exact, headers, proxy
  lines, no `unsafe-inline`.
- Builder: tree for both packages from a temporary dist, failure messages for a
  missing dist and a missing source.
- Hygiene: no container tool name in `packaging/` or `docs/`, no CRLF in
  scripts.
- `start-api.sh` exits 1 with a message when no Node is usable.
