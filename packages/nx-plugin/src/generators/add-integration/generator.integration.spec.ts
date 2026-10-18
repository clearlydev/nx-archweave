import { createFakeCommandRunner } from '@nx-archweave/integrations';
import { createIntegrationsCompositionRoot } from '../../runtime/integrations-composition-root.ts';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '../../../../../tools/fixtures/integrations');

// This suite exercises the real, unmodified ponytail adapter (via the
// composition root) against real fixture workspaces, mirroring the
// established pattern in init/generator.integration.spec.ts — pure functions
// tested directly against a real filesystem path, no Tree involved. An
// explicit versionRange is always supplied so plan() never reaches the real
// npm registry resolver. A rejecting fake
// runner simulates "claude CLI not found," exercising the package.json
// fallback path this suite is really testing (never the real claude binary).
describe('add-integration + ponytail adapter, real fixture behavior', () => {
  const rejectingRunner = { run: () => Promise.reject(new Error('spawn claude ENOENT')) };
  const root = createIntegrationsCompositionRoot({ runner: rejectingRunner });
  const ponytail = root.getIntegration('ponytail');
  if (!ponytail) {
    throw new Error('ponytail integration not found in the registry — registry wiring is broken');
  }

  it('detects an already-installed workspace dependency', async () => {
    const result = await ponytail.detect({
      workspaceRoot: join(FIXTURES, 'ponytail-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.installed).toBe(true);
  });

  it('detects a not-installed workspace (externally-installed / not-installed distinction lives in the manifest, not here)', async () => {
    const result = await ponytail.detect({
      workspaceRoot: join(FIXTURES, 'ponytail-not-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.installed).toBe(false);
  });

  it('verify() falls back to the package.json signal when the CLI is unavailable, and passes for an already-installed workspace', async () => {
    const result = await ponytail.verify({
      workspaceRoot: join(FIXTURES, 'ponytail-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.verified).toBe(true);
  });

  it('verify() fails for a not-installed workspace, with a manual-action-required-style problem message', async () => {
    const result = await ponytail.verify({
      workspaceRoot: join(FIXTURES, 'ponytail-not-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.verified).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('plan() resolves an explicit versionRange verbatim (no real network call)', async () => {
    await expect(ponytail.plan({ targetEnvironment: 'claude-code', versionRange: '4.8.4' })).resolves.toMatchObject({
      resolvedVersion: '4.8.4',
    });
  });

  it('plan() rejects an unsupported target instead of silently reporting it as installed', async () => {
    await expect(ponytail.plan({ targetEnvironment: 'codex', versionRange: '4.8.4' })).rejects.toThrow(
      /not supported/i,
    );
  });

  it("uninstallInstructions() never requires approval and returns the documented manual steps", async () => {
    const steps = await ponytail.uninstallInstructions({
      workspaceRoot: join(FIXTURES, 'ponytail-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(steps.length).toBeGreaterThan(0);
  });
});

describe('add-integration + ponytail adapter, CLI-first verification with a real fixture', () => {
  it('verify() is authoritative from the CLI signal, ignoring package.json entirely when the CLI succeeds', async () => {
    const runner = createFakeCommandRunner({ stdout: '[]' }); // CLI available, well-formed, no match
    const root = createIntegrationsCompositionRoot({ runner });
    const ponytail = root.getIntegration('ponytail');
    if (!ponytail) {
      throw new Error('ponytail integration not found in the registry — registry wiring is broken');
    }
    // This fixture's package.json DOES have the dependency — if a fallback
    // ran, this would incorrectly report verified: true.
    const result = await ponytail.verify({
      workspaceRoot: join(FIXTURES, 'ponytail-installed'),
      targetEnvironment: 'claude-code',
    });
    expect(result.verified).toBe(false);
  });
});
