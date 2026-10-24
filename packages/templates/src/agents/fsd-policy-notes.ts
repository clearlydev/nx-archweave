import type { AgentRuleLocale } from './agent-sections.ts';

/** The parts of a workspace's FSD policy that change what an agent may write — the rule's
 * own options, mirrored structurally (templates owns text only and imports no policy code). */
export interface FsdPolicyNotes {
  sliceGroups: boolean;
  sharedPublicApi: 'segment' | 'component' | 'file';
  testFiles: boolean;
}

const NOTES: Record<AgentRuleLocale, { groups: string; component: string; file: string; tests: string; heading: string }> = {
  en: {
    heading: 'This workspace also configures:',
    groups:
      '- A folder that only groups slices (`features/mypage/{order,claims}`) holds no code and no `index.ts`; each slice in it is separate, and slices in one group never import each other either. Create one with `--group=<name>`.',
    component: '- `shared` exposes each component through its own `index.ts` (`shared/ui/button`); import that, not the files inside it.',
    file: '- Inside `shared`, files may be imported directly (`shared/lib/format/currency`); `shared` still never imports a layer above it.',
    tests: "- Test files (`*.spec.ts`, `*.test.ts`, `__tests__/`) may import another slice's internals; upward imports stay forbidden there too.",
  },
  ko: {
    heading: '이 워크스페이스는 다음도 설정했다:',
    groups:
      '- 슬라이스를 묶기만 하는 폴더(`features/mypage/{order,claims}`)에는 코드도 `index.ts`도 두지 않는다. 그 안의 슬라이스는 각각 독립이라, 같은 그룹 안에서도 서로 import하지 않는다. 그룹 안에 만들 때는 `--group=<이름>`을 쓴다.',
    component: '- `shared`는 컴포넌트마다 자기 `index.ts`로 공개한다(`shared/ui/button`). 그 index를 import하고, 안쪽 파일에는 닿지 않는다.',
    file: '- `shared` 안의 파일은 직접 import해도 된다(`shared/lib/format/currency`). 다만 `shared`는 여전히 위 레이어를 import하지 않는다.',
    tests: '- 테스트 파일(`*.spec.ts`, `*.test.ts`, `__tests__/`)은 다른 슬라이스의 내부 파일을 import해도 된다. 위 레이어 import는 테스트에서도 금지다.',
  },
};

/** Lines appended to the Frontend Structure section, one per configured option. */
export function buildFsdPolicyNotes(locale: AgentRuleLocale, notes: FsdPolicyNotes): string {
  const text = NOTES[locale];
  const lines = [
    ...(notes.sliceGroups ? [text.groups] : []),
    ...(notes.sharedPublicApi === 'component' ? [text.component] : notes.sharedPublicApi === 'file' ? [text.file] : []),
    ...(notes.testFiles ? [text.tests] : []),
  ];
  return lines.length === 0 ? '' : [text.heading, ...lines].join('\n');
}
