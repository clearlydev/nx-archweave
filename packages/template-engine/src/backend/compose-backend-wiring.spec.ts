import { addSharedTypesNpmWorkspace, addSharedTypesWorkspaceGlob, composeBackendWiring } from './compose-backend-wiring.ts';

describe('composeBackendWiring', () => {
  it('produces the three shared-types files as a package.json workspace project', () => {
    const wiring = composeBackendWiring({ workspaceName: 'my-app' });
    expect(wiring.sharedTypesFiles.map((f) => f.filePath)).toEqual([
      'libs/shared-types/package.json',
      'libs/shared-types/src/index.ts',
      'libs/shared-types/src/lib/api-types.ts',
    ]);
    const pkg = JSON.parse(wiring.sharedTypesFiles[0].content);
    expect(pkg.nx.tags).toEqual(['scope:shared']);
    expect(pkg.exports['.'].import).toBe('./src/index.ts');
  });

  it('derives the package name from a bare workspace name', () => {
    expect(composeBackendWiring({ workspaceName: 'my-app' }).sharedTypesPackageName).toBe('@my-app/shared-types');
  });

  it('keeps the scope of a scoped workspace name (fullstack template reality)', () => {
    expect(composeBackendWiring({ workspaceName: '@org/source' }).sharedTypesPackageName).toBe('@org/shared-types');
  });

  it('exposes the role→tag mapping the wiring applies', () => {
    expect(composeBackendWiring({ workspaceName: 'x' }).tagByRole).toEqual({
      frontend: 'scope:frontend',
      backend: 'scope:backend',
      shared: 'scope:shared',
    });
  });
});

describe('addSharedTypesWorkspaceGlob', () => {
  const templateYaml = `packages:\n  - 'apps/*'\n  - 'packages/api/products'\n  - 'packages/shared/*'\n`;

  it('appends libs/shared-types after the last packages entry, preserving indent', () => {
    const result = addSharedTypesWorkspaceGlob(templateYaml);
    expect(result.status).toBe('added');
    if (result.status === 'added') {
      expect(result.text).toContain("  - 'packages/shared/*'\n  - 'libs/shared-types'");
    }
  });

  it('is idempotent — an existing libs glob reports present', () => {
    expect(addSharedTypesWorkspaceGlob(`packages:\n  - 'apps/*'\n  - 'libs/shared-types'\n`).status).toBe('present');
    expect(addSharedTypesWorkspaceGlob(`packages:\n  - 'libs/*'\n`).status).toBe('present');
  });

  it('never touches an unrecognized yaml shape', () => {
    expect(addSharedTypesWorkspaceGlob('packages: ["apps/*"]\n').status).toBe('unrecognized');
    expect(addSharedTypesWorkspaceGlob('catalog:\n  foo: 1\n').status).toBe('unrecognized');
  });
});

describe('addSharedTypesNpmWorkspace', () => {
  it('appends to an existing workspaces array, preserving indent', () => {
    const result = addSharedTypesNpmWorkspace('{\n  "name": "x",\n  "workspaces": ["apps/*"]\n}\n');
    expect(result.status).toBe('added');
    if (result.status === 'added') {
      expect(JSON.parse(result.text).workspaces).toEqual(['apps/*', 'libs/shared-types']);
      expect(result.text).toContain('\n  "workspaces"');
    }
  });

  it('supports the object form ({"packages": [...]}) without flattening it', () => {
    const result = addSharedTypesNpmWorkspace('{\n  "workspaces": { "packages": ["apps/*"] }\n}\n');
    expect(result.status).toBe('added');
    if (result.status === 'added') {
      expect(JSON.parse(result.text).workspaces.packages).toEqual(['apps/*', 'libs/shared-types']);
    }
  });

  it('creates the array when the field is absent', () => {
    const result = addSharedTypesNpmWorkspace('{\n  "name": "x"\n}\n');
    expect(result.status).toBe('added');
    if (result.status === 'added') expect(JSON.parse(result.text).workspaces).toEqual(['libs/shared-types']);
  });

  it('is idempotent (libs/shared-types or libs/* already covered → present)', () => {
    expect(addSharedTypesNpmWorkspace('{"workspaces":["libs/*"]}').status).toBe('present');
    expect(addSharedTypesNpmWorkspace('{"workspaces":["libs/shared-types"]}').status).toBe('present');
  });

  it('never touches unrecognized shapes (non-object json, workspaces: string)', () => {
    expect(addSharedTypesNpmWorkspace('null').status).toBe('unrecognized');
    expect(addSharedTypesNpmWorkspace('{"workspaces":"apps/*"}').status).toBe('unrecognized');
    expect(addSharedTypesNpmWorkspace('{nope').status).toBe('unrecognized');
  });
});

it('indent inference ignores blank lines before the first key', () => {
  const result = addSharedTypesNpmWorkspace('{\n\n  "name": "x"\n}\n');
  expect(result.status).toBe('added');
  if (result.status === 'added') {
    expect(result.text).toContain('\n  "workspaces"');
    expect(result.text).not.toContain('\n\n  "workspaces"');
  }
});

describe('addSharedTypesNpmWorkspace — line-surgical write', () => {
  const added = (text: string): string => {
    const result = addSharedTypesNpmWorkspace(text);
    if (result.status !== 'added') throw new Error(result.status);
    return result.text;
  };

  it('a one-entry-per-line array gets exactly one new line; every other byte stays', () => {
    const before = '{\n  "name": "@acme/source",\n  "scripts": {"build": "nx run-many -t build"},\n  "workspaces": [\n    "apps/*",\n    "packages/*"\n  ],\n  "devDependencies": {\n    "nx": "23.2.0"\n  }\n}\n';
    expect(added(before)).toBe(before.replace('    "packages/*"\n', '    "packages/*",\n    "libs/shared-types"\n'));
  });

  it('an inline array stays inline', () => {
    expect(added('{"name":"x","workspaces":["apps/*", "packages/*"],"private":true}')).toBe(
      '{"name":"x","workspaces":["apps/*", "packages/*", "libs/shared-types"],"private":true}',
    );
    expect(added('{"workspaces":[]}')).toBe('{"workspaces":["libs/shared-types"]}');
  });

  it('the object form gets the entry in its packages array only', () => {
    const before = '{\n  "workspaces": {\n    "packages": [\n      "apps/*"\n    ],\n    "nohoist": ["**/react"]\n  }\n}\n';
    expect(added(before)).toBe(before.replace('      "apps/*"\n', '      "apps/*",\n      "libs/shared-types"\n'));
  });

  it('an absent field becomes the last root key; CRLF line endings survive', () => {
    expect(added('{\r\n  "name": "x",\r\n  "private": true\r\n}\r\n')).toBe(
      '{\r\n  "name": "x",\r\n  "private": true,\r\n  "workspaces": ["libs/shared-types"]\r\n}\r\n',
    );
    expect(added('{}')).toBe('{\n  "workspaces": ["libs/shared-types"]\n}');
  });

  it('keys and strings that only look like the target are not confused with it', () => {
    const before = '{\n  "description": "has \\"workspaces\\": [ in it",\n  "workspaces": [\n    "apps/*"\n  ]\n}\n';
    const after = added(before);
    expect(JSON.parse(after).description).toBe('has "workspaces": [ in it');
    expect(JSON.parse(after).workspaces).toEqual(['apps/*', 'libs/shared-types']);
  });
});
