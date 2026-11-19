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
- The tool role is written down in the project record. The folder `.kiro/agents/` in
  this repository is empty.
- The models were Claude Haiku 5.5 and Claude Sonnet 5.5. Sonnet ran the sessions,
  authorization, security, frontend, and packaging tasks. Haiku ran the other tasks.
  Opus was not used. (Source: `KIRO-USO.md`, Agents and models.)
- The Kiro CLI output does not report credit use, so this page gives no credit figures.
  (Source: `KIRO-USO.md`, Agents and models.)

## Tasks, contracts, and checks

- The work was split into 22 numbered tasks, K-01 to K-22, plus K-19b. Each task had a
  written contract with an objective, the files it may change, what is out of scope, an
  acceptance criterion, and a verification command. (Source: `KIRO-USO.md`, Tasks.)
- Each task had its own branch and one commit. The project director checked the task
  before it was merged through a pull request. (Source: `KIRO-USO.md`, Tasks.)
- The project director is an AI agent supervised by a person. It wrote the contracts and
  reviewed each diff. It ran the tests on a Debian 13 virtual machine with MariaDB 11.8,
  ran the real processes, and built the packages before each pull request. It also carried
  out the deployments. (Source: `KIRO-USO.md`, Human and director verification.)

## Specifications

- From K-06 on, each task began by writing a specification in `.kiro/specs/<task>/`. A
  specification has three files: `requirements.md`, `design.md`, and `tasks.md`. The task
  was then implemented against that specification. (Source: `KIRO-USO.md`, Specifications;
  folder `.kiro/specs/`.)
- The repository holds specifications for k-06, k-07, k-08, k-09, k-10, k-12, k-13, k-14,
  k-16, k-17, k-18, k-19, k-20, k-21, and k-22. (Source: folder `.kiro/specs/`.)

## Steering

- Four steering files are in `.kiro/steering/`: `product.md`, `tech.md`, `structure.md`
  (from K-01), and `frontend-design.md` (from K-08). The frontend file summarizes the
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
3. **K-19b, demo package.** The demo package contained a test file. The static tests did
   not detect it. The fix is in commit `8c5a15f`. The package builder now rejects any path
   outside `DEBIAN/`, `usr/`, and `etc/`. (Source: `KIRO-USO.md`, What failed, item 3;
   commit `8c5a15f`.)
4. **K-18, frontend test.** One frontend test was intermittent. It waited for a header
   instead of the socket. The test was made stable. (Source: `KIRO-USO.md`, What failed,
   item 4.)
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

## Size of the work

- From the commit statistics, each task changed between 9 and 42 files and between 300 and
  3,800 lines. (Source: `KIRO-USO.md`, Approximate size.)

## Not verified

- A real audio and video call between two participants. It has not been verified. The
  Jitsi node section of `docs/DEMO.md` gives the details.
- Google Meet. The demo uses a simulator in `tools/mock-google/`, not the real service.
  (`docs/VIDEO.md`.)
- The Kiro hooks in the IDE. See the Hooks section.
- The checks that the specifications left for the project manager on a Debian host. See
  item 5 above.
