import { createTree } from '@nx/devkit/testing';
import {
  BUG_REPORT_PATH,
  CODEOWNERS_PATH,
  FEATURE_REQUEST_PATH,
  PULL_REQUEST_TEMPLATE_PATH,
  runAddGithubTemplates,
} from './generator.ts';

type Locale = 'en' | 'ko';
const LOCALES: Locale[] = ['ko', 'en'];

/** What the generator would write into an empty workspace, read from its files/ templates. */
function rendered(options: { issue?: boolean; pr?: boolean; codeowners?: boolean; locale: Locale }) {
  return runAddGithubTemplates(createTree(), { issue: false, pr: false, codeowners: false, ...options, dryRun: true }).files.map(
    ({ filePath, content }) => ({ filePath, content }),
  );
}

function file(path: string, locale: Locale): string {
  return rendered({ issue: true, pr: true, codeowners: true, locale }).find((f) => f.filePath === path)!.content;
}

describe('the template set', () => {
  it('nothing when every flag is off', () => {
    expect(rendered({ locale: 'en' })).toEqual([]);
  });

  it('each flag adds only its own files', () => {
    expect(rendered({ issue: true, locale: 'en' }).map((f) => f.filePath)).toEqual([BUG_REPORT_PATH, FEATURE_REQUEST_PATH]);
    expect(rendered({ pr: true, locale: 'ko' }).map((f) => f.filePath)).toEqual([PULL_REQUEST_TEMPLATE_PATH]);
    expect(rendered({ codeowners: true, locale: 'en' }).map((f) => f.filePath)).toEqual([CODEOWNERS_PATH]);
  });

  it('all flags on: all four files, in a fixed order', () => {
    expect(rendered({ issue: true, pr: true, codeowners: true, locale: 'en' }).map((f) => f.filePath)).toEqual([
      BUG_REPORT_PATH,
      FEATURE_REQUEST_PATH,
      PULL_REQUEST_TEMPLATE_PATH,
      CODEOWNERS_PATH,
    ]);
  });

  it('every file differs between locales', () => {
    for (const path of [BUG_REPORT_PATH, FEATURE_REQUEST_PATH, PULL_REQUEST_TEMPLATE_PATH, CODEOWNERS_PATH]) {
      expect(file(path, 'ko')).not.toBe(file(path, 'en'));
    }
  });
});

describe('bug report form', () => {
  it.each(LOCALES)('%s: an Issue Forms document with a labels key and repro/expected/actual textareas', (locale) => {
    const content = file(BUG_REPORT_PATH, locale);
    expect(content).toMatch(/^name:/m);
    expect(content).toMatch(/^description:/m);
    expect(content).toMatch(/^labels:/m);
    expect(content).toMatch(/^body:/m);
    expect(content).toContain('id: reproduction');
    expect(content).toContain('id: expected');
    expect(content).toContain('id: actual');
    expect(content).toMatch(/type: textarea/g);
  });
});

describe('feature request form', () => {
  it.each(LOCALES)('%s: an Issue Forms document with problem/proposal textareas and no labels key', (locale) => {
    const content = file(FEATURE_REQUEST_PATH, locale);
    expect(content).toMatch(/^name:/m);
    expect(content).toMatch(/^description:/m);
    expect(content).toMatch(/^body:/m);
    expect(content).not.toMatch(/^labels:/m);
    expect(content).toContain('id: problem');
    expect(content).toContain('id: proposal');
  });
});

describe('pull request template', () => {
  it.each(LOCALES)('%s: summary, changes, and a test-plan checklist', (locale) => {
    const content = file(PULL_REQUEST_TEMPLATE_PATH, locale).toLowerCase();
    expect(content).toContain('- [ ]');
    expect(content).toMatch(locale === 'en' ? /summary/ : /요약/);
    expect(content).toMatch(locale === 'en' ? /changes/ : /변경/);
    expect(content).toMatch(locale === 'en' ? /test plan/ : /테스트 계획/);
  });
});

describe('CODEOWNERS', () => {
  it.each(LOCALES)('%s: a comment header and the placeholder owner line', (locale) => {
    const content = file(CODEOWNERS_PATH, locale);
    expect(content).toMatch(/^#/m);
    expect(content).toContain('* @your-team  # TODO: set real owners');
  });
});
