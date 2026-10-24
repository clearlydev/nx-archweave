import { renderAddFsdLiteReport, type AddFsdLiteReport } from './render.ts';

function report(overrides: Partial<AddFsdLiteReport> = {}): AddFsdLiteReport {
  return {
    dryRun: false,
    aborted: false,
    appRefusal: null,
    project: 'web',
    sourceRoot: 'apps/web/src',
    enforcement: 'warn',
    frontend: 'react-vite',
    eslint: 'applied',
    eslintPath: 'apps/web/eslint.config.mjs',
    snippet: null,
    layerGuide: '  apps/web/src/features  one slice per capability',
    steiger: null,
    ...overrides,
  };
}

describe('renderAddFsdLiteReport', () => {
  it('names the app, prints the guide, and says where the rule was written', () => {
    const text = renderAddFsdLiteReport(report());
    expect(text).toContain('FSD layers (in web, apps/web/src):');
    expect(text).toContain('apps/web/src/features');
    expect(text).toContain('archweave/fsd-boundaries (warn) written to apps/web/eslint.config.mjs');
    expect(text).not.toContain('created');
  });

  it('report-only and unrecognized outcomes print the snippet and never claim a write', () => {
    const snippetOnly = renderAddFsdLiteReport(report({ eslint: 'snippet-only', snippet: 'SNIPPET' }));
    expect(snippetOnly).toContain('report-only');
    expect(snippetOnly).toContain('--applyEslint');
    expect(snippetOnly).toContain('SNIPPET');
    const unrecognized = renderAddFsdLiteReport(report({ eslint: 'degraded-unrecognized', snippet: 'SNIPPET' }));
    expect(unrecognized).toContain('NOT recognized');
    expect(unrecognized).toContain('SNIPPET');
    const missing = renderAddFsdLiteReport(report({ eslint: 'degraded-unrecognized', eslintPath: null, snippet: 'SNIPPET' }));
    expect(missing).toContain('no ESLint config found for web');
    expect(renderAddFsdLiteReport(report({ eslint: 'already-applied' }))).toContain('already wired');
  });

  it('dry-run says so up front', () => {
    expect(renderAddFsdLiteReport(report({ dryRun: true })).startsWith('add-fsd-lite dry-run')).toBe(true);
  });

  it('the abort branch explains the app refusal and points at --project', () => {
    const ambiguous = renderAddFsdLiteReport(
      report({ aborted: true, project: null, sourceRoot: null, layerGuide: null, eslint: 'not-applied', appRefusal: { reason: 'ambiguous-frontend', candidates: ['admin', 'web'] } }),
    );
    expect(ambiguous).toMatch(/aborted/i);
    expect(ambiguous).toContain('--project');
    expect(ambiguous).toContain('- admin');
    expect(renderAddFsdLiteReport(report({ aborted: true, project: null, eslint: 'not-applied', appRefusal: { reason: 'project-not-found', project: 'nope' } }))).toContain('--project=nope');
    expect(renderAddFsdLiteReport(report({ aborted: true, project: null, eslint: 'not-applied', appRefusal: { reason: 'no-frontend-app', otherProjects: [] } }))).toMatch(/has no projects/);
  });

  it('reports the three steiger writes and the install command', () => {
    const text = renderAddFsdLiteReport(
      report({
        steiger: { configPath: 'apps/web/steiger.config.mjs', config: 'created', targetPath: 'apps/web/package.json', target: 'added', dependencies: 'added', installCommand: 'pnpm install', runCommand: 'pnpm nx run <project>:fsd-check' },
      }),
    );
    expect(text).toContain('apps/web/steiger.config.mjs: created');
    expect(text).toContain('target fsd-check: added to apps/web/package.json');
    expect(text).toContain('run `pnpm install`');
    expect(renderAddFsdLiteReport(report())).not.toContain('steiger');
    expect(
      renderAddFsdLiteReport(report({ steiger: { configPath: 'steiger.config.mjs', config: 'kept', targetPath: null, target: 'unrecognized', dependencies: 'present', installCommand: 'npm install', runCommand: 'npm exec nx -- run <project>:fsd-check' } })),
    ).toMatch(/kept — an existing config/);
  });
});
