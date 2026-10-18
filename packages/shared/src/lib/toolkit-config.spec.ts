import { DEFAULT_CONFLICT_POLICY, readFsdEnforcement, type ToolkitConfigBase } from './toolkit-config.ts';

describe('DEFAULT_CONFLICT_POLICY', () => {
  it('is merge-proposal', () => {
    expect(DEFAULT_CONFLICT_POLICY).toBe('merge-proposal');
  });
});

describe('ToolkitConfigBase', () => {
  it('accepts a fully valid review-agnostic config', () => {
    const config: ToolkitConfigBase = {
      preset: 'solo',
      packageManager: 'pnpm',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      fsd: {
        enabled: true,
        enforcement: 'error',
        layerMapping: {
          'react-vite': ['app', 'pages', 'features', 'entities', 'shared'],
          next: ['pages', 'features', 'entities', 'shared'],
        },
      },
      aiHosts: ['claude-code', 'codex'],
      agentRules: {
        teamRules: true,
      },
      githubTemplates: {
        issue: true,
        pr: true,
        codeowners: false,
      },
      conflictPolicy: {
        default: DEFAULT_CONFLICT_POLICY,
      },
      integrations: {
        enabled: [],
      },
    };
    expect(config.preset).toBe('solo');
    expect(config.fsd.layerMapping.next).not.toContain('app');
    expect(config.fsd.enforcement).toBe('error');
    expect(config.agentRules.teamRules).toBe(true);
  });

  it('rejects an unknown enforcement level at compile time', () => {
    const config: ToolkitConfigBase = {
      preset: 'team',
      packageManager: 'pnpm',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'en',
      // @ts-expect-error enforcement is the fixed 'error' | 'warn' union
      fsd: { enabled: true, enforcement: 'off', layerMapping: { 'react-vite': [], next: [] } },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: false, codeowners: false },
      conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
      integrations: { enabled: [] },
    };
    expect(config.preset).toBe('team');
  });

  it('rejects an unknown preset at compile time', () => {
    const config: ToolkitConfigBase = {
      // @ts-expect-error preset is the fixed union — unknown presets must not compile
      preset: 'enterprise',
      packageManager: 'npm',
      frontend: 'next',
      backend: 'none',
      locale: 'en',
      fsd: { enabled: false, enforcement: 'warn', layerMapping: { 'react-vite': [], next: [] } },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: false, codeowners: false },
      conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
      integrations: { enabled: [] },
    };
    expect(config.packageManager).toBe('npm');
  });

  it('rejects an app layer in the next layerMapping at compile time', () => {
    const config: ToolkitConfigBase = {
      preset: 'quick-start',
      packageManager: 'npm',
      frontend: 'next',
      backend: 'none',
      locale: 'en',
      fsd: {
        enabled: true,
        enforcement: 'warn',
        layerMapping: {
          'react-vite': ['app', 'pages', 'features', 'entities', 'shared'],
          // @ts-expect-error next's layerMapping excludes 'app' — Next.js App Router owns that directory
          next: ['app', 'pages', 'features', 'entities', 'shared'],
        },
      },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: false, codeowners: false },
      conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
      integrations: { enabled: [] },
    };
    expect(config.frontend).toBe('next');
  });
});

describe('readFsdEnforcement', () => {
  it('reads enforcement; anything else is undefined', () => {
    expect(readFsdEnforcement({ enforcement: 'warn' })).toBe('warn');
    expect(readFsdEnforcement({ enforcement: 'error' })).toBe('error');
    expect(readFsdEnforcement({ enforcement: 'strict' })).toBeUndefined();
    expect(readFsdEnforcement({})).toBeUndefined();
    expect(readFsdEnforcement(undefined)).toBeUndefined();
  });
});
