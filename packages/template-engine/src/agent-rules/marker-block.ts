import { createHash } from 'node:crypto';

/** nx-archweave's own block inside an agent-rules file. Nx
 * keeps its content between `<!-- nx configuration start/end -->` in the same files, and
 * the user may write anything around both — only what is between these two markers is
 * ever ours to write.
 *
 * The start marker as 0.1.1 wrote it. Blocks written since carry ` hash=<12 hex>` before the
 * closing `-->`: a hash of the block's body, so a rerun can tell a block it may replace from
 * one the user edited (a filled-in TODO). Both forms are read. */
export const AGENT_RULES_BLOCK_START = '<!-- nx-archweave:agent-rules start -->';
export const AGENT_RULES_BLOCK_END = '<!-- nx-archweave:agent-rules end -->';

const START_MARKER = /<!-- nx-archweave:agent-rules start(?: hash=([0-9a-f]{12}))? -->/g;

export type AgentRulesBlockOutcome =
  /** No file yet: the block is the whole file. */
  | { kind: 'create'; text: string }
  /** The file has no block of ours: the block goes after the existing content. */
  | { kind: 'append'; text: string }
  /** Our block is there with other content: only the block is replaced. */
  | { kind: 'replace'; text: string }
  | { kind: 'unchanged' }
  /** The block's content is not what we wrote last time: it is the user's now, so it is
   * reported with what we would write, and only replaced on request. */
  | { kind: 'user-modified'; existingBody: string; generatedBody: string }
  /** Markers we cannot place safely (one without the other, out of order, twice) —
   * reported, never written. */
  | { kind: 'unrecognized'; reason: string };

/** Line endings and trailing spaces never count as an edit. */
export function normalizeForHash(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

function hashOf(body: string): string {
  return createHash('sha256').update(normalizeForHash(body)).digest('hex').slice(0, 12);
}

function withFinalNewline(body: string): string {
  return body.endsWith('\n') ? body : `${body}\n`;
}

export function renderAgentRulesBlock(body: string, eol = '\n'): string {
  const content = withFinalNewline(normalizeForHash(body));
  const lines = `<!-- nx-archweave:agent-rules start hash=${hashOf(content)} -->\n${content}${AGENT_RULES_BLOCK_END}`;
  return eol === '\n' ? lines : lines.replace(/\r?\n/g, eol);
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Places `body` (the composed rules) in `existing` between our markers. Pure: the caller
 * writes `text` when the outcome carries one. The block takes the file's own line ending
 * (CRLF when the file has one), so a Windows checkout stays consistent and a rerun stays
 * `unchanged`. Everything outside the markers is kept byte for byte. Markers are counted as
 * plain text — one quoted inside a code fence counts too, and is reported, never guessed.
 * A block whose content no longer matches the hash in its start marker (or that has no hash
 * and differs from `body`) is the user's: reported as `user-modified` unless `overwrite`. */
export function applyAgentRulesBlock(
  existing: string | null,
  body: string,
  options: { overwrite?: boolean } = {},
): AgentRulesBlockOutcome {
  if (existing === null || existing.length === 0) return { kind: 'create', text: `${renderAgentRulesBlock(body)}\n` };

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const block = renderAgentRulesBlock(body, eol);
  const starts = [...existing.matchAll(START_MARKER)];
  const ends = countOf(existing, AGENT_RULES_BLOCK_END);
  if (starts.length === 0 && ends === 0) {
    // Never trim the user's text: complete its last line, then one blank line, then ours.
    const head = existing.endsWith('\n') ? existing : `${existing}${eol}`;
    return { kind: 'append', text: `${head}${eol}${block}${eol}` };
  }
  if (starts.length !== 1 || ends !== 1) {
    return {
      kind: 'unrecognized',
      reason: `expected one ${AGENT_RULES_BLOCK_START} … ${AGENT_RULES_BLOCK_END} pair, found ${starts.length} start and ${ends} end marker(s)`,
    };
  }
  const startMatch = starts[0];
  const start = startMatch.index ?? 0;
  const end = existing.indexOf(AGENT_RULES_BLOCK_END);
  if (end < start) return { kind: 'unrecognized', reason: 'the end marker comes before the start marker' };

  const text = existing.slice(0, start) + block + existing.slice(end + AGENT_RULES_BLOCK_END.length);
  if (text === existing) return { kind: 'unchanged' };

  const bodyStart = start + startMatch[0].length + (existing.startsWith('\r\n', start + startMatch[0].length) ? 2 : 1);
  const existingBody = normalizeForHash(existing.slice(bodyStart, end));
  const generatedBody = withFinalNewline(normalizeForHash(body));
  const recordedHash = startMatch[1];
  const untouched = recordedHash !== undefined ? hashOf(existingBody) === recordedHash : existingBody === generatedBody;
  if (!untouched && options.overwrite !== true) return { kind: 'user-modified', existingBody, generatedBody };
  return { kind: 'replace', text };
}
