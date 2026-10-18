import { readEnabledIntegrationIds } from './read-enabled-integrations.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '../../../../tools/fixtures/integrations');

function withConfigDir(configJson: string, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'archweave-config-test-'));
  try {
    writeFileSync(join(dir, 'toolkit.config.json'), configJson);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readEnabledIntegrationIds', () => {
  it('returns the enabled list when toolkit.config.json declares one', () => {
    expect(readEnabledIntegrationIds(join(FIXTURES, 'config-ponytail-enabled'))).toEqual(['ponytail']);
  });

  it('returns an empty array when the file exists but has no integrations field', () => {
    expect(readEnabledIntegrationIds(join(FIXTURES, 'config-no-integrations-field'))).toEqual([]);
  });

  it('returns an empty array when toolkit.config.json does not exist', () => {
    expect(readEnabledIntegrationIds(join(FIXTURES, 'does-not-exist'))).toEqual([]);
  });

  it('does not throw and returns an empty array for a malformed file', () => {
    expect(() => readEnabledIntegrationIds(join(FIXTURES, 'config-malformed'))).not.toThrow();
    expect(readEnabledIntegrationIds(join(FIXTURES, 'config-malformed'))).toEqual([]);
  });

  it('returns an empty array when integrations.enabled is not an array (e.g. a string)', () => {
    withConfigDir(JSON.stringify({ integrations: { enabled: 'ponytail' } }), (dir) => {
      expect(readEnabledIntegrationIds(dir)).toEqual([]);
    });
  });

  it('returns an empty array when integrations.enabled is an object instead of an array', () => {
    withConfigDir(JSON.stringify({ integrations: { enabled: { ponytail: true } } }), (dir) => {
      expect(readEnabledIntegrationIds(dir)).toEqual([]);
    });
  });

  it('rejects the whole array (returns []) when any entry is not a string, rather than filtering entries silently', () => {
    withConfigDir(JSON.stringify({ integrations: { enabled: ['ponytail', 42] } }), (dir) => {
      expect(readEnabledIntegrationIds(dir)).toEqual([]);
    });
  });

  it('passes duplicate ids through unchanged — downstream drift detection deduplicates via Set, so this is safe, not just untested', () => {
    withConfigDir(JSON.stringify({ integrations: { enabled: ['ponytail', 'ponytail'] } }), (dir) => {
      expect(readEnabledIntegrationIds(dir)).toEqual(['ponytail', 'ponytail']);
    });
  });
});
