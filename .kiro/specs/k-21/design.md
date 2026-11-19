# K-21 Design

## Files

| File | Change |
| --- | --- |
| `packaging/build-deb.js` | `resolveVersion` with the four sources. Writes `usr/lib/doctor7/VERSION` into `doctor7-api`. Exports the new functions. |
| `packaging/build-deb.test.js` | Version order, git derivation, invalid values, comparison, VERSION file. The demo fragment is checked in the tree test. |
| `packaging/config-files.test.js` (new) | Reads the `conffiles`, the postinst scripts and `docs/OPERATIONS.md`. |
| `packaging/demo.test.js` | Fragment content, and the `IncludeOptional` line of the web vhost. |
| `packaging/web/etc/apache2/sites-available/doctor7.conf` | `IncludeOptional /etc/doctor7/vhost-demo.conf` as the last line of the TLS host. |
| `packaging/demo/etc/doctor7/vhost-demo.conf` (new) | The `/idp/` lines. |
| `api/src/http/health.js` | `readBuildInfo`, `parseVersionFile`, `DEFAULT_VERSION_FILE`. `readBuildDate` keeps its rule. |
| `api/src/http/health.test.js` | File and no-file cases, a malformed file, the endpoint with a file. |
| `docs/API.md`, `docs/OPERATIONS.md`, `docs/DEMO.md`, `docs/PERFORMANCE.md`, `README.md` | Documentation of the above. |

`api/src/config.js` does not change. `BUILD_DATE` is read in `health.js` today, and
`D7_VERSION_FILE` follows that pattern. The file is a runtime setting of one
route, so it does not need the central loader.

## Version resolution

```
resolveVersion({ cliVersion, env, root, git, log })
  cliVersion !== undefined        -> check(cliVersion, '--version')
  env.D7_VERSION (non-empty)      -> check(env.D7_VERSION, 'D7_VERSION')
  git parts at root               -> check(`${base}+git${count}.${hash}-1`)
  otherwise                       -> warn, check(`${base}-1`, 'package.json')
```

- `base` is the `version` of the root `package.json`. A missing file or a missing
  field stops the build.
- `gitVersionParts(root)` runs `git rev-parse --show-toplevel` first and compares
  the result with `root`, using `realpath`. On Windows the comparison ignores case.
  Then it runs `git rev-list --count HEAD` and `git rev-parse --short HEAD`. It
  returns null when any call fails, or when the count is not a positive integer.
- The `git` argument is a function, so the tests can replace it. `build()` passes
  `options.git` and `options.env` through, and both default to the real ones.

| Question | Choice | Reason |
| --- | --- | --- |
| Empty `D7_VERSION` | Ignored | An empty variable is an unset one in the shell. |
| Empty `--version ""` | Rejected | It was given on purpose. |
| Commit count from a parent repository | Not used | A tree extracted into another repository would take the wrong count. |
| Warning channel | The `log` option, the same one as the other build messages | No new output path. |

### Ordering of derived versions

Derived versions have the form `0.0.0+git<n>.<hash>-1`. dpkg compares the upstream
part in segments: text segments by character order, number segments by value. So
`+git9` sorts below `+git10`, and `+git99` below `+git100`. A text segment
`+git` after the base version sorts above the end of the base version, so
`0.0.0+git1.x-1` is newer than `0.0.0-1`. The test implements this rule as
`verrevcmp` in the test file, and runs `dpkg --compare-versions` as a second check
when `dpkg` exists.

The count follows the branch. Builds from different branches can give a lower
count. The docs say so, and say to build releases from one branch or set
`D7_VERSION`.

## Configuration files

Current state, checked from the tree:

| Path | Package | Kind | Written by | Notes |
| --- | --- | --- | --- | --- |
| `/etc/apache2/sites-available/doctor7.conf` | web | conffile | package | Listed in `DEBIAN/conffiles`. |
| `/etc/doctor7/web.vars.conf` | web | local value | postinst, if missing | Not in the payload, so dpkg never replaces it. |
| `/etc/doctor7/api.env` | api | local value | postinst, if missing | Same. |
| `/etc/doctor7/backup.conf` | api | local value | postinst, if missing | Same. |
| `/etc/doctor7/backup.cnf` | none | local value | the administrator, from `/usr/share/doctor7/backup.cnf.example` | Not created by a script. Holds the database password. |
| `/etc/doctor7/idp-demo.env` | demo | local value | postinst, if missing | Same. |
| `/etc/doctor7/vhost-demo.conf` | demo | package file, not a conffile | package | Holds no value. Removed by dpkg on remove. |

So the rule of K-21 already holds. The tests fix it. The conffile list of
`doctor7-web` lists the vhost and nothing else. The postinst scripts use
`if [ ! -e "$VAR" ]` around each `install` of a local value. The previous
history of the repository shows that `DEBIAN/conffiles` was added only once, with
the web package (commit 134e2e3).

The reported reset of the values cannot come from these packages as they are in
this tree. A cause outside the packages, such as a copy made by hand, is possible.
This was not reproduced, because `dpkg` cannot run here.

### Why the vhost fragment is not a conffile

The fragment holds no value that an administrator sets. Its upstream is the
provider port of the unit, `127.0.0.1:4010`. A conffile would stay after
`apt-get remove`, and Apache would keep forwarding `/idp/` to a port with no
listener. A package file is removed with the package. The rule of the brief
allows the vhost to be a conffile, not the fragment.

## /idp fragment

- The web vhost includes `/etc/doctor7/vhost-demo.conf` with `IncludeOptional`
  as the last directive of the TLS host. A missing file is not an error.
- `packaging/demo/etc/doctor7/vhost-demo.conf` holds a header comment, the
  `ProxyRequests Off` line, the `<Location "/idp/">` block, and the two `Proxy*`
  lines. The directive lines are copies of `idp-demo.conf.example`. A test checks
  that each directive line of the fragment appears in the example, so the two
  files cannot drift apart silently.
- `ProxyRequests Off` is kept from the example, because the example has it.
- The example in `packaging/apache/` is not changed. Its own test stays as it is.

Apache must reload after a demo install or removal. The fragment is read when
Apache loads its configuration. The package does not reload Apache from
`doctor7-demo`, so the docs ask the administrator to run the reload.

## /version

### Builder

`build()` takes one build date, `new Date().toISOString()`, for the whole run. The
API tree gets `usr/lib/doctor7/VERSION`:

```
version=0.0.0+git42.abc1234-1
build-date=2026-11-19T06:53:53.715Z
```

The file is written before `applyModes`, so it gets mode 0644.

### API

`health.js` reads the file once, when the router is created:

```
readBuildInfo({ env, logger })
  file = env.D7_VERSION_FILE || '/usr/lib/doctor7/VERSION'
  file readable and has a version line  -> { version, buildDate from file }
  file missing                          -> { package.json version, normalized BUILD_DATE or null }
  file unreadable or has no version     -> logger.error once, then the missing-file rule
```

- `buildDate` from the file goes through the same normalizer as `BUILD_DATE`.
  A file without a `build-date` line gives `null`.
- The file is authoritative when it exists. `BUILD_DATE` is then ignored, as the
  brief requires.
- The response keeps its shape: `{ version, buildDate }`.
- `createHealthRouter` keeps its `build` option, so the tests can pass a fixed value.

| Question | Choice | Reason |
| --- | --- | --- |
| Date-only `BUILD_DATE` (`2026-11-19`) | Still `null` | The existing test pins the rule. The brief asks to keep it. Reported. |
| Malformed file | Logged, then fallback | A bad file must not stop the API at start. |

## Tests

- `build-deb.test.js`: resolution order with an injected git and env, invalid
  values per source, empty `D7_VERSION`, derived format, comparison, the real git
  call when git is present (skipped otherwise), `build()` taking `D7_VERSION`, and
  the VERSION file in the API tree only.
- `config-files.test.js`: conffile lists, the postinst guards, the single write of
  each local value, and the OPERATIONS text.
- `demo.test.js`: the fragment, the subset check against the example, and the
  `IncludeOptional` position in the TLS host.
- `api/src/http/health.test.js`: file present, file absent with and without
  `BUILD_DATE`, malformed file, directory in place of a file, and `/version` read
  from a file.

Not tested here: `apache2ctl configtest`, `dpkg-deb`, the real `dpkg` conffile
prompt, and a live `/version` on the VM. The PM checks those.
