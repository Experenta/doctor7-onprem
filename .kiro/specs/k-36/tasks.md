# K-36 tasks

- [x] Write the specification before any code.
- [x] Simulator: control endpoint, with tests.
- [x] API: `demo` resource, config, control client, router, mount, `fallback` and `simulated`, with tests.
- [x] Web: switch, provider chip, failover notice, with tests.
- [x] Packaging: unit, start script, `postinst`, `prerm`, `postrm`, drop-in example, builder, with tests.
- [x] Documents: `DEMO`, `VIDEO`, `AUDIT`, `AUTHORIZATION`, `SECURITY`, `OPERATIONS`, `API`.
- [x] Count documents: 36 tasks and the folder `k-36`.
- [x] Run `npm test`, `npm test --workspace=web`, and the four-folder `node --test` command.
- [ ] Commit once: `feat(demo): demo-only Meet outage switch that makes the Jitsi failover visible`.

Design changes made while implementing, reported to the project manager:

- The unknown path answers `403 no_rule` (the gate runs first), not `404`.
- The meeting answer also has `simulated`, so a production server never labels real Meet as simulated.
- The settings files are `mock-google.env`, `meet-demo-credentials.env`, and `meet-demo-public-key.pem`.
