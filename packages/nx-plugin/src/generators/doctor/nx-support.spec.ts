import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readNxSupport } from './nx-support.ts';

const devkit23 = () => '23.3.1';

describe('readNxSupport', () => {
  it.each([
    ['23.3.0', true],
    ['24.0.0', true],
    ['22.0.0', true],
    ['23.4.0-beta.1', true],
    ['25.0.0', false],
    ['25.0.0-beta.0', false],
    ['21.6.0', false],
  ])('installed nx %s against @nx/devkit 23: inRange %s', (installed, inRange) => {
    expect(readNxSupport('/w', { devkitVersion: devkit23, installedNx: () => installed })).toEqual({
      devkitVersion: '23.3.1',
      supportedMajors: { min: 22, max: 24 },
      installedVersion: installed,
      inRange,
    });
  });

  it('nx not installed: no verdict', () => {
    expect(readNxSupport('/w', { devkitVersion: devkit23, installedNx: () => undefined })?.inRange).toBeUndefined();
  });

  it('an unreadable devkit, or a version without a major: no support info at all', () => {
    expect(readNxSupport('/w', { devkitVersion: () => undefined, installedNx: () => '25.0.0' })).toBeUndefined();
    expect(readNxSupport('/w', { devkitVersion: () => 'latest', installedNx: () => '25.0.0' })).toBeUndefined();
  });

  it('by default reads the @nx/devkit the plugin itself resolves', () => {
    const own = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('@nx/devkit/package.json'), 'utf-8')) as { version: string };
    expect(readNxSupport('/nowhere')).toMatchObject({ devkitVersion: own.version, installedVersion: undefined, inRange: undefined });
  });
});
