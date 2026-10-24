import { detectFramework, profileById } from './profiles.ts';
import { fsdLayerDirName, fsdLayersFor } from '../fsd/fsd-eslint-config.ts';

/** A workspace as a map of path → content. */
function workspace(files: Record<string, string>) {
  return { exists: (path: string) => path in files, read: (path: string) => files[path] ?? null };
}

describe('detectFramework', () => {
  it.each(['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'])('finds Next.js by its %s', (file) => {
    expect(detectFramework({ ...workspace({ [`apps/web/${file}`]: '' }), projectRoot: 'apps/web' }).id).toBe('next');
  });

  it('finds Next.js by a @nx/next executor', () => {
    const ws = workspace({});
    expect(detectFramework({ ...ws, projectRoot: 'web', executors: ['@nx/next:build'] }).id).toBe('next');
  });

  it('finds a root project (nx init) by the files at the workspace root', () => {
    expect(detectFramework({ ...workspace({ 'next.config.mjs': '' }), projectRoot: '.' }).id).toBe('next');
  });

  it('finds React on Vite by a vite config and a react dependency', () => {
    const ws = workspace({ 'apps/web/vite.config.ts': '', 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }) });
    expect(detectFramework({ ...ws, projectRoot: 'apps/web' }).id).toBe('react-vite');
  });

  it('a vite config without react is not React on Vite', () => {
    const ws = workspace({ 'apps/web/vite.config.ts': '', 'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }) });
    expect(detectFramework({ ...ws, projectRoot: 'apps/web' }).id).toBe('generic');
  });

  it('anything else is generic — never silently React on Vite', () => {
    expect(detectFramework({ ...workspace({}), projectRoot: 'apps/web' }).id).toBe('generic');
  });
});

describe('profiles', () => {
  it("Next.js moves FSD's app and pages layers out of the routers' way", () => {
    expect(profileById('next').layerDirs).toEqual({ app: '_app', pages: '_pages' });
    expect(fsdLayerDirName('next', 'pages')).toBe('_pages');
    expect(fsdLayersFor('next')).toEqual(['pages', 'features', 'entities', 'shared']);
  });

  it('generic keeps every layer under its own name', () => {
    expect(fsdLayersFor('generic')).toEqual(['app', 'pages', 'features', 'entities', 'shared']);
    expect(fsdLayerDirName('generic', 'pages')).toBe('pages');
    expect(profileById('generic').recognised).toBe(false);
  });

  it('names the build output each framework writes into the app', () => {
    expect(profileById('next').buildOutputDirs).toEqual(['.next', 'out']);
    expect(profileById('react-vite').buildOutputDirs).toEqual(['dist']);
  });
});

describe('Expo', () => {
  const ws = (files: Record<string, string>) => ({ exists: (p: string) => p in files, read: (p: string) => files[p] ?? null });

  it.each([
    ['an @nx/expo executor', {}, ['@nx/expo:start']],
    ['an app.json with an expo key', { 'apps/mobile/app.json': JSON.stringify({ expo: { name: 'mobile' } }) }, []],
    ['an app.config.ts', { 'apps/mobile/app.config.ts': 'export default { expo: {} };' }, []],
    ['the expo dependency', { 'apps/mobile/package.json': JSON.stringify({ dependencies: { expo: '~52.0.0' } }) }, []],
  ] as [string, Record<string, string>, string[]][])('is found by %s', (_label, files, executors) => {
    expect(detectFramework({ ...ws(files), projectRoot: 'apps/mobile', executors }).id).toBe('expo');
  });

  it('with expo-router, FSD\'s app layer moves to _app (the router owns app/)', () => {
    const files = { 'apps/mobile/app.json': JSON.stringify({ expo: {} }), 'apps/mobile/package.json': JSON.stringify({ dependencies: { expo: '~52.0.0', 'expo-router': '~4.0.0' } }) };
    expect(detectFramework({ ...ws(files), projectRoot: 'apps/mobile' }).layerDirs).toEqual({ app: '_app' });
  });

  it('without a router, app/ is the FSD app layer', () => {
    expect(detectFramework({ ...ws({ 'apps/mobile/app.json': JSON.stringify({ expo: {} }) }), projectRoot: 'apps/mobile' }).layerDirs).toEqual({});
  });

  it('treats platform files as one module and keeps Expo output out of the rule', () => {
    expect(profileById('expo').platformSuffixes).toEqual(['ios', 'android', 'native', 'web']);
    expect(profileById('expo').buildOutputDirs).toEqual(['.expo', 'dist']);
    expect(profileById('next').platformSuffixes).toEqual([]);
  });
});
