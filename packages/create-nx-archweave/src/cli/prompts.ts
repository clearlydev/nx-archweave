import {
  AI_HOST_CHOICES,
  DEFAULT_AI_HOSTS,
  resolvePresetAlias,
  REVIEW_PROVIDER_CHOICES,
  type CliAiHost,
  type CliReviewProvider,
  type CliBackend,
  type CliFrontend,
  type CliLocale,
  type CliPreset,
} from './types.ts';
import type { InstalledHosts } from './host-probe.ts';

/** Injected I/O — the real entry point wires this to
 * `readline/promises`' `question`; tests supply a scripted queue of answers instead. */
export type Ask = (question: string) => Promise<string>;

export interface PromptInput {
  preset: CliPreset | undefined;
  frontend: CliFrontend | undefined;
  backend: CliBackend | undefined;
  locale: CliLocale | undefined;
  /** `--ai-hosts`, when passed. */
  aiHosts: CliAiHost[] | undefined;
  /** What the host probes found, shown next to each host in the question; undefined when
   * nothing was probed (no status column then). Every host stays selectable either way —
   * the rules files help teammates who use a host this machine lacks. */
  installedHosts?: InstalledHosts;
  /** Explicit --review/--no-review override, if any was passed on the command line. */
  review: boolean | undefined;
  /** `--review-provider`, when passed. */
  reviewProvider?: CliReviewProvider;
  /** stdin is a TTY. Without one the AI hosts are never asked — CI and agents get the
   * default host instead of a failed run. */
  interactive: boolean;
}

export interface PromptResult {
  preset: CliPreset;
  frontend: CliFrontend;
  /** Always resolved — the stack choice is the product's reason to exist, so every
   * preset asks it when the flag is absent; quick-start's
   * question-minimization does not cover it. */
  backend: CliBackend;
  locale: CliLocale;
  /** Multi-select, in the order picked (the first one sets the review provider default). */
  aiHosts: CliAiHost[];
  /** false for quick-start and solo unless asked for (flag or question). Undefined only for
   * team without a flag: the init generator's own preset default applies there. */
  review: boolean | undefined;
  /** Picked in the review-provider question; undefined when not passed and not picked (Enter
   * or no question) — init then uses the first AI host's provider. */
  reviewProvider: CliReviewProvider | undefined;
}

/** One line of a numbered question: the value and what picking it means. */
export interface ChoiceOption<T extends string> {
  value: T;
  description: string;
}

export const PRESET_OPTIONS: readonly ChoiceOption<CliPreset>[] = [
  { value: 'quick-start', description: 'trying it out, or your own project; AI review if you ask' },
  { value: 'team', description: 'a shared repo: stricter FSD rule, issue templates, AI review' },
];
export const FRONTEND_OPTIONS: readonly ChoiceOption<CliFrontend>[] = [
  { value: 'react-vite', description: 'a React app built with Vite, in apps/web' },
  { value: 'next', description: 'a Next.js app, in apps/web' },
  { value: 'none', description: 'no frontend: a backend-only workspace' },
];
export const BACKEND_OPTIONS: readonly ChoiceOption<CliBackend>[] = [
  { value: 'none', description: 'no backend' },
  { value: 'express', description: 'Express API in apps/api, shared types, enforced boundaries' },
  { value: 'nest', description: 'NestJS API in apps/api, shared types, enforced boundaries' },
];
export const LOCALE_OPTIONS: readonly ChoiceOption<CliLocale>[] = [
  { value: 'en', description: 'English' },
  { value: 'ko', description: 'Korean' },
];

export const INVALID_CHOICE_HINT = 'Type a number or a name from the list.';

/** A numbered question in the same shape as the AI-tool and package-manager ones:
 * `? <title>`, one `n) value  description` line per option, then `Choose 1-n [default]: `.
 * Without a default (`fallback` undefined) Enter is not an answer. */
export function choiceQuestion<T extends string>(title: string, options: readonly ChoiceOption<T>[], fallback: T | undefined): string {
  const width = Math.max(...options.map((option) => option.value.length)) + 2;
  const defaultIndex = options.findIndex((option) => option.value === fallback);
  return [
    `? ${title}`,
    ...options.map((option, index) => `  ${index + 1}) ${option.value.padEnd(width)}${option.description}`),
    `Choose 1-${options.length}${defaultIndex === -1 ? '' : ` [${defaultIndex + 1}]`}: `,
  ].join('\n');
}

/** The number, the name (any case), or Enter for `fallback`. Undefined for anything else.
 * `aliases` maps a name the list doesn't show to the value it stands for. */
export function parseChoiceAnswer<T extends string>(
  answer: string,
  options: readonly ChoiceOption<T>[],
  fallback: T | undefined,
  aliases: Readonly<Record<string, T>> = {},
): T | undefined {
  const token = answer.trim().toLowerCase();
  if (token === '') return fallback;
  if (/^\d+$/.test(token)) return options[Number(token) - 1]?.value;
  return options.find((option) => option.value === token)?.value ?? aliases[token];
}

/** Asks until the answer is one of `options`; after a wrong answer the question comes back
 * with one line saying what to type. */
async function askNumberedChoice<T extends string>(
  ask: Ask,
  title: string,
  options: readonly ChoiceOption<T>[],
  fallback: T | undefined,
  aliases?: Readonly<Record<string, T>>,
): Promise<T> {
  const question = choiceQuestion(title, options, fallback);
  for (let wrong = false; ; wrong = true) {
    const picked = parseChoiceAnswer(await ask(wrong ? `${INVALID_CHOICE_HINT}\n${question}` : question), options, fallback, aliases);
    if (picked !== undefined) return picked;
  }
}

function parseYesNo(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

/** `1,3`, `1 3`, `codex,cursor` or a mix; empty means the default. Undefined for anything
 * that is not a listed number or id — the question is asked again. */
export function parseAiHostAnswer(answer: string): CliAiHost[] | undefined {
  const tokens = answer.split(/[\s,]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return [...DEFAULT_AI_HOSTS];
  const picked: CliAiHost[] = [];
  for (const token of tokens) {
    const byNumber = /^\d+$/.test(token) ? AI_HOST_CHOICES[Number(token) - 1] : undefined;
    const host = byNumber ?? AI_HOST_CHOICES.find((choice) => choice.id === token.toLowerCase());
    if (!host) return undefined;
    if (!picked.includes(host.id)) picked.push(host.id);
  }
  return picked;
}

/** `installed 2.1.300` / `not found`, or nothing when the hosts were not probed. */
export function hostStatus(host: CliAiHost, installed: InstalledHosts | undefined): string {
  if (installed === undefined) return '';
  const version = installed[host];
  if (version === undefined) return 'not found';
  return version.length > 0 ? `installed ${version}` : 'installed';
}

export function aiHostsQuestion(installed?: InstalledHosts): string {
  const width = Math.max(...AI_HOST_CHOICES.map((host) => host.label.length)) + 2;
  return [
    '? AI coding tools you use (choose one or more)',
    ...AI_HOST_CHOICES.map((host, index) => {
      const status = hostStatus(host.id, installed);
      return `  ${index + 1}) ${status ? host.label.padEnd(width) + status : host.label}`;
    }),
    `Choose, e.g. 1,3 [1]: `,
  ].join('\n');
}

async function askAiHosts(ask: Ask, installed: InstalledHosts | undefined): Promise<CliAiHost[]> {
  const question = aiHostsQuestion(installed);
  for (;;) {
    const picked = parseAiHostAnswer(await ask(question));
    if (picked) return picked;
  }
}

/**
 * Only asks about whatever `input` doesn't already have (flags always win; only the
 * gaps become interactive questions):
 *  - preset: asked if missing, offering quick-start and team; `solo` (flag or answer) is
 *    an alias of quick-start and comes back as quick-start.
 *  - frontend: asked if missing, for every preset; `none` makes a backend-only workspace,
 *    so a backend is then required (and `none` is not offered when the backend is none).
 *  - backend: asked if missing, for every preset — the stack choice is never
 *    minimized away.
 *  - locale: asked if missing (Enter means en); quick-start without a terminal takes en.
 *  - preset, frontend, backend and locale are numbered questions with a default for Enter:
 *    quick-start, react-vite, none (none only when there is a frontend) and en.
 *  - aiHosts: asked if missing, for every preset, as a numbered multi-select;
 *    never without a terminal (the default host then).
 *  - review: asked with a single yes/no (default no) ONLY when the resolved preset is
 *    quick-start, no --review/--no-review flag was given, and there is a terminal.
 *    AI review needs a provider API key and a repository secret, so this CLI leaves it
 *    off unless asked: quick-start without an answer passes `--review=false` to init. team keeps init's own default (on): `review` stays
 *    undefined. add-review adds it to any workspace later.
 *
 * NOTE: this matches the init generator's own preset defaults
 * (`packages/template-engine/src/presets/preset-config.ts`: quick-start and its alias solo
 * off, team on). The CLI must not depend on template-engine, so `reviewWillBeOn` below is a
 * deliberate hand-synced copy of that rule.
 */
export async function collectMissingInputs(input: PromptInput, ask: Ask): Promise<PromptResult> {
  const preset = resolvePresetAlias(
    input.preset ?? (await askNumberedChoice(ask, 'Preset', PRESET_OPTIONS, 'quick-start', { solo: 'quick-start' })),
  );
  // none/none would build nothing: whichever is asked second leaves `none` out when the
  // other is already none (both passed as flags is refused by parse-args). The backend
  // question then has no default: Enter would mean the none that was left out.
  const frontendOptions = input.backend === 'none' ? FRONTEND_OPTIONS.filter((option) => option.value !== 'none') : FRONTEND_OPTIONS;
  const frontend = input.frontend ?? (await askNumberedChoice(ask, 'Frontend', frontendOptions, 'react-vite'));

  const backendOptions = frontend === 'none' ? BACKEND_OPTIONS.filter((option) => option.value !== 'none') : BACKEND_OPTIONS;
  const backend = input.backend ?? (await askNumberedChoice(ask, 'Backend', backendOptions, frontend === 'none' ? undefined : 'none'));

  // quick-start without a terminal takes en; team without one fails like any missing input.
  const locale =
    input.locale ??
    (preset === 'quick-start' && !input.interactive ? 'en' : await askNumberedChoice(ask, 'Language of the generated content', LOCALE_OPTIONS, 'en'));

  // Asked for every preset: the hosts decide which files the workspace gets.
  const aiHosts = input.aiHosts ?? (input.interactive ? await askAiHosts(ask, input.installedHosts) : [...DEFAULT_AI_HOSTS]);

  let review = input.review;
  if (review === undefined && preset === 'quick-start' && input.interactive) {
    const answer = await ask('Enable AI PR review? (y/N): ');
    review = parseYesNo(answer);
  }
  // Off unless asked for; team keeps init's default (see the note above).
  if (review === undefined && preset !== 'team') review = false;

  // The provider is asked only when review will be on: an explicit yes, or team's own
  // default (the same hand-synced rule as the question above). Enter keeps init's default.
  let reviewProvider = input.reviewProvider;
  if (reviewProvider === undefined && reviewWillBeOn(preset, review) && input.interactive) {
    reviewProvider = await askReviewProvider(ask, aiHosts[0]);
  }

  return { preset, frontend, backend, locale, aiHosts, review, reviewProvider };
}

/** Whether init will set up AI PR review: an explicit --review / --no-review, else only for
 * team (see collectMissingInputs). */
export function reviewWillBeOn(preset: CliPreset, review: boolean | undefined): boolean {
  return review ?? preset === 'team';
}

/** `--review-provider` with review off is refused rather than dropped without a word. Undefined
 * when there is nothing to refuse (no flag, or review on). */
export function reviewProviderConflict(
  preset: CliPreset | undefined,
  review: boolean | undefined,
  reviewProvider: CliReviewProvider | undefined,
): string | undefined {
  if (reviewProvider === undefined) return undefined;
  if (review === false) return '--review-provider needs AI PR review on, but --no-review was passed (or review was declined): drop one of them.';
  if (preset === undefined || reviewWillBeOn(preset, review)) return undefined;
  return `--review-provider needs AI PR review on, and the ${preset} preset leaves it off: add --review, or drop --review-provider.`;
}

export function reviewProviderQuestion(firstHost: CliAiHost): string {
  const host = AI_HOST_CHOICES.find((choice) => choice.id === firstHost);
  const defaultIndex = REVIEW_PROVIDER_CHOICES.findIndex((provider) => provider.id === host?.reviewProvider);
  return [
    '? AI PR review provider',
    ...REVIEW_PROVIDER_CHOICES.map(
      (provider, index) => `  ${index + 1}) ${provider.label}${index === defaultIndex ? `  (default — ${host?.label})` : ''}`,
    ),
    `Choose 1-${REVIEW_PROVIDER_CHOICES.length} [${defaultIndex + 1}]: `,
  ].join('\n');
}

/** A number or an id; empty → undefined (init's default). Anything else is asked again. */
export function parseReviewProviderAnswer(answer: string): CliReviewProvider | undefined | null {
  const token = answer.trim().toLowerCase();
  if (token === '') return undefined;
  const byNumber = /^\d+$/.test(token) ? REVIEW_PROVIDER_CHOICES[Number(token) - 1] : undefined;
  const provider = byNumber ?? REVIEW_PROVIDER_CHOICES.find((choice) => choice.id === token);
  return provider ? provider.id : null;
}

async function askReviewProvider(ask: Ask, firstHost: CliAiHost): Promise<CliReviewProvider | undefined> {
  const question = reviewProviderQuestion(firstHost);
  for (;;) {
    const picked = parseReviewProviderAnswer(await ask(question));
    if (picked !== null) return picked;
  }
}
