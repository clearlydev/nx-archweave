import {
  aiHostsQuestion,
  collectMissingInputs,
  parseAiHostAnswer,
  parseReviewProviderAnswer,
  reviewProviderConflict,
  reviewProviderQuestion,
  type Ask,
  type PromptInput,
} from './prompts.ts';

function scriptedAsk(answers: string[]): { ask: Ask; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const ask: Ask = async (question) => {
    calls.push(question);
    const answer = answers[index];
    index += 1;
    return answer ?? '';
  };
  return { ask, calls };
}

// interactive: false keeps the AI-host question out of the existing scripts (non-TTY → the default host).
const allMissing: PromptInput = { preset: undefined, frontend: undefined, backend: undefined, locale: undefined, aiHosts: undefined, review: undefined, interactive: false };

describe('collectMissingInputs', () => {
  it('asks nothing when every input is already provided', async () => {
    const { ask, calls } = scriptedAsk([]);
    const result = await collectMissingInputs(
      { preset: 'solo', frontend: 'next', backend: 'nest', locale: 'ko', aiHosts: ['codex'], review: true, reviewProvider: 'gemini', interactive: true },
      ask,
    );

    expect(calls).toEqual([]);
    // solo is an alias: it comes back as quick-start
    expect(result).toEqual({ preset: 'quick-start', frontend: 'next', backend: 'nest', locale: 'ko', aiHosts: ['codex'], review: true, reviewProvider: 'gemini' });
  });

  it('quick-start: asks frontend, backend, the locale (Enter means en) and review', async () => {
    const { ask, calls } = scriptedAsk(['react-vite', 'none', '', 'y', '']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'quick-start', aiHosts: ['claude-code'], interactive: true }, ask);

    expect(calls).toEqual([
      'Frontend (react-vite/next/none): ',
      'Backend (express/nest/none): ',
      'Locale (en/ko) [en]: ',
      'Enable AI PR review? (y/N): ',
      reviewProviderQuestion('claude-code'),
    ]);
    expect(result).toEqual({ preset: 'quick-start', frontend: 'react-vite', backend: 'none', locale: 'en', aiHosts: ['claude-code'], review: true });
  });

  it('quick-start: treats any non-yes answer to the review question as false', async () => {
    const interactive = { ...allMissing, preset: 'quick-start' as const, aiHosts: ['claude-code' as const], interactive: true };
    const { ask } = scriptedAsk(['next', 'none', '', 'n']);
    const result = await collectMissingInputs(interactive, ask);
    expect(result.review).toBe(false);

    const { ask: ask2 } = scriptedAsk(['next', 'none', '', '']);
    const result2 = await collectMissingInputs(interactive, ask2);
    expect(result2.review).toBe(false);
  });

  it('quick-start without a terminal: no review question, review off', async () => {
    const { ask, calls } = scriptedAsk(['next', 'none']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'quick-start' }, ask);
    expect(calls).toEqual(['Frontend (react-vite/next/none): ', 'Backend (express/nest/none): ']);
    expect(result.review).toBe(false);
  });

  it('quick-start: does not ask about review when --review/--no-review was already given', async () => {
    const { ask, calls } = scriptedAsk(['react-vite', 'express']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'quick-start', review: false }, ask);

    expect(calls).toEqual(['Frontend (react-vite/next/none): ', 'Backend (express/nest/none): ']);
    expect(result.review).toBe(false);
  });

  it('quick-start: the locale question takes ko, and asks again on anything else', async () => {
    const { ask, calls } = scriptedAsk(['next', 'none', 'fr', 'ko', 'n']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'quick-start', aiHosts: ['claude-code'], interactive: true }, ask);
    expect(calls.filter((q) => q.startsWith('Locale'))).toHaveLength(2);
    expect(result.locale).toBe('ko');
  });

  it('solo, an alias, comes back as quick-start with its questions: no terminal means en and review off', async () => {
    const { ask, calls } = scriptedAsk(['react-vite', 'nest']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'solo' }, ask);

    expect(calls).toEqual(['Frontend (react-vite/next/none): ', 'Backend (express/nest/none): ']);
    expect(result).toEqual({ preset: 'quick-start', frontend: 'react-vite', backend: 'nest', locale: 'en', aiHosts: ['claude-code'], review: false });
  });

  it('solo with a terminal asks the review question like quick-start', async () => {
    const { ask, calls } = scriptedAsk(['n']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'solo', frontend: 'next', backend: 'none', locale: 'en', aiHosts: ['codex'], interactive: true }, ask);
    expect(calls).toEqual(['Enable AI PR review? (y/N): ']);
    expect(result).toMatchObject({ preset: 'quick-start', review: false });
  });

  it('team: asks frontend and locale, but never asks about review', async () => {
    const { ask, calls } = scriptedAsk(['next', 'none', 'en']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'team' }, ask);

    expect(calls).toEqual(['Frontend (react-vite/next/none): ', 'Backend (express/nest/none): ', 'Locale (ko/en): ']);
    expect(result.review).toBeUndefined();
  });

  it('solo/team: an explicit --review flag is preserved even though it is never asked', async () => {
    const { ask } = scriptedAsk(['react-vite', 'none', 'en']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'team', review: true }, ask);
    expect(result.review).toBe(true);
  });

  it('asks for preset first when it is missing, then proceeds through the rest of the flow', async () => {
    const { ask, calls } = scriptedAsk(['quick-start', 'react-vite', 'none', 'y']);
    const result = await collectMissingInputs(allMissing, ask);

    expect(calls[0]).toBe('Preset (quick-start/team): ');
    expect(result.preset).toBe('quick-start');
  });

  it('the preset question does not offer solo, but an answer of solo is taken as quick-start', async () => {
    const { ask } = scriptedAsk(['solo', 'react-vite', 'none']);
    expect((await collectMissingInputs(allMissing, ask)).preset).toBe('quick-start');
  });

  it('re-asks a choice question until a valid answer is given', async () => {
    const { ask, calls } = scriptedAsk(['not-a-preset', 'still-invalid', 'team', 'react-vite', 'none', 'ko']);
    const result = await collectMissingInputs(allMissing, ask);

    expect(calls.filter((q) => q.startsWith('Preset'))).toHaveLength(3);
    expect(result.preset).toBe('team');
  });

  it('asks backend for every preset when the flag is absent, right after frontend', async () => {
    for (const preset of ['quick-start', 'solo', 'team'] as const) {
      const answers = preset === 'quick-start' ? ['react-vite', 'none', 'n'] : ['react-vite', 'none', 'en'];
      const { ask, calls } = scriptedAsk(answers);
      const result = await collectMissingInputs({ ...allMissing, preset }, ask);
      expect(calls[1]).toBe('Backend (express/nest/none): ');
      expect(result.backend).toBe('none');
    }
  });

  it('never asks backend when --backend was given', async () => {
    const { ask, calls } = scriptedAsk(['en']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'team', frontend: 'next', backend: 'nest' }, ask);
    expect(calls).toEqual(['Locale (ko/en): ']);
    expect(result.backend).toBe('nest');
  });
});

describe('collectMissingInputs — AI hosts', () => {
  it('interactive: asks a numbered multi-select after locale, for every preset (quick-start included)', async () => {
    const { ask, calls } = scriptedAsk(['react-vite', 'none', '', '1,3', 'n']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'quick-start', interactive: true }, ask);
    expect(calls[2]).toBe('Locale (en/ko) [en]: ');
    expect(calls[3]).toBe(
      '? AI coding tools you use (choose one or more)\n  1) Claude Code\n  2) Codex\n  3) Cursor\n  4) Gemini CLI\nChoose, e.g. 1,3 [1]: ',
    );
    expect(calls[4]).toBe('Enable AI PR review? (y/N): ');
    expect(result.aiHosts).toEqual(['claude-code', 'cursor']);
  });

  it('interactive: Enter takes the default host; a wrong answer asks again', async () => {
    const { ask, calls } = scriptedAsk(['', 'x,9', 'gemini-cli']);
    const hostsOnly = { ...allMissing, preset: 'solo', frontend: 'next', backend: 'none', locale: 'en', review: false, interactive: true } as const;
    const first = await collectMissingInputs(hostsOnly, ask);
    expect(first.aiHosts).toEqual(['claude-code']);
    const second = await collectMissingInputs(hostsOnly, ask);
    expect(second.aiHosts).toEqual(['gemini-cli']);
    expect(calls).toHaveLength(3);
  });

  it('non-interactive: never asks, takes the default host — CI and agents keep working without --ai-hosts', async () => {
    const { ask, calls } = scriptedAsk([]);
    const result = await collectMissingInputs({ ...allMissing, preset: 'solo', frontend: 'next', backend: 'none', locale: 'en' }, ask);
    expect(calls).toEqual([]);
    expect(result.aiHosts).toEqual(['claude-code']);
  });
});

describe('parseAiHostAnswer', () => {
  it.each([
    ['', ['claude-code']],
    ['2', ['codex']],
    ['3 1', ['cursor', 'claude-code']],
    ['1,1,codex', ['claude-code', 'codex']],
    ['Gemini-CLI', ['gemini-cli']],
  ])('%j → %j', (answer, hosts) => {
    expect(parseAiHostAnswer(answer)).toEqual(hosts);
  });

  it.each(['0', '5', 'claude', '1,nope'])('%j is not an answer', (answer) => {
    expect(parseAiHostAnswer(answer)).toBeUndefined();
  });
});

describe('aiHostsQuestion — what the host probes found', () => {
  it('without probe results: the plain list', () => {
    expect(aiHostsQuestion()).toBe(
      '? AI coding tools you use (choose one or more)\n  1) Claude Code\n  2) Codex\n  3) Cursor\n  4) Gemini CLI\nChoose, e.g. 1,3 [1]: ',
    );
  });

  it('with them: installed <version> or not found, in a column; every host stays listed', () => {
    expect(aiHostsQuestion({ 'claude-code': '2.1.300', 'gemini-cli': '' })).toBe(
      [
        '? AI coding tools you use (choose one or more)',
        '  1) Claude Code  installed 2.1.300',
        '  2) Codex        not found',
        '  3) Cursor       not found',
        '  4) Gemini CLI   installed',
        'Choose, e.g. 1,3 [1]: ',
      ].join('\n'),
    );
  });

  it('collectMissingInputs asks it with the probe results', async () => {
    const { ask, calls } = scriptedAsk(['2']);
    const result = await collectMissingInputs(
      { ...allMissing, preset: 'solo', frontend: 'next', backend: 'none', locale: 'en', review: false, interactive: true, installedHosts: { codex: '0.162.1' } },
      ask,
    );
    expect(calls).toEqual([aiHostsQuestion({ codex: '0.162.1' })]);
    expect(result.aiHosts).toEqual(['codex']);
  });
});

describe('review provider question', () => {
  const base: PromptInput = { ...allMissing, preset: 'team', frontend: 'next', backend: 'none', locale: 'en', aiHosts: ['codex'], interactive: true };

  it("is numbered, with the first AI tool's provider as the default", () => {
    expect(reviewProviderQuestion('codex')).toBe(
      ['? AI PR review provider', '  1) Claude', '  2) Gemini (beta)', '  3) GPT (beta)  (default — Codex)', 'Choose 1-3 [3]: '].join('\n'),
    );
  });

  it('asked when review is on (team default, or an explicit yes); Enter leaves it to init; a wrong answer asks again', async () => {
    const io = scriptedAsk(['9', '']);
    expect((await collectMissingInputs(base, io.ask)).reviewProvider).toBeUndefined();
    expect(io.calls).toEqual([reviewProviderQuestion('codex'), reviewProviderQuestion('codex')]);
    const picked = scriptedAsk(['2']);
    expect((await collectMissingInputs({ ...base, preset: 'quick-start', review: true }, picked.ask)).reviewProvider).toBe('gemini');
  });

  it('never asked when review is off, when --review-provider is passed, or without a terminal', async () => {
    for (const input of [
      { ...base, review: false },
      { ...base, preset: 'quick-start' as const, review: false },
      { ...base, reviewProvider: 'cursor' as const },
      { ...base, interactive: false },
    ]) {
      const io = scriptedAsk([]);
      await collectMissingInputs(input, io.ask);
      expect(io.calls).toEqual([]);
    }
  });

  it('--review-provider with review off is refused, never dropped silently', () => {
    expect(reviewProviderConflict('team', undefined, 'gemini')).toBeUndefined();
    expect(reviewProviderConflict('solo', true, 'gemini')).toBeUndefined();
    expect(reviewProviderConflict('solo', undefined, 'gemini')).toContain('the solo preset leaves it off: add --review, or drop --review-provider');
    expect(reviewProviderConflict('quick-start', true, 'gemini')).toBeUndefined();
    expect(reviewProviderConflict(undefined, undefined, 'gemini')).toBeUndefined(); // preset still to ask
    expect(reviewProviderConflict('quick-start', undefined, undefined)).toBeUndefined();
    expect(reviewProviderConflict('quick-start', undefined, 'gemini')).toContain('add --review, or drop --review-provider');
    expect(reviewProviderConflict(undefined, false, 'gemini')).toContain('--no-review');
    expect(reviewProviderConflict('team', false, 'gemini')).toContain('--no-review');
  });

  it.each([
    ['', undefined],
    ['3', 'gpt'],
    ['Cursor', null], // not offered: --review-provider=cursor picks it, with a warning
    ['4', null],
    ['openai', null],
  ])('%j → %j', (answer, expected) => {
    expect(parseReviewProviderAnswer(answer)).toBe(expected);
  });
});

describe('collectMissingInputs — backend-only workspaces (frontend none)', () => {
  it('frontend none: the backend question leaves none out', async () => {
    const io = scriptedAsk(['none', 'none', 'nest']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'solo', locale: 'en' }, io.ask);
    expect(result).toMatchObject({ frontend: 'none', backend: 'nest' });
    expect(io.calls).toEqual(['Frontend (react-vite/next/none): ', 'Backend (express/nest): ', 'Backend (express/nest): ']);
  });

  it('--backend=none: the frontend question leaves none out', async () => {
    const io = scriptedAsk(['none', 'next']);
    const result = await collectMissingInputs({ ...allMissing, preset: 'solo', locale: 'en', backend: 'none' }, io.ask);
    expect(result.frontend).toBe('next');
    expect(io.calls).toEqual(['Frontend (react-vite/next): ', 'Frontend (react-vite/next): ']);
  });
});
