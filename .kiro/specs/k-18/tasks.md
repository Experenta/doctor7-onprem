# K-18 Tasks

Each task names the requirements it covers.

- [x] 1. Spec: `requirements.md`, `design.md`, `tasks.md`. Covers: all.
- [x] 2. Inherited K-09 fixes: `package.json` test script, `.gitignore` (`seed/out/`),
  `docs/MIGRATION.md` output line, `.gitattributes`. Covers: R18 (no host in files).
- [x] 3. Flaky test: `web/src/pages/AppointmentPage.test.jsx` waits for the socket.
  Run the file 10 times and record the results.
- [x] 4. `tools/mock-idp/rate-limit.js` with tests. Covers: R13, R14.
- [x] 5. `tools/mock-idp/server.js`: `publicUrl`, prefix routing, `iris.vega`,
  role table, page, `configFromEnv`, rate limits. Covers: R1-R13.
- [x] 6. `tools/mock-idp/demo.test.js`: public and default modes, escaping,
  seed cross-check, limits, environment. Covers: R1-R14.
- [x] 7. `tools/mock-idp/demo-flow.test.js`: full flow through a fake Apache, token
  verified by the API's OIDC client. Covers: R1, R2, R6.
- [x] 8. `docs/DEMO.md`, with `tools/mock-idp/demo-docs.test.js`. Covers: R17, R18.
- [x] 9. `packaging/systemd/doctor7-mock-idp.service` with its test. Covers: R15.
- [x] 10. `packaging/apache/idp-demo.conf.example` with its test. Covers: R16.
- [x] 11. Run `node --test "tools/**/*.test.js" "packaging/**/*.test.js"`, `npm test`,
  and the web suite. Record the literal output. Five `build-deb.test.js` checks fail
  because of CRLF in files outside this task's scope. See the report.
- [ ] 12. One commit: `feat(demo): serve the mock identity provider under a public path for the demo instance`.
