import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { addIntegrationGenerator } from './generator.ts';
import { createFakeCommandRunner } from '@nx-archweave/integrations';
import { createIntegrationsCompositionRoot } from '../../runtime/integrations-composition-root.ts';

// Every call injects a fake-runner-backed composition root — never the real
// NodeCommandRunner, so this suite never invokes a real `claude` process.
function fakeRoot(stdout = '[]') {
  return createIntegrationsCompositionRoot({ runner: createFakeCommandRunner({ stdout }) });
}

describe('addIntegrationGenerator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('does not write to the Tree in dry-run mode', async () => {
    const changesBefore = tree.listChanges();
    await addIntegrationGenerator(
      tree,
      { tool: 'ponytail', versionRange: '4.8.4', dryRun: true },
      { integrationsRoot: fakeRoot() },
    );
    expect(tree.listChanges()).toEqual(changesBefore);
  });

  it('does not write to the Tree even when dryRun is omitted (defaults to true)', async () => {
    const changesBefore = tree.listChanges();
    await addIntegrationGenerator(
      tree,
      { tool: 'ponytail', versionRange: '4.8.4' },
      { integrationsRoot: fakeRoot() },
    );
    expect(tree.listChanges()).toEqual(changesBefore);
  });

  it('rejects an unsupported tool with a clear error, before planning', async () => {
    await expect(
      addIntegrationGenerator(
        tree,
        { tool: 'taste-skill' as unknown as 'ponytail' },
        { integrationsRoot: fakeRoot() },
      ),
    ).rejects.toThrow(/unsupported/i);
  });

  it('rejects an unsupported target with a clear error', async () => {
    await expect(
      addIntegrationGenerator(
        tree,
        { tool: 'ponytail', target: 'codex' as unknown as 'claude-code', versionRange: '4.8.4' },
        { integrationsRoot: fakeRoot() },
      ),
    ).rejects.toThrow(/not supported/i);
  });

  it('defaults target to claude-code when omitted', async () => {
    await expect(
      addIntegrationGenerator(
        tree,
        { tool: 'ponytail', versionRange: '4.8.4' },
        { integrationsRoot: fakeRoot() },
      ),
    ).resolves.not.toThrow();
  });

  it('still runs exactly one read-only list call and never the install command (preview only)', async () => {
    const calls: string[][] = [];
    const runner = {
      async run(input: { argv: string[] }) {
        calls.push(input.argv);
        return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false, outputExceeded: false };
      },
    };
    const root = createIntegrationsCompositionRoot({ runner });
    await addIntegrationGenerator(tree, { tool: 'ponytail', versionRange: '4.8.4', scope: 'project' }, { integrationsRoot: root });
    expect(calls).toEqual([['plugin', 'list', '--json']]);
  });

  it('reflects --scope in the previewed command', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });
    await addIntegrationGenerator(tree, { tool: 'ponytail', versionRange: '4.8.4', scope: 'local' }, { integrationsRoot: fakeRoot() });
    spy.mockRestore();
    expect(logs.join('\n')).toContain('--scope local');
  });

  it('previews project scope by default, and carries --scope into the install hint only when it was given', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });
    await addIntegrationGenerator(tree, { tool: 'ponytail', versionRange: '4.8.4' }, { integrationsRoot: fakeRoot() });
    const byDefault = logs.join('\n');
    logs.length = 0;
    await addIntegrationGenerator(tree, { tool: 'ponytail', versionRange: '4.8.4', scope: 'user' }, { integrationsRoot: fakeRoot() });
    const explicitUser = logs.join('\n');
    spy.mockRestore();
    expect(byDefault).toContain('--scope project');
    expect(byDefault).toMatch(/install-integration --tool=ponytail --apply$/m);
    expect(explicitUser).toContain('install-integration --tool=ponytail --apply --scope=user');
  });

  it('produces byte-identical console output for two consecutive dry-runs', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });
    const root = fakeRoot();
    await addIntegrationGenerator(tree, { tool: 'ponytail', versionRange: '4.8.4' }, { integrationsRoot: root });
    const firstRun = logs.join('\n');
    logs.length = 0;
    await addIntegrationGenerator(tree, { tool: 'ponytail', versionRange: '4.8.4' }, { integrationsRoot: root });
    const secondRun = logs.join('\n');
    spy.mockRestore();
    expect(firstRun).toBe(secondRun);
  });
});
