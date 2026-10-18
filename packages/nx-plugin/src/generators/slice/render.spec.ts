import { renderSliceReport, type SliceReport } from './render.ts';

function baseReport(overrides: Partial<SliceReport>): SliceReport {
  return {
    dryRun: false,
    layer: 'features',
    name: 'checkout',
    project: 'web',
    layerDir: 'src/features',
    directory: 'src/features/checkout',
    publicApiName: 'checkout',
    refused: false,
    refusalReason: null,
    action: 'created',
    files: [{ filePath: 'src/features/checkout/index.ts', content: 'export function checkout(): void {}\n' }],
    ...overrides,
  };
}

describe('renderSliceReport', () => {
  it('explains an invalid-name refusal with kebab-case guidance', () => {
    const output = renderSliceReport(baseReport({ refused: true, refusalReason: 'invalid-name', action: null, name: 'Bad Name', files: [] }));
    expect(output).toMatch(/refused/);
    expect(output).toMatch(/kebab-case/);
    expect(output).toContain('Bad Name');
  });

  it('explains a segment-by-essence refusal with the purpose names', () => {
    const output = renderSliceReport(baseReport({ layer: 'shared', name: 'utils', refused: true, refusalReason: 'segment-by-essence', action: null, files: [] }));
    expect(output).toMatch(/refused/);
    expect(output).toContain('"utils"');
    expect(output).toMatch(/ui, api, model, lib, config/);
  });

  it('reports a fresh create and previews content only in dryRun', () => {
    const created = renderSliceReport(baseReport({ action: 'created' }));
    expect(created).toContain('created');
    expect(created).not.toContain('export function checkout');

    const dryRunCreated = renderSliceReport(baseReport({ action: 'created', dryRun: true }));
    expect(dryRunCreated).toMatch(/dry-run/);
    expect(dryRunCreated).toContain('export function checkout');
  });

  it('reports unchanged without implying anything was written', () => {
    const output = renderSliceReport(baseReport({ action: 'unchanged' }));
    expect(output).toMatch(/unchanged/);
  });

  it('reports skipped with a rename hint, and never previews content even in dryRun', () => {
    const output = renderSliceReport(baseReport({ action: 'skipped', dryRun: true }));
    expect(output).toMatch(/skipped/);
    expect(output).toMatch(/new slice name|rename/i);
    expect(output).not.toContain('export function checkout');
  });

  it('lists the frontend candidates on an ambiguous-frontend refusal', () => {
    const output = renderSliceReport(
      baseReport({ refused: true, refusalReason: 'ambiguous-frontend', action: null, project: null, candidates: ['admin', 'web'], files: [] }),
    );
    expect(output).toContain('--project');
    expect(output).toContain('- admin');
  });
});

describe('renderSliceReport — --segments refusals', () => {
  it('names the offending segment, and tells shared to run once per segment', () => {
    expect(renderSliceReport(baseReport({ refused: true, refusalReason: 'invalid-segment', detail: 'UI', action: null, files: [] }))).toContain('"UI" is not a valid segment name');
    expect(renderSliceReport(baseReport({ refused: true, refusalReason: 'segment-by-essence', detail: 'hooks', action: null, files: [] }))).toContain('"hooks" names what a segment contains');
    expect(renderSliceReport(baseReport({ layer: 'shared', refused: true, refusalReason: 'segments-on-shared', action: null, files: [] }))).toContain('once per segment');
  });
});
