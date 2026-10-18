import type { Tree } from '@nx/devkit';
import { renderRecordIntegrationView } from './render.ts';
import type { RecordIntegrationGeneratorSchema } from './schema.d.ts';
import {
  createIntegrationsCompositionRoot,
  type IntegrationsCompositionRoot,
} from '../../runtime/integrations-composition-root.ts';
import { getCatalogEntry, PLUGIN_IDS, recordMetadataFor } from '@nx-archweave/integrations';
import { runRecordPipeline } from '../shared/record-pipeline.ts';

export async function recordIntegrationGenerator(
  tree: Tree,
  options: RecordIntegrationGeneratorSchema,
  deps: { integrationsRoot?: IntegrationsCompositionRoot } = {},
): Promise<void> {
  const root = deps.integrationsRoot ?? createIntegrationsCompositionRoot();
  const target = options.target ?? 'claude-code';
  // `nx g` strips a dryRun option before generators see it (Nx owns that flag), so a
  // dryRun-named approval could never be turned off — approval is --apply instead.
  // Nx's own --dry-run still wins via NX_DRY_RUN.
  const apply = (options.apply ?? false) && process.env['NX_DRY_RUN'] !== 'true';

  const integration = root.getIntegration(options.tool);
  if (!integration) {
    throw new Error(`Unsupported integration "${options.tool}". Supported: ${PLUGIN_IDS.join(', ')}.`);
  }
  const entry = getCatalogEntry(options.tool);
  const metadata = entry === undefined ? undefined : recordMetadataFor(entry);
  if (!metadata) {
    throw new Error(`No manifest metadata is defined for "${options.tool}".`);
  }

  // plan() itself throws a clear error for an unsupported targetEnvironment —
  // reused, not duplicated. Called only to validate the
  // target; its result is not otherwise used by this generator, so no registry
  // lookup is made for a version nobody reads.
  await integration.plan({ targetEnvironment: target, resolveLatestVersion: false });

  // Always a live call — never a cached/previous result;
  // shared with install-integration so both record by one rule (only a
  // claude-cli-sourced verified:true is recordable).
  const outcome = await runRecordPipeline({
    id: integration.id,
    runner: root.runner,
    workspaceRoot: tree.root,
    target,
    write: apply,
  });

  console.log(
    renderRecordIntegrationView({
      tool: options.tool,
      target,
      sourceRepository: metadata.repository,
      license: integration.license,
      ...outcome,
    }),
  );
}

export default recordIntegrationGenerator;
