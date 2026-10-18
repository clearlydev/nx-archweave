import type { Tree } from '@nx/devkit';
import { runFsdSlice } from '../slice/core.ts';
import { renderSliceReport } from '../slice/render.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import type { FeatureGeneratorSchema } from './schema.d.ts';

/** Thin wrapper — all behavior lives in the shared `slice/core.ts`,
 * fixed here to the `features` layer. */
export async function featureGenerator(tree: Tree, options: FeatureGeneratorSchema): Promise<void> {
  console.log(renderSliceReport(runFsdSlice(tree, 'features', { ...options, dryRun: resolveDryRun(options) })));
}

export default featureGenerator;
