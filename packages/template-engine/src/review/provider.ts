import type { SupportedPackageManager } from '../environment/package-manager.ts';
import type { ReviewLocale, ReviewMaxRounds, ReviewMode } from '@nx-archweave/review-policy';
import { claudeProvider } from './claude/claude-provider.ts';
import { cursorProvider } from './cursor/cursor-provider.ts';
import { geminiProvider } from './gemini/gemini-provider.ts';
import { gptProvider } from './gpt/gpt-provider.ts';

export interface ReviewWorkflowInput {
  mode: ReviewMode;
  locale: ReviewLocale;
  maxRounds: ReviewMaxRounds;
  /** Drives the workspace setup steps before the verdict gate. */
  packageManager: SupportedPackageManager;
}

export type ReviewProviderId = 'claude' | 'gemini' | 'gpt' | 'cursor';

export interface ReviewWorkflowProvider {
  id: ReviewProviderId;
  /** Owned by the provider so multiple providers' workflows can coexist. */
  workflowFileName: string;
  /** doctor checks secret registration by this exact name. */
  requiredSecretName: string;
  buildWorkflowYaml(input: ReviewWorkflowInput): string;
}

export const REVIEW_PROVIDERS: Readonly<Record<ReviewProviderId, ReviewWorkflowProvider>> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  gpt: gptProvider,
  cursor: cursorProvider,
};
