import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { composeReviewSetup } from '@nx-archweave/template-engine';
import { renderAddReviewReport } from './render.ts';
import { runAddReview } from './generator.ts';

const WORKFLOW_PATH = '.github/workflows/claude-code-review.yml';
const CONFIG_PATH = 'toolkit.config.json';

function expectedYaml(
  mode: 'fast' | 'standard' | 'thorough',
  locale: 'ko' | 'en',
  maxRounds: 1 | 2 | 3 | 4 | 5,
  provider: 'claude' | 'gemini' | 'gpt' | 'cursor' = 'claude',
): string {
  const plan = composeReviewSetup({ enabled: true, provider, mode, locale, maxRounds, packageManager: 'pnpm' });
  if (plan === null) throw new Error('unreachable');
  return plan.workflowYaml;
}

describe('runAddReview — fresh workspace', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('creates the workflow and the config with defaults (standard/en/3)', () => {
    const report = runAddReview(tree, {});
    expect(report.workflowAction).toBe('created');
    expect(report.configAction).toBe('created');
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 3));
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.review).toEqual({
      enabled: true,
      provider: 'claude',
      mode: 'standard',
      locale: 'en',
      maxRounds: 3,
      blockingPriorities: ['P0', 'P1'],
    });
  });

  it('is idempotent: a second identical run changes nothing', () => {
    runAddReview(tree, { mode: 'thorough', locale: 'ko', maxRounds: 5 });
    const changesAfterFirst = tree.listChanges().length;
    const report = runAddReview(tree, { mode: 'thorough', locale: 'ko', maxRounds: 5 });
    expect(report.workflowAction).toBe('unchanged');
    expect(report.configAction).toBe('unchanged');
    expect(tree.listChanges().length).toBe(changesAfterFirst);
  });

  it('preserves unrelated top-level config fields on update', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ preset: 'team', locale: 'ko' }, null, 2));
    runAddReview(tree, {});
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.preset).toBe('team');
    expect(config.review.enabled).toBe(true);
  });

  it('treats a review field with reordered keys as unchanged', () => {
    runAddReview(tree, {});
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    const reordered = Object.fromEntries(Object.entries(config.review).reverse());
    tree.write(CONFIG_PATH, JSON.stringify({ ...config, review: reordered }, null, 2));
    const before = tree.read(CONFIG_PATH, 'utf-8');
    const report = runAddReview(tree, {});
    expect(report.configAction).toBe('unchanged');
    expect(tree.read(CONFIG_PATH, 'utf-8')).toBe(before);
  });
});

describe('runAddReview — locale resolution', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('inherits locale from an existing config', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ locale: 'ko' }));
    runAddReview(tree, {});
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'ko', 3));
  });

  it('explicit option beats the config value', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ locale: 'ko' }));
    runAddReview(tree, { locale: 'en' });
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 3));
  });

  it('falls back to en when neither is present', () => {
    runAddReview(tree, {});
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 3));
  });
});

describe('runAddReview — unusable config aborts everything', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it.each([
    ['broken JSON', '{ not json'],
    ['non-object top level', '[1, 2, 3]'],
  ])('%s: writes nothing and reports the abort', (_name, content) => {
    tree.write(CONFIG_PATH, content);
    const before = tree.listChanges().length;
    const report = runAddReview(tree, {});
    expect(report.workflowAction).toBe('aborted');
    expect(report.configAction).toBe('aborted');
    expect(report.configError).toBeTruthy();
    expect(tree.exists(WORKFLOW_PATH)).toBe(false);
    expect(tree.listChanges().length).toBe(before);
  });
});

describe('runAddReview — conflict handling and atomicity', () => {
  const ALT_PATH = '.github/workflows/claude-code-review.archweave.yml';
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    runAddReview(tree, { maxRounds: 3 }); // install, then diverge by changing options
  });

  it('default (no onConflict): proposes with a diff, writes neither file', () => {
    const workflowBefore = tree.read(WORKFLOW_PATH, 'utf-8');
    const configBefore = tree.read(CONFIG_PATH, 'utf-8');
    const report = runAddReview(tree, { maxRounds: 5 });
    expect(report.workflowAction).toBe('proposed');
    expect(report.configAction).toBe('not-updated');
    expect(report.diff).toContain('--- existing');
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(workflowBefore);
    expect(tree.read(CONFIG_PATH, 'utf-8')).toBe(configBefore);
  });

  it('skip: writes neither file (same atomicity as the proposal)', () => {
    const workflowBefore = tree.read(WORKFLOW_PATH, 'utf-8');
    const configBefore = tree.read(CONFIG_PATH, 'utf-8');
    const report = runAddReview(tree, { maxRounds: 5, onConflict: 'skip' });
    expect(report.workflowAction).toBe('skipped');
    expect(report.configAction).toBe('not-updated');
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(workflowBefore);
    expect(tree.read(CONFIG_PATH, 'utf-8')).toBe(configBefore);
  });

  it('alternate-filename: writes only the alt file; main file and config untouched', () => {
    const workflowBefore = tree.read(WORKFLOW_PATH, 'utf-8');
    const configBefore = tree.read(CONFIG_PATH, 'utf-8');
    const report = runAddReview(tree, { maxRounds: 5, onConflict: 'alternate-filename' });
    expect(report.workflowAction).toBe('alternate');
    expect(report.workflowPath).toBe(ALT_PATH);
    expect(tree.read(ALT_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 5));
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(workflowBefore);
    expect(tree.read(CONFIG_PATH, 'utf-8')).toBe(configBefore);
  });

  it('overwrite: updates the workflow AND the config together', () => {
    const report = runAddReview(tree, { maxRounds: 5, onConflict: 'overwrite' });
    expect(report.workflowAction).toBe('overwritten');
    expect(report.configAction).toBe('updated');
    expect(tree.read(WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 5));
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.review.maxRounds).toBe(5);
  });
});

describe('runAddReview — provider option', () => {
  const GEMINI_WORKFLOW_PATH = '.github/workflows/gemini-code-review.yml';
  const GEMINI_ALT_PATH = '.github/workflows/gemini-code-review.archweave.yml';
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('defaults to claude when provider is omitted', () => {
    const report = runAddReview(tree, {});
    expect(report.workflowPath).toBe(WORKFLOW_PATH);
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.review.provider).toBe('claude');
  });

  it('installs the gemini workflow and records provider: gemini in the config', () => {
    const report = runAddReview(tree, { provider: 'gemini' });
    expect(report.workflowAction).toBe('created');
    expect(report.workflowPath).toBe(GEMINI_WORKFLOW_PATH);
    expect(tree.read(GEMINI_WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 3, 'gemini'));
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.review.provider).toBe('gemini');
  });

  it('alternate-filename on a gemini conflict writes the gemini alt path', () => {
    runAddReview(tree, { provider: 'gemini', maxRounds: 3 });
    const report = runAddReview(tree, { provider: 'gemini', maxRounds: 5, onConflict: 'alternate-filename' });
    expect(report.workflowAction).toBe('alternate');
    expect(report.workflowPath).toBe(GEMINI_ALT_PATH);
    expect(tree.read(GEMINI_ALT_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 5, 'gemini'));
    expect(tree.exists(GEMINI_WORKFLOW_PATH)).toBe(true);
  });

  it('installs the gpt workflow and records provider: gpt in the config', () => {
    const GPT_WORKFLOW_PATH = '.github/workflows/gpt-code-review.yml';
    const report = runAddReview(tree, { provider: 'gpt' });
    expect(report.workflowAction).toBe('created');
    expect(report.workflowPath).toBe(GPT_WORKFLOW_PATH);
    expect(tree.read(GPT_WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 3, 'gpt'));
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.review.provider).toBe('gpt');
  });

  it('installs the cursor workflow and records provider: cursor in the config', () => {
    const CURSOR_WORKFLOW_PATH = '.github/workflows/cursor-code-review.yml';
    const report = runAddReview(tree, { provider: 'cursor' });
    expect(report.workflowAction).toBe('created');
    expect(report.workflowPath).toBe(CURSOR_WORKFLOW_PATH);
    expect(tree.read(CURSOR_WORKFLOW_PATH, 'utf-8')).toBe(expectedYaml('standard', 'en', 3, 'cursor'));
    const config = JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string);
    expect(config.review.provider).toBe('cursor');
  });
});

describe('runAddReview — config indentation preservation', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('preserves 4-space indentation on update', () => {
    tree.write(CONFIG_PATH, `${JSON.stringify({ preset: 'team' }, null, 4)}\n`);
    runAddReview(tree, {});
    const raw = tree.read(CONFIG_PATH, 'utf-8') as string;
    expect(raw).toContain('\n    "preset"');
    expect(raw).toContain('\n    "review"');
  });

  it('preserves tab indentation on update', () => {
    tree.write(CONFIG_PATH, `${JSON.stringify({ preset: 'team' }, null, '\t')}\n`);
    runAddReview(tree, {});
    const raw = tree.read(CONFIG_PATH, 'utf-8') as string;
    expect(raw).toContain('\n\t"preset"');
    expect(raw).toContain('\n\t"review"');
  });

  it('preserves absence of a trailing newline on update', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ preset: 'team' }, null, 2));
    runAddReview(tree, {});
    const raw = tree.read(CONFIG_PATH, 'utf-8') as string;
    expect(raw.endsWith('\n')).toBe(false);
  });

  it('new file creation keeps 2-space indent and a trailing newline', () => {
    runAddReview(tree, {});
    const raw = tree.read(CONFIG_PATH, 'utf-8') as string;
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "review"');
  });
});

describe('runAddReview — dryRun', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('fresh workspace: previews everything, writes nothing', () => {
    const before = tree.listChanges().length;
    const report = runAddReview(tree, { dryRun: true });
    expect(report.workflowAction).toBe('created');
    expect(report.workflowYaml).toBe(expectedYaml('standard', 'en', 3));
    expect(JSON.parse(report.configSnippetJson as string).enabled).toBe(true);
    expect(tree.listChanges().length).toBe(before);
    expect(tree.exists(WORKFLOW_PATH)).toBe(false);
  });

  it('with onConflict: previews the effective decision (alt path) without writing', () => {
    runAddReview(tree, { maxRounds: 3 });
    const before = tree.listChanges().length;
    const report = runAddReview(tree, { maxRounds: 5, dryRun: true, onConflict: 'alternate-filename' });
    expect(report.workflowAction).toBe('alternate');
    expect(report.workflowPath).toBe('.github/workflows/claude-code-review.archweave.yml');
    expect(tree.listChanges().length).toBe(before);
  });
});

describe('runAddReview — packageManager threading', () => {
  it('a yarn workspace gets the Corepack + flavor-checking install', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', '# yarn lockfile v1\n');
    const report = runAddReview(tree, {});
    const workflow = tree.read(report.workflowPath, 'utf-8') ?? '';
    expect(workflow).toContain('corepack enable yarn');
    expect(workflow).toContain('yarn install --immutable');
    expect(workflow).toContain('yarn install --frozen-lockfile');
    expect(workflow).not.toContain('npm ci');
    expect(report.packageManagerNote).toBeUndefined();
  });

  it('a bun workspace gets setup-bun and a frozen bun install', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('bun.lock', '{}\n');
    const report = runAddReview(tree, {});
    const workflow = tree.read(report.workflowPath, 'utf-8') ?? '';
    expect(workflow).toContain('oven-sh/setup-bun@');
    expect(workflow).toContain('bun install --frozen-lockfile');
    expect(workflow).not.toContain('npm ci');
    expect(report.packageManagerNote).toBeUndefined();
  });

  it("no lockfile: the package manager init recorded is used, with no guessed-pnpm note", () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('toolkit.config.json', '{ "packageManager": "bun" }\n');
    const report = runAddReview(tree, {});
    expect(tree.read(report.workflowPath, 'utf-8') ?? '').toContain('bun install --frozen-lockfile');
    expect(report.packageManagerNote).toBeUndefined();
  });

  it('a stray yarn.lock next to package-lock.json does not give an npm repo a yarn workflow', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', '# yarn lockfile v1\n');
    tree.write('package-lock.json', '{}\n');
    const report = runAddReview(tree, {});
    const workflow = tree.read(report.workflowPath, 'utf-8') ?? '';
    expect(workflow).toContain('npm ci');
    expect(workflow).not.toContain('corepack');
  });

  it('an explicit packageManager option wins on a lockfile-less tree (no silent pnpm workflow)', () => {
    const tree = createTreeWithEmptyWorkspace(); // no lockfile at all
    const report = runAddReview(tree, { packageManager: 'npm' });
    expect(report.workflowYaml ?? tree.read(report.workflowPath, 'utf-8')).toContain('npm ci');
    expect(tree.read(report.workflowPath, 'utf-8')).not.toContain('pnpm/action-setup');
  });

  it('no option and no detection signal → pnpm fallback WITH a report note', () => {
    const tree = createTreeWithEmptyWorkspace();
    const report = runAddReview(tree, {});
    expect(report.packageManagerNote).toContain('pnpm');
    const text = renderAddReviewReport(report);
    expect(text).toContain('could not be detected');
  });

  it('a detected pm needs no note', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('package-lock.json', '{}\n');
    const report = runAddReview(tree, {});
    expect(report.packageManagerNote).toBeUndefined();
    expect(tree.read(report.workflowPath, 'utf-8')).toContain('npm ci');
  });
});

describe('runAddReview — a bare rerun keeps the recorded review settings', () => {
  it('provider, mode and maxRounds come from toolkit.config.json when no option is passed; options still win', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('pnpm-lock.yaml', '');
    runAddReview(tree, { provider: 'gemini', mode: 'fast', maxRounds: 2 });
    const bare = runAddReview(tree, {});
    expect(bare.workflowAction).toBe('unchanged');
    expect(bare.configAction).toBe('unchanged');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).review).toMatchObject({ provider: 'gemini', mode: 'fast', maxRounds: 2 });
    expect(runAddReview(createTreeWithEmptyWorkspace(), {}).requiredSecretName).toBe(runAddReview(createTreeWithEmptyWorkspace(), { provider: 'claude' }).requiredSecretName);
  });
});

describe('runAddReview — Dependabot keeps the pinned actions moving', () => {
  const DEPENDABOT_PATH = '.github/dependabot.yml';
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('creates .github/dependabot.yml with a github-actions entry when the file is missing', () => {
    const report = runAddReview(tree, {});
    expect(report.dependabot).toBe('created');
    const written = tree.read(DEPENDABOT_PATH, 'utf-8') as string;
    expect(written).toContain('package-ecosystem: github-actions');
    expect(renderAddReviewReport(report)).toContain(DEPENDABOT_PATH);
  });

  it('leaves a file that already updates github-actions alone', () => {
    const existing = 'version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n    schedule:\n      interval: daily\n';
    tree.write(DEPENDABOT_PATH, existing);
    const report = runAddReview(tree, {});
    expect(report.dependabot).toBe('present');
    expect(tree.read(DEPENDABOT_PATH, 'utf-8')).toBe(existing);
  });

  it('only proposes the entry when the file exists without github-actions', () => {
    const existing = 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule:\n      interval: weekly\n';
    tree.write(DEPENDABOT_PATH, existing);
    const report = runAddReview(tree, {});
    expect(report.dependabot).toBe('proposed');
    expect(tree.read(DEPENDABOT_PATH, 'utf-8')).toBe(existing);
    expect(renderAddReviewReport(report)).toContain('package-ecosystem: github-actions');
  });

  it('writes nothing in a dry run', () => {
    const report = runAddReview(tree, { dryRun: true });
    expect(report.dependabot).toBe('created');
    expect(tree.exists(DEPENDABOT_PATH)).toBe(false);
  });

  it('touches nothing when the run aborts on an unusable config', () => {
    tree.write('toolkit.config.json', '{ not json');
    const report = runAddReview(tree, {});
    expect(report.dependabot).toBe('not-applied');
    expect(tree.exists(DEPENDABOT_PATH)).toBe(false);
  });
});

describe('runAddReview — providers still in beta', () => {
  it.each(['gemini', 'gpt', 'cursor'] as const)('%s: the report says it is in beta and links the provider status', (provider) => {
    const tree = createTreeWithEmptyWorkspace();
    const report = runAddReview(tree, { provider });
    expect(report.betaProvider).toBe(provider);
    const text = renderAddReviewReport(report);
    expect(text).toContain(`Note: the ${provider} provider is in beta`);
    expect(text).toContain('docs/pr-review.md#provider-status');
  });

  it('claude (the default): no beta note', () => {
    const tree = createTreeWithEmptyWorkspace();
    const report = runAddReview(tree, {});
    expect(report.betaProvider).toBeUndefined();
    expect(renderAddReviewReport(report)).not.toContain('is in beta');
  });
});
