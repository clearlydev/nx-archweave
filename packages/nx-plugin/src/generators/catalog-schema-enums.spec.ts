import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PLUGIN_SCOPE, PLUGIN_HOSTS, PLUGIN_IDS } from '@nx-archweave/integrations';

// Nx reads schema.json statically, so the --tool / --target enums cannot be computed from
// the plugin catalog at runtime. This test is what keeps them equal to it:
// adding a catalog entry without the enum fails here.
describe.each(['add-integration', 'install-integration', 'record-integration'])('%s schema', (generator) => {
  const schema = JSON.parse(readFileSync(join(__dirname, generator, 'schema.json'), 'utf8')) as {
    properties: Record<string, { enum?: string[]; default?: string }>;
  };

  it('--tool lists exactly the plugin catalog ids', () => {
    expect(schema.properties['tool'].enum).toEqual([...PLUGIN_IDS]);
  });

  it('--target lists exactly the hosts with a plugin adapter', () => {
    expect(schema.properties['target'].enum).toEqual([...PLUGIN_HOSTS]);
  });

  it('--scope, where it has a default, defaults to the catalog default (project)', () => {
    const scope = schema.properties['scope'];
    if (scope?.default !== undefined) expect(scope.default).toBe(DEFAULT_PLUGIN_SCOPE);
  });
});
