# K-34 tasks

1. Split the K-33 block in `app.css`: keep the padding at 720 to 1099 px, add the hiding of
   `.col-ends` at 720 to 1199 px, and add the avatar rule at 960 to 1019 px.
   Test: the hiding block ends at 1199 px, the avatar rule is only in its own block, and the
   stacked block is unchanged.
2. Update the K-33 tests in `web/src/styles/design.test.js` and add the K-34 block.
   Test: `npm test --workspace=web` passes.
3. Update the task count to 34 and add k-34 to the lists in `docs/HOW-WE-USED-KIRO.md`,
   `docs/SUBMISSION.md`, and `scripts/judge-docs.test.js`.
   Test: `npm test` passes, including `scripts/judge-docs.test.js`.
4. Run `npm run build --workspace=web`, then commit.
