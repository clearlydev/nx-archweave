import { buildFsdCheckTarget, buildSteigerConfig, FSD_CHECK_TARGET, STEIGER_CONFIG_FILE, STEIGER_DEPENDENCIES } from './fsd-steiger.ts';

describe('steiger assets', () => {
  it('pins the two measured packages and names the config file and target', () => {
    expect(Object.keys(STEIGER_DEPENDENCIES).sort()).toEqual(['@feature-sliced/steiger-plugin', 'steiger']);
    expect(STEIGER_CONFIG_FILE).toBe('steiger.config.mjs');
    expect(FSD_CHECK_TARGET).toBe('fsd-check');
    expect(buildFsdCheckTarget()).toEqual({ command: 'steiger src', options: { cwd: '{projectRoot}' } });
  });

  it('the config is the recommended set with insignificant-slice downgraded; Next.js also turns the _pages typo rule off', () => {
    const vite = buildSteigerConfig({ renamedLayerDirs: [], locale: 'en' });
    expect(vite).toContain("import fsd from '@feature-sliced/steiger-plugin';");
    expect(vite).toContain('...fsd.configs.recommended,');
    expect(vite).toContain("'fsd/insignificant-slice': 'warn',");
    expect(vite).not.toContain('typo-in-layer-name');
    const next = buildSteigerConfig({ renamedLayerDirs: ['_app', '_pages'], locale: 'ko' });
    expect(next).toContain("'fsd/typo-in-layer-name': 'off',");
    expect(next).toContain('_app, _pages');
    expect(next).toContain('방금 생성한 슬라이스');
  });
});

describe('buildSteigerConfig — renamed layer directories', () => {
  it('any framework that renames a layer (Expo Router: _app) turns the typo rule off; none renamed keeps it', () => {
    expect(buildSteigerConfig({ renamedLayerDirs: ['_app'], locale: 'en' })).toContain("'fsd/typo-in-layer-name': 'off',");
    expect(buildSteigerConfig({ renamedLayerDirs: [], locale: 'ko' })).not.toContain('typo-in-layer-name');
  });
});
