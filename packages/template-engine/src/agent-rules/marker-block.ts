/** nx-archweave's own block inside an agent-rules file. Nx
 * keeps its content between `<!-- nx configuration start/end -->` in the same files, and
 * the user may write anything around both — only what is between these two markers is
 * ever ours to write. */
export const AGENT_RULES_BLOCK_START = '<!-- nx-archweave:agent-rules start -->';
export const AGENT_RULES_BLOCK_END = '<!-- nx-archweave:agent-rules end -->';

export type AgentRulesBlockOutcome =
  /** No file yet: the block is the whole file. */
  | { kind: 'create'; text: string }
  /** The file has no block of ours: the block goes after the existing content. */
  | { kind: 'append'; text: string }
  /** Our block is there with other content: only the block is replaced. */
  | { kind: 'replace'; text: string }
  | { kind: 'unchanged' }
  /** Markers we cannot place safely (one without the other, out of order, twice) —
   * reported, never written. */
  | { kind: 'unrecognized'; reason: string };

export function renderAgentRulesBlock(body: string, eol = '\n'): string {
  const lines = `${AGENT_RULES_BLOCK_START}\n${body.endsWith('\n') ? body : `${body}\n`}${AGENT_RULES_BLOCK_END}`;
  return eol === '\n' ? lines : lines.replace(/\r?\n/g, eol);
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Places `body` (the composed rules) in `existing` between our markers. Pure: the caller
 * writes `text` when the outcome carries one. The block takes the file's own line ending
 * (CRLF when the file has one), so a Windows checkout stays consistent and a rerun stays
 * `unchanged`. Everything outside the markers is kept byte for byte. Markers are counted as
 * plain text — one quoted inside a code fence counts too, and is reported, never guessed. */
export function applyAgentRulesBlock(existing: string | null, body: string): AgentRulesBlockOutcome {
  if (existing === null || existing.length === 0) return { kind: 'create', text: `${renderAgentRulesBlock(body)}\n` };

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const block = renderAgentRulesBlock(body, eol);
  const starts = countOf(existing, AGENT_RULES_BLOCK_START);
  const ends = countOf(existing, AGENT_RULES_BLOCK_END);
  if (starts === 0 && ends === 0) {
    // Never trim the user's text: complete its last line, then one blank line, then ours.
    const head = existing.endsWith('\n') ? existing : `${existing}${eol}`;
    return { kind: 'append', text: `${head}${eol}${block}${eol}` };
  }
  if (starts !== 1 || ends !== 1) {
    return {
      kind: 'unrecognized',
      reason: `expected one ${AGENT_RULES_BLOCK_START} … ${AGENT_RULES_BLOCK_END} pair, found ${starts} start and ${ends} end marker(s)`,
    };
  }
  const start = existing.indexOf(AGENT_RULES_BLOCK_START);
  const end = existing.indexOf(AGENT_RULES_BLOCK_END);
  if (end < start) return { kind: 'unrecognized', reason: 'the end marker comes before the start marker' };

  const text = existing.slice(0, start) + block + existing.slice(end + AGENT_RULES_BLOCK_END.length);
  return text === existing ? { kind: 'unchanged' } : { kind: 'replace', text };
}
