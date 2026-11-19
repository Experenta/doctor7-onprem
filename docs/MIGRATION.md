# Migration: JSON export to MariaDB, and the synthetic seed

This document covers the loader (`seed/load.js`) and the seed generator
(`seed/generate.js`). The loader reads a JSON export, one file per collection, and
writes the rows to the tables that the API migrations create. The generator writes a
synthetic export that the loader accepts with no rejections. The schema is defined by
the migrations in `api/migrations/`. Migration `0005_meetings.sql` creates the table
`meetings`, which holds one video meeting per appointment. The loader does not read or
write that table.

The repository holds no real data and no source export. The export format below is
the one this loader expects. Check it against the real export before the first load.

## Requirements

- Node.js 22 or later. The loader uses the `mysql2` package from the root
  `node_modules`. Nothing is installed by the loader.
- The schema applied by the API migrations, from `DATABASE_URL`. Apply them before the
  new API version starts. The list includes `0005_meetings.sql`, which creates `meetings`:

  ```sh
  DATABASE_URL=<mysql URL> node api/src/db/migrations.js up
  ```

- A database account for the loader with `SELECT` and `INSERT` only, on the six
  tables. Do not grant `UPDATE` or `DELETE`. `audit_log` is append-only, as described
  in `docs/AUDIT.md`. The loader never runs those statements.

## Input format

The input is a directory with one file per collection. Each file holds a JSON array
of objects. A missing file counts as zero documents, and the report lists it under
`absent`.

| File | Collection |
| --- | --- |
| `centers.json` | `centers` |
| `users.json` | `users` |
| `appointments.json` | `appointments` |
| `consultations.json` | `consultations` |
| `messages.json` | `messages` |
| `audit.json` | `audit` |

Fields use the camelCase names of the API (see `docs/API.md`). Unknown fields are
ignored. A missing or `null` optional field becomes `NULL`.

Instants can be either of these forms:

- An ISO 8601 string with an uppercase `T` and an explicit offset, such as
  `2026-11-19T05:10:51.908Z` or `2026-11-18T23:10:51.908-05:00`. A string without an
  offset is rejected.
- An object `{"seconds": 1763528451, "nanoseconds": 908000000}`. `nanoseconds` is
  optional and defaults to `0`.

Every instant is stored in UTC with millisecond precision. A value finer than a
millisecond is rejected, not rounded, so the stored value always equals the source
value.

Identifiers are strings. They are stored as given, with no case change, so `A-1` and
`a-1` are different ids.

## Collection to table mapping

| Collection | Table | Field to column |
| --- | --- | --- |
| `centers` | `centers` | `id` to `id`; `name` to `name`; `createdAt` to `created_at` |
| `users` | `users` | `id`; `centerId` to `center_id`; `email`; `displayName` to `display_name`; `role`; `createdAt` to `created_at` |
| `appointments` | `appointments` | `id`; `centerId` to `center_id`; `professionalId` to `professional_id`; `clientId` to `client_id`; `startsAt` to `starts_at`; `endsAt` to `ends_at`; `status`; `createdAt` to `created_at` |
| `consultations` | `consultations` | `id`; `appointmentId` to `appointment_id`; `body` to `body` (stored as canonical JSON); `createdAt` to `created_at` |
| `messages` | `chat_messages` | `id`; `appointmentId` to `appointment_id`; `senderId` to `sender_id`; `body`; `sentAt` to `sent_at` |
| `audit` | `audit_log` | `id`; `actorId` to `actor_id`; `action`; `targetType` to `target_type`; `targetId` to `target_id`; `occurredAt` to `occurred_at`; `centerId` to `center_id`; `outcome`; `ip`; `reason` |

Allowed values:

- `users.role`: `professional`, `client`, `admin`, `auditor`.
- `appointments.status`: `scheduled`, `cancelled`, `completed`.
- `audit.outcome`: `success`, `denied`, `failure`.

Length limits follow the schema: 200 characters for names, 254 for emails, 64 for
ids, 100 for `action` and `reason`, 50 for `targetType`, 45 for `ip`. A chat message
body is at most 65535 bytes of UTF-8.

## Loading rules

- The collections load in this order: `centers`, `users`, `appointments`,
  `consultations`, `messages`, `audit`.
- Each row ends in one of four states: `inserted`, `unchanged` (already stored with
  the same content), `rejected`, or a fatal error that stops the load.
- Rows are never updated or deleted. A stored row with the same id and different
  content is a conflict, and the stored row is kept.
- Running the same input again inserts nothing. Every valid row is then `unchanged`,
  and the same rows are rejected again.
- A load that stops part way finishes on the next run, because stored rows are
  skipped.
- Each row is its own statement. There is no transaction across the whole load.

Participant rules:

- An appointment's professional must be a `professional` user in the appointment's
  center. Its client must be a `client` user in that center.
- A chat message sender must be the professional or the client of the appointment.

## Rejection codes

Each rejection in the report has a collection, a row index, an `id` (only when the id
is a valid string), a code, and a source field name when one applies. The report
never includes a field value.

| Code | Meaning |
| --- | --- |
| `not_object` | The row is not a JSON object. `id` is `null`. |
| `invalid_id` | The `id` is not a string, is empty, is longer than 64 characters, or has leading or trailing spaces. `id` is `null`. |
| `invalid_field` | A required field is missing, has the wrong type or length, or is not an allowed value. Also a reference that is not a usable id, and a consultation `body` that is not an object. |
| `invalid_timestamp` | An instant is not in an accepted form, has no offset, is an impossible date, or is outside years 1000 to 9999 in UTC. |
| `timestamp_precision` | An instant has a non-zero digit finer than a millisecond. |
| `invalid_time_range` | `endsAt` is not after `startsAt`. |
| `duplicate_id` | The same id appears earlier in the same collection. |
| `missing_reference` | A referenced row does not exist, in the export or in the database. |
| `participant_role` | The professional or client of an appointment has the wrong role. |
| `participant_center` | The professional or client of an appointment is in another center. |
| `not_participant` | A chat message sender is neither the professional nor the client of the appointment. |
| `conflict` | A stored row has the same id with different content, or another user has the same email. |
| `constraint_violation` | The database rejected the row with a check constraint. |

Fatal errors stop the load. The loader then prints only a code, never a row value:

| Code | Meaning |
| --- | --- |
| `input_directory_missing` | The `--input` path is not a directory. |
| `input_invalid_json` | A collection file is not valid JSON. Nothing was written. |
| `input_not_array` | A collection file is valid JSON but not an array. Nothing was written. |
| `invalid_database_url` | `DATABASE_URL` cannot be parsed. |
| `schema_missing` | A table does not exist. Apply the API migrations first. |
| `load_failed` | Another database error. Check the server log. |

## Running the loader

```sh
DATABASE_URL=<mysql URL> node seed/load.js --input <directory>
```

The URL is read from the environment and is never printed. The report is printed as
JSON on standard output.

Exit codes:

- `0`: every row was inserted or was already stored.
- `2`: some rows were rejected. The report lists them, and the valid rows were loaded.
- `1`: a fatal error. Read the message on standard error.

## Generating the demo seed

```sh
node seed/generate.js --out <directory> [--now <ISO 8601 instant>]
```

The generator writes the six files to `<directory>`. Write the output outside the
repository, or to `seed/out/`, which git ignores. Do not commit it. `--now` sets the
run date. The default is the current time. The appointments are placed relative to the
Bogota calendar date of `now`.

The seed contains these accounts, all in `demo-center`:

| Email | Role |
| --- | --- |
| `ana.rivera@example.test` | professional |
| `luis.mora@example.test` | client |
| `marta.solis@example.test` | admin |
| `iris.vega@example.test` | auditor |

Other professionals and clients exist only as appointment participants. The seed has
no row for `no.role@example.test`. The four accounts above are the ones the demo
identity provider offers.

Reseeding: the seed uses fixed ids. Loading a new seed into a database that holds an
older seed reports the changed rows as `conflict` and keeps the old rows. To reseed,
use an empty database.

## Limits

- The export format above is assumed. The real exporter is not in this repository.
- Instants without an offset are rejected, not read as UTC.
- A sub-millisecond instant is rejected, not truncated.
- The loader checks the participant role and center of appointments and chat senders.
  It does not check other business rules, such as the status of an appointment that
  has a consultation.
- The export has no meetings file, and the loader does not load `meetings`. The API creates
  a video meeting when the professional starts it. The generated seed holds no meetings.
