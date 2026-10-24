import { buildFsdEslintEntry, buildFsdEslintImportLine, buildFsdEslintSnippet, buildFsdLayerGuide, FSD_ESLINT_MODULE } from './fsd-eslint.ts';

describe('fsd eslint text', () => {
  it('the import line names the module doctor and the applier recognise', () => {
    expect(buildFsdEslintImportLine()).toContain(FSD_ESLINT_MODULE);
    expect(buildFsdEslintImportLine()).toMatch(/^import \{ fsdBoundaries \} from '.*';$/);
  });

  it('the entry carries the severity, anchors paths to the config file and names the source root', () => {
    expect(buildFsdEslintEntry('warn')).toBe("...fsdBoundaries({ severity: 'warn', cwd: import.meta.dirname, root: 'src' }),");
    expect(buildFsdEslintEntry('error', '.')).toBe("...fsdBoundaries({ severity: 'error', cwd: import.meta.dirname, root: '.' }),");
  });

  it('the snippet carries the source root it was built for', () => {
    expect(buildFsdEslintSnippet({ severity: 'error', locale: 'en', root: '.' })).toContain(buildFsdEslintEntry('error', '.'));
  });

  it('the snippet is the import plus the entry with paste instructions, in both locales', () => {
    for (const locale of ['en', 'ko'] as const) {
      const snippet = buildFsdEslintSnippet({ severity: 'error', locale });
      expect(snippet).toContain(buildFsdEslintImportLine());
      expect(snippet).toContain(buildFsdEslintEntry('error'));
      expect(snippet).toContain('eslint.config.mjs');
    }
    expect(buildFsdEslintSnippet({ severity: 'error', locale: 'ko' })).not.toBe(buildFsdEslintSnippet({ severity: 'error', locale: 'en' }));
  });
});

describe('buildFsdLayerGuide', () => {
  it('lists each layer directory under the source root and points at the slice generators', () => {
    const guide = buildFsdLayerGuide({
      layers: ['pages', 'features', 'entities', 'shared'],
      directories: ['_pages', 'features', 'entities', 'shared'],
      sourceRoot: 'apps/web/src',
      locale: 'en',
    });
    expect(guide).toContain('apps/web/src/_pages');
    expect(guide).toContain('apps/web/src/shared');
    expect(guide).toContain('nx g @clearlydev/nx-archweave:feature');
    expect(guide).toContain('archweave/fsd-boundaries');
    expect(guide).not.toContain('index.ts: created');
  });

  it('is localised', () => {
    const input = { layers: ['shared'], directories: ['shared'], sourceRoot: 'src' } as const;
    expect(buildFsdLayerGuide({ ...input, layers: ['shared'], directories: ['shared'], locale: 'ko' })).toContain('세그먼트');
    expect(buildFsdLayerGuide({ ...input, layers: ['shared'], directories: ['shared'], locale: 'en' })).toContain('segments');
  });
});
