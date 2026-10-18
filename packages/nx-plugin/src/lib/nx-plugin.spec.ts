import { describePlugin } from './nx-plugin.ts';

describe('nx-plugin', () => {
  it('reports the engine and integration registry it was built against', () => {
    expect(describePlugin()).toBe('nx-plugin(template-engine@bootstrap, integrations=1)');
  });
});
