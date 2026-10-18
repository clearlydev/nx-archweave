# Getting started

English | [한국어](ko-KR/getting-started.md)

You can create a new Nx workspace with the `create-nx-archweave` CLI, or add the plugin to a workspace you already have. This page covers installation, requirements, package-manager quirks, the CLI's questions and flags, and the steps the CLI runs.

## Installation

### New workspace

You don't need to install anything first. Run the CLI through `npx`:

```bash
npx create-nx-archweave my-app
```

### Existing Nx workspace

Add the plugin as a dev dependency at the workspace root. That's where Nx plugins belong. Use the workspace's package manager:

```bash
npm install -D @clearlydev/nx-archweave        # npm
pnpm add -D -w @clearlydev/nx-archweave        # pnpm
yarn add -D @clearlydev/nx-archweave           # yarn berry (yarn 1: add -W)
bun add -d @clearlydev/nx-archweave            # bun
```

Then check the install. This only reads, it doesn't change anything:

```bash
npm exec nx -- g @clearlydev/nx-archweave:doctor   # npm
pnpm nx g @clearlydev/nx-archweave:doctor          # pnpm
yarn nx g @clearlydev/nx-archweave:doctor          # yarn
bun nx g @clearlydev/nx-archweave:doctor           # bun
```

The examples below use `pnpm nx g`. With another package manager, run the same generator the way the block above shows.

> [!NOTE]
> The plugin ships as a self-contained bundle. Its only runtime dependency is `@nx/devkit`, so adding it doesn't pull a tree of transitive packages into your workspace.

## Requirements

- **Node** >= 22.18
- **A package manager:** **npm**, **pnpm >= 10**, **yarn** (classic 1.x or berry 2+) or **bun**. All four are first-class, and none of them is the default.
- **Network access to github.com:** the CLI downloads Nx's react template from there.

### Which package manager is used

| Situation | Used |
| --- | --- |
| You pass `--package-manager=npm\|pnpm\|yarn\|bun` | That one. It always wins, and you aren't asked. |
| In a terminal | The one you pick when the CLI asks |
| No terminal (CI, agents) | The launching manager, else npm |

- In a terminal, the CLI lists only the managers you have installed.
- It preselects the one you launched it with: `npx` → npm, `pnpm dlx` → pnpm, `yarn dlx` → yarn, `bunx` → bun.
- Without a terminal, it falls back to npm when it can't detect the launching manager.

Every generated command, workspace registration and review workflow then follows that choice. The generators detect the workspace's real package manager from its lockfiles. So even if the package manager recorded in `toolkit.config.json` drifts, the generators still write the right files.

## Package-manager notes

### npm 10 and yarn 1

> [!WARNING]
> **npm 10** and **yarn 1** can't create the react-vite workspace. Both fail inside `create-nx-workspace`'s own install of Nx's react template. Use npm 11+, pnpm, yarn 2+ (yarn berry comes with Corepack: `corepack enable`) or bun.

| Manager | Why it fails |
| --- | --- |
| **npm 10** (bundled with Node 22) | `Cannot read properties of null (reading 'edgesOut')` |
| **yarn 1** | It can't resolve the template's `workspace:*` packages |

- The CLI's question lists npm 10 and yarn 1 with the reason, but you can't pick them.
- If a flag or the launcher names one of them, the run stops before anything is created.
- `--frontend=next` installs fine with both npm 10 and yarn 1.

### yarn

- yarn berry workspaces use `nodeLinker: node-modules`, not Plug'n'Play. `create-nx-workspace` writes that setting itself.

> [!NOTE]
> Yarn 4 holds back package versions that are less than a day old (`npmMinimalAgeGate`, 1440 minutes by default). So for the first 24 hours after a release, yarn can't resolve the new version. That applies to `yarn dlx create-nx-archweave` and to the plugin install inside a yarn workspace. Wait a day, or set `YARN_NPM_MINIMAL_AGE_GATE=0` for that one run.

### bun

- bun silently blocks the install scripts of dependencies that aren't on its trusted list.
- In Nx's react template, that's `@swc/core`'s postinstall. The workspace builds without it.
- The CLI's last bun step prints `bun pm untrusted`. The blocked scripts stay blocked.

To allow one of them, run this inside the workspace:

```bash
bun pm trust <package>
```

### pnpm 11

pnpm 11 stops an install when a dependency's build script has no allow/deny decision in `pnpm-workspace.yaml` (`ERR_PNPM_IGNORED_BUILDS`). Nx's next template hits this during its own install. pnpm 10 isn't affected.

- That's why the CLI runs its pnpm steps with this check turned off.
- In its last step, the CLI records every build script pnpm skipped as **not allowed**. It uses pnpm's own command for that: `pnpm approve-builds '!<package>'`. No third-party install script runs until you say so.
- The success report names those packages.

To allow one of them later, run this inside the workspace:

```bash
pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=<package> --apply
```

The generator sets `<package>: true` under `allowBuilds` and runs `pnpm rebuild <package>`. You need the generator for this because `pnpm approve-builds` no longer lists a package once it's denied.

## AI coding tools

The CLI also asks which **AI coding tools** you use: Claude Code, Codex, Cursor, Gemini CLI, or more than one (`--ai-hosts=claude-code,cursor`). Without a terminal, it picks Claude Code. The tools you pick decide three things:

| Setting | Decided by the picked tools |
| --- | --- |
| Agent-rules files | `CLAUDE.md` for Claude Code, `AGENTS.md` for the others |
| Nx's own AI setup | `create-nx-workspace --aiAgents` |
| Default review provider | The first tool you picked |

Nx's react template ships every tool's files anyway, whatever you pass to `--aiAgents`.

### Agent rules

- nx-archweave puts its rules into `CLAUDE.md` and/or `AGENTS.md` as one marked block (`<!-- nx-archweave:agent-rules start -->` … `end -->`).
- nx-archweave never touches Nx's block or anything you write around the nx-archweave block.
- If a file still has the block but none of your picked hosts reads that file, the block stays until you remove it.

To change the hosts later, run `add-agent-rules`. It records the new hosts in `toolkit.config.json`.

```bash
nx g @clearlydev/nx-archweave:add-agent-rules --hosts=…
```

### Installed tools and catalog plugins

- The question shows which of the four tools are installed on this machine. The CLI checks `claude`, `codex`, `cursor-agent` and `gemini` with `--version`.
- A tool that can't run counts as not found. You can still select all four tools either way.
- Last, the CLI offers [catalog plugins](plugins.md) for each picked tool that's installed and has some. Pick them by number, or press Enter to skip (`--plugins=ponytail` or `--plugins=none`). Without a terminal, the CLI installs none.
- Each plugin you pick becomes a final `install-integration --scope=project --apply` step.
- If that step fails, the workspace is still complete, and the report gives you the command to retry.

## Quick start

### A brand-new workspace (CLI)

```bash
npx create-nx-archweave my-app \
  --preset=quick-start --frontend=react-vite --review
```

The CLI prints its three steps up front, then runs them with the package manager you chose:

| Step | What it runs |
| --- | --- |
| 1 | `create-nx-workspace` with Nx's react template |
| 2 | The plugin install |
| 3 | The plugin's `init` generator |

With npm, the three steps are:

```bash
npx -y create-nx-workspace@23.3.0 my-app \
  --template=nrwl/react-template \
  --pm=npm --nxCloud=skip --interactive=false
npm install -D @clearlydev/nx-archweave@^<cli-version>
npm exec nx -- g @clearlydev/nx-archweave:init \
  --preset=… --frontend=… --backend=… --locale=… \
  --allowDirty=true
```

With pnpm, step 3 takes the same flags as the npm `init` command above:

```bash
pnpm dlx create-nx-workspace@23.3.0 my-app \
  --template=nrwl/react-template \
  --pm=pnpm --nxCloud=skip --interactive=false
pnpm add -D -w @clearlydev/nx-archweave@^<cli-version>
pnpm nx g @clearlydev/nx-archweave:init …
```

- For `--frontend=next`, `--preset=next` replaces the template.
- pnpm adds a fourth step. It records the dependency build scripts pnpm skipped (see [pnpm 11](#pnpm-11)).
- bun adds a fourth step too. It lists the install scripts bun blocked, with `bun pm untrusted`.

**Why the CLI names the template.** The react-vite workspace is Nx's fullstack template, and the CLI asks for it by name.

- For `--preset=react-monorepo`, `create-nx-workspace` builds that template only when it detects an AI agent in the environment (Claude Code, Codex, Cursor, …).
- From a plain terminal, the same flags produce a different workspace with no `apps/api`.
- Naming the template gives you the same workspace on every run.
- The CLI downloads the template from github.com. It pins `create-nx-workspace` to the version the CLI's end-to-end gate validated.

**What the CLI does and doesn't do:**

- It never re-implements `create-nx-workspace`, and it never commits for you.
- It asks for anything you don't pass as a flag. `quick-start` keeps the questions to a minimum on purpose.
- If a step fails, the CLI stops right away and tells you how to recover. It leaves the created directory in place and never deletes it for you.

### Adding a backend

With `--backend=express|nest`, the plan gets two official steps:

```bash
pnpm add -D -w @nx/<backend>@<the workspace's exact nx version>
pnpm nx g @nx/<backend>:application apps/api --frontendProject=<detected app>
```

- Nx still does the generating. After that, init wires shared-types and scope tags, and writes the boundary constraints.
- On this path, `--applyEslint=true`, because the CLI just created the workspace.

Two things to know about Nx's templates:

| Template | `--backend=express` | `--backend=nest` |
| --- | --- | --- |
| react | Steps recorded as satisfied-by-template | Stops with guidance |
| Next | Both official steps run | Same as express |

- **react + express:** Nx's react template already ships an Express `apps/api`. So the CLI records the two official steps as satisfied-by-template.
- **react + nest:** The api slot is taken, so the CLI stops with guidance. Use express, or scaffold Nest yourself and run `add-backend`.
- **Next + either backend:** Both official steps run. `apps/api` goes beside the Next app, and `--frontendProject` comes from the Next app's package name.

Next workspaces put the app in `apps/<name>` and have no api. That's why both official steps run there, whichever backend you pick.

### Backend-only workspaces

Use `--frontend=none --backend=express|nest`. The frontend question offers `none` too.

- Nx's own preset builds the api (`create-nx-workspace --preset=<backend> --appName=api` → `apps/api`). So you don't need the two official steps above.
- init skips FSD, because there's no frontend to structure.
- `add-backend` wires the api alone: `scope:backend`, `libs/shared-types` and the same deny rules. Those deny rules then guard whichever frontend joins later.

The two presets differ:

| Preset | Workspace | What wires `shared-types` |
| --- | --- | --- |
| express | package-based | the workspace link |
| nest | integrated (no workspace packages) | a `tsconfig.base.json` paths alias |

If you run `add-backend` by hand on such a workspace, you get the same result.

### CLI flags

| Flag | Values |
| --- | --- |
| `<name>` | Positional: the workspace directory name |
| `--preset` | `quick-start` \| `solo` \| `team` |
| `--frontend` | `react-vite` \| `next` \| `none` |
| `--backend` | `express` \| `nest` \| `none` |
| `--locale` | `ko` \| `en` |
| `--review` / `--no-review` | — |
| `--review-provider` | `claude` \| `gemini` \| `gpt` \| `cursor` |
| `--plugin-source` | Package spec, path, or tarball |
| `--ai-hosts` | `claude-code`, `codex`, `cursor`, `gemini-cli` |
| `--plugins` | Catalog ids (`ponytail`), or `none` |
| `--package-manager` | `npm` \| `pnpm` \| `yarn` \| `bun` |
| `-h`, `--help` / `-v`, `--version` | — |

When stdin isn't a TTY and a required input is missing, the CLI fails fast with a clear message. It doesn't hang, and it doesn't silently exit with success.

#### `--preset`

- If you leave it out, the CLI asks.

#### `--frontend`

- If you leave it out, the CLI asks.
- `none` means a backend-only workspace. It needs `--backend`.

#### `--backend`

- If you leave it out, the CLI asks.
- A backend adds `apps/api`, plus shared-types and **enforced** boundaries.

#### `--locale`

- If you leave it out, the CLI asks.
- `quick-start` doesn't ask. It defaults to `en`.

#### `--review` / `--no-review`

If you pass neither flag:

- `quick-start` asks y/N. Without a terminal, it fails and asks you for the flag.
- `solo` and `team` turn review on.

#### `--review-provider`

- The CLI asks when review is on. Pick by number.
- Enter picks the provider of the first AI tool you chose, for example Codex → GPT.
- Without a terminal, the CLI uses that same default.
- The CLI refuses this flag when review ends up off.

#### `--plugin-source`

- Overrides what step 2 installs.
- The default is the plugin release this CLI matches, `^<CLI version>`.
- Use it to pin a version (`@clearlydev/nx-archweave@1.2.3`) or to point at a local build.

#### `--ai-hosts`

- Takes a comma-separated list.
- If you leave it out, the CLI asks. Pick by number. Enter picks Claude Code.
- Without a terminal, the CLI uses Claude Code.

#### `--plugins`

- Takes a comma-separated list of catalog ids, or `none`.
- If you leave it out, the CLI asks once for each picked host that's installed. Pick by number. Enter picks none.
- Without a terminal, the CLI installs none.
- Each plugin must belong to a host you picked.

#### `--package-manager`

- If you leave it out, the CLI asks. It lists the installed managers that can create the workspace and preselects the launcher.
- Without a terminal, the CLI uses the launcher, else npm.

### An existing workspace (plugin)

Read-only diagnosis:

```bash
pnpm nx g @clearlydev/nx-archweave:doctor
```

CI gate:

```bash
pnpm nx g @clearlydev/nx-archweave:doctor --json --quiet |
  jq -e '.overallStatus == "safe" or .overallStatus == "manual-review-required"'
```

> [!TIP]
> yarn 1 prints a banner on stdout, so use `yarn --silent nx g …` there. yarn berry doesn't need the flag.

Preview `init` with `--dryRun`, then run it:

```bash
pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=next --dryRun
pnpm nx g @clearlydev/nx-archweave:init --preset=team --frontend=next
```

> [!IMPORTANT]
> `init` needs a clean git working tree. That way, you can always undo a partial run with a single `git restore .`. Pass `--allowDirty` to skip that check. The report then warns you that `git restore .` will also revert the changes you had before.
