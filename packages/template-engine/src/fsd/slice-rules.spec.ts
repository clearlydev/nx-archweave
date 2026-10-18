import { isEssenceSegmentName, isUsableSliceApiName, resolveSlicePublicApiName } from './slice-rules.ts';

describe('segment naming (canonical FSD: by purpose, not by essence)', () => {
  it('flags essence names and accepts purpose names', () => {
    for (const name of ['components', 'hooks', 'utils', 'types', 'constants']) expect(isEssenceSegmentName(name)).toBe(true);
    for (const name of ['ui', 'api', 'model', 'lib', 'config', 'i18n']) expect(isEssenceSegmentName(name)).toBe(false);
  });
});

describe('public API name', () => {
  it('defaults to camelCase and accepts an override', () => {
    expect(resolveSlicePublicApiName('add-to-cart')).toBe('addToCart');
    expect(resolveSlicePublicApiName('add-to-cart', 'cart')).toBe('cart');
  });

  it('rejects reserved words and non-identifiers', () => {
    expect(isUsableSliceApiName('addToCart')).toBe(true);
    expect(isUsableSliceApiName('class')).toBe(false);
    expect(isUsableSliceApiName('1x')).toBe(false);
  });
});
