import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEmptyManifest,
  loadManifest,
  serializeManifest,
  writeManifest,
  writeManifestAtomic,
  withManifestEntry,
} from './manifest.ts';

const FIXTURES = join(__dirname, '../../../../tools/fixtures/integrations');

describe('createEmptyManifest', () => {
  it('starts with no integrations', () => {
    expect(createEmptyManifest()).toEqual({ integrations: {} });
  });
});

describe('loadManifest', () => {
  it('returns an empty manifest when the file does not exist', () => {
    const manifest = loadManifest(join(FIXTURES, 'does-not-exist'));
    expect(manifest).toEqual({ integrations: {} });
  });

  it('parses an existing manifest file', () => {
    const manifest = loadManifest(join(FIXTURES, 'existing-manifest'));
    expect(manifest.integrations['ponytail']).toEqual({
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'external-tool',
      verification: 'passed',
    });
  });

  it('does not throw and returns an empty manifest for a malformed file', () => {
    expect(() => loadManifest(join(FIXTURES, 'malformed-manifest'))).not.toThrow();
    expect(loadManifest(join(FIXTURES, 'malformed-manifest'))).toEqual({ integrations: {} });
  });
});

describe('withManifestEntry', () => {
  it('returns a new manifest with the entry set, without mutating the input', () => {
    const original = createEmptyManifest();
    const updated = withManifestEntry(original, 'ponytail', {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'external-tool',
      verification: 'passed',
    });
    expect(original).toEqual({ integrations: {} });
    expect(updated.integrations['ponytail'].version).toBe('4.8.4');
  });
});

describe('serializeManifest', () => {
  it('is deterministic across repeated calls with the same input', () => {
    const manifest = withManifestEntry(createEmptyManifest(), 'ponytail', {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'external-tool',
      verification: 'passed',
    });
    expect(serializeManifest(manifest)).toBe(serializeManifest(manifest));
  });

  it('never contains a timestamp-like field', () => {
    const manifest = withManifestEntry(createEmptyManifest(), 'ponytail', {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'external-tool',
      verification: 'passed',
    });
    expect(serializeManifest(manifest)).not.toMatch(/installedAt/);
  });
});

describe('IntegrationManifestEntry — target/scope/evidenceKind (optional additions)', () => {
  it('round-trips an entry with all three new optional fields', () => {
    const manifest = withManifestEntry(createEmptyManifest(), 'ponytail', {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'nx-archweave',
      verification: 'passed',
      target: 'claude-code',
      scope: 'user',
      evidenceKind: 'claude-cli',
    });
    expect(manifest.integrations['ponytail']).toEqual({
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      version: '4.8.4',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'nx-archweave',
      verification: 'passed',
      target: 'claude-code',
      scope: 'user',
      evidenceKind: 'claude-cli',
    });
  });

  it('still parses an older fixture with none of the new fields present', () => {
    const manifest = loadManifest(join(FIXTURES, 'existing-manifest'));
    expect(manifest.integrations['ponytail'].target).toBeUndefined();
    expect(manifest.integrations['ponytail'].scope).toBeUndefined();
    expect(manifest.integrations['ponytail'].evidenceKind).toBeUndefined();
  });
});

describe('writeManifest + loadManifest round-trip', () => {
  it('writes a manifest to disk and reads back an equal value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-manifest-test-'));
    try {
      const manifest = withManifestEntry(createEmptyManifest(), 'ponytail', {
        source: 'DietrichGebert/ponytail',
        repository: 'https://github.com/DietrichGebert/ponytail',
        version: '4.8.4',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'external-tool',
        verification: 'passed',
      });
      writeManifest(dir, manifest);
      const reloaded = loadManifest(dir);
      expect(reloaded).toEqual(manifest);
      const raw = readFileSync(join(dir, 'archweave-integrations.json'), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writeManifestAtomic', () => {
  it('writes a manifest to disk and reads back an equal value, deterministically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-atomic-test-'));
    try {
      const manifest = withManifestEntry(createEmptyManifest(), 'ponytail', {
        source: 'DietrichGebert/ponytail',
        repository: 'https://github.com/DietrichGebert/ponytail',
        version: '4.8.4',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'nx-archweave',
        verification: 'passed',
      });
      writeManifestAtomic(dir, manifest);
      const reloaded = loadManifest(dir);
      expect(reloaded).toEqual(manifest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no leftover temp file after a successful write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-atomic-test-'));
    try {
      writeManifestAtomic(dir, createEmptyManifest());
      const files = readdirSync(dir);
      expect(files).toEqual(['archweave-integrations.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overwrites an existing manifest file completely (not merged)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-atomic-test-'));
    try {
      writeManifestAtomic(
        dir,
        withManifestEntry(createEmptyManifest(), 'ponytail', {
          source: 'DietrichGebert/ponytail',
          repository: 'https://github.com/DietrichGebert/ponytail',
          method: 'claude-code-plugin-marketplace',
          managedBy: 'nx-archweave',
          verification: 'passed',
        }),
      );
      const replacement = withManifestEntry(createEmptyManifest(), 'ponytail', {
        source: 'DietrichGebert/ponytail',
        repository: 'https://github.com/DietrichGebert/ponytail',
        version: '5.0.0',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'nx-archweave',
        verification: 'passed',
      });
      writeManifestAtomic(dir, replacement);
      expect(loadManifest(dir)).toEqual(replacement);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to write through a symlinked manifest path rather than following it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-atomic-test-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'archweave-atomic-outside-'));
    try {
      const outsideTarget = join(outsideDir, 'escaped.json');
      writeFileSync(outsideTarget, 'not a manifest');
      symlinkSync(outsideTarget, join(dir, 'archweave-integrations.json'));

      expect(() => writeManifestAtomic(dir, createEmptyManifest())).toThrow(/symlink/i);

      // The symlink target outside the workspace directory must be untouched.
      expect(readFileSync(outsideTarget, 'utf8')).toBe('not a manifest');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not require an existing manifest file to already be present (fresh workspace)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-atomic-test-'));
    try {
      expect(existsSync(join(dir, 'archweave-integrations.json'))).toBe(false);
      expect(() => writeManifestAtomic(dir, createEmptyManifest())).not.toThrow();
      expect(existsSync(join(dir, 'archweave-integrations.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
