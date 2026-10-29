# Contributing

Thanks for helping. Bug reports and feature requests go through the [issue forms](https://github.com/clearlydev/nx-archweave/issues/new/choose). Security issues don't: see [SECURITY.md](SECURITY.md) for those.

## How to contribute

- **Small changes** go straight to a pull request. That covers a typo, a docs fix or a clear bug fix.
- **New behavior** starts as a feature request issue. That covers a generator, an option, a preset change, another AI host or another review provider. In the issue, say what you want and how you'd build it. Wait for a reply before you write the code, because the change may already be planned differently. The [ideas below](#ideas-wed-welcome) are welcome too. If you'd like to take one, say so in the issue.

Then:

1. Fork the repository and branch from `main` (`fix/…`, `feat/…`).
2. Make the change with its tests and run the gate (see [Setup](#setup)).
3. Open a pull request against `main`, fill in the template, and link the issue (`Closes #…`).

### Pull request titles

Pull requests are squash-merged, so your title becomes the one commit on `main`. The release tooling then derives the next version and the changelog from that commit. Write the title as a Conventional Commit, `<type>(<optional scope>): <summary>`. For example:

- `fix(cli): keep yarn berry on Windows`
- `feat(plugin): add a --json summary to doctor`

| Type | For | In the changelog |
| --- | --- | --- |
| `feat` | something users can do that they couldn't before | yes |
| `fix` | a bug fix | yes |
| `perf` | a speedup | yes |
| `docs`, `refactor`, `test`, `ci`, `build`, `chore`, `revert` | everything else | no |

A change that breaks or changes workspaces an earlier version set up ships with a migration (see below) and a `feat` title, so it bumps the minor number. Don't mark a title with `!` or a `BREAKING CHANGE` footer: while the version is 0.x, that would release 1.0.0.

The scope is optional (`cli`, `plugin`, `docs` …). A check validates the title on every pull request. If the check fails, edit the title and the check runs again. The commit messages inside your branch can be anything you like.

## Ideas we'd welcome

- **doctor:** more checks:
  - Nx plugins that register the same targets
  - cycles in the project graph
  - `depConstraints` that drifted from the tags projects carry
  - the review workflow's secret
- **AI review:** count a finding toward the verdict only when the finding is inside the pull request's diff. Also, carry the findings from earlier rounds into the next review prompt.
- **Backend:** an opt-in folder-structure guide for the generated API, like FSD Lite for frontends.
- **AI hosts:** plugin adapters beyond Claude Code (Codex first). Also, an option to make the review a required check for paths that a `CODEOWNERS` entry owns.

## Setup

You need Node >= 22.18 and pnpm. Use the pnpm version pinned in `package.json`'s `packageManager`, via Corepack.

```bash
pnpm install

# Everything a pull request runs first
pnpm nx run-many -t build,test,lint,typecheck,bundle

# One project
pnpm nx test template-engine
```

Run tasks through `nx`, not the underlying tools, so caching and task dependencies apply.

## Repository layout

| Directory | Package | Role |
| --- | --- | --- |
| `packages/nx-plugin` | `@clearlydev/nx-archweave` (published) | Generators and the ESLint rule |
| `packages/create-nx-archweave` | `create-nx-archweave` (published) | The create CLI |
| `packages/template-engine` | internal | Generated files and doctor checks |
| `packages/templates` | internal | Spliced and per-option text |
| `packages/review-policy` | internal | Review prompts, findings and the verdict gate |
| `packages/integrations` | internal | AI host adapters and the plugin catalog |
| `packages/shared` | internal | Shared types and helpers |
| `tools/` | — | Build, pack and test scripts |

What a few of those rows mean in full:

- `packages/nx-plugin` holds the generators and the `archweave/fsd-boundaries` ESLint rule.
- `packages/template-engine` composes generated files and runs the doctor checks.
- `packages/templates` holds text that's spliced into existing files or composed per option: agent rules, ESLint, Steiger and shared types.
- `packages/shared` holds the types and helpers that all of the packages above share.
- `tools/` holds the scripts for bundling, packing, the tarball smoke test and the end-to-end script.

The internal packages are bundled into the two published packages. Nothing named `@nx-archweave/*` is ever published.

## Making a change

- New behavior comes with tests for its refusal and conflict paths, not only the happy path.
- When a generator creates a whole file, that file is a template in the generator's `files/` directory. Nx's `generateFiles` renders it: `__name__` in paths, EJS in contents, a `.template` suffix.
- Text that's spliced into existing files or composed per option lives in `packages/templates`. Generators never inline content.
- Generators preview with `--dryRun` and write nothing until you ask. Integrations act only with `--apply`. When a precondition fails, the generator reports it instead of throwing.
- `CHANGELOG.md` and the package versions are written at release time from the pull request titles. Don't edit them in a pull request.

### Changes that affect existing workspaces

Sometimes upgrading the plugin would break or silently change a workspace that the plugin already set up. For example, the shape of a file a generator wrote changes, or `toolkit.config.json` gains, renames or drops a key. In that case, ship an Nx migration with the change, so `nx migrate @clearlydev/nx-archweave@latest` converts the workspace:

1. Add an entry to `packages/nx-plugin/migrations.json`, with `version` set to the release that brings the change. The first time, create `migrations.json`. Also add `"nx-migrations": { "migrations": "./migrations.json" }` to the plugin's `package.json`, and add the file to its `files`.
2. Write the migration as a generator under `src/migrations/update-<version>/<name>.ts`. The bundle step picks it up. Point the entry at it as `./dist/migrations/update-<version>/<name>`. The migration reads the old shape, writes the new one, and leaves an already converted workspace untouched.
3. Test the migration on a tree in the old shape and on a tree that's already converted. The `@nx/nx-plugin-checks` lint rule checks that the entry points at a real file.

Anything else needs no migration. That includes a fix, or a new option whose default keeps today's output.

### Trying a change end to end

The end-to-end script packs both packages and runs the real create flow from the tarballs, the way a user would:

```bash
# react-vite + express
node tools/e2e-create.mjs --pm=pnpm

node tools/e2e-create.mjs --pm=npm --frontend=next --backend=nest
```

A second script covers a workspace nx-archweave did not create. Nx's own Expo preset makes the workspace, then the packed plugin is added and `init` detects the framework:

```bash
node tools/e2e-existing.mjs --frontend=expo
```

Both scripts print how long each step took when they finish (and the steps that passed when one fails). In CI the same table lands in the job summary, so a slow leg shows where its time goes. The create step is broken down further: with `CREATE_NX_ARCHWEAVE_TIMINGS=1` set, as `e2e-create.mjs` sets it, the CLI prints how long each of its own steps took.

Run the scripts from a plain terminal. `create-nx-workspace` builds a different workspace when it finds an AI coding agent's environment variables.

To try a build by hand:

```bash
cd packages/nx-plugin && npm pack --pack-destination /tmp && cd -
npx create-nx-archweave demo --preset=quick-start --frontend=react-vite \
  --plugin-source=/tmp/clearlydev-nx-archweave-*.tgz
```

## CI

Every pull request runs:

- build/test/lint/typecheck/bundle on Node 22 and 24
- the packed-tarball smoke test
- `npm publish --dry-run`
- the real create-flow E2E across npm, pnpm, yarn (berry and classic), bun, Windows and next × nest
- the existing-workspace E2E on an Expo workspace made by Nx

A failure caused by our code blocks the pull request. A change upstream (Nx's templates, the registry) shows up as a warning instead. A nightly run repeats the matrix strictly. A change that touches only documentation starts no CI.

## Releases

A maintainer releases both packages together, with the same version:

1. On an up-to-date `main`, preview with `pnpm release --dry-run`, then run `pnpm release`. Nx Release then:
   - reads the commits since the last `v*` tag
   - bumps both `package.json` files: a `feat` bumps the minor number, anything else in the changelog the patch number
   - writes the changelog section
   - commits `chore(release): v<version>` and tags that commit

   To pick the version yourself, pass it: `pnpm release 0.4.0`.
2. Run `git push --follow-tags`.
3. The Release workflow then:
   - checks the tag against both package versions and the changelog section
   - runs the gate and the tarball smoke test
   - stages the plugin and the CLI on npm, with provenance (a version that's already on npm is skipped)
   - creates the GitHub release from the changelog section

   Staged versions go public only after the maintainer approves them.

How the packages are built:

- **`tools/bundle.mjs`** uses esbuild to bundle every entry point into `dist/`, inlining the internal packages. Code the entries share goes into chunks in `dist/generators/_chunks/` (the CLI: `dist/_chunks/`), so each module ships once. Third-party code is never inlined: `@nx/devkit`, `jsonc-parser` and node builtins stay external.
- **`tools/pack-sanitize.mjs`** is a `prepack`/`postpack` pair. It strips `workspace:` ranges from the packed manifest and restores `package.json` right after. `prepack` also runs the bundle, so a stale `dist/` can never be packed.
- **`tools/verify-tarball.mjs`** packs both packages and checks each packed manifest against `tools/tarball-policy.json`: no install scripts, no `workspace:` range, no `bundleDependencies`, and no runtime dependency the policy doesn't list. A pull request that adds a runtime dependency adds it to the policy too. It then installs the packed plugin into a throwaway project and imports every generator from it.

> **Troubleshooting.** Sometimes `create-nx-workspace` fails with `ERR_PNPM_NO_MATCHING_VERSION` for a package whose version clearly exists. That means the local pnpm metadata cache is stale. Run `pnpm cache delete` and retry.
