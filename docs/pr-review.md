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
- `maxRounds` accepts `1`–`5` and defaults to `3`.

### Verdict gate

1. The model appends a machine-readable `archweave/findings@1` JSON block to its summary comment.
2. A final workflow step parses that JSON block with the plugin's `archweave-review-verdict` bin and computes the verdict. Any P0/P1 finding → `BLOCK`.
3. The verdict step keeps one short verdict comment per PR. It edits that comment every round, with the fixed/remaining history of each round and the commit it judged.
4. The verdict step **fails the check on BLOCK**. So you can make it a required check, and P0/P1 findings then actually block the merge.

The verdict step only counts a summary posted by the same run. If a run's review posts no summary, the step never judges an earlier commit's round again.

> [!NOTE]
> Review runs on a PR queue up and run one at a time. If you push while another run is waiting, the new run replaces the waiting one. So an intermediate commit can go unreviewed.

Everything else degrades to green:

| Situation | Result |
| --- | --- |
| an unreadable findings block | a "please review manually" notice is posted |
| a run without a summary | a "please review manually" notice is posted |
| a workspace that removed the plugin | the step is skipped |
| a `gh` failure | only logs |

The pipeline itself never produces a red X. Only a parsed blocking finding does.

> [!NOTE]
> The install step that feeds the verdict gate can go red if the workspace is genuinely broken, for example when a lockfile is out of sync. That red X shows a defect in the workspace. It isn't a verdict.

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
