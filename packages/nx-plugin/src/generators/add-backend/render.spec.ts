import { renderAddBackendBody, renderAddBackendReport, type AddBackendReport } from './render.ts';

const WIRED: AddBackendReport = {
  backend: 'express',
  apiName: 'api',
  frontendProject: 'web',
  sharedTypes: 'created',
  sharedTypesPackage: '@my-app/shared-types',
  tags: [
    { project: 'web', action: 'added' },
    { project: 'api', action: 'added' },
    { project: 'shared-types', action: 'added' },
  ],
  tsconfigPaths: 'added',
  eslint: 'applied',
};

describe('renderAddBackendReport', () => {
  it('prints the missing-api refusal with the copy-paste commands', () => {
    const text = renderAddBackendReport(
      {
        backend: 'nest',
        apiName: 'api',
        refused: 'missing-api-project',
        frontendProject: 'web',
        commands: ['pnpm add -D -w @nx/nest', 'pnpm nx g @nx/nest:application api --frontendProject=web'],
        sharedTypes: 'skipped',
        tags: [],
        tsconfigPaths: 'unrecognized',
        eslint: 'snippet-only',
      },
      false,
    );
    expect(text).toContain('Refused: no "api" application project found.');
    expect(text).toContain('pnpm nx g @nx/nest:application api --frontendProject=web');
  });

  it('summarizes a full wiring run', () => {
    const text = renderAddBackendReport(WIRED, false);
    expect(text).toContain('libs/shared-types: created (import it as @my-app/shared-types)');
    expect(text).toContain('cross-side deny rules written');
    expect(text).toContain('tag api: added');
  });

  it('prints the snippet and an untouched notice when the eslint config was not recognized', () => {
    const text = renderAddBackendReport(
      { ...WIRED, eslint: 'degraded-unrecognized', snippet: 'SNIPPET-BODY' },
      false,
    );
    expect(text).toContain('left untouched');
    expect(text).toContain('SNIPPET-BODY');
  });

  it('marks dry runs in the header', () => {
    expect(renderAddBackendReport(WIRED, true)).toContain('— dry run');
  });
});

describe('renderAddBackendBody', () => {
  it('renders the section body without the standalone header (init owns the title)', () => {
    const body = renderAddBackendBody(WIRED);
    expect(body).not.toContain('add-backend (');
    expect(body).toContain('libs/shared-types: created');
  });
});

it('renders the npm install hint when the workspace is npm', () => {
  const text = renderAddBackendReport({ ...WIRED, packageManager: 'npm', workspaceGlob: 'added' }, false);
  expect(text).toContain('run `npm install` once');
});
