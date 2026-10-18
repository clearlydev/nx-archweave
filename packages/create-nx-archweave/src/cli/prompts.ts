import {
  AI_HOST_CHOICES,
  BACKEND_VALUES,
  DEFAULT_AI_HOSTS,
  FRONTEND_VALUES,
  LOCALE_VALUES,
  PRESET_VALUES,
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
  /** Still undefined when nothing (flag or question) ever set it — solo/team never
   * ask, so this stays undefined unless the flag overrode it, and the init
   * generator's own preset default applies (no policy knowledge here). */
  review: boolean | undefined;
  /** Picked in the review-provider question; undefined when not passed and not picked (Enter
   * or no question) — init then uses the first AI host's provider. */
  reviewProvider: CliReviewProvider | undefined;
}

async function askChoice<T extends string>(ask: Ask, question: string, choices: readonly T[]): Promise<T> {
  for (;;) {
    const answer = (await ask(question)).trim();
    if ((choices as readonly string[]).includes(answer)) return answer as T;
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
 *  - preset: asked if missing.
 *  - frontend: asked if missing, for every preset; `none` makes a backend-only workspace,
 *    so a backend is then required (and `none` is not offered when the backend is none).
 *  - backend: asked if missing, for every preset — the stack choice is never
 *    minimized away.
 *  - locale: quick-start forces 'en' with NO question (keep later questions minimal);
 *    solo/team ask if missing.
 *  - aiHosts: asked if missing, for every preset, as a numbered multi-select;
 *    never without a terminal (the default host then).
 *  - review: asked with a single yes/no ONLY when the resolved preset is quick-start
 *    (the opt-in preset, which asks a single install-or-not question) AND no
 *    --review/--no-review flag was given.
 *    solo/team never ask — an explicit flag still overrides their preset default,
 *    but absent one, `review` stays undefined for the init generator to default.
 *
 * NOTE: "quick-start is the only preset that asks about review" is this CLI's own rule,
 * but it mirrors what
 * `packages/template-engine/src/presets/preset-config.ts` encodes (quick-start is
 * opt-in, solo/team default review on) without importing it — the CLI must not
 * depend on template-engine. Like `types.ts`'s enum copies,
 * this is a deliberate hand-synced literal: if a preset's review default ever
 * changes there, update this question gate to match.
 */
export async function collectMissingInputs(input: PromptInput, ask: Ask): Promise<PromptResult> {
  const preset = input.preset ?? (await askChoice(ask, `Preset (${PRESET_VALUES.join('/')}): `, PRESET_VALUES));
  // none/none would build nothing: whichever is asked second leaves `none` out when the
  // other is already none (both passed as flags is refused by parse-args).
  const frontendChoices = input.backend === 'none' ? FRONTEND_VALUES.filter((value) => value !== 'none') : FRONTEND_VALUES;
  const frontend =
    input.frontend ?? (await askChoice(ask, `Frontend (${frontendChoices.join('/')}): `, frontendChoices));

  const backendChoices = frontend === 'none' ? BACKEND_VALUES.filter((value) => value !== 'none') : BACKEND_VALUES;
  const backend =
    input.backend ?? (await askChoice(ask, `Backend (${backendChoices.join('/')}): `, backendChoices));

  const locale =
    preset === 'quick-start'
      ? input.locale ?? 'en'
      : input.locale ?? (await askChoice(ask, `Locale (${LOCALE_VALUES.join('/')}): `, LOCALE_VALUES));

  // Asked for every preset: the hosts decide which files the workspace gets.
  const aiHosts = input.aiHosts ?? (input.interactive ? await askAiHosts(ask, input.installedHosts) : [...DEFAULT_AI_HOSTS]);

  let review = input.review;
  if (review === undefined && preset === 'quick-start') {
    const answer = await ask('Enable AI PR review? (y/N): ');
    review = parseYesNo(answer);
  }

  // The provider is asked only when review will be on: an explicit yes, or solo/team's own
  // default (the same hand-synced rule as the question above). Enter keeps init's default.
  let reviewProvider = input.reviewProvider;
  if (reviewProvider === undefined && reviewWillBeOn(preset, review) && input.interactive) {
    reviewProvider = await askReviewProvider(ask, aiHosts[0]);
  }

  return { preset, frontend, backend, locale, aiHosts, review, reviewProvider };
}

/** Whether init will set up AI PR review: an explicit --review / --no-review, else every preset
 * but quick-start (hand-synced with template-engine's preset defaults, like the question). */
export function reviewWillBeOn(preset: CliPreset, review: boolean | undefined): boolean {
  return review ?? preset !== 'quick-start';
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
  return '--review-provider needs AI PR review on, and the quick-start preset leaves it off: add --review, or drop --review-provider.';
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
