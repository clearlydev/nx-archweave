import type { Tree } from '@nx/devkit';
import {
  DEFAULT_PLUGIN_SCOPE,
  PLUGIN_IDS,
  claudeCliNotFoundSteps,
  declareEnabledIntegration,
  declareProjectMarketplace,
  getCatalogEntry,
  installClaudeMarketplacePlugin,
  projectMarketplaceCommand,
  redactHomePaths,
  renderUserCommand,
  verifyViaClaudeCli,
  type ApprovedInstallPlan,
  type ClaudePluginInstallDetail,
} from '@nx-archweave/integrations';
import type { InstallIntegrationGeneratorSchema } from './schema.d.ts';
import {
  renderInstallIntegrationView,
  type InstallCurrentState,
  type InstallIntegrationView,
} from './render.ts';
import { runRecordPipeline } from '../shared/record-pipeline.ts';
import { diskRunNx } from '../shared/run-nx.ts';
import {
  createIntegrationsCompositionRoot,
  type IntegrationsCompositionRoot,
} from '../../runtime/integrations-composition-root.ts';

export interface InstallIntegrationDeps {
  integrationsRoot?: IntegrationsCompositionRoot;
  /** Seam for the declaration writer (tests inject a failing one). */
  declare?: typeof declareEnabledIntegration;
}

/** Install outcomes where the command did start, so it may have changed state —
 * a read-only re-check reports what is really there. */
const RECHECK_AFTER: ReadonlySet<ClaudePluginInstallDetail['kind']> = new Set([
  'executed',
  'failed',
  'timeout',
  'output-too-large',
  'confirmation-required',
]);

/**
 * install-integration: pre-verify live → (only with
 * --apply, only when absent) run the ONE official install command → re-verify live
 * → record the manifest entry → declare the integration in toolkit.config.json.
 * Nothing is recorded or declared unless a fresh claude-cli verification confirms
 * the plugin is installed AND enabled.
 */
export async function runInstallIntegration(
  tree: Tree,
  options: InstallIntegrationGeneratorSchema,
  deps: InstallIntegrationDeps = {},
): Promise<InstallIntegrationView> {
  const root = deps.integrationsRoot ?? createIntegrationsCompositionRoot();
  const declare = deps.declare ?? declareEnabledIntegration;
  const target = options.target ?? 'claude-code';
  const scope = options.scope ?? DEFAULT_PLUGIN_SCOPE;
  // `nx g` owns --dry-run (it strips a dryRun option before generators see it — review
  // C1), so approval is --apply. Nx's own --dry-run still wins: it sets NX_DRY_RUN.
  const nxDryRun = process.env['NX_DRY_RUN'] === 'true';
  const apply = (options.apply ?? false) && !nxDryRun;
  const nxG = `${diskRunNx(tree.root)} g`;
  const rerunCommand =
    `${nxG} @clearlydev/nx-archweave:install-integration --tool=${options.tool} --apply` +
    (options.scope === undefined ? '' : ` --scope=${options.scope}`);

  const integration = root.getIntegration(options.tool);
  const entry = getCatalogEntry(options.tool);
  const pluginId = entry?.hosts['claude-code']?.pluginId;
  if (!integration || !entry || pluginId === undefined) {
    throw new Error(`Unsupported integration "${options.tool}". Supported: ${PLUGIN_IDS.join(', ')}.`);
  }
  const name = entry.displayName;
  // plan() throws a clear error for an unsupported target — reused, not duplicated.
  // No registry lookup: the marketplace decides the version.
  const plan = await integration.plan({
    targetEnvironment: target,
    versionRange: options.versionRange,
    scope,
    resolveLatestVersion: false,
  });

  // The structured CLI signal, not verifyClaudeMarketplacePlugin — a missing CLI must
  // degrade to terminal guidance here, never fall back to package.json.
  const pre = await verifyViaClaudeCli(root.runner, pluginId, tree.root);
  let currentState: InstallCurrentState;
  if (pre.source === 'claude-cli') {
    const outcome = pre.outcome;
    switch (outcome.status) {
      case 'verified':
        currentState =
          options.scope !== undefined && outcome.scope !== options.scope
            ? { kind: 'installed-other-scope', installedScope: outcome.scope }
            : { kind: 'already-installed', version: outcome.version, scope: outcome.scope };
        break;
      case 'installed-but-disabled':
        currentState = { kind: 'disabled' };
        break;
      case 'absent':
        currentState = { kind: 'absent' };
        break;
      case 'ambiguous':
        currentState = { kind: 'ambiguous' };
        break;
    }
  } else {
    currentState = pre.reason === 'not-found' ? { kind: 'cli-not-found' } : { kind: 'cli-error', reason: pre.reason };
  }

  const view: InstallIntegrationView = {
    tool: options.tool,
    target,
    scope,
    preview: !apply,
    applyIgnoredForNxDryRun: (options.apply ?? false) && nxDryRun,
    sourceRepository: plan.sourceRepository,
    officialHomepage: plan.officialHomepage,
    license: plan.license,
    requestedVersion: options.versionRange ?? null,
    workspaceFiles: plan.filesModified,
    command: plan.officialCommand === null ? '(none — manual install only)' : renderUserCommand(plan.officialCommand),
    rerunCommand,
    currentState,
    install: null,
    record: null,
    declaration: null,
    teamMarketplace: null,
    guidance: [],
  };

  // Project scope shares the plugin through the committed .claude/settings.json, so the
  // marketplace is declared there too, by Claude Code's own command. User/local scope
  // stay personal: nothing extra runs.
  const teamCommand = projectMarketplaceCommand(entry);
  const planTeamDeclaration = (): boolean => {
    if (teamCommand === null) return false;
    view.teamMarketplace = { command: renderUserCommand(teamCommand), detail: null };
    return true;
  };
  /** Runs the declaration (only with --apply); true when it succeeded. */
  const declareForTeam = async (): Promise<boolean> => {
    if (!apply || view.teamMarketplace === null) return true;
    const detail = await declareProjectMarketplace(entry, { runner: root.runner }, { cwd: tree.root });
    view.teamMarketplace.detail = detail;
    return detail.kind === 'executed';
  };
  const teamFailureStep = (): string =>
    `Declaring the marketplace for teammates did not succeed — run it yourself to see why: ${view.teamMarketplace?.command}`;

  const recordAndDeclare = async (): Promise<void> => {
    const outcome = await runRecordPipeline({
      id: integration.id,
      runner: root.runner,
      workspaceRoot: tree.root,
      target,
      write: apply,
    });
    view.record = {
      verification: outcome.verification,
      existingEntry: outcome.existingEntry,
      proposedEntry: outcome.proposedEntry,
      hasConflict: outcome.hasConflict,
      wasWritten: outcome.wasWritten,
    };
    // Declare only what was verified: a failed verification must not leave a
    // declaration behind (doctor would then report declared-missing right away).
    if (outcome.proposedEntry) {
      try {
        view.declaration = declare(tree.root, integration.id, { write: apply });
      } catch (error) {
        // The manifest is already written — report the partial state, never throw past it.
        view.declaration = {
          action: 'write-failed',
          message: redactHomePaths(error instanceof Error ? error.message : String(error)),
        };
      }
    }
  };

  switch (currentState.kind) {
    case 'already-installed':
      // Idempotency: never reinstall — but bring the bookkeeping in line,
      // including a project-scope install made before the marketplace was declared there.
      if (currentState.scope === 'project' && planTeamDeclaration() && !(await declareForTeam())) {
        view.guidance = [teamFailureStep()];
      }
      await recordAndDeclare();
      break;
    case 'installed-other-scope':
      view.guidance =
        currentState.installedScope === 'managed'
          ? [
              `${name} is provided at managed scope by your organization and cannot be installed again at another scope.`,
              `Record the managed install instead (nothing is installed again): ${nxG} @clearlydev/nx-archweave:install-integration --tool=${options.tool} --apply`,
            ]
          : [
              `${name} is already installed at ${currentState.installedScope} scope. Installing it again at ${scope} scope ` +
                'would leave two entries that verification cannot tell apart, so nothing was done.',
              `To record the existing install (nothing is installed again): ${nxG} @clearlydev/nx-archweave:install-integration --tool=${options.tool} --apply --scope=${currentState.installedScope}`,
              `To move it instead: claude plugin uninstall ${pluginId} --scope ${currentState.installedScope}, then rerun: ${rerunCommand}`,
            ];
      break;
    case 'disabled':
      view.guidance = [
        `${name} is installed but disabled. Enable it yourself (nx-archweave never enables or disables plugins): claude plugin enable ${pluginId}`,
        `Then rerun to record and declare it: ${rerunCommand}`,
      ];
      break;
    case 'ambiguous':
      view.guidance = [
        `More than one installed plugin matches ${pluginId} exactly (for example at user and project scope), so nothing was done.`,
        `Remove the extra one (claude plugin uninstall ${pluginId} --scope <scope>), then rerun: ${rerunCommand}`,
      ];
      break;
    case 'cli-not-found':
      view.guidance = claudeCliNotFoundSteps(entry, rerunCommand);
      break;
    case 'cli-error':
      view.guidance = [
        'The claude CLI is present but could not list its plugins, so no install was attempted.',
        `Run \`claude plugin list\` yourself to see the error, fix it, and rerun: ${rerunCommand}`,
      ];
      break;
    case 'absent': {
      if (scope === 'project') planTeamDeclaration();
      if (!apply) break;
      // First, so the install below finds the marketplace declared and does not add it to the
      // user's settings (measured). A failed declaration installs nothing.
      if (!(await declareForTeam())) {
        view.guidance = [teamFailureStep(), `Nothing was installed. Once resolved, rerun: ${rerunCommand}`];
        break;
      }
      // --apply is the explicit approval gate.
      const approved: ApprovedInstallPlan = { ...plan, approvedBy: 'user' };
      const { result, detail } = await installClaudeMarketplacePlugin(entry, { runner: root.runner }, approved, {
        cwd: tree.root,
        rerunCommand,
      });
      view.install = { detail, manualStepsRemaining: result.manualStepsRemaining };
      if (RECHECK_AFTER.has(detail.kind)) await recordAndDeclare();
      if (view.record?.proposedEntry) break;
      view.guidance =
        detail.kind === 'executed'
          ? [
              `Run \`claude plugin list\` to see what was installed; once it shows ${pluginId} enabled, rerun: ${rerunCommand}`,
            ]
          : result.manualStepsRemaining;
      break;
    }
  }

  return view;
}

export async function installIntegrationGenerator(
  tree: Tree,
  options: InstallIntegrationGeneratorSchema,
  deps: InstallIntegrationDeps = {},
): Promise<void> {
  console.log(renderInstallIntegrationView(await runInstallIntegration(tree, options, deps)));
}

export default installIntegrationGenerator;
