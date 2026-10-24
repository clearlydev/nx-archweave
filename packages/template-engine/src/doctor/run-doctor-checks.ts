import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDoctorCheck, computeOverallStatus, type DoctorCheck, type DoctorReport } from '@nx-archweave/shared';
import { detectEnvironment, type EnvironmentDetection } from './detect-environment.ts';
import { buildReviewChecks, REVIEW_CHECK_IDS } from './review-checks.ts';
import { buildBackendChecks, BACKEND_CHECK_IDS } from './backend-checks.ts';
import { buildFsdLikeCheck } from './fsd-like-check.ts';
import { buildFsdEnforcementCheck, buildFsdRuleAnchoredCheck } from './fsd-enforcement-check.ts';
import type { DoctorProject } from './doctor-projects.ts';

const NOT_APPLICABLE_IDS = [
  'fsd-like-structure',
  'fsd-enforcement-applied',
  'fsd-rule-anchored',
  'nx-version',
  'package-manager',
  'workspace-root',
  'framework-react-vite',
  'framework-next',
  'existing-config',
  'agent-rules-files',
  'github-templates',
  'integration-manifest',
  ...REVIEW_CHECK_IDS,
  ...BACKEND_CHECK_IDS,
];

/** `projects`: the workspace's projects as Nx lists them (the plugin's doctor passes them);
 * without them the checks scan the conventional apps/ and libs/ folders. */
export function runDoctorChecks(root: string, projects?: DoctorProject[]): DoctorReport {
  const env = detectEnvironment(root);

  if (!env.hasNxWorkspace) {
    const checks: DoctorCheck[] = [
      createDoctorCheck({
        id: 'nx-workspace-detected',
        label: 'Nx workspace detected',
        status: 'error',
        message: 'nx.json not found — this is not an Nx workspace.',
        evidence: [],
        suggestedAction: 'Run this command from the root of an Nx workspace.',
      }),
      ...NOT_APPLICABLE_IDS.map((id) =>
        createDoctorCheck({
          id,
          label: id,
          status: 'not-applicable',
          message: 'Skipped — not an Nx workspace',
          evidence: [],
        }),
      ),
    ];
    return { checks, overallStatus: 'unsupported' };
  }

  const checks: DoctorCheck[] = [
    createDoctorCheck({
      id: 'nx-workspace-detected',
      label: 'Nx workspace detected',
      status: 'pass',
      message: 'nx.json found',
      evidence: ['nx.json'],
    }),
    buildNxVersionCheck(env),
    buildFsdLikeCheck(root, projects),
    buildFsdEnforcementCheck(root, projects),
    buildFsdRuleAnchoredCheck(root, projects),
    createDoctorCheck({
      id: 'package-manager',
      label: 'Package manager',
      status: env.packageManager ? 'pass' : 'warning',
      message: env.packageManager ? `${env.packageManager} detected` : 'Unknown package manager',
      evidence: env.packageManager ? [env.packageManager] : [],
    }),
    createDoctorCheck({
      id: 'workspace-root',
      label: 'Workspace root',
      status: 'pass',
      message: root,
      evidence: [root],
    }),
    ...buildFrameworkChecks(env),
    buildExistingConfigCheck(root),
    buildAgentRulesCheck(root),
    buildGithubTemplatesCheck(root),
    buildIntegrationManifestCheck(root),
    ...buildReviewChecks(root),
    ...buildBackendChecks(root, projects),
  ];

  const overallStatus = computeOverallStatus(checks);
  return { checks, overallStatus };
}

/** Majors the toolkit's own E2E validated
 * (the E2E probes ran against 23.x). */
const VALIDATED_NX_MAJOR = 23;

function extractMajor(version: string): number | null {
  // First digit run on purpose — deliberately conservative: a multi-major
  // range like '>=22 <24' judges as 22 and warns 'below', which is the safe
  // direction for a warning-level check.
  const match = /(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

function buildNxVersionCheck(env: EnvironmentDetection): DoctorCheck {
  if (env.rootPackageJsonError) {
    return createDoctorCheck({
      id: 'nx-version',
      label: 'Nx version',
      status: 'error',
      message: `Could not read root package.json: ${env.rootPackageJsonError}`,
      evidence: ['package.json'],
      suggestedAction: 'Fix the JSON syntax in the root package.json and re-run doctor.',
    });
  }
  if (!env.nxVersion) {
    return createDoctorCheck({
      id: 'nx-version',
      label: 'Nx version',
      status: 'warning',
      message: 'Could not determine Nx version',
      evidence: [],
    });
  }
  const major = extractMajor(env.nxVersion);
  if (major === null) {
    return createDoctorCheck({
      id: 'nx-version',
      label: 'Nx version',
      status: 'warning',
      message: `Nx version "${env.nxVersion}" could not be parsed — range judgment skipped`,
      evidence: [`nx@${env.nxVersion}`],
    });
  }
  if (major === VALIDATED_NX_MAJOR) {
    return createDoctorCheck({
      id: 'nx-version',
      label: 'Nx version',
      status: 'pass',
      message: `Nx ${env.nxVersion} — within the toolkit-validated range (${VALIDATED_NX_MAJOR}.x)`,
      evidence: [`nx@${env.nxVersion}`],
    });
  }
  if (major < VALIDATED_NX_MAJOR) {
    return createDoctorCheck({
      id: 'nx-version',
      label: 'Nx version',
      status: 'warning',
      message: `Nx ${env.nxVersion} is below the toolkit-validated range (${VALIDATED_NX_MAJOR}.x) — generator behavior is not guaranteed`,
      evidence: [`nx@${env.nxVersion}`],
      suggestedAction: `Upgrade the workspace to Nx ${VALIDATED_NX_MAJOR}.x before running the generators.`,
    });
  }
  return createDoctorCheck({
    id: 'nx-version',
    label: 'Nx version',
    status: 'warning',
    message: `Nx ${env.nxVersion} is above the toolkit-validated range (${VALIDATED_NX_MAJOR}.x) — may work, unvalidated`,
    evidence: [`nx@${env.nxVersion}`],
    suggestedAction: 'Proceed with care and report issues; validation for newer majors lands with toolkit updates.',
  });
}

// Root-package-only: only the workspace root package.json is inspected for
// `react`/`vite`/`next` dependencies. A framework used exclusively by a sub-package under
// packages/* is not detected here. This function does not claim monorepo-wide coverage;
// callers must not read a `not-applicable` result here as "no project in this workspace
// uses this framework."
function buildFrameworkChecks(env: EnvironmentDetection): DoctorCheck[] {
  if (env.rootPackageJsonError) {
    const message = `Could not read root package.json: ${env.rootPackageJsonError}`;
    return [
      createDoctorCheck({
        id: 'framework-react-vite',
        label: 'React + Vite (root package.json only)',
        status: 'error',
        message,
        evidence: ['package.json'],
      }),
      createDoctorCheck({
        id: 'framework-next',
        label: 'Next.js (root package.json only)',
        status: 'error',
        message,
        evidence: ['package.json'],
      }),
    ];
  }

  const dependencies = (env.rootPackageJson?.['dependencies'] ?? {}) as Record<string, string>;
  const devDependencies = (env.rootPackageJson?.['devDependencies'] ?? {}) as Record<string, string>;
  const allDeps = { ...dependencies, ...devDependencies };
  const hasReactVite = Boolean(allDeps.vite && allDeps.react);
  const hasNext = Boolean(allDeps.next);

  return [
    createDoctorCheck({
      id: 'framework-react-vite',
      label: 'React + Vite (root package.json only)',
      status: hasReactVite ? 'pass' : 'not-applicable',
      message: hasReactVite
        ? 'react + vite dependencies detected in the root package.json'
        : 'Not detected in the root package.json (sub-packages are not scanned)',
      evidence: hasReactVite ? ['package.json'] : [],
    }),
    createDoctorCheck({
      id: 'framework-next',
      label: 'Next.js (root package.json only)',
      status: hasNext ? 'pass' : 'not-applicable',
      message: hasNext
        ? 'next dependency detected in the root package.json'
        : 'Not detected in the root package.json (sub-packages are not scanned)',
      evidence: hasNext ? ['package.json'] : [],
    }),
  ];
}

/** toolkit.config.json is nx-archweave's own file: when it exists the workspace is
 * toolkit-managed (the same rule as the FSD-like check). Not a conflict either way — init
 * and the generators merge into it, changing only their own fields. */
function isToolkitManaged(root: string): boolean {
  return existsSync(join(root, 'toolkit.config.json'));
}

function buildExistingConfigCheck(root: string): DoctorCheck {
  const exists = isToolkitManaged(root);
  return createDoctorCheck({
    id: 'existing-config',
    label: 'toolkit.config.json',
    status: 'pass',
    message: exists
      ? 'Found — the workspace is managed by nx-archweave; init and the generators merge into it, changing only their own fields'
      : 'Not found — init creates it',
    evidence: exists ? ['toolkit.config.json'] : [],
  });
}

/** Only nx-archweave writes archweave-integrations.json, and init never touches it; the
 * integration checks compare it with what is installed. */
function buildIntegrationManifestCheck(root: string): DoctorCheck {
  const exists = existsSync(join(root, 'archweave-integrations.json'));
  return createDoctorCheck({
    id: 'integration-manifest',
    label: 'Integration manifest',
    status: 'pass',
    message: exists
      ? "Found — nx-archweave's record of installed integrations (checked against what is installed below)"
      : 'Not found — written when an integration is installed',
    evidence: exists ? ['archweave-integrations.json'] : [],
  });
}

function buildAgentRulesCheck(root: string): DoctorCheck {
  const claudeExists = existsSync(join(root, 'CLAUDE.md'));
  const agentsExists = existsSync(join(root, 'AGENTS.md'));
  const exists = claudeExists || agentsExists;
  const evidence = [claudeExists && 'CLAUDE.md', agentsExists && 'AGENTS.md'].filter(Boolean) as string[];
  // Not a conflict any more: nx-archweave writes only its own
  // marked block and leaves everything around it — Nx's block, the user's text — untouched.
  return createDoctorCheck({
    id: 'agent-rules-files',
    label: 'CLAUDE.md / AGENTS.md',
    status: 'pass',
    message: exists
      ? "Existing agent rules file(s) found — nx-archweave adds or updates only its own marked block"
      : 'Not found — safe to create',
    evidence,
  });
}

function buildGithubTemplatesCheck(root: string): DoctorCheck {
  const issueTemplateExists = existsSync(join(root, '.github', 'ISSUE_TEMPLATE'));
  const prTemplateExists = existsSync(join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'));
  const exists = issueTemplateExists || prTemplateExists;
  // add-github-templates never overwrites a template (it skips it). Before init that is
  // worth a look — the user's own template stays instead of ours; once the workspace is
  // toolkit-managed, the templates are expected.
  const managed = isToolkitManaged(root);
  return createDoctorCheck({
    id: 'github-templates',
    label: 'GitHub Issue/PR templates',
    status: exists && !managed ? 'warning' : 'pass',
    message: !exists
      ? 'Not found — safe to create'
      : managed
        ? 'Found — kept as they are (add-github-templates never overwrites a template); the workspace is managed by nx-archweave'
        : 'Existing template(s) found — add-github-templates keeps them as they are (it never overwrites a template)',
    evidence: [issueTemplateExists && '.github/ISSUE_TEMPLATE', prTemplateExists && '.github/PULL_REQUEST_TEMPLATE.md'].filter(
      Boolean,
    ) as string[],
  });
}
