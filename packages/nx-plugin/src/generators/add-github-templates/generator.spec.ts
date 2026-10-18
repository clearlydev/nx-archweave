import { createTree, createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import {
  BUG_REPORT_PATH,
  CODEOWNERS_PATH,
  FEATURE_REQUEST_PATH,
  PULL_REQUEST_TEMPLATE_PATH as PR_TEMPLATE_PATH,
  runAddGithubTemplates,
} from './generator.ts';

const CONFIG_PATH = 'toolkit.config.json';

/** The file's text as the templates render it into an empty workspace. */
function contentFor(filePath: string, locale: 'en' | 'ko'): string {
  const files = runAddGithubTemplates(createTree(), { issue: true, pr: true, codeowners: true, locale, dryRun: true }).files;
  const match = files.find((f) => f.filePath === filePath);
  if (!match) throw new Error(`unreachable: ${filePath} not in the all-flags-on set`);
  return match.content;
}

describe('runAddGithubTemplates — defaults', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('installs only the PR template (pr: true is the sole default-on flag)', () => {
    const report = runAddGithubTemplates(tree, {});
    expect(report.files).toEqual([{ filePath: PR_TEMPLATE_PATH, action: 'created', content: contentFor(PR_TEMPLATE_PATH, 'en') }]);
    expect(tree.read(PR_TEMPLATE_PATH, 'utf-8')).toBe(contentFor(PR_TEMPLATE_PATH, 'en'));
    expect(tree.exists(BUG_REPORT_PATH)).toBe(false);
    expect(tree.exists(FEATURE_REQUEST_PATH)).toBe(false);
    expect(tree.exists(CODEOWNERS_PATH)).toBe(false);
  });

  it('is idempotent: a second identical run reports unchanged and writes nothing new', () => {
    runAddGithubTemplates(tree, {});
    const changesAfterFirst = tree.listChanges().length;
    const report = runAddGithubTemplates(tree, {});
    expect(report.files).toEqual([
      { filePath: PR_TEMPLATE_PATH, action: 'unchanged', content: contentFor(PR_TEMPLATE_PATH, 'en') },
    ]);
    expect(tree.listChanges().length).toBe(changesAfterFirst);
  });
});

describe('runAddGithubTemplates — per-flag coverage', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('issue: true creates both issue forms', () => {
    const report = runAddGithubTemplates(tree, { issue: true, pr: false });
    expect(report.files).toEqual([
      { filePath: BUG_REPORT_PATH, action: 'created', content: contentFor(BUG_REPORT_PATH, 'en') },
      { filePath: FEATURE_REQUEST_PATH, action: 'created', content: contentFor(FEATURE_REQUEST_PATH, 'en') },
    ]);
    expect(tree.read(BUG_REPORT_PATH, 'utf-8')).toBe(contentFor(BUG_REPORT_PATH, 'en'));
    expect(tree.read(FEATURE_REQUEST_PATH, 'utf-8')).toBe(contentFor(FEATURE_REQUEST_PATH, 'en'));
  });

  it('codeowners: true creates the CODEOWNERS placeholder', () => {
    const report = runAddGithubTemplates(tree, { pr: false, codeowners: true });
    expect(report.files).toEqual([
      { filePath: CODEOWNERS_PATH, action: 'created', content: contentFor(CODEOWNERS_PATH, 'en') },
    ]);
    expect(tree.read(CODEOWNERS_PATH, 'utf-8')).toBe(contentFor(CODEOWNERS_PATH, 'en'));
  });

  it('pr: false disables the PR template', () => {
    const report = runAddGithubTemplates(tree, { pr: false });
    expect(report.files).toEqual([]);
    expect(tree.exists(PR_TEMPLATE_PATH)).toBe(false);
  });

  it('all flags on creates all four files', () => {
    const report = runAddGithubTemplates(tree, { issue: true, pr: true, codeowners: true });
    expect(report.files.map((f) => f.filePath)).toEqual([
      BUG_REPORT_PATH,
      FEATURE_REQUEST_PATH,
      PR_TEMPLATE_PATH,
      CODEOWNERS_PATH,
    ]);
    expect(report.files.every((f) => f.action === 'created')).toBe(true);
  });
});

describe('runAddGithubTemplates — locale resolution', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('inherits locale from an existing config', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ locale: 'ko' }));
    runAddGithubTemplates(tree, {});
    expect(tree.read(PR_TEMPLATE_PATH, 'utf-8')).toBe(contentFor(PR_TEMPLATE_PATH, 'ko'));
  });

  it('explicit option beats the config value', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ locale: 'ko' }));
    runAddGithubTemplates(tree, { locale: 'en' });
    expect(tree.read(PR_TEMPLATE_PATH, 'utf-8')).toBe(contentFor(PR_TEMPLATE_PATH, 'en'));
  });

  it('falls back to en when neither is present', () => {
    runAddGithubTemplates(tree, {});
    expect(tree.read(PR_TEMPLATE_PATH, 'utf-8')).toBe(contentFor(PR_TEMPLATE_PATH, 'en'));
  });

  it('falls back to en (without aborting) when the config is unusable JSON', () => {
    tree.write(CONFIG_PATH, '{ not json');
    const report = runAddGithubTemplates(tree, {});
    expect(report.files).toEqual([
      { filePath: PR_TEMPLATE_PATH, action: 'created', content: contentFor(PR_TEMPLATE_PATH, 'en') },
    ]);
    expect(tree.read(CONFIG_PATH, 'utf-8')).toBe('{ not json'); // never touched
  });
});

describe('runAddGithubTemplates — conflict handling (skip-always, no onConflict option)', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('an existing, differing file is left as-is and reported skipped', () => {
    tree.write(PR_TEMPLATE_PATH, 'custom org template');
    const report = runAddGithubTemplates(tree, {});
    expect(report.files).toEqual([
      { filePath: PR_TEMPLATE_PATH, action: 'skipped', content: contentFor(PR_TEMPLATE_PATH, 'en') },
    ]);
    expect(tree.read(PR_TEMPLATE_PATH, 'utf-8')).toBe('custom org template');
  });

  it('one conflicting file does not block sibling files from being created', () => {
    tree.write(PR_TEMPLATE_PATH, 'custom org template');
    const report = runAddGithubTemplates(tree, { issue: true, pr: true, codeowners: true });
    expect(report.files).toEqual([
      { filePath: BUG_REPORT_PATH, action: 'created', content: contentFor(BUG_REPORT_PATH, 'en') },
      { filePath: FEATURE_REQUEST_PATH, action: 'created', content: contentFor(FEATURE_REQUEST_PATH, 'en') },
      { filePath: PR_TEMPLATE_PATH, action: 'skipped', content: contentFor(PR_TEMPLATE_PATH, 'en') },
      { filePath: CODEOWNERS_PATH, action: 'created', content: contentFor(CODEOWNERS_PATH, 'en') },
    ]);
    expect(tree.read(PR_TEMPLATE_PATH, 'utf-8')).toBe('custom org template');
    expect(tree.exists(BUG_REPORT_PATH)).toBe(true);
    expect(tree.exists(CODEOWNERS_PATH)).toBe(true);
  });

  it('a file matching the generated content exactly is reported unchanged, not skipped', () => {
    tree.write(PR_TEMPLATE_PATH, contentFor(PR_TEMPLATE_PATH, 'en'));
    const report = runAddGithubTemplates(tree, {});
    expect(report.files).toEqual([
      { filePath: PR_TEMPLATE_PATH, action: 'unchanged', content: contentFor(PR_TEMPLATE_PATH, 'en') },
    ]);
  });
});

describe('runAddGithubTemplates — dryRun', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('previews all selected files and writes nothing', () => {
    const before = tree.listChanges().length;
    const report = runAddGithubTemplates(tree, { issue: true, pr: true, codeowners: true, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.files.map((f) => f.action)).toEqual(['created', 'created', 'created', 'created']);
    expect(report.files.map((f) => f.content)).toEqual([
      contentFor(BUG_REPORT_PATH, 'en'),
      contentFor(FEATURE_REQUEST_PATH, 'en'),
      contentFor(PR_TEMPLATE_PATH, 'en'),
      contentFor(CODEOWNERS_PATH, 'en'),
    ]);
    expect(tree.listChanges().length).toBe(before);
  });

  it('previews the skip decision for an existing conflicting file too', () => {
    tree.write(PR_TEMPLATE_PATH, 'custom org template');
    const before = tree.listChanges().length;
    const report = runAddGithubTemplates(tree, { dryRun: true });
    expect(report.files).toEqual([
      { filePath: PR_TEMPLATE_PATH, action: 'skipped', content: contentFor(PR_TEMPLATE_PATH, 'en') },
    ]);
    expect(tree.listChanges().length).toBe(before);
  });
});
