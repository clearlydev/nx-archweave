import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { buildPresetConfig, composeAgentRules, renderAgentRulesBlock, rulesFilesFor } from '@nx-archweave/template-engine';
import { initGenerator, runInit, type InitDeps } from './generator.ts';
import { renderInitReport } from './render.ts';
import { runAddAgentRules } from '../add-agent-rules/generator.ts';
import { runAddFsdLite } from '../add-fsd-lite/generator.ts';

/** A workspace with one frontend app — add-fsd-lite puts the layers in its source root. */
function appTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('apps/web/package.json', JSON.stringify({ name: 'web', private: true, nx: { projectType: 'application' } }, null, 2));
  return tree;
}

const BROKEN_MARKERS = '<!-- nx-archweave:agent-rules start -->\nhalf a block\n';
const CLEAN: InitDeps = { isWorkingTreeClean: () => true };
const DIRTY: InitDeps = { isWorkingTreeClean: () => false };

function section(report: ReturnType<typeof runInit>, id: 'fsd' | 'agentRules' | 'githubTemplates' | 'review' | 'backend') {
  return report.sections.find((s) => s.id === id);
}

describe('runInit — dirty tree refusal', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('refuses and writes nothing when the tree is dirty', () => {
    const before = tree.listChanges().length;
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, DIRTY);
    expect(report.refused).toBe(true);
    expect(report.cleanTree).toBe(false);
    expect(report.sections).toEqual([]);
    expect(tree.listChanges().length).toBe(before);
  });

  it('never even calls isWorkingTreeClean when dryRun is set', () => {
    const before = tree.listChanges().length;
    const isWorkingTreeClean = jest.fn(() => false);
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', dryRun: true }, { isWorkingTreeClean });
    expect(isWorkingTreeClean).not.toHaveBeenCalled();
    expect(report.refused).toBe(false);
    expect(report.cleanTree).toBe(true);
    expect(tree.listChanges().length).toBe(before);
  });

  it('allowDirty runs the full pipeline against a dirty tree, recording that the tree was dirty', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', allowDirty: true }, DIRTY);
    expect(report.refused).toBe(false);
    expect(report.cleanTree).toBe(false);
    expect(report.allowDirty).toBe(true);
    expect(report.sections).toHaveLength(5);
    expect(tree.listChanges().length).toBeGreaterThan(0);
  });

  it('allowDirty on a clean tree behaves like a normal run (cleanTree stays true)', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', allowDirty: true }, CLEAN);
    expect(report.refused).toBe(false);
    expect(report.cleanTree).toBe(true);
    expect(report.allowDirty).toBe(true);
  });
});

describe('runInit — preset compositions', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('quick-start: fsd + agent-rules(simple) + github-templates(pr-only), review off by default', () => {
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite' }, CLEAN);
    expect(report.refused).toBe(false);

    const fsd = section(report, 'fsd');
    expect(fsd?.enabled).toBe(true);
    expect(fsd?.report?.kind).toBe('fsd');

    const agentRules = section(report, 'agentRules');
    expect(agentRules?.enabled).toBe(true);
    if (agentRules?.report?.kind === 'agentRules') {
      expect(agentRules.report.report.files.map((f) => f.filePath)).toEqual(['CLAUDE.md']);
    } else {
      throw new Error('expected agentRules report');
    }

    const github = section(report, 'githubTemplates');
    if (github?.report?.kind === 'githubTemplates') {
      expect(github.report.report.files.map((f) => f.filePath)).toEqual(['.github/PULL_REQUEST_TEMPLATE.md']);
    } else {
      throw new Error('expected githubTemplates report');
    }

    const review = section(report, 'review');
    expect(review?.enabled).toBe(false);
    expect(review?.report).toBeNull();
  });

  it('solo: agent rules for the default host (Claude Code → CLAUDE.md), pr-only github templates, review on (fast mode)', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);

    const agentRules = section(report, 'agentRules');
    if (agentRules?.report?.kind === 'agentRules') {
      expect(agentRules.report.report.files.map((f) => f.filePath)).toEqual(['CLAUDE.md']);
    } else {
      throw new Error('expected agentRules report');
    }

    const review = section(report, 'review');
    expect(review?.enabled).toBe(true);
    if (review?.report?.kind === 'review') {
      expect(review.report.report.workflowPath).toBe('.github/workflows/claude-code-review.yml');
    } else {
      throw new Error('expected review report');
    }
    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    expect(config.review.mode).toBe('fast');

    // team-preset-extras: solo keeps warn-level enforcement and no team section
    const fsd = section(report, 'fsd');
    if (fsd?.report?.kind === 'fsd') {
      expect(fsd.report.report.enforcement).toBe('warn');
    } else {
      throw new Error('expected fsd report');
    }
    if (agentRules?.report?.kind === 'agentRules') {
      expect(agentRules.report.report.teamRules).toBe(false);
    }
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(
      `${renderAgentRulesBlock(composeAgentRules({ files: ['CLAUDE.md'], locale: 'en', teamRules: false, fsdStructure: true })[0].content)}\n`,
    );
  });

  it('team: issue+pr github templates, review on (standard mode), error-level enforcement, team rules section', () => {
    const report = runInit(tree, { preset: 'team', frontend: 'next' }, CLEAN);

    const github = section(report, 'githubTemplates');
    if (github?.report?.kind === 'githubTemplates') {
      expect(github.report.report.files.map((f) => f.filePath).sort()).toEqual(
        ['.github/ISSUE_TEMPLATE/bug-report.yml', '.github/ISSUE_TEMPLATE/feature-request.yml', '.github/PULL_REQUEST_TEMPLATE.md'].sort(),
      );
    } else {
      throw new Error('expected githubTemplates report');
    }

    const fsd = section(report, 'fsd');
    if (fsd?.report?.kind === 'fsd') {
      expect(fsd.report.report.enforcement).toBe('error');
      expect(fsd.report.report.layerGuide).toContain('apps/web/src/_pages');
      // no --applyEslint: report-only, the snippet carries the team severity
      expect(fsd.report.report.eslint).toBe('snippet-only');
      expect(fsd.report.report.snippet).toContain("severity: 'error'");
    } else {
      throw new Error('expected fsd report');
    }

    const agentRules = section(report, 'agentRules');
    if (agentRules?.report?.kind === 'agentRules') {
      expect(agentRules.report.report.teamRules).toBe(true);
    } else {
      throw new Error('expected agentRules report');
    }
    const expectedTeamDoc = composeAgentRules({ files: ['CLAUDE.md'], locale: 'en', teamRules: true, fsdStructure: true });
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(`${renderAgentRulesBlock(expectedTeamDoc[0].content)}\n`);
    expect(tree.exists('AGENTS.md')).toBe(false); // the default host reads CLAUDE.md only

    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    expect(config.review.mode).toBe('standard');
  });

  it('every enabled section matches buildPresetConfig\'s own output exactly (no content literals in init)', () => {
    const config = buildPresetConfig({
      preset: 'team',
      frontend: 'react-vite',
      backend: 'none',
      locale: 'en',
      packageManager: 'pnpm',
      reviewEnabled: undefined,
    });
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const agentRules = section(report, 'agentRules');
    if (agentRules?.report?.kind === 'agentRules') {
      expect(agentRules.report.report.files.map((f) => f.filePath)).toEqual(rulesFilesFor(config.aiHosts));
      expect(agentRules.report.report.teamRules).toBe(config.agentRules.teamRules);
    } else {
      throw new Error('expected agentRules report');
    }
    const fsd = section(report, 'fsd');
    if (fsd?.report?.kind === 'fsd') {
      expect(fsd.report.report.enforcement).toBe(config.fsd.enforcement);
    } else {
      throw new Error('expected fsd report');
    }
  });
});

describe('runInit — toolkit.config.json records the preset choices', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('team: fsd.enforcement=error and agentRules.teamRules=true land next to the review field', () => {
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    expect(config.fsd).toEqual({ enforcement: 'error' });
    expect(config.agentRules).toEqual({ teamRules: true });
    expect(config.aiHosts).toEqual(['claude-code']);
    expect(config.review.mode).toBe('standard'); // add-review's field survives the merge
    expect(report.config).toEqual({ action: 'updated', fields: ['locale', 'preset', 'frontend', 'fsd.enforcement', 'agentRules.teamRules', 'aiHosts'], notRecorded: [] });
  });

  it('quick-start (review off): the file is created for the recorded choices alone', () => {
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite' }, CLEAN);
    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    // no lockfile and no flag: pnpm is only a guess, so it is not recorded
    expect(config).toEqual({
      locale: 'en',
      preset: 'quick-start',
      frontend: 'react-vite',
      fsd: { enforcement: 'warn' },
      agentRules: { teamRules: false },
      aiHosts: ['claude-code'],
    });
    expect(report.config?.action).toBe('created');
  });

  it('merges into an existing config, preserving unrelated keys, sibling keys, and indentation', () => {
    tree.write('toolkit.config.json', '{\n    "locale": "en",\n    "fsd": {\n        "custom": 1\n    }\n}\n');
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite', review: false }, CLEAN);
    const raw = tree.read('toolkit.config.json', 'utf-8') as string;
    const config = JSON.parse(raw);
    expect(config.locale).toBe('en');
    expect(config.fsd).toEqual({ custom: 1, enforcement: 'error' });
    expect(config.agentRules).toEqual({ teamRules: true });
    expect(raw).toMatch(/^ {4}"locale"/m);
    expect(raw.endsWith('\n')).toBe(true);
    expect(report.config?.action).toBe('updated');
  });

  it('the standalone generators then resolve the recorded values on a rerun (the regression the write exists for)', () => {
    runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const changesAfterInit = tree.listChanges().length;
    // bare reruns — no flags — must see the team choices through toolkit.config.json
    const agentRules = runAddAgentRules(tree, {});
    const fsd = runAddFsdLite(tree, { frontend: 'react-vite' });
    expect(agentRules.teamRules).toBe(true);
    expect(agentRules.files.every((f) => f.action === 'unchanged')).toBe(true);
    expect(fsd.enforcement).toBe('error');
    expect(tree.exists('CLAUDE.generated.md')).toBe(false);
    expect(tree.listChanges().length).toBe(changesAfterInit);
  });

  it('locale is recorded, and every later generator writes in it', () => {
    runInit(tree, { preset: 'solo', frontend: 'next', locale: 'ko' }, CLEAN);
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).locale).toBe('ko');
    const changesAfterInit = tree.listChanges().length;
    // a bare rerun of add-agent-rules keeps Korean: nothing changes
    expect(runAddAgentRules(tree, {}).locale).toBe('ko');
    expect(tree.listChanges().length).toBe(changesAfterInit);
  });

  it('a recorded locale nx-archweave does not know falls back to en and is corrected; dryRun records nothing', () => {
    tree.write('toolkit.config.json', '{ "locale": "fr" }\n');
    expect(runInit(tree, { preset: 'solo', frontend: 'next', dryRun: true }, CLEAN).config?.action).toBe('updated');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).locale).toBe('fr');
    runInit(tree, { preset: 'solo', frontend: 'next' }, CLEAN);
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).locale).toBe('en');
  });

  it('a bare init rerun takes the recorded preset and frontend; flags still win; nothing recorded asks for the flag', () => {
    runInit(tree, { preset: 'team', frontend: 'next' }, CLEAN);
    const bare = runInit(tree, {}, CLEAN);
    expect(bare).toMatchObject({ preset: 'team', frontend: 'next' });
    expect(bare.config?.action).toBe('unchanged');
    expect(runInit(tree, { preset: 'solo' }, CLEAN).preset).toBe('solo');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).preset).toBe('solo');
    expect(() => runInit(appTree(), {}, CLEAN)).toThrow('init: pass --preset=quick-start|solo|team');
    expect(() => runInit(appTree(), { preset: 'solo' }, CLEAN)).toThrow('init: pass --frontend=react-vite|next');
  });

  it('a recorded value nx-archweave does not know is ignored: no frontend left asks for the flag', () => {
    tree.write('toolkit.config.json', '{ "preset": "solo", "frontend": "vue" }\n');
    expect(() => runInit(tree, {}, CLEAN)).toThrow('init: pass --frontend=react-vite|next');
  });

  it('packageManager: a lockfile beats the recorded one (a switch is respected); the recorded one beats the pnpm guess', () => {
    tree.write('toolkit.config.json', '{ "packageManager": "bun" }\n');
    expect(runInit(tree, { preset: 'solo', frontend: 'next' }, CLEAN).packageManager).toBe('bun');
    tree.write('package-lock.json', '{}');
    expect(runInit(tree, { preset: 'solo', frontend: 'next' }, CLEAN).packageManager).toBe('npm');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).packageManager).toBe('npm');
  });

  it('reviewProvider: the option wins, then the recorded one, then the first AI host\'s', () => {
    runInit(tree, { preset: 'solo', frontend: 'next', aiHosts: ['codex'] }, CLEAN);
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).review.provider).toBe('gpt');
    runInit(tree, { preset: 'solo', frontend: 'next', reviewProvider: 'gemini' }, CLEAN);
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).review.provider).toBe('gemini');
    runInit(tree, { preset: 'solo', frontend: 'next' }, CLEAN);
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).review.provider).toBe('gemini');
  });

  it('reviewProvider: --aiHosts with another first host re-derives it; the same first host keeps the recorded one', () => {
    runInit(tree, { preset: 'solo', frontend: 'next', aiHosts: ['claude-code'], reviewProvider: 'gemini' }, CLEAN);
    const provider = () => JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).review.provider;
    runInit(tree, { preset: 'solo', frontend: 'next', aiHosts: ['claude-code', 'codex'] }, CLEAN);
    expect(provider()).toBe('gemini');
    runInit(tree, { preset: 'solo', frontend: 'next', aiHosts: ['codex'] }, CLEAN);
    expect(provider()).toBe('gpt');
  });

  it('a bare init rerun keeps the recorded locale; --locale still wins', () => {
    runInit(tree, { preset: 'solo', frontend: 'next', locale: 'ko' }, CLEAN);
    expect(runInit(tree, { preset: 'solo', frontend: 'next' }, CLEAN).config?.action).toBe('unchanged');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).locale).toBe('ko');
    runInit(tree, { preset: 'solo', frontend: 'next', locale: 'en' }, CLEAN);
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).locale).toBe('en');
  });

  it('an unusable config is left alone and reported, never rewritten', () => {
    tree.write('toolkit.config.json', '{ not json');
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite' }, CLEAN);
    expect(tree.read('toolkit.config.json', 'utf-8')).toBe('{ not json');
    expect(report.config?.action).toBe('unrecognized');
    expect(renderInitReport(report)).toContain('toolkit.config.json');
  });

  it('dryRun computes the outcome but writes nothing', () => {
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite', dryRun: true }, CLEAN);
    expect(tree.exists('toolkit.config.json')).toBe(false);
    expect(report.config?.action).toBe('created');
  });

  it('a second run finds the fields already recorded and writes nothing', () => {
    runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const before = tree.read('toolkit.config.json', 'utf-8');
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    expect(tree.read('toolkit.config.json', 'utf-8')).toBe(before);
    expect(report.config?.action).toBe('unchanged');
  });

  it('records only what was actually applied: agent rules whose markers cannot be placed keep teamRules and aiHosts out', () => {
    tree.write('CLAUDE.md', BROKEN_MARKERS);
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    expect(config.fsd).toEqual({ enforcement: 'error' });
    expect(config.agentRules).toBeUndefined();
    expect(config.aiHosts).toBeUndefined();
    expect(report.config?.fields).toEqual(['locale', 'preset', 'frontend', 'fsd.enforcement']);
    expect(report.config?.notRecorded).toEqual([
      { field: 'agentRules.teamRules', rerun: 'add-agent-rules --teamRules' },
      { field: 'aiHosts', rerun: 'add-agent-rules --hosts=claude-code' },
    ]);
    const rendered = renderInitReport(report);
    expect(rendered).toContain('not recorded: agentRules.teamRules');
    expect(rendered).toContain('add-agent-rules --teamRules');
  });

  it('records only what was actually applied: an aborted fsd section keeps enforcement out', () => {
    tree.write('apps/admin/package.json', JSON.stringify({ name: 'admin', nx: { projectType: 'application' } }));
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    expect(config.fsd).toBeUndefined();
    expect(config.agentRules).toEqual({ teamRules: true });
    expect(report.config?.fields).toEqual(['locale', 'preset', 'frontend', 'agentRules.teamRules', 'aiHosts']);
    expect(report.config?.notRecorded).toEqual([{ field: 'fsd.enforcement', rerun: 'add-fsd-lite --enforcement=error' }]);
    expect(renderInitReport(report)).toContain('add-fsd-lite --enforcement=error');
  });

  it('both sections disabled: nothing to record, nothing written, nothing rendered', () => {
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite', fsd: false, agentRules: false }, CLEAN);
    expect(tree.exists('toolkit.config.json')).toBe(false);
    expect(report.config).toEqual({ action: 'skipped', fields: [], notRecorded: [] });
    expect(renderInitReport(report)).not.toContain('toolkit.config.json');
  });

  it('both sections enabled but neither applied: nothing recorded, but the block says why', () => {
    tree.write('apps/admin/package.json', JSON.stringify({ name: 'admin', nx: { projectType: 'application' } }));
    tree.write('CLAUDE.md', BROKEN_MARKERS);
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite' }, CLEAN);
    expect(tree.exists('toolkit.config.json')).toBe(false);
    expect(report.config?.action).toBe('skipped');
    expect(report.config?.notRecorded.map((n) => n.field)).toEqual(['fsd.enforcement', 'agentRules.teamRules', 'aiHosts']);
    expect(renderInitReport(report)).toContain('not recorded: fsd.enforcement, agentRules.teamRules, aiHosts');
  });
});

describe('runInit — toggle overrides', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('forces review on for quick-start when review: true is passed', () => {
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite', review: true }, CLEAN);
    expect(section(report, 'review')?.enabled).toBe(true);
  });

  it('forces review off for team when review: false is passed', () => {
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite', review: false }, CLEAN);
    expect(section(report, 'review')?.enabled).toBe(false);
  });

  it('skips fsd entirely when fsd: false is passed', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', fsd: false }, CLEAN);
    expect(section(report, 'fsd')?.enabled).toBe(false);
    expect(section(report, 'fsd')?.report).toBeNull();
    expect(tree.exists('apps/web/src/shared/index.ts')).toBe(false);
  });

  it('skips agent-rules entirely when agentRules: false is passed', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', agentRules: false }, CLEAN);
    expect(section(report, 'agentRules')?.enabled).toBe(false);
    expect(tree.exists('CLAUDE.md')).toBe(false);
  });

  it('skips github-templates entirely when githubTemplates: false is passed', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', githubTemplates: false }, CLEAN);
    expect(section(report, 'githubTemplates')?.enabled).toBe(false);
    expect(tree.exists('.github/PULL_REQUEST_TEMPLATE.md')).toBe(false);
  });
});

// The fsd-throw-folding behavior is covered in
// generator.fsd-abort.spec.ts, which needs a module-level jest.mock of
// '../add-fsd-lite/generator.js' that would otherwise poison every other test in this
// file (jest.mock is file-scoped; jest.spyOn can't redefine this build's named exports).

describe('runInit — idempotent rerun', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('a second identical run reports every section as already-satisfied and writes nothing new', () => {
    runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);
    const changesAfterFirst = tree.listChanges().length;

    const report = runInit(tree, { preset: 'team', frontend: 'react-vite' }, CLEAN);

    expect(tree.listChanges().length).toBe(changesAfterFirst);
    const fsd = section(report, 'fsd');
    if (fsd?.report?.kind === 'fsd') {
      expect(['snippet-only', 'already-applied']).toContain(fsd.report.report.eslint);
    }
    const agentRules = section(report, 'agentRules');
    if (agentRules?.report?.kind === 'agentRules') {
      expect(agentRules.report.report.files.every((f) => f.action === 'unchanged')).toBe(true);
    }
    const github = section(report, 'githubTemplates');
    if (github?.report?.kind === 'githubTemplates') {
      expect(github.report.report.files.every((f) => f.action === 'unchanged')).toBe(true);
    }
    const review = section(report, 'review');
    if (review?.report?.kind === 'review') {
      expect(review.report.report.workflowAction).toBe('unchanged');
      expect(review.report.report.configAction).toBe('unchanged');
    }
  });
});

describe('runInit — dryRun', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('previews every enabled section and writes nothing', () => {
    const before = tree.listChanges().length;
    const report = runInit(tree, { preset: 'team', frontend: 'react-vite', dryRun: true }, CLEAN);
    expect(report.dryRun).toBe(true);
    expect(tree.listChanges().length).toBe(before);
    for (const s of report.sections) {
      if (s.report?.kind === 'fsd') expect(s.report.report.dryRun).toBe(true);
      if (s.report?.kind === 'agentRules') expect(s.report.report.dryRun).toBe(true);
      if (s.report?.kind === 'githubTemplates') expect(s.report.report.dryRun).toBe(true);
      if (s.report?.kind === 'review') expect(s.report.report.dryRun).toBe(true);
    }
  });
});

describe('initGenerator — top-level wiring', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('dryRun never returns a callback, even though nothing was written anyway', async () => {
    const before = tree.listChanges().length;
    const callback = await initGenerator(tree, { preset: 'solo', frontend: 'react-vite', dryRun: true });
    expect(callback).toBeUndefined();
    expect(tree.listChanges().length).toBe(before);
  });

  it('a virtual tree (non-existent real root) treats a failed git check as dirty and refuses', async () => {
    const before = tree.listChanges().length;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const callback = await initGenerator(tree, { preset: 'solo', frontend: 'react-vite' });
    expect(callback).toBeUndefined();
    expect(tree.listChanges().length).toBe(before);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not determine the working tree status'));
  });
});

describe('runInit — backend section', () => {
  function treeWithApiApp(): Tree {
    const tree = appTree();
    tree.write('apps/web/project.json', `${JSON.stringify({ name: 'web', projectType: 'application', tags: [] }, null, 2)}\n`);
    tree.write('apps/api/project.json', `${JSON.stringify({ name: 'api', projectType: 'application', tags: [] }, null, 2)}\n`);
    tree.write('package.json', `${JSON.stringify({ name: 'my-app', private: true }, null, 2)}\n`);
    tree.write('tsconfig.base.json', `${JSON.stringify({ compilerOptions: { paths: {} } }, null, 2)}\n`);
    return tree;
  }

  it('runs the backend section when backend is express, forwarding applyEslint', () => {
    const tree = treeWithApiApp();
    const report = runInit(
      tree,
      { preset: 'solo', frontend: 'react-vite', backend: 'express', applyEslint: true },
      CLEAN,
    );
    const backend = section(report, 'backend');
    expect(backend?.enabled).toBe(true);
    expect(backend?.report?.kind).toBe('backend');
    if (backend?.report?.kind === 'backend') {
      expect(backend.report.report.refused).toBeUndefined();
      expect(backend.report.report.sharedTypes).toBe('created');
    }
    expect(tree.exists('libs/shared-types/src/index.ts')).toBe(true);
  });

  it("backend 'none' leaves the report and the tree with zero backend traces", () => {
    const tree = appTree();
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', backend: 'none' }, CLEAN);
    expect(report.sections.find((s) => s.id === 'backend')?.enabled).toBe(false);
    expect(tree.exists('libs/shared-types/src/index.ts')).toBe(false);
    const rendered = renderInitReport(report);
    expect(rendered).not.toContain('add-backend');
    expect(rendered).not.toContain('shared-types');
  });

  it("backend omitted equals backend 'none' — the post-rename baseline (regression)", () => {
    const omitted = runInit(appTree(), { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    const explicit = runInit(appTree(), { preset: 'solo', frontend: 'react-vite', backend: 'none' }, CLEAN);
    expect(renderInitReport(explicit)).toBe(renderInitReport(omitted));
    expect(renderInitReport(omitted)).toMatchSnapshot();
  });

  it("backend 'none' writes exactly the same file set as an omitted backend", () => {
    const treeOmitted = appTree();
    const treeNone = appTree();
    runInit(treeOmitted, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    runInit(treeNone, { preset: 'solo', frontend: 'react-vite', backend: 'none' }, CLEAN);
    const paths = (t: Tree) => t.listChanges().map((c) => c.path).sort();
    expect(paths(treeNone)).toEqual(paths(treeOmitted));
  });
});

describe('runInit — backend-only workspaces (frontend none)', () => {
  function backendOnlyTree(): Tree {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('apps/api/project.json', `${JSON.stringify({ name: 'api', projectType: 'application', tags: [] }, null, 2)}\n`);
    tree.write('package.json', `${JSON.stringify({ name: '@be/source', private: true }, null, 2)}\n`);
    tree.write('tsconfig.base.json', `${JSON.stringify({ compilerOptions: { paths: {} } }, null, 2)}\n`);
    return tree;
  }

  it('skips FSD (even with --fsd), wires the api without a frontend tag, and records frontend none', () => {
    const tree = backendOnlyTree();
    const report = runInit(tree, { preset: 'team', frontend: 'none', backend: 'nest', fsd: true, applyEslint: true }, CLEAN);
    expect(section(report, 'fsd')?.enabled).toBe(false);
    expect(tree.exists('apps/web')).toBe(false);
    const backend = section(report, 'backend');
    if (backend?.report?.kind !== 'backend') throw new Error('backend section missing');
    expect(backend.report.report.refused).toBeUndefined();
    expect(backend.report.report.frontendProject).toBeUndefined();
    expect(JSON.parse(tree.read('apps/api/project.json', 'utf-8')!).tags).toEqual(['scope:backend']);
    const rendered = renderInitReport(report);
    expect(rendered).toContain('init (preset: team, frontend: none, backend: nest)');
    expect(rendered).toContain('skipped (backend-only workspace — no frontend to structure)');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8')!)).toMatchObject({ frontend: 'none', backend: 'nest' });
  });

  it('a bare rerun keeps the recorded frontend none and backend', () => {
    const tree = backendOnlyTree();
    runInit(tree, { preset: 'solo', frontend: 'none', backend: 'express' }, CLEAN);
    const rerun = runInit(tree, {}, CLEAN);
    expect(rerun).toMatchObject({ frontend: 'none', backend: 'express' });
  });

  it('frontend none without a backend is refused up front', () => {
    expect(() => runInit(appTree(), { preset: 'solo', frontend: 'none' }, CLEAN)).toThrow('--backend=express|nest');
  });
});

describe('runInit — packageManager threading', () => {
  it('detects npm from the lockfile when no option is passed', () => {
    const tree = appTree();
    tree.write('package-lock.json', '{}\n');
    const report = runInit(tree, { preset: 'quick-start', frontend: 'react-vite', allowDirty: true, dryRun: true }, { isWorkingTreeClean: () => true });
    expect(report.packageManager).toBe('npm');
  });

  it('an explicit option outranks detection, and no signals default to pnpm', () => {
    const tree = appTree();
    tree.write('package-lock.json', '{}\n');
    const explicit = runInit(tree, { preset: 'quick-start', frontend: 'react-vite', allowDirty: true, dryRun: true, packageManager: 'pnpm' }, { isWorkingTreeClean: () => true });
    expect(explicit.packageManager).toBe('pnpm');
    const bare = runInit(appTree(), { preset: 'quick-start', frontend: 'react-vite', allowDirty: true, dryRun: true }, { isWorkingTreeClean: () => true });
    expect(bare.packageManager).toBe('pnpm');
  });
});

it('threads the resolved packageManager into the review workflow', () => {
  const tree = appTree(); // lockfile-less: detection alone would say pnpm
  const report = runInit(
    tree,
    { preset: 'solo', frontend: 'react-vite', allowDirty: true, packageManager: 'npm' },
    { isWorkingTreeClean: () => true },
  );
  expect(report.refused).toBe(false);
  const workflow = tree.read('.github/workflows/claude-code-review.yml', 'utf-8');
  expect(workflow).toContain('npm ci');
  expect(workflow).not.toContain('pnpm/action-setup');
});

describe('runInit — AI hosts', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = appTree();
  });

  it('the picked hosts decide the rules files, are recorded, and the first one picks the review provider', () => {
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite', aiHosts: ['gemini-cli', 'claude-code'] }, CLEAN);
    const agentRules = section(report, 'agentRules');
    if (agentRules?.report?.kind !== 'agentRules') throw new Error('expected agentRules report');
    expect(agentRules.report.report.files.map((f) => f.filePath)).toEqual(['CLAUDE.md', 'AGENTS.md']);
    const review = section(report, 'review');
    if (review?.report?.kind !== 'review') throw new Error('expected review report');
    expect(review.report.report.workflowPath).toBe('.github/workflows/gemini-code-review.yml');
    const config = JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string);
    expect(config.aiHosts).toEqual(['gemini-cli', 'claude-code']);
  });

  it("without --aiHosts, the hosts recorded in toolkit.config.json are kept (and their review provider)", () => {
    tree.write('toolkit.config.json', JSON.stringify({ aiHosts: ['codex'] }));
    const report = runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    const agentRules = section(report, 'agentRules');
    if (agentRules?.report?.kind !== 'agentRules') throw new Error('expected agentRules report');
    expect(agentRules.report.report.files.map((f) => f.filePath)).toEqual(['AGENTS.md']);
    expect(tree.exists('CLAUDE.md')).toBe(false);
    const review = section(report, 'review');
    if (review?.report?.kind !== 'review') throw new Error('expected review report');
    expect(review.report.report.workflowPath).toBe('.github/workflows/gpt-code-review.yml');
    expect(JSON.parse(tree.read('toolkit.config.json', 'utf-8') as string).aiHosts).toEqual(['codex']);
  });

  it("an existing CLAUDE.md (Nx's own) keeps its content; our block is appended, no .generated.md", () => {
    const nx = '<!-- nx configuration start-->\n# Nx\n<!-- nx configuration end-->\n';
    tree.write('CLAUDE.md', nx);
    runInit(tree, { preset: 'solo', frontend: 'react-vite' }, CLEAN);
    const claude = tree.read('CLAUDE.md', 'utf-8') as string;
    expect(claude.startsWith(nx)).toBe(true);
    expect(claude).toContain('<!-- nx-archweave:agent-rules start -->');
    expect(tree.exists('CLAUDE.generated.md')).toBe(false);
  });
});
