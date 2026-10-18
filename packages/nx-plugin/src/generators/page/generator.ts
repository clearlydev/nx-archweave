import type { Tree } from '@nx/devkit';
import { runFsdSlice } from '../slice/core.ts';
import { renderSliceReport } from '../slice/render.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import type { PageGeneratorSchema } from './schema.d.ts';

/** Thin wrapper — all behavior lives in the shared `slice/core.ts`,
 * fixed here to the `pages` layer. */
export async function pageGenerator(tree: Tree, options: PageGeneratorSchema): Promise<void> {
  console.log(renderSliceReport(runFsdSlice(tree, 'pages', { ...options, dryRun: resolveDryRun(options) })));
}

export default pageGenerator;
