import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareEnabledIntegration } from './declare-enabled-integration.ts';
import { readEnabledIntegrationIds } from './read-enabled-integrations.ts';

// Windows has no POSIX permission bits: chmod there only toggles read-only, so a mode
// round-trip can't be observed.
const itWithPosixModes = process.platform === 'win32' ? it.skip : it;

// Creating a symlink on Windows needs Developer Mode or an elevated shell. Without either the OS
// refuses (EPERM), so a test that needs one is skipped there instead of failing on setup.
const itWithSymlinks = canCreateSymlinks() ? it : it.skip;

function canCreateSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'archweave-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('declareEnabledIntegration', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'archweave-declare-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const configPath = () => join(root, 'toolkit.config.json');

  it('never creates toolkit.config.json — its existence marks a toolkit-managed workspace', () => {
    expect(declareEnabledIntegration(root, 'ponytail', { write: true })).toEqual({ action: 'no-config' });
    expect(existsSync(configPath())).toBe(false);
  });

  it('merges into an existing config, preserving unrelated keys, sibling keys, indentation and the trailing newline', () => {
    writeFileSync(configPath(), '{\n    "locale": "ko",\n    "integrations": {\n        "custom": true,\n        "enabled": ["other"]\n    }\n}\n');
    expect(declareEnabledIntegration(root, 'ponytail', { write: true })).toEqual({ action: 'updated' });
    const raw = readFileSync(configPath(), 'utf8');
    expect(JSON.parse(raw)).toEqual({ locale: 'ko', integrations: { custom: true, enabled: ['other', 'ponytail'] } });
    expect(raw).toMatch(/^ {4}"locale"/m);
    expect(raw.endsWith('\n')).toBe(true);
    expect(readEnabledIntegrationIds(root)).toEqual(['other', 'ponytail']);
  });

  it('keeps a minified file minified and CRLF line endings as CRLF', () => {
    writeFileSync(configPath(), '{"locale":"en"}');
    declareEnabledIntegration(root, 'ponytail', { write: true });
    expect(readFileSync(configPath(), 'utf8')).toBe('{"locale":"en","integrations":{"enabled":["ponytail"]}}');

    writeFileSync(configPath(), '{\r\n  "locale": "en"\r\n}\r\n');
    declareEnabledIntegration(root, 'ponytail', { write: true });
    const raw = readFileSync(configPath(), 'utf8');
    expect(raw).toContain('\r\n');
    expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
  });

  itWithPosixModes('preserves the file mode across the atomic rewrite', () => {
    writeFileSync(configPath(), '{}\n');
    chmodSync(configPath(), 0o600);
    declareEnabledIntegration(root, 'ponytail', { write: true });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it('writes atomically: no temp file is left behind', () => {
    writeFileSync(configPath(), '{}\n');
    declareEnabledIntegration(root, 'ponytail', { write: true });
    expect(readdirSync(root)).toEqual(['toolkit.config.json']);
  });

  itWithSymlinks('refuses to write through a symlinked config (reported as unrecognized, target untouched)', () => {
    const target = join(root, 'real.json');
    writeFileSync(target, '{}');
    symlinkSync(target, configPath());
    expect(declareEnabledIntegration(root, 'ponytail', { write: true })).toEqual({ action: 'unrecognized' });
    expect(readFileSync(target, 'utf8')).toBe('{}');
  });

  it('is idempotent: an already-declared id is unchanged and the file is not rewritten', () => {
    writeFileSync(configPath(), '{"integrations":{"enabled":["ponytail"]}}');
    const before = readFileSync(configPath(), 'utf8');
    expect(declareEnabledIntegration(root, 'ponytail', { write: true })).toEqual({ action: 'unchanged' });
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });

  it.each([
    ['unparseable', '{ not json'],
    ['non-object root', '[1,2]'],
    ['non-object integrations', '{"integrations":"yes"}'],
    ['non-array enabled', '{"integrations":{"enabled":"ponytail"}}'],
    ['non-string entry', '{"integrations":{"enabled":[1]}}'],
  ])('leaves an unrecognized shape untouched and reports it (%s)', (_label, content) => {
    writeFileSync(configPath(), content);
    expect(declareEnabledIntegration(root, 'ponytail', { write: true })).toEqual({ action: 'unrecognized' });
    expect(readFileSync(configPath(), 'utf8')).toBe(content);
  });

  it('write: false computes the outcome without touching the filesystem', () => {
    writeFileSync(configPath(), '{"locale":"en"}');
    expect(declareEnabledIntegration(root, 'ponytail', { write: false })).toEqual({ action: 'updated' });
    expect(readFileSync(configPath(), 'utf8')).toBe('{"locale":"en"}');
  });
});
