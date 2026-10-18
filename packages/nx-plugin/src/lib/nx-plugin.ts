import { describeEngine } from '@nx-archweave/template-engine';
import { createIntegrationsCompositionRoot } from '../runtime/integrations-composition-root.ts';

export function describePlugin(): string {
  // Constructing the composition root only counts registered integrations —
  // it never invokes the runner (no verify() call happens here).
  return `nx-plugin(${describeEngine()}, integrations=${createIntegrationsCompositionRoot().listIntegrations().length})`;
}
