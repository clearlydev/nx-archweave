import { renderDoctorReport } from './render.ts';
import type { DoctorReport } from '@nx-archweave/shared';

describe('renderDoctorReport', () => {
  it('renders overall status and each check line', () => {
    const report: DoctorReport = {
      overallStatus: 'safe',
      checks: [
        {
          id: 'nx-workspace-detected',
          label: 'Nx workspace detected',
          status: 'pass',
          message: 'nx.json found',
          evidence: ['nx.json'],
        },
      ],
    };
    const output = renderDoctorReport(report);
    expect(output).toContain('safe');
    expect(output).toContain('Nx workspace detected');
    expect(output).toContain('nx.json found');
  });
});
