import {
  createDoctorCheck,
  computeOverallStatus,
  serializeDoctorReport,
  type DoctorCheck,
  type DoctorReport,
} from './doctor-report.ts';

describe('createDoctorCheck', () => {
  it('builds a check with all required fields and no optional suggestedAction', () => {
    const check = createDoctorCheck({
      id: 'nx-workspace-detected',
      label: 'Nx workspace detected',
      status: 'pass',
      message: 'nx.json found at workspace root',
      evidence: ['nx.json'],
    });
    expect(check).toEqual({
      id: 'nx-workspace-detected',
      label: 'Nx workspace detected',
      status: 'pass',
      message: 'nx.json found at workspace root',
      evidence: ['nx.json'],
      suggestedAction: undefined,
    });
  });
});

describe('computeOverallStatus', () => {
  const check = (status: DoctorCheck['status']): DoctorCheck => ({
    id: 'x',
    label: 'x',
    status,
    message: 'x',
    evidence: [],
  });

  it('returns safe when every check passes or is not-applicable', () => {
    expect(computeOverallStatus([check('pass'), check('not-applicable')])).toBe('safe');
  });

  it('returns manual-review-required when any check warns and none error', () => {
    expect(computeOverallStatus([check('pass'), check('warning')])).toBe('manual-review-required');
  });

  it('returns conflict when any check errors', () => {
    expect(computeOverallStatus([check('warning'), check('error')])).toBe('conflict');
  });
});

describe('serializeDoctorReport', () => {
  const report: DoctorReport = {
    overallStatus: 'manual-review-required',
    checks: [
      createDoctorCheck({ id: 'a', label: 'A', status: 'pass', message: 'ok', evidence: ['x'] }),
      createDoctorCheck({ id: 'b', label: 'B', status: 'warning', message: 'hm', evidence: [], suggestedAction: 'do' }),
      createDoctorCheck({ id: 'c', label: 'C', status: 'not-applicable', message: '-', evidence: [] }),
    ],
  };

  it('emits the fixed-order schema with a derived summary and a single trailing newline', () => {
    const text = serializeDoctorReport(report);
    expect(text.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed)).toEqual(['schema', 'overallStatus', 'summary', 'checks']);
    expect(parsed.schema).toBe('archweave/doctor-report@1');
    expect(parsed.summary).toEqual({ pass: 1, warning: 1, error: 0, notApplicable: 1 });
    expect(parsed.checks[1].suggestedAction).toBe('do');
    expect(parsed.checks[0]).not.toHaveProperty('suggestedAction');
  });

  it('is byte-idempotent and carries no timestamp', () => {
    expect(serializeDoctorReport(report)).toBe(serializeDoctorReport(report));
    expect(serializeDoctorReport(report)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('matches the snapshot (field order and indent are the contract)', () => {
    expect(serializeDoctorReport(report)).toMatchSnapshot();
  });
});
