export type FsdLocale = 'ko' | 'en';

/** Mirrors `FsdEnforcement` in `@nx-archweave/shared` structurally (same precedent as
 * `FsdLocale` vs `ToolkitLocale`): templates owns text only and does not import shared. */
export type FsdSeverity = 'error' | 'warn';

/** The module a frontend app's eslint.config.mjs imports the rule from. Doctor and the
 * config applier both recognise an applied config by this specifier. */
export const FSD_ESLINT_MODULE = '@clearlydev/nx-archweave/eslint';

/** The import statement add-fsd-lite adds after the config's last import. */
export function buildFsdEslintImportLine(): string {
  return `import { fsdBoundaries } from '${FSD_ESLINT_MODULE}';`;
}

/** The flat-config entry add-fsd-lite adds as the last element of `export default [...]`.
 * `cwd: import.meta.dirname` anchors `root` to the config file, so the rule checks the same files
 * whichever directory ESLint runs from; `root` is the app's source root relative to that file. */
/** Framework facts the rule needs, written into the entry only when set. */
export interface FsdEslintFrameworkOptions {
  platformSuffixes?: string[];
  routerDirs?: string[];
}

export function buildFsdEslintEntry(severity: FsdSeverity, root = 'src', framework: FsdEslintFrameworkOptions = {}): string {
  const list = (key: string, values: string[] | undefined): string =>
    values === undefined || values.length === 0 ? '' : `, ${key}: [${values.map((value) => `'${value}'`).join(', ')}]`;
  return `...fsdBoundaries({ severity: '${severity}', cwd: import.meta.dirname, root: '${root}'${list('platformSuffixes', framework.platformSuffixes)}${list('routerDirs', framework.routerDirs)} }),`;
}

/** Paste-ready text for the non-write paths (no `--applyEslint`, or a config shape the
 * applier does not recognise). */
export function buildFsdEslintSnippet({ severity, locale, root, framework }: { severity: FsdSeverity; locale: FsdLocale; root?: string; framework?: FsdEslintFrameworkOptions }): string {
  const lines =
    locale === 'ko'
      ? [
          '// nx-archweave FSD 레이어 규칙 — 프론트엔드 앱의 eslint.config.mjs에 직접 넣으세요:',
          '// 1) 마지막 import 뒤에 아래 import를,',
          '// 2) 설정 배열(export default [...], 또는 export default 하는 변수의 배열)의 마지막 항목으로 아래 spread를 추가합니다.',
        ]
      : [
          "// nx-archweave FSD layer rules — add these to the frontend app's eslint.config.mjs yourself:",
          '// 1) the import after the last import,',
          '// 2) the spread as the last element of the config array (export default [...], or the array your config exports by name).',
        ];
  return [...lines, buildFsdEslintImportLine(), buildFsdEslintEntry(severity, root, framework)].join('\n');
}

const LAYER_GUIDE_EN: Record<string, string> = {
  app: 'composition root: providers, routing, global styles (the framework entry point lives here)',
  pages: 'one slice per screen, composed from the layers below',
  features: 'one slice per user-facing capability (add-to-cart, sign-in)',
  entities: 'one slice per business object (user, product)',
  shared: 'segments, not slices: ui, api, lib, model, config — named by purpose',
};

const LAYER_GUIDE_KO: Record<string, string> = {
  app: '조합 루트: providers, 라우팅, 전역 스타일 (프레임워크 진입점이 여기 있음)',
  pages: '화면 하나당 슬라이스 하나 — 아래 레이어들을 조합',
  features: '사용자 기능 하나당 슬라이스 하나 (add-to-cart, sign-in)',
  entities: '비즈니스 객체 하나당 슬라이스 하나 (user, product)',
  shared: '슬라이스가 아니라 세그먼트: ui, api, lib, model, config — 목적으로 이름 짓기',
};

/**
 * The layer guide add-fsd-lite prints instead of creating folders (canonical FSD: a layer
 * directory appears with its first slice). `layers` are the layer
 * ids in top-to-bottom order; `directories` the matching directory names (Next.js: `_pages`).
 */
export function buildFsdLayerGuide({
  layers,
  directories,
  sourceRoot,
  locale,
}: {
  layers: string[];
  directories: string[];
  sourceRoot: string;
  locale: FsdLocale;
}): string {
  const guide = locale === 'ko' ? LAYER_GUIDE_KO : LAYER_GUIDE_EN;
  const width = Math.max(...directories.map((d) => d.length));
  const rows = layers.map((layer, index) => `  ${sourceRoot}/${directories[index].padEnd(width)}  ${guide[layer] ?? ''}`);
  const footer =
    locale === 'ko'
      ? [
          '레이어 폴더는 첫 슬라이스가 생길 때 만들어집니다 (정식 FSD):',
          '  nx g @clearlydev/nx-archweave:feature --name=<name>   (page, entity, shared도 같은 방식; --segments=ui,api)',
          '  widgets/ 레이어는 기본 범위 밖이지만 nx g @clearlydev/nx-archweave:widget 으로 쓸 수 있습니다.',
          '위에서 아래로만 import할 수 있고, 같은 레이어의 슬라이스끼리는 import하지 않으며, 슬라이스는',
          'index.ts를 통해서만 import합니다 — archweave/fsd-boundaries ESLint 규칙이 위반을 알려 줍니다.',
        ]
      : [
          'Layer directories appear with their first slice (canonical FSD):',
          '  nx g @clearlydev/nx-archweave:feature --name=<name>   (page, entity and shared work the same way; --segments=ui,api)',
          '  widgets/ is outside the default scope but one command away: nx g @clearlydev/nx-archweave:widget',
          'Imports go downward only, slices on one layer never import each other, and a slice is',
          'imported through its index.ts — the archweave/fsd-boundaries ESLint rule reports violations.',
        ];
  return [...rows, ...footer].join('\n');
}
