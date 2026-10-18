/**
 * `nx g` owns the dry-run flag: Nx 23.1's generate command deletes `dryRun` /
 * `dry-run` from the options it hands a generator and then refills the schema
 * default, and signals its own `--dry-run` only through `NX_DRY_RUN=true`
 * (`nx/src/command-line/generate/generate.js`, `command-object.js`). So an Nx
 * entry point that read only `options.dryRun` would always see `false` and print
 * "created" for a run Nx never flushes. Programmatic callers (init → the `run*`
 * cores, tests) keep passing `dryRun` explicitly; Nx's own flag always wins.
 */
export function resolveDryRun(options: { dryRun?: boolean }): boolean {
  return process.env['NX_DRY_RUN'] === 'true' || (options.dryRun ?? false);
}
