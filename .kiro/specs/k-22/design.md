# K-22 Design

## Approach

Each check decides on its own whether its inputs exist. It skips with a notice
when an input is missing and runs in full when it exists. No check changes its
assertions, budgets, or scanning rules.

## Bundle budget

`web/src/bundle-budget.test.js` computes once, at load time:

- `hasBuild` is true when `web/dist/index.html` exists.
- `required` is true when `process.env.REQUIRE_BUNDLE_BUDGET === '1'`.

When `hasBuild` is false and `required` is false, the build-dependent `describe`
block is skipped with `describe.skipIf`, and the module prints one `console.warn`
line with the build command. The `checkBudget` unit test stays outside that block
and always runs.

When `required` is true and the build is missing, the build-dependent tests run.
Their first assertion fails with the existing message, which names the command.

The budgets and the functions `initialFiles`, `totals`, and `checkBudget` do not
change.

## `verify` script

```json
"verify": "npm run build --workspace=web && REQUIRE_BUNDLE_BUDGET=1 npm test"
```

The `REQUIRE_BUNDLE_BUDGET=1 cmd` prefix is POSIX shell syntax. npm runs scripts
through `sh` on Debian, where the target runs. On Windows, npm uses `cmd.exe`,
which does not accept that prefix.

## Git and the scanner

`scripts/scan-secrets.js` gets one exported helper, `hasGitRepository(root)`. It
returns true when `<root>/.git` exists (a file or a folder, so worktrees count).

The CLI checks it first. Without `.git`, it writes one notice to stderr and exits
0. The scan is skipped, not replaced by a tree walk.

Alternatives considered:

- Walk the file tree when `.git` is missing. The scan would cover more files, but
  it would also read generated output (`web/dist`, `packaging/build`) and files
  that git ignores. Those files can produce false findings, which would make the
  judge's run red again. Not chosen.
- Keep the failure. This is the current behavior and it is the problem to fix.

The scanner test file skips the tests that run `git` when `git` is not installed,
and skips the tests that read this repository's `.git` when it is missing.

## Skips in the other tests

No new helper is needed. Each affected test already has its own input check or
adds one in its own file:

| Test file | Input | Current handling |
| --- | --- | --- |
| `web/src/bundle-budget.test.js` | `web/dist` | Changed (this spec) |
| `scripts/scan-secrets.test.js` | `git`, `.git` | Changed (this spec) |
| `packaging/build-deb.test.js` | `bash`, `dpkg`, `git` | Already skipped with a notice |
| `packaging/demo.test.js` | `bash`, `/opt/node` | Already skipped with a notice |
| `api/test/database.integration.test.js` | `DATABASE_URL` | Already skipped with a notice |
| `seed/test/mariadb.integration.test.js` | `DATABASE_URL` | Already skipped with a notice |
| `web/test/hygiene.test.js` | forbidden-word list | Already warns, and skips the list check |
| `scripts/scan-secrets.test.js` (documentation check) | forbidden-word list | Already skipped with a notice |

## Open point: web tests are not in `npm test`

The root `npm test` runs only the node tests. The budget test lives in `web/` and
runs only through `npm test --workspace=web` (or `npm run test:web`). So the
`verify` script as specified builds the client and then runs the root tests, and
the budget test does not run in `verify`. `REQUIRE_BUNDLE_BUDGET=1` has no effect
on any test that `verify` runs.

The fix is one more step in `verify`: `&& npm run test:web`. This spec does not
make that change, because the PM set the command. The PM decides.

## Testing

- The web tests are run with the `dist` folder missing (skip), with a `dist`
  folder built from the current source (pass), with `REQUIRE_BUNDLE_BUDGET=1` and
  no `dist` (fail), and with a temporarily lowered budget (fail). The budget is
  restored before the commit.
- The scanner test runs the CLI in a folder without `.git` (exit 0, notice).
- The root tests run in full, once, with the literal output recorded.
