# nx-archweave

[![npm: @clearlydev/nx-archweave](https://img.shields.io/npm/v/@clearlydev/nx-archweave?label=%40clearlydev%2Fnx-archweave)](https://www.npmjs.com/package/@clearlydev/nx-archweave) [![npm: create-nx-archweave](https://img.shields.io/npm/v/create-nx-archweave?label=create-nx-archweave)](https://www.npmjs.com/package/create-nx-archweave) [![CI](https://github.com/clearlydev/nx-archweave/actions/workflows/ci.yml/badge.svg)](https://github.com/clearlydev/nx-archweave/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [한국어](README.ko-KR.md)

> Nx, made approachable for JavaScript full-stack developers.

**nx-archweave** is an Nx plugin plus a `create-*` CLI. Together they set up the parts of an Nx workspace that most teams end up building by hand.

## What you get

- **Feature-Sliced Design (Lite) lint rule** that knows the FSD layers and checks imports between them in your frontend app (`warn` on solo and quick-start, `error` on team), plus generators that add slices as you need them
- **Frontend/backend boundaries** when you pick a backend: imports between the frontend and backend projects nx-archweave tags become lint errors
- **AI agent rule files** for the AI coding tools you use
- **GitHub issue and PR templates**
- **Automated PR review** with the AI provider you choose: Claude is supported, Gemini, GPT and Cursor are in beta (fully optional)

## Quick start

```bash
# New workspace, configured end to end (npm)
npx create-nx-archweave my-app

# The same with pnpm
pnpm dlx create-nx-archweave my-app

# Or add the plugin to an existing workspace (pnpm: add -D -w)
npm install -D @clearlydev/nx-archweave
```

| Package | What it is |
| --- | --- |
| [`@clearlydev/nx-archweave`](https://www.npmjs.com/package/@clearlydev/nx-archweave) | The Nx plugin, with 16 generators |
| [`create-nx-archweave`](https://www.npmjs.com/package/create-nx-archweave) | The CLI: one command from nothing to a configured workspace |

**Requirements:** Node >= 22.18, plus one of npm, pnpm >= 10, yarn (classic or berry) or bun.

> [!NOTE]
> The tools always print their reports in English. The `--locale` option sets the language of *generated content* (agent rules, templates, review prompts). It doesn't change the CLI output.

## Why

Nx is powerful. Still, when you start a new full-stack JS project, you have to make a long list of decisions before you write a line of product code:

- how to lay out folders
- how to stop layers from importing each other backwards
- what to put in `CLAUDE.md`
- which GitHub templates to add
- whether to wire up AI code review at all

nx-archweave answers those five questions with opinionated, **preset-driven** generators. You can still run, preview and skip each piece on its own. Two invariants shape the whole design:

1. **AI review is optional, end to end.** If you turn review off, the generated workspace contains zero review artifacts, and the library still works fully without any AI provider. If you turn review on, the generated workflow green-skips (it never fails) until you register the provider secret.
2. **Generators never surprise you.** Every generator shows you what it would do before it writes anything. The workspace generators preview with `--dryRun`. The two integration generators act outside your workspace, so they only preview until you pass `--apply`. Running a generator twice changes nothing. If a precondition isn't met, the generator tells you why instead of throwing.

## Documentation

- **[Getting started](docs/getting-started.md)** — installing, the create CLI's questions and flags, adding the plugin to an existing workspace
- **[Generators and presets](docs/generators.md)** — all 16 generators and what each preset turns on
- **[Automated PR review](docs/pr-review.md)** — providers, gates, modes and findings
- **[FSD Lite](docs/fsd-lite.md)** — the layer rules, the `archweave/fsd-boundaries` ESLint rule, Steiger
- **[Enforced boundaries](docs/boundaries.md)** — frontend/backend/shared scope rules for full-stack workspaces
- **[Optional plugins](docs/plugins.md)** — the per-host plugin catalog, installing and verifying a plugin
- **[Behavioral contracts](docs/behavioral-contracts.md)** — what every generator promises: previews, idempotence, refusals
- **[Repository layout](docs/architecture.md)** — how the packages fit together

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the end-to-end script, CI and the release process. To report a security issue, follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
