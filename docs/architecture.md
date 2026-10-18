# Repository layout

English | [한국어](ko-KR/architecture.md)

nx-archweave is an Nx monorepo of 7 projects: 5 internal (private) packages and 2 publishable packages.

## Projects

| Project | Package | Role | Runtime deps |
| --- | --- | --- | --- |
| `shared` | `@nx-archweave/shared` | Types and constants; dependency leaf | `tslib` |
| `templates` | `@nx-archweave/templates` | Spliced and composed content (see below) | `tslib` |
| `review-policy` | `@nx-archweave/review-policy` | Review schema, modes, prompts, comment renderers | `tslib` |
| `integrations` | `@nx-archweave/integrations` | Integration registry and verification | `shared`, `tslib` |
| `template-engine` | `@nx-archweave/template-engine` | Assembly layer (see below) | `shared`, `templates`, `review-policy`, `tslib` |
| `nx-plugin` | **`@clearlydev/nx-archweave`** | The 16 generators and the ESLint rule (see below) | `@nx/devkit`, `tslib` |
| `create-nx-archweave` | **`create-nx-archweave`** | The `npx` CLI | `tslib` |

- **`templates`** holds content that's spliced into existing files or composed per option: agent-rule sections, ESLint and Steiger config, and shared types.
- **`template-engine`** is the assembly layer: presets, review providers, doctor checks and `ToolkitConfig`.
- **`nx-plugin`** holds the 16 generators and the `archweave/fsd-boundaries` ESLint rule. It's the only project that imports `@nx/devkit`.

> [!NOTE]
> **Whole new files aren't in `templates`.** Whole new files (GitHub templates, slices) come from each generator's own `files/` templates.

## Dependency rules

ESLint's `@nx/enforce-module-boundaries` enforces two architectural rules mechanically, so they don't rely on convention:

```
type:util (shared)       → nothing
type:assets (templates)  → util
type:policy              → util
type:integration         → util
type:engine              → util, policy, assets
type:plugin              → util, integration, engine
type:cli                 → plugin
```

## Thin-adapter invariant

Generators don't contain content literals. Content flows `templates → template-engine → generator`. That keeps the plugin a thin adapter over the engine.
