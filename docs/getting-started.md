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

Not an Nx workspace yet? Run `npx nx@latest init` in the repository first — it turns a plain app repository into one (and rewrites some `package.json` scripts to go through Nx). Don't run `create-nx-archweave` inside it: that makes a second, nested workspace, and the CLI stops unless you pass `--allow-nested`.

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
> The plugin ships its own code as a bundle. Its runtime dependencies are `@nx/devkit` and `jsonc-parser`, which nx itself already depends on at the same version, so adding the plugin doesn't pull a tree of transitive packages into your workspace.

## Requirements

- **Node** >= 22.18
- **A package manager:** **npm**, **pnpm >= 10**, **yarn** (classic 1.x or berry 2+) or **bun**. All four are first-class, and none of them is the default.

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

### yarn

- yarn berry workspaces use `nodeLinker: node-modules`, not Plug'n'Play. `create-nx-workspace` writes that setting itself.

> [!NOTE]
> Yarn 4 holds back package versions that are less than a day old (`npmMinimalAgeGate`, 1440 minutes by default). So for the first 24 hours after a release, yarn can't resolve the new version. That applies to `yarn dlx create-nx-archweave` and to the plugin install inside a yarn workspace. Wait a day, or set `YARN_NPM_MINIMAL_AGE_GATE=0` for that one run.

### bun

- bun silently blocks the install scripts of dependencies that aren't on its trusted list.
- In an Nx workspace, that's typically `@swc/core`'s postinstall. The workspace builds without it.
- The CLI's last bun step prints `bun pm untrusted`. The blocked scripts stay blocked.
- With Next.js, the web app's `test` can't start under bun's isolated install (see [Known issues](#known-issues-in-generated-workspaces)).

To allow one of them, run this inside the workspace:

```bash
bun pm trust <package>
```

### pnpm 11

pnpm 11 stops an install when a dependency's build script has no allow/deny decision in `pnpm-workspace.yaml` (`ERR_PNPM_IGNORED_BUILDS`). Nx's next preset hits this during its own install. pnpm 10 isn't affected.

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

With no tool picked, the CLI passes `--aiAgents=none`. Otherwise Nx would add files for whichever agent it detects in the environment.

### Agent rules

- nx-archweave puts its rules into `CLAUDE.md` and/or `AGENTS.md` as one marked block (`<!-- nx-archweave:agent-rules start hash=… -->` … `end -->`).
- The start marker records a hash of the block. If you edit the block (for example, fill in a TODO), a rerun keeps your version and shows what it would have written. Pass `--overwriteBlock` to replace it.
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

The CLI prints its steps up front, then runs them with the package manager you chose:

| Step | What it runs |
| --- | --- |
| 1 | `create-nx-workspace --preset=empty` |
| 2 | `nx add @nx/react` |
| 3 | `nx g @nx/react:app apps/web` |
| 4 | The plugin install |
| 5 | The plugin's `init` generator |

With npm, the steps are:

```bash
npx -y create-nx-workspace@24.0.1 my-app \
  --preset=empty --pm=npm --nxCloud=skip --interactive=false
npm exec nx -- add @nx/react
npm exec nx -- g @nx/react:app apps/web --bundler=vite --linter=eslint \
  --style=css --unitTestRunner=vitest --e2eTestRunner=none --routing=false
npm install -D @clearlydev/nx-archweave@^<cli-version>
npm exec nx -- g @clearlydev/nx-archweave:init \
  --preset=… --frontend=… --backend=… --locale=… \
  --allowDirty=true
```

With pnpm, steps 3 and 5 take the same flags as the npm commands above:

```bash
pnpm dlx create-nx-workspace@24.0.1 my-app \
  --preset=empty --pm=pnpm --nxCloud=skip --interactive=false
pnpm nx add @nx/react
pnpm nx g @nx/react:app apps/web …
pnpm add -D -w @clearlydev/nx-archweave@^<cli-version>
pnpm nx g @clearlydev/nx-archweave:init …
```

- For `--frontend=next`, step 1 is `--preset=next --appName=web --e2eTestRunner=none`, which already holds the app, so steps 2 and 3 don't run.
- pnpm adds a last step. It records the dependency build scripts pnpm skipped (see [pnpm 11](#pnpm-11)).
- bun adds a last step too. It lists the install scripts bun blocked, with `bun pm untrusted`.

**Why react-vite starts from the empty preset.**

- `--preset=react-monorepo` turns into a download of Nx's react template whenever `create-nx-workspace` detects an AI agent in the environment (Claude Code, Codex, Cursor, …). That template is a demo shop, and it follows its repository's latest commit, Nx version included.
- `--preset=empty` is never redirected and downloads nothing. The workspace stays on the `create-nx-workspace` version the CLI pins, the one its end-to-end gate validated, and `nx add` installs `@nx/react` at that same version.
- The app comes from Nx's own `@nx/react:app` generator, with every option it would otherwise ask about. It has no e2e project (see [Adding e2e tests](#adding-e2e-tests)).

**What the CLI does and doesn't do:**

- It never re-implements `create-nx-workspace`, and it never commits for you.
- It asks for anything you don't pass as a flag. `quick-start` keeps the questions to a minimum on purpose.
- If a step fails, the CLI stops right away and tells you how to recover. It leaves the created directory in place and never deletes it for you.
- It also prints the remaining steps, from the failed one on, as commands in order. It only prints them: fix the cause, then run them yourself.

### Adding a backend

With `--backend=express|nest`, the plan gets two official steps:

```bash
pnpm add -D -w @nx/<backend>@<the workspace's exact nx version>
pnpm nx g @nx/<backend>:application apps/api --frontendProject=<detected app> --unitTestRunner=vitest --e2eTestRunner=none
```

- Nx still does the generating. After that, init wires shared-types and scope tags, and writes the boundary constraints.
- On this path, `--applyEslint=true`, because the CLI just created the workspace.

- **Either frontend, either backend:** Both official steps run. `apps/api` goes beside `apps/web`, and `--frontendProject` comes from the web app's package name.
- **express:** The api gets express 5, which `@nx/express` installs. Nx 24's `@nx/react` no longer peers on express 4, so every frontend and package manager ends on the same major.

Both frontends put the app in `apps/web` and have no api. That's why both official steps run, whichever backend you pick. If an `apps/api` is somehow there already, the CLI stops and points you at `add-backend`.

### Adding e2e tests

The CLI creates no e2e project on any path, because Nx's Playwright setup downloads browsers to your machine, outside the workspace. When you want browser tests, add them with Nx's own generator, as [Nx's Playwright guide](https://nx.dev/docs/technologies/test-tools/playwright/introduction) shows:

```bash
pnpm nx add @nx/playwright
pnpm nx g @nx/playwright:configuration --project=<web project> \
  --webServerCommand="npx nx run <web project>:preview" \
  --webServerAddress=http://localhost:4300 --skipInstall
pnpm exec playwright install   # downloads the browsers, when you choose to
```

- `<web project>` is the `name` in `apps/web/package.json`, for example `@my-app/web`. On Next.js, use `<web project>:dev` and `http://localhost:3000`, the server Nx's own Next.js e2e setup points at.
- `--skipInstall` keeps the generator from downloading browsers. The last command does that when you're ready.

Measured on a React + Vite app with Nx 24.0.1, the generated setup needs one edit before `lint` passes: in `apps/web/eslint.config.mjs`, limit Playwright's rules to the e2e folder. Replace `playwright.configs['flat/recommended'],` with `{ ...playwright.configs['flat/recommended'], files: ['e2e/**/*.ts'] },`. Otherwise they also lint the app's own unit tests.

For the api, Nx 24.0 has no public generator that adds an e2e project to an existing app. Its backend generators create one only together with the app.

### Known issues in generated workspaces

Both come from Nx's generated setup, not from nx-archweave. They show up on create-nx-workspace 23.3.0 and 24.0.1 alike (measured 2026-10-25).

- **`typecheck` and `build` in one run can fail with TS6305.** Nx's generated app tsconfigs keep the typecheck output (`.d.ts` files and `tsbuildinfo`) in the app's `dist`, which `build` empties. When both run at once, typecheck can find its output gone: `TS6305: Output file '…/dist/….d.ts' has not been built from source file`. It's intermittent. Run them in two steps, `nx run-many -t build` and then `nx run-many -t typecheck`, or rerun. Related Nx issue: [nrwl/nx#36744](https://github.com/nrwl/nx/issues/36744).
- **bun + Next.js: the web app's `test` can't start.** Its jest config transforms with `@nx/react/plugins/jest`, and bun's default isolated install doesn't put `@nx/react` at the root, because it only arrives through `@nx/next`. Jest then reports `Module @nx/react/plugins/jest in the transform option was not found`. No Nx issue was found for it. In our measurement, installing with bun's hoisted linker (`bun install --linker hoisted`) avoided it.

### Backend-only workspaces

Use `--frontend=none --backend=express|nest`. The frontend question offers `none` too.

- Nx's own preset builds the api (`create-nx-workspace --preset=<backend> --appName=api --e2eTestRunner=none --unitTestRunner=vitest` → `apps/api`). So you don't need the two official steps above.
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
| `--allow-nested` | Create the workspace even inside a git repository or a folder with a `package.json`. Without it the CLI stops there and points you to `nx init` for an existing repository |
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

Your layout doesn't need to be Nx's default. `init` and `doctor` read the projects from your Nx configuration: a frontend in `web/`, at the workspace root, or one whose `sourceRoot` is the project folder itself all work. With more than one frontend, name them:

```bash
pnpm nx g @clearlydev/nx-archweave:init --preset=team --project=web,admin --strict
```

If the app already follows its own FSD conventions (slice groups like `features/mypage/order`, files imported directly from `shared`, its own boundary tags), describe them in `toolkit.config.json` before you turn on enforcement — see [FSD Lite](fsd-lite.md#policy-how-strictly-the-tree-is-read) and [Boundaries](boundaries.md). `doctor` suggests the `sharedPublicApi` value that fits your imports. For violations that already exist, ESLint's bulk suppressions (`eslint --suppress-all`) keep them out of the way while new ones fail.

> [!IMPORTANT]
> `init` needs a clean git working tree, so a partial run can be undone exactly. When a section aborts, the report lists what the run wrote: a `git restore -- <files>` line for the files it modified, and the files it created, which you delete yourself (`git clean -n` lists them first). Pass `--allowDirty` to skip the clean-tree check. The report then warns you that restoring a modified file also reverts the changes you had made to it before.
