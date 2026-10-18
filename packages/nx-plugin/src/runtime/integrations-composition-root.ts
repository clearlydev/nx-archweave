import {
  createCatalogIntegrations,
  createIntegrationRegistry,
  getIntegration as getIntegrationFromRegistry,
  listIntegrations as listIntegrationsFromRegistry,
} from '@nx-archweave/integrations';
import type { CommandRunner, ToolIntegration } from '@nx-archweave/integrations';
import { NodeCommandRunner } from './node-command-runner.ts';

export interface IntegrationsCompositionRoot {
  registry: ToolIntegration[];
  // Exposed so a caller (record-integration) can reach the shared
  // verifyClaudeMarketplacePlugin helper directly when it needs to know
  // which signal produced a result — the generic ToolIntegration.verify()
  // contract intentionally does not carry that detail.
  // CommandRunner, not ReadOnlyCommandRunner: install-integration issues the one
  // mutating call (`claude plugin install`) through this same runner, only behind
  // an ApprovedInstallPlan.
  runner: CommandRunner;
  getIntegration(id: string): ToolIntegration | undefined;
  listIntegrations(): ToolIntegration[];
}

// The single place every generator (doctor, add-integration,
// record-integration) obtains its ToolIntegration objects from — never a
// package-level singleton (factory-based
// construction). Each call constructs a fresh registry; there is no shared,
// mutated module state between calls. Defaults to the real, Node-backed
// runner; tests inject a fake one. The tool list is the plugin catalog (data, in
// @nx-archweave/integrations); the generators' --tool/--target schema enums are kept
// equal to it by a test (catalog-schema-enums.spec.ts).
export function createIntegrationsCompositionRoot(
  deps: { runner?: CommandRunner } = {},
): IntegrationsCompositionRoot {
  const runner = deps.runner ?? new NodeCommandRunner();
  const registry = createIntegrationRegistry(createCatalogIntegrations({ runner }));

  return {
    registry,
    runner,
    getIntegration: (id: string) => getIntegrationFromRegistry(registry, id),
    listIntegrations: () => listIntegrationsFromRegistry(registry),
  };
}
