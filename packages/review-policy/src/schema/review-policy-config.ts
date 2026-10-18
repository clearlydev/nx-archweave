export type ReviewMode = 'fast' | 'standard' | 'thorough';
export type ReviewLocale = 'ko' | 'en';

/** Allowed automatic-review round caps per PR. Bounded so presets and users
 * cannot disable the anti-runaway guard entirely (default 3, range 1-5). */
export type ReviewMaxRounds = 1 | 2 | 3 | 4 | 5;
export const DEFAULT_MAX_ROUNDS: ReviewMaxRounds = 3;

export interface ReviewPolicyConfig {
  mode: ReviewMode;
  locale: ReviewLocale;
  /** Default 3; user-selectable within 1-5. Values outside the union do not compile. */
  maxRounds: ReviewMaxRounds;
  /** Fixed tuple — literal type so presets cannot soften which priorities block. */
  blockingPriorities: readonly ['P0', 'P1'];
}
