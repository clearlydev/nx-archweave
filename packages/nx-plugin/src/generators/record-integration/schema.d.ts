export interface RecordIntegrationGeneratorSchema {
  /** A plugin-catalog id (the schema enum is kept equal to the catalog). */
  tool: string;
  target?: 'claude-code';
  apply?: boolean;
}
