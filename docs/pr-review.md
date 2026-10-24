# Automated PR review

English | [한국어](ko-KR/pr-review.md)

Automated PR review is fully optional, isn't tied to one provider, and is designed to fail safe. This page covers the providers, the three gates every review passes, the review modes and how findings become a verdict.

## Providers

| Provider | Workflow file | Required secret |
| --- | --- | --- |
| `claude` (default) | `.github/workflows/claude-code-review.yml` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `gemini` | `.github/workflows/gemini-code-review.yml` | `GEMINI_API_KEY` |
| `gpt` | `.github/workflows/gpt-code-review.yml` | `OPENAI_API_KEY` |
| `cursor` | `.github/workflows/cursor-code-review.yml` | `CURSOR_API_KEY` |

All four providers follow the same contract (`id`, `workflowFileName`, `requiredSecretName`, `buildWorkflowYaml`) and share one workflow skeleton, so the gates below work the same whichever one you pick.

## Gates

| Gate | What it does | Outcome |
| --- | --- | --- |
| **Secret gate** | checks that the provider's secret is registered | missing → **green-skips** |
| **Round gate** | counts review markers on the PR | stops once `maxRounds` is reached |
| **Verdict gate** | parses the findings and computes a verdict | **fails the check on BLOCK** |

### Secret gate

- If the provider's secret isn't registered, the job prints `AI review is not active: register the <SECRET> secret to enable it.` and **green-skips**.
- So a workspace without AI access never sees a red X.

> [!WARNING]
> **Claude-only edge case.** The `claude` provider exchanges its secret for a GitHub App token. So if a repository has the secret but **not** the [Claude GitHub App](https://github.com/apps/claude), the job fails with `401 — Claude Code is not installed on this repository` instead of green-skipping. To fix it, install the app on the repository. The other three providers have no app-exchange step.

### Round gate

- Each review the workflow posts carries an invisible marker (`<!-- archweave-review-round -->`).
- The workflow counts the markers on the PR and stops once it reaches `maxRounds`. That way, review can't loop forever on an active PR.
- Only markers in comments written by a bot account count. Anyone who can comment on the PR could otherwise post the marker until `maxRounds` is reached and switch review off.
- `maxRounds` accepts `1`–`5` and defaults to `3`.

### Workflow hardening

- The workflow has three jobs, and each gets only the access it needs:
  - `ai-review` holds the provider secret and runs the AI review. It installs nothing. Only the `claude` provider's job can request an OIDC token (`id-token: write`), because the Claude GitHub App signs in with one. `gemini`, `gpt` and `cursor` use an API key and get none.
  - `review` is the check you make required. It installs the workspace's dependencies and runs the verdict bin with a read-only token (`contents: read`, `pull-requests: read`), no secret and no OIDC token. It fails unless `ai-review` succeeded and its results reached the `review` job, and on a BLOCK.
  - `review-comment` posts the verdict comment with `pull-requests: write`. It checks out nothing and installs nothing, and reads the verdict through environment variables, never inline in its script.
- The `review` job installs with install scripts off: `npm ci --ignore-scripts`, `pnpm install --frozen-lockfile --ignore-scripts`, `yarn install --frozen-lockfile --ignore-scripts` (yarn 1), `YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build` (yarn 2 and later), `bun install --frozen-lockfile --ignore-scripts`. The verdict bin is plain JavaScript and needs no build step.
- Every action is pinned to a commit SHA, with its version in a trailing comment (`actions/checkout@<sha> # v7.0.1`). A version tag can be moved to other code; a commit can't, and the workflow holds your provider secret. `add-review` writes `.github/dependabot.yml` with a `github-actions` entry when the file is missing, and shows the entry to add when the file exists without one, so the pins move forward through pull requests you review.
- Every checkout step sets `persist-credentials: false`, so the repository token is not left in `.git/config` for later steps, including the AI agent's shell.
- pnpm workspaces: the workflow reads `packageManager` from `package.json` on the runner. With the field, `pnpm/action-setup` uses it; without it, the workflow passes pnpm 10.
- The `cursor` provider installs `cursor-agent` with `curl --proto '=https' --tlsv1.2 -fsS https://cursor.com/install | bash`. Cursor publishes no pinned version or checksum for it. See [Security scope](#security-scope) for what that leaves open.

### Security scope

These protections limit what code from a pull request can reach. They don't protect the workflow from people who can change it. GitHub passes no secrets to a workflow run for a pull request from a fork and gives it a read-only token, so a fork's pull request is never reviewed: the secret gate green-skips it. Anyone with push access to the repository can edit the workflow file in a branch and run whatever they like with the provider secret, so give write access only to people you would trust with that secret.

The `cursor` provider is the exception to pinning. Each run installs whatever version Cursor publishes at that moment. The install step itself holds no secret, but the binary it installs runs in the next step with `CURSOR_API_KEY` and a `GH_TOKEN` that can write pull request comments. A tampered download would get both. If that risk is too high for your repository, pick another provider.

### Verdict gate

1. The model appends a machine-readable `archweave/findings@1` JSON block to its summary comment.
2. The `review` job parses that JSON block with the plugin's `archweave-review-verdict` bin and computes the verdict. Any P0/P1 finding → `BLOCK`.
3. The `review-comment` job keeps one short verdict comment per PR. It edits that comment every round, with the fixed/remaining history of each round and the commit it judged.
4. The `review` job **fails the check on BLOCK**. So you can make `review` a required check, and P0/P1 findings then actually block the merge. It also fails when the AI review didn't succeed, and ends green when the secret gate or the round gate switched the review off.

The verdict only counts a summary posted by the same run. If a run's review posts no summary, the step never judges an earlier commit's round again.

> [!NOTE]
> Review runs on a PR queue up and run one at a time. If you push while another run is waiting, the new run replaces the waiting one. So an intermediate commit can go unreviewed.

Everything else degrades to green:

| Situation | Result |
| --- | --- |
| an unreadable findings block | a "please review manually" notice is posted |
| a run without a summary | a "please review manually" notice is posted |
| a workspace that removed the plugin | the step is skipped |
| the verdict comment can't be posted | only logs |

Besides a parsed blocking finding, the `review` check goes red in three cases, each time because it can't tell a BLOCK from a clean verdict and won't pass a BLOCK as green:

- The AI review didn't succeed (it failed, was cancelled or was skipped).
- The AI review job's results didn't reach the `review` job, for example on a re-run. Re-run all jobs (the AI review runs, and costs, again).
- The `review` job can't read the pull request comments. Re-run the failed jobs to retry. If it fails again, check that the `review` job has `pull-requests: read`.

> [!NOTE]
> The `review` job's install step can go red if the workspace is genuinely broken, for example when a lockfile is out of sync. That red X shows a defect in the workspace. It isn't a verdict.

## Modes and findings

### Review modes

| Mode | Prompt shape | Priorities |
| --- | --- | --- |
| `fast` | one condensed prompt | P0–P2 (no Nit) |
| `standard` | explicit Correctness / Security sections | P0–P2 + Nit |
| `thorough` | standard + an over-engineering pass | standard + P3 |

What each prompt does:

- **`fast`** — covers critical problems only and skips minor remarks.
- **`standard`** — puts Correctness and Security in explicit top-level sections.
- **`thorough`** — appends an over-engineering pass to the standard prompt, in the same single call. P3 findings are posted as their own section.

How the modes run:

- All three modes run as ONE provider call. If the over-engineering pass ran as a second call, it would post a second comment outside the round marker and the findings block. The verdict pipeline would then never see P3.
- The three modes emit genuinely different workflows.

### Verdict policy

Review prompts tell the provider to prioritize findings as `P0`, `P1`, `P2`, `P3`, `Nit`. The bundled review policy maps those priorities to a verdict. It's a fixed algorithm, never configured per preset:

| Findings present | Verdict |
| --- | --- |
| any `P0` or `P1` | `BLOCK` |
| any `P2` | `CHANGES_RECOMMENDED` |
| only `P3` / `Nit` | `APPROVE_WITH_NOTES` |
| none | `APPROVE` |
