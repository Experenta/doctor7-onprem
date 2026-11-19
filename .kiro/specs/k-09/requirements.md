# K-09 Requirements: JSON to MariaDB loader and synthetic seed

Depends on K-02: the tables come from `api/migrations/0001` to `0003`. The loader
writes only to those six tables. Column names and rules are in `design.md`.
Collection to table mapping and rejection codes are in `docs/MIGRATION.md`.

## Loader

- R1. The loader reads one file per source collection from an input directory:
  `centers.json`, `users.json`, `appointments.json`, `consultations.json`,
  `messages.json`, `audit.json`. Each file holds a JSON array of documents. A
  missing file means zero documents, and the report lists that collection as absent.
- R2. The loader processes the collections in dependency order: centers, users,
  appointments, consultations, messages, audit.
- R3. Identifiers stay strings. An id that is not a string, is empty, is longer
  than 64 characters, or has leading or trailing whitespace rejects its row with
  code `invalid_id`.
- R4. Idempotent: loading the same input N times leaves the same database state as
  loading it once. Every later load inserts nothing and counts each valid row as
  `unchanged`.
- R5. The loader never updates or deletes a stored row. A stored row with the same
  id and different content, or a unique clash on `users.email`, rejects the incoming
  row with code `conflict`.
- R6. An invalid row is rejected and the load continues. A rejection records the
  collection, the row index, the id (when it is a valid string), a code, and the
  field name. It never records a field value.
- R7. The report gives, per collection, `read`, `inserted`, `unchanged`,
  `rejected`, and the rejection list, plus the same counts summed over all
  collections.
- R8. Participant rules: an appointment's professional must be a `professional`
  user of the appointment's center, and its client must be a `client` user of that
  center. A chat message's sender must be the professional or the client of the
  message's appointment.
- R9. A file that is not valid JSON, or whose JSON is not an array, stops the load
  before any row is written.
- R10. A database error other than a duplicate key, a missing reference, or a
  failed check constraint stops the load. The loader never skips it silently.
- R11. The loader issues only `SELECT` and `INSERT` statements, with bound
  parameters. This matches the append-only grant on `audit_log` in `docs/AUDIT.md`.

## Dates

- R12. An input instant is either an ISO 8601 string with an uppercase `T` and an
  explicit offset (`Z` or `+hh:mm` or `-hh:mm`), or an object
  `{"seconds": <integer>, "nanoseconds": <0 to 999999999, optional>}`. Any other
  value is rejected with code `invalid_timestamp`.
- R13. Every instant is stored in UTC with millisecond precision (`DATETIME(3)`).
  Reading the row back gives the same instant in UTC.
- R14. A fraction finer than milliseconds with a non-zero digit rejects the row with
  code `timestamp_precision`. Trailing zeros are accepted.
- R15. An instant must fall between `1000-01-01T00:00:00.000Z` and
  `9999-12-31T23:59:59.999Z` in UTC. Otherwise the row is rejected with
  `invalid_timestamp`.
- R16. A string without an offset, a leap second (`:60`), or an impossible date
  such as February 30 is rejected with `invalid_timestamp`.

## Synthetic seed

- R17. The generator builds a complete seed for an instant `now` (default: the
  current time). The seed loads into an empty schema with zero rejections.
- R18. The seed holds exactly these demo users, each once, in center `demo-center`:
  `ana.rivera@example.test` (professional), `luis.mora@example.test` (client),
  `marta.solis@example.test` (admin), `iris.vega@example.test` (auditor).
- R19. The seed holds no row that mentions `no.role@example.test`.
- R20. Other professionals and clients exist only as appointment participants. Their
  emails are under the `example.test` domain. They are in `demo-center`.
- R21. Appointments cover three periods, by the calendar date in
  `America/Bogota` of `now`: before that date (past), on that date (today), and
  after that date (future). Each period has at least one appointment.
- R22. An appointment's status is `cancelled` when the seed marks it so. Otherwise
  it is `completed` when `endsAt` is at or before `now`, and `scheduled` when not.
- R23. Consultations belong only to `completed` appointments. Each one is created
  after the appointment starts and at or before `now`.
- R24. Chat messages belong only to appointments that have started and are
  `scheduled` or `completed`. Each message is sent by the professional or the
  client, within the appointment window, at or before `now`. Message times rise
  within each appointment.
- R25. Audit entries occur at or before `now`. They include: sign-in of each demo
  user, appointment creation, consultation creation, a consultation read, a
  refused read by a client who does not take part in that consultation, and a
  request refused for having no route rule.
- R26. Every instant in the seed is an ISO 8601 UTC string. Every email is under
  `example.test`. All text is in English.
- R27. A seed generated for one `now` and loaded into a database that holds a seed
  from another `now` is not merged. Ids are fixed, so changed rows show as
  `conflict`. Reseeding needs a new database.

## Tests and tooling

- R28. `node --test "seed/**/*.test.js"` passes without `DATABASE_URL`. The
  MariaDB tests are skipped and the output says why.
- R29. With `DATABASE_URL` set, the MariaDB tests run only when the database name
  contains `test`, the same guard as `api/test/database.integration.test.js`. They
  create the schema with the API migration runner and remove it afterwards. The URL
  is never printed.
- R30. Only `seed/**`, `.kiro/specs/k-09/**`, and `docs/MIGRATION.md` change.
  `api/` and the root `package.json` are not touched.
- R31. The code uses no credential, no real person's data, and no host other than
  `example.test` or the documentation IP ranges (RFC 5737).

## Verification map

| Requirement | Check |
| --- | --- |
| R3, R5, R6, R7 | `seed/test/loader.test.js` (fixtures, conflicts) |
| R4 | `loader.test.js` property: N loads give the state of one load; `mariadb.integration.test.js` |
| R8 | `loader.test.js` (participant rules, memory store) |
| R9 to R11 | `loader.test.js` (input files), `mariadb-store.test.js` (statements) |
| R12 to R16 | `seed/test/instant.test.js` properties and examples |
| R13 | `instant.test.js` round trip, and `mariadb.integration.test.js` raw UTC read |
| R17 to R27 | `seed/test/generator.test.js` |
| R28, R29 | `node --test "seed/**/*.test.js"` output |
