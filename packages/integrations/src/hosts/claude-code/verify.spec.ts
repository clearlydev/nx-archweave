import { createClaudeMarketplaceVerifier, verifyClaudeMarketplacePlugin } from './verify.ts';
import { createFakeCommandRunner } from '../../process/read-only-command-runner.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCatalogEntry } from '../../catalog/plugin-catalog.ts';

const PONYTAIL = getCatalogEntry('ponytail')!;

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/integrations');
const PLUGIN_LIST_FIXTURES = join(FIXTURES, 'claude-plugin-list');
const read = (name: string) => readFileSync(join(PLUGIN_LIST_FIXTURES, `${name}.json`), 'utf8');

describe('createClaudeMarketplaceVerifier (ponytail) — CLI-first with a package.json fallback', () => {
  it('reports verified from an enabled CLI match, using the CLI-reported version', async () => {
    const runner = createFakeCommandRunner({ stdout: read('enabled-match') });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-not-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(true);
    expect(result.resolvedVersion).toBe('4.8.4');
    expect(result.problems).toEqual([]);
  });

  it('falls back to package.json only when the CLI is not found, and only then', async () => {
    const rejectingRunner = { run: () => Promise.reject(new Error('spawn claude ENOENT')) };
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner: rejectingRunner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(true);
    expect(result.resolvedVersion).toBe('4.8.4');
  });

  it('reports not verified when the CLI is not found and the package.json fallback also finds nothing', async () => {
    const rejectingRunner = { run: () => Promise.reject(new Error('spawn claude ENOENT')) };
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner: rejectingRunner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-not-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('does NOT fall back to package.json when the CLI is available but fails (e.g. timeout) — the critical rule', async () => {
    const runner = createFakeCommandRunner({ stdout: '', timedOut: true, exitCode: null });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    // This fixture's package.json DOES have the dependency — if the fallback ran, this would
    // incorrectly report verified: true. It must not, because the CLI was available and failed.
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(false);
    expect(result.problems.some((p) => /verification error/i.test(p))).toBe(true);
  });

  it('does NOT fall back to package.json on a non-zero exit', async () => {
    const runner = createFakeCommandRunner({ stdout: '', exitCode: 1 });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(false);
  });

  it('does NOT fall back to package.json on malformed JSON', async () => {
    const runner = createFakeCommandRunner({ stdout: read('malformed') });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(false);
  });

  it('does NOT fall back to package.json on an ambiguous match', async () => {
    const runner = createFakeCommandRunner({ stdout: read('duplicate-match') });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(false);
    expect(result.problems.some((p) => /ambiguous/i.test(p))).toBe(true);
  });

  it('reports installed-but-disabled distinctly from not-found, and never as verified', async () => {
    const runner = createFakeCommandRunner({ stdout: read('disabled-match') });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    const result = await verify({ workspaceRoot: join(FIXTURES, 'ponytail-not-installed'), targetEnvironment: 'claude-code' });
    expect(result.verified).toBe(false);
    expect(result.problems.some((p) => /disabled/i.test(p))).toBe(true);
  });
});

describe('verifyClaudeMarketplacePlugin (ponytail) — exposes which signal actually produced the result', () => {
  it('reports source: claude-cli for a CLI-derived verified result', async () => {
    const runner = createFakeCommandRunner({ stdout: read('enabled-match') });
    const detail = await verifyClaudeMarketplacePlugin(PONYTAIL, 
      { runner },
      { workspaceRoot: join(FIXTURES, 'ponytail-not-installed'), targetEnvironment: 'claude-code' },
    );
    expect(detail.source).toBe('claude-cli');
    expect(detail.result.verified).toBe(true);
  });

  it('reports source: package-json for a fallback-derived verified result, when the CLI is not found', async () => {
    const rejectingRunner = { run: () => Promise.reject(new Error('spawn claude ENOENT')) };
    const detail = await verifyClaudeMarketplacePlugin(PONYTAIL, 
      { runner: rejectingRunner },
      { workspaceRoot: join(FIXTURES, 'ponytail-installed'), targetEnvironment: 'claude-code' },
    );
    expect(detail.source).toBe('package-json');
    expect(detail.result.verified).toBe(true);
  });

  it('createClaudeMarketplaceVerifier and verifyClaudeMarketplacePlugin agree on the verified result for the same inputs', async () => {
    const runner = createFakeCommandRunner({ stdout: read('enabled-match') });
    const verify = createClaudeMarketplaceVerifier(PONYTAIL, { runner });
    const context = { workspaceRoot: join(FIXTURES, 'ponytail-not-installed'), targetEnvironment: 'claude-code' };
    const viaVerify = await verify(context);
    const viaDetail = (await verifyClaudeMarketplacePlugin(PONYTAIL, { runner }, context)).result;
    expect(viaVerify).toEqual(viaDetail);
  });
});
