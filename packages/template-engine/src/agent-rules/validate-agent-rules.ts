import { AGENT_RULE_SECTIONS, type AgentRuleLocale, type AgentSectionId } from '@nx-archweave/templates';

const LOCALES: AgentRuleLocale[] = ['en', 'ko'];

function headingsFor(id: AgentSectionId): string[] {
  return LOCALES.map((locale) => `## ${AGENT_RULE_SECTIONS[locale][id].heading}`);
}

const REQUIRED_SECTION_IDS: AgentSectionId[] = ['safety-rules', 'language-policy'];

/** Lint check: a composed agent-rules document must include every
 * required section's heading, in any locale it was rendered with. Headings are read
 * from the templates section library rather than duplicated here, so this stays in
 * sync with `composeAgentRules`'s content by construction. `extraRequired` lets a caller
 * that asked for an opt-in section (e.g. Team Rules) require it
 * too, on top of the always-required set. */
export function validateAgentRules(content: string, extraRequired: AgentSectionId[] = []): boolean {
  return [...REQUIRED_SECTION_IDS, ...extraRequired].every((id) =>
    headingsFor(id).some((heading) => content.includes(heading)),
  );
}
