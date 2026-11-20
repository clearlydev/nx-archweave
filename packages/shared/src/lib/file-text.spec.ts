import { normalizeFileText, sameFileText } from './file-text.ts';

describe('sameFileText', () => {
  it('treats CRLF and LF line endings as the same content', () => {
    expect(sameFileText('a: 1\r\nb: 2\r\n', 'a: 1\nb: 2\n')).toBe(true);
  });

  it('ignores a leading byte order mark', () => {
    expect(sameFileText('﻿name: x\n', 'name: x\n')).toBe(true);
  });

  it('still sees a real difference', () => {
    expect(sameFileText('a: 1\r\n', 'a: 2\n')).toBe(false);
    expect(sameFileText('a: 1\n', 'a: 1\n\n')).toBe(false);
  });

  it('keeps a lone CR and a BOM that is not at the start', () => {
    expect(normalizeFileText('a\rb')).toBe('a\rb');
    expect(normalizeFileText('a﻿b')).toBe('a﻿b');
  });
});
