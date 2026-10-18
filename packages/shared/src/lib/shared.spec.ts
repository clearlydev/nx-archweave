import { archweaveVersion } from './shared.ts';

describe('shared', () => {
  it('exposes a version marker', () => {
    expect(archweaveVersion()).toBe('bootstrap');
  });
});
