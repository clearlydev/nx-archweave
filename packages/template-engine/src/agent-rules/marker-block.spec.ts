import { AGENT_RULES_BLOCK_END as END, AGENT_RULES_BLOCK_START as START, applyAgentRulesBlock } from './marker-block.ts';

const NX_BLOCK = '<!-- nx configuration start-->\n# Nx guidelines\n<!-- nx configuration end-->\n';

describe('applyAgentRulesBlock', () => {
  it('no file: the block is the whole file', () => {
    expect(applyAgentRulesBlock(null, '## Rules\n')).toEqual({ kind: 'create', text: `${START}\n## Rules\n${END}\n` });
  });

  it("a file without our block (Nx's own, a user's text): appended after it, the rest untouched", () => {
    const outcome = applyAgentRulesBlock(`${NX_BLOCK}\nmy notes\n`, '## Rules\n');
    expect(outcome).toEqual({ kind: 'append', text: `${NX_BLOCK}\nmy notes\n\n${START}\n## Rules\n${END}\n` });
  });

  it('our block present: only the block is replaced — text before and after it survives byte for byte', () => {
    const before = `${NX_BLOCK}\nintro\n\n`;
    const after = '\n\nuser text after\n';
    const outcome = applyAgentRulesBlock(`${before}${START}\nold rules\n${END}${after}`, '## New rules\n');
    expect(outcome).toEqual({ kind: 'replace', text: `${before}${START}\n## New rules\n${END}${after}` });
  });

  it('idempotent: applying the same body twice is unchanged the second time', () => {
    const first = applyAgentRulesBlock(NX_BLOCK, '## Rules\n');
    if (first.kind !== 'append') throw new Error('expected append');
    expect(applyAgentRulesBlock(first.text, '## Rules\n')).toEqual({ kind: 'unchanged' });
  });

  it.each([
    ['a start marker alone', `${START}\nrules\n`],
    ['an end marker alone', `rules\n${END}\n`],
    ['two blocks', `${START}\na\n${END}\n${START}\nb\n${END}\n`],
    ['markers out of order', `${END}\nrules\n${START}\n`],
  ])('%s is reported, never written', (_label, existing) => {
    expect(applyAgentRulesBlock(existing, '## Rules\n')).toMatchObject({ kind: 'unrecognized' });
  });

  it('an empty file gets just the block, reported as created', () => {
    expect(applyAgentRulesBlock('', 'x\n')).toEqual({ kind: 'create', text: `${START}\nx\n${END}\n` });
  });

  it("never trims the user's text on append: trailing spaces and blank lines stay; a missing final newline is completed", () => {
    expect(applyAgentRulesBlock('notes  \n\n\n', 'x\n')).toEqual({ kind: 'append', text: `notes  \n\n\n\n${START}\nx\n${END}\n` });
    expect(applyAgentRulesBlock('no newline', 'x\n')).toEqual({ kind: 'append', text: `no newline\n\n${START}\nx\n${END}\n` });
  });

  it('a CRLF file gets a CRLF block, and a rerun is unchanged (Windows checkouts)', () => {
    const appended = applyAgentRulesBlock('# Title\r\nline\r\n', '## Rules\nbody\n');
    expect(appended).toEqual({ kind: 'append', text: `# Title\r\nline\r\n\r\n${START}\r\n## Rules\r\nbody\r\n${END}\r\n` });
    if (appended.kind !== 'append') throw new Error('expected append');
    expect(appended.text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(applyAgentRulesBlock(appended.text, '## Rules\nbody\n')).toEqual({ kind: 'unchanged' });
  });

  it('a marker quoted inside a code fence still counts — reported, never guessed', () => {
    const doc = `# Docs\n\n\`\`\`\n${START}\n\`\`\`\n`;
    expect(applyAgentRulesBlock(doc, 'x\n')).toMatchObject({ kind: 'unrecognized' });
  });
});


