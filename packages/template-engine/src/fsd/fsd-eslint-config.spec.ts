import { applyFsdEslintConfig, classifyFsdEslintConfig, composeFsdLayerGuide, fsdLayerDirName, fsdLayersFor } from './fsd-eslint-config.ts';
import { profileById } from '../frameworks/profiles.ts';

// Nx 23's React app config, verbatim shape.
const REACT_APP_CONFIG = `import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
];
`;

// Nx 23's Next.js app config: a plugin entry BEFORE the base config, ignores last.
const NEXT_APP_CONFIG = `import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  { plugins: { '@next/next': nextEslintPluginNext } },
  ...nx.configs['flat/react-typescript'],
  ...baseConfig,
  {
    ignores: ['.next/**/*', '**/out-tsc'],
  },
];
`;

describe('applyFsdEslintConfig', () => {
  it("adds the import after the last import and the entry as the array's last element — React template", () => {
    const result = applyFsdEslintConfig(REACT_APP_CONFIG, 'error');
    if (result.status !== 'applied') throw new Error(result.status);
    expect(result.text).toBe(`import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';
import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  ...fsdBoundaries({ severity: 'error', cwd: import.meta.dirname, root: 'src' }),
];
`);
    expect(classifyFsdEslintConfig(result.text)).toBe('applied');
  });

  it('Next.js template: same insertion, severity warn', () => {
    const result = applyFsdEslintConfig(NEXT_APP_CONFIG, 'warn');
    if (result.status !== 'applied') throw new Error(result.status);
    expect(result.text).toContain("import baseConfig from '../../eslint.config.mjs';\nimport { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\n");
    expect(result.text.trimEnd().endsWith("  ...fsdBoundaries({ severity: 'warn', cwd: import.meta.dirname, root: 'src' }),\n];")).toBe(true);
  });

  it('is idempotent: an applied config is already-applied, never doubled', () => {
    const once = applyFsdEslintConfig(REACT_APP_CONFIG, 'error');
    if (once.status !== 'applied') throw new Error(once.status);
    expect(applyFsdEslintConfig(once.text, 'error')).toEqual({ status: 'already-applied' });
  });

  it('a config whose last element lacks a trailing comma gets one', () => {
    const text = "export default [\n  ...baseConfig\n];\n";
    const result = applyFsdEslintConfig(text, 'error');
    if (result.status !== 'applied') throw new Error(result.status);
    expect(result.text).toBe("import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\n\nexport default [\n  ...baseConfig,\n  ...fsdBoundaries({ severity: 'error', cwd: import.meta.dirname, root: 'src' }),\n];\n");
  });

  it('refuses shapes it does not own: no array export, a named export, a commented-out marker counts as absent', () => {
    expect(applyFsdEslintConfig("module.exports = { rules: {} };\n", 'error')).toEqual({ status: 'unrecognized' });
    expect(applyFsdEslintConfig("const config = make();\nexport default config;\n", 'error')).toEqual({ status: 'unrecognized' });
    expect(classifyFsdEslintConfig("// import { x } from '@clearlydev/nx-archweave/eslint';\nexport default [];\n")).toBe('absent');
  });

  it("create-next-app's shape: the array is a const exported by name", () => {
    const text = [
      "import { FlatCompat } from '@eslint/eslintrc';",
      '',
      'const compat = new FlatCompat({ baseDirectory: __dirname });',
      '',
      'const eslintConfig = [',
      "  ...compat.extends('next/core-web-vitals', 'next/typescript'),",
      '];',
      '',
      'export default eslintConfig;',
      '',
    ].join('\n');
    const result = applyFsdEslintConfig(text, 'warn');
    if (result.status !== 'applied') throw new Error(result.status);
    expect(result.text).toContain("  ...compat.extends('next/core-web-vitals', 'next/typescript'),\n  ...fsdBoundaries({ severity: 'warn', cwd: import.meta.dirname, root: 'src' }),\n];\n\nexport default eslintConfig;");
    expect(result.text).toContain("import { FlatCompat } from '@eslint/eslintrc';\nimport { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';");
  });

  it('…and wrapped in defineConfig([...]), the newer template', () => {
    const text = [
      "import { defineConfig, globalIgnores } from 'eslint/config';",
      "import nextVitals from 'eslint-config-next/core-web-vitals';",
      '',
      'const eslintConfig = defineConfig([',
      '  ...nextVitals,',
      "  globalIgnores(['.next/**', 'out/**']),",
      ']);',
      '',
      'export default eslintConfig;',
      '',
    ].join('\n');
    const result = applyFsdEslintConfig(text, 'error');
    if (result.status !== 'applied') throw new Error(result.status);
    expect(result.text).toContain("  globalIgnores(['.next/**', 'out/**']),\n  ...fsdBoundaries({ severity: 'error', cwd: import.meta.dirname, root: 'src' }),\n]);");
  });

  it('multi-line imports are still imports', () => {
    const text = "import {\n  a,\n  b,\n} from 'x';\n\nexport default [\n  a,\n];\n";
    const result = applyFsdEslintConfig(text, 'error');
    if (result.status !== 'applied') throw new Error(result.status);
    expect(result.text.startsWith("import {\n  a,\n  b,\n} from 'x';\nimport { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\n\nexport default [")).toBe(true);
  });
});

describe('layer guide', () => {
  it('react-vite: five layers; next: four, pages in _pages', () => {
    expect(fsdLayersFor('react-vite')).toEqual(['app', 'pages', 'features', 'entities', 'shared']);
    expect(fsdLayersFor('next')).toEqual(['pages', 'features', 'entities', 'shared']);
    expect(fsdLayerDirName('next', 'pages')).toBe('_pages');
    expect(fsdLayerDirName('react-vite', 'pages')).toBe('pages');
    const guide = composeFsdLayerGuide({ profile: profileById('next'), sourceRoot: 'apps/web/src', locale: 'en' });
    expect(guide).toContain('apps/web/src/_pages');
    expect(guide).not.toContain('apps/web/src/app ');
  });
});
