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

This runs `node --test scripts`, which includes the secret and forbidden-word
scan of the repository.

To run the scanner by itself:

```sh
node scripts/scan-secrets.js
```

## Contributing

Contributions must keep all text in English, use synthetic data only, and pass
`npm test`. See `CLAUDE.md` for the rules that also apply to automated agents.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
