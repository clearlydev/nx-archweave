import type { AddFsdLiteReport, SteigerOutcome } from '../add-fsd-lite/render.ts';
import type { AddAgentRulesReport } from '../add-agent-rules/render.ts';
import type { AddGithubTemplatesReport } from '../add-github-templates/render.ts';
import type { AddReviewReport } from '../add-review/render.ts';
import type { AddBackendReport } from '../add-backend/render.ts';
import { leftForYou } from './left-for-you.ts';
import { renderInitReport, type InitReport, type InitSection } from './render.ts';

const BASE: Omit<InitReport, 'sections'> = {
  preset: 'team',
  frontend: 'react-vite',
  backend: 'none',
  packageManager: 'pnpm',
  dryRun: false,
  cleanTree: true,
  refused: false,
};

function fsd(over: Partial<AddFsdLiteReport> = {}): InitSection {
  const report: AddFsdLiteReport = {
    dryRun: false,
    aborted: false,
    appRefusal: null,
    project: 'web',
    sourceRoot: 'apps/web/src',
    enforcement: 'error',
    frontend: 'react-vite',
    eslint: 'applied',
    eslintPath: 'apps/web/eslint.config.mjs',
    snippet: null,
    layerGuide: null,
    steiger: null,
    ...over,
  };
  return { id: 'fsd', enabled: true, report: { kind: 'fsd', report } };
}

function steiger(over: Partial<SteigerOutcome> = {}): SteigerOutcome {
  return {
    configPath: 'steiger.config.ts',
    config: 'created',
    targetPath: 'apps/web/project.json',
    target: 'added',
    dependencies: 'added',
    installCommand: 'pnpm install',
    runCommand: 'pnpm nx run web:fsd-check',
    ...over,
  };
}

function agentRules(files: AddAgentRulesReport['files']): InitSection {
  const report: AddAgentRulesReport = { dryRun: false, locale: 'en', hosts: ['claude-code'], teamRules: true, files, hostsRecord: 'not-requested' };
  return { id: 'agentRules', enabled: true, report: { kind: 'agentRules', report } };
}

function githubTemplates(files: AddGithubTemplatesReport['files']): InitSection {
  return { id: 'githubTemplates', enabled: true, report: { kind: 'githubTemplates', report: { dryRun: false, files } } };
}

function review(over: Partial<AddReviewReport> = {}): InitSection {
  const report: AddReviewReport = {
    dryRun: false,
    workflowPath: '.github/workflows/claude-code-review.yml',
    workflowAction: 'created',
    configAction: 'created',
    requiredSecretName: 'CLAUDE_CODE_OAUTH_TOKEN',
    diff: null,
    workflowYaml: null,
    configSnippetJson: null,
    configError: null,
    dependabot: 'created',
    dependabotProposal: null,
    ...over,
  };
  return { id: 'review', enabled: true, report: { kind: 'review', report } };
}

function backend(over: Partial<AddBackendReport> = {}): InitSection {
  const report: AddBackendReport = {
    backend: 'express',
    apiName: 'api',
    sharedTypes: 'created',
    tags: [],
    workspaceGlob: 'added',
    packageManager: 'pnpm',
    tsconfigPaths: 'added',
    eslint: 'applied',
    sharedTypesPackage: '@demo/shared-types',
    sharedTypesRoot: 'libs/shared-types',
    ...over,
  };
  return { id: 'backend', enabled: true, report: { kind: 'backend', report } };
}

function file(filePath: string, action: AddAgentRulesReport['files'][number]['action'], reason: string | null = null) {
  return { filePath, action, reason, content: null };
}

describe('leftForYou — a clean run leaves nothing', () => {
  it('lists nothing when every section applied what it was asked to', () => {
    const left = leftForYou({
      ...BASE,
      sections: [
        fsd(),
        agentRules([file('CLAUDE.md', 'created')]),
        githubTemplates([{ filePath: '.github/PULL_REQUEST_TEMPLATE.md', action: 'created', content: '' }]),
        review(),
        backend(),
      ],
    });
    expect(left).toEqual({ kept: [], manual: [] });
  });

  it('a snippet-only ESLint outcome is a choice (no --applyEslint), not something left over', () => {
    const left = leftForYou({ ...BASE, sections: [fsd({ eslint: 'snippet-only', snippet: '…' }), backend({ eslint: 'snippet-only', snippet: '…' })] });
    expect(left).toEqual({ kept: [], manual: [] });
  });

  it('an aborted section is not listed here — it fails the run on its own', () => {
    const left = leftForYou({ ...BASE, sections: [fsd({ aborted: true, eslint: 'not-applied' }), review({ workflowAction: 'aborted', configAction: 'aborted' })] });
    expect(left).toEqual({ kept: [], manual: [] });
  });

  it('disabled sections are ignored', () => {
    expect(leftForYou({ ...BASE, sections: [{ id: 'review', enabled: false, report: null, keptFiles: ['x.yml'] }] })).toEqual({ kept: [], manual: [] });
  });
});

describe('leftForYou — skipped to keep your changes', () => {
  it('a hand-edited agent-rules block, with the option that replaces it', () => {
    const { kept, manual } = leftForYou({ ...BASE, sections: [agentRules([file('CLAUDE.md', 'user-modified'), file('AGENTS.md', 'unchanged')])] });
    expect(manual).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('CLAUDE.md');
    expect(kept[0]).toContain('pnpm nx g @clearlydev/nx-archweave:add-agent-rules --overwriteBlock');
  });

  it('an agent-rules file whose markers could not be placed', () => {
    const { kept } = leftForYou({ ...BASE, sections: [agentRules([file('AGENTS.md', 'unrecognized', 'an unclosed start marker')])] });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('AGENTS.md');
    expect(kept[0]).toContain('an unclosed start marker');
  });

  it('a GitHub template that a different file already occupies', () => {
    const { kept } = leftForYou({
      ...BASE,
      sections: [githubTemplates([{ filePath: '.github/PULL_REQUEST_TEMPLATE.md', action: 'skipped', content: '' }])],
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('.github/PULL_REQUEST_TEMPLATE.md');
    expect(kept[0]).toContain('add-github-templates');
  });

  it.each(['proposed', 'skipped'] as const)('a review workflow left as it is (%s), with --onConflict=overwrite', (workflowAction) => {
    const { kept, manual } = leftForYou({ ...BASE, sections: [review({ workflowAction, configAction: 'not-updated' })] });
    expect(manual).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('.github/workflows/claude-code-review.yml');
    expect(kept[0]).toContain('pnpm nx g @clearlydev/nx-archweave:add-review --onConflict=overwrite');
  });

  it("an existing steiger config that init keeps", () => {
    const { kept } = leftForYou({ ...BASE, sections: [fsd({ steiger: steiger({ config: 'kept' }) })] });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('steiger.config.ts');
  });

  it("commands use the workspace's package manager", () => {
    const { kept } = leftForYou({ ...BASE, packageManager: 'npm', sections: [agentRules([file('CLAUDE.md', 'user-modified')])] });
    expect(kept[0]).toContain('npm exec nx -- g @clearlydev/nx-archweave:add-agent-rules --overwriteBlock');
  });
});

describe('leftForYou — needs a manual step', () => {
  it('--applyEslint could not write the FSD rule', () => {
    const { kept, manual } = leftForYou({ ...BASE, sections: [fsd({ eslint: 'degraded-unrecognized', snippet: '…' })] });
    expect(kept).toEqual([]);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toContain('apps/web/eslint.config.mjs');
    expect(manual[0]).toContain('archweave/fsd-boundaries');
  });

  it('--applyEslint found no ESLint config for the app', () => {
    const { manual } = leftForYou({ ...BASE, sections: [fsd({ eslint: 'degraded-unrecognized', eslintPath: null, snippet: '…' })] });
    expect(manual).toHaveLength(1);
    expect(manual[0]).toContain('web');
  });

  it('a review workflow written alongside the existing one', () => {
    const { kept, manual } = leftForYou({
      ...BASE,
      sections: [review({ workflowAction: 'alternate', workflowPath: '.github/workflows/claude-code-review.nx-archweave.yml', configAction: 'not-updated' })],
    });
    expect(kept).toEqual([]);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toContain('.github/workflows/claude-code-review.nx-archweave.yml');
  });

  it("an existing dependabot.yml without a github-actions entry", () => {
    const { manual } = leftForYou({ ...BASE, sections: [review({ dependabot: 'proposed', dependabotProposal: '…' })] });
    expect(manual).toHaveLength(1);
    expect(manual[0]).toContain('.github/dependabot.yml');
  });

  it('the backend: ESLint constraints, tsconfig paths and the workspace list it could not wire', () => {
    const { manual } = leftForYou({
      ...BASE,
      backend: 'express',
      sections: [backend({ eslint: 'degraded-unrecognized', snippet: '…', tsconfigPaths: 'unrecognized', workspaceGlob: 'unrecognized' })],
    });
    expect(manual).toHaveLength(3);
    expect(manual.join('\n')).toContain('tsconfig.base.json');
    expect(manual.join('\n')).toContain('pnpm-workspace.yaml');
    expect(manual.join('\n')).toContain('libs/shared-types');
  });

  it('an integrated layout with no workspace list is not a manual step: the tsconfig paths alias links the lib', () => {
    const { manual } = leftForYou({ ...BASE, backend: 'express', sections: [backend({ workspaceGlob: 'unrecognized', tsconfigPaths: 'added' })] });
    expect(manual).toEqual([]);
  });

  it('a steiger target or devDependencies it could not add', () => {
    const { manual } = leftForYou({ ...BASE, sections: [fsd({ steiger: steiger({ target: 'unrecognized', targetPath: null, dependencies: 'unrecognized' }) })] });
    expect(manual).toHaveLength(2);
  });

  it('a toolkit.config.json init could not record into is not listed: it fails the run', () => {
    const { manual } = leftForYou({ ...BASE, sections: [], config: { action: 'unrecognized', fields: ['fsd.enforcement'], notRecorded: [] } });
    expect(manual).toEqual([]);
  });
});

describe('renderInitReport — the summary at the end of the report', () => {
  it('prints both groups last, kept first', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [agentRules([file('CLAUDE.md', 'user-modified')]), review({ dependabot: 'proposed', dependabotProposal: '…' })],
    });
    const kept = output.indexOf('Skipped to keep your changes:');
    const manual = output.indexOf('Needs a manual step:');
    expect(kept).toBeGreaterThan(-1);
    expect(manual).toBeGreaterThan(kept);
    expect(output.slice(manual)).toContain('.github/dependabot.yml');
    expect(output.trimEnd().endsWith(output.slice(manual).trimEnd())).toBe(true);
  });

  it('prints neither heading when nothing is left', () => {
    const output = renderInitReport({ ...BASE, sections: [fsd(), review()] });
    expect(output).not.toContain('Skipped to keep your changes:');
    expect(output).not.toContain('Needs a manual step:');
  });

  it('a dry run shows the same summary', () => {
    const output = renderInitReport({ ...BASE, dryRun: true, sections: [agentRules([file('CLAUDE.md', 'user-modified')])] });
    expect(output).toContain('Skipped to keep your changes:');
  });
});
