import { composeAgentRules } from './compose-agent-rules.ts';
import { validateAgentRules } from './validate-agent-rules.ts';

describe('validateAgentRules', () => {
  it.each(['en', 'ko'] as const)('accepts the default composition (locale %s)', (locale) => {
    const [{ content }] = composeAgentRules({ files: ['CLAUDE.md'], locale });
    expect(validateAgentRules(content)).toBe(true);
  });

  it('rejects content missing Safety Rules', () => {
    const [{ content }] = composeAgentRules({
      files: ['CLAUDE.md'],
      locale: 'en',
      sections: ['language-policy'],
    });
    expect(validateAgentRules(content)).toBe(false);
  });

  it('rejects content missing Language Policy', () => {
    const [{ content }] = composeAgentRules({
      files: ['CLAUDE.md'],
      locale: 'en',
      sections: ['safety-rules'],
    });
    expect(validateAgentRules(content)).toBe(false);
  });

  it('rejects empty content', () => {
    expect(validateAgentRules('')).toBe(false);
  });

  describe('extra required sections', () => {
    it.each(['en', 'ko'] as const)('%s: requiring team-rules rejects the default document and accepts the team document', (locale) => {
      const [{ content: solo }] = composeAgentRules({ files: ['CLAUDE.md'], locale });
      const [{ content: team }] = composeAgentRules({ files: ['CLAUDE.md'], locale, teamRules: true });
      expect(validateAgentRules(solo, ['team-rules'])).toBe(false);
      expect(validateAgentRules(team, ['team-rules'])).toBe(true);
      // the base requirement still applies on top of the extra one
      expect(validateAgentRules(solo)).toBe(true);
      expect(validateAgentRules(team)).toBe(true);
    });

    it('an empty extra list is the pre-existing behaviour', () => {
      const [{ content }] = composeAgentRules({ files: ['CLAUDE.md'], locale: 'en' });
      expect(validateAgentRules(content, [])).toBe(validateAgentRules(content));
    });
  });

  it('accepts content that has both required sections regardless of locale mixing', () => {
    const [{ content: en }] = composeAgentRules({
      files: ['CLAUDE.md'],
      locale: 'en',
      sections: ['safety-rules'],
    });
    const [{ content: ko }] = composeAgentRules({
      files: ['CLAUDE.md'],
      locale: 'ko',
      sections: ['language-policy'],
    });
    expect(validateAgentRules(`${en}\n${ko}`)).toBe(true);
  });
});
