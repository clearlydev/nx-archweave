export * from './compose-review-setup.ts';
export { buildReviewConfigSnippet, type ReviewConfigSnippet } from './config-snippet.ts';
export * from './conflict.ts';
export {
  REVIEW_PROVIDERS,
  type ReviewProviderId,
  type ReviewWorkflowInput,
  type ReviewWorkflowProvider,
} from './provider.ts';
// Verdict-gate surface for the plugin's bin adapter: type:plugin may not
// depend on type:policy directly (workspace depConstraints), so the engine —
// which owns the review wiring — re-exports the gate it renders steps for.
export {
  FINDINGS_MARKER,
  ROUND_MARKER,
  runVerdictGate,
  VERDICT_MARKER,
  type ReviewLocale,
  type ReviewMaxRounds,
  type VerdictGateResult,
} from '@nx-archweave/review-policy';
