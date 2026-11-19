# K-23 Tasks

- [x] 1. Spec: `requirements.md`, `design.md`, `tasks.md`.
- [x] 2. Migration `0005_meetings.sql`, `tables.js`, `migrations.test.js`. Covers R1.1 to R1.3.
- [x] 3. Meeting stores (SQL and memory) and the shared battery. Covers R1.4.
- [x] 4. Policy resource `meeting`, gate rule, policy tests and property test. Covers R4.1, R4.2.
- [x] 5. Router: idempotent `POST`, new `GET`, audit, wiring in `index.js`, `app.js`, and the
  harness. Covers R2.1 to R2.6, R3.1 to R3.4.
- [x] 6. HTTP tests. Covers R2, R3.
- [x] 7. `getMeeting`, `VideoPanel`, `AppointmentPage`, web tests with a fake clock. Covers R5.
- [x] 8. Smoke step and tests. Covers R6.1.
- [x] 9. Documents: `AUTHORIZATION`, `API`, `VIDEO`, `SMOKE`, `README`, `SUBMISSION`,
  `DEMO-SCRIPT`, `DEMO`. Covers R4.3, R7.1, R7.2, R7.4.
- [x] 10. `scripts/judge-docs.test.js`. Covers R7.3.
- [x] 11. Run both verification commands. One commit.

## Not in this task

- `docs/AUDIT.md` lacks `meeting.read` and the `appointment_closed` reason of `meeting.create`
  (file outside scope).
- `docs/ARCHITECTURE.md` says the failover "stores nothing" (file outside scope).
- The SQL meeting store battery needs `DATABASE_URL`. The PM runs it on the virtual machine.
