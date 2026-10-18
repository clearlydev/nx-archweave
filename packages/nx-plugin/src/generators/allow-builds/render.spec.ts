import { renderAllowBuildsReport } from './render.ts';

describe('renderAllowBuildsReport', () => {
  it('preview: every package with its previous state, the rebuild, the risk, and the --apply command', () => {
    expect(
      renderAllowBuildsReport({
        packages: ['sharp', '@swc/core', 'esbuild', 'nx', 'unrs-resolver'],
        target: 'allowBuilds',
        changes: [
          { name: 'sharp', previous: 'denied' },
          { name: '@swc/core', previous: 'pending' },
          { name: 'esbuild', previous: 'absent' },
          { name: 'nx', previous: 'allowed' },
          { name: 'unrs-resolver', previous: 'other' },
        ],
        applied: false,
      }),
    ).toBe(
      [
        'allow-builds — preview (nothing written)',
        '',
        'pnpm-workspace.yaml › allowBuilds',
        '  sharp: false → true',
        '  @swc/core: awaiting a decision → true',
        '  esbuild: added (true)',
        '  nx: already true',
        '  unrs-resolver: another value → true',
        '',
        'Then: pnpm rebuild sharp @swc/core esbuild nx unrs-resolver',
        "Allowing a build lets that package's install script run with your user's permissions.",
        '',
        'To apply: pnpm nx g @clearlydev/nx-archweave:allow-builds --packages=sharp,@swc/core,esbuild,nx,unrs-resolver --apply',
      ].join('\n'),
    );
  });

  it('applied, on the pnpm 10 list', () => {
    expect(
      renderAllowBuildsReport({
        packages: ['sharp', 'nx'],
        target: 'onlyBuiltDependencies',
        changes: [
          { name: 'sharp', previous: 'absent' },
          { name: 'nx', previous: 'allowed' },
        ],
        applied: true,
      }),
    ).toBe(
      [
        'allow-builds — applied',
        '',
        'pnpm-workspace.yaml › onlyBuiltDependencies',
        '  sharp: added to the list',
        '  nx: already listed',
        '',
        'Running: pnpm rebuild sharp nx',
      ].join('\n'),
    );
  });

  it('says when the names could not be checked against a lockfile', () => {
    const text = renderAllowBuildsReport({
      packages: ['sharp'],
      target: 'allowBuilds',
      changes: [{ name: 'sharp', previous: 'absent' }],
      applied: false,
      namesUnchecked: true,
    });
    expect(text).toContain('The names were not checked: there is no pnpm-lock.yaml.');
  });

  it('npm workspace', () => {
    const text = renderAllowBuildsReport({ packages: ['sharp'], refused: 'npm' });
    expect(text).toMatch(/^allow-builds — refused \(nothing written\)/);
    expect(text).toMatch(/npm workspace/);
    expect(text).toMatch(/npm install-scripts approve sharp/);
  });

  it('yarn workspace', () => {
    const text = renderAllowBuildsReport({ packages: ['sharp'], refused: 'yarn' });
    expect(text).toMatch(/^allow-builds — refused \(nothing written\)/);
    expect(text).toMatch(/yarn workspace/);
    expect(text).toMatch(/enableScripts: false/);
  });

  it("bun workspace: bun's own list and trust commands, with every package named", () => {
    const text = renderAllowBuildsReport({ packages: ['sharp', '@swc/core'], refused: 'bun' });
    expect(text).toMatch(/^allow-builds — refused \(nothing written\)/);
    expect(text).toMatch(/bun workspace/);
    expect(text).toContain('bun pm untrusted');
    expect(text).toContain('bun pm trust sharp @swc/core');
    expect(text).toContain('trustedDependencies');
  });

  it('no package manager', () => {
    expect(renderAllowBuildsReport({ packages: ['sharp'], refused: 'no-package-manager' })).toMatch(/no pnpm-lock\.yaml or pnpm-workspace\.yaml/);
  });

  it('no pnpm-workspace.yaml: the manual edit and the rebuild', () => {
    const text = renderAllowBuildsReport({ packages: ['sharp', '@swc/core'], refused: 'no-workspace-yaml' });
    expect(text).toMatch(/no pnpm-workspace\.yaml/);
    expect(text).toMatch(/allowBuilds:\n {4}sharp: true\n {4}'@swc\/core': true/);
    expect(text).toMatch(/pnpm rebuild sharp @swc\/core/);
  });

  it('unknown packages are named', () => {
    const text = renderAllowBuildsReport({ packages: ['sharp', 'sharpp'], refused: 'unknown-packages', unknown: ['sharpp'] });
    expect(text).toMatch(/not in pnpm-lock\.yaml: sharpp/);
  });

  it('an unrecognised file shape: the reason, then the manual edit', () => {
    const text = renderAllowBuildsReport({ packages: ['sharp'], refused: 'unrecognized', reason: 'allowBuilds is not a block (found "allowBuilds: true")' });
    expect(text).toMatch(/allowBuilds is not a block/);
    expect(text).toMatch(/allow sharp in pnpm-workspace\.yaml yourself — "<package>: true" under allowBuilds/);
    expect(text).toMatch(/onlyBuiltDependencies on older pnpm 10 — then run "pnpm rebuild sharp"/);
  });
});
