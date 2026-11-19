# CLAUDE.md

Instructions for AI agents working in this repository.

## Purpose

doctor7-onprem is a psychological care platform for on-premise deployment. It
runs without containers on Debian, with Apache and MariaDB. Video consultations
use Google Meet or Jitsi, selected through configuration.

## Rules

1. **Synthetic data only.** Seed data, fixtures, and examples must be invented.
   Never copy data from real clients, real patients, or other repositories.
2. **No credentials.** Never write passwords, tokens, keys, `.env` contents, or
   cloud account identifiers into code, docs, tests, or logs. Use environment
   variables or a vault. Do not read or print `.env`, `.env.save`, credential
   files, key files, or cloud configuration.
3. **No containers.** Do not add Dockerfile, docker-compose, or Kubernetes files.
   Target Debian with Apache and MariaDB.
4. **English only.** All public text (code comments, docs, commit messages,
   UI strings in the repository) is in English.
5. **Forbidden words.** The list in `scripts/forbidden-words.txt` must not appear
   in any committed file. The scanner enforces this.

## Commands

```sh
npm test                    # node --test scripts (secret scan and tests)
node scripts/scan-secrets.js  # scan the files that would be committed
```

## Limits for agents

- Work only inside the repository directory.
- Modify only the files named in the task scope.
- Do not install dependencies unless the task asks for it.
- Do not push, change branches, or deploy.
- Do not run AWS, CDK, Amplify, or Firebase commands.
- Report bugs and ideas outside the task scope. Do not fix them unless asked.
- Before committing, run `npm test` and report its literal output.
