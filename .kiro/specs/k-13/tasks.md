# K-13 Tasks

- [x] 1. Spec: requirements, design, tasks (this folder).
- [x] 2. Migration `api/migrations/0004_query_indexes.sql`, with up and down.
- [x] 3. Migration tests in `api/test/migrations.test.js`: shape of 0004, up and
      down match, and each index is documented in `docs/PERFORMANCE.md`.
- [x] 4. Query-count test `api/test/query-budget.test.js`: caps for the six
      requests in design.md, and equal counts for 1 and 50 rows.
- [x] 5. Apache test `packaging/apache/static-cache.test.js`: compression and
      `Cache-Control` rules in the real vhost.
- [x] 6. Lazy page loading in `web/src/App.jsx` and `web/src/components/Guard.jsx`.
      No test needed a change.
- [x] 7. Bundle budget test `web/src/bundle-budget.test.js`.
- [x] 8. Load generator `tests/carga/load.js` and its test
      `tests/carga/load.test.js`.
- [x] 9. `docs/PERFORMANCE.md`: budgets, results, index justification and plan,
      findings.
- [x] 10. Run `node --test "api/**/*.test.js" "tests/carga/**/*.test.js"`,
       `npm run build --workspace=web`, `npm test --workspace=web`, and `npm test`.
       Record the literal output.
- [ ] 11. One commit: `perf: indexes, query budgets, static caching, bundle budget and light load test`.
