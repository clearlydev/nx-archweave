import type { FsdEnforcement, ToolkitFrontend } from '@nx-archweave/shared';

/** Why no frontend app could be picked — the rule and the layers live in its source root. */
export type FsdAppRefusal =
  | { reason: 'project-not-found'; project: string }
  | { reason: 'ambiguous-frontend'; candidates: string[] }
  | { reason: 'no-frontend-app'; otherProjects: string[] }
  | { reason: 'invalid-project-json'; detail: string };

/** Same vocabulary as add-backend's ESLint outcome. */
export type FsdEslintAction = 'applied' | 'already-applied' | 'snippet-only' | 'degraded-unrecognized' | 'not-applied';

/** What `--steiger` did; null when the flag was not passed. */
export interface SteigerOutcome {
  configPath: string;
  config: 'created' | 'unchanged' | 'kept';
  targetPath: string | null;
  target: 'added' | 'present' | 'unrecognized';
  dependencies: 'added' | 'present' | 'unrecognized';
  installCommand: string;
  runCommand: string;
}

export interface AddFsdLiteReport {
  dryRun: boolean;
  /** True when no frontend app could be picked — nothing was written. */
  aborted: boolean;
  appRefusal: FsdAppRefusal | null;
  /** The frontend app; null when none could be picked. */
  project: string | null;
  /** That app's source root (where the layers live); null when no app was picked. */
  sourceRoot: string | null;
  /** The severity the rule reports with — option, then toolkit.config.json, then warn. */
  enforcement: FsdEnforcement;
  /** The framework the layer names follow; `generic` when nx-archweave does not recognise it. */
  frontend: ToolkitFrontend;
  eslint: FsdEslintAction;
  /** The app's ESLint config the rule was (or would be) written to; null when none exists. */
  eslintPath: string | null;
  /** Paste-ready text for every outcome that did not write the rule. */
  snippet: string | null;
  /** Which directory is which layer and how slices are made; null when aborted. */
  layerGuide: string | null;
  steiger: SteigerOutcome | null;
}

export function renderAddFsdLiteReport(report: AddFsdLiteReport): string {
  const lines: string[] = [];

  if (report.aborted) {
    lines.push('add-fsd-lite aborted — nothing was written.');
    const refusal = report.appRefusal;
    if (refusal !== null) {
      lines.push('');
      lines.push("  FSD layers live inside the frontend app's source root (e.g. apps/web/src), and no app could be picked:");
      if (refusal.reason === 'project-not-found') {
        lines.push(`    --project=${refusal.project} names no project in this workspace.`);
      } else if (refusal.reason === 'ambiguous-frontend') {
        lines.push('    more than one frontend app was found — rerun with --project=<one of them>:');
        for (const name of refusal.candidates) lines.push(`      - ${name}`);
      } else if (refusal.reason === 'invalid-project-json') {
        lines.push(`    a project.json could not be parsed (${refusal.detail}) — fix it, then rerun.`);
      } else if (refusal.otherProjects.length > 0) {
        lines.push('    no project was recognised as a frontend app. If one of these is it, rerun with --project=<name>:');
        for (const name of refusal.otherProjects) lines.push(`      - ${name}`);
      } else {
        lines.push('    the workspace has no projects — create one (e.g. nx g @nx/react:app or nx g @nx/next:app), then rerun.');
      }
    }
    return lines.join('\n');
  }

  if (report.dryRun) {
    lines.push('add-fsd-lite dry-run — no files were written.');
    lines.push('');
  }

  lines.push(`FSD layers (in ${report.project}, ${report.sourceRoot}):`);
  if (report.layerGuide !== null && report.frontend === 'generic') {
    lines.push('Frontend: framework not recognised — the common FSD rules apply, with no framework-specific layer names.');
  }
  if (report.layerGuide !== null) lines.push(report.layerGuide);

  lines.push('');
  const where = report.eslintPath ?? `${report.project}'s eslint.config.mjs`;
  switch (report.eslint) {
    case 'applied':
      lines.push(`ESLint: archweave/fsd-boundaries (${report.enforcement}) written to ${where}`);
      break;
    case 'already-applied':
      lines.push(`ESLint: archweave/fsd-boundaries already wired in ${where} — no change`);
      break;
    case 'degraded-unrecognized':
      lines.push(`ESLint: ${report.eslintPath === null ? `no ESLint config found for ${report.project}` : `${where} was NOT recognized — left untouched`}.`);
      lines.push('  Add the rule yourself (then the layer rules are actually enforced):');
      break;
    case 'snippet-only':
      lines.push(`ESLint: report-only (pass --applyEslint to write the rule into ${where}).`);
      break;
    case 'not-applied':
      break;
  }
  if (report.snippet !== null) lines.push(report.snippet);

  if (report.steiger !== null) {
    const st = report.steiger;
    lines.push('');
    lines.push('steiger (official FSD linter, opt-in):');
    lines.push(
      `  ${st.configPath}: ${st.config === 'created' ? 'created' : st.config === 'unchanged' ? 'unchanged' : 'kept — an existing config with other content is never replaced'}`,
    );
    lines.push(
      st.target === 'added'
        ? `  target ${'fsd-check'}: added to ${st.targetPath}`
        : st.target === 'present'
          ? `  target ${'fsd-check'}: already present in ${st.targetPath}`
          : '  target fsd-check: NOT added — no parseable project.json / package.json for the app',
    );
    lines.push(
      st.dependencies === 'added'
        ? `  devDependencies: steiger + @feature-sliced/steiger-plugin added to package.json — run \`${st.installCommand}\``
        : st.dependencies === 'present'
          ? '  devDependencies: already present'
          : '  devDependencies: NOT added — the root package.json could not be parsed',
    );
    lines.push(`  run it with: ${st.runCommand}  (steiger needs Node >= 22.18)`);
  }

  return lines.join('\n');
}
