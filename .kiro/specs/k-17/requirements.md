# K-17 Requirements: forbidden-word list outside the repository

## Introduction

The secret scanner read its forbidden-word list from `scripts/forbidden-words.txt`,
a tracked file. The file published the terms it was meant to block. This task
moves the list out of the repository. The repository keeps only an example with
invented terms.

This task changes no key pattern and no other part of the scanner.

## Requirements

### R1. Where the list comes from

Acceptance criteria:

1. The scanner reads the list from the file named by `FORBIDDEN_WORDS_FILE`. A relative path is resolved from the directory where the scanner runs.
2. If the variable is unset, empty, or names a missing file, the scanner reads `scripts/forbidden-words.local.txt`.
3. If neither file exists, the scanner does not fail. It checks key patterns only and prints one warning line on stderr.
4. The format is one term per line. Matching ignores case. Lines starting with `#` are comments.

### R2. The scanner never scans the list files

Acceptance criteria:

1. The local list, the file named by `FORBIDDEN_WORDS_FILE`, and `scripts/forbidden-words.example.txt` are never scanned, even when they sit inside the scanned repository.

### R3. The example list

Acceptance criteria:

1. `scripts/forbidden-words.example.txt` is versioned. It contains comments and at least two invented terms.
2. The example loads with the same loader as any list.

### R4. Local list ignored by git

Acceptance criteria:

1. `.gitignore` ignores `scripts/forbidden-words.local.txt`.

### R5. Tests use their own lists

Acceptance criteria:

1. Each test that needs a list writes a temporary list with invented terms in the system temporary directory and passes it through `FORBIDDEN_WORDS_FILE`.
2. No test reads `scripts/forbidden-words.txt`.
3. With a list configured, a file that contains a term fails the scan, and a file without a term passes.
4. Without a list, the scanner exits 0 and prints the warning.

### R6. Documentation check

Acceptance criteria:

1. A test checks that `CLAUDE.md`, `README.md`, `.kiro/`, and `scripts/*.example.txt` contain none of the configured terms.
2. With no list configured, the test is skipped and prints a notice.
3. The test reports file names only. It never prints a term.

### R7. Documentation describes the new rule

Acceptance criteria:

1. `CLAUDE.md` and `README.md` state that the list lives outside the repository and name the variable and the local file. They name no real term.
2. `.kiro/steering/tech.md` describes the list as kept outside the repository.

## Out of scope

- Removing `scripts/forbidden-words.txt` from the working tree and from git history. The project manager does this.
- Changing the key patterns.
