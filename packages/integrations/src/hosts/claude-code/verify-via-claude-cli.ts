import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReadOnlyCommandRunner } from '../../process/read-only-command-runner.ts';
import {
  CLAUDE_CLI_TIMEOUT_MS,
  CLAUDE_CLI_STDOUT_LIMIT_BYTES,
  CLAUDE_CLI_STDERR_LIMIT_BYTES,
} from '../../process/read-only-command-runner.ts';
import { parseClaudePluginList } from './parse-claude-plugin-list.ts';
import { matchClaudePlugin } from './match-claude-plugin.ts';
import { evaluateClaudeCliMatch, type ClaudeCliVerificationOutcome } from './claude-cli-verification-result.ts';

export type ClaudeCliVerificationResult =
  | { source: 'claude-cli'; outcome: ClaudeCliVerificationOutcome }
  | {
      source: 'claude-cli-unavailable';
      reason: 'not-found' | 'timeout' | 'non-zero-exit' | 'invalid-json' | 'unexpected-schema' | 'output-too-large';
    };

// The single most important behavioral rule in this file: only a rejected
// run() (the executable was never found/started) may ever suggest a fallback
// is possible. Every other failure — timeout, non-zero exit, malformed JSON,
// unexpected schema, oversized output — is reported as its own distinct,
// classified verification error, never silently treated as "not found".
export async function verifyViaClaudeCli(
  runner: ReadOnlyCommandRunner,
  pluginId: string,
  /** The workspace root: project/local-scope plugins are resolved relative to the
   * directory the CLI runs in. */
  cwd?: string,
): Promise<ClaudeCliVerificationResult> {
  let raw: Awaited<ReturnType<ReadOnlyCommandRunner['run']>>;
  try {
    raw = await runner.run({
      executable: 'claude',
      argv: ['plugin', 'list', '--json'],
      ...(cwd === undefined ? {} : { cwd }),
      timeoutMs: CLAUDE_CLI_TIMEOUT_MS,
      stdoutLimitBytes: CLAUDE_CLI_STDOUT_LIMIT_BYTES,
      stderrLimitBytes: CLAUDE_CLI_STDERR_LIMIT_BYTES,
    });
  } catch {
    return { source: 'claude-cli-unavailable', reason: 'not-found' };
  }

  if (raw.timedOut) {
    return { source: 'claude-cli-unavailable', reason: 'timeout' };
  }
  if (raw.outputExceeded) {
    // Never parse the (possibly partial) stdout already collected.
    return { source: 'claude-cli-unavailable', reason: 'output-too-large' };
  }
  if (raw.exitCode !== 0) {
    return { source: 'claude-cli-unavailable', reason: 'non-zero-exit' };
  }

  const parsed = parseClaudePluginList(raw.stdout, cwd === undefined ? {} : { isThisWorkspace: samePathAs(cwd) });
  if (!parsed.ok) {
    return {
      source: 'claude-cli-unavailable',
      reason: parsed.reason === 'invalid-json' ? 'invalid-json' : 'unexpected-schema',
    };
  }

  const match = matchClaudePlugin(parsed.entries, pluginId);
  // The plugin asked about, at a scope we cannot reason about (install over it, move it,
  // record it). Alone: still a distinct schema error, but only for that plugin. Next to a
  // known-scope entry: two entries verification cannot tell apart — ambiguous, never matched.
  if (parsed.otherScopeIds.includes(pluginId)) {
    return match.kind === 'absent'
      ? { source: 'claude-cli-unavailable', reason: 'unexpected-schema' }
      : { source: 'claude-cli', outcome: { status: 'ambiguous' } };
  }
  return { source: 'claude-cli', outcome: evaluateClaudeCliMatch(match) };
}

/** Symlinks resolved where the path exists (macOS /tmp is /private/tmp), else compared as given. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function samePathAs(workspaceRoot: string): (projectPath: string) => boolean {
  const root = canonical(workspaceRoot);
  return (projectPath) => canonical(projectPath) === root;
}
