# K-14 Tasks

Each task names the requirements it covers. The single commit happens last.

- [x] 1. Spec: `requirements.md`, `design.md`, `tasks.md`. Covers: all.
- [x] 2. `api/src/http/health.js`: `GET /version`, `readBuildDate`. Covers: R1.3, R1.4.
- [x] 3. `api/src/http/health.test.js`: probes, `/version` shape, `BUILD_DATE` rules,
  not rate limited. Covers: R1, R9.6.
- [x] 4. `scripts/lib/config.js`, `scripts/lib/cookies.js`, `scripts/lib/http.js`,
  `scripts/lib/login.js`. Covers: R3.2, R3.3, R4, R5, R7.4.
- [x] 5. `scripts/lib/stack.js`: process mode stack. Covers: R3.1, R8.
- [x] 6. `scripts/lib/steps.js`: the seven steps and the chat client. Covers: R2, R3.4,
  R3.5, R6.
- [x] 7. `scripts/smoke.js`: runner, output, exit codes, CLI. Covers: R7, R3.
- [x] 8. `scripts/smoke.test.js`: the tests of R9.
- [x] 9. `docs/SMOKE.md`. Covers: R10.
- [ ] 10. Verification: `node --test "scripts/**/*.test.js" "api/**/*.test.js"`. Record
  the literal output.
- [ ] 11. One commit: `feat(smoke): end-to-end smoke script, health and version endpoints`.
  No push.
