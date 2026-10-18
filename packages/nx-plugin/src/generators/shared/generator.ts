import type { Tree } from '@nx/devkit';
import { runFsdSlice } from '../slice/core.ts';
import { renderSliceReport } from '../slice/render.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import type { SharedGeneratorSchema } from './schema.d.ts';

/** Thin wrapper — all behavior lives in the shared `slice/core.ts`,
 * fixed here to the `shared` layer. */
export async function sharedGenerator(tree: Tree, options: SharedGeneratorSchema): Promise<void> {
  console.log(renderSliceReport(runFsdSlice(tree, 'shared', { ...options, dryRun: resolveDryRun(options) })));
}

export default sharedGenerator;
