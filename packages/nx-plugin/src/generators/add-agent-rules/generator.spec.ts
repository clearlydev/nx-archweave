import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import type { Tree } from '@nx/devkit';
import { composeAgentRules, renderAgentRulesBlock } from '@nx-archweave/template-engine';
import { runAddAgentRules } from './generator.ts';

const CONFIG_PATH = 'toolkit.config.json';
const NX_BLOCK = '<!-- nx configuration start-->\n# General Guidelines for working with Nx\n<!-- nx configuration end-->\n';

/** The composed rules body for one file. */
function body(locale: 'ko' | 'en' = 'en', teamRules = false): string {
  return composeAgentRules({ files: ['CLAUDE.md'], locale, teamRules })[0].content;
}

/** A file holding only nx-archweave's block — what a fresh run writes. */
function blockFile(locale: 'ko' | 'en' = 'en', teamRules = false): string {
  return `${renderAgentRulesBlock(body(locale, teamRules))}\n`;
}

describe('runAddAgentRules — hosts decide the files', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('no hosts anywhere: Claude Code, so CLAUDE.md only, holding just our block', () => {
    const report = runAddAgentRules(tree, {});
    expect(report.hosts).toEqual(['claude-code']);
    expect(report.files).toEqual([{ filePath: 'CLAUDE.md', action: 'created', reason: null, content: null }]);
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(blockFile());
    expect(tree.exists('AGENTS.md')).toBe(false);
  });

  it.each([
    [['codex'], ['AGENTS.md']],
    [['cursor', 'gemini-cli'], ['AGENTS.md']], // a shared file is written once
    [['gemini-cli', 'claude-code'], ['CLAUDE.md', 'AGENTS.md']],
  ] as const)('--hosts=%j writes %j', (hosts, files) => {
    const report = runAddAgentRules(tree, { hosts: [...hosts] });
    expect(report.files.map((file) => file.filePath)).toEqual(files);
    for (const file of files) expect(tree.read(file, 'utf-8')).toBe(blockFile());
  });

  it("without --hosts, toolkit.config.json's aiHosts decide (unknown ids ignored); an empty --hosts does too", () => {
    tree.write(CONFIG_PATH, JSON.stringify({ aiHosts: ['codex', 'not-a-host'] }));
    expect(runAddAgentRules(tree, {}).hosts).toEqual(['codex']);
    expect(runAddAgentRules(tree, { hosts: [] }).hosts).toEqual(['codex']);
    expect(tree.exists('CLAUDE.md')).toBe(false);
    expect(tree.read('AGENTS.md', 'utf-8')).toBe(blockFile());
  });

  it('--hosts beats the config', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ aiHosts: ['codex'] }));
    expect(runAddAgentRules(tree, { hosts: ['claude-code'] }).files.map((file) => file.filePath)).toEqual(['CLAUDE.md']);
  });

  it('is idempotent: a second identical run changes nothing', () => {
    runAddAgentRules(tree, { hosts: ['claude-code', 'codex'] });
    const changesAfterFirst = tree.listChanges().length;
    const report = runAddAgentRules(tree, { hosts: ['claude-code', 'codex'] });
    expect(report.files.every((file) => file.action === 'unchanged')).toBe(true);
    expect(tree.listChanges().length).toBe(changesAfterFirst);
  });
});

describe('runAddAgentRules — the marker block next to existing content', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it("Nx's own CLAUDE.md: our block is appended after it; Nx's block is untouched", () => {
    tree.write('CLAUDE.md', NX_BLOCK);
    const report = runAddAgentRules(tree, {});
    expect(report.files[0].action).toBe('appended');
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(`${NX_BLOCK}\n${blockFile()}`);
    expect(tree.exists('CLAUDE.generated.md')).toBe(false);
  });

  it('a rerun with different content replaces only our block — the user text around it survives', () => {
    tree.write('CLAUDE.md', `${NX_BLOCK}\n# My notes\n`);
    runAddAgentRules(tree, {});
    tree.write('CLAUDE.md', `${tree.read('CLAUDE.md', 'utf-8')}\n# Notes after the block\n`);
    const report = runAddAgentRules(tree, { teamRules: true });
    expect(report.files[0].action).toBe('updated');
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(
      `${NX_BLOCK}\n# My notes\n\n${renderAgentRulesBlock(body('en', true))}\n\n# Notes after the block\n`,
    );
  });

  it('a file with broken markers is reported, never written', () => {
    const broken = '<!-- nx-archweave:agent-rules start -->\nhalf a block\n';
    tree.write('CLAUDE.md', broken);
    const report = runAddAgentRules(tree, {});
    expect(report.files[0]).toMatchObject({ action: 'unrecognized', reason: expect.stringContaining('found 1 start and 0 end') });
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(broken);
  });
});

describe('runAddAgentRules — locale and teamRules resolution', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('locale: option > config > en; an unusable config falls back without aborting', () => {
    tree.write(CONFIG_PATH, JSON.stringify({ locale: 'ko' }));
    runAddAgentRules(tree, {});
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(blockFile('ko'));
    runAddAgentRules(tree, { locale: 'en' });
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(blockFile('en'));
    const other = createTreeWithEmptyWorkspace();
    other.write(CONFIG_PATH, '{ not json');
    expect(runAddAgentRules(other, {}).files[0].action).toBe('created');
    expect(other.read('CLAUDE.md', 'utf-8')).toBe(blockFile('en'));
  });

  it('teamRules: option > config agentRules.teamRules > false', () => {
    expect(runAddAgentRules(tree, {}).teamRules).toBe(false);
    tree.write(CONFIG_PATH, JSON.stringify({ locale: 'ko', agentRules: { teamRules: true } }));
    const fromConfig = runAddAgentRules(tree, {});
    expect(fromConfig.teamRules).toBe(true);
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(blockFile('ko', true));
    expect(runAddAgentRules(tree, { teamRules: false }).teamRules).toBe(false);
    tree.write(CONFIG_PATH, JSON.stringify({ agentRules: { teamRules: 'yes' } }));
    expect(runAddAgentRules(tree, {}).teamRules).toBe(false);
  });
});

describe('runAddAgentRules — dryRun', () => {
  it('previews the whole file as it would be written, and writes nothing', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('CLAUDE.md', NX_BLOCK);
    const before = tree.listChanges().length;
    const report = runAddAgentRules(tree, { dryRun: true });
    expect(report.files[0]).toMatchObject({ action: 'appended', content: `${NX_BLOCK}\n${blockFile()}` });
    expect(tree.listChanges().length).toBe(before);
    expect(tree.read('CLAUDE.md', 'utf-8')).toBe(NX_BLOCK);
  });
});

describe('runAddAgentRules — an explicit --hosts is recorded', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('writes aiHosts into toolkit.config.json, keeping every other key; a bare rerun then uses them', () => {
    tree.write(CONFIG_PATH, '{\n    "locale": "en"\n}\n');
    expect(runAddAgentRules(tree, { hosts: ['codex', 'claude-code'] }).hostsRecord).toBe('updated');
    const raw = tree.read(CONFIG_PATH, 'utf-8') as string;
    expect(JSON.parse(raw)).toEqual({ locale: 'en', aiHosts: ['codex', 'claude-code'] });
    expect(raw).toMatch(/^ {4}"locale"/m);
    const bare = runAddAgentRules(tree, {});
    expect(bare.hosts).toEqual(['codex', 'claude-code']);
    expect(bare.hostsRecord).toBe('not-requested');
    expect(runAddAgentRules(tree, { hosts: ['codex', 'claude-code'] }).hostsRecord).toBe('unchanged');
  });

  it('creates the config when there is none; dryRun computes it but writes nothing', () => {
    expect(runAddAgentRules(tree, { hosts: ['cursor'], dryRun: true }).hostsRecord).toBe('created');
    expect(tree.exists(CONFIG_PATH)).toBe(false);
    expect(runAddAgentRules(tree, { hosts: ['cursor'] }).hostsRecord).toBe('created');
    expect(JSON.parse(tree.read(CONFIG_PATH, 'utf-8') as string)).toEqual({ aiHosts: ['cursor'] });
  });

  it('not recorded when a file could not take the block, or when the config is not a JSON object', () => {
    tree.write('CLAUDE.md', '<!-- nx-archweave:agent-rules start -->\n');
    expect(runAddAgentRules(tree, { hosts: ['claude-code'] }).hostsRecord).toBe('not-applied');
    expect(tree.exists(CONFIG_PATH)).toBe(false);
    const other = createTreeWithEmptyWorkspace();
    other.write(CONFIG_PATH, '[1]');
    expect(runAddAgentRules(other, { hosts: ['codex'] }).hostsRecord).toBe('unrecognized');
    expect(other.read(CONFIG_PATH, 'utf-8')).toBe('[1]');
  });

  it('a CRLF CLAUDE.md stays CRLF and a rerun is unchanged', () => {
    tree.write('CLAUDE.md', '# Mine\r\n');
    runAddAgentRules(tree, {});
    const first = tree.read('CLAUDE.md', 'utf-8') as string;
    expect(first.replace(/\r\n/g, '')).not.toContain('\n');
    expect(runAddAgentRules(tree, {}).files[0].action).toBe('unchanged');
  });
});
