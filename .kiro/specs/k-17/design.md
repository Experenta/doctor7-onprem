# K-17 Design: forbidden-word list outside the repository

## Lookup

`resolveForbiddenWordsFile(env)` returns the first list that exists:

1. `path.resolve(env.FORBIDDEN_WORDS_FILE)` when the variable is set, non-empty, and names an existing file.
2. `scripts/forbidden-words.local.txt`, resolved from the scanner's own directory.
3. `null`. `loadForbiddenWords()` then returns an empty list, and the CLI prints one warning line on stderr.

Lookup runs on every call, so a test or a process that sets the variable takes effect at once.

## Skipped files

`listFilesToSkip(env)` returns a set of absolute paths. `scanFiles` skips any file in that set. The set holds the local list, the example list, and the path named by the variable. Those files are skipped even when git does not ignore them.

## Tests

- In-process tests set `FORBIDDEN_WORDS_FILE` to a temporary list and restore it afterwards.
- CLI tests run the scanner in a child process with an explicit environment.
- The "no list" and "local list" tests copy the scanner into a temporary repository at `scripts/scan-secrets.js`, so the local list path points inside that repository and never at the developer's real local file.
- The documentation check reads the configured list only when one exists, and it skips otherwise.

## Repository files

| File | Change |
| --- | --- |
| `scripts/scan-secrets.js` | Lookup order, skipped files, warning line |
| `scripts/scan-secrets.test.js` | Temporary lists, new tests, removal of the old list-dependent test |
| `scripts/forbidden-words.example.txt` | New. Invented terms only |
| `.gitignore` | Ignores `scripts/forbidden-words.local.txt` |
| `CLAUDE.md`, `README.md` | Rule and description rewritten. No real term named |
| `.kiro/steering/tech.md` | Scanner line updated |

## Open items for the project manager

- `scripts/forbidden-words.txt` stays tracked until the project manager removes it from the index and history. While it stays tracked, a scan with the real list configured reports its terms in that file.
