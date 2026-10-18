## What and why

<!-- What this changes and the problem it solves. Link the issue: Closes #… -->

## How it was tested

<!-- Unit tests, and for changes to what gets generated or installed:
     node tools/e2e-create.mjs --pm=<pnpm|npm|yarn|bun> [--frontend=…] [--backend=…] -->

## Checklist

- [ ] `pnpm nx run-many -t build,test,lint,typecheck,bundle` passes
- [ ] Refusal and conflict paths are tested, not only the happy path
- [ ] The title is a Conventional Commit (`feat:`, `fix:`, `docs:` …) — see CONTRIBUTING.md
