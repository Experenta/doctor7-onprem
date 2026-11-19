# Technology

## Target runtime

- Debian Linux server.
- Apache as the reverse proxy and static file server.
- MariaDB as the database.
- Node.js for the API.
- No containers (no Docker, no Kubernetes).

## Stack

- `api/`: Node.js API.
- `web/`: React with Vite.
- Root `package.json`: npm workspaces `api` and `web`. The root has no
  dependencies. Each workspace declares its own.

## Tests

- Run `npm test` from the repository root. It runs `node --test scripts`.
- The test suite includes the secret scanner. The scanner checks cloud key and
  token patterns and the forbidden word list.

## Conventions

- Use ES modules or CommonJS consistently within each workspace. Do not mix them
  inside one package.
- Use parameterized SQL queries.
- Read secrets from environment variables. Never hard-code them.
- Write the code and the comments in English.
