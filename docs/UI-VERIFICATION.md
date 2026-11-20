# UI verification with an MCP browser

This page records one run in which a Kiro agent looked at the deployed demo through a headless
browser. It is a record of that run. It is not an implementation task, and it does not show the
result of every screen or size.

## What was run

- Date: 2026-11-19.
- Launched by the project manager, with the authorization of the project director.
- Kiro CLI 3.5.0, agent `ui-checker` (`.kiro/agents/ui-checker.json`), model Claude Haiku 5.5, in
  non-interactive mode.

## Tool

- `@playwright/mcp` version `0.0.86`, the official Microsoft package, licensed Apache-2.0.
- Installed with `--ignore-scripts`, outside any repository.
- A headless Edge browser, as the project manager reported it. The arguments in the agent file do
  not name a browser.
- Started with `--headless` and `--isolated`.
- Restricted by `--allowed-origins` to the demo origin, `https://3-139-52-25.sslip.io`.

## Permissions

- File reading (`fs_read`) and seven browser tools: navigate, accessibility snapshot, screenshot,
  click, resize, wait for, and console messages.
- No script execution in the page, and no file writing.
- During the run the agent asked for a tool that was not allowed. The Kiro CLI refused it with the
  message `tool permission approval is not supported in non-interactive mode`.
- `--trust-all-tools` was never used.

## Request

The agent was asked to open the demo, sign in with the professional account, and describe the home
page. It was also asked to resize the window to 375×812, 768×1024, and 1440×900. For each size it
was asked whether the appointment list shows completely without horizontal scrolling, and whether
the «Open» links are visible.

## Report

The summary below follows the agent's own report.

- The agent signed in with «Sign in as Ana Rivera» and reached the home page. It saw no visible
  errors.
- The home page shows «Welcome, Ana Rivera», the «Professional» role chip, a next-appointment card,
  three figure tiles (upcoming 2, this week 4, past 4), «Week at a glance», and «Today».
- At 375×812: one column. A bottom bar shows Home, Appointments, and New. The list becomes stacked
  cards, and «Open» is visible.
- At 768×1024: three tiles in a row. The table hides the «Ends» column and keeps «Open» visible.
- At 1440×900: a side bar, and a full table with all columns and «Open» visible.
- No horizontal scrolling was observed at the three sizes. This rests on the screenshots only.

## What it could not verify

The agent listed these points itself.

- Horizontal overflow by measurement. The tool that runs measuring scripts was not allowed, so the
  statement "no horizontal scrolling" rests on the screenshots only.
- The full list at each size. The agent saw only the top of each screenshot. The accessibility
  snapshot did list all 7 appointments.
- The lower parts of the home page at 375 and 768 pixels, and the foot of the «Today» card at
  1440 pixels.
- Interaction states: the List and Week switch, the filters, focus states, and link targets.
- One screenshot at 1440×900 was taken before the resize finished. The agent repeated it and used
  the repeated screenshot.

## What this shows and what it does not claim

- It shows that a Kiro agent can see the deployed interface through MCP and report what it saw,
  with its limits stated. This closes the gap described in the MCP section of
  `docs/HOW-WE-USED-KIRO.md`, where the agents did not see the visual result.
- It does not claim that MCP was used to write the project code, or that it was used in any of the
  earlier tasks.
- The overflow measurements made in the earlier polish tasks were made by the project manager with
  a browser pane. This agent did not make them.

## How to reproduce

1. Install the package in a tools folder outside the repository:
   `npm install --ignore-scripts @playwright/mcp@0.0.86`
2. Use the agent defined in `.kiro/agents/ui-checker.json`.
3. Run:
   `kiro-cli chat --no-interactive --agent ui-checker --model claude-haiku-5.5 "<request>"`

The request is the one in the Request section above. Results depend on the state of the demo on the
day of the run.
