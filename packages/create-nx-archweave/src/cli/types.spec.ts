import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_HOST_CHOICES, AI_HOST_PROBES, AI_HOST_VALUES, PLUGIN_CHOICES, PLUGIN_VALUES, REVIEW_PROVIDER_VALUES } from './types.ts';

const packagesDir = join(__dirname, '../../..');

function schemaOf(generator: string): { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> } {
  return JSON.parse(readFileSync(join(packagesDir, 'nx-plugin/src/generators', generator, 'schema.json'), 'utf8'));
}

// The CLI copies option literals instead of importing the plugin's policy (types.ts header).
// This keeps the AI-host copy equal to the init generator's enum.
describe('AI host literals', () => {
  it("equal init's aiHosts enum", () => {
    expect([...AI_HOST_VALUES]).toEqual(schemaOf('init').properties['aiHosts'].items?.enum);
  });

  it('every host has a probe command', () => {
    expect(Object.keys(AI_HOST_PROBES).sort()).toEqual([...AI_HOST_VALUES].sort());
  });
});

// The plugin copy stays equal to the plugin catalog: install-integration's --tool enum is
// the catalog's id list (catalog-schema-enums.spec.ts), and the shown text is the catalog's.
describe('plugin literals', () => {
  it("equal install-integration's --tool enum, and each host is a --target", () => {
    const schema = schemaOf('install-integration');
    expect([...PLUGIN_VALUES]).toEqual(schema.properties['tool'].enum);
    for (const plugin of PLUGIN_CHOICES) expect(schema.properties['target'].enum).toContain(plugin.host);
  });

  it.each(PLUGIN_CHOICES.map((plugin) => [plugin.id, plugin] as const))('%s matches its catalog entry', (_id, plugin) => {
    const catalog = readFileSync(join(packagesDir, 'integrations/src/catalog/plugin-catalog.ts'), 'utf8');
    const start = catalog.indexOf(`id: '${plugin.id}',`);
    expect(start).toBeGreaterThan(-1);
    const entry = catalog.slice(start, catalog.indexOf('\n  },\n', start));
    expect(entry).toContain(`displayName: '${plugin.label}',`);
    expect(entry).toContain(plugin.description);
    expect(entry).toContain(`license: '${plugin.license}',`);
    expect(entry).toContain(`'${plugin.host}': {`);
  });
});

describe('review provider literals', () => {
  it("equal init's reviewProvider enum", () => {
    expect([...REVIEW_PROVIDER_VALUES]).toEqual(schemaOf('init').properties['reviewProvider'].enum);
  });

  it("each host's default provider matches template-engine's AI host table", () => {
    const table = readFileSync(join(packagesDir, 'template-engine/src/ai-hosts/ai-hosts.ts'), 'utf8');
    for (const host of AI_HOST_CHOICES) {
      expect(table).toMatch(new RegExp(`id: '${host.id}'[^}]*reviewProvider: '${host.reviewProvider}'`));
    }
  });
});
