# K-30 tasks

- [x] 1. Update `.kiro/steering/frontend-design.md` with the design brief, version 2.
- [x] 2. Write this specification (`requirements.md`, `design.md`, `tasks.md`).
- [x] 3. `web/src/styles/tokens.css`: palette, derived tokens, gradient, type, radii,
  shadows, spacing, motion.
- [x] 4. `web/src/lib/schedule.js`, `initials.js`, `useNow.js`, with unit tests.
- [x] 5. `web/src/components/icons.jsx`, `brand.jsx`, `illustrations.jsx`, `ui.jsx`,
  `States.jsx`: the base components.
- [x] 6. `web/src/components/Layout.jsx` and `Guard.jsx`: the shell.
- [x] 7. `web/src/styles/app.css`: the styles for the shell, the components, Home,
  Appointments, and the screens of K-31 (token restyle only).
- [x] 8. `web/src/pages/Home.jsx`: Home by role.
- [x] 9. `web/src/pages/Appointments.jsx`: switch, filters, day groups, week view.
- [x] 10. `web/src/pages/Login.jsx`, `main.jsx`: minimal restyle and the font imports.
- [x] 11. Tests: rewrite `styles/design.test.js`; add tests for the components, the
  layout, Home by role, and Appointments; adjust the one assertion that clashes with the
  filter chip.
- [x] 12. `docs/PERFORMANCE.md`: measured bundle sizes before and after.
- [x] 13. `docs/HOW-WE-USED-KIRO.md`, `docs/SUBMISSION.md`, and
  `scripts/judge-docs.test.js`: the count of 30, the folder list with `k-30`, and the
  line in "What failed and how it was corrected".
- [x] 14. Run `npm test --workspace=web` and `npm run build --workspace=web`, and
  `node --test "scripts/**/*.test.js"`. Report the output.
- [ ] 15. One commit with the paths of this task. No push.
