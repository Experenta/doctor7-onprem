# K-07 Tasks

Each task names the requirements it covers.

- [x] 1. Write the spec (`requirements.md`, `design.md`, `tasks.md`). Covers: all.
- [x] 2. K-06 corrections: `readDenialReason` export and import, `tools/` in `npm test`, the command in `README.md` and `CLAUDE.md`, and the meeting actions in `docs/AUDIT.md`. Covers: R9.
- [x] 3. `api/src/chat/protocol.js`, `sequence.js`, and their tests. Covers: R3.2, R4, R5.
- [x] 4. `api/src/chat/access.js`, `store.js`, `memoryStore.js`, and their tests. Covers: R1.3, R1.6, R3.1, R6.1.
- [x] 5. `api/src/chat/gateway.js` and `index.js`: handshake, frames, broadcast, sweep, and its WebSocket tests. Covers: R1, R2, R3, R5, R6, R7.
- [x] 6. `api/src/chat/purge.js` and its tests. Covers: R8.
- [x] 7. `docs/API.md` (the `/ws` section) and `docs/AUDIT.md` (chat actions and reasons). Covers: R10.1, R3.3, R9.2.
- [x] 8. Documentation consistency test `api/src/chat/docs.test.js`. Covers: R9.2, R10.1.
- [x] 9. Run the verification command and the full test suite. Commit. Covers: R10.2.

Not in this plan: wiring into `server.js` (design, open item O1).
