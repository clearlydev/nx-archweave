/**
 * A file's text with the two differences that are not content removed: CRLF line endings
 * (Git for Windows checks text out as CRLF by default, `core.autocrlf=true`) and a leading
 * UTF-8 byte order mark (some editors add one on save). Use it to compare a file on disk with
 * what a generator would write; never to rewrite the file.
 */
export function normalizeFileText(text: string): string {
  return (text.startsWith('﻿') ? text.slice(1) : text).replace(/\r\n/g, '\n');
}

/** Whether two file texts hold the same content, ignoring CRLF and a leading BOM. */
export function sameFileText(a: string, b: string): boolean {
  return normalizeFileText(a) === normalizeFileText(b);
}
