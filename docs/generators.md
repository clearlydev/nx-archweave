# Generators and presets

English | [한국어](ko-KR/generators.md)

This page covers all 16 generators and their options, plus the three presets that `init` turns into concrete defaults.

## Generators

The 16 generators are grouped by what they do. Each group starts with a short table, then gives each generator its own section with its options.

### Setup and diagnosis

| Generator | What it does |
| --- | --- |
| `init` | Sets up the workspace from a preset |
| `doctor` | Read-only diagnosis; never writes anything |

#### `init`

A preset-driven pipeline. It runs `add-fsd-lite`, `add-agent-rules`, `add-github-templates`, `add-review` and `add-backend` according to the preset and the stack axes. Then it runs a best-effort validation.

- `--preset`, `--frontend`, `--backend`, `--packageManager`, `--locale`
- `--aiHosts`, `--reviewProvider`
- `--fsd`, `--agentRules`, `--githubTemplates`, `--review`
- `--applyEslint`, `--allowDirty`, `--dryRun`

Here's how `init` resolves the five options that have a fallback:

| `init` option | When you leave it out |
| --- | --- |
| `--frontend` | Required until init has recorded it (see below) |
| `--backend` | The recorded value, else none |
| `--packageManager` | The lockfile, then the recorded value, then pnpm |
| `--locale` | The recorded value, else `en` |
| `--reviewProvider` | The recorded value, else the first AI host's (see below) |

- `--frontend`: `none` means backend-only, and FSD is skipped.
- `--preset` and `--frontend` are both required until init has recorded them. After that, leaving them out uses the values init recorded.
- `--locale` is recorded in `toolkit.config.json`.
- `--reviewProvider`: if `--aiHosts` changes the first host, init skips the recorded value and uses the first AI host's provider.

#### `doctor`

Runs read-only checks. It never writes anything.

- `--liveIntegrations`, `--json`

`doctor` runs the 7 checks below. Together they also cover the nx version range, whether boundary tags exist, FSD-like structure and drift states.

- Nx workspace detection
- package manager
- workspace root
- Nx version
- framework detection
- review setup consistency
- integration state

### Wiring

| Generator | What it does |
| --- | --- |
| `add-fsd-lite` | Wires the FSD boundary rule into the frontend app |
| `add-agent-rules` | Writes nx-archweave's rules for each AI host |
| `add-github-templates` | Generates Issue Forms, a PR template, CODEOWNERS |
| `add-review` | Installs the automated PR review workflow |
| `add-backend` | Wires a backend app into the workspace |

#### `add-fsd-lite`

Wires the `archweave/fsd-boundaries` ESLint rule into the frontend app's config and prints the layer guide. It doesn't create any folders.

- `--frontend` — when you leave it out: the value in `toolkit.config.json`, which init records
- `--project` — when you leave it out: the one frontend app
- `--enforcement`, `--applyEslint`, `--steiger`, `--locale`, `--dryRun`

With `--applyEslint`, `add-fsd-lite` writes the ESLint config. Without it, you get a paste-ready snippet. `--steiger` adds the official FSD linter as an opt-in `fsd-check` target.

#### `add-agent-rules`

Writes nx-archweave's rules as one marked block into the file each AI host reads. That's `CLAUDE.md` for Claude Code and `AGENTS.md` for the other hosts.

- `--hosts` — a checkbox prompt. Default: `aiHosts` in `toolkit.config.json`, else Claude Code
- `--teamRules`, `--locale`, `--dryRun`

`add-agent-rules` creates the file, appends the block, or updates only the block. It never touches the text around the block.

#### `add-github-templates`

Generates GitHub Issue Forms, a PR template and CODEOWNERS.

- `--issue`, `--pr`, `--codeowners`, `--locale`, `--dryRun`

#### `add-review`

Installs the automated PR review workflow and the `review` field in `toolkit.config.json`.

- `--provider`, `--mode`, `--maxRounds` — when you leave one out: the value already recorded, else `claude` / `standard` / `3`
- `--onConflict`, `--locale`, `--dryRun`

#### `add-backend`

Wires a backend app in: a `shared-types` lib, `scope:` tags and boundary constraints.

- `--backend` (required), `--apiName`, `--frontendProject`, `--applyEslint`, `--dryRun`

Creating the app itself stays with the official tools. If the `api` project is missing, `add-backend` refuses and prints copy-paste `@nx` commands. An `api` with no frontend (a backend-only workspace) is wired on its own.

### Slices

| Generator | What it does |
| --- | --- |
| `page` | Scaffolds a page slice under `src/pages` |
| `widget` | Scaffolds a widget slice under `src/widgets` |
| `feature` | Scaffolds a feature slice under `src/features` |
| `entity` | Scaffolds an entity slice under `src/entities` |
| `shared` | Scaffolds a shared segment under `src/shared` |

#### `page`

Scaffolds a page slice under the app's `src/pages`. On Next.js, it uses `src/_pages` instead.

- `--name` (required), `--publicApiName`, `--segments`, `--project`
- `--frontend`, `--locale`, `--dryRun`

#### `widget`

Scaffolds a widget slice under the app's `src/widgets`. The Lite default leaves this layer out, so you're one command away from adding it.

- Same options as `page`, minus `--frontend`

#### `feature`

Scaffolds a feature slice (`index.ts` + `model/`) under the app's `src/features`. It creates the layer directory on the way if it's missing.

- `--name` (required), `--publicApiName`, `--project`, `--locale`, `--dryRun`
- `--segments` — extra segments, e.g. `ui,api`

#### `entity`

Scaffolds an entity slice under the app's `src/entities`.

- Same options as `feature`

#### `shared`

Scaffolds a shared segment under the app's `src/shared`. You name it by purpose: `ui`, `api`, `model`, `lib` or `config`.

- Same options as `feature`, minus `--segments`. The segment is the name.

### Integrations

| Generator | What it does |
| --- | --- |
| `add-integration` | Previews a catalog plugin's official install flow |
| `install-integration` | Installs a catalog plugin with the host's CLI |
| `record-integration` | Verifies and records an install done elsewhere |

#### `add-integration`

**Preview only.** It shows the official install flow for a catalog plugin. It installs nothing and writes nothing.

- `--tool` (required), `--target`, `--scope`, `--versionRange`, `--dryRun`

The preview shows the source, the license, the exact install command, the manual alternative, and how to uninstall.

#### `install-integration`

With `--apply`, it runs the host's official CLI install of a catalog plugin. Without `--apply`, you get a preview.

- `--tool` (required), `--target`, `--scope`, `--versionRange`, `--apply`

`install-integration --apply` installs at project scope by default. Then it re-verifies the plugin live, records the manifest entry and declares the plugin in `toolkit.config.json`.

#### `record-integration`

Verifies an install done outside nx-archweave. With `--apply`, it also records the verified state in `archweave-integrations.json`.

- `--tool` (required), `--target`, `--apply`

### pnpm builds

#### `allow-builds`

pnpm only. Allows dependency build scripts that pnpm skipped or was told to deny. Without `--apply`, you get a preview.

- `--packages` (required, comma-separated), `--apply`

With `--apply`, `allow-builds` sets those packages to `true` in `pnpm-workspace.yaml` and runs `pnpm rebuild` for them. It writes to `allowBuilds`, or to pnpm 10's `onlyBuiltDependencies` list.

> [!NOTE]
> **Unknown file shapes are left alone.** If `allow-builds` doesn't recognize a file's shape, it tells you and doesn't edit the file.

## Presets

`init` turns each preset into concrete defaults for the sub-generators it runs.

> [!IMPORTANT]
> Flags you pass explicitly always win over preset defaults.

| | `quick-start` | `solo` | `team` |
| --- | --- | --- | --- |
| FSD Lite | on | on | on |
| FSD rule severity (`fsd.enforcement`) | `warn` | `warn` | `error` |
| Agent rules | the AI hosts' files | the AI hosts' files | the AI hosts' files + Team Rules section |
| Team Rules section | — | — | yes |
| GitHub templates | PR only | PR only | Issue + PR |
| Review enabled by default | **no** (opt-in) | yes | yes |
| Review mode | `fast` | `fast` | `standard` |
| Max review rounds | 3 | 3 | 3 |
| Conflict policy | `merge-proposal` | `merge-proposal` | `merge-proposal` |
| Integrations | none (always user-driven) | none | none |

> [!NOTE]
> - **`frontend`/`backend` aren't in the table above.** They're axes, not preset policy. All three presets ask you for the stack.
> - **Verdict behavior is the same in all three presets.** It's a fixed algorithm, not a configuration value.
