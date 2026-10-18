import { allowPackageBuilds, isPlainPackageName, missingFromLockfile, pnpmMajorFromModulesManifest } from './allow-builds.ts';

const CLI_WORKSPACE = [
  'packages:',
  "  - 'apps/*'",
  '',
  'autoInstallPeers: true',
  'allowBuilds:',
  "  '@parcel/watcher': false",
  "  '@swc/core': false",
  '  nx: true',
  '  sharp: false',
  '  unrs-resolver: false',
  '',
].join('\n');

describe('isPlainPackageName', () => {
  it.each(['sharp', '@swc/core', 'unrs-resolver', 'lodash.merge', '@img/sharp-linux-x64', 'esbuild_x~1'])('accepts %s', (name) => {
    expect(isPlainPackageName(name)).toBe(true);
  });

  it.each(['', '@swc', '@/core', '.hidden', '_private', 'a b', "it's", 'sharp@0.34.0', 'foo@file:../foo', 'x\nallowBuilds:', '../x'])(
    'rejects %j',
    (name) => {
      expect(isPlainPackageName(name)).toBe(false);
    },
  );
});

describe('allowPackageBuilds — an existing allowBuilds block', () => {
  it('flips a denied entry to true in place, keeping key quoting and every other line', () => {
    const result = allowPackageBuilds(CLI_WORKSPACE, ['sharp', '@parcel/watcher']);
    expect(result).toMatchObject({
      status: 'updated',
      target: 'allowBuilds',
      changes: [
        { name: 'sharp', previous: 'denied' },
        { name: '@parcel/watcher', previous: 'denied' },
      ],
    });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(CLI_WORKSPACE.replace('  sharp: false', '  sharp: true').replace("'@parcel/watcher': false", "'@parcel/watcher': true"));
  });

  it('settles a pending placeholder (quoted or not) and keeps a trailing comment', () => {
    const yaml = ['allowBuilds:', '  esbuild: set this to true or false', "  sharp: 'set this to true or false'  # pnpm 11", ''].join('\n');
    const result = allowPackageBuilds(yaml, ['esbuild', 'sharp']);
    expect(result).toMatchObject({
      status: 'updated',
      changes: [
        { name: 'esbuild', previous: 'pending' },
        { name: 'sharp', previous: 'pending' },
      ],
    });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(['allowBuilds:', '  esbuild: true', '  sharp: true # pnpm 11', ''].join('\n'));
  });

  it('matches a double-quoted key and reports any other value as "other"', () => {
    const yaml = ['allowBuilds:', '  "@swc/core": maybe', ''].join('\n');
    const result = allowPackageBuilds(yaml, ['@swc/core']);
    expect(result).toMatchObject({ status: 'updated', changes: [{ name: '@swc/core', previous: 'other' }] });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(['allowBuilds:', '  "@swc/core": true', ''].join('\n'));
  });

  it('appends a missing name at the end of the block, single-quoting a scoped name', () => {
    const result = allowPackageBuilds(CLI_WORKSPACE, ['esbuild', '@img/sharp-linux-x64']);
    expect(result).toMatchObject({
      status: 'updated',
      changes: [
        { name: 'esbuild', previous: 'absent' },
        { name: '@img/sharp-linux-x64', previous: 'absent' },
      ],
    });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(CLI_WORKSPACE.replace('  unrs-resolver: false\n', "  unrs-resolver: false\n  esbuild: true\n  '@img/sharp-linux-x64': true\n"));
  });

  it('appends after the last entry even when a later top-level key, blank lines and column-0 comments follow', () => {
    const yaml = ['allowBuilds:', '  nx: true', '# a note', '  sharp: false', '', 'catalog:', '  react: ^19.0.0', ''].join('\n');
    const result = allowPackageBuilds(yaml, ['sharp', 'esbuild']);
    if (result.status !== 'updated') throw new Error(`expected updated, got ${result.status}`);
    expect(result.text).toBe(
      ['allowBuilds:', '  nx: true', '# a note', '  sharp: true', '  esbuild: true', '', 'catalog:', '  react: ^19.0.0', ''].join('\n'),
    );
  });

  it('uses the indent of the existing entries', () => {
    const yaml = ['allowBuilds:', '    nx: true', ''].join('\n');
    const result = allowPackageBuilds(yaml, ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(['allowBuilds:', '    nx: true', '    sharp: true', ''].join('\n'));
  });

  it('fills an empty block (a bare allowBuilds: key)', () => {
    const result = allowPackageBuilds('allowBuilds:\nautoInstallPeers: true\n', ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe('allowBuilds:\n  sharp: true\nautoInstallPeers: true\n');
  });

  it('turns the empty flow map pnpm keeps for allowBuilds: {} into a block', () => {
    const result = allowPackageBuilds("packages:\n  - 'apps/*'\nallowBuilds: {}\n", ['sharp']);
    expect(result).toMatchObject({ status: 'updated', target: 'allowBuilds', changes: [{ name: 'sharp', previous: 'absent' }] });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe("packages:\n  - 'apps/*'\nallowBuilds:\n  sharp: true\n");
  });

  it('rewrites the one-line flow map pnpm 11 keeps (it had allowBuilds: {}) as a block', () => {
    // the create CLI's own fixture for this form (plan.spec.ts)
    const yaml = "allowBuilds: { core-js-pure: false, nx: true, '@swc/core': false }\n";
    const result = allowPackageBuilds(yaml, ['@swc/core']);
    expect(result).toMatchObject({ status: 'updated', target: 'allowBuilds', changes: [{ name: '@swc/core', previous: 'denied' }] });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe("allowBuilds:\n  core-js-pure: false\n  nx: true\n  '@swc/core': true\n");
  });

  it('leaves a flow map untouched when every name is already allowed', () => {
    expect(allowPackageBuilds('allowBuilds: { nx: true }\n', ['nx'])).toMatchObject({ status: 'unchanged' });
  });

  it("treats a quoted 'true' as a string pnpm does not act on, and rewrites it", () => {
    const result = allowPackageBuilds("allowBuilds:\n  sharp: 'true'\n", ['sharp']);
    expect(result).toMatchObject({ status: 'updated', changes: [{ name: 'sharp', previous: 'other' }] });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe('allowBuilds:\n  sharp: true\n');
  });

  it('accepts a version-specific entry that is already true next to the plain name', () => {
    const result = allowPackageBuilds('allowBuilds:\n  sharp@0.34.5: true\n', ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe('allowBuilds:\n  sharp@0.34.5: true\n  sharp: true\n');
  });

  it('keeps a leading byte-order mark and still finds the key behind it', () => {
    const result = allowPackageBuilds('\uFEFFallowBuilds:\n  sharp: false\n', ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe('\uFEFFallowBuilds:\n  sharp: true\n');
  });

  it('prefers allowBuilds when both keys exist', () => {
    const yaml = ['onlyBuiltDependencies:', '  - nx', 'allowBuilds:', '  sharp: false', ''].join('\n');
    const result = allowPackageBuilds(yaml, ['sharp']);
    expect(result).toMatchObject({ status: 'updated', target: 'allowBuilds' });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(['onlyBuiltDependencies:', '  - nx', 'allowBuilds:', '  sharp: true', ''].join('\n'));
  });

  it('recognises a quoted top-level key, so a second allowBuilds block is never added', () => {
    const result = allowPackageBuilds("'allowBuilds' :\n  sharp: false\n", ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe("'allowBuilds' :\n  sharp: true\n");
  });

  it('accepts keys that hold colons (pnpm 11 file: dependencies) next to the entry it edits', () => {
    const yaml = 'allowBuilds:\n  marker-dep@file:../marker-dep-1.0.0.tgz: set this to true or false\n  sharp: false\n';
    const result = allowPackageBuilds(yaml, ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(yaml.replace('sharp: false', 'sharp: true'));
  });

  it('reports unchanged, with no text, when every name is already allowed', () => {
    expect(allowPackageBuilds(CLI_WORKSPACE, ['nx'])).toEqual({
      status: 'unchanged',
      target: 'allowBuilds',
      changes: [{ name: 'nx', previous: 'allowed' }],
    });
  });

  it('counts each name once', () => {
    const result = allowPackageBuilds(CLI_WORKSPACE, ['sharp', 'sharp']);
    expect(result).toMatchObject({ changes: [{ name: 'sharp', previous: 'denied' }] });
  });

  it('keeps CRLF line endings', () => {
    const result = allowPackageBuilds(CLI_WORKSPACE.replace(/\n/g, '\r\n'), ['sharp', 'esbuild']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(
      CLI_WORKSPACE.replace('  sharp: false', '  sharp: true').replace('  unrs-resolver: false\n', '  unrs-resolver: false\n  esbuild: true\n').replace(/\n/g, '\r\n'),
    );
  });
});

describe('allowPackageBuilds — a pnpm 10 onlyBuiltDependencies list', () => {
  const PNPM10 = ['packages:', "  - 'apps/*'", '', 'autoInstallPeers: true', 'onlyBuiltDependencies:', '  - nx', ''].join('\n');

  it('appends missing names to the list', () => {
    const result = allowPackageBuilds(PNPM10, ['sharp', '@swc/core']);
    expect(result).toMatchObject({
      status: 'updated',
      target: 'onlyBuiltDependencies',
      changes: [
        { name: 'sharp', previous: 'absent' },
        { name: '@swc/core', previous: 'absent' },
      ],
    });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(PNPM10.replace('  - nx\n', "  - nx\n  - sharp\n  - '@swc/core'\n"));
  });

  it('treats a listed (quoted or not) name as allowed', () => {
    const yaml = ['onlyBuiltDependencies:', '  - nx', "  - '@swc/core'", ''].join('\n');
    expect(allowPackageBuilds(yaml, ['nx', '@swc/core'])).toEqual({
      status: 'unchanged',
      target: 'onlyBuiltDependencies',
      changes: [
        { name: 'nx', previous: 'allowed' },
        { name: '@swc/core', previous: 'allowed' },
      ],
    });
  });

  it('rewrites a one-line flow list as a block', () => {
    const result = allowPackageBuilds("onlyBuiltDependencies: [nx, '@swc/core']\n", ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe("onlyBuiltDependencies:\n  - nx\n  - '@swc/core'\n  - sharp\n");
  });

  it('leaves the list alone when allowBuilds is the target', () => {
    const result = allowPackageBuilds('onlyBuiltDependencies: [nx]\nallowBuilds:\n  sharp: false\n', ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe('onlyBuiltDependencies: [nx]\nallowBuilds:\n  sharp: true\n');
  });

  it('adds an allowBuilds block instead when pnpm 11 manages the workspace (it never reads the list)', () => {
    const result = allowPackageBuilds(PNPM10, ['sharp'], { pnpmMajor: 11 });
    expect(result).toMatchObject({ status: 'updated', target: 'allowBuilds', changes: [{ name: 'sharp', previous: 'absent' }] });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(`${PNPM10}allowBuilds:\n  sharp: true\n`);
  });

  it('keeps using the list under pnpm 10', () => {
    expect(allowPackageBuilds(PNPM10, ['sharp'], { pnpmMajor: 10 })).toMatchObject({ target: 'onlyBuiltDependencies' });
  });

  it('turns an empty flow list into a block', () => {
    const result = allowPackageBuilds('onlyBuiltDependencies: []\n', ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe('onlyBuiltDependencies:\n  - sharp\n');
  });
});

describe('allowPackageBuilds — neither key', () => {
  it('appends a new allowBuilds block', () => {
    const result = allowPackageBuilds("packages:\n  - 'apps/*'\n", ['sharp', '@swc/core']);
    expect(result).toMatchObject({ status: 'updated', target: 'allowBuilds', changes: [{ previous: 'absent' }, { previous: 'absent' }] });
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe("packages:\n  - 'apps/*'\nallowBuilds:\n  sharp: true\n  '@swc/core': true\n");
  });

  it('adds the missing final newline first', () => {
    const result = allowPackageBuilds("packages:\n  - 'apps/*'", ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe("packages:\n  - 'apps/*'\nallowBuilds:\n  sharp: true\n");
  });

  it('ignores a commented-out allowBuilds key', () => {
    const yaml = ['# allowBuilds:', '#   sharp: false', 'catalog:', '  react: ^19.0.0', ''].join('\n');
    const result = allowPackageBuilds(yaml, ['sharp']);
    if (result.status !== 'updated') throw new Error('unreachable');
    expect(result.text).toBe(`${yaml}allowBuilds:\n  sharp: true\n`);
  });
});

describe('allowPackageBuilds — shapes it does not recognise are never written', () => {
  it.each([
    ['a flow allowBuilds with nesting', 'allowBuilds: { sharp: { x: 1 } }\n'],
    ['a flow list under allowBuilds', 'allowBuilds: [sharp]\n'],
    ['a flow allowBuilds followed by a comment holding a brace', 'allowBuilds: { a: true } # note }\n'],
    ['a scalar allowBuilds', 'allowBuilds: true\n'],
    ['allowBuilds listing the package twice', 'allowBuilds:\n  sharp: false\n  sharp: false\n'],
    ['a version-specific deny pnpm 11 lets win over an allow', 'allowBuilds:\n  sharp@0.34.5: false\n'],
    ['allowBuilds nested under another key (a new block would sit beside it)', 'catalog:\n  allowBuilds: x\n'],
    ['an explicit ? allowBuilds key', 'packages:\n  - x\n? allowBuilds\n: {}\n'],
    ['an indented root mapping', '  packages:\n    - x\n  allowBuilds:\n    sharp: false\n'],
    ['a flow root mapping', "{packages: ['apps/*'], allowBuilds: {sharp: false}}\n"],
    ['document markers', 'packages:\n  - x\n...\n'],
    ['a map item under onlyBuiltDependencies', 'onlyBuiltDependencies:\n  - name: nx\n'],
    ['a repeated allowBuilds key', 'allowBuilds:\n  nx: true\nallowBuilds:\n  sharp: false\n'],
    ['a list under allowBuilds', 'allowBuilds:\n  - sharp\n'],
    ['nested values under allowBuilds', 'allowBuilds:\n  sharp:\n    enabled: false\n'],
    ['mixed indentation under allowBuilds', 'allowBuilds:\n  nx: true\n    sharp: false\n'],
    ['a flow onlyBuiltDependencies with nesting', 'onlyBuiltDependencies: [[nx]]\n'],
    ['a column-0 list under onlyBuiltDependencies', 'onlyBuiltDependencies:\n- nx\n'],
    ['a map under onlyBuiltDependencies', 'onlyBuiltDependencies:\n  nx: true\n'],
    ['a repeated onlyBuiltDependencies key', 'onlyBuiltDependencies:\n  - nx\nonlyBuiltDependencies:\n  - esbuild\n'],
  ])('%s', (_label, yaml) => {
    const result = allowPackageBuilds(yaml, ['sharp']);
    expect(result.status).toBe('unrecognized');
    expect(result).not.toHaveProperty('text');
    if (result.status === 'unrecognized') expect(result.reason).toMatch(/allowBuilds|onlyBuiltDependencies|file/);
  });
});

describe('pnpmMajorFromModulesManifest', () => {
  it('reads pnpm 10 (YAML) and pnpm 11 (JSON) node_modules/.modules.yaml', () => {
    expect(pnpmMajorFromModulesManifest('layoutVersion: 5\nnodeLinker: isolated\npackageManager: pnpm@10.28.0\n')).toBe(10);
    expect(pnpmMajorFromModulesManifest('{\n  "nodeLinker": "isolated",\n  "packageManager": "pnpm@11.9.0",\n  "layoutVersion": 5\n}\n')).toBe(11);
  });

  it('is undefined when the file does not say', () => {
    expect(pnpmMajorFromModulesManifest('layoutVersion: 5\n')).toBeUndefined();
    expect(pnpmMajorFromModulesManifest('packageManager: npm@11.0.0\n')).toBeUndefined();
  });
});

describe('missingFromLockfile', () => {
  const LOCK = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    '      esbuild:',
    '        specifier: ^0.25.0',
    '',
    'packages:',
    '',
    "  '@swc/core@1.15.8':",
    '    resolution: {integrity: sha512-x}',
    '',
    '  sharp@0.34.5:',
    '    resolution: {integrity: sha512-y}',
    '',
    'snapshots:',
    '',
    '  sharp@0.34.5: {}',
    '',
  ].join('\n');

  it('finds plain and scoped package keys', () => {
    expect(missingFromLockfile(LOCK, ['sharp', '@swc/core'])).toEqual([]);
  });

  it('returns the names with no package entry — an importer specifier alone does not count', () => {
    expect(missingFromLockfile(LOCK, ['sharpp', 'esbuild', '@swc/cor', 'sharp'])).toEqual(['sharpp', 'esbuild', '@swc/cor']);
  });

  it('ignores overrides: keys (an override is not an installed package)', () => {
    const lock = `${LOCK.replace('importers:', "overrides:\n  left-pad@<2: ^2.0.0\n\nimporters:")}`;
    expect(missingFromLockfile(lock, ['left-pad'])).toEqual(['left-pad']);
  });

  it('does not take a name for a longer one that starts with it', () => {
    expect(missingFromLockfile(LOCK, ['shar'])).toEqual(['shar']);
  });
});
