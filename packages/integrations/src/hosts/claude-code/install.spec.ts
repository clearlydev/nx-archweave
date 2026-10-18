import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_CLI_INSTALL_TIMEOUT_MS,
  manualInstallSteps,
  claudeCliNotFoundSteps,
  claudeCliUnsupportedSteps,
  createClaudeMarketplaceInstall,
  installClaudeMarketplacePlugin,
  redactHomePaths,
} from './install.ts';
import type { ApprovedInstallPlan } from '../../contracts/integration.ts';
import { createFakeCommandRunner } from '../../process/read-only-command-runner.ts';
import type { CommandRunner } from '../../process/command-runner.ts';
import { getCatalogEntry } from '../../catalog/plugin-catalog.ts';

const PONYTAIL = getCatalogEntry('ponytail')!;

const CLAUDE_INSTALL_ARGS = ['plugin', 'install', 'ponytail', '--marketplace', 'DietrichGebert/ponytail', '--scope', 'user', '--json'];
const RERUN = 'pnpm nx g @clearlydev/nx-archweave:install-integration --tool=ponytail --apply';

function approvedPlan(overrides: Partial<ApprovedInstallPlan> = {}): ApprovedInstallPlan {
  return {
    officialCommand: { executable: 'claude', args: CLAUDE_INSTALL_ARGS },
    resolvedVersion: '4.8.4',
    filesCreated: [],
    filesModified: [],
    conflicts: [],
    sourceRepository: 'https://github.com/DietrichGebert/ponytail',
    officialHomepage: 'https://ponytail.dev',
    license: 'MIT',
    requiresManualExecution: false,
    approvedBy: 'user',
    ...overrides,
  };
}

function rejectingRunner(code: string): CommandRunner {
  return {
    async run() {
      throw Object.assign(new Error(`spawn claude ${code}`), { code });
    },
  };
}

const FAILED_JSON = JSON.stringify({
  command: 'install',
  outcome: 'failed',
  plugin: 'ponytail@ponytail',
  scope: 'user',
  message: 'Plugin "ponytail" not found in marketplace "ponytail".',
  failureCode: 'not_found',
});

describe('installClaudeMarketplacePlugin (ponytail) — classification', () => {
  it('executed: exit 0 → executed:true, nothing left to do by hand, and the plan\'s workspace files reported', async () => {
    const runner = createFakeCommandRunner({ stdout: '{"command":"install","outcome":"installed","plugin":"ponytail@ponytail","scope":"project"}\n' });
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, 
      { runner },
      approvedPlan({ filesModified: ['.claude/settings.json'] }),
    );
    expect(detail).toEqual({ kind: 'executed' });
    expect(result.executed).toBe(true);
    expect(result.partialFailure).toBe(false);
    expect(result.manualStepsRemaining).toEqual([]);
    expect(result.filesModified).toEqual(['.claude/settings.json']);
  });

  it('runs exactly the plan\'s command, with the install timeout and the workspace as cwd — never a shell string', async () => {
    const calls: { executable: string; argv: string[]; timeoutMs: number; cwd?: string }[] = [];
    const runner: CommandRunner = {
      async run(input) {
        calls.push({ executable: input.executable, argv: input.argv, timeoutMs: input.timeoutMs, cwd: input.cwd });
        return { stdout: '{"outcome":"installed"}', stderr: '', exitCode: 0, timedOut: false, outputExceeded: false };
      },
    };
    await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan(), { cwd: '/ws' });
    expect(calls).toEqual([{ executable: 'claude', argv: CLAUDE_INSTALL_ARGS, timeoutMs: CLAUDE_CLI_INSTALL_TIMEOUT_MS, cwd: '/ws' }]);
    expect(CLAUDE_CLI_INSTALL_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('cli-not-found: only an ENOENT rejection is "not found" — terminal-first guidance, never executed', async () => {
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner: rejectingRunner('ENOENT') }, approvedPlan());
    expect(detail).toEqual({ kind: 'cli-not-found' });
    expect(result.executed).toBe(false);
    expect(result.manualStepsRemaining).toEqual(claudeCliNotFoundSteps(PONYTAIL, RERUN));
  });

  it('failed-to-start: any other spawn rejection (EACCES, EMFILE, …) is its own outcome, not "not on PATH"', async () => {
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner: rejectingRunner('EACCES') }, approvedPlan());
    expect(detail).toEqual({ kind: 'failed-to-start', code: 'EACCES' });
    expect(result.executed).toBe(false);
    expect(result.manualStepsRemaining.join('\n')).toContain('EACCES');
    expect(result.manualStepsRemaining.join('\n')).not.toContain('not found on PATH');
  });

  it('terminal-first guidance: install the CLI, rerun install-integration, and only then the chat slash commands', () => {
    const joined = claudeCliNotFoundSteps(PONYTAIL, RERUN).join('\n');
    const npmIndex = joined.indexOf('npm install -g @anthropic-ai/claude-code');
    const rerunIndex = joined.indexOf(RERUN);
    const slashIndex = joined.indexOf('/plugin marketplace add');
    expect(npmIndex).toBeGreaterThanOrEqual(0);
    expect(rerunIndex).toBeGreaterThan(npmIndex);
    expect(slashIndex).toBeGreaterThan(rerunIndex);
    expect(joined).toContain('https://code.claude.com/docs/en/setup');
  });

  it('the rerun command carries the caller\'s scope', async () => {
    const rerun = `${RERUN} --scope=project`;
    const { result } = await installClaudeMarketplacePlugin(PONYTAIL, { runner: rejectingRunner('ENOENT') }, approvedPlan(), { rerunCommand: rerun });
    expect(result.manualStepsRemaining).toContain(`Then rerun: ${rerun}`);
  });

  it('cli-unsupported: claude\'s own unknown command/option error → update guidance that shows what the CLI said', async () => {
    const runner = createFakeCommandRunner({ stdout: '', stderr: "error: unknown command 'plugin'\n", exitCode: 1 });
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail.kind).toBe('cli-unsupported');
    expect(result.executed).toBe(false);
    const joined = result.manualStepsRemaining.join('\n');
    expect(joined).toContain('claude update');
    expect(joined).toContain('2.1.285');
    expect(joined).toContain("unknown command 'plugin'");
  });

  it('cli-unsupported is matched on the whole stderr, even when help text follows the error line', async () => {
    const stderr = `error: unknown option '--marketplace'\n${'Usage: claude plugin install [options] <plugin>\n'.repeat(40)}`;
    const runner = createFakeCommandRunner({ stdout: '', stderr, exitCode: 1 });
    const { detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail.kind).toBe('cli-unsupported');
  });

  it('a git "unknown option" from a child process is a plain failure, not "update your claude CLI"', async () => {
    const runner = createFakeCommandRunner({ stdout: '', stderr: "error: unknown option `--filter=blob:none'\nfatal: clone failed\n", exitCode: 1 });
    const { detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail.kind).toBe('failed');
  });

  it('confirmation-required: a JSON result carrying a shownCommand object is reported as needing a person, never accepted', async () => {
    const json = JSON.stringify({
      command: 'install',
      outcome: 'failed',
      message: 'This plugin runs a marketplace-declared command; confirm it to continue.',
      shownCommand: { sha256: 'abc', command: 'curl …' },
    });
    const runner = createFakeCommandRunner({ stdout: `${json}\n`, exitCode: 1 });
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail.kind).toBe('confirmation-required');
    expect(result.executed).toBe(false);
    const joined = result.manualStepsRemaining.join('\n');
    expect(joined).toContain('never accepts it for you');
    expect(joined).toContain('claude plugin install ponytail --marketplace DietrichGebert/ponytail --scope user');
    expect(joined).not.toMatch(/\s-y\b|--yes|--accept-command/);
  });

  it('shownCommand: null, or a failure code that merely mentions acceptance, is a plain failure', async () => {
    const nullShown = JSON.stringify({ command: 'install', outcome: 'failed', message: 'nope', failureCode: 'not_found', shownCommand: null });
    expect((await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: nullShown, exitCode: 1 }) }, approvedPlan())).detail.kind).toBe('failed');
    const codeOnly = JSON.stringify({ command: 'install', outcome: 'failed', message: 'terms', failureCode: 'terms_not_accepted' });
    expect((await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: codeOnly, exitCode: 1 }) }, approvedPlan())).detail.kind).toBe('failed');
  });

  it('failed with JSON: carries failureCode and message, and the guidance repeats it and names the rerun that records it', async () => {
    const runner = createFakeCommandRunner({ stdout: `${FAILED_JSON}\n× Failed to install\n`, exitCode: 1 });
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail).toEqual({ kind: 'failed', failureCode: 'not_found', message: 'Plugin "ponytail" not found in marketplace "ponytail".' });
    expect(result.executed).toBe(false);
    const joined = result.manualStepsRemaining.join('\n');
    expect(joined).toContain('not found in marketplace');
    expect(joined).toContain(RERUN);
    expect(joined).toContain('claude plugin marketplace list');
  });

  it('parses the LAST JSON line of stdout — human lines before or after it do not break classification', async () => {
    const runner = createFakeCommandRunner({ stdout: `Fetching marketplace…\n${FAILED_JSON}\n× Failed\n`, exitCode: 1 });
    const { detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail.kind === 'failed' && detail.failureCode).toBe('not_found');
  });

  it('failed without JSON: falls back to the stderr tail as the message', async () => {
    const runner = createFakeCommandRunner({ stdout: '', stderr: "fatal: could not read Username for 'https://github.com'\n", exitCode: 128 });
    const { detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan());
    expect(detail.kind === 'failed' && detail.message).toContain('could not read Username');
  });

  it('home paths in what the CLI says are redacted before they reach any message', async () => {
    const home = homedir();
    const stderr = `fatal: could not create work tree dir '${home}/.claude/plugins/marketplaces/x': Permission denied\n`;
    const fromStderr = await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: '', stderr, exitCode: 128 }) }, approvedPlan());
    const json = JSON.stringify({ outcome: 'failed', message: 'cannot write /Users/jane/.claude/settings.json', failureCode: 'io' });
    const fromJson = await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: json, exitCode: 1 }) }, approvedPlan());
    for (const { result, detail } of [fromStderr, fromJson]) {
      const text = [JSON.stringify(detail), ...result.manualStepsRemaining].join('\n');
      expect(text).not.toContain(home);
      expect(text).not.toContain('/Users/jane');
      expect(text).toContain('~/.claude');
    }
  });

  it('exit 0 with outcome "failed" in the JSON is still a failure (the exit code is not the only truth)', async () => {
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: FAILED_JSON, exitCode: 0 }) }, approvedPlan());
    expect(detail.kind).toBe('failed');
    expect(result.executed).toBe(false);
    expect(result.filesModified).toEqual([]);
  });

  it('timeout and output-too-large are their own kinds, never not-found and never success', async () => {
    const timedOut = await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: '', timedOut: true, exitCode: null }) }, approvedPlan());
    expect(timedOut.detail).toEqual({ kind: 'timeout' });
    expect(timedOut.result.executed).toBe(false);
    const tooLarge = await installClaudeMarketplacePlugin(PONYTAIL, { runner: createFakeCommandRunner({ stdout: 'x', outputExceeded: true, exitCode: null }) }, approvedPlan());
    expect(tooLarge.detail).toEqual({ kind: 'output-too-large' });
  });

  it('a plan with no scriptable command (another host) executes nothing and returns the manual steps', async () => {
    let calls = 0;
    const runner: CommandRunner = {
      async run() {
        calls += 1;
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false, outputExceeded: false };
      },
    };
    const { result, detail } = await installClaudeMarketplacePlugin(PONYTAIL, { runner }, approvedPlan({ officialCommand: null, requiresManualExecution: true }));
    expect(calls).toBe(0);
    expect(detail).toEqual({ kind: 'manual-only' });
    expect(result.manualStepsRemaining).toEqual(manualInstallSteps(PONYTAIL));
  });
});

describe('claudeCliUnsupportedSteps', () => {
  it('leads with the update, then the rerun, then the chat alternative', () => {
    const joined = claudeCliUnsupportedSteps(PONYTAIL, RERUN, "error: unknown command 'plugin'").join('\n');
    expect(joined.indexOf('claude update')).toBeLessThan(joined.indexOf(RERUN));
    expect(joined.indexOf(RERUN)).toBeLessThan(joined.indexOf('/plugin marketplace add'));
  });
});

describe('redactHomePaths', () => {
  it('replaces the current home directory and common home-directory shapes with ~', () => {
    expect(redactHomePaths(`${homedir()}/x`)).toBe('~/x');
    expect(redactHomePaths('at /home/sam/.claude and /Users/jane/.config')).toBe('at ~/.claude and ~/.config');
    expect(redactHomePaths('C:\\Users\\Kim\\.claude')).toBe('~\\.claude');
    expect(redactHomePaths('/opt/tools/bin')).toBe('/opt/tools/bin');
  });

  it('replaces the current home only as a whole path segment, not as a prefix of a longer name', () => {
    // A home of /Users/j once turned /Users/jane/.config into ~ane/.config.
    expect(redactHomePaths(join(`${homedir()}extra`, 'x'))).toBe(join('~', 'x'));
  });
});

describe('createClaudeMarketplaceInstall (ponytail)', () => {
  it('returns the plain InstallResult the ToolIntegration contract expects', async () => {
    const install = createClaudeMarketplaceInstall(PONYTAIL, { runner: rejectingRunner('ENOENT') });
    const result = await install(approvedPlan());
    expect(result).toEqual({
      executed: false,
      partialFailure: false,
      filesCreated: [],
      filesModified: [],
      manualStepsRemaining: claudeCliNotFoundSteps(PONYTAIL, RERUN),
    });
  });
});

describe('manualInstallSteps(PONYTAIL)', () => {
  it('still names both slash commands (the chat alternative)', () => {
    expect(manualInstallSteps(PONYTAIL).some((step) => step.includes('/plugin marketplace add'))).toBe(true);
    expect(manualInstallSteps(PONYTAIL).some((step) => step.includes('/plugin install'))).toBe(true);
  });
});
