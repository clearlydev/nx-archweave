export interface AddFsdLiteGeneratorSchema {
  frontend?: 'react-vite' | 'next';
  project?: string;
  enforcement?: 'error' | 'warn';
  applyEslint?: boolean;
  steiger?: boolean;
  locale?: 'ko' | 'en';
  dryRun?: boolean;
}
