# K-22 Tasks

Each task names the requirements it covers.

- [x] 1. Spec: `requirements.md`, `design.md`, `tasks.md`. Covers: all.
- [x] 2. `web/src/bundle-budget.test.js`: skip with a notice when there is no build,
  fail with the command when `REQUIRE_BUNDLE_BUDGET=1`, keep the budgets. Covers:
  R1.1 to R1.4.
- [x] 3. `package.json`, `scripts.verify` only. Covers: R2.1 to R2.3.
- [x] 4. `scripts/scan-secrets.js`: `hasGitRepository`, the notice and exit 0 without
  `.git`. Covers: R4.1, R4.2.
- [x] 5. `scripts/scan-secrets.test.js`: skip the git tests without git or `.git`,
  and add the test for the notice without `.git`. Covers: R3.1, R3.4, R4.3.
- [x] 6. Review the other test files for inputs (done in the design table). No
  change is needed where the skip already exists. Covers: R3.2, R3.3.
- [x] 7. `README.md`: `npm test` and `npm run verify`, the test globs. Covers: R5.1,
  R5.3.
- [x] 8. `CLAUDE.md`: the command list. Covers: R5.2.
- [ ] 9. Run the literal verification commands and record the output. Covers: all.
- [ ] 10. One commit: `test: skip build-dependent checks with a clear notice on a clean clone and add a full verify script`.

## Not in this spec

- K-21 text fixes in `docs/DEMO.md` (the "to be confirmed" sentence in "Node 3")
  and `docs/SMOKE.md` (the meaning of `version`). They are in the PM's task, but
  these two files are not in its file scope. They need the PM to add them to the
  scope before anyone edits them.
- Adding `npm run test:web` to `verify`. See `design.md`, "Open point".
