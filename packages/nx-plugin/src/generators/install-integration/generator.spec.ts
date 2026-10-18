import type { Tree } from '@nx/devkit';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner } from '@nx-archweave/integrations';
import { installIntegrationGenerator, runInstallIntegration } from './generator.ts';
import { createIntegrationsCompositionRoot } from '../../runtime/integrations-composition-root.ts';

const entry = (scope: string, enabled = true) => ({ id: 'ponytail@ponytail', version: '4.8.4', scope, enabled });
const LIST = (...entries: object[]) => ({ stdout: JSON.stringify(entries) });
const ABSENT = LIST();
const ENABLED = LIST(entry('user'));
const INSTALL_OK = { stdout: '{"command":"install","outcome":"installed","plugin":"ponytail@ponytail","scope":"user"}\n', exitCode: 0 };
const INSTALL_FAILED = {
  stdout: '{"command":"install","outcome":"failed","plugin":"ponytail@ponytail","scope":"user","message":"Plugin \\"ponytail\\" not found in marketplace \\"ponytail\\".","failureCode":"not_found"}\n',
  exitCode: 1,
};
const MARKETPLACE_OK = {
  stdout: '{"command":"marketplace-add","outcome":"ok","marketplace":"ponytail","message":"Successfully added marketplace: ponytail (declared in project settings)"}\n',
  exitCode: 0,
};
const MARKETPLACE_ARGV = ['plugin', 'marketplace', 'add', 'DietrichGebert/ponytail', '--scope', 'project', '--json'];
const argvFor = (scope: string) => ['plugin', 'install', 'ponytail', '--marketplace', 'DietrichGebert/ponytail', '--scope', scope, '--json'];

interface Response {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  outputExceeded?: boolean;
}

/** Responses keyed by the subcommand (`argv[1]`), consumed in order per key, with every
 * call recorded — so a test can assert the exact call sequence and cwd (plan review focus 1). */
function scriptedRunner(script: { list?: Response[]; install?: Response[]; marketplace?: Response[] }) {
  const calls: { argv: string[]; cwd?: string }[] = [];
  const queues: Record<string, Response[]> = {
    list: [...(script.list ?? [])],
    install: [...(script.install ?? [])],
    // project scope declares the marketplace first; it succeeds unless a test says otherwise
    marketplace: [...(script.marketplace ?? [MARKETPLACE_OK])],
  };
  const runner: CommandRunner = {
    async run(input) {
      calls.push({ argv: input.argv, cwd: input.cwd });
      const next = queues[input.argv[1]]?.shift();
      if (!next) throw new Error(`unscripted call: ${input.argv.join(' ')}`);
      return {
        stdout: next.stdout,
        stderr: next.stderr ?? '',
        exitCode: next.exitCode === undefined ? 0 : next.exitCode,
        timedOut: next.timedOut ?? false,
        outputExceeded: next.outputExceeded ?? false,
      };
    },
  };
  const subcommands = () => calls.map((c) => c.argv[1]);
  return { calls, subcommands, root: createIntegrationsCompositionRoot({ runner }) };
}

const rejectingRoot = () =>
  createIntegrationsCompositionRoot({
    runner: {
      async run() {
        throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      },
    },
  });

async function render(tree: Tree, options: Parameters<typeof installIntegrationGenerator>[1], root: ReturnType<typeof rejectingRoot>) {
  const logs: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((msg) => {
    logs.push(String(msg));
  });
  try {
    await installIntegrationGenerator(tree, options, { integrationsRoot: root });
  } finally {
    spy.mockRestore();
  }
  return logs.join('\n');
}

describe('installIntegrationGenerator', () => {
  let dir: string;
  let tree: Tree;
  const manifestPath = () => join(dir, 'archweave-integrations.json');
  const configPath = () => join(dir, 'toolkit.config.json');
  const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
  const savedNxDryRun = process.env['NX_DRY_RUN'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archweave-install-integration-'));
    tree = { root: dir } as Tree;
    // an init-ed workspace: the declaration has a file to merge into
    writeFileSync(configPath(), '{\n  "locale": "en"\n}\n');
    delete process.env['NX_DRY_RUN'];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedNxDryRun === undefined) delete process.env['NX_DRY_RUN'];
    else process.env['NX_DRY_RUN'] = savedNxDryRun;
  });

  describe('preview (default)', () => {
    it('one read-only list call in the workspace, no install, no writes; shows source, license, version and the command', async () => {
      const s = scriptedRunner({ list: [ABSENT] });
      const out = await render(tree, { tool: 'ponytail' }, s.root);
      expect(s.calls).toEqual([{ argv: ['plugin', 'list', '--json'], cwd: dir }]);
      expect(existsSync(manifestPath())).toBe(false);
      expect(readFileSync(configPath(), 'utf8')).toBe('{\n  "locale": "en"\n}\n');
      expect(out).toContain('https://github.com/DietrichGebert/ponytail');
      expect(out).toContain('License: MIT');
      expect(out).toContain('decided by the marketplace');
      expect(out).toContain('claude plugin install ponytail --marketplace DietrichGebert/ponytail --scope project');
      expect(out).toContain('install-integration --tool=ponytail --apply');
      expect(out).toMatch(/preview/i);
      expect(out).not.toMatch(/nothing was executed/); // the read-only list did run
    });

    it('--versionRange is shown as requested and explicitly not enforced', async () => {
      const out = await render(tree, { tool: 'ponytail', versionRange: '4.7.0' }, scriptedRunner({ list: [ABSENT] }).root);
      expect(out).toContain('Requested version: 4.7.0');
      expect(out).toMatch(/not enforced/);
    });

    it('project scope names the workspace file Claude Code will change', async () => {
      const out = await render(tree, { tool: 'ponytail', scope: 'project' }, scriptedRunner({ list: [ABSENT] }).root);
      expect(out).toContain('.claude/settings.json');
      expect(out).toContain('--scope project');
      expect(out).toContain('install-integration --tool=ponytail --apply --scope=project');
      expect(out).toContain('Would run: claude plugin marketplace add DietrichGebert/ponytail --scope project\nWould run: claude plugin install');
    });

    it('already installed: says what would be recorded and declared, writes nothing', async () => {
      const s = scriptedRunner({ list: [ENABLED, ENABLED] });
      const out = await render(tree, { tool: 'ponytail' }, s.root);
      expect(s.subcommands()).not.toContain('install');
      expect(existsSync(manifestPath())).toBe(false);
      expect(readJson(configPath())).toEqual({ locale: 'en' });
      expect(out).toContain('would get this entry');
      expect(out).toMatch(/would be added/);
    });

    it("Nx's own --dry-run wins over --apply: nothing runs but the read-only check", async () => {
      process.env['NX_DRY_RUN'] = 'true';
      const s = scriptedRunner({ list: [ABSENT] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list']);
      expect(out).toMatch(/--apply was ignored/);
    });

    it('two previews print byte-identical output, and no absolute or home path', async () => {
      const a = await render(tree, { tool: 'ponytail' }, scriptedRunner({ list: [ABSENT] }).root);
      const b = await render(tree, { tool: 'ponytail' }, scriptedRunner({ list: [ABSENT] }).root);
      expect(a).toBe(b);
      expect(a).not.toContain(dir);
      expect(a).not.toContain(homedir());
    });
  });

  describe('--apply', () => {
    it('absent: list → install → list in the workspace, then records the manifest and declares the integration', async () => {
      const s = scriptedRunner({ list: [ABSENT, ENABLED], install: [INSTALL_OK] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list', 'marketplace', 'install', 'list']);
      expect(s.calls[1]).toEqual({ argv: MARKETPLACE_ARGV, cwd: dir });
      expect(s.calls[2]).toEqual({ argv: argvFor('project'), cwd: dir });
      expect(s.calls.every((c) => c.cwd === dir)).toBe(true);
      expect(readJson(manifestPath()).integrations.ponytail).toMatchObject({
        source: 'DietrichGebert/ponytail',
        managedBy: 'nx-archweave',
        verification: 'passed',
        evidenceKind: 'claude-cli',
        version: '4.8.4',
        target: 'claude-code',
      });
      expect(readJson(configPath())).toEqual({ locale: 'en', integrations: { enabled: ['ponytail'] } });
      expect(out).toContain('Recorded');
      expect(out).toMatch(/applied/i);
    });

    it('install exited 0 but the fresh re-verification does not see it: zero writes, and the rerun is install-integration', async () => {
      const s = scriptedRunner({ list: [ABSENT, ABSENT], install: [INSTALL_OK] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(existsSync(manifestPath())).toBe(false);
      expect(readJson(configPath())).toEqual({ locale: 'en' });
      expect(out).toMatch(/did not confirm/i);
      expect(out).toContain('install-integration --tool=ponytail --apply');
      expect(out).not.toContain('record-integration');
    });

    it('install exited 0 but the plugin came back disabled: zero writes', async () => {
      const s = scriptedRunner({ list: [ABSENT, LIST(entry('user', false))], install: [INSTALL_OK] });
      await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(existsSync(manifestPath())).toBe(false);
      expect(readJson(configPath())).toEqual({ locale: 'en' });
    });

    it('install failed: the state is re-checked read-only, nothing is written when it is still absent, the CLI message is shown', async () => {
      const s = scriptedRunner({ list: [ABSENT, ABSENT], install: [INSTALL_FAILED] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list', 'marketplace', 'install', 'list']);
      expect(existsSync(manifestPath())).toBe(false);
      expect(out).toContain('not found in marketplace');
      expect(out).toContain('install-integration --tool=ponytail --apply');
    });

    it('install timed out but the plugin is in fact installed: the re-check records it and says so', async () => {
      const s = scriptedRunner({ list: [ABSENT, ENABLED], install: [{ stdout: '', timedOut: true, exitCode: null }] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(readJson(manifestPath()).integrations.ponytail.verification).toBe('passed');
      expect(out).toMatch(/reported.*timeout.*fresh check/is);
    });

    it('home paths in a failure message are redacted', async () => {
      const stderr = `fatal: could not create work tree dir '${homedir()}/.claude/plugins/marketplaces/x': Permission denied\n`;
      const s = scriptedRunner({ list: [ABSENT, ABSENT], install: [{ stdout: '', stderr, exitCode: 128 }] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(out).toContain('~/.claude/plugins');
      expect(out).not.toContain(homedir());
    });

    it('project scope: the marketplace is declared in the workspace first, and the report says so', async () => {
      const s = scriptedRunner({ list: [ABSENT, ENABLED], install: [INSTALL_OK] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(out).toContain(
        'For teammates (project scope), the marketplace is declared in .claude/settings.json first: claude plugin marketplace add DietrichGebert/ponytail --scope project',
      );
      expect(out).toContain('Marketplace: declared in .claude/settings.json (extraKnownMarketplaces)');
    });

    it("the rerun command uses the workspace's own package manager (npm here)", async () => {
      writeFileSync(join(dir, 'package-lock.json'), '{}');
      const s = scriptedRunner({ list: [ABSENT], marketplace: [{ stdout: '{"outcome":"failed","message":"x"}\n', exitCode: 1 }] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(out).toContain('rerun: npm exec nx -- g @clearlydev/nx-archweave:install-integration --tool=ponytail --apply');
      expect(out).not.toContain('pnpm nx g');
    });

    it('a failed marketplace declaration installs nothing and writes nothing', async () => {
      const failed = { stdout: '{"command":"marketplace-add","outcome":"failed","message":"Failed to clone"}\n', exitCode: 1 };
      const s = scriptedRunner({ list: [ABSENT], marketplace: [failed] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list', 'marketplace']);
      expect(existsSync(manifestPath())).toBe(false);
      expect(out).toContain('Marketplace declaration: failed — Failed to clone');
      expect(out).toContain('Nothing was installed. Once resolved, rerun: pnpm nx g @clearlydev/nx-archweave:install-integration --tool=ponytail --apply');
    });

    it.each(['user', 'local'] as const)('--scope=%s declares nothing (it stays personal)', async (scope) => {
      const s = scriptedRunner({ list: [ABSENT, LIST(entry(scope))], install: [INSTALL_OK] });
      const out = await render(tree, { tool: 'ponytail', apply: true, scope }, s.root);
      expect(s.subcommands()).toEqual(['list', 'install', 'list']);
      expect(out).not.toContain('marketplace add');
    });

    it('already installed at project scope: the declaration is backfilled, then recorded', async () => {
      const s = scriptedRunner({ list: [LIST(entry('project')), LIST(entry('project'))] });
      await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list', 'marketplace', 'list']);
      expect(readJson(manifestPath()).integrations.ponytail.verification).toBe('passed');
    });

    it('a failed backfill still records the verified install, and says the declaration is missing', async () => {
      const failed = { stdout: '{"command":"marketplace-add","outcome":"failed","message":"Failed to clone"}\n', exitCode: 1 };
      const s = scriptedRunner({ list: [LIST(entry('project')), LIST(entry('project'))], marketplace: [failed] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(readJson(manifestPath()).integrations.ponytail.verification).toBe('passed');
      expect(out).toContain('Marketplace declaration: failed — Failed to clone');
      expect(out).toContain(
        'Declaring the marketplace for teammates did not succeed — run it yourself to see why: claude plugin marketplace add DietrichGebert/ponytail --scope project',
      );
    });

    it('already installed and enabled: never runs the install, records and declares what is verified', async () => {
      const s = scriptedRunner({ list: [ENABLED, ENABLED] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list', 'list']);
      expect(readJson(manifestPath()).integrations.ponytail.verification).toBe('passed');
      expect(readJson(configPath()).integrations.enabled).toEqual(['ponytail']);
      expect(out).toMatch(/already installed/i);
    });

    it('already installed at another scope than the one explicitly asked for: no install, no writes, both ways out named', async () => {
      const s = scriptedRunner({ list: [ENABLED] });
      const out = await render(tree, { tool: 'ponytail', scope: 'project', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list']);
      expect(existsSync(manifestPath())).toBe(false);
      expect(readJson(configPath())).toEqual({ locale: 'en' });
      expect(out).toContain('user scope');
      expect(out).toContain('install-integration --tool=ponytail --apply --scope=user');
      expect(out).toContain('claude plugin uninstall ponytail@ponytail --scope user');
      expect(out).toMatch(/nothing is installed again/);
    });

    it('a managed-scope install cannot be moved: the rerun only records it, and the message says so', async () => {
      const s = scriptedRunner({ list: [LIST(entry('managed'))] });
      const out = await render(tree, { tool: 'ponytail', scope: 'project', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list']);
      expect(existsSync(manifestPath())).toBe(false);
      expect(out).toContain('install-integration --tool=ponytail --apply');
      expect(out).not.toContain('--scope=managed');
      expect(out).toMatch(/nothing is installed again/);
    });

    it('without an explicit --scope, an install at any scope counts as installed', async () => {
      const s = scriptedRunner({ list: [LIST(entry('project')), LIST(entry('project'))] });
      await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(readJson(manifestPath()).integrations.ponytail.verification).toBe('passed');
    });

    it('a differing existing manifest entry is reported as a conflict and replaced by the freshly verified one', async () => {
      writeFileSync(manifestPath(), JSON.stringify({ integrations: { ponytail: { source: 'old', repository: 'r', method: 'm', managedBy: 'external-tool', verification: 'failed' } } }));
      const s = scriptedRunner({ list: [ENABLED, ENABLED] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(out).toContain('Conflict');
      expect(readJson(manifestPath()).integrations.ponytail.verification).toBe('passed');
    });

    it('installed but disabled: no install, no writes, enable guidance and a rerun that records AND declares', async () => {
      const s = scriptedRunner({ list: [LIST(entry('user', false))] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list']);
      expect(existsSync(manifestPath())).toBe(false);
      expect(out).toContain('claude plugin enable ponytail@ponytail');
      expect(out).toContain('install-integration --tool=ponytail --apply');
    });

    it('ambiguous (the same plugin at two scopes): no install, and it says what it actually found', async () => {
      const s = scriptedRunner({ list: [LIST(entry('user'), entry('project'))] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list']);
      expect(existsSync(manifestPath())).toBe(false);
      expect(out).toMatch(/more than one installed plugin/i);
      expect(out).not.toMatch(/could not list/i);
    });

    it('claude CLI not found: no install attempt, zero writes, terminal-first guidance carrying the scope', async () => {
      const out = await render(tree, { tool: 'ponytail', scope: 'local', apply: true }, rejectingRoot());
      expect(existsSync(manifestPath())).toBe(false);
      expect(out).toContain('npm install -g @anthropic-ai/claude-code');
      expect(out).toContain('install-integration --tool=ponytail --apply --scope=local');
    });

    it('the list call fails (timeout): no install is attempted on a CLI that cannot even list', async () => {
      const s = scriptedRunner({ list: [{ stdout: '', timedOut: true, exitCode: null }] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(s.subcommands()).toEqual(['list']);
      expect(out).toContain('timeout');
    });

    it('no toolkit.config.json: the manifest is recorded, the config is NOT created, and the report says why', async () => {
      rmSync(configPath());
      const s = scriptedRunner({ list: [ENABLED, ENABLED] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(existsSync(manifestPath())).toBe(true);
      expect(existsSync(configPath())).toBe(false);
      expect(out).toMatch(/no toolkit\.config\.json/);
    });

    it('an unrecognized toolkit.config.json is reported and left untouched while the manifest is still recorded', async () => {
      writeFileSync(configPath(), '{ not json');
      const s = scriptedRunner({ list: [ENABLED, ENABLED] });
      const out = await render(tree, { tool: 'ponytail', apply: true }, s.root);
      expect(readFileSync(configPath(), 'utf8')).toBe('{ not json');
      expect(existsSync(manifestPath())).toBe(true);
      expect(out).toMatch(/not updated/i);
    });

    it('a declaration write that fails is reported, not thrown — the report still prints', async () => {
      const s = scriptedRunner({ list: [ENABLED, ENABLED] });
      const view = await runInstallIntegration(tree, { tool: 'ponytail', apply: true }, {
        integrationsRoot: s.root,
        declare: () => {
          throw new Error(`EACCES: permission denied, open '${homedir()}/x'`);
        },
      });
      expect(view.declaration).toMatchObject({ action: 'write-failed' });
      expect(JSON.stringify(view.declaration)).not.toContain(homedir());
      expect(existsSync(manifestPath())).toBe(true);
    });
  });

  it('rejects an unsupported tool and an unsupported target with clear errors', async () => {
    const { root } = scriptedRunner({ list: [ABSENT] });
    await expect(
      installIntegrationGenerator(tree, { tool: 'taste-skill' as unknown as 'ponytail' }, { integrationsRoot: root }),
    ).rejects.toThrow(/unsupported/i);
    await expect(
      installIntegrationGenerator(tree, { tool: 'ponytail', target: 'codex' as unknown as 'claude-code' }, { integrationsRoot: root }),
    ).rejects.toThrow(/not supported/i);
  });
});
