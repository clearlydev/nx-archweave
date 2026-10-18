import type { Tree } from '@nx/devkit';
import {
  DEFAULT_PLUGIN_SCOPE,
  PLUGIN_IDS,
  getCatalogEntry,
  manualInstallSteps,
  projectMarketplaceCommand,
  renderUserCommand,
} from '@nx-archweave/integrations';
import { renderIntegrationPlan } from './render.ts';
import { diskRunNx } from '../shared/run-nx.ts';
import type { AddIntegrationGeneratorSchema } from './schema.d.ts';
import {
  createIntegrationsCompositionRoot,
  type IntegrationsCompositionRoot,
} from '../../runtime/integrations-composition-root.ts';

export async function addIntegrationGenerator(
  tree: Tree,
  options: AddIntegrationGeneratorSchema,
  deps: { integrationsRoot?: IntegrationsCompositionRoot } = {},
): Promise<void> {
  const root = deps.integrationsRoot ?? createIntegrationsCompositionRoot();
  const target = options.target ?? 'claude-code';
  const integration = root.getIntegration(options.tool);
  const entry = getCatalogEntry(options.tool);
  if (!integration || !entry) {
    throw new Error(`Unsupported integration "${options.tool}". Supported: ${PLUGIN_IDS.join(', ')}.`);
  }
  const scope = options.scope ?? DEFAULT_PLUGIN_SCOPE;
  const teamCommand = scope === 'project' ? projectMarketplaceCommand(entry) : null;

  // plan() itself throws a clear error for an unsupported targetEnvironment —
  // reused, not duplicated.
  const plan = await integration.plan({
    targetEnvironment: target,
    versionRange: options.versionRange,
    scope,
  });
  const context = { workspaceRoot: tree.root, targetEnvironment: target };
  const detection = await integration.detect(context);
  const verification = await integration.verify(context);
  const uninstallSteps = await integration.uninstallInstructions(context);

  // The entry's manual steps are read directly — install()/ApprovedInstallPlan
  // is never invoked here. Always shown: as the path itself when no scriptable command
  // exists, otherwise as the chat alternative. Running the command is
  // install-integration's job, never this preview's.
  const manualSteps = manualInstallSteps(entry);

  console.log(
    renderIntegrationPlan({
      tool: options.tool,
      scope,
      scopeExplicit: options.scope !== undefined,
      runNx: diskRunNx(tree.root),
      teamMarketplaceCommand: teamCommand === null ? null : renderUserCommand(teamCommand),
      plan,
      detection,
      verification,
      manualSteps,
      uninstallSteps,
      manifestWritable: false,
    }),
  );
  console.log('\n(dry-run — no files were changed, no installer was executed, manifest was not written)');
}

export default addIntegrationGenerator;
