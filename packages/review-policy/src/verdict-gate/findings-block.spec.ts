import { extractFindingsBlock, FINDINGS_MARKER, findingKey } from './findings-block.ts';

const finding = {
  priority: 'P1',
  category: 'logic-error',
  title: 't',
  file: 'src/a.ts',
  lineRange: { start: 3 },
  evidence: 'e',
  impact: 'i',
  reproductionCondition: 'r',
  recommendation: 'rec',
  confidence: 'confirmed',
};
const block = (payload: unknown) =>
  `summary text\n${FINDINGS_MARKER}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;
const valid = { schema: 'archweave/findings@1', findings: [finding] };

describe('extractFindingsBlock', () => {
  it('parses the fenced json block right after the marker', () => {
    const result = extractFindingsBlock(block(valid));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.findings[0].priority).toBe('P1');
  });

  it('returns missing when there is no marker, even if a json block exists', () => {
    expect(
      extractFindingsBlock('```json\n{"schema":"archweave/findings@1","findings":[]}\n```').status,
    ).toBe('missing');
  });

  it('ignores json blocks that come before the marker and uses the first one after it', () => {
    const body = `\`\`\`json\n{"not":"it"}\n\`\`\`\n${FINDINGS_MARKER}\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    expect(extractFindingsBlock(body).status).toBe('ok');
  });

  it('tolerates prose between the marker and the block (first json block after marker wins)', () => {
    const body = `${FINDINGS_MARKER}\nsome prose\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    expect(extractFindingsBlock(body).status).toBe('ok');
  });

  it('returns invalid on broken json, wrong schema id, or a non-json fence after the marker', () => {
    expect(extractFindingsBlock(`${FINDINGS_MARKER}\n\`\`\`json\n{nope\n\`\`\``).status).toBe('invalid');
    expect(extractFindingsBlock(block({ schema: 'other@1', findings: [] })).status).toBe('invalid');
    expect(
      extractFindingsBlock(`${FINDINGS_MARKER}\n\`\`\`jsonc\n${JSON.stringify(valid)}\n\`\`\``).status,
    ).toBe('invalid');
  });

  it('one element missing a required field poisons the whole block', () => {
    const bad = { ...finding, lineRange: {} };
    expect(
      extractFindingsBlock(block({ schema: 'archweave/findings@1', findings: [finding, bad] })).status,
    ).toBe('invalid');
  });

  it('fills optional narrative fields with empty strings instead of rejecting', () => {
    const sparse = { priority: 'P3', category: 'c', title: 't', file: 'f.ts', lineRange: { start: 1 } };
    const result = extractFindingsBlock(block({ schema: 'archweave/findings@1', findings: [sparse] }));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.findings[0].evidence).toBe('');
  });

  it('an empty findings array is ok (→ APPROVE downstream)', () => {
    expect(extractFindingsBlock(block({ schema: 'archweave/findings@1', findings: [] })).status).toBe('ok');
  });
});

describe('findingKey', () => {
  it('is file:start:category', () => {
    expect(findingKey(finding as never)).toBe('src/a.ts:3:logic-error');
  });
});

describe('extractFindingsBlock — marker binding and hijack resistance', () => {
  it('binds to the LAST marker: an echoed marker plus an example block cannot hijack the payload', () => {
    const body = [
      `The instructions say to append ${FINDINGS_MARKER} and a block like:`,
      '```json',
      '{"schema":"archweave/findings@1","findings":[]}',
      '```',
      'Here is my real summary.',
      FINDINGS_MARKER,
      '```json',
      JSON.stringify({ schema: 'archweave/findings@1', findings: [finding] }),
      '```',
    ].join('\n');
    const result = extractFindingsBlock(body);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.findings).toHaveLength(1);
  });

  it('skips non-json fences between the marker and the payload (first JSON fence wins)', () => {
    const body = [
      FINDINGS_MARKER,
      '```ts',
      'const example = 1;',
      '```',
      '```json',
      JSON.stringify(valid),
      '```',
    ].join('\n');
    expect(extractFindingsBlock(body).status).toBe('ok');
  });

  it('parses a CRLF comment body (web-edited comments)', () => {
    const body = `${FINDINGS_MARKER}\r\n\u0060\u0060\u0060json\r\n${JSON.stringify(valid)}\r\n\u0060\u0060\u0060\r\n`;
    expect(extractFindingsBlock(body).status).toBe('ok');
  });
});

describe('extractFindingsBlock — fenced code inside JSON strings', () => {
  it('a fenced code snippet INSIDE a JSON string does not truncate the payload', () => {
    const withFence = {
      ...finding,
      evidence: 'the code does this:\n```ts\nreturn null;\n```\nwhich is wrong',
    };
    const body = block({ schema: 'archweave/findings@1', findings: [withFence] });
    const result = extractFindingsBlock(body);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.findings[0].evidence).toContain('return null;');
  });

  it('rejects a non-positive or fractional lineRange.start', () => {
    for (const start of [0, -1, 1.5, Number.NaN]) {
      const bad = { ...finding, lineRange: { start } };
      expect(extractFindingsBlock(block({ schema: 'archweave/findings@1', findings: [bad] })).status).toBe('invalid');
    }
  });
});
