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
  applyEslint?: boolean;
  /** The frontend app(s) for the FSD section — comma-separated or a list; required with more than one frontend. */
  project?: string | string[];
  /** Exit non-zero when a section aborts or is refused (files that were written stay). */
  strict?: boolean;
}
