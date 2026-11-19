# K-19 Design: the demo package

## Shape

`packaging/build-deb.js` gains a fourth buildable package, `demo`. It is not part
of `all`. The package files live in `packaging/demo/`, next to `packaging/api/`
and `packaging/web/`. The package reads two files that already exist and copies
them in at build time:

```
tools/mock-idp/server.js        -> /usr/lib/doctor7/mock-idp/server.js
tools/mock-idp/rate-limit.js    -> /usr/lib/doctor7/mock-idp/rate-limit.js
packaging/apache/idp-demo.conf.example
                                -> /usr/share/doctor7/idp-demo.conf.example
```

The vhost example stays in one place. The package does not keep a second copy.

```
systemd (doctor7-mock-idp.service)
  -> User=doctor7-idp, EnvironmentFile=/etc/doctor7/idp-demo.env
  -> /usr/lib/doctor7/start-idp.sh
       -> . /usr/lib/doctor7/resolve-node.sh   (from doctor7-api)
       -> d7_resolve_node: NODE_BIN, /opt/node/current/bin/node, node in PATH; >= 22
       -> node server.js in /usr/lib/doctor7/mock-idp
```

## Decisions

| Question | Choice | Reason |
| --- | --- | --- |
| Where does the unit live? | `packaging/demo/usr/lib/systemd/system/`. The old copy in `packaging/systemd/` stays as an identical copy, checked by a test. | The brief puts the unit in the package tree, as `api` and `web` do. The old file cannot be deleted in this task. The PM removes the copy later. |
| Vhost example | Copied from `packaging/apache/` at build time. | One source, and `packaging/apache/` is out of scope. |
| `rate-limit.js` | Copied too. | `server.js` requires it. Without it the service stops at start. |
| `NODE_BIN` in the env template | Not listed in the template. The resolver still reads it when the admin sets it in `idp-demo.env`. | The brief lists three names. The DEMO page documents `NODE_BIN`. |
| Env file group and mode | `root:doctor7-idp`, mode 0640. | systemd reads `EnvironmentFile` as root, so the group only matters for other readers. Matches the brief. |
| Existing env file | Never changed by a script. | The administrator owns the values. |
| Upgrade | `prerm` does not stop the unit. `postinst` runs `systemctl try-restart`. | The new code runs after an upgrade if the admin already runs it. A stopped unit stays stopped. |
| Remove | `prerm` stops and disables the unit. | The unit file goes away. |
| Purge | Removes only `idp-demo.env`, and `/etc/doctor7` when empty. | Brief R10. The user and the other settings stay. |
| Apache dependency | None in `Depends`. | The brief lists three dependencies. The admin enables Apache modules through `doctor7-web`. |

## Node lookup failure

`resolve-node.sh` prints its own message. That message names `NODE_BIN` in
`/etc/doctor7/api.env`, which is wrong for the demo. `start-idp.sh` prints a
second line that names `/etc/doctor7/idp-demo.env`. The resolver file belongs to
`doctor7-api`, and K-19 does not change it. The mismatch goes to the report.

## Tests

- `packaging/build-deb.test.js`: `parseArgs` accepts `demo` and `all` excludes it.
  `checkInputs` names the missing provider files. The builder assembles the demo
  tree and the control file has the exact `Depends` line.
- `packaging/demo/demo.test.js`: static checks of the control file, the three
  maintainer scripts, the unit, the env template, and `start-idp.sh`. Behavior of
  `start-idp.sh` with a fake `node` of version 20 (refused) and of version 22 (started).
  Both need `bash` and are skipped when it is missing, or when a Node sits at
  `/opt/node/current/bin/node`, because the resolver would use that one first.
- `packaging/systemd/doctor7-mock-idp.test.js`: the unit security checks, and the
  identity of the two unit files.

Not tested here: a real `dpkg-deb` build, `postinst` on a Debian host, and a
running service. The PM checks those on the demo host.
