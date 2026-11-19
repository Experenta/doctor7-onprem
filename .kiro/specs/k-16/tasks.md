# K-16 Tasks

Each task names the requirements it covers.

- [x] 1. Write the spec (`requirements.md`, `design.md`, `tasks.md`). Covers: all.
- [x] 2. `api/src/config.js`: `loadConfig`, `requireDatabaseUrl`, and the
  `VIDEO_PROVIDER` check. Tests in `api/src/config.test.js`. Covers: R2.
- [x] 3. `api/src/app.js`: expose `app.locals.audit`. Covers: R1.2.
- [x] 4. `api/src/server.js`: `createServer`, `shutdown`, `start`. Tests in
  `api/src/server.test.js`. Covers: R1, R3.
- [x] 5. `docs/OPERATIONS.md`: variable names, startup, shutdown, proxy, purge
  timer. Covers: R4. Checked by `api/src/config.test.js`.
- [x] 6. `api/package.json` test script and the command in
  `.kiro/steering/tech.md`. Covers: R5.
- [x] 7. Run `node --test "api/**/*.test.js"` and `npm test` from the root. Commit.
  Covers: R5.3, R6.
