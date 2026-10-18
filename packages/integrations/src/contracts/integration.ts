export interface IntegrationContext {
  workspaceRoot: string;
  targetEnvironment: string;
}

export interface DetectionResult {
  installed: boolean;
  installedVersion?: string;
  managedBy: 'external-tool' | 'nx-archweave' | 'unknown';
  evidence: string[];
}

/** Host-defined install scope. Today these are Claude Code's own values
 * (`claude plugin install --scope`); nx-archweave's default is 'project'
 * (DEFAULT_PLUGIN_SCOPE). */
export type IntegrationInstallScope = 'user' | 'project' | 'local';

export interface IntegrationOptions {
  targetEnvironment: string;
  versionRange?: string;
  scope?: IntegrationInstallScope;
}

export interface InstallPlan {
  officialCommand: { executable: string; args: string[] } | null;
  resolvedVersion: string;
  filesCreated: string[];
  filesModified: string[];
  conflicts: Array<{ path: string; reason: string }>;
  sourceRepository: string;
  officialHomepage: string;
  license: string;
  requiresManualExecution: boolean;
}

export interface ApprovedInstallPlan extends InstallPlan {
  approvedBy: 'user';
}

export interface InstallResult {
  executed: boolean;
  partialFailure: boolean;
  filesCreated: string[];
  filesModified: string[];
  manualStepsRemaining: string[];
}

export interface VerificationResult {
  verified: boolean;
  resolvedVersion?: string;
  problems: string[];
}

export interface ToolIntegration {
  id: string;
  displayName: string;
  homepage: string;
  repository: string;
  license: string;
  supportedEnvironments: string[];

  detect(context: IntegrationContext): Promise<DetectionResult>;
  plan(options: IntegrationOptions): Promise<InstallPlan>;
  install(plan: ApprovedInstallPlan): Promise<InstallResult>;
  verify(context: IntegrationContext): Promise<VerificationResult>;
  uninstallInstructions(context: IntegrationContext): Promise<string[]>;
}
