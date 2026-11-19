# K-13 Requirements: performance and optimization

Scope of this spec: a bounded review with measurable budgets. It adds indexes,
query-count tests, a bundle budget, a load generator, and a performance note.
It does not change any API contract or any functional behavior.

## Database indexes

- R1. Migration `0004_query_indexes.sql` adds the indexes that the real queries
  need and that no existing index serves. Each index is listed in
  `docs/PERFORMANCE.md` with the query that justifies it.
- R2. The migration is reversible. `up` and `down` each use plain `ALTER TABLE`
  statements with `ADD INDEX` and `DROP INDEX`, which MariaDB 11.8 and MySQL 8
  both accept. It uses no `IF NOT EXISTS`, because MySQL does not accept it.
- R3. The migration tests check the shape of 0004 and that every index it adds is
  documented. The PM runs the MariaDB integration test to apply and revert it.

## Query budgets and paging

- R4. Every list route has a page. The default limit is 50 and the maximum is 200.
  The chat history holds at most 50 messages.
- R5. A test counts the calls to the database for each request on these routes,
  and fails when a count passes its fixed cap: `GET /appointments`,
  `GET /appointments/:id`, `GET /consultations/:id`, `GET /audit`, a chat
  connection, and a chat message.
- R6. The count of a list request does not change with the number of rows
  returned. The test compares a page of 1 row with a page of 50 rows.

## Static files (Apache)

- R7. The virtual host compresses text with `mod_deflate` for HTML, CSS,
  JavaScript, JSON, and SVG.
- R8. `/assets/` (hashed build output) has a long `Cache-Control` with
  `public, immutable`. HTML files (including `index.html`) have `no-cache`.
- R9. A test reads the configuration file and checks R7 and R8. See design.md for
  the file location.

## Bundle budget and lazy loading

- R10. The initial JavaScript of the client, gzip-compressed, is at most 200 KiB
  (204800 bytes). The initial CSS, gzip-compressed, is at most 50 KiB (51200
  bytes). "Initial" means the files that `index.html` references.
- R11. A test reads the output of `npm run build --workspace=web` and fails when
  either budget is passed.
- R12. Each screen is loaded when it is first shown. The sign-in page stays in the
  initial bundle, because it is the page that every visitor reaches first.
- R13. A screen that the role may not use loads no page code.

## Load test

- R14. `tests/carga/` contains a load generator that sends concurrent requests to
  the API in this process, with the in-memory stores. It never sends requests to
  a remote host.
- R15. By default the generator sends 120 requests with a concurrency of 4. It
  reports the p50 and p95 latency in milliseconds and the number of errors.
- R16. The test passes only when every request succeeds. Latency is reported and
  not asserted, because it depends on the machine.

## Documentation

- R17. `docs/PERFORMANCE.md` states the budgets, the measured results, the
  justification and the expected plan of each index, and the findings that were
  left for a later task.

## Non-goals

- No change to routes, responses, or the audit log.
- No new dependency. No load against a server other than the in-process one.
- No fix of the findings listed in `docs/PERFORMANCE.md`. The PM decides them.
