# K-37 requirements

Nightly reset of the demo database to the synthetic seed, with safeguards. Demo only.

## Scope

1. A reset script that deletes the rows of every table of the schema except the audit log and the
   migration table, then reloads the synthetic seed with the existing idempotent loader.
2. Safeguards that make the script refuse to run outside the demo.
3. A systemd service (oneshot) and timer in the `doctor7-demo` package, off by default.
4. Tests of the script, the units, and the package contents.
5. Documents in English: `docs/DEMO.md`, `docs/OPERATIONS.md`, `docs/AUDIT.md`. The task count is 37.

## Requirements

- R1. The table list comes from `information_schema`, never from a written list. A table added later is
  emptied with no change to the script. A test creates a new table and checks this.
- R2. `audit_log` and `schema_migrations` are never deleted from. The audit log is append-only and grows.
- R3. Foreign key checks are off only around the delete transaction and are on again when it ends.
- R4. The script refuses (exit code 1, nothing touched) unless all of these hold:
  `DEMO_MODE=1`, `DEMO_RESET_CONFIRM=erase-demo-data`, `DEMO_RESET_DATABASE_URL` is set, and the
  database name ends in `_demo`.
- R5. The output names every emptied table with its deleted row count, and every loaded table with its
  counts. It never prints the database URL or a credential.
- R6. A second run leaves the same state as the first (same seed time).
- R7. The units: `Type=oneshot`; timer `OnCalendar=*-*-* 04:00:00 America/Bogota`, `Persistent=false`;
  an unprivileged user; the hardening of `doctor7-mock-idp.service`; `EnvironmentFile=` with the demo
  settings file. The package enables and starts nothing.
- R8. No credential, URL, or customer name in the repository.

## Out of scope

Migrations, `api/`, `web/`, `tools/`, the virtual host, and database permissions (the document tells the
administrator which privileges the reset account needs).
