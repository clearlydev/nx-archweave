export interface AddGithubTemplatesGeneratorSchema {
  issue?: boolean;
  pr?: boolean;
  codeowners?: boolean;
  locale?: 'ko' | 'en';
  dryRun?: boolean;
}
