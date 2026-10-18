import { packageManagerCommands, type SupportedPackageManager } from '@nx-archweave/template-engine';
export interface TagResult {
  project: string;
  action: 'added' | 'present';
}

export interface AddBackendReport {
  backend: 'express' | 'nest';
  apiName: string;
  refused?: 'missing-api-project' | 'ambiguous-frontend' | 'no-frontend' | 'frontend-not-found' | 'invalid-project-json';
  /** Copy-paste official commands (only on the missing-api-project refusal). */
  commands?: string[];
  /** The express range the refusal's commands declare first (express backend, express
   * not yet declared, the installed @nx/react peers on express). */
  expressRange?: string;
  frontendCandidates?: string[];
  frontendProject?: string;
  /** project.json paths that failed to read/parse (invalid-project-json refusal). */
  invalidProjects?: string[];
  sharedTypes: 'created' | 'skipped';
  tags: TagResult[];
  /** Workspace registration of libs/shared-types (pnpm-workspace.yaml or
   * package.json workspaces, per the detected package manager). */
  workspaceGlob?: 'added' | 'present' | 'unrecognized';
  /** Detected package manager — drives command rendering only. */
  packageManager?: SupportedPackageManager;
  /** Present only when the package manager was a blind pnpm fallback. */
  packageManagerNote?: string;
  /** toolkit.config.json backend persistence (doctor's gate). */
  config?: 'created' | 'updated' | 'unchanged';
  tsconfigPaths: 'added' | 'present' | 'workspace-link' | 'unrecognized';
  eslint: 'applied' | 'already-applied' | 'snippet-only' | 'degraded-unrecognized';
  snippet?: string;
  sharedTypesPackage?: string;
}

/** Section body, no header — init prints its own `## add-backend` title and
 * dry-run marker, so the body must not repeat them. */
export function renderAddBackendBody(report: AddBackendReport): string {
  const lines: string[] = [];

  if (report.refused === 'no-frontend') {
    lines.push(`Refused: no frontend application and no "${report.apiName}" app found in this workspace.`);
    lines.push('  add-backend wires a backend app — beside a frontend, or on its own in a backend-only');
    lines.push(`  workspace (create one with: npx create-nx-workspace --preset=${report.backend} --appName=${report.apiName}).`);
    lines.push('  If the backend app has another name, pass --apiName=<its directory name>.');
    return lines.join('\n');
  }

  if (report.refused === 'frontend-not-found') {
    lines.push(`Refused: --frontendProject "${report.frontendProject}" does not match any project.`);
    lines.push('  Nothing was written. Check the name with `nx show projects`.');
    return lines.join('\n');
  }

  if (report.refused === 'ambiguous-frontend') {
    lines.push('Refused: multiple frontend applications found — add-backend will not guess:');
    for (const name of report.frontendCandidates ?? []) lines.push(`  - ${name}`);
    lines.push('  Nothing was written. Re-run with --frontendProject=<name> to pick one.');
    return lines.join('\n');
  }

  if (report.refused === 'invalid-project-json') {
    lines.push('Refused: a project.json this run must update could not be parsed:');
    for (const path of report.invalidProjects ?? []) lines.push(`  - ${path}`);
    lines.push('  Nothing was written — fix the JSON, then re-run add-backend.');
    return lines.join('\n');
  }

  if (report.refused === 'missing-api-project') {
    lines.push(`Refused: no "${report.apiName}" application project found.`);
    lines.push('  Create it with the official commands first (copy-paste, names already filled in),');
    lines.push('  then re-run add-backend to wire it up:');
    lines.push('');
    for (const command of report.commands ?? []) lines.push(`    ${command}`);
    if (report.expressRange !== undefined) {
      lines.push('');
      lines.push(`  The express line declares express@${report.expressRange}, the range this workspace's @nx/react supports —`);
      lines.push('  the official generator then keeps it instead of adding express 5, which npm rejects as a peer conflict.');
    }
    return lines.join('\n');
  }

  if (report.packageManagerNote !== undefined) lines.push(`  note: ${report.packageManagerNote}`);
  lines.push(`  frontend project: ${report.frontendProject ?? 'none (backend-only workspace)'}`);
  lines.push(
    report.sharedTypes === 'created'
      ? `  libs/shared-types: created (import it as ${report.sharedTypesPackage})`
      : '  libs/shared-types: already exists — skipped',
  );
  if (report.config !== undefined && report.config !== 'unchanged') {
    lines.push(`  toolkit.config.json: backend "${report.backend}" recorded (${report.config}) — doctor's backend checks now run`);
  }
  if (report.workspaceGlob !== undefined) {
    const pmName = report.packageManager ?? 'pnpm';
    const registry = packageManagerCommands(pmName).workspaceRegistration;
    lines.push(
      {
        added: `  ${registry}: 'libs/shared-types' registered — run \`${pmName} install\` once to link it`,
        present: `  ${registry}: already covers libs/shared-types`,
        unrecognized:
          // an integrated layout lists no workspace packages: the paths alias below links it
          report.tsconfigPaths === 'added' || report.tsconfigPaths === 'present'
            ? `  ${registry}: no workspace package list (integrated layout) — the tsconfig paths alias links libs/shared-types`
            : `  ${registry}: shape not recognized — add 'libs/shared-types' to its workspace list yourself`,
      }[report.workspaceGlob],
    );
  }
  for (const tag of report.tags) {
    lines.push(`  tag ${tag.project}: ${tag.action === 'added' ? 'added' : 'already present'}`);
  }
  lines.push(
    {
      added: `  tsconfig.base.json paths: ${report.sharedTypesPackage} added (a classic or integrated setup — libs resolve through paths)`,
      present: '  tsconfig.base.json paths: already wired',
      'workspace-link': '  tsconfig paths: not needed — the workspace package link is the wiring',
      unrecognized: '  tsconfig.base.json: could not be parsed — left untouched',
    }[report.tsconfigPaths],
  );

  switch (report.eslint) {
    case 'applied':
      lines.push('  ESLint boundaries: cross-side deny rules written (existing imports stay allowed)');
      break;
    case 'already-applied':
      lines.push('  ESLint boundaries: already enforced — no change');
      break;
    case 'degraded-unrecognized':
      lines.push('  ESLint boundaries: your config was NOT recognized — left untouched.');
      lines.push('  Merge this yourself (then boundaries are actually enforced):');
      break;
    case 'snippet-only':
      lines.push('  ESLint boundaries: report-only (pass --applyEslint to write them).');
      lines.push('  Paste-ready snippet:');
      break;
  }
  if (report.snippet) {
    lines.push('');
    lines.push(report.snippet);
  }

  return lines.join('\n');
}

/** Standalone rendering (the add-backend generator's own console output). */
export function renderAddBackendReport(report: AddBackendReport, dryRun: boolean): string {
  return [`add-backend (${report.backend})${dryRun ? ' — dry run' : ''}`, '', renderAddBackendBody(report)].join('\n');
}
