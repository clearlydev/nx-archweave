## 0.2.1 (2026-10-24)

### 🩹 Fixes

- update the review workflow's pinned actions to their Node 24 versions ([#9](https://github.com/clearlydev/nx-archweave/pull/9))

## 0.2.0 (2026-10-24)

### 🚀 Features

- support existing Nx workspaces ([#4](https://github.com/clearlydev/nx-archweave/pull/4))

## 0.1.1 (2026-10-18)

### 🩹 Fixes

- add-integration preview now works offline and behind proxies ([#2](https://github.com/clearlydev/nx-archweave/pull/2))

## 0.1.0 (2026-10-18)

The first public release. Both packages require Node >= 22.18.

### `create-nx-archweave`

- One command from an empty directory to a configured Nx workspace: preset (`quick-start`,
  `solo`, `team`), frontend (`react-vite`, `next`, or none for a backend-only workspace),
  backend (`express`, `nest`, or none), locale (`en`, `ko`), AI hosts, AI PR review and its
  provider, and optional AI host plugins — each asked, or passed as a flag.
- Prints its plan first, then runs the official tools only: a pinned `create-nx-workspace`,
  the plugin install, the official `@nx/express` / `@nx/nest` application generators, and
  `init`. It never commits for you and never deletes a directory it created.
- npm, pnpm (10 and 11), yarn (classic and berry) and bun are all supported. Combinations known
  to fail upstream (npm 10 or yarn 1 with react-vite) are not offered. pnpm 11's skipped build
  scripts and bun's blocked install scripts are reported at the end.
- Windows: `.cmd` shims (npm, pnpm, yarn, an npm-installed `claude`) run through `cmd.exe` with
  every argument escaped.
- Installs the plugin release it was built with (`@clearlydev/nx-archweave@^0.1.0`);
  `--plugin-source` overrides it.

### `@clearlydev/nx-archweave` (16 generators)

- `init` — a preset-driven pipeline over `add-fsd-lite`, `add-agent-rules`,
  `add-github-templates`, `add-review` and `add-backend`. It needs a clean git tree, so one
  `git restore .` undoes it. It records the preset, frontend, backend, locale, package manager
  and AI hosts in `toolkit.config.json`, so a bare rerun uses them.
- **FSD Lite** — a subset of canonical Feature-Sliced Design, never a variant:
  - The `archweave/fsd-boundaries` ESLint rule ships inside the plugin
    (`@clearlydev/nx-archweave/eslint`). It reports upward imports, cross-slice imports (with the
    `@x` exception) and imports that sidestep a slice's public API. It reads import aliases from
    the app's tsconfig `paths`.
  - Presets differ only in severity: `error` on `team`, `warn` on `solo` and `quick-start`.
  - Next.js apps use `_pages`.
  - `add-fsd-lite --steiger` adds the official FSD linter as an opt-in `fsd-check` target.
  - `page`, `widget`, `feature`, `entity` and `shared` scaffold slices and segments inside the
    frontend app. `--segments` adds extra segments.
- `add-backend` — wires an Express or NestJS app in: a `shared-types` library, `scope:` tags
  and enforced module boundaries. A backend-only workspace is supported too.
- `add-agent-rules` — writes nx-archweave's rules as one marked block into the file each AI
  host reads: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex, Cursor and Gemini CLI. Text
  around the block is never touched.
- `add-github-templates` — Issue Forms, a PR template and CODEOWNERS.
- `add-review` — an automated PR review workflow:
  - Four providers: Claude, Gemini, GPT and Cursor.
  - Three modes: `fast`, `standard` and `thorough`.
  - It green-skips until the provider secret exists, and a round limit caps reviews per PR.
  - A verdict gate fails a required check only on `BLOCK`.
- `doctor` — a read-only diagnosis with a `--json` report for CI.
- `add-integration`, `install-integration`, `record-integration` — optional AI host plugins
  from a reviewed catalog. The catalog's first entry is ponytail, for Claude Code.
  - Installs use the host's official CLI only and are verified live before anything is
    recorded.
  - Project scope also declares the plugin's marketplace for teammates.
- `allow-builds` — re-allows a dependency build script that pnpm skipped or denied.
- Every generator previews with `--dryRun`, reports "no change" on an identical rerun, and
  returns refusals as reports, not exceptions.
