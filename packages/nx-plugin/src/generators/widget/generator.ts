import type { Tree } from '@nx/devkit';
import { runFsdSlice } from '../slice/core.ts';
import { renderSliceReport } from '../slice/render.ts';
import { resolveDryRun } from '../shared/dry-run.ts';
import type { WidgetGeneratorSchema } from './schema.d.ts';

/** Thin wrapper — all behavior lives in the shared `slice/core.ts`,
 * fixed here to the `widgets` layer. */
export async function widgetGenerator(tree: Tree, options: WidgetGeneratorSchema): Promise<void> {
  console.log(renderSliceReport(runFsdSlice(tree, 'widgets', { ...options, dryRun: resolveDryRun(options) })));
}

export default widgetGenerator;
