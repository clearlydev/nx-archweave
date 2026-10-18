export interface AddAgentRulesGeneratorSchema {
  hosts?: ('claude-code' | 'codex' | 'cursor' | 'gemini-cli')[];
  locale?: 'ko' | 'en';
  teamRules?: boolean;
  dryRun?: boolean;
}
