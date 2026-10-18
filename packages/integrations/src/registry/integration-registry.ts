import type { ToolIntegration } from '../contracts/integration.ts';

// Pure functions only — no module-level singleton registry. The caller
// (packages/nx-plugin's composition root) constructs the concrete list of
// integrations — the plugin catalog's entries, each paired with its host adapter
// (createCatalogIntegrations, ../catalog) — and passes it through
// createIntegrationRegistry, then uses listIntegrations/getIntegration against that
// value. This is the factory-based construction seam — no mutable global state, no
// process-wide configuration.
//
// gajae-code is intentionally never registered anywhere in this codebase — it
// is reference-only. No adapter, no
// manifest, no wrapper code exists for it.
export function createIntegrationRegistry(integrations: ToolIntegration[]): ToolIntegration[] {
  const seenIds = new Set<string>();
  for (const integration of integrations) {
    if (seenIds.has(integration.id)) {
      throw new Error(`Duplicate integration id: "${integration.id}"`);
    }
    seenIds.add(integration.id);
  }
  return integrations;
}

export function listIntegrations(registry: ToolIntegration[]): ToolIntegration[] {
  return registry;
}

export function getIntegration(registry: ToolIntegration[], id: string): ToolIntegration | undefined {
  return registry.find((integration) => integration.id === id);
}
