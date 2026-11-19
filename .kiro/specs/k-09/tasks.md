# K-09 Tasks

- [x] 1. Specification: `requirements.md`, `design.md`, and this file.
- [x] 2. `seed/lib/instant.js` with `seed/test/instant.test.js` (properties).
- [x] 3. `seed/lib/collections.js` with `seed/test/collections.test.js`.
- [x] 4. `seed/lib/loader.js` and `seed/test/memory-store.js`, with `seed/test/loader.test.js`
      and the fixtures in `seed/fixtures/rejections/` (plus `malformed/` and `not-array/`).
- [x] 5. `seed/lib/mariadb-store.js` with `seed/test/mariadb-store.test.js` (static checks).
- [x] 6. `seed/lib/generator.js` with `seed/test/generator.test.js`.
- [x] 7. CLIs: `seed/load.js`, `seed/generate.js`, and `seed/lib/cli.js`, with `seed/test/cli.test.js`.
- [x] 8. `seed/test/mariadb.integration.test.js`, skipped without `DATABASE_URL`. Written, not run:
      no MariaDB is available in the worktree. The PM runs it on the VM.
- [x] 9. `docs/MIGRATION.md`: mapping, rejection codes, run steps, grants.
- [x] 10. `node --test "seed/**/*.test.js"` and `npm test`; output recorded in the run report.
- [ ] 11. Single commit: `feat(seed): idempotent JSON to MariaDB loader and synthetic seed generator`.
