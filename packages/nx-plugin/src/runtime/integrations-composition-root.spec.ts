import { createIntegrationsCompositionRoot } from './integrations-composition-root.ts';
import { createFakeCommandRunner } from '@nx-archweave/integrations';

describe('createIntegrationsCompositionRoot', () => {
  it('wires ponytail with an injected fake runner (never invokes a real process in this test)', () => {
    const runner = createFakeCommandRunner({ stdout: '[]' });
    const root = createIntegrationsCompositionRoot({ runner });
    expect(root.getIntegration('ponytail')?.id).toBe('ponytail');
    expect(root.listIntegrations().map((i) => i.id)).toEqual(['ponytail']);
  });

  it('returns undefined for an unregistered id', () => {
    const runner = createFakeCommandRunner({ stdout: '[]' });
    const root = createIntegrationsCompositionRoot({ runner });
    expect(root.getIntegration('some-unknown-tool')).toBeUndefined();
  });

  it('never contains gajae-code or any future-candidate integration', () => {
    const runner = createFakeCommandRunner({ stdout: '[]' });
    const root = createIntegrationsCompositionRoot({ runner });
    const ids = root.listIntegrations().map((i) => i.id);
    expect(ids).not.toContain('gajae-code');
    expect(ids).toHaveLength(1);
  });

  it('produces an independent registry on each call — no shared state between two roots', async () => {
    const runnerA = createFakeCommandRunner({
      stdout: JSON.stringify([{ id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true }]),
    });
    const runnerB = createFakeCommandRunner({ stdout: '[]' });
    const rootA = createIntegrationsCompositionRoot({ runner: runnerA });
    const rootB = createIntegrationsCompositionRoot({ runner: runnerB });
    const integrationA = rootA.getIntegration('ponytail');
    const integrationB = rootB.getIntegration('ponytail');
    if (!integrationA || !integrationB) {
      throw new Error('ponytail integration not found in the registry — registry wiring is broken');
    }

    const resultA = await integrationA.verify({ workspaceRoot: '/does-not-matter', targetEnvironment: 'claude-code' });
    const resultB = await integrationB.verify({ workspaceRoot: '/does-not-matter', targetEnvironment: 'claude-code' });

    expect(resultA.verified).toBe(true);
    expect(resultB.verified).toBe(false);
  });

  it('defaults to a real NodeCommandRunner when no runner is injected', () => {
    const root = createIntegrationsCompositionRoot();
    expect(root.getIntegration('ponytail')).toBeDefined();
  });
});
