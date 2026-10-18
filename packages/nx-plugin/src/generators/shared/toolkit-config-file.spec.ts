import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { detectIndent, readToolkitConfig, readToolkitConfigFile, resolveLocaleOption, TOOLKIT_CONFIG_PATH } from './toolkit-config-file.ts';

describe('detectIndent', () => {
  it('returns the first indentation unit found: spaces, tabs, or the two-space default', () => {
    expect(detectIndent('{\n    "a": 1\n}\n')).toBe('    ');
    expect(detectIndent('{\n\t"a": 1\n}\n')).toBe('\t');
    expect(detectIndent('{"a":1}')).toBe('  ');
    expect(detectIndent('')).toBe('  ');
  });
});

describe('readToolkitConfigFile / readToolkitConfig', () => {
  it('absent file: raw and parsed are null', () => {
    const tree = createTreeWithEmptyWorkspace();
    expect(readToolkitConfigFile(tree)).toEqual({ raw: null, parsed: null });
    expect(readToolkitConfig(tree)).toBeNull();
  });

  it('a JSON object: raw text kept verbatim, parsed object returned', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(TOOLKIT_CONFIG_PATH, '{\n  "locale": "ko"\n}\n');
    expect(readToolkitConfigFile(tree)).toEqual({ raw: '{\n  "locale": "ko"\n}\n', parsed: { locale: 'ko' } });
    expect(readToolkitConfig(tree)).toEqual({ locale: 'ko' });
  });

  it.each([
    ['unparseable', '{ not json'],
    ['an array', '[1]'],
    ['null', 'null'],
  ])('%s: raw is kept (so a writer can refuse to touch it) but parsed is null', (_label, content) => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(TOOLKIT_CONFIG_PATH, content);
    expect(readToolkitConfigFile(tree)).toEqual({ raw: content, parsed: null });
    expect(readToolkitConfig(tree)).toBeNull();
  });
});

describe('resolveLocaleOption', () => {
  it('option > config locale > en, and ignores anything that is not ko/en', () => {
    expect(resolveLocaleOption('ko', { locale: 'en' })).toBe('ko');
    expect(resolveLocaleOption(undefined, { locale: 'ko' })).toBe('ko');
    expect(resolveLocaleOption(undefined, { locale: 'fr' })).toBe('en');
    expect(resolveLocaleOption(undefined, null)).toBe('en');
  });
});
