import type { DetectionResult, IntegrationContext, VerificationResult } from '../../contracts/integration.ts';
import type { PluginCatalogEntry } from '../../catalog/plugin-catalog.ts';
import { detectWorkspacePackage } from './detect.ts';
import type { ReadOnlyCommandRunner } from '../../process/read-only-command-runner.ts';
import { verifyViaClaudeCli } from './verify-via-claude-cli.ts';
import { defaultRerunCommand } from './install.ts';

export interface ClaudeMarketplaceVerifierDependencies {
  runner: ReadOnlyCommandRunner;
  detect?: (entry: PluginCatalogEntry, context: IntegrationContext) => Promise<DetectionResult>;
}

export interface ClaudePluginVerificationDetail {
  result: VerificationResult;
  // Which signal actually produced `result` — not part of the generic
  // VerificationResult contract (that stays a plain boolean + problems, for
  // every integration), but needed by record-integration to enforce the
  // critical rule that a package.json-sourced verified:true is never
  // recordable. Both createClaudeMarketplaceVerifier (below) and
  // record-integration's generator share this one function so the source is
  // computed once, not re-derived or guessed at a second call site.
  source: 'claude-cli' | 'package-json';
}

// Verification order: the official claude plugin list --json
// signal is authoritative. The package.json check is a weak fallback used
// ONLY when the CLI itself could not be found — never when it is available
// but fails (timeout, non-zero exit, malformed JSON, unexpected schema,
// ambiguous match). Silently downgrading any of those other failures to the
// package.json check would let a verification error masquerade as "not
// installed," which is a different, materially more actionable outcome.
export async function verifyClaudeMarketplacePlugin(
  entry: PluginCatalogEntry,
  deps: ClaudeMarketplaceVerifierDependencies,
  context: IntegrationContext,
): Promise<ClaudePluginVerificationDetail> {
  const detect = deps.detect ?? detectWorkspacePackage;
  const pluginId = entry.hosts['claude-code']?.pluginId;
  if (pluginId === undefined) {
    // A programming error, not a verification outcome: no CLI ran, so no `source` would be
    // true — the same stance plan() takes for an unsupported host.
    throw new Error(`${entry.displayName} has no Claude Code distribution — it cannot be verified through the claude CLI.`);
  }
  const cliResult = await verifyViaClaudeCli(deps.runner, pluginId, context.workspaceRoot);

  if (cliResult.source === 'claude-cli') {
    switch (cliResult.outcome.status) {
      case 'verified':
        return {
          source: 'claude-cli',
          result: { verified: true, resolvedVersion: cliResult.outcome.version, problems: [] },
        };
      case 'installed-but-disabled':
        return {
          source: 'claude-cli',
          result: {
            verified: false,
            problems: [
              `${entry.displayName} is installed (scope: ${cliResult.outcome.scope}) but currently disabled in Claude Code.`,
              'Enable it before recording this integration — a disabled plugin is never recorded as verified.',
            ],
          },
        };
      case 'absent':
        return {
          source: 'claude-cli',
          result: {
            verified: false,
            problems: [
              `${pluginId} was not found in the installed Claude Code plugin list.`,
              `Install it (${defaultRerunCommand(entry)}) or complete the manual Claude Code steps, then try again.`,
            ],
          },
        };
      case 'ambiguous':
        return {
          source: 'claude-cli',
          result: {
            verified: false,
            problems: [
              `Verification error: more than one installed plugin matches ${pluginId} exactly. This is ambiguous and cannot be safely resolved automatically.`,
            ],
          },
        };
    }
  }

  // cliResult.source === 'claude-cli-unavailable'
  if (cliResult.reason === 'not-found') {
    const detected = await detect(entry, context);
    if (detected.installed) {
      return {
        source: 'package-json',
        result: { verified: true, resolvedVersion: detected.installedVersion, problems: [] },
      };
    }
    return {
      source: 'package-json',
      result: {
        verified: false,
        problems: [
          `The claude CLI was not found, and ${entry.displayName} was not found as a workspace dependency either.`,
          `Install the Claude Code CLI to use the authoritative verification signal, or add ${entry.displayName} as a workspace dependency for the weaker fallback signal.`,
        ],
      },
    };
  }

  // Any other CLI-unavailable reason is a verification error, not "not installed" —
  // never falls back to package.json. The
  // source label is nominal here since `verified` is always false in this
  // branch, so it can never become recordable regardless.
  return {
    source: 'claude-cli',
    result: {
      verified: false,
      problems: [`Verification error: the claude CLI returned an unexpected result (${cliResult.reason}).`],
    },
  };
}

// Factory, not a singleton — no module-level default runner, no configuration
// setter (factory-based construction). Every
// caller (tests, and packages/nx-plugin's composition root in production)
// constructs its own verifier with its own runner.
export function createClaudeMarketplaceVerifier(
  entry: PluginCatalogEntry,
  deps: ClaudeMarketplaceVerifierDependencies,
): (context: IntegrationContext) => Promise<VerificationResult> {
  return async (context: IntegrationContext): Promise<VerificationResult> =>
    (await verifyClaudeMarketplacePlugin(entry, deps, context)).result;
}
