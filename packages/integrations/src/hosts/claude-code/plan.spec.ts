import { createClaudeMarketplacePlan, VERSION_DECIDED_BY_MARKETPLACE } from './plan.ts';
import { getCatalogEntry } from '../../catalog/plugin-catalog.ts';

const PONYTAIL = getCatalogEntry('ponytail')!;

describe('createClaudeMarketplacePlan (ponytail)', () => {
  const fakeResolveVersion = async () => '4.8.4';

  it('returns the scriptable claude CLI install command for claude-code', async () => {
    const plan = createClaudeMarketplacePlan(PONYTAIL, { resolveVersion: fakeResolveVersion });
    const result = await plan({ targetEnvironment: 'claude-code' });
    expect(result.officialCommand).toEqual({
      executable: 'claude',
      args: ['plugin', 'install', 'ponytail', '--marketplace', 'DietrichGebert/ponytail', '--scope', 'project', '--json'],
    });
    expect(result.requiresManualExecution).toBe(false);
    expect(result.resolvedVersion).toBe('4.8.4');
    expect(result.sourceRepository).toBe('https://github.com/DietrichGebert/ponytail');
    expect(result.officialHomepage).toBe('https://ponytail.dev');
    expect(result.license).toBe('MIT');
    expect(result.filesCreated).toEqual([]);
    // the default project scope: Claude Code records it in the workspace's own settings
    expect(result.filesModified).toEqual(['.claude/settings.json']);
    expect(result.conflicts).toEqual([]);
  });

  it('uses the resolver only when no versionRange is given', async () => {
    let calls = 0;
    const plan = createClaudeMarketplacePlan(PONYTAIL, {
      resolveVersion: async () => {
        calls += 1;
        return '4.8.4';
      },
    });
    await plan({ targetEnvironment: 'claude-code' });
    expect(calls).toBe(1);
  });

  it('uses an explicit versionRange verbatim without calling the resolver', async () => {
    let calls = 0;
    const plan = createClaudeMarketplacePlan(PONYTAIL, {
      resolveVersion: async () => {
        calls += 1;
        return '4.8.4';
      },
    });
    const result = await plan({ targetEnvironment: 'claude-code', versionRange: '4.7.0' });
    expect(result.resolvedVersion).toBe('4.7.0');
    expect(calls).toBe(0);
  });

  it('reflects an explicit scope in the command and defaults to project', async () => {
    const plan = createClaudeMarketplacePlan(PONYTAIL, { resolveVersion: fakeResolveVersion });
    const byDefault = await plan({ targetEnvironment: 'claude-code' });
    expect(byDefault.officialCommand?.args.slice(-3)).toEqual(['--scope', 'project', '--json']);
    const user = await plan({ targetEnvironment: 'claude-code', scope: 'user' });
    expect(user.officialCommand?.args).toContain('user');
    expect(user.officialCommand?.args).not.toContain('project');
    const local = await plan({ targetEnvironment: 'claude-code', scope: 'local' });
    expect(local.officialCommand?.args.slice(-3)).toEqual(['--scope', 'local', '--json']);
  });

  it('never passes -y / --yes / --accept-command — marketplace-declared commands are a person\'s call', async () => {
    const plan = createClaudeMarketplacePlan(PONYTAIL, { resolveVersion: fakeResolveVersion });
    const result = await plan({ targetEnvironment: 'claude-code' });
    for (const flag of ['-y', '--yes', '--accept-command']) {
      expect(result.officialCommand?.args).not.toContain(flag);
    }
  });

  it('lists the workspace settings file Claude Code changes for project/local scope, nothing for user scope', async () => {
    const plan = createClaudeMarketplacePlan(PONYTAIL, { resolveVersion: fakeResolveVersion });
    expect((await plan({ targetEnvironment: 'claude-code', scope: 'user' })).filesModified).toEqual([]);
    expect((await plan({ targetEnvironment: 'claude-code', scope: 'project' })).filesModified).toEqual(['.claude/settings.json']);
    expect((await plan({ targetEnvironment: 'claude-code', scope: 'local' })).filesModified).toEqual(['.claude/settings.local.json']);
  });

  it('resolveLatestVersion: false never calls the registry and says the marketplace decides', async () => {
    let calls = 0;
    const plan = createClaudeMarketplacePlan(PONYTAIL, {
      resolveVersion: async () => {
        calls += 1;
        return '9.9.9';
      },
    });
    const result = await plan({ targetEnvironment: 'claude-code', resolveLatestVersion: false });
    expect(calls).toBe(0);
    expect(result.resolvedVersion).toBe(VERSION_DECIDED_BY_MARKETPLACE);
    const pinned = await plan({ targetEnvironment: 'claude-code', resolveLatestVersion: false, versionRange: '4.7.0' });
    expect(pinned.resolvedVersion).toBe('4.7.0');
  });

  it('rejects an unsupported target environment instead of guessing a command', async () => {
    const plan = createClaudeMarketplacePlan(PONYTAIL, { resolveVersion: fakeResolveVersion });
    await expect(plan({ targetEnvironment: 'some-untested-host' })).rejects.toThrow(/not supported/i);
  });
});
