export interface AddReviewGeneratorSchema {
  provider?: 'claude' | 'gemini' | 'gpt' | 'cursor';
  mode?: 'fast' | 'standard' | 'thorough';
  locale?: 'ko' | 'en';
  maxRounds?: 1 | 2 | 3 | 4 | 5;
  onConflict?: 'overwrite' | 'skip' | 'alternate-filename';
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  dryRun?: boolean;
}
