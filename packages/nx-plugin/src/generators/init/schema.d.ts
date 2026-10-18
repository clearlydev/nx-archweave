export interface InitGeneratorSchema {
  preset?: 'quick-start' | 'solo' | 'team';
  frontend?: 'react-vite' | 'next' | 'none';
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
}
