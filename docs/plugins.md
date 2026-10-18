# Optional plugins (per AI host)

English | [한국어](ko-KR/plugins.md)

nx-archweave can **install, verify and record** a catalog plugin for your AI host. It only uses the host's own official installer, and only when you explicitly ask.

> [!NOTE]
> **Optional, and experimental.** Plugins extend the AI coding tool you use (the *host*). They aren't part of the workspace setup, and nothing on this page runs unless you ask.

- **Catalog** (data, in `@nx-archweave/integrations`) — the reviewed list that plugins come from
- **Adapter** (code) — how a host installs and verifies a plugin. Today, Claude Code is the only host with an adapter.

> [!TIP]
> **Don't use any external tooling?** Skip this page. Nothing here runs unless you invoke it, and no preset ever turns on an integration for you.

The last question `create-nx-archweave` asks offers the catalog plugins for the AI hosts you picked (press Enter to skip). Each plugin you pick there runs the same `install-integration --apply` shown below, at `project` scope.

## The three rules

These three rules define the whole feature. They're also the reason it exists.

### Official install paths only

nx-archweave only runs CLI commands that the host itself documents. It passes the executable and its arguments separately, so no shell is involved:

| Step | Command (Claude Code) |
| --- | --- |
| 1. Declare the marketplace (`project` scope only) | `claude plugin marketplace add <source> --scope project` |
| 2. Install the plugin | `claude plugin install <plugin> --marketplace <source>` |

nx-archweave never:

- vendors a copy of a plugin
- runs an `enable`/`disable` command
- edits a third-party tool's configuration itself. Claude Code's own commands write Claude Code's files.
- confirms a marketplace-declared command for you. A person makes that call.

### Recorded state has to be earned

- A tool goes into the manifest only after a live, authoritative check confirms it's installed *and* enabled.
- After an install, that check runs again from scratch.
- You can't make the manifest claim a verification that didn't happen.

### Preview by default

- The generators on this page only preview unless you pass `--apply`. That flag is your approval. Nx's own `--dry-run` still wins over `--apply`.
- nx-archweave itself writes 2 things at most: one manifest entry, and one `integrations.enabled` declaration in `toolkit.config.json` when the workspace has that file.
- Claude Code records the plugin itself. Which file it writes depends on the scope, and the preview names that file before anything runs:

| Scope | Where Claude Code records the plugin |
| --- | --- |
| `--scope=project` (default) | the workspace's `.claude/settings.json` |
| `--scope=local` | the personal `.claude/settings.local.json` |
| `--scope=user` | every project of this user |

**Committing that file shares which plugin you chose, but not where it comes from.** Claude Code declares a marketplace only in the settings of the user who added it. So at project scope:

- `install-integration` first runs Claude Code's own `claude plugin marketplace add <source> --scope project`.
- The same file then also declares where the plugin comes from (`extraKnownMarketplaces`). Commit that file, and your teammates get both the plugin choice and its source.
- Running `install-integration` again changes nothing. It also backfills the source for a project-scope plugin you installed before.
- `user` / `local` scope stays personal and runs nothing extra.

## The catalog

| Plugin | Host | What it adds |
| --- | --- | --- |
| [ponytail](https://github.com/DietrichGebert/ponytail) | `claude-code` | Over-engineering review rules and skills |

For `ponytail`:

- **Official install path:** `claude plugin install ponytail --marketplace DietrichGebert/ponytail`. This needs Claude Code 2.1.285+. The two chat slash commands remain the manual alternative.
- **Verification signal:** `claude plugin list --json` must show the exact plugin id `ponytail@ponytail`, present **and** enabled.

> [!NOTE]
> **Scope, honestly stated:** one host adapter (Claude Code) and a small reviewed catalog. This is a deliberately narrow, policy-first mechanism, not a general plugin marketplace. The catalog grows one reviewed entry at a time. Other hosts get an adapter once their install and verification paths are established. See [Adding a plugin](#adding-a-plugin).

## The flow

`--tool` takes a catalog id (ponytail here). Step 1 installs nothing and writes nothing. Step 2 runs the official CLI command, verifies again, records and declares.

```bash
# 1. See exactly what the official install involves
pnpm nx g @clearlydev/nx-archweave:add-integration --tool=ponytail

# 2. Install it
pnpm nx g @clearlydev/nx-archweave:install-integration \
  --tool=ponytail --apply

# 2'. Installed it yourself (chat slash commands, another machine)?
#     Verify and record that install instead
pnpm nx g @clearlydev/nx-archweave:record-integration \
  --tool=ponytail --apply
```

### Step 1 — `add-integration`

`add-integration` prints these verbatim:

- the source and license
- the exact install command
- the manual chat alternative
- the uninstall instructions

It also shows the tool's current detection status, so you can tell "not installed yet" from "already there".

> [!NOTE]
> **Not a fully offline preview.** Unless you pass `--versionRange`, `add-integration` resolves the latest version from the npm registry. It also runs the same local, read-only `claude plugin list --json` check as the other two generators.

### Step 2 — `install-integration`

`install-integration` checks the current state live first:

| Current state | What happens |
| --- | --- |
| Already installed and enabled | Records it. Never reinstalls it. |
| Installed but disabled | Gives you the enable command to run yourself |
| Installed at a different scope than your explicit `--scope` | Reports it instead of doubling up |
| Anything else, with `--apply` | Installs, then verifies again (see below) |

In that last case, `install-integration`:

- runs the one official command in the workspace root (`--scope` defaults to `project`)
- verifies again from scratch
- records and declares only what that fresh check confirms

When the `claude` CLI is missing, or too old to install plugins from a script, `install-integration` tells you so. It then shows what to run in your terminal:

```bash
npm install -g @anthropic-ai/claude-code
# or
claude update
```

Only after that does it offer the chat slash commands as an alternative. It never reports a failed install as a success.

### Step 2' — `record-integration`

Use `record-integration` for installs that happened outside nx-archweave.

- It writes exactly one entry to `archweave-integrations.json`, and only when the authoritative CLI signal succeeds.
- It doesn't touch `toolkit.config.json`. Adopting an outside install doesn't tell it whether you want the plugin declared.
- A weaker signal based on `package.json` can show up as evidence, but it's never enough on its own.
- Run it without `--apply` first to see what it would record and why.

> [!IMPORTANT]
> **No false passes.** A disabled plugin, an ambiguous match, a missing `claude` binary or any CLI error all end in **zero writes**, never in a false `verification: passed`.

## What `doctor` reports

`doctor` prints one line per known integration. Each line covers three independent facts:

| Fact | Where |
| --- | --- |
| **declared** | in `toolkit.config.json` |
| **recorded** | in `archweave-integrations.json` |
| **detected** | in the workspace |

When those three facts disagree, that's the signal worth looking at. A tool that's declared but not recorded means its install was never completed or verified.

| Mode | Behavior |
| --- | --- |
| Default | Trusts the recorded manifest |
| `--liveIntegrations` | Re-verifies live instead |

- The default is fast. It also works on machines where the external tool's CLI isn't installed at all.
- `--liveIntegrations` makes sure a stale recorded "passed" can't hide a plugin that was later disabled or removed.

Either way, `doctor` writes nothing.

## Adding a plugin

The catalog lives in the internal `@nx-archweave/integrations` package (`src/catalog/plugin-catalog.ts`). So adding a plugin means changing this repository, not your local configuration.

### For a host that already has an adapter (Claude Code)

A plugin is **one catalog entry** with:

- id, description, homepage, repository, license
- official install docs and uninstall steps
- its distribution for that host. For Claude Code, that's the plugin name, the marketplace source and the `<name>@<marketplace>` id that `claude plugin list` reports.

A test keeps the generators' `--tool` enum equal to the catalog.

### For a new host

A new host needs an adapter first. That adapter needs all three of these:

- an **official, documented install path**. An unofficial script is out of scope by policy.
- an **authoritative verification signal**: a read-only command that tells *installed and enabled* from *installed but disabled* from *absent*
- **tests covering the failure modes** (disabled, ambiguous match, CLI missing, CLI error). Each failure mode must end as "not verified", never as a write.

If a plugin you want doesn't meet these requirements, open an issue describing it anyway. That gap is useful information. It's also a better outcome than a generator that pretends to verify something it can't.
