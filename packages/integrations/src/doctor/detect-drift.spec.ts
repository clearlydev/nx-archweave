import { classifyIntegrationDrift, detectIntegrationsDrift } from './detect-drift.ts';
import type { DetectionResult, ToolIntegration } from '../contracts/integration.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withManifestEntry, createEmptyManifest, writeManifest, loadManifest } from '../manifest/manifest.ts';
import type { IntegrationManifestEntry } from '../manifest/manifest.ts';

describe('classifyIntegrationDrift', () => {
  it('reports not-installed when nothing is declared, recorded, or detected', () => {
    const result = classifyIntegrationDrift({
      id: 'ponytail',
      declared: false,
      manifestEntry: undefined,
      detected: { installed: false, managedBy: 'unknown', evidence: [] },
    });
    expect(result.status).toBe('not-installed');
  });

  it('reports undeclared-leftover when found but not declared (manifest present)', () => {
    const result = classifyIntegrationDrift({
      id: 'ponytail',
      declared: false,
      manifestEntry: {
        source: 'DietrichGebert/ponytail',
        repository: 'https://github.com/DietrichGebert/ponytail',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'external-tool',
        verification: 'passed',
      },
      detected: { installed: true, managedBy: 'external-tool', evidence: ['package.json'] },
    });
    expect(result.status).toBe('undeclared-leftover');
  });

  it('reports externally-installed when detected outside nx-archweave (no manifest, no config)', () => {
    const result = classifyIntegrationDrift({
      id: 'ponytail',
      declared: false,
      manifestEntry: undefined,
      detected: { installed: true, managedBy: 'unknown', evidence: ['package.json'] },
    });
    expect(result.status).toBe('externally-installed');
  });

  it('reports configured when declared and manifest verification passed', () => {
    const result = classifyIntegrationDrift({
      id: 'ponytail',
      declared: true,
      manifestEntry: {
        source: 'DietrichGebert/ponytail',
        repository: 'https://github.com/DietrichGebert/ponytail',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'external-tool',
        verification: 'passed',
      },
      detected: { installed: true, managedBy: 'external-tool', evidence: ['package.json'] },
    });
    expect(result.status).toBe('configured');
  });

  it('reports declared-missing when declared but no manifest entry exists yet', () => {
    const result = classifyIntegrationDrift({
      id: 'ponytail',
      declared: true,
      manifestEntry: undefined,
      detected: { installed: false, managedBy: 'unknown', evidence: [] },
    });
    expect(result.status).toBe('declared-missing');
  });

  it('reports verification-failed when declared and manifest verification failed', () => {
    const result = classifyIntegrationDrift({
      id: 'ponytail',
      declared: true,
      manifestEntry: {
        source: 'DietrichGebert/ponytail',
        repository: 'https://github.com/DietrichGebert/ponytail',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'external-tool',
        verification: 'failed',
      },
      detected: { installed: false, managedBy: 'unknown', evidence: [] },
    });
    expect(result.status).toBe('verification-failed');
  });
});

function stubIntegration(id: string, detected: boolean): ToolIntegration {
  return {
    id,
    displayName: id,
    homepage: 'https://example.com',
    repository: 'example/example',
    license: 'MIT',
    supportedEnvironments: ['claude-code'],
    detect: async () => ({ installed: detected, managedBy: detected ? 'external-tool' : 'unknown', evidence: detected ? ['x'] : [] }),
    plan: async () => {
      throw new Error('not used in this test');
    },
    install: async () => {
      throw new Error('not used in this test');
    },
    verify: async () => ({ verified: false, problems: [] }),
    uninstallInstructions: async () => [],
  };
}

describe('detectIntegrationsDrift', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archweave-drift-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('never writes to disk (read-only)', async () => {
    await detectIntegrationsDrift({
      workspaceRoot: dir,
      targetEnvironment: 'claude-code',
      declaredIds: ['ponytail'],
      integrations: [stubIntegration('ponytail', false)],
    });
    // still no manifest file, since nothing was ever written by drift detection
    expect(loadManifest(dir)).toEqual({ integrations: {} });
  });

  it('combines declared ids, manifest ids, and registry results into one report', async () => {
    writeManifest(dir, withManifestEntry(createEmptyManifest(), 'ponytail', {
      source: 'DietrichGebert/ponytail',
      repository: 'https://github.com/DietrichGebert/ponytail',
      method: 'claude-code-plugin-marketplace',
      managedBy: 'external-tool',
      verification: 'passed',
    }));

    const results = await detectIntegrationsDrift({
      workspaceRoot: dir,
      targetEnvironment: 'claude-code',
      declaredIds: ['ponytail'],
      integrations: [stubIntegration('ponytail', true)],
    });

    expect(results).toEqual([
      expect.objectContaining({ id: 'ponytail', status: 'configured' }),
    ]);
  });
});

describe('classifyIntegrationDrift — the four drift states', () => {
  const detectedNo = { installed: false } as DetectionResult;
  const detectedYes = { installed: true, source: 'live' } as unknown as DetectionResult;
  const manifest = { id: 'ponytail', verification: 'passed' } as unknown as IntegrationManifestEntry;

  it('① declared + no manifest → declared-missing; an installable id is pointed at install-integration --apply', () => {
    const result = classifyIntegrationDrift({ id: 'p', declared: true, manifestEntry: undefined, detected: detectedNo, installable: true });
    expect(result.status).toBe('declared-missing');
    expect(result.suggestedAction).toContain('install-integration --tool=p --apply');
  });

  it("① the suggested commands use the caller's runNx (default pnpm nx)", () => {
    const base = { id: 'p', declared: true, manifestEntry: undefined, installable: true };
    expect(classifyIntegrationDrift({ ...base, detected: detectedNo }).suggestedAction).toContain('pnpm nx g @clearlydev/nx-archweave:install-integration');
    expect(classifyIntegrationDrift({ ...base, detected: detectedNo, runNx: 'bun nx' }).suggestedAction).toContain(
      'bun nx g @clearlydev/nx-archweave:install-integration',
    );
    expect(classifyIntegrationDrift({ ...base, detected: detectedYes, runNx: 'yarn nx' }).suggestedAction).toContain(
      'yarn nx g @clearlydev/nx-archweave:record-integration',
    );
  });

  it('① an id nx-archweave cannot install (typo, unsupported tool) is never pointed at install-integration', () => {
    const result = classifyIntegrationDrift({ id: 'ponytial', declared: true, manifestEntry: undefined, detected: detectedNo });
    expect(result.status).toBe('declared-missing');
    expect(result.suggestedAction).not.toContain('install-integration');
    expect(result.suggestedAction).toContain('install');
  });

  it('② manifest without declaration → undeclared-leftover', () => {
    const result = classifyIntegrationDrift({ id: 'p', declared: false, manifestEntry: manifest, detected: detectedNo });
    expect(result.status).toBe('undeclared-leftover');
    expect(result.suggestedAction).toBeTruthy();
  });

  it('③ declared + manifest + verification failed → verification-failed', () => {
    const failing = { ...manifest, verification: 'failed' } as IntegrationManifestEntry;
    const result = classifyIntegrationDrift({ id: 'p', declared: true, manifestEntry: failing, detected: detectedNo });
    expect(result.status).toBe('verification-failed');
  });

  it('④ nothing declared/recorded but detected live → externally-installed', () => {
    const result = classifyIntegrationDrift({ id: 'p', declared: false, manifestEntry: undefined, detected: detectedYes });
    expect(result.status).toBe('externally-installed');
  });

  it('regressions: untouched states survive', () => {
    expect(classifyIntegrationDrift({ id: 'p', declared: false, manifestEntry: undefined, detected: detectedNo }).status).toBe('not-installed');
    expect(classifyIntegrationDrift({ id: 'p', declared: true, manifestEntry: manifest, detected: detectedYes }).status).toBe('configured');
  });
});

it('① variant: declared + no manifest + detected live → still declared-missing, but the action is to RECORD, not reinstall', () => {
  const detectedYes = { installed: true, source: 'live' } as unknown as DetectionResult;
  const result = classifyIntegrationDrift({ id: 'p', declared: true, manifestEntry: undefined, detected: detectedYes });
  expect(result.status).toBe('declared-missing');
  expect(result.suggestedAction).toContain('record-integration --tool=p --apply');
  expect(result.reason).not.toContain('never happened');
});
