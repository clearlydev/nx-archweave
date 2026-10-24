import { DEFAULT_CONFLICT_POLICY } from '@nx-archweave/shared';
import type { ToolkitConfig } from './toolkit-config.ts';

describe('ToolkitConfig', () => {
  it('accepts a fully valid config with review enabled', () => {
    const config: ToolkitConfig = {
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
      aiHosts: ['claude-code'],
      agentRules: { teamRules: true },
      githubTemplates: { issue: true, pr: true, codeowners: true },
      conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
      integrations: { enabled: [] },
      review: {
        enabled: true,
        provider: 'claude',
        mode: 'standard',
        locale: 'ko',
        maxRounds: 3,
        blockingPriorities: ['P0', 'P1'],
      },
    };
    expect(config.review.enabled).toBe(true);
  });

  it('accepts review disabled with no other review fields', () => {
    const config: ToolkitConfig = {
      preset: 'quick-start',
      packageManager: 'npm',
      frontend: 'next',
      backend: 'none',
      locale: 'en',
      fsd: {
        enabled: false,
        enforcement: 'warn',
        layerMapping: { 'react-vite': [], next: [], expo: [], generic: [] },
      },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: false, codeowners: false },
      conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
      integrations: { enabled: [] },
      review: { enabled: false },
    };
    expect(config.review.enabled).toBe(false);
  });

  it('rejects a review object missing provider while enabled is true', () => {
    const config: ToolkitConfig = {
      preset: 'solo',
      packageManager: 'pnpm',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'ko',
      fsd: { enabled: false, enforcement: 'warn', layerMapping: { 'react-vite': [], next: [], expo: [], generic: [] } },
      aiHosts: ['claude-code'],
      agentRules: { teamRules: false },
      githubTemplates: { issue: false, pr: false, codeowners: false },
      conflictPolicy: { default: DEFAULT_CONFLICT_POLICY },
      integrations: { enabled: [] },
      // @ts-expect-error review.enabled: true requires provider (and the rest of ReviewConfigSnippet) — missing provider must not compile
      review: {
        enabled: true,
        mode: 'standard',
        locale: 'ko',
        maxRounds: 3,
        blockingPriorities: ['P0', 'P1'],
      },
    };
    expect(config.preset).toBe('solo');
  });
});
