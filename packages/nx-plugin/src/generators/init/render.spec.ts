import { renderInitReport, type InitReport } from './render.ts';

const BASE: Omit<InitReport, 'sections'> = {
  preset: 'solo',
  frontend: 'react-vite',
  backend: 'none',
  dryRun: false,
  cleanTree: true,
  refused: false,
};

describe('renderInitReport — toolkit.config.json block', () => {
  it('names the recorded fields and the outcome', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [],
      config: { action: 'created', fields: ['fsd.enforcement', 'agentRules.teamRules'], notRecorded: [] },
    });
    expect(output).toContain('## toolkit.config.json');
    expect(output).toContain('fsd.enforcement');
    expect(output).toContain('agentRules.teamRules');
    expect(output).toContain('created');
  });

  it('explains an unrecognized config without claiming a write', () => {
    const output = renderInitReport({ ...BASE, sections: [], config: { action: 'unrecognized', fields: ['fsd.enforcement'], notRecorded: [] } });
    expect(output).toContain('## toolkit.config.json');
    expect(output).toMatch(/not updated/i);
    expect(output).not.toMatch(/recorded fsd/);
  });

  it('renders nothing for a skipped config outcome or when the field is absent', () => {
    expect(renderInitReport({ ...BASE, sections: [], config: { action: 'skipped', fields: [], notRecorded: [] } })).not.toContain('toolkit.config.json');
    expect(renderInitReport({ ...BASE, sections: [] })).not.toContain('toolkit.config.json');
  });
});

describe('renderInitReport — refusal', () => {
  it('prints the dirty-tree refusal message and nothing else', () => {
    const output = renderInitReport({ ...BASE, cleanTree: false, refused: true, sections: [] });
    expect(output).toContain('Refused');
    expect(output).toContain('uncommitted changes');
    expect(output).toContain('commit or stash your changes, then rerun');
    expect(output).not.toContain('git restore .');
  });
});

describe('renderInitReport — allowDirty note', () => {
  it('warns that git restore also reverts pre-existing changes when a dirty-tree run was allowed', () => {
    const output = renderInitReport({
      ...BASE,
      cleanTree: false,
      allowDirty: true,
      sections: [{ id: 'review', enabled: false, report: null }],
    });
    expect(output).toContain('--allowDirty was set');
    expect(output).toContain('restoring the files this run modified also reverts your earlier changes to them');
    expect(output).not.toContain('Refused');
  });

  it('prints no dirty note when allowDirty was set but the tree was clean anyway', () => {
    const output = renderInitReport({
      ...BASE,
      allowDirty: true,
      sections: [{ id: 'review', enabled: false, report: null }],
    });
    expect(output).not.toContain('--allowDirty was set');
  });
});

describe('renderInitReport — disabled sections', () => {
  it('reports a disabled section as skipped, without calling any sub-render', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [{ id: 'review', enabled: false, report: null }],
    });
    expect(output).toContain('## add-review');
    expect(output).toContain('skipped (disabled for this run)');
  });
});

describe('renderInitReport — fsd thrown-error folding', () => {
  it('renders the caught error distinctly, and still shows the rollback guidance', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [
        { id: 'fsd', enabled: true, report: null, thrownError: 'boom' },
        {
          id: 'agentRules',
          enabled: true,
          report: { kind: 'agentRules', report: { dryRun: false, locale: 'en', hosts: ['claude-code'], teamRules: false, files: [], hostsRecord: 'not-requested' } },
        },
      ],
    });
    expect(output).toContain('## add-fsd-lite');
    expect(output).toContain('aborted — unexpected error: boom');
    expect(output).toContain('One or more sections aborted.');
  });

  it('omits rollback guidance in dryRun even if a section is flagged aborted', () => {
    const output = renderInitReport({
      ...BASE,
      dryRun: true,
      sections: [{ id: 'fsd', enabled: true, report: null, thrownError: 'boom' }],
      written: { created: ['toolkit.config.json'], modified: ['package.json'] },
    });
    expect(output).not.toContain('git restore');
    expect(output).not.toContain('One or more sections aborted.');
  });
});

describe('renderInitReport — composes sub-generator renders', () => {
  it('includes add-fsd-lite report content for an enabled fsd section', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [
        {
          id: 'fsd',
          enabled: true,
          report: {
            kind: 'fsd',
            report: {
              dryRun: false,
              aborted: false,
              appRefusal: null,
              project: 'web',
              sourceRoot: 'apps/web/src',
              enforcement: 'warn',
              frontend: 'react-vite',
              eslint: 'snippet-only',
              eslintPath: 'apps/web/eslint.config.mjs',
              snippet: "...fsdBoundaries({ severity: 'warn' }),",
              layerGuide: '  apps/web/src/shared  segments',
              steiger: null,
            },
          },
        },
      ],
    });
    expect(output).toContain('FSD layers (in web, apps/web/src):');
    expect(output).toContain("...fsdBoundaries({ severity: 'warn' }),");
  });

  it('includes add-review report content, e.g. the secret-registration note, for an enabled review section', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [
        {
          id: 'review',
          enabled: true,
          report: {
            kind: 'review',
            report: {
              dryRun: false,
              workflowPath: '.github/workflows/claude-code-review.yml',
              workflowAction: 'created',
              configAction: 'created',
              requiredSecretName: 'CLAUDE_CODE_OAUTH_TOKEN',
              diff: null,
              workflowYaml: null,
              configSnippetJson: null,
              configError: null,
              dependabot: 'present',
              dependabotProposal: null,
            },
          },
        },
      ],
    });
    expect(output).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('adds git restore guidance when the review section aborted (unusable config)', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [
        {
          id: 'review',
          enabled: true,
          report: {
            kind: 'review',
            report: {
              dryRun: false,
              workflowPath: '.github/workflows/claude-code-review.yml',
              workflowAction: 'aborted',
              configAction: 'aborted',
              requiredSecretName: 'CLAUDE_CODE_OAUTH_TOKEN',
              diff: null,
              workflowYaml: null,
              configSnippetJson: null,
              configError: 'toolkit.config.json is not valid JSON',
              dependabot: 'not-applied',
              dependabotProposal: null,
            },
          },
        },
      ],
    });
    expect(output).toContain('One or more sections aborted.');
  });
});

describe('renderInitReport — rollback names the files this run wrote', () => {
  const aborted = { id: 'fsd' as const, enabled: true, report: null, thrownError: 'boom' };

  it('restores modified files and lists created ones for the user to delete', () => {
    const output = renderInitReport({
      ...BASE,
      sections: [aborted],
      written: { created: ['.github/PULL_REQUEST_TEMPLATE.md', 'toolkit.config.json'], modified: ['package.json'] },
    });
    expect(output).toContain('  git restore -- package.json');
    expect(output).toContain('Created by this run (untracked — delete them yourself; `git clean -n` lists them):');
    expect(output).toContain('    .github/PULL_REQUEST_TEMPLATE.md');
    expect(output).toContain('    toolkit.config.json');
    expect(output).not.toContain('git restore .');
  });

  it('omits the restore line when the run only created files', () => {
    const output = renderInitReport({ ...BASE, sections: [aborted], written: { created: ['CLAUDE.md'], modified: [] } });
    expect(output).not.toContain('git restore');
    expect(output).toContain('    CLAUDE.md');
  });

  it('warns after an --allowDirty run that restoring also reverts earlier edits', () => {
    const output = renderInitReport({
      ...BASE,
      cleanTree: false,
      allowDirty: true,
      sections: [aborted],
      written: { created: [], modified: ['package.json'] },
    });
    expect(output).toContain('  git restore -- package.json');
    expect(output).toContain('(--allowDirty: this also reverts the uncommitted changes those files already had.)');
  });
});

describe('renderInitReport — "record it with" commands', () => {
  it("run the workspace's own nx", () => {
    const notRecorded = [{ field: 'aiHosts', rerun: 'add-agent-rules --hosts=codex' }];
    const npm = renderInitReport({ ...BASE, packageManager: 'npm', sections: [], config: { action: 'updated', fields: [], notRecorded } });
    expect(npm).toContain('    npm exec nx -- g @clearlydev/nx-archweave:add-agent-rules --hosts=codex');
    const unknown = renderInitReport({ ...BASE, sections: [], config: { action: 'updated', fields: [], notRecorded } });
    expect(unknown).toContain('    pnpm nx g @clearlydev/nx-archweave:add-agent-rules --hosts=codex');
  });
});
