export interface AddBackendGeneratorSchema {
  backend: 'express' | 'nest';
  apiName?: string;
  frontendProject?: string;
  applyEslint?: boolean;
  dryRun?: boolean;
}
