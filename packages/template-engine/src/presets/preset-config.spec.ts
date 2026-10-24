import { buildPresetConfig } from './preset-config.ts';
import type { ToolkitConfig } from '../toolkit-config.ts';

describe('buildPresetConfig', () => {
  it('quick-start: fsd on, review opt-in defaulting OFF with fast mode, minimal templates, agent rules for the default host', () => {
    const config = buildPresetConfig({
      preset: 'quick-start',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      packageManager: 'pnpm',
    });

    const expected: ToolkitConfig = {
      preset: 'quick-start',
      packageManager: 'pnpm',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      fsd: {
        enabled: true,
        enforcement: 'warn',
        layerMapping: {
          'react-vite': ['app', 'pages', 'features', 'entities', 'shared'],
          next: ['pages', 'features', 'entities', 'shared'],
          expo: ['app', 'pages', 'features', 'entities', 'shared'],
          generic: ['app', 'pages', 'features', 'entities', 'shared'],
        },
      },
      review: { enabled: false },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: true, codeowners: false },
      conflictPolicy: { default: 'merge-proposal' },
      integrations: { enabled: [] },
    };

    expect(config).toEqual(expected);
  });

  it('solo: fsd on, review ON by default in fast mode, agent rules, PR-only templates', () => {
    const config = buildPresetConfig({
      preset: 'solo',
      frontend: 'next',
      backend: 'none',
      locale: 'en',
      packageManager: 'npm',
    });

    const expected: ToolkitConfig = {
      preset: 'solo',
      packageManager: 'npm',
      frontend: 'next',
      backend: 'none',
      locale: 'en',
      fsd: {
        enabled: true,
        enforcement: 'warn',
        layerMapping: {
          'react-vite': ['app', 'pages', 'features', 'entities', 'shared'],
          next: ['pages', 'features', 'entities', 'shared'],
          expo: ['app', 'pages', 'features', 'entities', 'shared'],
          generic: ['app', 'pages', 'features', 'entities', 'shared'],
        },
      },
      review: {
        enabled: true,
        provider: 'claude',
        mode: 'fast',
        locale: 'en',
        maxRounds: 3,
        blockingPriorities: ['P0', 'P1'],
      },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: true, codeowners: false },
      conflictPolicy: { default: 'merge-proposal' },
      integrations: { enabled: [] },
    };

    expect(config).toEqual(expected);
  });

  it('team: fsd on with error-level enforcement, review ON by default in standard mode, team rules section, issue+pr templates (codeowners opt-in)', () => {
    const config = buildPresetConfig({
      preset: 'team',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      packageManager: 'pnpm',
    });

    const expected: ToolkitConfig = {
      preset: 'team',
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
          expo: ['app', 'pages', 'features', 'entities', 'shared'],
          generic: ['app', 'pages', 'features', 'entities', 'shared'],
        },
      },
      review: {
        enabled: true,
        provider: 'claude',
        mode: 'standard',
        locale: 'ko',
        maxRounds: 3,
        blockingPriorities: ['P0', 'P1'],
      },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: true },
      githubTemplates: { issue: true, pr: true, codeowners: false },
      conflictPolicy: { default: 'merge-proposal' },
      integrations: { enabled: [] },
    };

    expect(config).toEqual(expected);
  });

  it('explicit reviewEnabled: false overrides team default-on', () => {
    const config = buildPresetConfig({
      preset: 'team',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      packageManager: 'pnpm',
      reviewEnabled: false,
    });

    expect(config.review).toEqual({ enabled: false });
  });

  it('explicit reviewEnabled: true overrides quick-start default-off', () => {
    const config = buildPresetConfig({
      preset: 'quick-start',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      packageManager: 'pnpm',
      reviewEnabled: true,
    });

    expect(config.review).toEqual({
      enabled: true,
      provider: 'claude',
      mode: 'fast', // mode still follows the preset default — only enablement was overridden.
      locale: 'ko',
      maxRounds: 3,
      blockingPriorities: ['P0', 'P1'],
    });
  });

  it('invariant: blockingPriorities is always [P0, P1] and maxRounds is always 3, regardless of preset', () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      const config = buildPresetConfig({
        preset,
        frontend: 'react-vite',
        backend: 'none',
        locale: 'ko',
        packageManager: 'pnpm',
        reviewEnabled: true,
      });
      expect(config.review).toMatchObject({
        blockingPriorities: ['P0', 'P1'],
        maxRounds: 3,
      });
    }
  });

  it('frontend layerMapping: react-vite always includes app, next never does — independent of preset', () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      const config = buildPresetConfig({
        preset,
        frontend: 'next',
        backend: 'none',
        locale: 'en',
        packageManager: 'npm',
      });
      expect(config.fsd.layerMapping['react-vite']).toContain('app');
      expect(config.fsd.layerMapping.next).not.toContain('app');
      expect(config.fsd.layerMapping.next).toEqual(['pages', 'features', 'entities', 'shared']);
    }
  });

  it('team preset: only team gets error-level enforcement and the team rules section', () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      const config = buildPresetConfig({
        preset,
        frontend: 'react-vite',
        backend: 'none',
        locale: 'en',
        packageManager: 'pnpm',
      });
      expect(config.fsd.enforcement).toBe(preset === 'team' ? 'error' : 'warn');
      expect(config.agentRules.teamRules).toBe(preset === 'team');
    }
  });

  it('conflictPolicy.default is merge-proposal for every preset', () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      const config = buildPresetConfig({
        preset,
        frontend: 'react-vite',
        backend: 'none',
        locale: 'ko',
        packageManager: 'pnpm',
      });
      expect(config.conflictPolicy).toEqual({ default: 'merge-proposal' });
    }
  });

  it('integrations.enabled is always empty — no preset auto-installs external integrations', () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      const config = buildPresetConfig({
        preset,
        frontend: 'react-vite',
        backend: 'none',
        locale: 'ko',
        packageManager: 'pnpm',
      });
      expect(config.integrations).toEqual({ enabled: [] });
    }
  });

  it('compiles as a full ToolkitConfig (type-level check)', () => {
    const config: ToolkitConfig = buildPresetConfig({
      preset: 'team',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      packageManager: 'pnpm',
    });
    expect(config satisfies ToolkitConfig).toBeTruthy();
  });
});

describe('buildPresetConfig — backend passthrough', () => {
  it('passes backend through unmapped for every preset and every backend value', () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      for (const backend of ['express', 'nest', 'none'] as const) {
        const config = buildPresetConfig({ preset, frontend: 'react-vite', backend, locale: 'en', packageManager: 'pnpm' });
        expect(config.backend).toBe(backend);
        expect(config.frontend).toBe('react-vite');
      }
    }
  });
});

describe('buildPresetConfig — AI hosts', () => {
  const base = { preset: 'solo', frontend: 'react-vite', backend: 'none', locale: 'en', packageManager: 'pnpm' } as const;

  it('keeps the hosts in the order picked, and the first one sets the review provider', () => {
    const config = buildPresetConfig({ ...base, aiHosts: ['gemini-cli', 'claude-code'] });
    expect(config.aiHosts).toEqual(['gemini-cli', 'claude-code']);
    expect(config.review).toMatchObject({ enabled: true, provider: 'gemini' });
  });

  it('no hosts (or an empty list) means the default host, Claude Code, with the claude provider', () => {
    for (const aiHosts of [undefined, []]) {
      const config = buildPresetConfig({ ...base, aiHosts });
      expect(config.aiHosts).toEqual(['claude-code']);
      expect(config.review).toMatchObject({ provider: 'claude' });
    }
  });
});

describe('buildPresetConfig — reviewProvider', () => {
  it('an explicit provider beats the first AI host\'s', () => {
    const base = { preset: 'solo', frontend: 'next', backend: 'none', locale: 'en', packageManager: 'pnpm', aiHosts: ['codex'] } as const;
    expect(buildPresetConfig({ ...base, aiHosts: ['codex'] }).review).toMatchObject({ provider: 'gpt' });
    expect(buildPresetConfig({ ...base, aiHosts: ['codex'], reviewProvider: 'cursor' }).review).toMatchObject({ provider: 'cursor' });
  });
});

describe('buildPresetConfig — layerMapping comes from the framework profiles', () => {
  it('has a list for every frontend nx-archweave knows, taken from its profile', () => {
    const config = buildPresetConfig({ preset: 'solo', frontend: 'react-vite', backend: 'none', locale: 'en', packageManager: 'pnpm' });
    expect(Object.keys(config.fsd.layerMapping).sort()).toEqual(['expo', 'generic', 'next', 'react-vite']);
    expect(config.fsd.layerMapping.expo).toEqual(['app', 'pages', 'features', 'entities', 'shared']);
    expect(config.fsd.layerMapping.next).toEqual(['pages', 'features', 'entities', 'shared']);
  });
});
