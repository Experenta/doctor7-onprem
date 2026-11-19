# K-17 Tasks

Each task names the requirements it covers.

- [x] 1. Write the spec (`requirements.md`, `design.md`, `tasks.md`). Covers: all.
- [x] 2. `scripts/scan-secrets.js`: lookup order, skipped list files, warning line. Covers: R1, R2.
- [x] 3. `scripts/scan-secrets.test.js`: temporary lists, scanner and list tests, documentation check. Covers: R1, R2, R4, R5, R6.
- [x] 4. `scripts/forbidden-words.example.txt` and the `.gitignore` entry. Covers: R3, R4.
- [x] 5. `CLAUDE.md`, `README.md`, and the scanner line in `.kiro/steering/tech.md`. Covers: R7.
- [x] 6. Run `node --test "scripts/**/*.test.js"`, then commit. Covers: all.

Not in this task: removing `scripts/forbidden-words.txt` from the index and history (project manager).
