import { AI_HOSTS, AI_HOST_IDS, DEFAULT_AI_HOSTS, isAiHost, reviewProviderFor, rulesFilesFor } from './ai-hosts.ts';

describe('AI hosts', () => {
  it('the table matches the measured Nx mapping: only Claude reads CLAUDE.md, the rest AGENTS.md', () => {
    expect(AI_HOSTS.map((host) => [host.id, host.nxAgent, host.rulesFile, host.reviewProvider])).toEqual([
      ['claude-code', 'claude', 'CLAUDE.md', 'claude'],
      ['codex', 'codex', 'AGENTS.md', 'gpt'],
      ['cursor', 'cursor', 'AGENTS.md', 'cursor'],
      ['gemini-cli', 'gemini', 'AGENTS.md', 'gemini'],
    ]);
    expect(DEFAULT_AI_HOSTS).toEqual(['claude-code']);
  });

  it.each([
    [['claude-code'], ['CLAUDE.md']],
    [['codex'], ['AGENTS.md']],
    [['codex', 'cursor', 'gemini-cli'], ['AGENTS.md']], // shared file written once
    [['cursor', 'claude-code'], ['CLAUDE.md', 'AGENTS.md']], // CLAUDE.md first, whatever the pick order
    [[], ['CLAUDE.md']], // nothing picked → the default host
  ] as const)('rulesFilesFor(%j) = %j', (hosts, files) => {
    expect(rulesFilesFor(hosts)).toEqual(files);
  });

  it('reviewProviderFor follows the first host', () => {
    expect(reviewProviderFor(['codex', 'claude-code'])).toBe('gpt');
    expect(reviewProviderFor([])).toBe('claude');
  });

  it('isAiHost accepts only the listed ids', () => {
    for (const id of AI_HOST_IDS) expect(isAiHost(id)).toBe(true);
    expect(isAiHost('claude')).toBe(false);
    expect(isAiHost(42)).toBe(false);
  });
});
