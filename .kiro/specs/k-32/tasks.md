# K-32 tasks

1. Add `shortLabel` to the new-appointment entry in `web/src/lib/access.js`. Test: the label is "New".
2. Pass `data-short` and `aria-label` from `Layout.jsx` to the link, and show the short text in the bottom bar in `app.css`.
   Test: the accessible name is "New appointment", and the link text is the full label.
3. Add the nowrap and ellipsis rules for the list in `app.css`. Set `title` on the identifiers in `Appointments.jsx`.
   Test: the CSS rules and the `title`.
4. Show the `displayName` of the signed-in user in `Appointments.jsx` (list and week view) and `AppointmentPage.jsx`.
   Test: the own name, the other identifier, and the initials.
5. Make the card header of the sign-in page structure the same in every card. Test: the markup and the CSS.
6. Update the task count to 32 and add k-32 to the lists in the Kiro documents and `scripts/judge-docs.test.js`.
7. Run `npm test --workspace=web`, `npm run build --workspace=web`, and `node --test "tools/**/*.test.js"`, then commit.
