import { FINDINGS_MARKER, ROUND_MARKER } from '@nx-archweave/template-engine';

/** Every combination of workflow kind and review comments the verdict bin is compared on across
 * releases: a release must not turn any case another one failed into a pass. The list is
 * deterministic, so a recorded outcome string lines up with it case by case. */

type Env = Record<string, string>;

export interface VerdictCase {
  name: string;
  env: Env;
  comments: unknown[];
}

/** The result of one run: red when the check fails (exit code, or blocked=true in output mode). */
export type Color = 'red' | 'green';

const BASE: Env = { GITHUB_REPOSITORY: 'o/r', ARCHWEAVE_PR_NUMBER: '7', ARCHWEAVE_MAX_ROUNDS: '3', ARCHWEAVE_LOCALE: 'en' };
const OUTPUT: Env = { ...BASE, ARCHWEAVE_VERDICT_OUTPUT: 'github-output', GITHUB_OUTPUT: '/runner/output' };
const BOUND = { ARCHWEAVE_ROUND_AFTER_ID: '60', ARCHWEAVE_HEAD_SHA: 'abcdef1234567' };

const ENVS: readonly [string, Env][] = [
  ['default mode', BASE],
  ['default mode with a watermark', { ...BASE, ...BOUND }],
  ['output mode', { ...OUTPUT, ...BOUND }],
  ['output mode, claude account', { ...OUTPUT, ...BOUND, ARCHWEAVE_REVIEW_AUTHOR: 'claude[bot]', ARCHWEAVE_WORKFLOW_CONTRACT: '3' }],
  ['output mode, workflow token account', { ...OUTPUT, ...BOUND, ARCHWEAVE_REVIEW_AUTHOR: 'github-actions[bot]', ARCHWEAVE_WORKFLOW_CONTRACT: '3' }],
];

const finding = (priority: string) => ({
  priority,
  category: 'c',
  title: 't',
  file: 'f.ts',
  lineRange: { start: 1 },
  evidence: '',
  impact: '',
  reproductionCondition: '',
  recommendation: '',
  confidence: 'confirmed',
});
const block = (priorities: string[]) =>
  `${FINDINGS_MARKER}\n\`\`\`json\n${JSON.stringify({ schema: 'archweave/findings@1', findings: priorities.map(finding) })}\n\`\`\``;

const BODIES: readonly [string, string][] = [
  ['approve', block([])],
  ['block', block(['P1'])],
  ['changes', block(['P2'])],
  ['unreadable', 'no findings block'],
  ['block then approve', `${block(['P1'])}\n${block([])}`],
  ['approve then block', `${block([])}\n${block(['P1'])}`],
];
const AUTHORS = ['claude[bot]', 'github-actions[bot]', 'other-app[bot]'];

const comment = (id: number, body: string, login: string) => ({ id, user: { login, type: 'Bot' }, body: `${ROUND_MARKER}\nSummary.\n${body}` });

type RoundSpec = [bodyIndex: number, authorIndex: number];

const ROUND_SPECS: RoundSpec[] = BODIES.flatMap((_, b) => AUTHORS.map((_, a): RoundSpec => [b, a]));
const BEFORE: (RoundSpec | undefined)[] = [undefined, [0, 0], [1, 0], [1, 2]];
const AFTER: RoundSpec[][] = [[], ...ROUND_SPECS.map((r) => [r]), ...ROUND_SPECS.flatMap((r1) => ROUND_SPECS.map((r2) => [r1, r2]))];

const label = ([b, a]: RoundSpec) => `${BODIES[b][0]} by ${AUTHORS[a]}`;

export function buildVerdictCases(): VerdictCase[] {
  const cases: VerdictCase[] = [];
  for (const [envName, env] of ENVS) {
    for (const before of BEFORE) {
      for (const after of AFTER) {
        const comments = [
          ...(before === undefined ? [] : [comment(50, BODIES[before[0]][1], AUTHORS[before[1]])]),
          ...after.map((spec, index) => comment(70 + index * 10, BODIES[spec[0]][1], AUTHORS[spec[1]])),
        ];
        const name = `${envName}: before [${before === undefined ? '' : label(before)}], after [${after.map(label).join(', ')}]`;
        cases.push({ name, env, comments });
      }
    }
  }
  return cases;
}

type Bin = (
  env: Record<string, string | undefined>,
  exec: (command: string, args: string[], stdin?: string) => { status: number | null; stdout: string },
  writeOutput: (path: string, text: string) => void,
) => { exitCode: number };

export function colorOf(runBin: Bin, verdictCase: VerdictCase): Color {
  const written: string[] = [];
  const exec = (_command: string, args: string[]) =>
    args.includes('--paginate') ? { status: 0, stdout: JSON.stringify(verdictCase.comments) } : { status: 0, stdout: '' };
  const { exitCode } = runBin(verdictCase.env, exec, (_path, text) => written.push(text));
  return exitCode !== 0 || /^blocked=true$/m.test(written.join('')) ? 'red' : 'green';
}

/** One character per case, in buildVerdictCases order: r red, g green. */
export function encodeColors(colors: readonly Color[]): string {
  return colors.map((color) => (color === 'red' ? 'r' : 'g')).join('');
}
