export interface InstallIntegrationGeneratorSchema {
  /** A plugin-catalog id (the schema enum is kept equal to the catalog). */
  tool: string;
  target?: 'claude-code';
  scope?: 'user' | 'project' | 'local';
  versionRange?: string;
  apply?: boolean;
}
