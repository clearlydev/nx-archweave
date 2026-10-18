# create-nx-archweave

One command takes you from an empty directory to a configured Nx workspace with:

- FSD Lite structure
- AI agent rules
- GitHub templates
- optional AI PR review (Claude, Gemini, GPT, Cursor)

```bash
# npm
npx create-nx-archweave my-app

# pnpm
pnpm dlx create-nx-archweave my-app

# yarn berry (yarn 1 has no dlx: use npx … --package-manager=yarn)
yarn dlx create-nx-archweave my-app

# bun
bunx create-nx-archweave my-app
```

Anything you don't pass as a flag, the CLI asks you interactively. The `quick-start` preset deliberately keeps the questions to a minimum.

## Requirements

- Node >= 22.18
- npm, pnpm >= 10, yarn (classic or berry) or bun
- network access to github.com (Nx's react template is downloaded from there)

**react-vite and older package managers.** You can't create react-vite with npm 10 or yarn 1. Both of those fail inside `create-nx-workspace`'s own install of Nx's react template. So the CLI never offers npm 10 or yarn 1 for react-vite. If a flag names one of them, the CLI stops before creating anything.

## Choosing a package manager

The CLI asks for the package manager too:

- It only offers package managers that are installed and can create the workspace.
- It preselects the one that launched the CLI: `npx` → npm, `pnpm dlx` → pnpm, `yarn dlx` → yarn, `bunx` → bun.
- Without a terminal, it uses the launching package manager, else npm.

A few things to know for specific package managers:

- **Yarn 4** holds back versions younger than a day (`npmMinimalAgeGate`). So in a yarn workspace, a new release resolves only after 24 hours. Wait, or set `YARN_NPM_MINIMAL_AGE_GATE=0` for that one run.
- **pnpm 11** records the dependency build scripts it skipped as not allowed, at the end. To allow one, run `pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=<package> --apply` inside the workspace. That command sets `<package>: true` under `allowBuilds` and runs `pnpm rebuild <package>`.
- **bun:** the last step prints the install scripts bun blocked (`bun pm untrusted`). Those scripts stay blocked. To allow one, run `bun pm trust <package>` inside the workspace.

## What it runs

The CLI prints its plan up front. Then it runs three steps with the package manager you chose.

- It never re-implements `create-nx-workspace`.
- It never commits for you.
- `--preset=next` replaces the template for `--frontend=next`.
- pnpm adds a fourth step that records the build scripts pnpm skipped. bun adds one that lists the install scripts bun blocked (`bun pm untrusted`).

Here are the three steps for npm and pnpm.

**Step 1: create the workspace**

```bash
# npm
npx -y create-nx-workspace@23.3.0 <name> \
  --template=nrwl/react-template \
  --pm=npm --nxCloud=skip --interactive=false

# pnpm
pnpm dlx create-nx-workspace@23.3.0 <name> \
  --template=nrwl/react-template \
  --pm=pnpm --nxCloud=skip --interactive=false
```

**Step 2: install the plugin**

```bash
# npm
npm install -D @clearlydev/nx-archweave@^<cli-version>

# pnpm
pnpm add -D -w @clearlydev/nx-archweave@^<cli-version>
```

**Step 3: run `init`**

```bash
# npm
npm exec nx -- g @clearlydev/nx-archweave:init \
  --preset=… --frontend=… --backend=… --locale=… --allowDirty=true

# pnpm (same flags)
pnpm nx g @clearlydev/nx-archweave:init …
```

With `--backend=express|nest`, the CLI inserts two official steps before init:

1. `@nx/<backend>`, pinned to the workspace's exact nx version
2. `nx g @nx/<backend>:application apps/api --frontendProject=<detected app>`

init then wires `shared-types` and `scope:` tags, and writes the boundary constraints (`--applyEslint=true` on this path).

When something goes wrong:

- If a step fails, the CLI stops right away. It leaves the created directory in place (it never auto-deletes) and tells you how to recover.
- When stdin isn't a TTY and a required input is missing, the CLI fails fast instead of hanging.

## Options

| Flag | Values |
| --- | --- |
| `<name>` | positional: the workspace directory name |
| `--preset` | `quick-start` \| `solo` \| `team` |
| `--frontend` | `react-vite` \| `next` \| `none` |
| `--backend` | `express` \| `nest` \| `none` |
| `--locale` | `ko` \| `en` |
| `--review` / `--no-review` | — |
| `--review-provider` | `claude` \| `gemini` \| `gpt` \| `cursor` |
| `--plugin-source` | package spec, path, or tarball |
| `--ai-hosts` | `claude-code`, `codex`, `cursor`, `gemini-cli` |
| `--plugins` | catalog ids (`ponytail`), or `none` |
| `--package-manager` | `npm` \| `pnpm` \| `yarn` \| `bun` |
| `-h`, `--help` / `-v`, `--version` | — |

### `--preset`

Asked if omitted.

### `--frontend`

- Asked if omitted.
- `none` means a backend-only workspace. It needs `--backend`.

### `--backend`

- Asked if omitted.
- Adds `apps/api`, `shared-types` and enforced boundaries.

### `--locale`

- Sets the language of generated content.
- Asked if omitted. `quick-start` defaults to `en` without asking.

### `--review` / `--no-review`

If you pass neither flag:

- `quick-start` asks y/N. Without a terminal, it fails and asks you for the flag.
- `solo` / `team` turn review on.

### `--review-provider`

- Asked when review is on. Enter picks the first AI tool's provider (e.g. Codex → GPT).
- Without a terminal, the CLI uses that default.
- Refused when review ends up off.

### `--plugin-source`

- Overrides what step 2 installs. The default is the plugin release this CLI matches, `^<CLI version>`.
- Use it to pin a version or to point at a local build.

### `--ai-hosts`

- A comma-separated list.
- Asked if omitted. You pick by number, and Enter picks Claude Code. Without a terminal, the CLI uses Claude Code.
- Decides the agent-rules files, Nx's `--aiAgents` and the default review provider.

### `--plugins`

- Comma-separated catalog ids (`ponytail`), or `none`.
- Asked if omitted, for each picked host whose CLI is installed. You pick by number, and Enter picks none. Without a terminal, the CLI uses none.
- Each plugin becomes a last, optional `install-integration --scope=project --apply` step. If that step fails, the workspace is still complete, and the report gives you the retry command.

### `--package-manager`

- Asked if omitted. The CLI offers the installed package managers that can create the workspace, with the launcher preselected.
- Without a terminal, the CLI uses the launcher, else npm.

## After it finishes

The printed next steps cover the first commit. If review is enabled, they also cover registering the provider secret named in the init report.

- See [`@clearlydev/nx-archweave`](https://www.npmjs.com/package/@clearlydev/nx-archweave) for the generators the created workspace now has.
- See the [repository](https://github.com/clearlydev/nx-archweave) for full documentation.

## Contributing

- `nx build create-nx-archweave` runs tsc, for local dev and typecheck.
- `nx test` runs Jest.
- `nx bundle` (depends on `build`) uses esbuild to bundle `src/index.ts` and `src/bin.ts` into `dist/`. The `bin.js` shebang is preserved, and only `tslib` stays external.
- The CLI has no runtime import of the plugin. It only names the plugin as an install spec.

## License

MIT
