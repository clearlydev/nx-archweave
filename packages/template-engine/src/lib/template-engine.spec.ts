import { describeEngine } from './template-engine.ts';

describe('template-engine', () => {
  it('reports the shared version it was built against', () => {
    expect(describeEngine()).toBe('template-engine@bootstrap');
  });
});
