# nx-archweave — notes for coding agents

An Nx plugin (`@clearlydev/nx-archweave`, 16 generators and the `archweave/fsd-boundaries` ESLint
rule) and a create CLI (`create-nx-archweave`), built from one pnpm + Nx monorepo. Human-oriented
details are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

- Install: `pnpm install` (Node >= 22.18; pnpm from `packageManager` via Corepack).
- Gate — run before every commit: `pnpm nx run-many -t build,test,lint,typecheck,bundle`.
- One project: `pnpm nx test <project>` (projects: `@clearlydev/nx-archweave`, `create-nx-archweave`,
  `@nx-archweave/template-engine`, `@nx-archweave/templates`, `@nx-archweave/review-policy`,
  `@nx-archweave/integrations`, `@nx-archweave/shared`).
- Packed-tarball smoke test: `node tools/verify-tarball.mjs`.
- Real create flow: `node tools/e2e-create.mjs --pm=<pnpm|npm|yarn|bun> [--frontend=…] [--backend=…]`
  — from a clean environment: `create-nx-workspace` builds a different workspace when it sees an
  AI coding agent's environment variables. Do not `git add -A` while it runs: packing rewrites
  `packages/*/package.json` for a moment.

Always run tasks through `pnpm nx`, never the underlying tool directly.

## Where things go

- A file a generator creates whole: a template in that generator's `files/` directory
  (`packages/nx-plugin/src/generators/<name>/files/`), rendered by `renderTemplateFiles` in
  `generators/shared/template-files.ts` through Nx's `generateFiles`. Text spliced into existing
  files or composed per option: `packages/templates` (per locale `en` / `ko`). Generators never
  inline content.
- Composition and doctor checks: `packages/template-engine`. Review prompts and the verdict gate:
  `packages/review-policy`. AI host adapters and the plugin catalog: `packages/integrations`.
- Generators: `packages/nx-plugin/src/generators/<name>/` (`generator.ts`, `schema.json`,
  `schema.d.ts`, `files/`), registered in `packages/nx-plugin/generators.json`.
- CLI: `packages/create-nx-archweave/src/cli/` — `plan.ts` builds the command list, `execute.ts`
  runs it.

## Rules

- Relative imports name the `.ts` file (`import { x } from './render.ts'`); the build rewrites them.
- Generators preview with `--dryRun` and write nothing until asked; integrations act only with
  `--apply`. A failed precondition is reported in the generator's report, not thrown.
- Test the refusal and conflict paths, not only the happy path. Snapshot tests run in CI mode, so a
  renamed test needs its snapshot key renamed too.
- Nothing commits for the user or deletes a directory it created. Anything that acts outside the
  workspace tree (installing an AI host plugin) runs only with `--apply`, through the host's own
  CLI. The create CLI runs official tools (`create-nx-workspace`, Nx generators) and never
  re-implements them.
- Comments explain the code; they don't cite issues, reviews or design notes.
- Actions in generated workflows are pinned to a commit SHA in
  `packages/template-engine/src/review/action-pins.ts`, mirrored in `.github/workflows/pinned-actions.yml`
  for Dependabot; `review/workflow-security.spec.ts` must pass.
- Versions and `CHANGELOG.md` are written by `pnpm release` (Nx Release) from the commits on `main`;
  never edit them by hand. Pull request titles are Conventional Commits (`feat:`, `fix:`, `docs:` …)
  because the squash-merged title is what the release reads.
- A change that would break or silently alter a workspace the plugin already set up (a generated
  file's shape, a `toolkit.config.json` key) ships with an Nx migration — see "Changes that affect
  existing workspaces" in CONTRIBUTING.md. Fixes and new opt-in options need none.
