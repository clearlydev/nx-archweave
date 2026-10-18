import { listIntegrations, getIntegration, createIntegrationRegistry } from './integration-registry.ts';
import type { ToolIntegration } from '../contracts/integration.ts';

function stubIntegration(id: string): ToolIntegration {
  return {
    id,
    displayName: id,
    homepage: 'https://example.com',
    repository: 'example/example',
    license: 'MIT',
    supportedEnvironments: ['claude-code'],
    detect: async () => ({ installed: false, managedBy: 'unknown', evidence: [] }),
    plan: async () => ({
      officialCommand: null,
      resolvedVersion: '0.0.0',
      filesCreated: [],
      filesModified: [],
      conflicts: [],
      sourceRepository: 'example/example',
      officialHomepage: 'https://example.com',
      license: 'MIT',
      requiresManualExecution: true,
    }),
    install: async () => ({
      executed: false,
      partialFailure: false,
      filesCreated: [],
      filesModified: [],
      manualStepsRemaining: [],
    }),
    verify: async () => ({ verified: false, problems: [] }),
    uninstallInstructions: async () => [],
  };
}

describe('createIntegrationRegistry', () => {
  it('accepts a list of integrations with unique ids', () => {
    const registry = createIntegrationRegistry([stubIntegration('a'), stubIntegration('b')]);
    expect(registry.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('throws when two integrations share the same id', () => {
    expect(() => createIntegrationRegistry([stubIntegration('a'), stubIntegration('a')])).toThrow(
      /duplicate integration id/i,
    );
  });

  it('accepts an empty list', () => {
    expect(createIntegrationRegistry([])).toEqual([]);
  });
});

describe('listIntegrations / getIntegration — pure functions over a caller-supplied registry', () => {
  it('lists exactly the integrations passed in', () => {
    const registry = createIntegrationRegistry([stubIntegration('ponytail')]);
    expect(listIntegrations(registry).map((i) => i.id)).toEqual(['ponytail']);
  });

  it('resolves an integration by id', () => {
    const registry = createIntegrationRegistry([stubIntegration('ponytail')]);
    expect(getIntegration(registry, 'ponytail')?.id).toBe('ponytail');
  });

  it('returns undefined for an unregistered id', () => {
    const registry = createIntegrationRegistry([stubIntegration('ponytail')]);
    expect(getIntegration(registry, 'some-unknown-tool')).toBeUndefined();
  });

  it('never contains gajae-code (reference-only, never adapted)', () => {
    const registry = createIntegrationRegistry([stubIntegration('ponytail')]);
    expect(listIntegrations(registry).map((i) => i.id)).not.toContain('gajae-code');
  });
});
