export interface FileChange {
  path: string;
  reason: string;
}

export type ConflictResolution = 'skip' | 'merge-proposal' | 'alternate-filename';

export interface Conflict {
  path: string;
  reason: string;
  resolution: ConflictResolution;
}

export interface InitPlan {
  filesToCreate: FileChange[];
  filesToModify: FileChange[];
  conflicts: Conflict[];
  skipped: FileChange[];
  commands: string[];
  warnings: string[];
  requiresApproval: boolean;
}

export function createEmptyInitPlan(): InitPlan {
  return {
    filesToCreate: [],
    filesToModify: [],
    conflicts: [],
    skipped: [],
    commands: [],
    warnings: [],
    requiresApproval: false,
  };
}
