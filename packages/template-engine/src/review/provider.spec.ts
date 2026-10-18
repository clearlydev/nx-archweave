import { REVIEW_PROVIDERS } from './provider.ts';

describe('REVIEW_PROVIDERS', () => {
  const providers = Object.values(REVIEW_PROVIDERS);

  it('every provider fills the contract', () => {
    for (const p of providers) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.workflowFileName).toMatch(/^\.github\/workflows\/.+\.yml$/);
      expect(p.requiredSecretName).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(typeof p.buildWorkflowYaml).toBe('function');
    }
  });

  it('workflow file names do not collide across providers', () => {
    const names = providers.map((p) => p.workflowFileName);
    expect(new Set(names).size).toBe(names.length);
  });
});
