import {
  PLUGIN_CATALOG,
  PLUGIN_HOSTS,
  PLUGIN_IDS,
  catalogEntriesFor,
  getCatalogEntry,
  recordMetadataFor,
} from './plugin-catalog.ts';

describe('plugin catalog', () => {
  it('ids are unique, and every entry names at least one host that has an adapter', () => {
    expect(new Set(PLUGIN_IDS).size).toBe(PLUGIN_IDS.length);
    for (const entry of PLUGIN_CATALOG) {
      const hosts = Object.keys(entry.hosts);
      expect(hosts.length).toBeGreaterThan(0);
      for (const host of hosts) expect(PLUGIN_HOSTS).toContain(host);
    }
  });

  it('a Claude Code distribution carries a <name>@<marketplace> plugin id for its name', () => {
    for (const entry of catalogEntriesFor('claude-code')) {
      const claude = entry.hosts['claude-code']!;
      expect(claude.pluginId).toMatch(new RegExp(`^${claude.name}@[^@\\s]+$`));
      expect(claude.marketplace).toMatch(/^[^/\s]+\/[^/\s]+$/);
    }
  });

  it('ponytail keeps the values the manifest and verifier were measured with', () => {
    const ponytail = getCatalogEntry('ponytail')!;
    expect(ponytail.hosts['claude-code']).toEqual({ name: 'ponytail', marketplace: 'DietrichGebert/ponytail', pluginId: 'ponytail@ponytail' });
    expect(recordMetadataFor(ponytail)).toEqual({
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      method: 'claude-code-plugin-marketplace',
    });
  });

  it('an unknown id is undefined', () => {
    expect(getCatalogEntry('nope')).toBeUndefined();
  });
});
