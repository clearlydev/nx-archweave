import type { ReviewMode } from '../schema/review-policy-config.ts';

export type ReviewPromptStyle = 'fast-condensed' | 'sectioned';

export interface ReviewModeDefinition {
  mode: ReviewMode;
  /** Fast is a condensed single-perspective prompt (P0–P2, no
   * Nit); standard and thorough share the sectioned Correctness/Security
   * prompt. Every mode runs as ONE action invocation — call splitting was
   * rejected because the verdict pipeline would lose P3 tracking. */
  promptStyle: ReviewPromptStyle;
  includesCorrectnessSecurity: true;
  includesOverEngineering: boolean; // true only for 'thorough'
}

export const REVIEW_MODES: Readonly<Record<ReviewMode, ReviewModeDefinition>> = {
  fast: {
    mode: 'fast',
    promptStyle: 'fast-condensed',
    includesCorrectnessSecurity: true,
    includesOverEngineering: false,
  },
  standard: {
    mode: 'standard',
    promptStyle: 'sectioned',
    includesCorrectnessSecurity: true,
    includesOverEngineering: false,
  },
  thorough: {
    mode: 'thorough',
    promptStyle: 'sectioned',
    includesCorrectnessSecurity: true,
    includesOverEngineering: true,
  },
};
