import { sharedTypesApiTypesContent, sharedTypesIndexContent, sharedTypesPackageJsonContent } from './shared-types.ts';

describe('shared-types library content', () => {
  it('ships a demonstrative ApiHealthResponse type', () => {
    expect(sharedTypesApiTypesContent()).toContain('export interface ApiHealthResponse');
  });

  it('barrel re-exports the api-types module with an ESM .js specifier', () => {
    expect(sharedTypesIndexContent()).toBe("export * from './lib/api-types.js';\n");
  });

  it('package.json is a source-exported workspace package tagged scope:shared', () => {
    const parsed = JSON.parse(sharedTypesPackageJsonContent('@org/shared-types'));
    expect(parsed.name).toBe('@org/shared-types');
    expect(parsed.private).toBe(true);
    expect(parsed.exports['.'].import).toBe('./src/index.ts');
    expect(parsed.nx.projectType).toBe('library');
    expect(parsed.nx.tags).toEqual(['scope:shared']);
    expect(parsed.nx.targets).toEqual({});
  });
});
