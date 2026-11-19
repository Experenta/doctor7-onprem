# K-22 Requirements: `npm test` on a clean clone is not red

Status: draft for K-22. The PM set the decisions in this spec. K-22 stacks after
K-21.

## Background

- A judge clones the repository, installs the dependencies, and runs `npm test`.
  The clone has no build output. Today `web/src/bundle-budget.test.js` reads
  `web/dist`, and four of its tests fail when that folder is missing.
- Some tests need a tool or a file that a clean clone may not have: `bash`,
  `dpkg`, `git`, `.git`, the private forbidden-word list, or a MariaDB database.
- The secret scanner runs `git ls-files`. Without a `.git` folder it fails.

## Decisions (from the PM)

- Without a build, the bundle budget test is skipped with a notice that names the
  build command. With a build, it measures the bundle and fails when a budget is
  exceeded.
- A verification command compiles first, then runs the tests with the budget
  active, and skips nothing that a check needs.
- A check that needs a missing input is skipped with a clear notice. It is never
  weakened, and no budget is lowered.

## Requirements

### Bundle budget (`web/src/bundle-budget.test.js`)

- R1.1 When `web/dist/index.html` is missing and `REQUIRE_BUNDLE_BUDGET` is not
  `1`, the budget tests are skipped. The output shows a notice with the command
  `npm run build --workspace=web`.
- R1.2 When `web/dist/index.html` exists, the tests measure the initial JavaScript
  and CSS, gzip-compressed, and fail when a size is over its budget. The budgets
  stay as they are (200 KiB JavaScript, 50 KiB CSS).
- R1.3 When `REQUIRE_BUNDLE_BUDGET=1` and `web/dist/index.html` is missing, the
  tests run and fail with a message that names the build command.
- R1.4 The check that a size over its budget fails (`checkBudget`) does not need a
  build. It always runs.

### Verification command (`package.json`, `scripts.verify`)

- R2.1 `verify` runs `npm run build --workspace=web`, then `npm test`, joined with
  `&&`, in that order.
- R2.2 `verify` sets `REQUIRE_BUNDLE_BUDGET=1`.
- R2.3 `scripts.test` and `scripts.test:web` keep their current commands.

### Other tests that need inputs

- R3.1 Every test that needs `git` or a `.git` folder is skipped with a notice
  when the input is missing. A test that runs in a temporary folder with
  `git init` is included.
- R3.2 Every test that needs `bash`, `dpkg`, or the forbidden-word list keeps its
  skip with a notice, and each skip names the missing input.
- R3.3 A test that needs MariaDB keeps its skip when `DATABASE_URL` is not set.
- R3.4 The skips do not weaken a check. A check runs in full when its inputs exist.

### Secret scanner (`scripts/scan-secrets.js`)

- R4.1 When the scanned folder has no `.git`, the scanner prints one notice that
  says the scan was skipped and why, and exits 0.
- R4.2 The scanner keeps its current behavior when `.git` exists, including the
  exit 1 on a finding and on an error.
- R4.3 The scanner test that runs against this repository is skipped when `.git`
  is missing. The test for the notice runs in a folder without `.git`.

### Documentation

- R5.1 `README.md` explains `npm test` (fast; skips the checks whose inputs are
  missing) and `npm run verify` (builds the web client, then runs the root tests
  with the budget active).
- R5.2 `CLAUDE.md` explains the same two commands in its command list.
- R5.3 The README lists the test globs that `npm test` runs, as they are in
  `package.json`.

### Out of this spec

- The K-21 text fixes in `docs/DEMO.md` and `docs/SMOKE.md` are not in this spec's
  file scope. See `tasks.md`.
- Web tests are not part of `npm test`. See `design.md`, "Open point".
