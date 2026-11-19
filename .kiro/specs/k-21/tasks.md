# K-21 Tasks

Each task names the requirements it covers.

- [x] 1. Spec: `requirements.md`, `design.md`, `tasks.md`. Covers: all.
- [x] 2. `packaging/build-deb.js`: `resolveVersion` with the four sources, the
  invalid-value message, `build()` options `env` and `git`. Covers: R1.1 to R1.3.
- [x] 3. `packaging/build-deb.test.js`: the order of the sources, the git derivation,
  invalid values, the comparison and the real git call. Covers: R1.4, R1.5.
- [x] 4. `packaging/build-deb.js` and its test: `usr/lib/doctor7/VERSION` in the
  `doctor7-api` tree. Covers: R4.1, R4.4.
- [x] 5. `packaging/config-files.test.js` (new): conffiles, postinst guards, the
  OPERATIONS text. Covers: R2.1 to R2.5.
- [x] 6. `packaging/web/etc/apache2/sites-available/doctor7.conf`:
  `IncludeOptional` as the last directive of the TLS host. Covers: R3.1, R3.3.
- [x] 7. `packaging/demo/etc/doctor7/vhost-demo.conf` (new), and the checks in
  `packaging/demo.test.js`. Covers: R3.2, R3.4.
- [x] 8. `api/src/http/health.js` and `api/src/http/health.test.js`: the version
  file, the fallback, `D7_VERSION_FILE`. Covers: R4.2, R4.3, R4.4.
- [x] 9. `docs/API.md`: `GET /version`. Covers: R4.5.
- [x] 10. `docs/OPERATIONS.md`: configuration files, `--force-confold` and
  `--force-confnew`, the build versions, the fragment, `D7_VERSION_FILE`. Covers:
  R2.4, R3.5, R1.1.
- [x] 11. `docs/DEMO.md`: the fragment replaces the manual `/idp/` step. Covers: R3.5.
- [x] 12. `docs/PERFORMANCE.md`: the measured bundle figures, the saving, the
  measured plans. Covers: R5.1 to R5.3.
- [x] 13. `README.md`: the builder usage and the version order. Covers: R6.1.
- [x] 14. Run `node --test "packaging/**/*.test.js" "tools/**/*.test.js"` and
  `npm test`, and record the literal output. Covers: R6.3.
- [ ] 15. One commit: `fix(packaging): increasing package versions, local settings that survive reinstall and an optional /idp vhost fragment`.
