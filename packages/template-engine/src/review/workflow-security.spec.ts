import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupportedPackageManager } from '../environment/package-manager.ts';
import { ACTION_PINS } from './action-pins.ts';
import { REVIEW_PROVIDERS } from './provider.ts';
import { ROUND_MARKER } from './workflow-skeleton.ts';

const PACKAGE_MANAGERS: SupportedPackageManager[] = ['pnpm', 'npm', 'yarn', 'bun'];
const PINNED_USES = /^\s*(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/;

function render(providerId: keyof typeof REVIEW_PROVIDERS, packageManager: SupportedPackageManager): string {
  return REVIEW_PROVIDERS[providerId].buildWorkflowYaml({ mode: 'thorough', locale: 'en', maxRounds: 3, packageManager });
}

/** Each `- name:` step of the rendered job, as its own text block. */
function stepsOf(yaml: string): string[] {
  return yaml.split(/\n(?=\s*- name: )/);
}

describe.each(Object.keys(REVIEW_PROVIDERS) as (keyof typeof REVIEW_PROVIDERS)[])('%s workflow security', (providerId) => {
  it.each(PACKAGE_MANAGERS)('pins every action to a commit SHA (%s)', (packageManager) => {
    const usesLines = render(providerId, packageManager)
      .split('\n')
      .filter((line) => /^\s*(- )?uses: /.test(line));
    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) expect(line).toMatch(PINNED_USES);
  });

  it.each(PACKAGE_MANAGERS)('never persists the checkout credentials (%s)', (packageManager) => {
    const checkouts = stepsOf(render(providerId, packageManager)).filter((step) => step.includes('uses: actions/checkout@'));
    expect(checkouts.length).toBe(1);
    for (const step of checkouts) expect(step).toContain('persist-credentials: false');
  });

  it('counts only bot-authored round markers', () => {
    const yaml = render(providerId, 'npm');
    expect(yaml).toContain(`[.[] | select(.user.type == "Bot") | select(.body | contains("${ROUND_MARKER}"))]`);
  });

  it('lets the runner decide the pnpm version from packageManager', () => {
    const yaml = render(providerId, 'pnpm');
    expect(yaml).toContain('- name: Detect pnpm version');
    expect(yaml).toContain(`jq -r '.packageManager // empty' package.json`);
    expect(yaml).toContain('version: ${{ steps.pnpm-version.outputs.version }}');
    expect(yaml).not.toMatch(/^\s*version: 10$/m);
  });
});

describe('pinned-actions.yml', () => {
  it('lists exactly the pins the generated workflows use, so Dependabot updates reach them', () => {
    const file = readFileSync(join(__dirname, '../../../../.github/workflows/pinned-actions.yml'), 'utf-8');
    const listed = file
      .split('\n')
      .map((line) => /^\s*(?:- )?uses: (.+)$/.exec(line)?.[1].trim())
      .filter((uses): uses is string => uses !== undefined);
    expect(new Set(listed)).toEqual(new Set(Object.values(ACTION_PINS)));
  });
});
