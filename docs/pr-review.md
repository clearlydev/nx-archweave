# Automated PR review

English | [한국어](ko-KR/pr-review.md)

Automated PR review is optional, isn't tied to one provider, and fails safe: when it can't tell a blocking review from a clean one, the `review` check goes red instead of green. It doesn't replace a person's code review. Keep a person's approval required on every pull request.

This page covers, in order: setting it up, the providers, when the check is green or red, the repository settings to use with it, troubleshooting, and a reference for how it works.

## Set it up

1. **Generate the workflow.** Preview it first:

   ```bash
   npx nx g @clearlydev/nx-archweave:add-review --provider=claude --dryRun
   npx nx g @clearlydev/nx-archweave:add-review --provider=claude
   ```

   create-nx-archweave sets it up only when asked (`--review`, or "y" in `quick-start`; `team` turns it on). `--mode` and `--maxRounds` are covered under [Reference](#reference).
2. **Get the provider's secret** (see [Providers](#providers)) and register it under the repository's **Settings → Secrets and variables → Actions**. A secret under the Dependabot or Codespaces tab doesn't reach the workflow.
3. **`claude` only: install the [Claude GitHub App](https://github.com/apps/claude)** on the repository (**Only select repositories**).
4. **Merge the workflow to the default branch** before you rely on it. For `claude`, a pull request whose workflow file differs from the default branch's is skipped by claude-code-action, and `review` turns red (see [Troubleshooting](#troubleshooting)).
5. **Make `review` a required check** in a branch ruleset, together with a person's approval (see [Recommended repository settings](#recommended-repository-settings)).
6. **Open a pull request.** The review posts a summary comment, and a short verdict comment that it edits every round.

Until the secret is registered, the workflow ends green with a notice that the AI review didn't run, so adding it never turns a pull request red on its own.

## Providers

| Provider | Workflow file | Required secret | Get the secret |
| --- | --- | --- | --- |
| `claude` (default) | `.github/workflows/claude-code-review.yml` | `CLAUDE_CODE_OAUTH_TOKEN` | A Claude Code OAuth token, plus the [Claude GitHub App](https://github.com/apps/claude) on the repository |
| `gemini` (beta) | `.github/workflows/gemini-code-review.yml` | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) → **Get API key** |
| `gpt` (beta) | `.github/workflows/gpt-code-review.yml` | `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `cursor` (beta) | `.github/workflows/cursor-code-review.yml` | `CURSOR_API_KEY` | [cursor.com/dashboard/api](https://cursor.com/dashboard/api). On the Free plan the page isn't in the dashboard menu; open the address directly |

- Use one provider per repository. The four workflows share their job names (so a required `review` check would match either), their queue and their round marker.
- All four follow the same contract and share one workflow skeleton, so the checks below work the same whichever one you pick.
- create-nx-archweave doesn't offer `cursor` in its questions (pass `--review-provider=cursor`). create-nx-archweave and `add-review` print the warning below for every beta provider.

## Provider status

`claude` is the default. `gemini`, `gpt` and `cursor` are **beta**: their workflows ran on GitHub Actions, but the free tier or a missing API balance stopped most of their reviews (see [Troubleshooting](#troubleshooting)). Each gets a full run on a paid tier before the label goes.

> [!WARNING]
> `gemini`, `gpt` and `cursor` are beta: they haven't been verified end to end yet (see the table below). Whatever the provider, the AI review doesn't replace a person's code review: require a person's approval on every pull request (see [Merging a commit without an AI verdict](#merging-a-commit-without-an-ai-verdict)), and keep **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** off.

| Provider | Status | Checked on GitHub Actions | Cost |
| --- | --- | --- | --- |
| `claude` (default) | — | Verified: without the secret the workflow green-skips; a token without the Claude GitHub App fails with `401 … Claude Code is not installed on this repository` and turns `review` red; a clean pull request got a summary, an APPROVE verdict comment and a green `review` (about 1 minute 45 seconds end to end); a pull request with a security defect got a BLOCK and a red `review`, re-running the failed jobs kept it red, later rounds edited the one verdict comment, and a review that posted no summary turned `review` red (0.3.0); a commit past the round limit and a review in a workspace without the plugin turned a required `review` red and blocked the merge, while a missing secret and a Dependabot pull request still ended green with their notice (0.4.0); the summary is posted as `claude[bot]`, and a pull request whose content gave instructions to the reviewer got a P1 `instructions-in-content` finding and a BLOCK (0.4.2) | Your Claude subscription; the clean review used about $0.05 |
| `gemini` | beta | Verified: without the secret the workflow green-skips; a failed AI review turns `review` red; a clean pull request got a summary from the separate posting step, an APPROVE and a green `review` (0.4.2). Not verified: BLOCK, rounds, re-runs | Free tier with limits; it can fail with 503 when the model is busy, or stop at the daily quota |
| `gpt` | beta | Verified: green-skip without the secret; a failed AI review (API quota) turns `review` red. Not verified: a finished review | OpenAI API credits, separate from a ChatGPT subscription. Mentioning `@codex` on a pull request is a separate ChatGPT feature (the Codex connector): it doesn't run this workflow, creates no check and never reaches the verdict gate |
| `cursor` | beta | Verified: green-skip without the secret; a failed AI review turns `review` red. Not verified: a finished review, BLOCK, rounds, re-runs | Your Cursor plan's agent usage; the Free plan's limit stopped the first review |

What was checked: the first checks (2026-10-25) ran workflows generated by create-nx-archweave 0.2.2 (for `gemini` and `cursor`, with the 0.3.0 workspace-trust fix applied), on `anthropics/claude-code-action@6b6870e6…` (v1.0.258, model `claude-sonnet-5-5`), `actions/checkout@3d3c42e5…` (v7.0.1), `actions/setup-node@949feb24…` (v7.1.0) and `google-github-actions/run-gemini-cli@f77273f4…` (v0.1.22), with Gemini CLI 0.65.0 and cursor-agent 2026.10.22-27dcf5f. The 0.4.0 checks (2026-11-07) ran on a workflow generated from the packed 0.4.0 packages, on `anthropics/claude-code-action@c0949c50…` (v1.0.268), and called no AI: a bot comment with the round marker reached the round limit (`maxRounds: 1`), and for the missing plugin the AI review step was replaced with one that succeeds without a review. The 0.4.2 checks (2026-11-17) ran workflows generated from the packed 0.4.2 packages for `claude` and `gemini`.

## When the check is green or red

The `review` job is the check to make required. It ends green only when this run's summary was judged and isn't a BLOCK, or when the AI review was switched off for a reason it states. Every other case is red, because it can't tell a blocking review from a clean one.

**Green**

| Situation | What you see |
| --- | --- |
| The review ran and the verdict is `APPROVE`, `APPROVE_WITH_NOTES` or `CHANGES_RECOMMENDED` | The summary, and the verdict comment with the findings |
| No provider secret is registered | Notice: `AI review did not run for this commit (<reason>). A green check here does not mean the change was reviewed.` |
| The repository variable `ARCHWEAVE_REVIEW_DISABLED` is `true` | The same notice, naming the variable ([Switching review off](#switching-review-off)) |
| A pull request from a fork, or from Dependabot | The same notice: GitHub passes neither run the provider secret |
| A bot account opened the pull request and wrote all of its commits | The same notice, naming that reason |

The notice is a notice in the run, a line in the job summary and the verdict comment. The comment is posted only where the run's token may write, so not on a fork's pull request. Pull requests that end green without a review need a person's review: see [Merging a commit without an AI verdict](#merging-a-commit-without-an-ai-verdict).

**Red**

| Situation | What to do |
| --- | --- |
| A finding is `P0` or `P1` (verdict `BLOCK`) | Fix it, or have a person decide (bypass) |
| The AI review failed, was cancelled, was skipped or hit the 15-minute timeout | See [Troubleshooting](#troubleshooting), then re-run all jobs |
| This run posted no summary for the commit, or one whose findings block can't be read | Review it yourself, or re-run all jobs |
| This run has more than one summary from the review account, or findings blocks that disagree | Review it yourself, or re-run all jobs |
| The summary for the commit came from a bot account other than the review account | See [Round gate](#round-gate) (`ARCHWEAVE_REVIEW_AUTHOR`) |
| The commit comes after the round limit (`maxRounds`) | Merge with the bypass, or raise `maxRounds` and run `add-review` again; re-running doesn't help |
| A bot account started the run on a pull request a person opened or wrote commits in | A person re-runs all jobs on the latest commit |
| The workspace has the review workflow but not `@clearlydev/nx-archweave` | Install it as a devDependency, or delete the workflow to switch review off |
| The workflow names a contract this release doesn't read | See [Workflow version](#workflow-version) |
| The verdict gate's environment is missing or malformed (for example after editing the workflow by hand) | Regenerate the workflow |
| The AI review job's results didn't reach the `review` job, for example on a re-run | Re-run all jobs (the AI review runs, and costs, again) |
| The `review` job can't read the pull request comments | Re-run the failed jobs; if it fails again, check that the job has `pull-requests: read` |
| `claude`: the secret is registered but the Claude GitHub App isn't installed | Install the app (see [Troubleshooting](#troubleshooting)) |

> [!NOTE]
> The `review` job's install step can also go red if the workspace is genuinely broken, for example when a lockfile is out of sync. That red X shows a defect in the workspace. It isn't a verdict.

Older workflows behave differently, because the workflow file lives in your repository and upgrading the plugin doesn't change it. A workflow generated before 0.4.0 still ends green after the round limit and in a workspace without the verdict tool (`doctor`: `review-workflow-no-verdict`). One generated before 0.2.2 ends green without a summary (`doctor`: `review-workflow-fail-open`). Regenerate them (see [Workflow version](#workflow-version)).

## Recommended repository settings

- Require a person's approval on pull requests: **Require a pull request before merging → Required approvals**, with **Dismiss stale pull request approvals when new commits are pushed**.
- Make `review` a required status check in the same ruleset.
- Keep **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** off.
- Give the review workflow and the AI tools' settings files an owner in `CODEOWNERS`, with **Require review from Code Owners** on, for example:

  ```
  /.github/workflows/  @your-org/maintainers
  /.claude/            @your-org/maintainers
  /.gemini/            @your-org/maintainers
  /.cursor/            @your-org/maintainers
  ```

- Use an API key made for this repository only, with a spending limit at the provider, so a key can be revoked and its cost capped without touching anything else.
- For pull requests from forks: **Settings → Actions → General → Approval for running fork pull request workflows**.

### Merging a commit without an AI verdict

`review` fails when the AI review ran but left no verdict for the head commit, and when the commit comes after the round limit. nx-archweave adds no way around its own check: a person passes such a commit with GitHub's own tools, which record who did it.

- **Bypass (any repository).** Add yourself, a role (admin, maintain or write) or a team to the ruleset's bypass list, as **For pull requests only**. You then merge with **Merge without waiting for requirements to be met (bypass branch protections)**. The `review` check stays red, which is the truth, and the ruleset's **Rule insights** lists the bypass. With classic branch protection, admins can bypass unless **Do not allow bypassing the above settings** is on.
- **Required approvals (team repositories).** Every pull request needs a person's approval, with or without an AI verdict. An approval does not turn a red `review` green: a commit without an AI verdict still needs the bypass.

Pull requests that end green without a review (no secret, a fork, Dependabot, a bot's own pull request, review switched off) are protected only by a person's approval. A fork's or Dependabot's run receives no provider secret, so the workflow can't tell it from a repository that has review switched off. For a fork, the check isn't a gate in any case: a pull request from a fork runs its own copy of the workflow.

## Troubleshooting

- **`claude`: `401 — Claude Code is not installed on this repository`.** The `claude` provider exchanges its secret for a GitHub App token, so with the secret but without the [Claude GitHub App](https://github.com/apps/claude) the job fails instead of green-skipping. Install the app on the repository. The other three providers have no app-exchange step.
- **`claude`: the review step succeeds without reviewing ("Workflow validation failed"), and `review` is red with no summary.** claude-code-action skips a run whose workflow file differs from the default branch's, for example on the pull request that adds or regenerates the workflow. Merge the workflow change first (with the bypass if `review` is required), then re-run.
- **`claude`: denied tool calls.** The agent may use only the tools listed under [Workflow hardening](#workflow-hardening). The `Show denied tool calls` step lists each denied call (tool name and the first 200 characters of the command). On 0.2.x a review that was denied and posted no summary passed green; since 0.3.0 it fails.
- **`gemini`, free tier: `503 UNAVAILABLE` or the daily quota.** When the model is in high demand, Gemini CLI retries ten times over about five minutes, then the AI review fails and `review` turns red. Re-run all jobs later, or use a paid key.
- **`cursor`, Free plan:** the first review ran for 8.5 minutes without output, then stopped with `You've hit your usage limit`. A full review needs a plan with more agent usage.
- **`gpt`, no API balance:** `Quota exceeded. Check your plan and billing details.` A ChatGPT subscription doesn't fund the API; add credits at platform.openai.com.
- **The workflow green-skips although you added the secret.** Check that it's under the **Actions** tab of **Secrets and variables**, not Dependabot or Codespaces, and that its name matches the table in [Providers](#providers).
- **`doctor` warns about the review workflow** (`review-workflow-contract`, `review-workflow-no-verdict`, `review-workflow-fail-open`): the workflow was generated by an earlier release. Regenerate it:

  ```bash
  npx nx g @clearlydev/nx-archweave:add-review --onConflict=overwrite --dryRun
  npx nx g @clearlydev/nx-archweave:add-review --onConflict=overwrite
  ```

### Switching review off

Set the repository variable `ARCHWEAVE_REVIEW_DISABLED` to `true` (**Settings → Secrets and variables → Actions → Variables**, or `gh variable set ARCHWEAVE_REVIEW_DISABLED --body true`). From the next run, the AI review doesn't start, and `review` ends green with the notice `AI review did not run for this commit (the ARCHWEAVE_REVIEW_DISABLED repository variable is set to true)`. Nothing else changes: the secret, the workflow file and the branch ruleset stay as they are. Delete the variable, or set it to anything but `true`, to switch review back on. A workflow generated before 0.4.2 doesn't read the variable; regenerate it (see [Workflow version](#workflow-version)).

To remove review entirely, delete the workflow file and the secret.

### Workflow version

A generated workflow names the version of its contract with the verdict tool (`ARCHWEAVE_WORKFLOW_CONTRACT` in the verdict step). The verdict tool fails the check on a number it doesn't read, instead of guessing, and `doctor` warns (`review-workflow-contract`):

- about a workflow without the number, or with a lower one: it was generated by an earlier release and is missing changes this release makes to the review workflow. Upgrading the plugin doesn't change the workflow file in your repository. Regenerate it with the commands above.
- about a workflow with a higher number: upgrade `@clearlydev/nx-archweave` to the release that generated it.

## Reference

### Gates

Every review passes three gates:

| Gate | What it does | Outcome |
| --- | --- | --- |
| **Secret gate** | checks the review switch, the provider's secret, and who opened the PR, wrote its commits and started the run | switched off, no secret, or a bot's own PR → **green-skips**; a bot's run on a person's PR → **fails the check** |
| **Round gate** | counts review markers on the PR | stops once `maxRounds` is reached; **later commits fail the check** |
| **Verdict gate** | parses the findings and computes a verdict | **fails the check on BLOCK** |

#### Secret gate

- If the provider's secret isn't registered, the job prints `AI review is not active: register the <SECRET> secret to enable it.` and **green-skips**, so a workspace without AI access never sees a red X.
- AI review runs only for changes from people. The secret gate reads from the GitHub API who opened the pull request and who wrote its commits, and checks who started the run (on a re-run, the person who re-ran it):
  - A bot account opened the pull request and wrote all of its commits (a dependency update bot, say): the job prints `AI review skipped: a bot account opened this pull request and wrote all of its commits.` and green-skips, with the notice naming that reason.
  - A bot account (a login ending in `[bot]`) started the run on a pull request a person opened or wrote commits in, for example by pushing to it: the AI review doesn't run, and `review` **fails**, because the person's commits have no verdict. The verdict comment asks a person to re-run all jobs on the latest commit; that run reviews it.
  - A commit whose author has no GitHub account counts as a person's.
- The repository variable `ARCHWEAVE_REVIEW_DISABLED` switches the review off without changing any file (see [Switching review off](#switching-review-off)).

#### Round gate

- Each review the workflow posts carries an invisible marker (`<!-- archweave-review-round -->`).
- The workflow counts the markers on the PR and stops once it reaches `maxRounds`, so review can't loop forever on an active PR. `maxRounds` accepts `1`–`5` and defaults to `3`.
- Only markers in comments written by the provider's review account count: `claude[bot]` for `claude`, `github-actions[bot]` for `gemini`, `gpt` and `cursor`. Anyone who can comment on the PR could otherwise post the marker until `maxRounds` is reached and switch review off. The verdict gate reads summaries from the same account.
- The account is one line at the top of the workflow, `env: ARCHWEAVE_REVIEW_AUTHOR`, read by the round gate and the verdict gate. If you make the provider post as another account, for example by giving claude-code-action your own GitHub App's token in its `github_token` input, set this line to that account (several accounts are separated by commas). A summary from any other bot account that would count for the commit fails `review`, and the verdict comment names both accounts. A workflow generated before 0.4.2 has no such line and counts `claude[bot]` and `github-actions[bot]`.
- A commit after the limit has no AI verdict, so the `review` check **fails** on it. The verdict comment and the failing step say so, and name the two ways forward: merge with your branch ruleset's bypass, or raise `maxRounds` and run `add-review` again. Re-running the jobs doesn't help: the round gate stops the review again.

#### Verdict gate

1. The model appends a machine-readable `archweave/findings@1` JSON block to its summary comment.
2. The `review` job parses that block with the plugin's `archweave-review-verdict` bin and computes the verdict. Any P0/P1 finding → `BLOCK`.
3. The `review-comment` job keeps one short verdict comment per PR. It edits that comment every round, with the fixed/remaining history of each round and the commit it judged. If the comment can't be posted, the job only logs it.
4. The `review` job **fails the check on BLOCK**, and in the other red cases in [When the check is green or red](#when-the-check-is-green-or-red).

The verdict only counts a summary posted by the same run. If a run's review posts no summary, the step never judges an earlier commit's round again. (A workflow generated before 0.2.2 judges a commit with several summaries by the most severe of them.)

> [!NOTE]
> Review runs on a PR queue up and run one at a time. If you push while another run is waiting, the new run replaces the waiting one. So an intermediate commit can go unreviewed.

### Workflow hardening

- The workflow has three jobs, and each gets only the access it needs:
  - `ai-review` holds the provider secret and runs the AI review. It installs nothing. Only the `claude` provider's job can request an OIDC token (`id-token: write`), because the Claude GitHub App signs in with one. `gemini`, `gpt` and `cursor` use an API key and get none.
  - `review` is the check you make required. It installs the workspace's dependencies and runs the verdict bin with a read-only token (`contents: read`, `pull-requests: read`), no secret and no OIDC token. It fails unless `ai-review` succeeded and its results reached the `review` job, and on a BLOCK.
  - `review-comment` posts the verdict comment with `pull-requests: write`. It checks out nothing and installs nothing, and reads the verdict through environment variables, never inline in its script.
- The `review` job installs with install scripts off: `npm ci --ignore-scripts`, `pnpm install --frozen-lockfile --ignore-scripts`, `yarn install --frozen-lockfile --ignore-scripts` (yarn 1), `YARN_ENABLE_SCRIPTS=false yarn install --immutable --mode=skip-build` (yarn 2 and later), `bun install --frozen-lockfile --ignore-scripts`. The verdict bin is plain JavaScript and needs no build step.
- Every action is pinned to a commit SHA, with its version in a trailing comment (`actions/checkout@<sha> # v7.0.1`). A version tag can be moved to other code; a commit can't, and the workflow holds your provider secret. `add-review` writes `.github/dependabot.yml` with a `github-actions` entry when the file is missing, and shows the entry to add when the file exists without one, so the pins move forward through pull requests you review.
- Every checkout step sets `persist-credentials: false`, so the repository token is not left in `.git/config` for later steps.
- The `review` job sets up Node 22 with `check-latest: true`, so it runs on the newest patch release of that line even when the runner image still carries an older one. A workflow generated before 0.4.4 uses the runner's cached Node 22; regenerate it to pick this up.
- pnpm workspaces: the workflow reads `packageManager` from `package.json` on the runner. With the field, `pnpm/action-setup` uses it; without it, the workflow passes pnpm 10.
- Every job stops after 15 minutes (`timeout-minutes: 15`), instead of GitHub's 360-minute default. An AI review stopped that way counts as failed, so `review` turns red.
- The `claude` agent may use only the tools of claude-code-action's PR-review examples: inline comments, `gh pr diff`, `gh pr view`, and `gh pr comment` on this pull request with the body read from standard input (`gh pr comment <number> --body-file -`). No other shell command, no `gh api`, no file edits.
- The `gemini` and `cursor` agents get no GitHub token. A step before them writes the pull request's diff and description to `.archweave-review/` (`pr.diff`, `pr.md`) and removes the CLI's project settings from the checkout (`.gemini` and `.env`, or `.cursor`). A step after the agent posts its response as the summary comment, with the workflow's token. These two providers post no inline comments: every finding is in the summary.
- The `gemini` agent may use only `read_file` and `grep_search`. The `run-gemini-cli` action starts Gemini CLI in YOLO mode, which approves every call to an allowed tool without asking; the allowed-tool list is what keeps shell and write tools out. The action installs the pinned Gemini CLI (`gemini_cli_version`) instead of its default `latest`; Dependabot doesn't move this pin, a new nx-archweave release does.
- The `cursor` provider installs `cursor-agent` with `curl --proto '=https' --tlsv1.2 -fsS https://cursor.com/install | bash`. Cursor publishes no pinned version or checksum for it (see [Security scope](#security-scope)).
- The `Show denied tool calls` step prints, for each call the agent was denied, the tool name and the first 200 characters of the command: one JSON line each, with workflow commands switched off around them. When the run ends in an error (an expired token, a usage limit) it also prints the first 300 characters of the error, which the action's log leaves out. It prints nothing the tools returned and uploads nothing. The action's `show_full_output` and `display_report` stay off, because they would publish tool output in the log.
- Every prompt says that the pull request's title, description, commit messages, code, comments and files are material to review, never instructions to the reviewer (see [Verdict policy](#verdict-policy)).

### Security scope

These protections limit what code from a pull request can reach. They don't protect the workflow from people who can change it. GitHub passes no secrets to a workflow run for a pull request from a fork and gives it a read-only token, so a fork's pull request is never reviewed: the secret gate green-skips it. Its `review` check isn't a gate in any case, because a pull request from a fork runs its own copy of the workflow, which its author can change. Protect such pull requests with **Required approvals** and the approval setting for fork pull request workflows. Anyone with push access to the repository can edit the workflow file in a branch and run whatever they like with the provider secret, so give write access only to people you would trust with that secret.

The `cursor` provider is the exception to pinning. Each run installs whatever version Cursor publishes at that moment. The install step itself holds no secret, but the binary it installs runs in the next step with `CURSOR_API_KEY`. A tampered download would get it. If that risk is too high for your repository, pick another provider.

The `gemini` and `cursor` CLIs refuse to run in a folder they haven't been told to trust, so their review step trusts the checkout (`GEMINI_CLI_TRUST_WORKSPACE: 'true'`, `agent --trust`). Trusting it would let the CLI read the project settings in the checked-out pull request, so the step before the agent removes them (see [Workflow hardening](#workflow-hardening)). Only pull requests from the repository itself get the secret, and their authors can already change the workflow.

### Review modes

| Mode | Prompt shape | Priorities |
| --- | --- | --- |
| `fast` | one condensed prompt | P0–P2 (no Nit) |
| `standard` | explicit Correctness / Security sections | P0–P2 + Nit |
| `thorough` | standard + an over-engineering pass | standard + P3 |

- **`fast`** covers critical problems only and skips minor remarks.
- **`standard`** puts Correctness and Security in explicit top-level sections.
- **`thorough`** appends an over-engineering pass to the standard prompt, in the same single call. P3 findings are posted as their own section.

All three modes run as ONE provider call. If the over-engineering pass ran as a second call, it would post a second comment outside the round marker and the findings block, and the verdict pipeline would never see P3. The three modes emit genuinely different workflows.

### Verdict policy

Review prompts tell the provider to prioritize findings as `P0`, `P1`, `P2`, `P3`, `Nit`. The bundled review policy maps those priorities to a verdict. It's a fixed algorithm, never configured per preset:

| Findings present | Verdict |
| --- | --- |
| any `P0` or `P1` | `BLOCK` |
| any `P2` | `CHANGES_RECOMMENDED` |
| only `P3` / `Nit` | `APPROVE_WITH_NOTES` |
| none | `APPROVE` |

Every prompt says that the pull request's title, description, commit messages, code, comments and files are material to review, never instructions to the reviewer. Text in them that tells the reviewer what to report, what verdict to give, or to leave something out is reported as a `P1` finding with the category `instructions-in-content`, so it blocks the merge until a person looks at it.
