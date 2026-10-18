import { renderAddAgentRulesReport, type AddAgentRulesReport, type AgentRuleFileResult } from './render.ts';

function report(files: AgentRuleFileResult[], overrides: Partial<AddAgentRulesReport> = {}): AddAgentRulesReport {
  return { dryRun: false, locale: 'en', hosts: ['claude-code'], teamRules: false, files, hostsRecord: 'not-requested', ...overrides };
}

const file = (overrides: Partial<AgentRuleFileResult>): AgentRuleFileResult => ({
  filePath: 'CLAUDE.md',
  action: 'created',
  reason: null,
  content: null,
  ...overrides,
});

describe('renderAddAgentRulesReport', () => {
  it('names the hosts, locale and teamRules, and each file outcome', () => {
    const text = renderAddAgentRulesReport(
      report([file({}), file({ filePath: 'AGENTS.md', action: 'appended' })], { hosts: ['claude-code', 'codex'], teamRules: true }),
    );
    expect(text).toContain('hosts: claude-code, codex');
    expect(text).toContain('locale: en');
    expect(text).toContain('teamRules: true');
    expect(text).toContain('CLAUDE.md: created');
    expect(text).toContain('AGENTS.md: nx-archweave block added after the existing content (nothing else changed)');
  });

  it('says only the block changed on an update, and names unchanged files', () => {
    expect(renderAddAgentRulesReport(report([file({ action: 'updated' })]))).toContain('nx-archweave block updated (nothing outside it changed)');
    expect(renderAddAgentRulesReport(report([file({ action: 'unchanged' })]))).toContain('CLAUDE.md: unchanged');
  });

  it('an unrecognized file gets its reason and the manual fix; nothing else does', () => {
    const text = renderAddAgentRulesReport(report([file({ action: 'unrecognized', reason: 'found 2 start marker(s)' })]));
    expect(text).toContain('CLAUDE.md: not written — found 2 start marker(s)');
    expect(text).toContain('Manual fix needed');
    expect(renderAddAgentRulesReport(report([file({})]))).not.toContain('Manual fix needed');
  });

  it('previews content only in dryRun', () => {
    const text = renderAddAgentRulesReport(report([file({ content: '## Safety Rules\n' })], { dryRun: true }));
    expect(text).toContain('dry-run');
    expect(text).toContain('--- CLAUDE.md ---');
    expect(text).toContain('## Safety Rules');
  });

  it('says what happened to toolkit.config.json aiHosts, and nothing when --hosts was not given', () => {
    expect(renderAddAgentRulesReport(report([file({})], { hostsRecord: 'updated' }))).toContain('toolkit.config.json: aiHosts recorded');
    expect(renderAddAgentRulesReport(report([file({})], { hostsRecord: 'not-applied' }))).toContain('aiHosts not recorded — a file above was not written');
    expect(renderAddAgentRulesReport(report([file({})]))).not.toContain('toolkit.config.json');
  });
});
