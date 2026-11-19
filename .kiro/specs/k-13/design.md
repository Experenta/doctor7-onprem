# K-13 Design: performance and optimization

## 1. Query inventory

Every query that the request path runs, with the statement and its existing index.

| Route or path | Query | Existing index that serves it |
| --- | --- | --- |
| Session check (every authenticated request) | `sessions JOIN users` by `id_hash` | `sessions` primary key, `users` primary key |
| Session touch (every authenticated request) | `UPDATE sessions` by `id_hash` | primary key |
| `GET /appointments`, center only | `center_id = ?` order `starts_at, id` | `ix_appointments_center_start` |
| `GET /appointments`, professional filter | `center_id = ? AND professional_id = ?` order `starts_at, id` | none exact. `ix_appointments_professional_start` finds the rows, then filters the center. |
| `GET /appointments`, client filter | `center_id = ? AND client_id = ?` order `starts_at, id` | none exact. `ix_appointments_client_start`, same as above. |
| `GET /appointments/:id` | by primary key | primary key |
| `GET /consultations/:id` | by primary key, then the appointment by primary key | primary keys |
| Audit write (every audited action) | `INSERT`, then read-back by primary key | primary key |
| `GET /audit` | `center_id = ?` [and date range, actor, action, outcome] order `occurred_at DESC, id DESC` | none. No index starts with `center_id` on `audit_log`. |
| Chat history on connect | `appointment_id = ?` order `sent_at DESC, id DESC` limit 50 | `ix_chat_messages_appointment_sent` |
| Chat message write | `INSERT`, then read-back by primary key | primary key |
| Chat purge | `DELETE WHERE sent_at < ?` | none. No index starts with `sent_at` on `chat_messages`. |
| Sign-in and sessions purge | `DELETE WHERE expires_at < ?` | `ix_sessions_expires`, `ix_login_attempts_expires` |
| Revoke all sessions of a user | `WHERE user_id = ? AND revoked_at IS NULL` | `ix_sessions_user` |
| Sign-in by email | `WHERE email = ?` | `uq_users_email` |

## 2. Indexes added in migration 0004

| Index | Table | Columns | Query that justifies it |
| --- | --- | --- | --- |
| `ix_appointments_center_professional_start` | `appointments` | `center_id, professional_id, starts_at` | `GET /appointments` for a professional. The equality on both columns and the order on `starts_at` need one range read, with no filter on the center and no sort. |
| `ix_appointments_center_client_start` | `appointments` | `center_id, client_id, starts_at` | `GET /appointments` for a client. Same reason. |
| `ix_audit_log_center_occurred` | `audit_log` | `center_id, occurred_at` | `GET /audit`. Every audit query starts with `center_id`, and the order is `occurred_at`. Without this index the query reads the audit table from the newest row until it finds the center's rows. |
| `ix_chat_messages_sent` | `chat_messages` | `sent_at` | Chat purge, `DELETE ... WHERE sent_at < ?`. It is a range on `sent_at` alone. The existing index starts with `appointment_id`, so it cannot serve the range. |

Indexes considered and not added:

- Audit filters on `action` and `outcome`. They run after the center range, and
  the center is already the leading column. Add an index only if `EXPLAIN` on the
  PM's data shows a problem.
- `ix_appointments_professional_start` and `ix_appointments_client_start` stay in
  place. They can become redundant after 0004. The PM decides whether to drop them,
  after `EXPLAIN` on the new indexes.
- `ix_audit_log_occurred` is not used by any query in the application, because
  every audit query filters by center. It stays in place. The PM decides whether to
  drop it.

Migration form: each index is one `ALTER TABLE ... ADD INDEX` per table, with no
`IF NOT EXISTS`. The down direction is one `ALTER TABLE ... DROP INDEX` per table.
Each `ALTER` applies in full or not at all. The runner applies the three `ALTER`
statements one after another, so a failure after the first one leaves that index
behind. The runner does not record the version in that case, so the PM must drop the
index before running `up` again. `docs/PERFORMANCE.md` says so.

## 3. Query-count budget

The test wraps the database object, so every `execute` call counts. It uses the SQL
stores (`createSqlCareStore`, `createSqlAuditStore`, `createSqlAuthStore`, and
`createChat`) on top of the counting wrapper. A scripted fake answers each statement
by its shape. It holds the rows for the scenario in memory. The fake does not
interpret SQL in general. It recognizes the statements of this code base, and it
returns an empty result for any other statement.

Caps are the counts that the code makes, derived from reading the code before the
test ran. The test must match them.

| Request | Calls | Breakdown |
| --- | --- | --- |
| `GET /appointments` | 3 | session join, session touch, list |
| `GET /appointments/:id` | 3 | session join, session touch, appointment |
| `GET /consultations/:id` | 6 | session join, touch, consultation, appointment, audit insert, audit read-back |
| `GET /audit` | 3 | session join, touch, audit list |
| Chat connect | 6 | session join, touch, appointment, audit insert, audit read-back, history |
| Chat message | 7 | session join, touch, appointment, message insert, message read-back, audit insert, audit read-back |

The insert read-back comes from `createRepository.insert`, which returns
`findById` after each `INSERT`. Finding F2 in `docs/PERFORMANCE.md` covers it.

Each list case runs with 1 row and with 50 rows. The count must be the same in both
cases (R6).

## 4. Bundle budget

- The budget test lives in `web/src/bundle-budget.test.js`. Hygiene rules scan
  `web/src`, so the test imports only `node:` modules and `vitest`. It does not
  import `vite`.
- It reads `web/dist`, the output of `npm run build --workspace=web`. If the folder
  is missing, the test fails and names the command to run.
- Initial files are the `<script src>` and `<link rel="modulepreload">` entries and
  the `<link rel="stylesheet">` entries of `dist/index.html`.
- Sizes use `zlib.gzipSync` with the default level, which is close to what Apache
  `mod_deflate` sends. The result is in bytes.
- A second test feeds `checkBudget` a size above the limit, and expects a failure.
  That proves the check can fail.

## 5. Lazy loading

- `App.jsx` loads each page with `React.lazy`. Login stays a static import
  (decision R12).
- `Screen` checks the role first. Only then does it render its children inside a
  `Suspense` boundary with a `Skeleton` fallback. A role that may not use a screen
  never loads that page's code (R13).
- Vite splits the lazy pages into their own chunks. No `vite.config.js` change is
  needed. The change to `vite.config.js` is not part of this design.

## 6. Load generator

- `tests/carga/load.js` builds the API in process with the in-memory stores
  (`createMemoryCareStore`, `createMemoryAuthStore`, `createMemoryAuditStore`). It
  seeds synthetic users and appointments and listens on `127.0.0.1` with port 0.
- Workers send `GET /appointments`, `GET /appointments/:id`, and
  `GET /consultations/:id` in turn, each with a session cookie. Each request has a
  timeout of 5 seconds.
- Results: request count, concurrency, errors, p50 and p95 in milliseconds, and the
  total duration. Percentiles use the nearest-rank method.
- `tests/carga/load.test.js` tests the percentile function, runs the default load,
  and asserts zero errors. It prints the report as a diagnostic line.
- The generator can run a larger load from code, by passing `requests` and
  `concurrency`. The default is small, so the test is fast.

## 7. Apache

- The virtual host is `packaging/web/etc/apache2/sites-available/doctor7.conf`. The
  brief named `packaging/apache/`, but that folder holds only the demo identity
  provider vhost. The real vhost already has the rules in R7 and R8 (from K-10), so
  no change is needed.
- `packaging/apache/static-cache.test.js` reads the real vhost and checks R7 and R8,
  and checks that the Debian post-install script enables `deflate`, `expires`, and
  `headers`.

## 8. Findings left for the PM (not fixed here)

- F1. The chat `sweep` runs `sessions.authenticate` and `findAppointment` for every
  open connection each 30 seconds. That is N+1 in a timer. Batching it changes the
  session and chat contracts, so it is a decision for the PM.
- F2. `createRepository.insert` reads each row back, so every write costs two
  statements.
- F3. `touchSession` writes once per authenticated request.
- F4. `purgeExpired` runs on every `GET /auth/login`, and the chat purge deletes
  without a `LIMIT`. Both can hold locks for a long time on large tables.
- F5. The vhost location differs from the brief (see section 7).
