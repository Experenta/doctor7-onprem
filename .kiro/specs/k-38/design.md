# K-38: design

## Components

- `.kiro/agents/ui-checker.json`: a Kiro CLI agent with the tools `fs_read` and `@playwright`.
  Its MCP server is `@playwright/mcp@0.0.86`, run headless and isolated, with
  `--allowed-origins` set to the demo origin only.
- `docs/UI-VERIFICATION.md`: the record of the 2026-11-19 run, in the sections the project
  manager set.
- `docs/HOW-WE-USED-KIRO.md` and `docs/SUBMISSION.md`: the MCP sentence, the task count of 39,
  and the folder list that includes `k-38`.
- `scripts/judge-docs.test.js`: checks of the agent file, the verification document, and the
  documents.

## Decisions

- The browser tools are an explicit allow list. Tools that run scripts in the page, type into
  fields, fill forms, upload files, or press keys are not in it.
- The origin limit is the MCP flag `--allowed-origins`. The test checks that this flag holds
  the demo address and no other address.
- The report in `docs/UI-VERIFICATION.md` is the agent's own report, summarized. Its list of
  points it could not verify is kept as it was given.

## Not checked in this task

- `kiro-cli agent validate` is run by the project manager, not here.
- The MCP server was not installed or started here.
