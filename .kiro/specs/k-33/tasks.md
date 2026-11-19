# K-33 tasks

1. Add the `col-ends` class to the "Ends" header and cells in `Appointments.jsx`.
   Test: the markup has the class on the header and on the cells.
2. Add the 720 to 1099 px block in `app.css`: hide `.col-ends`, and set the tighter
   horizontal padding on `.appt-table` cells.
   Test: the rules are inside that media block, and the hiding is in no other block.
3. Update the task count to 33 and add k-33 to the lists in `docs/HOW-WE-USED-KIRO.md`,
   `docs/SUBMISSION.md`, and `scripts/judge-docs.test.js`.
   Test: `scripts/judge-docs.test.js` passes.
4. Run `npm test --workspace=web` and `npm run build --workspace=web`, then commit.
