# K-37 design

## Facts found in the code

- Tables today: `centers`, `users`, `appointments`, `consultations`, `chat_messages`, `audit_log`
  (migration 0001), `sessions`, `login_attempts` (0002), `meetings` (0005), and `schema_migrations`
  (created by `api/src/db/migrations.js`).
- `seed/load.js` only inserts. `seed/lib/loader.js` reports a row as `unchanged` when the stored row
  equals the incoming one, and as a `conflict` (rejected) when the id exists with other content.
- `generateSeed(now)` is a pure function of `now`. Ids are fixed (`apt-01`, `u-ana`, `audit-001`), but
  every instant is relative to `now`. Two runs with the same `now` give the same seed. Two runs on
  different days give different instants.

## Decisions

- **Seed.** The reset calls `generateSeed(Date.now())`, so the demo stays around the current day. Tests
  pass a fixed `now`, which makes the result deterministic. The audit collection is **not** reloaded:
  the audit rows stay, and a reload with a new `now` would conflict with them (same id, other time) and
  could not update them. Users, centers, appointments, consultations, and messages are reloaded.
- **Table list.** `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND
  table_type = 'BASE TABLE'`. Kept tables: `schema_migrations`, and `audit_log`. Any name starting with
  `audit` is also kept, so a future audit table fails safe. Each name must match `^[A-Za-z0-9_]+$` and is
  quoted with backticks. A name that does not match stops the run before any delete.
- **Demo marker.** The database name (`SELECT DATABASE()`) must end in `_demo`. No migration is needed.
  The run also stops when `schema_migrations` is missing, so it never runs on a foreign database.
- **Order.** Check environment, open the pool, read name and tables, count the kept tables, then
  `SET FOREIGN_KEY_CHECKS = 0`, `START TRANSACTION`, `DELETE FROM` each table, `COMMIT`, and
  `SET FOREIGN_KEY_CHECKS = 1` in a `finally`. If the setting cannot be restored, the connection is
  destroyed. The seed then loads on the pool with checks on.
- **Statement.** `DELETE FROM`, not `TRUNCATE`: `TRUNCATE` commits implicitly and would break the
  transaction. No `DROP` anywhere.
- **Connection.** `DEMO_RESET_DATABASE_URL`, apart from the API's `DATABASE_URL`. The account needs
  `SELECT`, `INSERT`, `DELETE` on the demo database (`information_schema` only lists tables the account
  can see). Errors print a code, never a driver message.
- **Exit codes.** 0 done. 1 refused or failed. 2 done, but some seed rows were rejected.
- **Testability.** `main(argv, env, io, deps)` takes `createPool`, `createStore`, `now`, and
  `isDemoMarker`. Only tests pass `deps`. The command line has no way to change the marker.
- **Package.** The seed code goes to `/usr/lib/doctor7/seed/`, so `mysql2` resolves from
  `/usr/lib/doctor7/node_modules` (installed by `doctor7-api`). `start-reset.sh` finds Node like
  `start-idp.sh` (`resolve-node.sh` of `doctor7-api`).
- **Units.** New system user `doctor7-reset`. Settings file `/etc/doctor7/demo-reset.env` (0640,
  `root:doctor7-reset`), created by `postinst` from a template with names only and no values.

## Files

New:
- `seed/reset-demo.js` (command line)
- `seed/lib/reset.js` (safeguards, table list, delete, reload)
- `seed/test/reset-demo.test.js` (fake database; runs always)
- `seed/test/reset-demo.integration.test.js` (MariaDB; skipped without `DATABASE_URL`)
- `packaging/demo/usr/lib/systemd/system/doctor7-demo-reset.service`
- `packaging/demo/usr/lib/systemd/system/doctor7-demo-reset.timer`
- `packaging/demo/usr/lib/doctor7/start-reset.sh`
- `packaging/demo/usr/share/doctor7/demo-reset.env.example`

Changed:
- `packaging/demo/DEBIAN/postinst`, `prerm`, `postrm`
- `packaging/build-deb.js`, `packaging/build-deb.test.js`
- `docs/DEMO.md`, `docs/OPERATIONS.md`, `docs/AUDIT.md`
- `docs/HOW-WE-USED-KIRO.md`, `docs/SUBMISSION.md`, `scripts/judge-docs.test.js` (count)

## Not verified here

A run against a real MariaDB (the integration test is skipped without `DATABASE_URL`), the behavior of
the units under systemd, and the install on the demo host.
