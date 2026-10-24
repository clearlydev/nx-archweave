import { Linter } from 'eslint';
import { posix } from 'node:path';
import { fsdBoundaries } from '../../eslint/index.ts';
import { runAddFsdLite } from '../add-fsd-lite/generator.ts';
import { runFsdSlice } from '../slice/core.ts';
import { LAYOUTS } from './__fixtures__/layouts.ts';

const WS = '/ws';

describe.each(LAYOUTS)('$name', (layout) => {
  it('add-fsd-lite wires the rule for the real source root, and slices land in it', () => {
    const tree = layout.build();
    const report = runAddFsdLite(tree, { frontend: layout.frontend, applyEslint: true });
    expect(report).toMatchObject({ aborted: false, sourceRoot: layout.sourceRoot, eslint: 'applied' });
    const configPath = layout.appRoot === '.' ? 'eslint.config.mjs' : `${layout.appRoot}/eslint.config.mjs`;
    expect(tree.read(configPath, 'utf-8')).toContain(`cwd: import.meta.dirname, root: '${layout.eslintRoot}'`);

    const slice = runFsdSlice(tree, 'features', { name: 'checkout' });
    expect(slice.directory).toBe(`${layout.sourceRoot}/features/checkout`);
    expect(tree.exists(`${layout.sourceRoot}/features/checkout/model/checkout.spec.ts`)).toBe(true);
  });

  it('the rule reports a cross-slice import even when ESLint runs from the workspace root', () => {
    const linter = new Linter({ cwd: WS, configType: 'flat' });
    const appDir = posix.join(WS, layout.appRoot);
    const config = [
      { languageOptions: { ecmaVersion: 2022 as const, sourceType: 'module' as const } },
      ...fsdBoundaries({ cwd: appDir, root: layout.eslintRoot, tsconfig: false, files: ['**/*.ts'] }),
    ] as Linter.Config[];
    const file = posix.join(WS, layout.sourceRoot, 'features/a/model/a.ts');
    const messages = linter.verify("import { b } from '../../b/model/b';", config, { filename: file });
    expect(messages.map((m) => m.ruleId)).toEqual(['archweave/fsd-boundaries']);
  });
});
