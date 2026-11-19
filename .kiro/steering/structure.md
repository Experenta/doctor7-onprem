# Structure

```
api/         Node.js API (planned)
web/         React and Vite front end (planned)
packaging/   Debian packaging and install scripts (planned)
seed/        Synthetic seed data (planned)
tools/       Simulators for external services, such as video providers (planned)
docs/        Project documentation (planned)
scripts/     Repository tooling: secret scanner and its tests
.kiro/       Kiro steering, hooks, and specs
```

## Rules

- Keep empty planned folders in git with a `.gitkeep` file.
- Put repository tooling in `scripts/`. Put application code in `api/` or `web/`.
- Put simulators in `tools/`, not in `api/` or `web/`.
- Put specs for planned work in `.kiro/specs/`.
- Do not commit `.env` files or generated output.
