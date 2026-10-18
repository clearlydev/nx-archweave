import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFsdEnforcementCheck } from './fsd-enforcement-check.ts';

const APPLIED = "import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\nexport default [...fsdBoundaries({ severity: 'warn' })];\n";
const PLAIN = "export default [];\n";

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fsd-enforcement-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

describe('fsd-enforcement-applied', () => {
  it('passes as not applicable without toolkit.config.json, or with FSD off', () => {
    const unmanaged = workspace({ 'apps/web/eslint.config.mjs': PLAIN });
    const off = workspace({ 'toolkit.config.json': JSON.stringify({ frontend: 'react-vite', fsd: { enabled: false } }), 'apps/web/eslint.config.mjs': PLAIN });
    const backendOnly = workspace({ 'toolkit.config.json': JSON.stringify({ frontend: 'none' }) });
    try {
      expect(buildFsdEnforcementCheck(unmanaged).status).toBe('pass');
      expect(buildFsdEnforcementCheck(off).status).toBe('pass');
      expect(buildFsdEnforcementCheck(backendOnly).status).toBe('pass');
    } finally {
      for (const root of [unmanaged, off, backendOnly]) rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes with the app's config as evidence when it imports the rule — apps one grouping level deep and the root count too", () => {
    const flat = workspace({ 'toolkit.config.json': JSON.stringify({ frontend: 'next' }), 'apps/web/eslint.config.mjs': APPLIED });
    const grouped = workspace({ 'toolkit.config.json': JSON.stringify({ frontend: 'react-vite' }), 'apps/shop/web/eslint.config.mjs': APPLIED });
    const standalone = workspace({ 'toolkit.config.json': JSON.stringify({ frontend: 'react-vite' }), 'eslint.config.mjs': APPLIED });
    try {
      const check = buildFsdEnforcementCheck(flat);
      expect(check.status).toBe('pass');
      expect(check.evidence).toEqual(['apps/web/eslint.config.mjs']);
      expect(buildFsdEnforcementCheck(grouped).evidence).toEqual(['apps/shop/web/eslint.config.mjs']);
      expect(buildFsdEnforcementCheck(standalone).evidence).toEqual(['eslint.config.mjs']);
    } finally {
      for (const root of [flat, grouped, standalone]) rmSync(root, { recursive: true, force: true });
    }
  });

  it('warns, pointing at add-fsd-lite --applyEslint, when FSD is on but no config imports the rule (a commented-out import does not count)', () => {
    const root = workspace({
      'toolkit.config.json': JSON.stringify({ frontend: 'react-vite' }),
      'apps/web/eslint.config.mjs': "// import { fsdBoundaries } from '@clearlydev/nx-archweave/eslint';\nexport default [];\n",
    });
    try {
      const check = buildFsdEnforcementCheck(root);
      expect(check.status).toBe('warning');
      expect(check.suggestedAction).toContain('add-fsd-lite --applyEslint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
