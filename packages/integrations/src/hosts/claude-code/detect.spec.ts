import { detectWorkspacePackage } from './detect.ts';
import { join } from 'node:path';
import { getCatalogEntry } from '../../catalog/plugin-catalog.ts';

const PONYTAIL = getCatalogEntry('ponytail')!;

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/integrations');

describe('detectWorkspacePackage (ponytail)', () => {
  it('reports installed when @dietrichgebert/ponytail is a workspace dependency', async () => {
    const result = await detectWorkspacePackage(PONYTAIL, {
      workspaceRoot: join(FIXTURES, 'ponytail-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.installed).toBe(true);
    expect(result.installedVersion).toBe('4.8.4');
    expect(result.managedBy).toBe('external-tool');
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('reports not installed when the dependency is absent', async () => {
    const result = await detectWorkspacePackage(PONYTAIL, {
      workspaceRoot: join(FIXTURES, 'ponytail-not-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.installed).toBe(false);
    expect(result.installedVersion).toBeUndefined();
    expect(result.managedBy).toBe('unknown');
    expect(result.evidence).toEqual([]);
  });

  it('does not crash on a workspace with no package.json at all', async () => {
    await expect(
      detectWorkspacePackage(PONYTAIL, { workspaceRoot: join(FIXTURES, 'does-not-exist'), targetEnvironment: 'claude-code' }),
    ).resolves.toEqual({ installed: false, managedBy: 'unknown', evidence: [] });
  });
});
