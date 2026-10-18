import type { ToolkitConfigBase } from '@nx-archweave/shared';
import type { ReviewConfigSnippet } from './review/config-snippet.ts';

/**
 * The review field of `ToolkitConfig`: either a fully-populated `ReviewConfigSnippet`
 * (review enabled, `provider` required — typed via `ReviewProviderId` so it widens
 * with that union) or `{ enabled: false }` with no other
 * fields, matching the review-optional invariant.
 */
export type ToolkitReviewConfig = ReviewConfigSnippet | { enabled: false };

/**
 * The complete `ToolkitConfig`, assembled here — the lowest layer
 * allowed to depend on both `shared` (review-agnostic base) and `review-policy`
 * (transitively, via `ReviewConfigSnippet`) under the package dependency
 * directions. `shared` itself stays a leaf and exports only `ToolkitConfigBase`.
 */
export type ToolkitConfig = ToolkitConfigBase & {
  review: ToolkitReviewConfig;
};
