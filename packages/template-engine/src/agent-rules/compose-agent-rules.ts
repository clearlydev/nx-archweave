import {
  AGENT_RULE_SECTIONS,
  DEFAULT_AGENT_SECTION_IDS,
  FSD_AGENT_SECTION_ID,
  TEAM_AGENT_SECTION_ID,
  buildFsdPolicyNotes,
  buildModuleBoundariesSection,
  type FsdPolicyNotes,
  type ModuleBoundaryTags,
  type AgentRuleLocale,
  type AgentRuleSection,
  type AgentSectionId,
} from '@nx-archweave/templates';

export type { FsdPolicyNotes, ModuleBoundaryTags };

export type AgentRuleFileName = 'CLAUDE.md' | 'AGENTS.md';

export interface ComposeAgentRulesInput {
  files: AgentRuleFileName[];
  locale: AgentRuleLocale;
  /** Overrides the default section composition. Omit to get every
   * universal-principle section plus Safety Rules, Language Policy, and the
   * placeholder sections, in that order. When given, `teamRules` is ignored —
   * an explicit list always wins. */
  sections?: AgentSectionId[];
  /** Adds the Team Rules section to the DEFAULT composition. Defaults to false, so the
   * pre-existing output is byte-identical. */
  teamRules?: boolean;
  /** Adds the Frontend Structure (FSD) section to the DEFAULT composition, right after
   * Code Structure. Defaults to false. */
  fsdStructure?: boolean;
  /** The workspace's configured FSD options, described at the end of that section. Omitted when
   * none is configured, which keeps the section's canonical text. */
  fsdPolicy?: FsdPolicyNotes;
  /** The workspace's frontend/backend role tags: adds the Module Boundaries section to the
   * DEFAULT composition, after the FSD section (or Code Structure without it). Omitted when
   * the workspace has no backend, which keeps the output unchanged. */
  moduleBoundaries?: ModuleBoundaryTags;
}

/** The section ids `composeAgentRules` uses when no explicit `sections` list is given:
 * the templates default, plus — when `teamRules` is on — Team Rules right after
 * Language Policy and before the project-specific placeholders (policy sections first,
 * project-specific TODOs last). */
export function resolveDefaultAgentSectionIds(teamRules: boolean, fsdStructure = false): AgentSectionId[] {
  let ids: AgentSectionId[] = [...DEFAULT_AGENT_SECTION_IDS];
  const insertAfter = (anchorId: AgentSectionId, id: AgentSectionId): void => {
    const anchor = ids.indexOf(anchorId);
    if (anchor === -1) {
      // Unreachable today (the default always carries both anchors); made explicit so a
      // future templates change cannot silently float a section to the top of the document.
      throw new Error(`composeAgentRules: the default composition no longer contains ${anchorId}`);
    }
    ids = [...ids.slice(0, anchor + 1), id, ...ids.slice(anchor + 1)];
  };
  // structure next to structure; policy next to policy
  if (fsdStructure) insertAfter('code-structure', FSD_AGENT_SECTION_ID);
  if (teamRules) insertAfter('language-policy', TEAM_AGENT_SECTION_ID);
  return ids;
}

export interface AgentRuleFile {
  filePath: string;
  content: string;
}

function renderSections(sections: AgentRuleSection[]): string {
  return `${sections.map((section) => `## ${section.heading}\n\n${section.body}`).join('\n\n')}\n`;
}

/** Composes the full `CLAUDE.md`/`AGENTS.md` body from the templates' section library.
 * All requested files share the same body (only the host file name differs). */
export function composeAgentRules(input: ComposeAgentRulesInput): AgentRuleFile[] {
  const sectionIds = input.sections ?? resolveDefaultAgentSectionIds(input.teamRules ?? false, input.fsdStructure ?? false);
  const notes = input.fsdPolicy === undefined ? '' : buildFsdPolicyNotes(input.locale, input.fsdPolicy);
  const sections = sectionIds.map((id) => {
    const section = AGENT_RULE_SECTIONS[input.locale][id];
    return id === FSD_AGENT_SECTION_ID && notes !== '' ? { ...section, body: `${section.body}\n\n${notes}` } : section;
  });
  if (input.moduleBoundaries !== undefined && input.sections === undefined) {
    const anchor = sections.findIndex((section) => section.id === FSD_AGENT_SECTION_ID);
    const at = (anchor === -1 ? sections.findIndex((section) => section.id === 'code-structure') : anchor) + 1;
    sections.splice(at, 0, buildModuleBoundariesSection(input.locale, input.moduleBoundaries));
  }
  const content = renderSections(sections);
  return input.files.map((filePath) => ({ filePath, content }));
}
