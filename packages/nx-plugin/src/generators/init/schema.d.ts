export interface InitGeneratorSchema {
  preset?: 'quick-start' | 'solo' | 'team';
  frontend?: 'react-vite' | 'next' | 'expo' | 'generic' | 'none';
  backend?: 'express' | 'nest' | 'none';
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  locale?: 'ko' | 'en';
  reviewProvider?: 'claude' | 'gemini' | 'gpt' | 'cursor';
  aiHosts?: ('claude-code' | 'codex' | 'cursor' | 'gemini-cli')[];
  fsd?: boolean;
  agentRules?: boolean;
  githubTemplates?: boolean;
  review?: boolean;
  dryRun?: boolean;
  allowDirty?: boolean;
  /** Internal: the dirty tree is the caller's own doing, so the report omits the earlier-changes note. Never affects the refusal. */
  dirtyFromCaller?: boolean;
  applyEslint?: boolean;
  /** The frontend app(s) for the FSD section — comma-separated or a list; required with more than one frontend. */
  project?: string | string[];
  /** Also exit non-zero when init couldn't do something you asked for (a refusal or an aborted section always does); files that were written stay. */
  strict?: boolean;
}
