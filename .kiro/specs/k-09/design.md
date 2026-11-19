# K-09 Design

## Layout

```
seed/
  load.js                  CLI: node seed/load.js --input <dir>   (needs DATABASE_URL)
  generate.js              CLI: node seed/generate.js --out <dir> [--now <ISO UTC>]
  lib/
    instant.js             instant parsing and SQL DATETIME literals
    collections.js         collections, column maps, row validation, comparison
    loader.js              reads input files, loads rows, builds the report
    mariadb-store.js       store backed by mysql2 (SELECT and INSERT only)
    generator.js           builds the synthetic seed in memory
  fixtures/rejections/     six small JSON files with valid and invalid rows
  test/
    memory-store.js        store with the same rules as K-02, for tests
    instant.test.js
    collections.test.js
    loader.test.js
    generator.test.js
    cli.test.js            usage errors and refusals, with no database
    mariadb-store.test.js  static checks of the SQL the store issues
    mariadb.integration.test.js
```

Modules are CommonJS with `'use strict'`, as in `api/`. The loader requires
`mysql2` and `fast-check`, which the root `node_modules` already provides. The seed
adds no `package.json`, because the root `package.json` is out of scope.

## Input format (assumed)

The source export is not in this repository, so the format is defined here. The PM
must confirm it against the real export before the first load.

- One file per collection: `<collection>.json`, a JSON array of objects.
- Field names in camelCase, the same names the API uses (`startsAt`, `centerId`).
- Unknown fields are ignored and not migrated.
- Missing or `null` optional fields (`centerId`, `actorId`, `targetId`, `ip`,
  `reason`) become `NULL`.

## Store contract

`collections.js` defines each collection with a table name, a list of columns, the
datetime and JSON columns, the references, the unique columns, the row mapper, and
an optional participant check. A store implements:

- `get(def, id)` returns the stored row with the same column names, or `null`.
  Datetime columns are SQL literals (`'YYYY-MM-DD HH:mm:ss.SSS'`). JSON columns are
  text or objects.
- `insert(def, row)` inserts one row. It throws `StoreError` with `kind` set to
  `duplicate` (primary or unique key), `missing_reference` (foreign key), or
  `check_violation`. Any other error is thrown as is and stops the load.
- `readAll(def)` returns every row, sorted by id. Tests use it for snapshots.

Two stores exist: `mariadb-store.js` (mysql2, bound parameters, `timezone: 'Z'`) and
`test/memory-store.js` (PK, unique email, and foreign key checks as in K-02).

## Instants (`instant.js`)

`parseInstant(value)` returns integer milliseconds since the epoch, or throws
`InstantError` with `invalid_timestamp` or `timestamp_precision`.

- String: regex `YYYY-MM-DDTHH:mm:ss[.f{1,9}](Z|±hh:mm)`. Month, day (calendar
  check), hour, minute, second (0 to 59), offset hour (0 to 23), and offset minute
  (0 to 59) are validated. The fraction is cut to milliseconds. Digits past the third
  must all be `0`, otherwise the row is rejected with `timestamp_precision`.
- Object: `seconds` is a safe integer between -1e12 and 1e12. `nanoseconds` is an
  integer from 0 to 999999999, default 0. A remainder after division by 1e6 gives
  `timestamp_precision`. The value is `seconds * 1000 + nanoseconds / 1e6`.
- Both forms must fall between `Date.UTC(1000,0,1)` and
  `Date.UTC(9999,11,31,23,59,59,999)`.
- `toSqlDatetime(ms)` returns `YYYY-MM-DD HH:mm:ss.SSS` from the UTC value of
  `toISOString()`. It rejects an out-of-range value.

Precision choice: a sub-millisecond value is rejected, not truncated. Truncation
would change the stored instant, which R13 forbids.

## Row mapping (`collections.js`)

Each mapper reads the source fields in a fixed order and stops at the first error.
It throws `RowError(code, field)`:

| Code | Raised when |
| --- | --- |
| `not_object` | the document is not a plain object |
| `invalid_id` | the id is not a string, is empty, is over 64 characters, or has leading or trailing whitespace |
| `invalid_field` | a required text is missing or too long, an email does not match `^[^\s@]+@[^\s@]+$` or is over 254 characters, an enum value is unknown, a body is not a plain object, or a message body is empty or over 65535 bytes |
| `invalid_timestamp`, `timestamp_precision` | from `parseInstant` |
| `invalid_time_range` | `endsAt` is not after `startsAt` |

Field lengths follow K-02: names 200, `displayName` 200, `action` 100, `targetType`
50, `ip` 45, `reason` 100, and text ids 64 characters. Length counts code points, the
way `VARCHAR` counts characters in utf8mb4.

Enums: roles `professional`, `client`, `admin`, `auditor`; appointment status
`scheduled`, `cancelled`, `completed`; audit outcome `success`, `denied`, `failure`.

The `consultations.body` value is stored as canonical JSON: object keys sorted at
every level. Comparison parses both sides and canonicalizes them, so key order and
spacing do not produce a `conflict`.

## Loading algorithm (`loader.js`)

`loadCollections(documents, store)` runs the collections in order. For each document
at index `i` of collection `C`:

1. If the id is a string already seen in `C`, reject with `duplicate_id`. Otherwise
   remember the id.
2. Map the document with `def.map`. A `RowError` rejects the row with its code and
   field.
3. `existing = store.get(def, row.id)`. If it exists, compare the stored row with the
   new row on all columns. Equal gives `unchanged`. Different gives `conflict`.
   The row is not written.
4. If `def.participants` exists, run it. It reads the referenced rows with
   `store.get`. A missing referenced row gives `missing_reference`. A wrong role gives
   `participant_role`. A center mismatch gives `participant_center`. A sender who is
   neither the professional nor the client gives `not_participant`.
5. `store.insert(def, row)`. Success gives `inserted`. A `StoreError` maps as
   follows: `duplicate` gives `conflict` (a unique email with another id),
   `missing_reference` gives `missing_reference`, and `check_violation` gives
   `constraint_violation`. Any other error stops the load.

The loader never writes a row that step 3 found. Re-running a complete load therefore
writes nothing, and a stopped load finishes on the next run. Each row is its own
statement without a wrapping transaction, so no single row can leave a partial write.

Input reading (`readInputDirectory`) runs before any write. It parses every file, and
it reports a file that is not JSON or is not an array as a fatal error (R9).

## Report

```json
{
  "collections": {
    "centers": { "read": 2, "inserted": 1, "unchanged": 0, "rejected": 1,
                 "rejections": [{ "index": 1, "id": null, "code": "invalid_timestamp", "field": "createdAt" }] }
  },
  "totals": { "read": 20, "inserted": 8, "unchanged": 0, "rejected": 12 },
  "absent": []
}
```

`id` is `null` for `not_object` and `invalid_id`. The report never holds a field
value.

## CLIs

`load.js --input <dir>`: needs `DATABASE_URL` in the environment. It does not print
the value. Exit codes: `0` when nothing was rejected, `2` when rows were rejected
(the report is still printed), `1` for a fatal error. A fatal error prints only a
code: `input_directory_missing`, `input_invalid_json`, `input_not_array`,
`invalid_database_url`, `schema_missing` (no table; apply the API migrations first),
or `load_failed`. The list is in `docs/MIGRATION.md`.

`generate.js --out <dir> [--now <ISO UTC>]`: writes the six files. Creates the
directory when needed. The default `now` is the current time. It prints the count per
collection. It writes wherever `--out` points, and the output is generated data. The
PM runs it on the VM outside the repository, and the output must not be committed.
Nothing in the code stops a path inside the repository, so the instruction is in the
usage text and in `docs/MIGRATION.md`.

## Generator (`generator.js`)

`generateSeed(now)` returns the six arrays with source names. Times come from
`now` (ms) only.

- Bogota has no daylight saving, so `todayStart = floor((now - 5h) / 1 day) * 1 day + 5h`.
- Demo users have ids `u-ana`, `u-luis`, `u-marta`, `u-iris`, with the emails from
  R18. Other participants have ids `u-diego`, `u-nina` (professionals) and `u-teo`,
  `u-alma`, `u-hugo` (clients). Their emails are under `example.test`.
- The center is `demo-center`, created 365 days before `now`. Users are created 90
  days before `now`.
- Twelve appointment slots are defined by day offset from `todayStart`, hour, and
  minute (50 minutes each). Two slots are on day 0, and one slot is cancelled. The
  professional and client of each slot are fixed. Statuses follow R22.
- `createdAt` of an appointment is `min(startsAt - 2 days, now - 1 min)`.
- Consultations: one per completed appointment. `createdAt` is
  `min(endsAt + 5 min, now)`. Bodies are synthetic notes.
- Messages: up to four per started appointment that is `scheduled` or `completed`,
  at `startsAt + 2 + 4i` minutes, and only when that time is at or before `now`. The
  sender alternates between professional and client.
- Audit: sign-in of the four demo users at `now - 3 h` and later (IP
  `203.0.113.10`), creation of each appointment, creation of each consultation, one
  consultation read by its professional one hour after creation (only when that
  instant is at or before `now`), one refused read by the client `u-luis` of a
  consultation he does not take part in (`not_participant`, 30 minutes before `now`),
  and one `request.denied` with reason `no_rule` and no actor one hour before `now`.
- Ids are fixed strings (`apt-01`, `cons-01`, `msg-03-1`, `audit-001`).

## Tests

- `instant.test.js`: properties. A string with any offset gives the UTC instant. A
  UTC ISO string round-trips through `toSqlDatetime`. An object form equals its sum.
  A fraction with non-zero digits past the third gives `timestamp_precision`. Examples
  for the rejected shapes.
- `collections.test.js`: one example per rejection code. The mapper keeps a row
  unchanged when it is valid.
- `loader.test.js`: the fixture set gives exact counts and codes (see
  `fixtures/rejections/`). Second load gives `unchanged` for every valid row (property
  over random seeds with `fast-check`, N loads give the state of one load). Conflicts
  for a changed row and a duplicate email. Participant rules with a second center.
  Input files: invalid JSON, non-array JSON, and absent files.
- `generator.test.js`: over random `now` values, the seed loads with zero rejections.
  The demo users are fixed. `no.role@example.test` appears nowhere. Each period
  (past, today, future) has an appointment. Consultations and messages follow R23 and
  R24. Audit times are at or before `now`.
- `mariadb-store.test.js`: static check. The store and the loader source contain no
  `UPDATE` or `DELETE`, and the values go through `?` placeholders.
- `mariadb.integration.test.js`: runs only with `DATABASE_URL`, after the name guard.
  Schema through `api/src/db/migrations.js`. Covers the generated seed (zero rejections,
  then unchanged), N loads giving one state, UTC round trip read with
  `DATE_FORMAT`, and a conflict on a changed appointment.
