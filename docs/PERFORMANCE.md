# Performance

This note records the budgets of K-13, the results of the tests that check them,
the purpose of each database index, and the findings that were left for a later
task. The results come from the test runs of this repository, with synthetic data.
They are not a capacity claim for a real clinic. The MariaDB plans and the load
against a real server are still to be checked by the PM.

## Budgets

| Area | Budget | Where it is checked |
| --- | --- | --- |
| Statements per request, list of appointments | 3, the same for 1 row and 50 rows | `api/test/query-budget.test.js` |
| Statements per request, one appointment | 3 | `api/test/query-budget.test.js` |
| Statements per request, one consultation | 6 | `api/test/query-budget.test.js` |
| Statements per request, audit list | 3, the same for 1 row and 50 rows | `api/test/query-budget.test.js` |
| Statements per chat connection (history of 50) | 6 | `api/test/query-budget.test.js` |
| Statements per chat message | 7 | `api/test/query-budget.test.js` |
| Initial JavaScript, gzip | 200 KiB (204800 bytes) | `web/src/bundle-budget.test.js` |
| Initial CSS, gzip | 50 KiB (51200 bytes) | `web/src/bundle-budget.test.js` |
| Load test errors | 0 | `tests/carga/load.test.js` |
| Static files | gzip for text, one year and `immutable` for `/assets/`, `no-cache` for HTML | `packaging/apache/static-cache.test.js` |

The caps are the statements the code makes today. A change that adds a statement
to one of these paths fails the test, and the change needs a new cap here with its
reason.

## Results

### Statements per request

Counted by the scripted-database test. The counts are the statements that the code
sends to `db.execute`. Each read or write is one statement. A write also costs one
read-back, because the repository reads the row again after the `INSERT`.

| Request | Statements | Cap |
| --- | --- | --- |
| `GET /appointments` with 1 row | 3 | 3 |
| `GET /appointments` with 50 rows | 3 | 3 |
| `GET /appointments/:id` | 3 | 3 |
| `GET /consultations/:id` | 6 | 6 |
| `GET /audit` with 1 row | 3 | 3 |
| `GET /audit` with 50 rows | 3 | 3 |
| Chat connection, history of 50 messages | 6 | 6 |
| Chat message | 7 | 7 |

The session check runs on every authenticated request. It costs two statements: a
join of `sessions` and `users`, and an update of `last_seen_at`. The list counts do
not change with the number of rows, so no N+1 query was found in these routes.

### Bundle

The PM measured these figures in the VM with `npm run build --workspace=web`. The
first version of this note gave 148.30 kB and 153.63 kB. Those figures did not match
the PM's measurement, so they are replaced.

| Output | Size | How it was measured | Budget |
| --- | --- | --- | --- |
| Initial JavaScript, gzip | 86.40 kB | Vite build output, from `npm run build --workspace=web` | 200 KiB |
| Initial JavaScript, gzip | 85,232 bytes | gzip at level 9, over the same initial file | 200 KiB |
| Initial JavaScript, gzip, before lazy loading | 90.31 kB | PM measurement of the build before lazy loading | 200 KiB |
| Initial CSS, gzip | 3.29 kB | Vite build output, from `npm run build --workspace=web` | 50 KiB |

The first two rows describe the same initial file, measured two ways. Vite reports
86.40 kB. The gzip run at level 9 gives 85,232 bytes. The budget test uses zlib at the
default level and in KiB. This note does not repeat that setting, so the budget test
result comes from the test itself.

Lazy loading moved each screen into its own file, with a gzip size between 0.9 kB and
3.1 kB. The initial script went down by about 4 kB compressed: 90.31 kB before and
86.40 kB after, a difference of 3.91 kB. Most of the initial script is React and React
DOM, so a larger reduction needs a decision about the libraries. That decision is not
part of this task.

### Load test

`tests/carga/load.test.js` runs 120 requests with a concurrency of 4, against the
API built in the test process with the in-memory stores. The requests mix
`GET /appointments`, `GET /appointments/:id`, and `GET /consultations/:id`.

| Requests | Concurrency | p50 | p95 | Errors | Total |
| --- | --- | --- | --- | --- | --- |
| 120 | 4 | 7.17 ms | 18.73 ms | 0 | 279.73 ms |

The figures are from the last run of the verification command. An earlier run of the
same test gave p50 7.52 ms and p95 19.17 ms, so the numbers move between runs.

The load test does not touch MariaDB, the network, or Apache. The latency is only
the cost of the Node.js process. It is reported and not asserted, because it
depends on the machine. A larger load can be run from code by passing `requests`
and `concurrency` to `runLoad`.

## Indexes in migration 0004

Migration `api/migrations/0004_query_indexes.sql` adds four indexes. Each `ALTER
TABLE` is one statement, so it applies in full or not at all. The migration runs
the three `ALTER` statements one after another. If one fails, the indexes before it
stay in place, and the version is not recorded. Drop those indexes by hand before
you run `up` again.

| Index | Table | Columns | Query that uses it |
| --- | --- | --- | --- |
| `ix_appointments_center_professional_start` | `appointments` | `center_id`, `professional_id`, `starts_at` | `GET /appointments` with a professional |
| `ix_appointments_center_client_start` | `appointments` | `center_id`, `client_id`, `starts_at` | `GET /appointments` with a client |
| `ix_audit_log_center_occurred` | `audit_log` | `center_id`, `occurred_at` | `GET /audit`, for every filter |
| `ix_chat_messages_sent` | `chat_messages` | `sent_at` | Chat purge, `DELETE ... WHERE sent_at < ?` |

### Measured plans

The PM measured these plans in the VM, on MariaDB 11.8, with the synthetic seed
loaded. The index column names the index of migration 0004 that the plan used. The
type is the access type that `EXPLAIN` reports.

| Query | Index used | Type |
| --- | --- | --- |
| Appointments of a professional (query 1 below) | `ix_appointments_center_professional_start` | `ref` |
| Appointments of a client (query 2 below) | `ix_appointments_center_client_start` | `ref` |
| Audit list of a center (query 3 below) | `ix_audit_log_center_occurred` | `ref` |
| Chat purge, `WHERE sent_at < ?` (query 4 below) | `ix_chat_messages_sent` | `range` |

Query 5 below, the chat history on connection, is not in the measured list. The
sections that follow show the plans the index design predicted. They are kept to
compare with the measured ones, and they are not results.

### Queries and the predicted plan

Run these statements with `EXPLAIN` in front. The values are synthetic. Each query
lists the plan that the index design predicts. The measured plans are above.

1. Appointments of a professional, in start order.

   ```sql
   EXPLAIN SELECT id, center_id, professional_id, client_id, starts_at, ends_at, status, created_at
     FROM appointments
    WHERE center_id = 'c1' AND professional_id = 'u-pro1'
    ORDER BY starts_at ASC, id ASC
    LIMIT 50 OFFSET 0;
   ```

   Expected: `key` is `ix_appointments_center_professional_start`, the access type is
   `ref` or `range`, and there is no `Using filesort`.

2. Appointments of a client, in start order. It has the same shape, with `client_id`.
   Expected `key` is `ix_appointments_center_client_start`.

3. Audit log of a center, newest first.

   ```sql
   EXPLAIN SELECT id, actor_id, center_id, action, target_type, target_id, outcome, reason, ip, occurred_at
     FROM audit_log
    WHERE center_id = 'c1'
    ORDER BY occurred_at DESC, id DESC
    LIMIT 50 OFFSET 0;
   ```

   Expected: `key` is `ix_audit_log_center_occurred`, read backwards, and no
   `Using filesort`. With a date range added, the range is on `occurred_at` after the
   center key.

4. Chat purge. The row count can be large, so the statement is run in the maintenance
   window.

   ```sql
   EXPLAIN SELECT COUNT(*) FROM chat_messages WHERE sent_at < '2026-08-01 00:00:00.000';
   ```

   The purge runs `DELETE` with the same `WHERE`. Expected: `key` is
   `ix_chat_messages_sent`, the access type is `range`. `EXPLAIN DELETE` is also
   accepted by MariaDB, and it shows the same key.

5. Chat history on connection, which already has an index. This check confirms that
   nothing changed.

   ```sql
   EXPLAIN SELECT id, appointment_id, sender_id, body, sent_at
     FROM chat_messages
    WHERE appointment_id = 'a-1'
    ORDER BY sent_at DESC, id DESC
    LIMIT 50;
   ```

   Expected: `key` is `ix_chat_messages_appointment_sent`.

### Indexes that were not added

- Audit filters on `action` and `outcome`. They run after the center range, so the
  current index is enough. Add an index only if `EXPLAIN` on real data shows a problem.
- `ix_appointments_professional_start` and `ix_appointments_client_start` remain. They
  may be redundant after 0004. Drop them only after `EXPLAIN` shows the new indexes
  in use.
- `ix_audit_log_occurred` is not used by any query in the application, because every
  audit query filters by center. It remains. Drop it only after the PM confirms the
  plans.

### Check the migration

The PM runs this sequence on a test database, whose name contains `test`, because the
integration test refuses other names:

```sh
DATABASE_URL=... node api/src/db/migrations.js up
DATABASE_URL=... node api/src/db/migrations.js down 1
DATABASE_URL=... node api/src/db/migrations.js up
node --test "api/**/*.test.js"
```

The integration test in `api/test/database.integration.test.js` runs when
`DATABASE_URL` is set. Without it, the test is skipped. It was skipped in this
task, because no database was available.

## Findings left for the PM

These findings were not fixed here. Each one changes a contract or needs a decision.

- F1. The chat `sweep` runs every 30 seconds. For each open connection it sends three
  statements: the session join, the session touch, and the appointment lookup. The
  cost grows with the number of open connections. Batching the lookups changes the
  session and chat code, so it is a decision for the PM.
- F2. `createRepository.insert` reads each row back after the `INSERT`. Each audit entry
  and each chat message costs two statements. Returning the row that was written
  would save one statement per write, but it changes what the repository returns.
- F3. `touchSession` writes once for each authenticated request. It is one statement
  in the counts above.
- F4. `GET /auth/login` runs `purgeExpired`, which has two `DELETE` statements with no
  `LIMIT`. The chat purge also deletes with no `LIMIT`. On large tables these
  statements can hold locks for a long time. Batching them is a decision for the PM.
- F5. The brief named `packaging/apache/` as the location of the virtual host. That
  folder holds only the demo identity provider. The Doctor7 virtual host is
  `packaging/web/etc/apache2/sites-available/doctor7.conf`. It already meets the
  compression and cache rules. `packaging/apache/static-cache.test.js` reads that file.
- F6. The root `npm test` does not run `tests/carga/`. The verification command of this
  task runs it. The PM decides whether to add it to the root script.
- F7. The Apache rules were checked by reading the file, not by `apache2ctl configtest`,
  which needs an Apache installation.
