# @nx-archweave/review-policy

Pure policy logic for automated PR review. No I/O, no Nx devkit, no network —
every export is a pure function or a plain data table.

## Public API

- `ReviewFinding`, `ReviewPriority`, `ReviewVerdict`, `computeVerdict(findings)` —
  finding schema and the fixed verdict rule (P0/P1 → BLOCK, P2 →
  CHANGES_RECOMMENDED, anything else → APPROVE_WITH_NOTES, empty → APPROVE).
- `ReviewPolicyConfig`, `ReviewMode`, `ReviewLocale` — config schema referenced by
  `ToolkitConfig.review`. `maxRounds`/`blockingPriorities` are literal-typed so
  presets cannot relax them.
- `REVIEW_MODES`, `ReviewModeDefinition` — what each mode runs: `fast` uses the
  condensed P0–P2 prompt style (no Nit), `standard`/`thorough` use the sectioned
  Correctness/Security style; only `thorough` adds the over-engineering pass.
- `buildCorrectnessSecurityPrompt(locale, promptStyle?)`, `buildOverEngineeringPrompt(locale)` —
  prompt text builders (`ko`/`en`). Their requested priority sets never overlap.
- `renderReviewComment(input)`, `RoundHistoryEntry` — renders a GitHub-ready
  markdown comment: verdict line, priority-grouped sections, round-history
  footer, and a termination banner when rounds are exhausted with blockers left.

## Running unit tests

Run `nx test @nx-archweave/review-policy` to execute the unit tests via [Jest](https://jestjs.io).
