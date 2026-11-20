# K-35 requirements

1. The repository holds the restricted implementation role at `.kiro/agents/implementer.json`.
   Its content is the cleaned English copy given in the task. It is valid JSON.
2. The tool list is exactly `fs_read`, `fs_write`, and `execute_bash`.
3. No allowed command contains a shell control character (`;`, `&`, `|`), or the words
   `push`, `install`, `curl`, `ssh`, or `aws`.
4. `docs/HOW-WE-USED-KIRO.md` and `docs/SUBMISSION.md` say the following, with no other claim
   about agents, hooks, or MCP servers:
   - The restricted role is in `.kiro/agents/implementer.json`.
   - It is a cleaned English copy of the role that the project manager's Kiro CLI runs used.
     The original lives in the project manager's private registry. The original also allows
     commands for other stacks (`pnpm`, `npx jest`, `npx tsc --noEmit`, `python -m pytest`),
     so the command list here is a subset of it.
   - The role was used with the Kiro CLI, not the IDE. The copy was accepted by the CLI
     (`kiro-cli agent validate`, exit code 0, 2026-11-19). The tasks ran with the original file.
5. `scripts/judge-docs.test.js` counts 35 tasks (K-01 to K-35 except K-15, plus K-19b) and lists
   the folder `k-35` in both Kiro documents.
6. `node --test "scripts/**/*.test.js"` passes.
