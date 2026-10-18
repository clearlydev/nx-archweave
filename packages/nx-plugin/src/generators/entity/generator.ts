import type { Tree } from '@nx/devkit';
import { runFsdSlice } from '../slice/core.ts';
import { renderSliceReport } from '../slice/render.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import type { EntityGeneratorSchema } from './schema.d.ts';

/** Thin wrapper — all behavior lives in the shared `slice/core.ts`,
 * fixed here to the `entities` layer. */
export async function entityGenerator(tree: Tree, options: EntityGeneratorSchema): Promise<void> {
  console.log(renderSliceReport(runFsdSlice(tree, 'entities', { ...options, dryRun: resolveDryRun(options) })));
}

export default entityGenerator;
