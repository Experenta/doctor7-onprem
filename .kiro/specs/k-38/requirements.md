# K-38: ui-checker agent and the MCP verification record

## Goal

Add a read-only Kiro agent, `ui-checker`, that checks the deployed demo visually through a
headless browser. Record the one MCP run of 2026-11-19 and state what it does and does not show.

## Requirements

1. `.kiro/agents/ui-checker.json` is valid JSON with the tools, the MCP server arguments, and the
   allowed tools listed in the task.
2. The agent can reach only the demo origin, `https://3-139-52-25.sslip.io`.
3. `docs/UI-VERIFICATION.md` records the run, its permissions, its report, what it could not
   verify, and how to reproduce it.
4. `docs/HOW-WE-USED-KIRO.md` and `docs/SUBMISSION.md` state that MCP was used once, after the
   build, only to verify the deployed UI. They name `.kiro/agents/ui-checker.json`.
5. `scripts/judge-docs.test.js` checks the agent file, the verification document, and the count of
   39 tasks with the folder `k-38`.

## Out of scope

- Code under `api/`, `web/`, `tools/`, and `packaging/`.
- Installing `@playwright/mcp` or running the agent again.
- Credit figures or percentages of code written by Kiro.
