import { createEmptyInitPlan } from './init-plan.ts';

describe('createEmptyInitPlan', () => {
  it('starts with all collections empty and requiresApproval false', () => {
    expect(createEmptyInitPlan()).toEqual({
      filesToCreate: [],
      filesToModify: [],
      conflicts: [],
      skipped: [],
      commands: [],
      warnings: [],
      requiresApproval: false,
    });
  });
});
