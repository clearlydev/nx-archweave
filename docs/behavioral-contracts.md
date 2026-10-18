# Behavioral contracts

English | [한국어](ko-KR/behavioral-contracts.md)

All 16 generators follow these contracts, and tests cover them.

## Writing

- **`--dryRun` previews everything and writes nothing.** That includes `init`. In dry-run mode, init's post-run validation callback never fires either.
- **Running a generator again changes nothing.** If the existing content is identical, the generator reports "no change" instead of rewriting it.
- **Each generator is atomic.** A generator either applies its whole intended change set or reports an abort. If a sub-generator throws unexpectedly, `init` folds that error into an aborted section, so the rest of the pipeline still reports.

## Refusals are reports, not exceptions

In each of these 4 cases, the generator tells you why in a structured refusal report instead of throwing:

- a dirty tree
- no frontend app, or more than one
- a segment named by essence (`components`, `hooks`)
- an unusable public API name

## Conflicts are never silently overwritten

The default policy is `merge-proposal`. Here's how 3 generators handle a conflict:

| Generator | On conflict |
| --- | --- |
| `add-agent-rules` | Writes only its own marked block (see below) |
| `add-github-templates` | Always skips |
| `add-review` | Follows the explicit `--onConflict` you pass |

- `add-agent-rules` writes only its own marked block inside `CLAUDE.md` / `AGENTS.md`. It never writes the text around that block. If it can't place the markers safely, it tells you instead of guessing.
- `add-review` takes `--onConflict` with one of 3 values: `overwrite` / `skip` / `alternate-filename`.

## Output and validation

- **English reports, localized content.** CLI and report output is always in English. `--locale` only affects the generated files.
- **Best-effort validation, clearly labeled.** After a real `init` run, init calls `actionlint` and `nx graph` with preflight checks.

> [!NOTE]
> **A missing tool isn't a failure.** If `actionlint` or `nx graph` isn't available, the report says *skipped with install guidance*, never failure.
