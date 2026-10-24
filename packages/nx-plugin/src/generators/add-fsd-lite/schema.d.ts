export interface AddFsdLiteGeneratorSchema {
  frontend?: 'react-vite' | 'next' | 'expo' | 'generic';
  project?: string;
  enforcement?: 'error' | 'warn';
  applyEslint?: boolean;
  steiger?: boolean;
  locale?: 'ko' | 'en';
  dryRun?: boolean;
}
