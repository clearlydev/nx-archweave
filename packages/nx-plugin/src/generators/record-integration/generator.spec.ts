import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordIntegrationGenerator } from './generator.ts';
import { createFakeCommandRunner } from '@nx-archweave/integrations';
import { createIntegrationsCompositionRoot } from '../../runtime/integrations-composition-root.ts';
import { buildDoctorReportWithIntegrations } from '../doctor/integration-report.ts';

const ENABLED_MATCH_JSON = JSON.stringify([
  { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true },
]);
const NO_MATCH_JSON = '[]';

function fakeRoot(stdout: string) {
  return createIntegrationsCompositionRoot({ runner: createFakeCommandRunner({ stdout }) });
}

describe('recordIntegrationGenerator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('does not write to the Tree in dry-run mode (default)', async () => {
    const changesBefore = tree.listChanges();
    await recordIntegrationGenerator(tree, { tool: 'ponytail' }, { integrationsRoot: fakeRoot(ENABLED_MATCH_JSON) });
    expect(tree.listChanges()).toEqual(changesBefore);
  });

  it('invokes live verification even in dry-run mode — there is no offline-preview mode', async () => {
    let callCount = 0;
    const spyingRunner = {
      run: async () => {
        callCount += 1;
        return {
          stdout: ENABLED_MATCH_JSON,
          stderr: '',
          exitCode: 0,
          timedOut: false,
          outputExceeded: false,
        };
      },
    };
    const root = createIntegrationsCompositionRoot({ runner: spyingRunner });
    await recordIntegrationGenerator(tree, { tool: 'ponytail' }, { integrationsRoot: root });
    expect(callCount).toBeGreaterThan(0);
  });

  it('rejects an unsupported tool with a clear error', async () => {
    await expect(
      recordIntegrationGenerator(
        tree,
        { tool: 'taste-skill' as unknown as 'ponytail' },
        { integrationsRoot: fakeRoot(NO_MATCH_JSON) },
      ),
    ).rejects.toThrow(/unsupported/i);
  });

  it('rejects an unsupported target with a clear error', async () => {
    await expect(
      recordIntegrationGenerator(
        tree,
        { tool: 'ponytail', target: 'codex' as unknown as 'claude-code' },
        { integrationsRoot: fakeRoot(NO_MATCH_JSON) },
      ),
    ).rejects.toThrow(/not supported/i);
  });

  it('produces deterministic console output across repeated dry-runs', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });
    const root = fakeRoot(ENABLED_MATCH_JSON);
    await recordIntegrationGenerator(tree, { tool: 'ponytail' }, { integrationsRoot: root });
    const first = logs.join('\n');
    logs.length = 0;
    await recordIntegrationGenerator(tree, { tool: 'ponytail' }, { integrationsRoot: root });
    const second = logs.join('\n');
    spy.mockRestore();
    expect(first).toBe(second);
  });
});

describe('recordIntegrationGenerator — real-fs record mode (--dry-run=false)', () => {
  function realTree(dir: string): Tree {
    return { root: dir } as Tree;
  }

  it('writes exactly the expected manifest entry when verification succeeds via claude-cli', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      const root = fakeRoot(ENABLED_MATCH_JSON);
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: root },
      );
      const manifestPath = join(dir, 'archweave-integrations.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(manifest.integrations.ponytail).toMatchObject({
        source: 'DietrichGebert/ponytail',
        method: 'claude-code-plugin-marketplace',
        managedBy: 'nx-archweave',
        verification: 'passed',
        evidenceKind: 'claude-cli',
        version: '4.8.4',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nothing when verification fails (plugin absent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      const root = fakeRoot(NO_MATCH_JSON);
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: root },
      );
      expect(existsSync(join(dir, 'archweave-integrations.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nothing when the plugin is installed but disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      const disabledJson = JSON.stringify([
        { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: false },
      ]);
      const root = fakeRoot(disabledJson);
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: root },
      );
      expect(existsSync(join(dir, 'archweave-integrations.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nothing when the CLI is available but returns a verification error (e.g. ambiguous match)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      const duplicateJson = JSON.stringify([
        { id: 'ponytail@ponytail', version: '4.8.4', scope: 'user', enabled: true },
        { id: 'ponytail@ponytail', version: '4.8.4', scope: 'project', enabled: true },
      ]);
      const root = fakeRoot(duplicateJson);
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: root },
      );
      expect(existsSync(join(dir, 'archweave-integrations.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never writes toolkit.config.json under any flag combination (Policy A)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      const root = fakeRoot(ENABLED_MATCH_JSON);
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: root },
      );
      expect(existsSync(join(dir, 'toolkit.config.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent — recording twice in a row produces a byte-identical manifest file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      const manifestPath = join(dir, 'archweave-integrations.json');
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: fakeRoot(ENABLED_MATCH_JSON) },
      );
      const first = readFileSync(manifestPath, 'utf8');
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: fakeRoot(ENABLED_MATCH_JSON) },
      );
      const second = readFileSync(manifestPath, 'utf8');
      expect(second).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('succeeds and produces a fresh, valid manifest when the existing one is malformed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      writeFileSync(join(dir, 'archweave-integrations.json'), '{ this is not valid json');
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: fakeRoot(ENABLED_MATCH_JSON) },
      );
      const manifest = JSON.parse(readFileSync(join(dir, 'archweave-integrations.json'), 'utf8'));
      expect(manifest.integrations.ponytail.verification).toBe('passed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is recognized as pass by doctor once declared and recorded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      writeFileSync(
        join(dir, 'toolkit.config.json'),
        JSON.stringify({ integrations: { enabled: ['ponytail'] } }),
      );
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: fakeRoot(ENABLED_MATCH_JSON) },
      );
      const report = await buildDoctorReportWithIntegrations(dir);
      expect(report.checks.find((c) => c.id === 'integration-ponytail')?.status).toBe('pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves unrelated entries already present in the manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archweave-record-integration-test-'));
    try {
      writeFileSync(
        join(dir, 'archweave-integrations.json'),
        JSON.stringify({
          integrations: {
            'unrelated-tool': {
              source: 'someone/unrelated-tool',
              repository: 'https://github.com/someone/unrelated-tool',
              method: 'some-method',
              managedBy: 'external-tool',
              verification: 'passed',
            },
          },
        }),
      );
      await recordIntegrationGenerator(
        realTree(dir),
        { tool: 'ponytail', apply: true },
        { integrationsRoot: fakeRoot(ENABLED_MATCH_JSON) },
      );
      const manifest = JSON.parse(readFileSync(join(dir, 'archweave-integrations.json'), 'utf8'));
      expect(manifest.integrations['unrelated-tool']).toBeDefined();
      expect(manifest.integrations['ponytail']).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
