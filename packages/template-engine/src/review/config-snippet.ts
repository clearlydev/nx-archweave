import type { ReviewPolicyConfig } from '@nx-archweave/review-policy';
import type { ReviewProviderId, ReviewWorkflowInput } from './provider.ts';

export interface ReviewSetupInput extends ReviewWorkflowInput {
  enabled: boolean;
  provider: ReviewProviderId;
}

/** Flat value object for the review settings: ReviewPolicyConfig plus
 * enabled/provider, with NO nested policy duplication. Typed locally. */
export type ReviewConfigSnippet = ReviewPolicyConfig & {
  enabled: true;
  provider: ReviewProviderId;
};

export function buildReviewConfigSnippet(input: ReviewSetupInput): ReviewConfigSnippet {
  return {
    enabled: true,
    provider: input.provider,
    mode: input.mode,
    locale: input.locale,
    maxRounds: input.maxRounds,
    blockingPriorities: ['P0', 'P1'],
  };
}
