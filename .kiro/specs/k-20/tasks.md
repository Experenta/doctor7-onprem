# K-20 Tasks

Each task names the requirements it covers.

- [ ] 1. Spec: `requirements.md`, `design.md`, `tasks.md`. Covers: all.
- [ ] 2. `packaging/web/etc/apache2/sites-available/doctor7.conf`: cookie rule, `idp`
  in the rewrite, `JITSI_ORIGIN` comment, COOP and HSTS. Covers: R1, R2, R3, R7.3.
- [ ] 3. `packaging/web/usr/share/doctor7/web.vars.conf.example`. Covers: R3.
- [ ] 4. Tests in `packaging/build-deb.test.js` for the vhost and the example. Covers:
  R1, R2, R3, R7.3, R9.
- [ ] 5. `tools/mock-idp/server.js` and `tools/mock-idp/demo.test.js`: remove the
  phrase, forbid it in the test. Covers: R4, R9.
- [ ] 6. `docs/DEMO.md`: remove the schedule claim, document `/idp`, add "Node 3".
  Covers: R5, R8, R10, R11.
- [ ] 7. `tools/mock-idp/demo-docs.test.js`: host, IP, schedule, and "not verified"
  checks. Covers: R4, R9, R10, R11.
- [ ] 8. `docs/OPERATIONS.md`: Jitsi origin, cookie paragraph, `/idp`, K-12 variables.
  Covers: R3, R7.2, R8.
- [ ] 9. `docs/PORTS.md`: Jitsi ports. Covers: R5.
- [ ] 10. `api/src/server.js`: pass `config.security`. Covers: R7.1. The test is not
  added (see design.md). Reported to the PM.
- [ ] 11. Verification `node --test "packaging/**/*.test.js" "tools/**/*.test.js"`,
  and `npm test`. Record the literal output. Covers: R9.
- [ ] 12. One commit: `fix(demo): keep the session cookie path for /ws, exclude /idp from the SPA rewrite, point JITSI_ORIGIN at the Jitsi host and document the video node`.
