# FSD Lite

English | [한국어](ko-KR/fsd-lite.md)

Your frontend app follows canonical [Feature-Sliced Design](https://feature-sliced.design). This page covers the layers, the `add-fsd-lite` setup, the boundary lint rule, the slice generators and the optional steiger check.

> [!NOTE]
> **"Lite" means a subset, never a variant.** The rules, the folder shape and the public-API convention are the canonical ones. Only the default scope is smaller.

## Canonical FSD vs. FSD Lite

| | Canonical FSD | FSD Lite |
| --- | --- | --- |
| Layers | app, pages, widgets, features, entities, shared | 5 on React + Vite, 4 on Next.js |
| Slices | segments (`ui/`, `model/`, `api/`, `lib/`, `config/`) | same |
| Public API | one `index.ts` per slice; no layer-level barrels | same |
| Imports | downward only; a slice only through its index | same, as one rule |
| Enforcement | up to the tooling | `error` or `warn`, set by the preset |
| Empty layers | a layer appears with its first slice | same, no placeholder folders |

What the short cells leave out:

- **Layers** — FSD Lite's default scope is five layers on React + Vite and four on Next.js (see Layers below). You get `widgets` only when you ask for it with the `widget` generator. The lint rule knows all six layers.
- **Slices** — Each slice holds its segments. The `page`/`widget`/`feature`/`entity` generators scaffold `index.ts` + `model/`, and you can add more with `--segments`.
- **Imports** — A slice never imports a sibling slice, except through `@x/<consumer>`. In FSD Lite, one lint rule covers all of the import rules.
- **Enforcement** — The severity is `error` for `team` and `warn` for `solo` and `quick-start`. The severity is the only preset-specific thing.

## Layers

Which layers you get depends on the **framework**, never on the preset:

| Framework | Layers |
| --- | --- |
| `react-vite` | `app`, `pages`, `features`, `entities`, `shared` |
| `next` | `pages` (in `_pages/`), `features`, `entities`, `shared` |

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

The change is two lines:

```js
import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';
export default [...baseConfig, ...fsdBoundaries({ severity: 'error' })];
```

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

## Generators

| Generator | Scaffolds |
| --- | --- |
| `page`, `widget`, `feature`, `entity` | a slice in `<src>/<layer>/<name>/` |
| `shared` | a segment in `<src>/shared/<name>/` |

The files each generator writes:

- **Slice** — `<src>/<layer>/<name>/index.ts`, `model/<name>.ts` and `model/<name>.spec.ts`. You also get an `index.ts` for each extra segment you ask for with `--segments=ui,api`.
- **Segment** — `<src>/shared/<name>/index.ts`, `<name>.ts` and `<name>.spec.ts`.

How the generators behave:

- The slice generators create the layer folder on the way if it's missing.
- On Next.js, `page` lands in `_pages/`. To tell whether the app is Next.js, `page` uses the recorded frontend, else a `next.config` file in the app, else `--frontend`.
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
