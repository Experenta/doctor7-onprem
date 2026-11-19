# doctor7-onprem

doctor7-onprem is a psychological care platform that runs on your own server. It
runs without containers on Debian, with Apache as the web server and MariaDB as
the database. Video consultations work with Google Meet or Jitsi. You choose the
provider in the configuration.

All data in this repository is synthetic. Do not commit real patient data,
credentials, or cloud configuration.

This project is submitted to Kiroween in the Frankenstein category.

## Status

The repository is in its initial setup. Only the license, documentation, agent
steering, hooks, and the secret scanner exist so far.

## Layout

| Path        | Contents                                   |
| ----------- | ------------------------------------------ |
| `api/`      | Node.js API (planned)                      |
| `web/`      | React and Vite front end (planned)         |
| `packaging/`| Debian packaging and install scripts (planned) |
| `seed/`     | Synthetic seed data (planned)              |
| `tools/`    | Simulators for external services (planned) |
| `docs/`     | Project documentation (planned)            |
| `scripts/`  | Repository tooling, including the secret scanner |
| `.kiro/`    | Kiro steering, hooks, and specs            |

## Development

Requirements: Node.js. The root `package.json` declares the `api` and `web`
workspaces and has no dependencies.

```sh
npm test
```

This is the fast check. It runs `node --test "scripts/**/*.test.js" "api/**/*.test.js" "tools/**/*.test.js" "seed/**/*.test.js" "packaging/**/*.test.js"`.
A test that needs an input the clone does not have is skipped, and the output names the
missing input. A clean clone with no build passes, and these tests are skipped:

- The MariaDB tests, without `DATABASE_URL`.
- The packaging tests that need `bash`, `dpkg`, or `git`.
- The secret scanner tests that need `git`, or a `.git` entry.
- The forbidden-word checks, without a word list.

```sh
npm run verify
```

This is the full check. It builds the web client (`npm run build --workspace=web`), then
runs `npm test` with `REQUIRE_BUNDLE_BUDGET=1`. The bundle budget test fails when the build
is missing, instead of skipping. `verify` does not run the web tests. Run them with
`npm run test:web`.

The web tests run with Vitest and are not part of `npm test`. Run them with:

```sh
npm run test:web
```

Without a build in `web/dist`, the bundle budget test is skipped and says which command
builds it. With a build, it measures the initial JavaScript and CSS and fails when a size is
over its budget.

To run the scanner by itself:

```sh
node scripts/scan-secrets.js
```

### Build the Debian packages

```sh
npm run build --workspace=web
node packaging/build-deb.js all --out /tmp/doctor7-debs
node packaging/build-deb.js demo --out /tmp/doctor7-debs
```

`all` builds `doctor7-api` and `doctor7-web`. `demo` builds the demo package, which
is never part of `all`. The package version comes from the first source that is
set: `--version`, the `D7_VERSION` variable, git (`<version>+git<commit count>.<hash>-1`),
and the root `package.json` as the last resort. `docs/OPERATIONS.md` has the details.

### Forbidden-word list

The scanner checks key patterns in every file that would enter a commit. It
also checks forbidden words, but the list of words is kept outside the
repository. The scanner reads the list from the first of these:

1. The file named by the `FORBIDDEN_WORDS_FILE` environment variable. A relative
   path is resolved from the directory where the scanner runs.
2. `scripts/forbidden-words.local.txt`, which git ignores.

The file has one term per line. Matching ignores case. Lines that start with `#`
are comments. `scripts/forbidden-words.example.txt` shows the format with
invented terms.

With neither file present, the scanner checks key patterns only and prints one
warning line. The documentation check in the test suite is skipped in that case.
The scanner never scans the list files.

## Contributing

Contributions must keep all text in English, use synthetic data only, and pass
`npm test`. See `CLAUDE.md` for the rules that also apply to automated agents.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
