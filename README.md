# doctor7-onprem

doctor7-onprem is a psychological care platform that a clinic runs on its own
server. It rebuilds the hosted Doctor7 service for on-premise use. The server runs
without containers on Debian, with Apache as the web server and MariaDB as the
database.

Video consultations use Google Meet or Jitsi. The clinic picks the provider in the
configuration. When a Meet meeting fails, the API creates the meeting in Jitsi and
reports which provider was used.

This project is submitted to Kiroween in the Frankenstein category. All text in the
repository is in English. All data in the repository is synthetic.

## Try the demo

Open the demo at `<DEMO_URL>`. The demo is an instance with synthetic data and
demonstration accounts. On the sign-in page, pick the account for the role you want
to see: Professional, Client, Administrator, or Auditor. The demo identity provider
does not check passwords. The demo embeds a self-hosted Jitsi server for video. A real
audio and video call between two participants has not been verified.

The steps for reviewers are in `docs/SUBMISSION.md`, under "How to try it".

## What it does

- Professionals schedule appointments, start the video meeting of an appointment,
  write consultation notes, and chat with their client.
- Clients see their own appointments and consultation records, and chat with their
  professional.
- Administrators see every appointment of their center and schedule new ones.
- Auditors read the audit log of their center. The log records who did what. It holds
  no clinical text.

Each appointment has one chat between its professional and its client. The chat stays
open only while the appointment is scheduled.

Access is denied by default. A route with no rule answers `403`. Each request also
passes a role check and a check of the record itself. See `docs/AUTHORIZATION.md`.

## How it runs

- A Debian 13 server with Apache 2.4, MariaDB, and Node.js 22 or later for the API.
  No container runtime is used.
- Three Debian packages: `doctor7-api`, `doctor7-web`, and `doctor7-demo`. The demo
  package is never part of the `all` build, and it must not be installed on a
  production server.
- Install, settings, upgrade, and rollback: `docs/OPERATIONS.md`.
- Demo host setup: `docs/DEMO.md`.
- End-to-end check after a deployment: `docs/SMOKE.md`.
- Components, data flow, and design decisions: `docs/ARCHITECTURE.md`.

## Status and limits

The repository holds the API, the web client, the Debian packaging, the synthetic seed,
the video simulators, and the tests. Some parts are not built, and some checks were not
run. `docs/SUBMISSION.md` lists the declared out-of-scope items. In the demo, Google Meet
is a simulator, not the real service. A real audio and video call between two
participants has not been verified.

## Development

Requirements: Node.js 22 or later. Run `npm ci` at the root to install the workspace
dependencies. The root `package.json` declares the `api` and `web` workspaces.

```sh
npm test
```

`npm test` runs `node --test "scripts/**/*.test.js" "api/**/*.test.js" "tools/**/*.test.js" "seed/**/*.test.js" "packaging/**/*.test.js"`.
It is the fast check. A test that needs an input the clone does not have is skipped,
and the output names the missing input. A clean clone with no build passes. These tests
are skipped on a clean clone:

- The MariaDB tests, without `DATABASE_URL`.
- The packaging tests that need `bash`, `dpkg`, or `git`.
- The secret scanner tests that need `git` or a `.git` entry.
- The forbidden-word checks, without a word list.

```sh
npm run verify
```

This is the full check. It builds the web client, then runs `npm test` with
`REQUIRE_BUNDLE_BUDGET=1`. The bundle budget test fails when the build is missing,
instead of skipping. `verify` does not run the web tests.

```sh
npm run test:web
```

This runs the web tests with Vitest. They are not part of `npm test`.

```sh
node scripts/scan-secrets.js
```

This runs the secret scanner over the files that would enter a commit.

### Build the Debian packages

```sh
npm run build --workspace=web
node packaging/build-deb.js all --out /tmp/doctor7-debs
node packaging/build-deb.js demo --out /tmp/doctor7-debs
```

`all` builds `doctor7-api` and `doctor7-web`. `demo` builds `doctor7-demo`. The package
version comes from the first source that is set: `--version`, the `D7_VERSION`
variable, git, or the root `package.json`. `docs/OPERATIONS.md` has the details.

### Forbidden words

The secret scanner checks key patterns in every file that would enter a commit. It also
checks forbidden words. The list of words is kept outside the repository. The scanner
reads it from the file named by `FORBIDDEN_WORDS_FILE`, or else from
`scripts/forbidden-words.local.txt`, which git ignores. The file has one term per line.
Matching ignores case. Lines that start with `#` are comments.
`scripts/forbidden-words.example.txt` shows the format with invented terms.

With no list, the scanner checks key patterns only and prints one warning line.

## Documentation

| Document | Content |
| --- | --- |
| `docs/ARCHITECTURE.md` | Components, data flow, design decisions, known gaps. |
| `docs/HOW-WE-USED-KIRO.md` | How Kiro was used to build this project, what failed, and what was checked by people. |
| `docs/DEMO-SCRIPT.md` | Script of the demo video, with timings. |
| `docs/SUBMISSION.md` | Submission text, with the judges' steps and the declared out-of-scope items. |
| `docs/OPERATIONS.md` | Packages, settings, upgrade, backup, and rollback for the administrator. |
| `docs/DEMO.md` | Public demo host, mock identity provider, and the Jitsi node. |
| `docs/SMOKE.md` | End-to-end smoke check. |
| `docs/API.md` | HTTP endpoints, roles, and error codes. |
| `docs/AUTHORIZATION.md` | Roles, the access matrix, and the object checks. |
| `docs/AUDIT.md` | Audit log events, reason codes, and limits. |
| `docs/VIDEO.md` | Video providers, failover, and audit entries. |
| `docs/SECURITY.md` | Threats, defenses, headers, and rate limits. |
| `docs/MIGRATION.md` | JSON loader and synthetic seed. |
| `docs/PORTS.md` | Network flows. |

## Contributing

Contributions must keep all text in English, use synthetic data only, and pass
`npm test`. Never commit passwords, tokens, keys, `.env` files, or cloud account
identifiers. See `CLAUDE.md` for the rules that also apply to automated agents.

## Built with Kiro

This repository was built with Kiro. `docs/HOW-WE-USED-KIRO.md` lists what Kiro did,
which specifications, hooks, and steering files exist, what failed, and which results
were checked by people.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
