import { homedir } from 'node:os';
import type { ApprovedInstallPlan, InstallResult } from '../../contracts/integration.ts';
import type { CommandRunner } from '../../process/command-runner.ts';
import type { PluginCatalogEntry } from '../../catalog/plugin-catalog.ts';

// The chat path — Claude Code's two slash commands, kept as the ALTERNATIVE every
// degradation message ends with. add-integration's preview and install-integration's
// reports both read this one list.
export function manualInstallSteps(entry: PluginCatalogEntry): string[] {
  const distribution = entry.hosts['claude-code'];
  if (distribution === undefined) return [`See ${entry.installDocs} for the official instructions.`];
  return [
    `In Claude Code, send this as its own prompt: /plugin marketplace add ${distribution.marketplace}`,
    `Then, as a second separate prompt: /plugin install ${distribution.pluginId}`,
    `See ${entry.installDocs} for the official instructions.`,
  ];
}

// Install-specific limits: a plugin install
// clones a marketplace repository, so it gets far more time than the 5 s
// read-only `plugin list` call, and a wider stderr budget for git chatter.
export const CLAUDE_CLI_INSTALL_TIMEOUT_MS = 120_000;
export const CLAUDE_CLI_INSTALL_STDOUT_LIMIT_BYTES = 1_048_576; // 1 MiB
export const CLAUDE_CLI_INSTALL_STDERR_LIMIT_BYTES = 262_144; // 256 KiB

/** What install-integration tells a person to rerun when the caller passes nothing
 * (install-integration itself always passes one, with the workspace's own nx). */
export function defaultRerunCommand(entry: PluginCatalogEntry, runNx = 'pnpm nx'): string {
  return `${runNx} g @clearlydev/nx-archweave:install-integration --tool=${entry.id} --apply`;
}

function chatAlternative(entry: PluginCatalogEntry): string[] {
  return ['Alternatively, inside a Claude Code session (the chat path):', ...manualInstallSteps(entry)];
}
const MARKETPLACE_NOTE =
  'If the marketplace was registered before the failure, it stays in your user settings — see `claude plugin marketplace list`.';

// Terminal-first degradation: a developer
// who lives in a terminal is told how to get or update the CLI and rerun —
// the slash commands are an alternative, never the headline.
export function claudeCliNotFoundSteps(entry: PluginCatalogEntry, rerunCommand: string): string[] {
  return [
    'The claude CLI was not found on PATH. Install the Claude Code CLI from your terminal: ' +
      'npm install -g @anthropic-ai/claude-code (setup guide: https://code.claude.com/docs/en/setup)',
    `Then rerun: ${rerunCommand}`,
    ...chatAlternative(entry),
  ];
}

export function claudeCliUnsupportedSteps(entry: PluginCatalogEntry, rerunCommand: string, cliSaid: string): string[] {
  return [
    `Your claude CLI does not know this command (it said: ${cliSaid}). Scriptable plugin install needs ` +
      'Claude Code 2.1.285 or newer: run `claude update`, or reinstall it with npm install -g @anthropic-ai/claude-code@latest',
    `Then rerun: ${rerunCommand}`,
    ...chatAlternative(entry),
  ];
}

/** What actually happened when the official command ran. Richer than
 * the generic InstallResult so install-integration can render the right
 * guidance; `createClaudeMarketplaceInstall` narrows it back to the contract. */
export type ClaudePluginInstallDetail =
  | { kind: 'executed' }
  | { kind: 'manual-only' }
  | { kind: 'cli-not-found' }
  | { kind: 'failed-to-start'; code: string }
  | { kind: 'cli-unsupported'; stderrTail: string }
  | { kind: 'confirmation-required'; message: string }
  | { kind: 'failed'; failureCode?: string; message: string }
  | { kind: 'timeout' }
  | { kind: 'output-too-large' };

export interface ClaudeMarketplaceInstallDependencies {
  runner: CommandRunner;
}

export interface ClaudeMarketplaceInstallOptions {
  /** Directory the CLI runs in — the workspace root, so project/local scope lands there. */
  cwd?: string;
  /** The command the guidance tells a person to rerun (carries their --scope). */
  rerunCommand?: string;
}

const TAIL_CHARS = 500;
// claude's own commander error for a subcommand/flag an old CLI does not know —
// deliberately narrow, so a child process's (git's) "unknown option" is not
// mistaken for an outdated claude CLI.
const UNSUPPORTED_CLI_PATTERN = /error: unknown (command|option) '(plugin|install|marketplace|--json|--marketplace|--scope)'/;

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > TAIL_CHARS ? trimmed.slice(-TAIL_CHARS) : trimmed;
}

const ESCAPED_HOME = homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole path segment only: a home of /Users/j must not eat the head of /Users/jane.
const HOME_PATTERN = new RegExp(`${ESCAPED_HOME}(?=[/\\\\\\s'"\`]|$)`, 'g');

/** Output a person sees must never carry their home directory: the current home,
 * and the common home shapes, become `~`. */
export function redactHomePaths(text: string): string {
  let out = ESCAPED_HOME.length > 1 ? text.replace(HOME_PATTERN, '~') : text;
  out = out.replace(/\/(?:Users|home)\/[^/\s'"`]+/g, '~');
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s'"`]+/g, '~');
  out = out.replace(/\/root(?=[/\s'"`]|$)/g, '~');
  return out;
}

/** `--json` prints one machine-readable object line, but the CLI may print
 * human lines around it (a human line was measured AFTER the JSON on
 * failure). Scan from the end for the last line that parses as an object. */
function parseLastJsonObject(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // not JSON after all — keep scanning upwards
    }
  }
  return null;
}

/** The command as a person would type it (no --json) — shared by the guidance
 * below and the add-/install-integration previews, so all three show one string. */
export function renderUserCommand(command: { executable: string; args: string[] }): string {
  return [command.executable, ...command.args.filter((arg) => arg !== '--json')].join(' ');
}

// Mirrors verify-via-claude-cli's central rule, tightened: only a spawn
// rejection with ENOENT is "not found"; every other failure is classified on
// its own and none is ever reported as success — the exit code, the JSON
// outcome and (in install-integration) a fresh `plugin list` all have to agree
// before anything is recorded.
async function classifyRun(
  runner: CommandRunner,
  command: { executable: string; args: string[] },
  cwd: string | undefined,
): Promise<ClaudePluginInstallDetail> {
  let raw: Awaited<ReturnType<CommandRunner['run']>>;
  try {
    raw = await runner.run({
      executable: command.executable,
      argv: command.args,
      ...(cwd === undefined ? {} : { cwd }),
      timeoutMs: CLAUDE_CLI_INSTALL_TIMEOUT_MS,
      stdoutLimitBytes: CLAUDE_CLI_INSTALL_STDOUT_LIMIT_BYTES,
      stderrLimitBytes: CLAUDE_CLI_INSTALL_STDERR_LIMIT_BYTES,
    });
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'unknown';
    return code === 'ENOENT' ? { kind: 'cli-not-found' } : { kind: 'failed-to-start', code };
  }

  if (raw.timedOut) return { kind: 'timeout' };
  if (raw.outputExceeded) return { kind: 'output-too-large' };

  const json = parseLastJsonObject(raw.stdout);
  const jsonSaysFailed = json !== null && json['outcome'] === 'failed';
  if (raw.exitCode === 0 && !jsonSaysFailed) return { kind: 'executed' };

  if (json !== null) {
    const message = redactHomePaths(
      typeof json['message'] === 'string' ? json['message'] : `the claude CLI exited with code ${raw.exitCode}`,
    );
    const failureCode = typeof json['failureCode'] === 'string' ? json['failureCode'] : undefined;
    // Only the CLI's documented signal counts: a shownCommand object (whose sha256
    // `--accept-command` would take — `claude plugin install --help`). No guessing
    // from failure codes or message wording.
    const shown = json['shownCommand'];
    if (typeof shown === 'object' && shown !== null) return { kind: 'confirmation-required', message };
    return failureCode === undefined ? { kind: 'failed', message } : { kind: 'failed', failureCode, message };
  }

  // The unsupported-CLI check reads the WHOLE bounded stderr: help text printed
  // after the error line must not hide it.
  if (UNSUPPORTED_CLI_PATTERN.test(raw.stderr)) {
    const line = raw.stderr.split('\n').find((l) => UNSUPPORTED_CLI_PATTERN.test(l)) ?? '';
    return { kind: 'cli-unsupported', stderrTail: redactHomePaths(line.trim()) };
  }
  const said = redactHomePaths(tail(raw.stderr.length > 0 ? raw.stderr : raw.stdout));
  return { kind: 'failed', message: said.length > 0 ? said : `the claude CLI exited with code ${raw.exitCode}` };
}

function manualStepsFor(
  entry: PluginCatalogEntry,
  detail: ClaudePluginInstallDetail,
  command: { executable: string; args: string[] } | null,
  rerunCommand: string,
): string[] {
  const chat = chatAlternative(entry);
  const userCommand = command === null ? '' : renderUserCommand(command);
  const rerun = `Once resolved, rerun to install, verify and record it: ${rerunCommand}`;
  switch (detail.kind) {
    case 'executed':
      return [];
    case 'manual-only':
      return manualInstallSteps(entry);
    case 'cli-not-found':
      return claudeCliNotFoundSteps(entry, rerunCommand);
    case 'failed-to-start':
      return [
        `The claude CLI was found but could not be started (${detail.code}) — check its permissions and your system limits.`,
        rerun,
        ...chat,
      ];
    case 'cli-unsupported':
      return claudeCliUnsupportedSteps(entry, rerunCommand, detail.stderrTail);
    case 'confirmation-required':
      return [
        `The marketplace declares a command that must be confirmed by a person; nx-archweave never accepts it for you (${detail.message})`,
        `Review it and run the install yourself: ${userCommand}`,
        rerun,
        ...chat,
      ];
    case 'failed':
      return [`The install command did not succeed: ${detail.message}`, MARKETPLACE_NOTE, rerun, ...chat];
    case 'timeout':
      return [
        `The install command did not finish within ${CLAUDE_CLI_INSTALL_TIMEOUT_MS / 1000} s and was stopped.`,
        MARKETPLACE_NOTE,
        rerun,
        ...chat,
      ];
    case 'output-too-large':
      return [
        'The install command produced more output than nx-archweave is willing to buffer and was stopped.',
        `Run it yourself to see the full output: ${userCommand}`,
        rerun,
        ...chat,
      ];
  }
}

/** Only called after user approval (`ApprovedInstallPlan`
 * is constructed by install-integration solely on `--apply`). Runs the plan's
 * single official command through the runner and classifies the run; a plan
 * without a scriptable command (another host, not implemented) executes nothing
 * and returns the chat steps. */
export async function installClaudeMarketplacePlugin(
  entry: PluginCatalogEntry,
  deps: ClaudeMarketplaceInstallDependencies,
  plan: ApprovedInstallPlan,
  options: ClaudeMarketplaceInstallOptions = {},
): Promise<{ result: InstallResult; detail: ClaudePluginInstallDetail }> {
  const rerunCommand = options.rerunCommand ?? defaultRerunCommand(entry);
  const detail: ClaudePluginInstallDetail =
    plan.officialCommand === null ? { kind: 'manual-only' } : await classifyRun(deps.runner, plan.officialCommand, options.cwd);
  const executed = detail.kind === 'executed';
  const result: InstallResult = {
    executed,
    // One command: it either reached exit 0 or it did not. What a failed run may
    // have left behind is re-checked live by install-integration, not guessed here.
    partialFailure: false,
    filesCreated: [],
    // The workspace files the plan said the host would change (project/local scope);
    // Claude's own plugin store is outside the workspace and never listed.
    filesModified: executed ? [...plan.filesModified] : [],
    manualStepsRemaining: manualStepsFor(entry, detail, plan.officialCommand, rerunCommand),
  };
  return { result, detail };
}

/** Project scope only: Claude Code's own command that declares
 * the marketplace in the workspace's `.claude/settings.json` (`extraKnownMarketplaces`), so
 * the committed file carries where the plugin comes from, not only that it is enabled —
 * `plugin install --marketplace` alone registers it in the installing user's settings.
 * Measured (Claude Code 2.1.300): idempotent ("already on disk — declared in project
 * settings"), other entries kept, and once it is declared there `plugin install
 * --marketplace` no longer adds it to user settings. nx-archweave still writes none of
 * Claude Code's files itself. */
export function projectMarketplaceCommand(entry: PluginCatalogEntry): { executable: string; args: string[] } | null {
  const distribution = entry.hosts['claude-code'];
  if (distribution === undefined) return null;
  return {
    executable: 'claude',
    args: ['plugin', 'marketplace', 'add', distribution.marketplace, '--scope', 'project', '--json'],
  };
}

/** Runs projectMarketplaceCommand — only after approval (--apply), classified like the
 * install itself. */
export async function declareProjectMarketplace(
  entry: PluginCatalogEntry,
  deps: ClaudeMarketplaceInstallDependencies,
  options: Pick<ClaudeMarketplaceInstallOptions, 'cwd'> = {},
): Promise<ClaudePluginInstallDetail> {
  const command = projectMarketplaceCommand(entry);
  return command === null ? { kind: 'manual-only' } : classifyRun(deps.runner, command, options.cwd);
}

// Factory, not a singleton: the caller supplies the runner.
export function createClaudeMarketplaceInstall(
  entry: PluginCatalogEntry,
  deps: ClaudeMarketplaceInstallDependencies,
): (plan: ApprovedInstallPlan) => Promise<InstallResult> {
  return async (plan: ApprovedInstallPlan): Promise<InstallResult> =>
    (await installClaudeMarketplacePlugin(entry, deps, plan)).result;
}
