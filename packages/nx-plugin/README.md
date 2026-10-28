# @clearlydev/nx-archweave

Nx generators that get a workspace ready to work on with one preset:

- an FSD Lite lint rule for the frontend app's layers (`warn` or `error` by preset), plus slice generators
- frontend/backend boundaries as lint errors between the projects it tags, when there is a backend
- AI agent rules
- GitHub templates
- optional AI PR review with the provider you choose (Claude supported; Gemini, GPT and Cursor in beta)

Starting a brand-new workspace instead? Use [`create-nx-archweave`](https://www.npmjs.com/package/create-nx-archweave). It creates the workspace, installs this plugin, and runs `init`, all in one command.

## Install

Run one of these at the workspace root, with the workspace's package manager:

```bash
npm install -D @clearlydev/nx-archweave        # npm
pnpm add -D -w @clearlydev/nx-archweave        # pnpm
yarn add -D @clearlydev/nx-archweave           # yarn berry (yarn 1: add -W)
bun add -d @clearlydev/nx-archweave            # bun
```

Then confirm the install. `doctor` is read-only:

```bash
npm exec nx -- g @clearlydev/nx-archweave:doctor   # npm
pnpm nx g @clearlydev/nx-archweave:doctor          # pnpm
yarn nx g @clearlydev/nx-archweave:doctor          # yarn
bun nx g @clearlydev/nx-archweave:doctor           # bun
```

- **Requirements:** Node >= 22.18, plus one of npm, pnpm >= 10, yarn (classic or berry) or bun. All four package managers are first-class.
- Generators detect the workspace's real package manager from its lockfiles.
- The examples below use `pnpm nx g`. With another package manager, run the same generator the way the `doctor` commands above show.
- The package ships its own code as a bundle. Its runtime dependencies are `@nx/devkit` and `jsonc-parser`, which nx already depends on at the same version.

## Quick start

Preview the full run first. This writes nothing:

```bash
pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=next --dryRun
```

Then run it for real:

```bash
pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=next
```

- `init` runs the content generators below according to the preset (`quick-start` | `solo` | `team`).
- `init` requires a clean git working tree, so a partial run can be undone exactly: the report lists the files it modified (`git restore -- …`) and the files it created.
- `--allowDirty` opts out of the clean-tree check. The report then warns you that the rollback scope is wider.
- `--locale=ko|en` sets the language of generated content. Reports are always in English.

## Generators

| Generator | What it does |
| --- | --- |
| `init` | Runs the five `add-*` generators by preset |
| `doctor` | Read-only diagnosis; never writes |
| `add-fsd-lite` | Wires in the FSD boundaries ESLint rule |
| `add-agent-rules` | Writes rules into each AI host's file |
| `add-github-templates` | Issue Forms, PR template, CODEOWNERS |
| `add-review` | AI PR review workflow |
| `add-backend` | Wires a backend app in |
| `page` / `widget` / `feature` / `entity` / `shared` | Scaffold an FSD slice or segment |
| `add-integration` | Previews a catalog plugin's install flow |
| `install-integration` | Installs a catalog plugin (with `--apply`) |
| `record-integration` | Records a plugin you installed by hand |
| `allow-builds` | pnpm only: allows skipped build scripts |

In the option lists below:

- \* marks a required option.
- † marks an option that's required until `init` has recorded it in `toolkit.config.json`. After that, if you leave it out, the generator uses the recorded value.

### `init`

A preset-driven pipeline over the five `add-*` generators: `add-fsd-lite`, `add-agent-rules`, `add-github-templates`, `add-review` and `add-backend`. After the run, `init` does a best-effort validation (actionlint, `nx graph`).

Options: `--preset`†, `--frontend`†, `--backend`, `--packageManager`, `--locale`, `--aiHosts`, `--reviewProvider`, `--fsd`, `--agentRules`, `--githubTemplates`, `--review`, `--applyEslint`, `--allowDirty`, `--dryRun`

### `doctor`

A read-only diagnosis. `doctor` never writes. It checks:

- workspace, package manager and framework detection
- the nx version range
- whether the boundary tags exist
- FSD-like structure
- review consistency
- drift states

Options: `--liveIntegrations`, `--json`

### `add-fsd-lite`

Wires the `archweave/fsd-boundaries` ESLint rule into the frontend app's config. The rule ships as `@clearlydev/nx-archweave/eslint`.

- With `--applyEslint`, the generator writes the config. Without it, you get a paste-ready snippet.
- An unrecognized config is never edited.
- Prints the layer guide (Next.js: `pages` → `_pages/`).
- Creates no folders.
- `--steiger` adds the official FSD linter as an opt-in `fsd-check` target (Node ≥ 22.18).

Options: `--frontend`†, `--project`, `--enforcement`, `--applyEslint`, `--steiger`, `--locale`, `--dryRun`

### `add-agent-rules`

Writes nx-archweave's rules as one marked block in the file each AI host reads:

- `CLAUDE.md` for Claude Code
- `AGENTS.md` for Codex, Cursor and Gemini CLI

The generator never touches the text around the block.

Options: `--hosts`, `--teamRules`, `--locale`, `--dryRun`

### `add-github-templates`

Adds GitHub Issue Forms, a PR template and CODEOWNERS. The generator always skips files that already exist.

Options: `--issue`, `--pr`, `--codeowners`, `--locale`, `--dryRun`

### `add-review`

Installs the AI PR review workflow and the `review` field in `toolkit.config.json`.

- `--provider`, `--mode`, `--maxRounds`: if you leave one out, the generator uses the value already recorded
- `--onConflict`, `--locale`, `--dryRun`

### `add-backend`

Wires a backend app in:

- a `shared-types` lib
- `scope:` tags
- boundary constraints (written only with `--applyEslint`)

If the `api` project is missing, the generator refuses and gives you the official commands to copy and paste.

Options: `--backend`\*, `--apiName`, `--frontendProject`, `--applyEslint`, `--dryRun`

### `page` / `widget` / `feature` / `entity` / `shared`

`page`, `widget`, `feature` and `entity` scaffold a slice: `index.ts` + `model/`, plus `--segments` extras. `shared` scaffolds a purpose-named segment instead. Each generator writes to its own layer in the app:

- `page` → `src/pages` (`_pages` on Next.js)
- `widget` → `src/widgets`
- `feature` → `src/features`
- `entity` → `src/entities`
- `shared` → `src/shared`

All five generators create the layer directory if it's missing, skip slices that have the same name, and check that `--publicApiName` is a usable identifier.

- Options: `--name`\*, `--publicApiName`, `--segments`, `--project`, `--locale`, `--dryRun`
- `--segments` isn't available on `shared`, because there the segment is the name.
- `page` also takes `--frontend`.

### `add-integration`

**Preview only.** Shows a catalog plugin's official install flow: source, license, manual steps and uninstall. `add-integration` installs nothing and writes nothing.

Options: `--tool`\*, `--target`, `--scope`, `--versionRange`, `--dryRun`

### `install-integration`

With `--apply`, `install-integration`:

- runs the host's official CLI install of a catalog plugin (project scope by default)
- re-verifies the install live
- records the manifest entry
- declares the tool in `toolkit.config.json`

Without `--apply`, you get a preview.

Options: `--tool`\*, `--target`, `--scope`, `--versionRange`, `--apply`

### `record-integration`

Verifies a manually completed install live. With `--apply`, it records exactly one entry in `archweave-integrations.json`, and only when the authoritative signal succeeds.

Options: `--tool`\*, `--target`, `--apply`

### `allow-builds`

pnpm only. Allows dependency build scripts that pnpm skipped or was told to deny. With `--apply`, `allow-builds` sets those packages to `true` in `pnpm-workspace.yaml` and runs `pnpm rebuild`. Without `--apply`, you get a preview.

Options: `--packages`\*, `--apply`

## Presets

| | `quick-start` | `solo` | `team` |
| --- | --- | --- | --- |
| FSD Lite | on | on | on |
| FSD rule severity | `warn` | `warn` | `error` |
| Agent rules | the AI hosts' files | the AI hosts' files | the AI hosts' files + Team Rules section |
| GitHub templates | PR only | PR only | Issue + PR |
| Review default | off (opt-in) | on | on |
| Review mode | `fast` | `fast` | `standard` |

Explicit flags always win over preset defaults.

## AI PR review

Review is fully optional and isn't tied to one provider.

- If review is disabled, zero review artifacts are generated.
- If review is enabled, the workflow **green-skips** (it never fails) until you register the provider's secret.
- A round marker stops the workflow after `--maxRounds` reviews per PR (1–5, default 3).

| `--provider` | Workflow file | Required secret |
| --- | --- | --- |
| `claude` (default) | `.github/workflows/claude-code-review.yml` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `gemini` (beta) | `.github/workflows/gemini-code-review.yml` | `GEMINI_API_KEY` |
| `gpt` (beta) | `.github/workflows/gpt-code-review.yml` | `OPENAI_API_KEY` |
| `cursor` (beta) | `.github/workflows/cursor-code-review.yml` | `CURSOR_API_KEY` |

What each provider has been checked on, where to get its secret, and known issues: [Provider status](https://github.com/clearlydev/nx-archweave/blob/main/docs/pr-review.md#provider-status).

Modes:

- `fast` and `standard` review correctness & security.
- `thorough` adds an over-engineering pass.

Findings are prioritized P0–P3/Nit per the bundled review policy.

## Behavioral contracts

Every generator keeps four promises:

- `--dryRun` previews fully and writes nothing.
- Running it again against identical content reports "no change".
- A failed precondition produces a refusal report, not an exception.
- Conflicts are never silently overwritten.

## Optional plugins per AI host (experimental)

Three generators work with plugins from a reviewed **catalog**:

- `add-integration` previews a plugin.
- `install-integration` installs a plugin (with `--apply`).
- `record-integration` records a plugin.

Installs go through the AI host's own official installer, in project scope by default.

- The catalog is data. Claude Code is the only host with an adapter today, and [ponytail](https://github.com/DietrichGebert/ponytail) is its first entry.
- Recording requires the live `claude plugin list --json` signal to confirm that the plugin is installed **and** enabled.
- A disabled plugin, an ambiguous match or a CLI error produces zero writes, never a false "verified".
- `doctor` reports the declared, recorded and detected state of each plugin. `--liveIntegrations` re-verifies live.
- Nothing here runs unless you ask.

## More

Full documentation and the Korean README live in the [repository](https://github.com/clearlydev/nx-archweave).

## Contributing

- `nx build @clearlydev/nx-archweave` runs tsc, for local dev and typecheck.
- `nx test` runs Jest.
- `nx bundle` (depends on `build`) produces the publishable esbuild bundle in `dist/`. Internal workspace packages are inlined, so the tarball carries no `workspace:` deps.
- `prepack` re-runs `bundle` and strips `workspace:` ranges from the packed manifest only. It's interruption-safe: `postpack` restores the on-disk `package.json`.
- To verify a release candidate, run `node tools/verify-tarball.mjs` at the repo root.

## License

MIT
