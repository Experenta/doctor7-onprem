# K-31 tasks

- [x] 1. Write this specification (`requirements.md`, `design.md`, `tasks.md`), reading
  `.kiro/steering/frontend-design.md` and `.kiro/specs/k-30/`.
- [x] 2. Measure the bundle before the first edit (`npm run build --workspace=web`).
- [x] 3. `components/icons.jsx` (search, close, refresh), `components/States.jsx` (the
  `appointment` skeleton).
- [x] 4. `components/VideoPanel.jsx`: card with header chips, 16:9 stage, the states on the stage.
  The state machine, the polling, and the texts the tests look up do not change.
- [x] 5. `components/ChatPanel.jsx`: card, connection indicator, bubbles with initials, the
  reconnect button next to the status. The WebSocket logic does not change.
- [x] 6. `pages/AppointmentPage.jsx`: compact head, workspace grid (video first, chat rail from
  1100 px).
- [x] 7. `lib/slots.js` with `lib/slots.test.js`, and `pages/NewAppointment.jsx`: groups, duration
  chips, live summary card, inline errors.
- [x] 8. `pages/NewConsultation.jsx` (save indicator, count) and `pages/Consultation.jsx` (note
  sections, Saved and Read only chips).
- [x] 9. `pages/Audit.jsx`: outcome chips, search, dense table with sticky header, outcome chips
  with icons, detail side panel with focus handling.
- [x] 10. `styles/app.css`: the styles of tasks 4 to 9. Remove the rules that they replace.
- [x] 11. `tools/mock-idp/server.js`: the sign-in page (markup order and style block only).
- [x] 12. Tests: `styles/design.test.js` (new pairs, selectors, structure), the page tests of the
  appointment, the new appointment form, the consultation, and the audit log, and
  `tools/mock-idp/login-page.test.js`.
- [x] 13. `docs/PERFORMANCE.md` (measured sizes), `docs/DEMO.md` (one paragraph on the sign-in
  page), `docs/HOW-WE-USED-KIRO.md`, `docs/SUBMISSION.md`, and `scripts/judge-docs.test.js`: the
  count of 31, the folder list with `k-31`, and the line in "What failed and how it was
  corrected".
- [x] 14. Run `npm test --workspace=web`, `npm run build --workspace=web`,
  `node --test "tools/**/*.test.js"`, and `node --test "scripts/**/*.test.js"`. Report the output.
- [ ] 15. One commit with the paths of this task. No push.
