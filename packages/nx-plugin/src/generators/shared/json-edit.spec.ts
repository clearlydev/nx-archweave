import { appendJsonArrayItem, applyJsonEdits, setJsonValue } from './json-edit.ts';

/** Lines of `after` that are not in `before`, plus lines of `before` that are gone. */
function changedLines(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  return [...b.filter((line) => !a.includes(line)), ...a.filter((line) => !b.includes(line)).map((line) => `- ${line}`)];
}

describe('appendJsonArrayItem', () => {
  it('adds a tag to an inline array on the same line (one changed line)', () => {
    const before = '{\n  "name": "web",\n  "tags": ["type:app"],\n  "targets": {}\n}\n';
    const after = appendJsonArrayItem(before, ['tags'], 'scope:frontend');
    expect(after).toBe('{\n  "name": "web",\n  "tags": ["type:app", "scope:frontend"],\n  "targets": {}\n}\n');
    expect(changedLines(before, after)).toEqual(['  "tags": ["type:app", "scope:frontend"],', '-   "tags": ["type:app"],']);
  });

  it('keeps the separator style of the array', () => {
    expect(appendJsonArrayItem('{"tags":["a","b"]}', ['tags'], 'c')).toBe('{"tags":["a","b","c"]}');
  });

  it('adds a line to a multi-line array, at its indentation', () => {
    const before = '{\n    "tags": [\n        "a"\n    ]\n}\n';
    expect(appendJsonArrayItem(before, ['tags'], 'b')).toBe('{\n    "tags": [\n        "a",\n        "b"\n    ]\n}\n');
  });

  it('fills an empty array', () => {
    expect(appendJsonArrayItem('{\n  "tags": []\n}\n', ['tags'], 'a')).toBe('{\n  "tags": ["a"]\n}\n');
  });

  it('creates the array, and its parent object, when missing', () => {
    const before = '{\n  "name": "web",\n  "version": "1.0.0"\n}\n';
    expect(appendJsonArrayItem(before, ['nx', 'tags'], 'scope:frontend')).toBe(
      '{\n  "name": "web",\n  "version": "1.0.0",\n  "nx": {\n    "tags": ["scope:frontend"]\n  }\n}\n',
    );
  });

  it('keeps CRLF line endings', () => {
    const before = '{\r\n  "name": "web"\r\n}\r\n';
    expect(appendJsonArrayItem(before, ['tags'], 'a')).toBe('{\r\n  "name": "web",\r\n  "tags": ["a"]\r\n}\r\n');
  });
});

describe('setJsonValue', () => {
  it('adds a key to a nested object without touching other lines', () => {
    const before = '{\n\t"compilerOptions": {\n\t\t"paths": {\n\t\t\t"@a/b": ["libs/b/src/index.ts"]\n\t\t}\n\t}\n}\n';
    expect(setJsonValue(before, ['compilerOptions', 'paths', '@acme/shared-types'], ['libs/shared-types/src/index.ts'])).toBe(
      '{\n\t"compilerOptions": {\n\t\t"paths": {\n\t\t\t"@a/b": ["libs/b/src/index.ts"],\n\t\t\t"@acme/shared-types": ["libs/shared-types/src/index.ts"]\n\t\t}\n\t}\n}\n',
    );
  });

  it('fills an empty object', () => {
    expect(setJsonValue('{\n  "targets": {}\n}\n', ['targets', 'fsd-check'], { command: 'steiger src' })).toBe(
      '{\n  "targets": {\n    "fsd-check": {\n      "command": "steiger src"\n    }\n  }\n}\n',
    );
  });

  it('replaces an existing value in place', () => {
    expect(setJsonValue('{\n  "backend": "express",\n  "x": 1\n}\n', ['backend'], 'nest')).toBe('{\n  "backend": "nest",\n  "x": 1\n}\n');
  });

  it('adds to a single-line object on that line', () => {
    expect(setJsonValue('{ "a": 1 }', ['b'], 2)).toBe('{ "a": 1, "b": 2 }');
  });
});

describe('applyJsonEdits', () => {
  it('builds a new file from the edits when there is none', () => {
    expect(applyJsonEdits(null, [[['locale'], 'en'], [['fsd', 'enforcement'], 'warn']])).toBe(
      '{\n  "locale": "en",\n  "fsd": {\n    "enforcement": "warn"\n  }\n}\n',
    );
  });

  it('edits an existing file key by key', () => {
    expect(applyJsonEdits('{\n    "preset": "solo"\n}', [[['preset'], 'team'], [['aiHosts'], ['codex']]])).toBe(
      '{\n    "preset": "team",\n    "aiHosts": ["codex"]\n}',
    );
  });
});
