import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFsdLikeCheck } from './fsd-like-check.ts';

const make = (dirs: string[], withConfig = false) => {
  const root = mkdtempSync(join(tmpdir(), 'fsdlike-'));
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  if (withConfig) writeFileSync(join(root, 'toolkit.config.json'), '{}\n');
  return root;
};

describe('fsd-like-structure', () => {
  it('warns when 2+ FSD layer dirs exist under src/ (pre-install collision signal)', () => {
    const root = make(['src/features', 'src/entities']);
    try {
      const check = buildFsdLikeCheck(root);
      expect(check.status).toBe('warning');
      expect(check.evidence).toEqual(expect.arrayContaining(['src/features', 'src/entities']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('also scans apps/*/src', () => {
    const root = make(['apps/web/src/widgets', 'apps/web/src/pages']);
    try {
      expect(buildFsdLikeCheck(root).status).toBe('warning');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts FSD's Next.js layer names (_pages, _app)", () => {
    const root = make(['apps/site/src/_pages', 'apps/site/src/features']);
    try {
      const check = buildFsdLikeCheck(root);
      expect(check.status).toBe('warning');
      expect(check.evidence).toEqual(expect.arrayContaining(['apps/site/src/_pages']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('0-1 layer dirs → pass', () => {
    const one = make(['src/features']);
    const none = make(['src/components']);
    try {
      expect(buildFsdLikeCheck(one).status).toBe('pass');
      expect(buildFsdLikeCheck(none).status).toBe('pass');
    } finally {
      rmSync(one, { recursive: true, force: true });
      rmSync(none, { recursive: true, force: true });
    }
  });

  it('our own post-install structure never warns: toolkit.config.json present → pass', () => {
    const root = make(['src/features', 'src/entities', 'src/shared'], true);
    try {
      const check = buildFsdLikeCheck(root);
      expect(check.status).toBe('pass');
      expect(check.message).toContain('toolkit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
