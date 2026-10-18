import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The same option pipeline `nx g` runs (defaults, coercion, validation).
import { combineOptionsForGenerator } from 'nx/src/utils/params';

/**
 * Regression guard: `nx g` deletes `dryRun` /
 * `dry-run` from generator options before the generator sees them (Nx owns that
 * flag) and then fills schema defaults — so an approval gate named `dryRun` with a
 * default of `true` can never be turned off from the command line. The generators
 * that act outside the Tree (they run a CLI and write real files, or — allow-builds —
 * run a dependency's install script) take their approval through `--apply` instead.
 */
describe.each([
  ['install-integration', { tool: 'ponytail' }],
  ['record-integration', { tool: 'ponytail' }],
  ['allow-builds', { packages: 'sharp' }],
] as const)('%s approval flag', (generator, required) => {
  const schema = JSON.parse(readFileSync(join(__dirname, generator, 'schema.json'), 'utf-8'));

  it('declares no dryRun option (nx g would strip it and re-fill the default)', () => {
    expect(schema.properties.dryRun).toBeUndefined();
  });

  it('takes approval through --apply, off by default, and it survives Nx option processing', async () => {
    expect(schema.properties.apply).toMatchObject({ type: 'boolean', default: false });
    const run = (opts: Record<string, string | boolean>) =>
      combineOptionsForGenerator(opts, '@clearlydev/nx-archweave', generator, null as never, {} as never, schema, false, null, '', false);
    expect((await run({ ...required }))['apply']).toBe(false);
    expect((await run({ ...required, apply: true }))['apply']).toBe(true);
    expect((await run({ ...required, apply: 'true' }))['apply']).toBe(true);
  });
});

it('allow-builds takes --packages comma-separated, as Nx splits an array option', async () => {
  const schema = JSON.parse(readFileSync(join(__dirname, 'allow-builds', 'schema.json'), 'utf-8'));
  const combined = await combineOptionsForGenerator(
    { packages: 'sharp,@swc/core' },
    '@clearlydev/nx-archweave',
    'allow-builds',
    null as never,
    {} as never,
    schema,
    false,
    null,
    '',
    false,
  );
  expect(combined['packages']).toEqual(['sharp', '@swc/core']);
});

it('install-integration leaves --scope undefined when omitted, so an explicit scope can be told apart from the default', async () => {
  const schema = JSON.parse(readFileSync(join(__dirname, 'install-integration', 'schema.json'), 'utf-8'));
  const combined = await combineOptionsForGenerator(
    { tool: 'ponytail' },
    '@clearlydev/nx-archweave',
    'install-integration',
    null as never,
    {} as never,
    schema,
    false,
    null,
    '',
    false,
  );
  expect(combined['scope']).toBeUndefined();
});
