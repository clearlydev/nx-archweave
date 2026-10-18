import { createCatalogIntegration, createCatalogIntegrations } from './create-catalog-integration.ts';
import { createFakeCommandRunner } from '../process/read-only-command-runner.ts';
import { PLUGIN_CATALOG, getCatalogEntry, recordMetadataFor, type PluginCatalogEntry } from './plugin-catalog.ts';
import { manualInstallSteps } from '../hosts/claude-code/install.ts';
import { VERSION_DECIDED_BY_MARKETPLACE } from '../hosts/claude-code/plan.ts';

const PONYTAIL = getCatalogEntry('ponytail')!;

describe('createCatalogIntegration (ponytail)', () => {
  it('exposes correct static metadata', () => {
    const runner = createFakeCommandRunner({ stdout: '[]' });
    const integration = createCatalogIntegration(PONYTAIL, { runner });
    expect(integration.id).toBe('ponytail');
    expect(integration.repository).toBe('https://github.com/DietrichGebert/ponytail');
    expect(integration.license).toBe('MIT');
    expect(integration.supportedEnvironments).toEqual(['claude-code']);
  });

  it('wires detect/plan/install/verify/uninstallInstructions as callable functions', () => {
    const runner = createFakeCommandRunner({ stdout: '[]' });
    const integration = createCatalogIntegration(PONYTAIL, { runner });
    expect(typeof integration.detect).toBe('function');
    expect(typeof integration.plan).toBe('function');
    expect(typeof integration.install).toBe('function');
    expect(typeof integration.verify).toBe('function');
    expect(typeof integration.uninstallInstructions).toBe('function');
  });

  it('produces independent objects from separate calls — no shared state between them', async () => {
    const runnerA = createFakeCommandRunner({
      stdout: JSON.stringify([{ id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true }]),
    });
    const runnerB = createFakeCommandRunner({ stdout: '[]' });
    const integrationA = createCatalogIntegration(PONYTAIL, { runner: runnerA });
    const integrationB = createCatalogIntegration(PONYTAIL, { runner: runnerB });

    const resultA = await integrationA.verify({ workspaceRoot: '/does-not-matter', targetEnvironment: 'claude-code' });
    const resultB = await integrationB.verify({ workspaceRoot: '/does-not-matter', targetEnvironment: 'claude-code' });

    expect(resultA.verified).toBe(true);
    expect(resultB.verified).toBe(false);
  });
});

describe('createCatalogIntegration — wiring from the entry', () => {
  it("uninstallInstructions returns the entry's documented steps, the script before the plugin removal", async () => {
    const integration = createCatalogIntegration(PONYTAIL, { runner: createFakeCommandRunner({ stdout: '[]' }) });
    const steps = await integration.uninstallInstructions({ workspaceRoot: '/does-not-matter', targetEnvironment: 'claude-code' });
    expect(steps).toEqual(PONYTAIL.uninstallSteps);
    const scriptStepIndex = steps.findIndex((s) => s.includes('scripts/uninstall.js'));
    const pluginRemoveStepIndex = steps.findIndex((s) => s.toLowerCase().includes('/plugin'));
    expect(scriptStepIndex).toBeGreaterThanOrEqual(0);
    // scripts/uninstall.js must run before the plugin is removed (it is itself
    // a plugin file — removing the plugin first deletes the cleanup script).
    expect(scriptStepIndex).toBeLessThan(pluginRemoveStepIndex);
  });

  it('createCatalogIntegrations builds one integration per catalog entry, in catalog order', () => {
    const all = createCatalogIntegrations({ runner: createFakeCommandRunner({ stdout: '[]' }) });
    expect(all.map((integration) => integration.id)).toEqual(PLUGIN_CATALOG.map((entry) => entry.id));
  });
});

describe('createCatalogIntegration — entries unlike ponytail', () => {
  const base: PluginCatalogEntry = {
    id: 'example',
    displayName: 'example',
    description: 'a synthetic entry',
    homepage: 'https://example.invalid',
    repository: 'https://github.com/example/example',
    license: 'MIT',
    installDocs: 'https://github.com/example/example#install',
    uninstallSteps: ['remove it'],
    hosts: { 'claude-code': { name: 'example', marketplace: 'example/example', pluginId: 'example@example' } },
  };
  const context = { workspaceRoot: '/does-not-matter', targetEnvironment: 'claude-code' };
  const runner = () => createFakeCommandRunner({ stdout: '[]' });

  it('without an npm package: no workspace-dependency signal, and the marketplace decides the version', async () => {
    const integration = createCatalogIntegration(base, { runner: runner() });
    expect(await integration.detect(context)).toEqual({ installed: false, managedBy: 'unknown', evidence: [] });
    expect((await integration.plan({ targetEnvironment: 'claude-code' })).resolvedVersion).toBe(VERSION_DECIDED_BY_MARKETPLACE);
  });

  it('without a Claude Code distribution: no supported host, plan and verify refuse, manual steps point at the docs, nothing to record', async () => {
    const noClaude: PluginCatalogEntry = { ...base, hosts: {} };
    const integration = createCatalogIntegration(noClaude, { runner: runner() });
    expect(integration.supportedEnvironments).toEqual([]);
    await expect(integration.plan({ targetEnvironment: 'claude-code' })).rejects.toThrow(/not supported/);
    await expect(integration.verify(context)).rejects.toThrow(/no Claude Code distribution/);
    expect(manualInstallSteps(noClaude)).toEqual(['See https://github.com/example/example#install for the official instructions.']);
    expect(recordMetadataFor(noClaude)).toBeUndefined();
  });

  it('messages name the entry, not ponytail', async () => {
    const integration = createCatalogIntegration(base, { runner: runner() });
    const result = await integration.verify(context);
    expect(result.problems.join('\n')).toContain('example@example was not found');
    expect(result.problems.join('\n')).toContain('install-integration --tool=example --apply');
    expect(manualInstallSteps(base)[1]).toBe('Then, as a second separate prompt: /plugin install example@example');
  });
});
