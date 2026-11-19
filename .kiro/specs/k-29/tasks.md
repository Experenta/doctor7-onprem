# K-29 tasks

- [x] 1. Write this specification (`requirements.md`, `design.md`, `tasks.md`).
- [x] 2. `api/src/video/jitsi.js`: `ROOM_PREFIX` becomes `doctor7`, with a comment on the
  Jitsi rule.
- [x] 3. `api/src/video/jitsi.test.js`, `meeting.http.test.js`, and
  `meeting.store.http.test.js`: the format check, the new expected address, and the
  read-back test for a stored old name.
- [x] 4. Review the other places that name a room. `storeContract.js`, `service.js`, the
  seed, and the web and script fixtures were checked. None generates a room name, so
  none changed. The fixture `/doctor7-stored` stays as stored data.
- [x] 5. `docs/DEMO.md`: the exact note in "Node 3", and the entry-page wording in
  "Verification status".
- [x] 6. `docs/SUBMISSION.md` and `docs/HOW-WE-USED-KIRO.md`: the count of 29, the
  folder list with `k-29`, the entry-page wording, and the K-29 fact as item 8.
- [x] 7. `scripts/judge-docs.test.js`: `TASK_COUNT` and `TASK_SENTENCE`.
- [x] 8. Run `node --test "api/**/*.test.js" "scripts/**/*.test.js"` and report the output.
- [ ] 9. One commit with the paths of this task. No push.
