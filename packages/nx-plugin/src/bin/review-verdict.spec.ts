import { FINDINGS_MARKER, ROUND_MARKER } from '@nx-archweave/template-engine';
import { runReviewVerdictBin, type BinExec } from './review-verdict.ts';

const ENV = {
  GITHUB_REPOSITORY: 'o/r',
  ARCHWEAVE_PR_NUMBER: '7',
  ARCHWEAVE_MAX_ROUNDS: '3',
  ARCHWEAVE_LOCALE: 'en',
};

const blockComment = (priority: string) =>
  JSON.stringify([
    {
      user: { login: 'claude[bot]', type: 'Bot' },
      body: `${ROUND_MARKER}\n${FINDINGS_MARKER}\n\`\`\`json\n${JSON.stringify({
        schema: 'archweave/findings@1',
        findings: [
          {
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
          },
        ],
      })}\n\`\`\``,
    },
  ]);

function stubExec(commentsJson: string, calls: { args: string[]; stdin?: string }[]): BinExec {
  return (_command, args, stdin) => {
    calls.push({ args, stdin });
    if (args.includes('--paginate')) return { status: 0, stdout: commentsJson };
    return { status: 0, stdout: '' };
  };
}

describe('runReviewVerdictBin', () => {
  it('BLOCK: fetches comments, posts the verdict comment via stdin, exits 1', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const result = runReviewVerdictBin(ENV, stubExec(blockComment('P0'), calls));
    expect(result.exitCode).toBe(1);
    const post = calls.find((c) => c.args.includes('-X'));
    expect(post?.args.join(' ')).toContain('repos/o/r/issues/7/comments');
    expect(post?.stdin).toContain('<!-- archweave-verdict -->');
  });

  it('clean review exits 0 and still posts the verdict comment', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const ok = JSON.stringify([
      {
        user: { login: 'claude[bot]', type: 'Bot' },
        body: `${ROUND_MARKER}\n${FINDINGS_MARKER}\n\`\`\`json\n{"schema":"archweave/findings@1","findings":[]}\n\`\`\``,
      },
    ]);
    expect(runReviewVerdictBin(ENV, stubExec(ok, calls)).exitCode).toBe(0);
    expect(calls.some((c) => c.args.includes('-X'))).toBe(true);
  });

  it('no-review posts nothing and exits 0', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    expect(runReviewVerdictBin(ENV, stubExec('[]', calls)).exitCode).toBe(0);
    expect(calls.some((c) => c.args.includes('-X'))).toBe(false);
  });

  it('missing env → warn + exit 0 (never red)', () => {
    const result = runReviewVerdictBin({}, stubExec('[]', []));
    expect(result.exitCode).toBe(0);
    expect(result.logs.join('\n')).toContain('skipping');
  });

  it('gh failure (e.g. token without permission) → warn + exit 0', () => {
    const failing: BinExec = () => ({ status: 1, stdout: '' });
    expect(runReviewVerdictBin(ENV, failing).exitCode).toBe(0);
  });

  it('gh returning non-json → warn + exit 0', () => {
    const weird: BinExec = () => ({ status: 0, stdout: 'not json' });
    expect(runReviewVerdictBin(ENV, weird).exitCode).toBe(0);
  });

  it('a failed comment POST never flips the exit code (BLOCK stays 1, clean stays 0)', () => {
    const postFails: BinExec = (_c, args, _stdin) =>
      args.includes('--paginate') ? { status: 0, stdout: blockComment('P0') } : { status: 1, stdout: '' };
    expect(runReviewVerdictBin(ENV, postFails).exitCode).toBe(1);
  });
});

describe('runReviewVerdictBin — paginated gh output', () => {
  it('handles gh --paginate output: multiple concatenated top-level arrays', () => {
    const page1 = blockComment('P0'); // "[{...}]"
    const page2 = JSON.stringify([{ body: 'just a human comment' }]);
    const calls: { args: string[]; stdin?: string }[] = [];
    const result = runReviewVerdictBin(ENV, stubExec(page1 + page2, calls));
    expect(result.exitCode).toBe(1); // the P0 round on page 1 is seen, not discarded as "unexpected output"
  });
});

describe('runReviewVerdictBin — only bot-authored rounds count', () => {
  it('ignores marker comments from human authors — the gate cannot be spoofed into APPROVE', () => {
    const spoof = JSON.stringify([
      JSON.parse(blockComment('P0'))[0],
      {
        user: { login: 'attacker', type: 'User' },
        body: `${ROUND_MARKER}\n${FINDINGS_MARKER}\n\u0060\u0060\u0060json\n{"schema":"archweave/findings@1","findings":[]}\n\u0060\u0060\u0060`,
      },
    ]);
    const calls: { args: string[]; stdin?: string }[] = [];
    const result = runReviewVerdictBin(ENV, stubExec(spoof, calls));
    expect(result.exitCode).toBe(1); // the human "empty findings" round did not clear the bot's BLOCK
  });
});

describe('runReviewVerdictBin — rounds bound to this run, verdict updated in place', () => {
  const BOUND = { ...ENV, ARCHWEAVE_HEAD_SHA: 'abcdef1234567890abcdef1234567890abcdef12', ARCHWEAVE_ROUND_AFTER_ID: '100' };
  const round = (id: number, priority: string) => ({ ...JSON.parse(blockComment(priority))[0], id });
  const verdictComment = (id: number) => ({ id, user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- archweave-verdict -->\nold' });

  it('edits the newest earlier verdict comment instead of posting another; names the commit', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const comments = JSON.stringify([verdictComment(50), round(90, 'P2'), verdictComment(95), round(120, 'P0')]);
    expect(runReviewVerdictBin(BOUND, stubExec(comments, calls)).exitCode).toBe(1);
    const writes = calls.filter((c) => c.args.includes('-X'));
    expect(writes.map((c) => c.args.slice(2, 4))).toEqual([['PATCH', 'repos/o/r/issues/comments/95']]);
    expect(writes[0].stdin).toContain('Commit `abcdef1`');
  });

  it('a refused edit (another app owns the comment) falls back to a new comment', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const exec: BinExec = (_c, args, stdin) => {
      calls.push({ args, stdin });
      if (args.includes('--paginate')) return { status: 0, stdout: JSON.stringify([verdictComment(95), round(120, 'P2')]) };
      return { status: args.includes('PATCH') ? 1 : 0, stdout: '' };
    };
    expect(runReviewVerdictBin(BOUND, exec).exitCode).toBe(0);
    expect(calls.filter((c) => c.args.includes('-X')).map((c) => c.args[2])).toEqual(['PATCH', 'POST']);
  });

  it("no round after the round gate's watermark → the earlier round's BLOCK is not judged again: notice, exit 0", () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const result = runReviewVerdictBin(BOUND, stubExec(JSON.stringify([round(90, 'P0'), verdictComment(95)]), calls));
    expect(result.exitCode).toBe(0);
    expect(result.logs.join('\n')).toContain('posted no review round for the current commit');
    expect(calls.find((c) => c.args.includes('PATCH'))?.stdin).toContain('review this PR manually');
  });

  it('an earlier verdict comment without an id is never edited — a new one is posted', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const noId = { user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- archweave-verdict -->\nold' };
    runReviewVerdictBin(BOUND, stubExec(JSON.stringify([noId, round(120, 'P2')]), calls));
    expect(calls.filter((c) => c.args.includes('-X')).map((c) => c.args[2])).toEqual(['POST']);
  });

  it('a malformed watermark or SHA is ignored (the gate runs unbound, as an older workflow would)', () => {
    const env = { ...ENV, ARCHWEAVE_ROUND_AFTER_ID: '', ARCHWEAVE_HEAD_SHA: 'not-a-sha' };
    const calls: { args: string[]; stdin?: string }[] = [];
    expect(runReviewVerdictBin(env, stubExec(JSON.stringify([round(90, 'P0')]), calls)).exitCode).toBe(1);
    expect(calls.find((c) => c.args.includes('POST'))?.stdin).not.toContain('Commit');
  });
});

describe('runReviewVerdictBin — output mode (a separate job posts the comment)', () => {
  const OUTPUT = { ...ENV, ARCHWEAVE_VERDICT_OUTPUT: 'github-output', GITHUB_OUTPUT: '/runner/output' };
  const verdictComment = (id: number) => ({ id, user: { login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- archweave-verdict -->\nold' });
  const parseOutputs = (text: string): Record<string, string> => {
    const outputs: Record<string, string> = {};
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const heredoc = /^([\w-]+)<<(.+)$/.exec(lines[i]);
      if (heredoc) {
        const end = lines.indexOf(heredoc[2], i + 1);
        outputs[heredoc[1]] = lines.slice(i + 1, end).join('\n');
        i = end;
      } else if (lines[i].includes('=')) {
        outputs[lines[i].slice(0, lines[i].indexOf('='))] = lines[i].slice(lines[i].indexOf('=') + 1);
      }
    }
    return outputs;
  };

  it('BLOCK: writes the comment, the earlier verdict id and blocked=true, posts nothing, exits 0', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const written: { path: string; text: string }[] = [];
    const comments = JSON.stringify([verdictComment(95), JSON.parse(blockComment('P0'))[0]]);
    const result = runReviewVerdictBin(OUTPUT, stubExec(comments, calls), (path, text) => written.push({ path, text }));
    expect(result.exitCode).toBe(0);
    expect(calls.some((c) => c.args.includes('-X'))).toBe(false);
    expect(written.map((w) => w.path)).toEqual(['/runner/output']);
    const outputs = parseOutputs(written[0].text);
    expect(outputs['comment-body']).toContain('<!-- archweave-verdict -->');
    expect(outputs['previous-comment-id']).toBe('95');
    expect(outputs['blocked']).toBe('true');
    expect(result.logs.join('\n')).toContain('BLOCK');
  });

  it('a clean review writes blocked=false and no earlier id when there is none', () => {
    const written: string[] = [];
    const ok = JSON.stringify([
      { user: { login: 'claude[bot]', type: 'Bot' }, body: `${ROUND_MARKER}\n${FINDINGS_MARKER}\n\`\`\`json\n{"schema":"archweave/findings@1","findings":[]}\n\`\`\`` },
    ]);
    expect(runReviewVerdictBin(OUTPUT, stubExec(ok, []), (_p, text) => written.push(text)).exitCode).toBe(0);
    const outputs = parseOutputs(written.join(''));
    expect(outputs['blocked']).toBe('false');
    expect(outputs['previous-comment-id']).toBe('');
  });

  it('no review writes nothing, so the comment job is skipped', () => {
    const written: string[] = [];
    expect(runReviewVerdictBin(OUTPUT, stubExec('[]', []), (_p, text) => written.push(text)).exitCode).toBe(0);
    expect(written).toEqual([]);
  });

  it('a delimiter line inside the comment cannot end the output early', () => {
    const written: string[] = [];
    runReviewVerdictBin(OUTPUT, stubExec(blockComment('P0'), []), (_p, text) => written.push(text));
    const delimiter = /^comment-body<<(.+)$/m.exec(written[0])?.[1] ?? '';
    expect(delimiter).toMatch(/^ARCHWEAVE_[0-9a-f]{16}$/);
    expect(written[0].split('\n').filter((line) => line === delimiter)).toHaveLength(1);
  });

  it('without GITHUB_OUTPUT it posts the comment itself, as the default mode does', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const { GITHUB_OUTPUT: _unset, ...env } = OUTPUT;
    expect(runReviewVerdictBin(env, stubExec(blockComment('P0'), calls), () => undefined).exitCode).toBe(1);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(true);
  });
});

describe('runReviewVerdictBin — workflows generated before output mode', () => {
  // The exact environment a 0.2.x workflow passes: no ARCHWEAVE_VERDICT_OUTPUT.
  const OLD_WORKFLOW_ENV = {
    GH_TOKEN: 'token',
    GITHUB_REPOSITORY: 'o/r',
    ARCHWEAVE_PR_NUMBER: '7',
    ARCHWEAVE_MAX_ROUNDS: '3',
    ARCHWEAVE_LOCALE: 'en',
    ARCHWEAVE_HEAD_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
    ARCHWEAVE_ROUND_AFTER_ID: '',
    GITHUB_OUTPUT: '/runner/output',
  };

  it('still posts the verdict comment itself and exits 1 on BLOCK, writing no outputs', () => {
    const calls: { args: string[]; stdin?: string }[] = [];
    const written: string[] = [];
    const result = runReviewVerdictBin(OLD_WORKFLOW_ENV, stubExec(blockComment('P0'), calls), (_p, text) => written.push(text));
    expect(result.exitCode).toBe(1);
    expect(calls.find((c) => c.args.includes('POST'))?.stdin).toContain('<!-- archweave-verdict -->');
    expect(written).toEqual([]);
  });
});

describe('runReviewVerdictBin — a comment fetch that fails', () => {
  const OUTPUT = { ...ENV, ARCHWEAVE_VERDICT_OUTPUT: 'github-output', GITHUB_OUTPUT: '/runner/output' };
  const failing: BinExec = () => ({ status: 1, stdout: '' });
  const garbled: BinExec = () => ({ status: 0, stdout: 'not json' });

  it.each([
    ['gh fails', failing],
    ['gh returns non-JSON', garbled],
  ])('output mode: %s → an error annotation with the cause and the way back, exit 1', (_case, exec) => {
    const written: string[] = [];
    const result = runReviewVerdictBin(OUTPUT, exec, (_p, text) => written.push(text));
    // A read-only token that cannot read the comments must not let a BLOCK pass as green.
    expect(result.exitCode).toBe(1);
    expect(written).toEqual([]);
    expect(result.logs).toEqual([
      '::error title=Review verdict not computed::Could not read PR comments, so the verdict could not be computed. ' +
        'Re-run the failed jobs to retry. If it fails again, check that the review job has pull-requests: read.',
    ]);
  });

  it.each([
    ['gh fails', failing, 'verdict gate: could not fetch PR comments via gh — skipping (check stays green).'],
    ['gh returns non-JSON', garbled, 'verdict gate: unexpected gh output — skipping (check stays green).'],
  ])('default mode (an earlier workflow): %s → the same log line as before, no annotation', (_case, exec, line) => {
    const result = runReviewVerdictBin(ENV, exec);
    expect(result).toEqual({ exitCode: 0, logs: [line] });
  });
});
