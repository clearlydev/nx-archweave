import {
  AGENT_RULE_SECTIONS,
  DEFAULT_AGENT_SECTION_IDS,
  UNIVERSAL_AGENT_SECTION_IDS,
  PLACEHOLDER_AGENT_SECTION_IDS,
  TEAM_AGENT_SECTION_ID,
  getAgentRuleSection,
  type AgentRuleLocale,
} from './agent-sections.ts';

const LOCALES: AgentRuleLocale[] = ['en', 'ko'];

describe('agent-sections', () => {
  it('declares the five universal-principle section ids in render order', () => {
    expect(UNIVERSAL_AGENT_SECTION_IDS).toEqual([
      'think-before-coding',
      'simplicity-first',
      'surgical-changes',
      'goal-driven-execution',
      'code-structure',
    ]);
  });

  it('declares the two placeholder-only section ids', () => {
    expect(PLACEHOLDER_AGENT_SECTION_IDS).toEqual(['project-goal', 'architecture-boundary']);
  });

  it('default composition is universal + safety-rules + language-policy + placeholders', () => {
    expect(DEFAULT_AGENT_SECTION_IDS).toEqual([
      ...UNIVERSAL_AGENT_SECTION_IDS,
      'safety-rules',
      'language-policy',
      ...PLACEHOLDER_AGENT_SECTION_IDS,
    ]);
  });

  it.each(LOCALES)('has every default section defined for locale %s with a non-empty heading and body', (locale) => {
    for (const id of DEFAULT_AGENT_SECTION_IDS) {
      const section = getAgentRuleSection(locale, id);
      expect(section.id).toBe(id);
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)('universal-principle bodies are substantial (locale %s)', (locale) => {
    for (const id of UNIVERSAL_AGENT_SECTION_IDS) {
      const section = getAgentRuleSection(locale, id);
      // Substantial guidance, not a one-liner placeholder.
      expect(section.body.split('\n').filter((line) => line.trim().length > 0).length).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(LOCALES)('Safety Rules includes the project-specific-resources TODO marker (locale %s)', (locale) => {
    const section = getAgentRuleSection(locale, 'safety-rules');
    expect(section.body).toContain('<!-- TODO: list project-specific protected resources');
  });

  it.each(LOCALES)('placeholder sections contain only a heading + TODO marker (locale %s)', (locale) => {
    for (const id of PLACEHOLDER_AGENT_SECTION_IDS) {
      const section = getAgentRuleSection(locale, id);
      expect(section.body.trim()).toMatch(/^<!-- TODO:.*-->$/);
    }
  });

  it('Language Policy text differs between en and ko', () => {
    const en = getAgentRuleSection('en', 'language-policy');
    const ko = getAgentRuleSection('ko', 'language-policy');
    expect(en.body).not.toBe(ko.body);
  });

  it('headings differ between en and ko for every section', () => {
    for (const id of DEFAULT_AGENT_SECTION_IDS) {
      expect(getAgentRuleSection('en', id).heading).not.toBe(getAgentRuleSection('ko', id).heading);
    }
  });

  it('AGENT_RULE_SECTIONS is keyed by locale then section id', () => {
    expect(Object.keys(AGENT_RULE_SECTIONS).sort()).toEqual(['en', 'ko']);
  });

  describe('Team Rules section', () => {
    it('is identified by TEAM_AGENT_SECTION_ID and is NOT part of the default composition', () => {
      expect(TEAM_AGENT_SECTION_ID).toBe('team-rules');
      expect(DEFAULT_AGENT_SECTION_IDS).not.toContain(TEAM_AGENT_SECTION_ID);
      expect(UNIVERSAL_AGENT_SECTION_IDS).not.toContain(TEAM_AGENT_SECTION_ID);
      expect(PLACEHOLDER_AGENT_SECTION_IDS).not.toContain(TEAM_AGENT_SECTION_ID);
    });

    it.each(LOCALES)('is a substantial A+B section with a team-specific TODO marker (locale %s)', (locale) => {
      const section = getAgentRuleSection(locale, TEAM_AGENT_SECTION_ID);
      expect(section.id).toBe('team-rules');
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.split('\n').filter((line) => line.trim().length > 0).length).toBeGreaterThanOrEqual(3);
      // locale-invariant marker, same convention as Safety Rules
      expect(section.body).toContain('<!-- TODO: list team-specific conventions');
      expect(section.body.trimEnd().endsWith('-->')).toBe(true);
    });

    it.each(LOCALES)('names the collaboration rules the Team preset promises (locale %s)', (locale) => {
      const body = getAgentRuleSection(locale, TEAM_AGENT_SECTION_ID).body;
      // module-boundary rules must not be weakened or bypassed
      expect(body).toContain('eslint-disable');
      // P0/P1 findings are addressed before re-review
      expect(body).toMatch(/P0\/P1/);
      // shared code is everyone's
      expect(body).toContain('shared');
    });

    it('heading and body differ between en and ko', () => {
      const en = getAgentRuleSection('en', TEAM_AGENT_SECTION_ID);
      const ko = getAgentRuleSection('ko', TEAM_AGENT_SECTION_ID);
      expect(en.heading).not.toBe(ko.heading);
      expect(en.body).not.toBe(ko.body);
    });
  });
});
