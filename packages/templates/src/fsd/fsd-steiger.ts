import type { FsdLocale } from './fsd-eslint.ts';

/** The official FSD linter and its rule set, pinned to the versions measured on 2026-10-16.
 * steiger needs Node ≥ 22.18. */
export const STEIGER_DEPENDENCIES: Readonly<Record<string, string>> = {
  steiger: '^0.7.0',
  '@feature-sliced/steiger-plugin': '^0.8.0',
};

/** Where the config goes: the frontend app's root (steiger looks it up from its cwd). */
export const STEIGER_CONFIG_FILE = 'steiger.config.mjs';

/** The Nx target add-fsd-lite --steiger adds to the frontend app. */
export const FSD_CHECK_TARGET = 'fsd-check';

/** The target's run-commands shape: steiger from the app root, over its source root. */
export function buildFsdCheckTarget(sourceRootName = 'src'): { command: string; options: { cwd: string } } {
  return { command: `steiger ${sourceRootName}`, options: { cwd: '{projectRoot}' } };
}

/**
 * steiger's recommended rule set with two adjustments for a workspace the generators
 * scaffold (both measured 2026-10-16):
 * - `insignificant-slice` reports a slice nothing references yet — every freshly generated
 *   slice — so it stays visible as a warning instead of failing the check;
 * - a framework whose router owns a layer's name renames that layer (`_pages` on Next.js,
 *   `_app` with Expo Router — FSD's own naming), which steiger 0.7 still flags as a typo, so
 *   that rule is off wherever `renamedLayerDirs` is not empty.
 */
export function buildSteigerConfig({ renamedLayerDirs, locale }: { renamedLayerDirs: string[]; locale: FsdLocale }): string {
  const ko = locale === 'ko';
  const lines = [
    "import { defineConfig } from 'steiger';",
    "import fsd from '@feature-sliced/steiger-plugin';",
    '',
    ko
      ? '// nx-archweave: 정식 FSD 규칙 전체(recommended). 구조는 generator가 정식대로 만들므로 그대로 맞물립니다.'
      : '// nx-archweave: the canonical rule set (recommended). The generators scaffold canonical FSD, so it fits as is.',
    'export default defineConfig([',
    '  ...fsd.configs.recommended,',
    '  {',
    '    rules: {',
    ko
      ? '      // 아무도 참조하지 않는 슬라이스 = 방금 생성한 슬라이스. 경고로 보이되 검사를 막지 않습니다.'
      : '      // a slice nothing references yet is every freshly generated slice: visible, not blocking',
    "      'fsd/insignificant-slice': 'warn',",
    ...(renamedLayerDirs.length > 0
      ? [
          ko
            ? `      // ${renamedLayerDirs.join(', ')}: 프레임워크 라우터와 겹치지 않게 이름을 바꾼 레이어 (FSD 공식 명명) — steiger 0.7은 아직 오타로 봅니다.`
            : `      // ${renamedLayerDirs.join(', ')}: layers renamed out of the framework router's way (FSD's own naming) — steiger 0.7 still reads them as typos`,
          "      'fsd/typo-in-layer-name': 'off',",
        ]
      : []),
    '    },',
    '  },',
    ']);',
    '',
  ];
  return lines.join('\n');
}
