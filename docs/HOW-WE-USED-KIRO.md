# How we used Kiro

This page says what Kiro did in this project, what failed, and which results people
checked. Each claim names its source. Three kinds of source appear:

- A file in this repository, such as a specification or a hook.
- A commit in the git history.
- `KIRO-USO.md`, the project record kept by the project manager. It is not in this
  repository.

## Agents and models

- The work was done by Kiro CLI agents with a restricted tool role. The role could read
  and write only inside the work tree. It could run a short list of commands: `git status`,
  `git diff`, `git log`, `git grep`, `git add`, `git commit`, `node --test`, `npm test`,
  `npm run build`, `ls`, `dir`, and `pwd`. The agents had no cloud network access, could
  not install dependencies, and could not push. (Source: `KIRO-USO.md`, Agents and models.)
- The restricted role is in `.kiro/agents/implementer.json`. It is a cleaned English copy of
  the role that the project manager's Kiro CLI runs used for the tasks. The original lives in
  the project manager's private registry and also allows commands for other stacks (`pnpm`,
  `npx jest`, `npx tsc --noEmit`, `python -m pytest`), so the command list in this repository
  is a subset of it. The role was used with the Kiro CLI, not with the IDE. The copy in this
  repository was accepted by the CLI (`kiro-cli agent validate`, exit code 0, 2026-11-19);
  the tasks themselves ran with the original file. No other agent file, hook, or MCP server
  is claimed for this repository.
- The models were Claude Haiku 5.5 and Claude Sonnet 5.5. Sonnet ran the sessions,
  authorization, security, frontend, and packaging tasks. Haiku ran the other tasks.
  Opus was not used. (Source: `KIRO-USO.md`, Agents and models.)
- The Kiro CLI output does not report credit use, so this page gives no credit figures.
  (Source: `KIRO-USO.md`, Agents and models.)

## Tasks, contracts, and checks

- 35 tasks were given to Kiro agents: K-01 to K-35 except K-15 (an internal document kept outside this repository), plus K-19b, a follow-up to K-19. Each task had a
  written contract with an objective, the files it may change, what is out of scope, an
  acceptance criterion, and a verification command. (Source: `KIRO-USO.md`, Tasks.)
- Each task had its own branch and one commit. The project director checked the task
  before it was merged through a pull request. (Source: `KIRO-USO.md`, Tasks.)
- The project director is an AI agent supervised by a person. It wrote the contracts and
  reviewed each diff. It ran the tests on a Debian 13 virtual machine with MariaDB 11.8,
  ran the real processes, and built the packages before each pull request. It also carried
  out the deployments. (Source: `KIRO-USO.md`, Human and director verification.)

## Specifications

- From K-06 on, every task began with a specification in `.kiro/specs/<task>/`, except K-11, K-19b, K-25, and K-27, which have none. A
  specification has three files: `requirements.md`, `design.md`, and `tasks.md`. The task
  was then implemented against that specification. (Source: `KIRO-USO.md`, Specifications;
  folder `.kiro/specs/`.)
- The repository holds specifications for k-06, k-07, k-08, k-09, k-10, k-12, k-13, k-14, k-16, k-17, k-18, k-19, k-20, k-21, k-22, k-23, k-24, k-26, k-28, k-29, k-30, k-31, k-32, k-33, k-34, and k-35. There is no folder for K-11, K-15, K-25, and K-27. (Source: folder `.kiro/specs/`.)

## Steering

- Four steering files are in `.kiro/steering/`: `product.md`, `tech.md`, `structure.md`
  (from K-01), and `frontend-design.md` (from K-08, rewritten as version 2 in K-30). The frontend file summarizes the
  design rules that the frontend follows. (Source: `KIRO-USO.md`, Steering; folder
  `.kiro/steering/`.)

## Hooks

- Two hook files are in `.kiro/hooks/`. `secret-scan-on-save.kiro.hook` runs the secret
  and forbidden-word scanner when a file is saved. `test-edited-area.kiro.hook` runs the
  tests of the area that was edited. (Source: `KIRO-USO.md`, Hooks; folder `.kiro/hooks/`.)
- The hooks were written without being tested in the Kiro IDE. The description in each file says
  the hook format was not checked against a running Kiro instance. This project does not
  claim that the hooks work. (Source: the two hook files.)

## MCP

- No MCP server was used. (Source: `KIRO-USO.md`, MCP.)

## Property-based tests

- The authorization policy (K-04), input validation (K-12), and the seed loader and
  generator (K-09) have property-based tests written with `fast-check`. Files:
  `api/src/authz/policy.test.js`, `api/src/security/validate.test.js`,
  `seed/test/loader.test.js`, and `seed/test/generator.test.js`. (Source: `KIRO-USO.md`,
  Property-based tests; these files.)

## What failed and how it was corrected

1. **K-01, first attempt.** The attempt stopped. The Kiro role accepts only simple commands,
   and the contract asked for a compound command. The contract was corrected. (Source:
   `KIRO-USO.md`, What failed, item 1.)
2. **K-05, first attempt.** The attempt stopped with a correct diagnosis. The file scope of
   the contract did not include the migrations and the wiring the task needed. The scope
   was extended. (Source: `KIRO-USO.md`, What failed, item 2.)
3. **K-19b, demo package.** The demo package contained a test file. It was found by
   running the real package build, not by the static tests. The fix is in commit
   `8c5a15f`. The package builder now rejects any path outside `DEBIAN/`, `usr/`, and
   `etc/`. (Source: `KIRO-USO.md`, What failed, item 3; commit `8c5a15f`.)
4. **K-18, frontend test.** One frontend test was intermittent. It waited for a heading
   instead of the socket. It was found by running the real flow, not by the static tests.
   The test was made stable. (Source: `KIRO-USO.md`, What failed, item 4.)
5. **Checks the tasks could not run.** Several tasks said plainly what they could not check.
   Those points are listed as not verified. Examples in the repository:
   - K-09: the MariaDB integration test was written, not run, because MariaDB was not
     available in the worktree (`.kiro/specs/k-09/tasks.md`).
   - K-19: a real `dpkg-deb` build, `postinst` on a Debian host, and a running service were
     not tested in the task (`.kiro/specs/k-19/design.md`).
   - K-20: a real audio and video call between two participants was not verified
     (`.kiro/specs/k-20/design.md`).
   - K-21: `apache2ctl configtest`, `dpkg-deb`, the real `dpkg` conffile prompt, and a live
     `/version` were not tested in the task (`.kiro/specs/k-21/design.md`).
   (Source: `KIRO-USO.md`, What failed, item 5; the files named above.)
6. While the reviewer documents were being checked, the director found that video meetings
   were not stored: every click created a new room and the client could not join the
   professional's room. K-23 stores the meeting per appointment and lets the client read it.
   (Source: `api/migrations/0005_meetings.sql`, `api/src/video/meeting.store.http.test.js`.)
7. **K-26, duplicate session cookie.** On the deployed demo, a browser that still held an old session cookie with another Path sent two cookies of the same name and the new session was hidden; K-26 makes the API try every value, and a real browser run on the deployed demo confirmed the sign-in, the stored meeting and the chat history for professional and client. (Source: commit `5c983ca`; `docs/SECURITY.md`, Session cookie.)
8. **K-29, video frame 404.** A real-browser run on the deployed demo showed a 404 in the video frame: the generated room names contained a hyphen, which the default Jitsi Apache rule rejects. K-29 makes new room names alphanumeric. No static test could have found this. (Source: `.kiro/specs/k-29/requirements.md`; `api/src/video/jitsi.js`.)
9. **K-30, brief colors that fail small text.** Computing the contrast of the palette of the design brief showed that turquoise 700 gives about 4:1 on white, and that magenta 600 on its pale surface falls under 4.5:1. K-30 adds a darker turquoise and a darker magenta for small text, and a contrast test covers both. The same task found that the filter chip and the status chip share the word "Scheduled", so one existing test that looked the word up on the whole page was limited to the table. (Source: `.kiro/specs/k-30/design.md`; `web/src/styles/design.test.js`; `web/src/pages/Appointments.test.jsx`.)
10. **K-31, a filter that changed and tests that were wrong.** The audit outcome filter changed from a select with an Apply button to chips that apply at once, so the one test that chose a select option was rewritten and tests for the chips were added. On the first run of the web tests, two of the new duration-chip tests failed because the tests were wrong, not the code: a 90-minute length is itself one of the chips, and a duration that was refused at one start cannot be accepted later at the same start. A third new test failed because the session check also has the `status` role, so it looked up the wrong element. The three tests were corrected. (Source: `.kiro/specs/k-31/design.md`; `web/src/pages/Audit.test.jsx`; `web/src/pages/Appointments.test.jsx`; `web/src/pages/Consultation.test.jsx`.)

## Size of the work

- From the commit statistics, each task changed between 9 and 42 files and between 300 and
  3,800 lines. (Source: `KIRO-USO.md`, Approximate size.)

## Not verified

- A real audio and video call between two participants. It has not been verified. The
  Jitsi node section of `docs/DEMO.md` gives the details.
- Google Meet. The demo uses a simulator in `tools/mock-google/`, not the real service.
  (`docs/VIDEO.md`.)
- The Kiro hooks in the IDE. See the Hooks section.
- The look of the redesigned web client in a real browser at 360, 768, and 1440 px. K-30 and K-31 were
  checked with tests of the tokens, the contrast values, and the structure, not by looking at
  the screens. The sign-in page of the mock identity provider was checked the same way. (Source:
  `.kiro/specs/k-30/design.md` and `.kiro/specs/k-31/design.md`, Not verified here.)
- The checks that the specifications left for the project manager on a Debian host. See
  item 5 above.
