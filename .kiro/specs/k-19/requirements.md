# K-19 Requirements: demo package with the mock identity provider

Status: the demo instance installs the mock identity provider from a Debian
package. The package is for the demo host only. It never goes on a production
server.

## Background

K-18 runs the provider from `packaging/systemd/doctor7-mock-idp.service`. That
unit calls `/usr/bin/node` and assumes that someone copied
`tools/mock-idp/server.js` by hand. This task makes the install reproducible with
a third package, `doctor7-demo`. It reuses the Node lookup of `doctor7-api`.

## Requirements

- R1. `node packaging/build-deb.js demo` builds `doctor7-demo_<version>_all.deb`.
  `demo` is not part of `all`.
- R2. The control file has `Package: doctor7-demo`, `Architecture: all`, and
  `Depends: doctor7-api, adduser, systemd`. It does not depend on the Debian
  `nodejs` package.
- R3. The package installs `/usr/lib/doctor7/mock-idp/server.js` and
  `/usr/lib/doctor7/mock-idp/rate-limit.js`, both copied from `tools/mock-idp/`.
  `server.js` requires `./rate-limit`, so the package needs both files.
- R4. The postinst creates the system user `doctor7-idp` when it is missing. The
  user has no login shell and no home directory.
- R5. The package installs the unit `doctor7-mock-idp.service` disabled and not
  started. No package script enables or starts it. On an upgrade, the postinst
  restarts the unit only when it already runs.
- R6. The unit runs as `doctor7-idp`. It reads `/etc/doctor7/idp-demo.env`, runs
  `/usr/lib/doctor7/start-idp.sh`, and sets `NoNewPrivileges=true` and
  `ProtectSystem=strict`. It holds no host name and no URL.
- R7. `start-idp.sh` sources `/usr/lib/doctor7/resolve-node.sh` from `doctor7-api`
  and calls `d7_resolve_node`. The order is `NODE_BIN`, then
  `/opt/node/current/bin/node`, then `node` from `PATH`, and the minimum major
  version is 22. When no candidate qualifies, the script exits with status 1 and
  prints a message that says what to install or set.
- R8. `/usr/share/doctor7/idp-demo.env.example` holds the names
  `MOCK_IDP_PUBLIC_URL`, `MOCK_IDP_REDIRECT_URIS`, and `MOCK_IDP_CLIENT_ID`, and no
  values. The postinst installs it as `/etc/doctor7/idp-demo.env` with mode 0640
  only when that file does not exist. It never overwrites the file.
- R9. `/usr/share/doctor7/idp-demo.conf.example` is the vhost example of
  `packaging/apache/idp-demo.conf.example`.
- R10. `postrm purge` removes only `/etc/doctor7/idp-demo.env`, and removes
  `/etc/doctor7` only when the directory is empty. It keeps the `doctor7-idp` user,
  `/etc/doctor7/api.env`, and every other file.
- R11. `packaging/systemd/doctor7-mock-idp.service` is a copy of the packaged unit.
  A test checks that the two files are identical.
- R12. `docs/DEMO.md` explains how to install the package, complete the environment
  file, enable the unit, and add the `/idp/` block to the vhost. It says the demo
  is not for production. `docs/OPERATIONS.md` has a short section on the package.
- R13. The verification command `node --test "packaging/**/*.test.js" "tools/**/*.test.js"`
  passes, and every existing test that passed before still passes.

## Out of scope

- Building the `.deb` on a Debian host and installing it. The PM does both.
- Changes to `api/`, `web/`, the production vhost of K-10, and `packaging/apache/`.
- Any script that enables or starts the unit.
- Deleting `packaging/systemd/`. The shell rules of this task do not allow file
  deletion, so the PM removes that folder with `git rm` when it agrees.
- Real host names, mail addresses, client names, or account names. The examples
  use `demo.example.test` and the synthetic accounts of K-18.
