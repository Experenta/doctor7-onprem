# K-35 design

- One JSON file, `.kiro/agents/implementer.json`, written from the task text without change.
- Documents: the two Kiro documents replace the sentences that said the role is in the project
  record and that `.kiro/agents/` is empty. The task count goes from 34 to 35 and the folder list
  gains `k-35`.
- Test: `scripts/judge-docs.test.js` checks the file, its tool list, the forbidden substrings in
  `allowedCommands`, and that both documents name the file. The `allowedCommands` patterns contain
  the character class `[^;&|<>\`$]`, so the check removes bracket classes before it looks for
  `;`, `&`, and `|`. Otherwise every pattern would fail.
- Not verified here: the Kiro CLI validation (the result is quoted from the task, not re-run).
