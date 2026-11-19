# K-19 Tasks

Each task names the requirements it covers.

- [x] 1. Spec: `requirements.md`, `design.md`, `tasks.md`. Covers: all.
- [x] 2. `packaging/build-deb.js`: `demo` package, not in `all`, copies the
  provider files and the vhost example. `packaging/build-deb.test.js`. Covers: R1,
  R2, R3, R9, R13.
- [x] 3. `packaging/demo/DEBIAN/control`, `postinst`, `prerm`, `postrm`. Covers:
  R2, R4, R5, R8, R10.
- [x] 4. `packaging/demo/usr/lib/doctor7/start-idp.sh`. Covers: R7.
- [x] 5. `packaging/demo/usr/lib/systemd/system/doctor7-mock-idp.service`, and the
  identical copy in `packaging/systemd/`, with the tests. Covers: R5, R6, R11.
- [x] 6. `packaging/demo/usr/share/doctor7/idp-demo.env.example`. Covers: R8.
- [x] 7. `packaging/demo/demo.test.js`. Covers: R2 to R8, R10.
- [x] 8. `docs/DEMO.md` and `docs/OPERATIONS.md`. Covers: R12.
- [x] 9. Run `node --test "packaging/**/*.test.js" "tools/**/*.test.js"` and record
  the literal output. Covers: R13.
- [ ] 10. One commit: `feat(packaging): demo package with the mock identity provider, disabled by default`.
