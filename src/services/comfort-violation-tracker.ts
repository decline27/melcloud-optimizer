/**
 * Accumulates indoor-temperature samples between optimizer runs and counts
 * how many were outside the comfort band.
 *
 * Replaces the single-snapshot `countComfortViolations` logic so that a
 * house which was cold for 55 minutes and recovered by run-time is still
 * counted as having had a violation.
 */
export class ComfortViolationTracker {
  private samples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 24) {
    this.maxSamples = maxSamples;
  }

  /**
   * Record an indoor temperature reading (e.g. from a 5-minute device poll).
   * Non-finite values are silently ignored.
   */
  record(indoorTemp: number): void {
    if (!Number.isFinite(indoorTemp)) return;
    this.samples.push(indoorTemp);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Count how many accumulated samples (plus the current snapshot temperature
   * if provided) fall outside the comfort band, then reset the buffer.
   *
   * @param band    The active comfort band { minTemp, maxTemp }
   * @param currentTemp  The temperature reading at evaluation time (optional).
   *                     Included so the optimization-time snapshot is always counted.
   */
  countAndReset(
    band: { minTemp: number; maxTemp: number },
    currentTemp?: number
  ): number {
    const all = currentTemp !== undefined && Number.isFinite(currentTemp)
      ? [...this.samples, currentTemp]
      : [...this.samples];

    const violations = all.filter(
      t => t < band.minTemp - 1e-3 || t > band.maxTemp + 1e-3
    ).length;

    this.samples = [];
    return violations;
  }
}
