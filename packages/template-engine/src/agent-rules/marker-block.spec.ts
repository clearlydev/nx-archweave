import { createHash } from 'node:crypto';
import {
  AGENT_RULES_BLOCK_END as END,
  AGENT_RULES_BLOCK_START as LEGACY_START,
  applyAgentRulesBlock,
  renderAgentRulesBlock,
} from './marker-block.ts';

const NX_BLOCK = '<!-- nx configuration start-->\n# Nx guidelines\n<!-- nx configuration end-->\n';
const block = (body: string, eol = '\n'): string => renderAgentRulesBlock(body, eol);
const hashOf = (body: string): string => createHash('sha256').update(body).digest('hex').slice(0, 12);

describe('renderAgentRulesBlock', () => {
  it('records a hash of the body in the start marker', () => {
    expect(block('## Rules\n')).toBe(`<!-- nx-archweave:agent-rules start hash=${hashOf('## Rules\n')} -->\n## Rules\n${END}`);
  });

  it('hashes the same body to the same value whatever the line ending or trailing spaces', () => {
    const lf = block('## Rules  \nbody\n').split('\n')[0];
    const crlf = block('## Rules\r\nbody\r\n', '\r\n').split('\r\n')[0];
    expect(crlf).toBe(lf);
  });
});

describe('applyAgentRulesBlock', () => {
  it('no file: the block is the whole file', () => {
    expect(applyAgentRulesBlock(null, '## Rules\n')).toEqual({ kind: 'create', text: `${block('## Rules\n')}\n` });
  });

  it("a file without our block (Nx's own, a user's text): appended after it, the rest untouched", () => {
    const outcome = applyAgentRulesBlock(`${NX_BLOCK}\nmy notes\n`, '## Rules\n');
    expect(outcome).toEqual({ kind: 'append', text: `${NX_BLOCK}\nmy notes\n\n${block('## Rules\n')}\n` });
  });

  it('our untouched block: only the block is replaced — text before and after it survives byte for byte', () => {
    const before = `${NX_BLOCK}\nintro\n\n`;
    const after = '\n\nuser text after\n';
    const outcome = applyAgentRulesBlock(`${before}${block('old rules\n')}${after}`, '## New rules\n');
    expect(outcome).toEqual({ kind: 'replace', text: `${before}${block('## New rules\n')}${after}` });
  });

  it('idempotent: applying the same body twice is unchanged the second time', () => {
    const first = applyAgentRulesBlock(NX_BLOCK, '## Rules\n');
    if (first.kind !== 'append') throw new Error('expected append');
    expect(applyAgentRulesBlock(first.text, '## Rules\n')).toEqual({ kind: 'unchanged' });
  });

  it('a block the user edited (a TODO filled in) is kept and reported, never overwritten', () => {
    const generated = `${block('## Rules\n<!-- TODO: describe the domain -->\n')}\n`;
    const edited = generated.replace('<!-- TODO: describe the domain -->', 'We sell coffee beans.');
    const outcome = applyAgentRulesBlock(edited, '## Rules v2\n<!-- TODO: describe the domain -->\n');
    expect(outcome).toEqual({
      kind: 'user-modified',
      existingBody: '## Rules\nWe sell coffee beans.\n',
      generatedBody: '## Rules v2\n<!-- TODO: describe the domain -->\n',
    });
  });

  it('overwrite: true replaces a user-edited block', () => {
    const edited = `${block('## Rules\n')}\n`.replace('## Rules', '## My rules');
    expect(applyAgentRulesBlock(edited, '## Rules v2\n', { overwrite: true })).toEqual({ kind: 'replace', text: `${block('## Rules v2\n')}\n` });
  });

  it('a block without a hash (written before hashes) that already matches only gains the hash', () => {
    const legacy = `${LEGACY_START}\n## Rules\n${END}\n`;
    expect(applyAgentRulesBlock(legacy, '## Rules\n')).toEqual({ kind: 'replace', text: `${block('## Rules\n')}\n` });
  });

  it('a block without a hash that differs counts as edited by the user', () => {
    const legacy = `${LEGACY_START}\n## Old rules\n${END}\n`;
    expect(applyAgentRulesBlock(legacy, '## Rules\n')).toMatchObject({ kind: 'user-modified' });
  });

  it.each([
    ['a start marker alone', `${LEGACY_START}\nrules\n`],
    ['an end marker alone', `rules\n${END}\n`],
    ['two blocks', `${LEGACY_START}\na\n${END}\n${block('b\n')}\n`],
    ['markers out of order', `${END}\nrules\n${LEGACY_START}\n`],
  ])('%s is reported, never written', (_label, existing) => {
    expect(applyAgentRulesBlock(existing, '## Rules\n')).toMatchObject({ kind: 'unrecognized' });
  });

  it('an empty file gets just the block, reported as created', () => {
    expect(applyAgentRulesBlock('', 'x\n')).toEqual({ kind: 'create', text: `${block('x\n')}\n` });
  });

  it("never trims the user's text on append: trailing spaces and blank lines stay; a missing final newline is completed", () => {
    expect(applyAgentRulesBlock('notes  \n\n\n', 'x\n')).toEqual({ kind: 'append', text: `notes  \n\n\n\n${block('x\n')}\n` });
    expect(applyAgentRulesBlock('no newline', 'x\n')).toEqual({ kind: 'append', text: `no newline\n\n${block('x\n')}\n` });
  });

  it('a CRLF file gets a CRLF block, and a rerun is unchanged (Windows checkouts)', () => {
    const appended = applyAgentRulesBlock('# Title\r\nline\r\n', '## Rules\nbody\n');
    expect(appended).toEqual({ kind: 'append', text: `# Title\r\nline\r\n\r\n${block('## Rules\nbody\n', '\r\n')}\r\n` });
    if (appended.kind !== 'append') throw new Error('expected append');
    expect(appended.text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(applyAgentRulesBlock(appended.text, '## Rules\nbody\n')).toEqual({ kind: 'unchanged' });
  });

  it('a marker quoted inside a code fence still counts — reported, never guessed', () => {
    const doc = `# Docs\n\n\`\`\`\n${LEGACY_START}\n\`\`\`\n`;
    expect(applyAgentRulesBlock(doc, 'x\n')).toMatchObject({ kind: 'unrecognized' });
  });
});
