import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBoundaryConstraints,
  buildBoundarySnippet,
  classifyBoundaryConstraints,
  SCOPE_CONSTRAINTS,
} from './eslint-boundaries.ts';

const FIXTURES = join(__dirname, '../../../../tools/fixtures/eslint-configs');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

describe('SCOPE_CONSTRAINTS', () => {
  it('encodes the deny scheme: the two sides may never import each other, shared stays side-free', () => {
    expect(SCOPE_CONSTRAINTS).toEqual([
      { sourceTag: 'scope:frontend', notDependOnLibsWithTags: ['scope:backend'] },
      { sourceTag: 'scope:backend', notDependOnLibsWithTags: ['scope:frontend'] },
      { sourceTag: 'scope:shared', notDependOnLibsWithTags: ['scope:frontend', 'scope:backend'] },
    ]);
  });
});

describe('applyBoundaryConstraints', () => {
  it('replaces the Nx allow-all block with the scope constraints', () => {
    const result = applyBoundaryConstraints(read('nx-default.config.mjs'));
    expect(result.status).toBe('applied');
    if (result.status === 'applied') {
      expect(result.text).toContain("sourceTag: 'scope:frontend'");
      expect(result.text).toContain("notDependOnLibsWithTags: ['scope:backend']");
      // the allow-all baseline deliberately survives, exactly once, below our rules
      expect(result.text.match(/sourceTag:\s*'\*'/g)).toHaveLength(1);
      // everything outside the depConstraints block is untouched
      expect(result.text).toContain("allow: ['^.*/eslint(\\\\.base)?\\\\.config\\\\.[cm]?js$']");
    }
  });

  it('is idempotent — our constraints are detected, not re-applied', () => {
    expect(applyBoundaryConstraints(read('already-applied.config.mjs')).status).toBe('already-applied');
  });

  it('applying its own output reports already-applied', () => {
    const first = applyBoundaryConstraints(read('nx-default.config.mjs'));
    expect(first.status).toBe('applied');
    if (first.status === 'applied') {
      expect(applyBoundaryConstraints(first.text).status).toBe('already-applied');
    }
  });

  it('never touches an unrecognized config', () => {
    const result = applyBoundaryConstraints(read('custom-unrecognized.config.mjs'));
    expect(result).toEqual({ status: 'unrecognized' });
  });
});

describe('classifyBoundaryConstraints (doctor)', () => {
  it('classifies enforced / allow-all / unknown', () => {
    expect(classifyBoundaryConstraints(read('already-applied.config.mjs'))).toBe('enforced');
    expect(classifyBoundaryConstraints(read('nx-default.config.mjs'))).toBe('allow-all');
    expect(classifyBoundaryConstraints('module.exports = {}')).toBe('unknown');
  });

  it('classifies a user-customized depConstraints block as unknown, not allow-all', () => {
    expect(classifyBoundaryConstraints(read('custom-unrecognized.config.mjs'))).toBe('unknown');
  });
});

describe('buildBoundarySnippet', () => {
  it('renders a paste-ready block naming all three scopes', () => {
    const snippet = buildBoundarySnippet();
    expect(snippet).toContain('scope:frontend');
    expect(snippet).toContain('scope:backend');
    expect(snippet).toContain('scope:shared');
    expect(snippet).toContain('depConstraints');
  });
});

describe('applyBoundaryConstraints — hardening', () => {
  it('ignores a commented-out allow-all block and replaces the real one', () => {
    const original = read('commented-out-block.config.mjs');
    const result = applyBoundaryConstraints(original);
    expect(result.status).toBe('applied');
    if (result.status === 'applied') {
      expect(result.text).toContain('kept around commented out'); // comment preserved
      expect(result.text).toContain("sourceTag: 'scope:backend'");
      // the only remaining allow-all text lives inside the comment
      const uncommented = result.text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');
      // one wildcard remains by design: the appended baseline (the original
      // allow-all block itself was consumed by the replacement)
      expect(uncommented.match(/sourceTag:\s*'\*'/g)).toHaveLength(1);
      expect(uncommented).toContain('notDependOnLibsWithTags');
    }
  });

  it('marker plus a wildcard elsewhere counts as enforced — conjunctive semantics', () => {
    // Under enforce-module-boundaries, every matching constraint must pass, so
    // our deny rules bite even when an allow-all baseline coexists.
    const original = read('mixed-marker-allowall.config.mjs');
    expect(applyBoundaryConstraints(original)).toEqual({ status: 'already-applied' });
    expect(classifyBoundaryConstraints(original)).toBe('enforced');
  });

  it('refuses when more than one allow-all block exists', () => {
    const doubled = read('nx-default.config.mjs') + read('nx-default.config.mjs');
    expect(applyBoundaryConstraints(doubled)).toEqual({ status: 'unrecognized' });
  });

  it('keeps CRLF line endings in the replacement block', () => {
    const crlf = read('nx-default.config.mjs').replace(/\n/g, '\r\n');
    const result = applyBoundaryConstraints(crlf);
    expect(result.status).toBe('applied');
    if (result.status === 'applied') {
      expect(result.text).toContain("sourceTag: 'scope:frontend',\r\n");
      expect(result.text).not.toMatch(/[^\r]\n/); // no stray LF-only lines
    }
  });
});

describe('buildBoundarySnippet — applied shape', () => {
  it('emits the applied single-quoted shape, so pasting it satisfies the marker', () => {
    const snippet = buildBoundarySnippet();
    expect(snippet).toContain("sourceTag: 'scope:frontend'"); // APPLIED_MARKER literal
    expect(snippet).toContain("notDependOnLibsWithTags: ['scope:backend']");
    expect(classifyBoundaryConstraints(snippet)).toBe('enforced');
  });
});
