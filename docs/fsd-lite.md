# FSD Lite

English | [한국어](ko-KR/fsd-lite.md)

Your frontend app follows canonical [Feature-Sliced Design](https://feature-sliced.design). This page covers the layers, the `add-fsd-lite` setup, the boundary lint rule, the slice generators and the optional steiger check.

> [!NOTE]
> **"Lite" means a subset, never a variant.** The rules, the folder shape and the public-API convention are the canonical ones. Only the default scope is smaller.

## Canonical FSD vs. FSD Lite

| | Canonical FSD | FSD Lite |
| --- | --- | --- |
| Layers | app, pages, widgets, features, entities, shared | 5 (4 on Next.js, whose own `app/` is the entry point) |
| Slices | segments (`ui/`, `model/`, `api/`, `lib/`, `config/`) | same |
| Public API | one `index.ts` per slice; no layer-level barrels | same |
| Imports | downward only; a slice only through its index | same, as one rule |
| Enforcement | up to the tooling | `error` or `warn`, set by the preset |
| Empty layers | a layer appears with its first slice | same, no placeholder folders |

What the short cells leave out:

- **Layers** — FSD Lite's default scope is five layers, four on Next.js (see Layers below, per framework). You get `widgets` only when you ask for it with the `widget` generator. The lint rule knows all six layers.
- **Slices** — Each slice holds its segments. The `page`/`widget`/`feature`/`entity` generators scaffold `index.ts` + `model/`, and you can add more with `--segments`.
- **Imports** — A slice never imports a sibling slice, except through `@x/<consumer>`. In FSD Lite, one lint rule covers all of the import rules.
- **Enforcement** — The severity is `error` for `team` and `warn` for `solo` and `quick-start`. The severity is the only preset-specific thing.

## Layers

Which layers you get depends on the **framework**, never on the preset:

| Framework | Layers |
| --- | --- |
| `react-vite` | `app`, `pages`, `features`, `entities`, `shared` |
| `next` | `pages` (in `_pages/`), `features`, `entities`, `shared` |
| `expo` | `app` (in `_app/` with expo-router), `pages`, `features`, `entities`, `shared`; `index.ios.tsx`-style platform files count as the index |
| `generic` | `app`, `pages`, `features`, `entities`, `shared` — any framework nx-archweave does not recognise; the report says so |

On Next.js, the pages layer lives in `_pages/`. Next.js owns `app/` and reads `src/pages` as its Pages Router, so FSD's own Next.js guide names the layer `_pages`.

Where the layers live:

- **Folder** — the frontend app's source root (`apps/<app>/src`, or the project's `sourceRoot`).
- **Which app** — the workspace's one frontend application, or the app that `--project` names. E2e projects and the backend `api` aren't candidates.
- **More than one candidate** — the run stops and lists the candidates.
- **React + Vite** — Nx's own `src/app` (where the template puts `app.tsx`) is the app layer.

## Setup: `add-fsd-lite`

> [!NOTE]
> **`add-fsd-lite` creates no folders.** A layer appears when you add its first slice.

`add-fsd-lite` does three things:

1. It picks the app.
2. It wires the `archweave/fsd-boundaries` ESLint rule into the app's `eslint.config.mjs`. The rule ships inside the plugin as `@clearlydev/nx-archweave/eslint`, so you don't need an extra dependency.
3. It prints the layer guide.

Writing `eslint.config.mjs` follows the same contract as `add-backend`:

| Workspace | What happens to `eslint.config.mjs` |
| --- | --- |
| just created by the CLI | written for real (`--applyEslint`) |
| existing | a paste-ready snippet, unless you pass `--applyEslint` |
| a config shape it doesn't recognize | never touched |

Recognised shapes: `export default [...]` (Nx's templates) and an array exported by name — `const eslintConfig = [...]` or `defineConfig([...])`, then `export default eslintConfig` (create-next-app).

The change is two lines:

```js
import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';
export default [...baseConfig, ...fsdBoundaries({ severity: 'error', cwd: import.meta.dirname, root: 'src' })];
```

- `root` is the app's source root, relative to the config file: `src` for Nx's templates, `.` when the app keeps its code at its own root (a `sourceRoot` equal to the project root). `add-fsd-lite` writes the right one.
- `cwd: import.meta.dirname` anchors `root` and the aliases to the config file. Without it they are read from the directory ESLint starts in, so an editor or an `eslint` run from the workspace root would check nothing.

## The boundary rule

The rule reports three kinds of problems:

- an import from a higher layer
- an import of a sibling slice
- a sidestep of a public API: importing another slice's or a shared segment's internal file

Which imports the rule checks:

- **Relative imports** — The rule resolves the path. So `../model/x` inside your own slice is fine, but `../sign-in` from a sibling slice isn't.
- **Aliases** — The rule checks `@/`, which Nx's Next.js template ships. It also checks every `"<prefix>*": ["<dir>/*"]` entry in the app's tsconfig `paths`, including its `extends` chain. Pass `aliases` to replace this whole alias list, or `tsconfig: false` to skip the tsconfig lookup.
- **Package specifiers** — never checked.

Severity:

- `--enforcement=error|warn` overrides `fsd.enforcement` in `toolkit.config.json`. `init` records that value from the preset.

## Policy: how strictly the tree is read

The rule's defaults are canonical FSD (the `basic` preset). Existing apps often use a few common variants; set them under `fsd` in `toolkit.config.json`. The rule reads that file at or above the app's ESLint config, so editing it changes what the rule reports, with no change to `eslint.config.mjs`. Options passed to `fsdBoundaries({...})` win over the file.

```jsonc
"fsd": {
  "preset": "basic",             // basic | practical
  "sliceGroups": "auto",         // "auto" | false | { "auto": true, "include": [], "exclude": [] }
  "sharedPublicApi": "segment",  // segment | component | file
  "testFiles": false,            // false | globs, relative to the source root
  "segments": [],                // extra folder names that are segments, never slices
  "unitTestRunner": "auto"       // auto | jest | vitest | none — for the slice generators
}
```

| Option | `basic` | `practical` |
| --- | --- | --- |
| `sliceGroups` | `auto` | `auto` |
| `sharedPublicApi` | `segment` | `file` |
| `testFiles` | `false` | `**/*.{spec,test}.*`, `**/__tests__/**` |

- **Slice groups** — A folder on a sliced layer that only groups slices (`features/mypage/order`, `features/mypage/claims`). The rule treats it as a group when it has no files of its own (so no `index.ts`), none of its folders is a segment (`ui`, `model`, `api`, `lib`, `config`, plus `segments`), and at least one of its folders has an `index.ts`. Slices in one group never import each other, and the group folder itself is not importable. Force a folder with `include`, rule one out with `exclude` (both as `<layer dir>/<name>`), or turn groups off with `false`. A slice generated by nx-archweave always has an `index.ts`, so it is never mistaken for a group.
- **`sharedPublicApi`** — `segment`: import `shared/ui`, never a file inside it. `component`: each component is its own public API (`shared/ui/button`), as FSD recommends to keep bundles small. `file`: any file inside `shared` may be imported directly; `shared` still may not import a layer above it.
- **`testFiles`** — Test files may import another slice's internals. Upward imports are reported in them too.
- **Caching** — The group check reads the app's folders and notices changes while ESLint keeps running (an editor). `eslint --cache` (lint-staged, some editors) caches per file, so a group that appeared in another folder can show up only after that cache is cleared. `nx lint` is not affected.

## Generators

| Generator | Scaffolds |
| --- | --- |
| `page`, `widget`, `feature`, `entity` | a slice in `<src>/<layer>/<name>/` |
| `shared` | a segment in `<src>/shared/<name>/` |

The files each generator writes:

- **Slice** — `<src>/<layer>/<name>/index.ts`, `model/<name>.ts` and `model/<name>.spec.ts`. You also get an `index.ts` for each extra segment you ask for with `--segments=ui,api`. With `--group=mypage` the slice goes in `<src>/<layer>/mypage/<name>/`.
- **Segment** — `<src>/shared/<name>/index.ts`, `<name>.ts` and `<name>.spec.ts`.

How the generators behave:

- The slice generators create the layer folder on the way if it's missing.
- The name can come first: `nx g @clearlydev/nx-archweave:feature checkout`.
- The `.spec.ts` stub is written only when the app or workspace has jest or vitest (a test target, a runner config, a `test` block in a Vite config, or the dependency). Otherwise the report says it was skipped. `--unitTestRunner=jest|vitest|none` decides instead, and `fsd.unitTestRunner` in `toolkit.config.json` does it for every run.
- On Next.js, `page` lands in `_pages/`. To tell the framework, `page` uses `--frontend`, else the recorded frontend, else what it finds in the app (a `next.config` or Vite config, the targets' executors, the `react` dependency). An app it does not recognise is `generic`: no layer is renamed.
- Name `shared` segments by purpose: `ui`, `api`, `model`, `lib`, `config`. The `shared` generator refuses names that say what a thing is (`components`, `hooks`, `utils`, `types`, …).
- If a slice with the same name already exists, the generator skips it instead of overwriting it.
- The generators check that `--publicApiName` is a usable TypeScript identifier.

## Around it

- Whenever FSD is on, the agent-rules block gets a "Frontend Structure (FSD Lite)" section.
- doctor's `fsd-enforcement-applied` check warns you when no ESLint config imports the boundary rule.

## Optional: steiger

[steiger](https://github.com/feature-sliced/steiger) is the official FSD linter. Because the scaffold is canonical, steiger fits as is. Run `add-fsd-lite --steiger` to opt in. It adds three things:

- the app's `steiger.config.mjs` with the recommended rules. It sets `insignificant-slice` to a warning, because a fresh slice has no references yet. On Next.js, it also turns off the `_pages` typo rule.
- an `fsd-check` target on the app
- the two devDependencies in the root `package.json`. You run the install command it prints.

The steiger check isn't part of `nx lint`, so run it on its own:

```sh
nx run <app>:fsd-check
```

> [!IMPORTANT]
> steiger needs **Node ≥ 22.18**.
