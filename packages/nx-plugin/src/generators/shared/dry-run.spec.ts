import { resolveDryRun } from './dry-run.ts';

describe('resolveDryRun', () => {
  const saved = process.env['NX_DRY_RUN'];
  afterEach(() => {
    if (saved === undefined) delete process.env['NX_DRY_RUN'];
    else process.env['NX_DRY_RUN'] = saved;
  });

  it("Nx's own --dry-run (NX_DRY_RUN=true) always means dry run, whatever the option says", () => {
    process.env['NX_DRY_RUN'] = 'true';
    expect(resolveDryRun({ dryRun: false })).toBe(true);
    expect(resolveDryRun({})).toBe(true);
  });

  it('otherwise the explicit option decides, defaulting to a real run', () => {
    process.env['NX_DRY_RUN'] = 'false'; // what nx sets when --dry-run is NOT given
    expect(resolveDryRun({ dryRun: true })).toBe(true);
    expect(resolveDryRun({ dryRun: false })).toBe(false);
    expect(resolveDryRun({})).toBe(false);
    delete process.env['NX_DRY_RUN']; // programmatic caller outside nx
    expect(resolveDryRun({ dryRun: true })).toBe(true);
    expect(resolveDryRun({})).toBe(false);
  });
});
