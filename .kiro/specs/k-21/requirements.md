# K-21 Requirements: package versions, local settings, the /idp fragment, /version

Status: the PM installed the packages on the demo VM and found four packaging
defects. A fifth item corrects the performance note of K-13. This spec covers all
of them. It stacks on K-13, because it changes the Apache virtual host and the
builder that K-13 touched.

## Background

- All `.deb` files were built as `0.0.0-1`. `apt` does not treat a new build as an
  upgrade, and `dpkg -i` reinstalls the same version.
- `dpkg -i --force-confnew` restored the example values of the local settings.
- The PM added the `/idp/` block to the virtual host of the VM by hand.
- `GET /version` answers `buildDate: null` even with `BUILD_DATE` set, because the
  API reads the version from its own `package.json`.
- `docs/PERFORMANCE.md` has bundle figures that do not match the PM's measurement.

## Requirements

### Package version (builder)

- R1.1 `packaging/build-deb.js` takes the package version from the first source
  that is set, in this order:
  (a) `--version V`;
  (b) the environment variable `D7_VERSION`, when it is not empty;
  (c) git: `<version of the root package.json>+git<commit count>.<short hash>-1`,
  where the commit count is `git rev-list --count HEAD` and the short hash is
  `git rev-parse --short HEAD`, both in the root of this tree;
  (d) without git, `<version of the root package.json>-1`, with a warning.
- R1.2 Git counts as available only when the root of the tree is the top of a git
  repository. A parent repository does not count.
- R1.3 Every source passes the Debian rule that the builder already uses,
  `^[0-9][A-Za-z0-9.+~-]*$`. An invalid value stops the build before anything is
  written. The message names the source (`--version`, `D7_VERSION`, or the package
  version) and says how to fix it.
- R1.4 A test covers each of the four sources and the order between them.
- R1.5 A test shows that two git-derived versions with more commits compare as
  newer, with numeric comparison of the segments, and that a derived version is
  newer than `<version>-1`. The comparison follows the Debian rule (dpkg's
  `verrevcmp`).

### Local settings and configuration files

- R2.1 No local value file is a `conffile`. The local values are
  `/etc/doctor7/web.vars.conf`, `/etc/doctor7/api.env`,
  `/etc/doctor7/backup.conf` and `/etc/doctor7/idp-demo.env`.
- R2.2 Each postinst creates its local value file from a template only when the
  file is missing, inside an `if [ ! -e ... ]` block. No maintainer script writes
  a local value file anywhere else.
- R2.3 The web virtual host `/etc/apache2/sites-available/doctor7.conf` is the
  only conffile of `doctor7-web`. `doctor7-api` and `doctor7-demo` have no
  conffile.
- R2.4 `docs/OPERATIONS.md` lists each file, says whether it is a conffile or a
  local value, and explains `--force-confold` (keep the local file) and
  `--force-confnew` (take the package file).
- R2.5 A test reads the `conffiles` and the postinst scripts and checks R2.1 to
  R2.3.

### /idp fragment

- R3.1 The web virtual host has `IncludeOptional /etc/doctor7/vhost-demo.conf`
  inside `<VirtualHost *:443>`, as its last directive.
- R3.2 `doctor7-demo` installs `/etc/doctor7/vhost-demo.conf`. It has the
  `ProxyPass` and `ProxyPassReverse` lines of `/idp/` to `http://127.0.0.1:4010/`,
  and the `/idp/` `Location` block from `packaging/apache/idp-demo.conf.example`.
  It has no `<Location "/">` block, no `VirtualHost`, and no certificate line.
- R3.3 `doctor7-web` without `doctor7-demo` works. `IncludeOptional` does not fail
  when the file is missing.
- R3.4 The fragment is not a conffile. It holds no local value, and the package
  replaces it on each install.
- R3.5 `docs/DEMO.md` and `docs/OPERATIONS.md` describe the fragment and the Apache
  reload after install and removal.

### /version and the version file

- R4.1 The builder writes `/usr/lib/doctor7/VERSION` into `doctor7-api`. It has
  two lines: `version=<package version>` and `build-date=<ISO 8601 UTC instant at
  build time>`.
- R4.2 `GET /version` reads that file. The path comes from `D7_VERSION_FILE`, and
  the default is `/usr/lib/doctor7/VERSION`.
- R4.3 With no file, `/version` answers the `package.json` version of the API and
  the `BUILD_DATE` value, or `null` when `BUILD_DATE` is unset or invalid. The
  `BUILD_DATE` rule does not change.
- R4.4 A test covers the file and the no-file case, and a test checks the file in
  the built `doctor7-api` tree.
- R4.5 `docs/API.md` documents `GET /version`.

### Performance note

- R5.1 `docs/PERFORMANCE.md` replaces the bundle figures with the PM's measurement
  of `npm run build --workspace=web`: initial JavaScript 86.40 kB compressed by
  Vite, and 85,232 bytes with gzip level 9; before lazy loading 90.31 kB; initial CSS
  3.29 kB. The note says how each figure was measured.
- R5.2 The saving of lazy loading is about 4 kB compressed (90.31 kB minus 86.40 kB).
- R5.3 The note lists the `EXPLAIN` plans the PM measured with the seed on MariaDB
  11.8, and separates them from the predicted plans.

### Documentation and repository rules

- R6.1 `README.md` shows how to run the builder, and the order of the version
  sources. Nothing else changes in it.
- R6.2 All text is English. The data is synthetic. No host, IP address, client name
  or account appears in the files.
- R6.3 The verification command `node --test "packaging/**/*.test.js" "tools/**/*.test.js"`
  passes, and every test that passed before still passes.

## Out of scope

- Installing packages, building `.deb` files on Debian, or running `dpkg`, `apt`,
  Apache or `git describe` from the shell. The PM checks those.
- Changes to the functional code of the services, and to `packaging/apache/`.
- Changes to `packaging/scripts/`. Their `apt-get install -y` calls pass no
  conffile option. That is a finding, not part of this task.
- Accepting a date without a time in `BUILD_DATE`.
- Stale references in `docs/SMOKE.md` and the "to be confirmed" note in
  `docs/DEMO.md`. Those are findings.
