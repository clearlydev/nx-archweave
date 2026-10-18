import { buildReviewConfigSnippet, type ReviewConfigSnippet, type ReviewSetupInput } from './config-snippet.ts';
import { REVIEW_PROVIDERS } from './provider.ts';

export type { ReviewSetupInput } from './config-snippet.ts';

export interface ReviewSetupPlan {
  workflowFilePath: string;
  workflowYaml: string;
  requiredSecretName: string;
  configSnippet: ReviewConfigSnippet;
}

/** Returns null when review is disabled: no artifacts at all. */
export function composeReviewSetup(input: ReviewSetupInput): ReviewSetupPlan | null {
  if (!input.enabled) return null;
  const provider = REVIEW_PROVIDERS[input.provider];
  return {
    workflowFilePath: provider.workflowFileName,
    workflowYaml: provider.buildWorkflowYaml(input),
    requiredSecretName: provider.requiredSecretName,
    configSnippet: buildReviewConfigSnippet(input),
  };
}
