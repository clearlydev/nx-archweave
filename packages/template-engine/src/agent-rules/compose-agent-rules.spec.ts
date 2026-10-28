import { AGENT_RULE_SECTIONS, DEFAULT_AGENT_SECTION_IDS, TEAM_AGENT_SECTION_ID } from '@nx-archweave/templates';
import { composeAgentRules, resolveDefaultAgentSectionIds } from './compose-agent-rules.ts';

describe('composeAgentRules', () => {
  it('returns one entry per requested file, all with the same body', () => {
    const result = composeAgentRules({ files: ['CLAUDE.md', 'AGENTS.md'], locale: 'en' });
    expect(result.map((r) => r.filePath)).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(result[0].content).toBe(result[1].content);
  });

  it('composes the default sections (universal + safety + language + placeholders) in order', () => {
    const [{ content }] = composeAgentRules({ files: ['CLAUDE.md'], locale: 'en' });
    const headings = DEFAULT_AGENT_SECTION_IDS.map((id) => AGENT_RULE_SECTIONS.en[id].heading);
    let lastIndex = -1;
    for (const heading of headings) {
      const index = content.indexOf(`## ${heading}`);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });

  it('every default section body appears verbatim in the composed content', () => {
    const [{ content }] = composeAgentRules({ files: ['CLAUDE.md'], locale: 'en' });
    for (const id of DEFAULT_AGENT_SECTION_IDS) {
      expect(content).toContain(AGENT_RULE_SECTIONS.en[id].body);
    }
  });

  it('renders the ko section text when locale is ko', () => {
    const [{ content }] = composeAgentRules({ files: ['CLAUDE.md'], locale: 'ko' });
    expect(content).toContain(`## ${AGENT_RULE_SECTIONS.ko['language-policy'].heading}`);
    expect(content).not.toContain(`## ${AGENT_RULE_SECTIONS.en['language-policy'].heading}`);
  });

  it('honors an explicit sections override instead of the default composition', () => {
    const [{ content }] = composeAgentRules({
      files: ['CLAUDE.md'],
      locale: 'en',
      sections: ['safety-rules', 'language-policy'],
    });
    expect(content).toContain(`## ${AGENT_RULE_SECTIONS.en['safety-rules'].heading}`);
    expect(content).toContain(`## ${AGENT_RULE_SECTIONS.en['language-policy'].heading}`);
    expect(content).not.toContain(`## ${AGENT_RULE_SECTIONS.en['think-before-coding'].heading}`);
  });

  it('is a pure function: same input produces byte-identical output', () => {
    const input = { files: ['CLAUDE.md'] as ('CLAUDE.md' | 'AGENTS.md')[], locale: 'en' as const };
    expect(composeAgentRules(input)).toEqual(composeAgentRules(input));
  });

  it('returns an empty array when files is empty', () => {
    expect(composeAgentRules({ files: [], locale: 'en' })).toEqual([]);
  });
});

describe('composeAgentRules — teamRules', () => {
  it('resolveDefaultAgentSectionIds(false) is exactly the default composition', () => {
    expect(resolveDefaultAgentSectionIds(false)).toEqual(DEFAULT_AGENT_SECTION_IDS);
  });

  it('resolveDefaultAgentSectionIds(true) inserts team-rules right after language-policy, before project-goal', () => {
    const ids = resolveDefaultAgentSectionIds(true);
    expect(ids.length).toBe(DEFAULT_AGENT_SECTION_IDS.length + 1);
    const teamIndex = ids.indexOf(TEAM_AGENT_SECTION_ID);
    expect(ids[teamIndex - 1]).toBe('language-policy');
    expect(ids[teamIndex + 1]).toBe('project-goal');
    expect(ids.filter((id) => id !== TEAM_AGENT_SECTION_ID)).toEqual(DEFAULT_AGENT_SECTION_IDS);
  });

  it.each(['en', 'ko'] as const)('%s: teamRules: true adds the Team Rules section; omitted/false does not', (locale) => {
    const heading = `## ${AGENT_RULE_SECTIONS[locale][TEAM_AGENT_SECTION_ID].heading}`;
    const [{ content: team }] = composeAgentRules({ files: ['CLAUDE.md'], locale, teamRules: true });
    const [{ content: solo }] = composeAgentRules({ files: ['CLAUDE.md'], locale, teamRules: false });
    const [{ content: omitted }] = composeAgentRules({ files: ['CLAUDE.md'], locale });
    expect(team).toContain(heading);
    expect(team).toContain(AGENT_RULE_SECTIONS[locale][TEAM_AGENT_SECTION_ID].body);
    expect(solo).not.toContain(heading);
    expect(omitted).toBe(solo); // default is off — pre-existing output is byte-identical
  });

  it('teamRules: true places the section between Language Policy and Project Goal in the rendered text', () => {
    const [{ content }] = composeAgentRules({ files: ['CLAUDE.md'], locale: 'en', teamRules: true });
    const language = content.indexOf(`## ${AGENT_RULE_SECTIONS.en['language-policy'].heading}`);
    const team = content.indexOf(`## ${AGENT_RULE_SECTIONS.en[TEAM_AGENT_SECTION_ID].heading}`);
    const goal = content.indexOf(`## ${AGENT_RULE_SECTIONS.en['project-goal'].heading}`);
    expect(language).toBeLessThan(team);
    expect(team).toBeLessThan(goal);
  });

  it('TEAM_AGENT_SECTION_ID keeps its literal type (review nit)', () => {
    const id: 'team-rules' = TEAM_AGENT_SECTION_ID;
    expect(id).toBe('team-rules');
  });

  it('an explicit sections override wins — teamRules is ignored', () => {
    const [{ content }] = composeAgentRules({
      files: ['CLAUDE.md'],
      locale: 'en',
      sections: ['safety-rules', 'language-policy'],
      teamRules: true,
    });
    expect(content).not.toContain(`## ${AGENT_RULE_SECTIONS.en[TEAM_AGENT_SECTION_ID].heading}`);
  });
});

describe('composeAgentRules — fsdStructure', () => {
  it('resolveDefaultAgentSectionIds(_, true) inserts fsd-structure right after code-structure, before safety-rules', () => {
    const ids = resolveDefaultAgentSectionIds(false, true);
    expect(ids.indexOf('fsd-structure')).toBe(ids.indexOf('code-structure') + 1);
    expect(ids.indexOf('fsd-structure')).toBe(ids.indexOf('safety-rules') - 1);
    expect(resolveDefaultAgentSectionIds(false, false)).toEqual([...DEFAULT_AGENT_SECTION_IDS]);
  });

  it('with both flags, structure sits next to structure and Team Rules stays after Language Policy', () => {
    const ids = resolveDefaultAgentSectionIds(true, true);
    expect(ids.indexOf('fsd-structure')).toBe(ids.indexOf('code-structure') + 1);
    expect(ids.indexOf(TEAM_AGENT_SECTION_ID)).toBe(ids.indexOf('language-policy') + 1);
    expect(ids).toHaveLength(DEFAULT_AGENT_SECTION_IDS.length + 2);
  });

  it('the rendered section states the Lite definition and the three rules, in both locales', () => {
    for (const locale of ['en', 'ko'] as const) {
      const [file] = composeAgentRules({ files: ['CLAUDE.md'], locale, fsdStructure: true });
      expect(file.content).toContain(AGENT_RULE_SECTIONS[locale]['fsd-structure'].heading);
      expect(file.content).toContain('archweave/fsd-boundaries');
      expect(file.content).toContain('_pages');
      expect(file.content).toContain('@x/<consumer>');
    }
    expect(composeAgentRules({ files: ['CLAUDE.md'], locale: 'en' })[0].content).not.toContain('archweave/fsd-boundaries');
  });
});

describe('composeAgentRules — moduleBoundaries', () => {
  const tags = { frontend: 'type:web', backend: 'type:api', shared: 'type:shared' };
  const headings = (content: string) => [...content.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

  it('leaves the output unchanged when omitted', () => {
    const plain = composeAgentRules({ files: ['AGENTS.md'], locale: 'en', fsdStructure: true });
    expect(plain[0].content).not.toContain('Module Boundaries');
  });

  it('goes right after the FSD section, with the given tag names verbatim', () => {
    const [file] = composeAgentRules({ files: ['AGENTS.md'], locale: 'en', fsdStructure: true, moduleBoundaries: tags });
    const list = headings(file.content);
    expect(list[list.indexOf('Frontend Structure (FSD Lite)') + 1]).toBe('Module Boundaries');
    expect(file.content).toContain('`type:web` projects never import `type:api` projects');
    expect(file.content).toContain('--tags=type:shared');
    expect(file.content).not.toContain('scope:');
  });

  it('goes right after Code Structure without the FSD section (backend-only), in Korean too', () => {
    const [file] = composeAgentRules({ files: ['AGENTS.md'], locale: 'ko', moduleBoundaries: tags });
    const list = headings(file.content);
    expect(list[list.indexOf('모듈 경계') - 1]).toBe(AGENT_RULE_SECTIONS.ko['code-structure'].heading);
    expect(file.content).toContain('--tags=type:shared');
  });

  it('an explicit sections list wins: no Module Boundaries section is added', () => {
    const [file] = composeAgentRules({ files: ['AGENTS.md'], locale: 'en', sections: ['safety-rules', 'language-policy'], moduleBoundaries: tags });
    expect(file.content).not.toContain('Module Boundaries');
  });
});
