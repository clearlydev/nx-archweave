export interface DoctorGeneratorSchema {
  liveIntegrations?: boolean;
  /** Print the machine-readable archweave/doctor-report@1 JSON to stdout
   * instead of the console report. */
  json?: boolean;
}
