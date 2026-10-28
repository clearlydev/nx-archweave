import type { AgentRuleLocale, AgentRuleSection } from './agent-sections.ts';

/** The three role tags the frontend/backend deny rules use (toolkit.config.json
 * `boundaries.tags`, defaulting to scope:frontend / scope:backend / scope:shared). */
export interface ModuleBoundaryTags {
  frontend: string;
  backend: string;
  shared: string;
}

/** The Module Boundaries section, written with the workspace's own tag names so an agent
 * tags a new library with exactly what the ESLint deny rules check. */
export function buildModuleBoundariesSection(locale: AgentRuleLocale, tags: ModuleBoundaryTags): AgentRuleSection {
  const { frontend, backend, shared } = tags;
  if (locale === 'ko') {
    return {
      id: 'module-boundaries',
      heading: '모듈 경계',
      body: [
        '루트 ESLint 설정의 `@nx/enforce-module-boundaries` 규칙이 프로젝트 태그로 프론트엔드와 백엔드를 나눈다:',
        `- \`${frontend}\` 프로젝트는 \`${backend}\` 프로젝트를 import하지 않고, 그 반대도 마찬가지다.`,
        `- \`${shared}\` 프로젝트(shared-types 라이브러리 등)는 어느 쪽도 import하지 않는다.`,
        '- 이 태그가 하나도 없는 프로젝트는 규칙 밖에 있다. 라이브러리를 만들 때는 바로 자기 쪽 태그를 붙인다:',
        `  \`nx g @nx/js:lib libs/<name> --tags=${shared}\` (프론트엔드 전용이면 \`${frontend}\`, 백엔드 전용이면 \`${backend}\`).`,
        `import를 통과시키려고 태그를 지우거나 \`depConstraints\`를 느슨하게 하지 않는다. 함께 쓰는 코드는 \`${shared}\``,
        '라이브러리로 옮긴다.',
      ].join('\n'),
    };
  }
  return {
    id: 'module-boundaries',
    heading: 'Module Boundaries',
    body: [
      "The root ESLint config's `@nx/enforce-module-boundaries` rule keeps the frontend and the backend apart by project tag:",
      `- \`${frontend}\` projects never import \`${backend}\` projects, and the other way round.`,
      `- \`${shared}\` projects (such as the shared-types library) import neither side.`,
      '- A project with none of these tags is outside the rule. When you create a library, give it its side right away:',
      `  \`nx g @nx/js:lib libs/<name> --tags=${shared}\` (\`${frontend}\` or \`${backend}\` for code only one side uses).`,
      `Never remove a tag or loosen the \`depConstraints\` to make an import pass; move the shared code into a \`${shared}\``,
      'library instead.',
    ].join('\n'),
  };
}
