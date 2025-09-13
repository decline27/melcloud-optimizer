export interface OrchestratorMetrics {
  totalSavings: number;      // SEK, monotonically increasing
  totalCostImpact: number;   // SEK, can be +/-
  dailyCostImpact?: number;  // SEK, same-day sum of costDelta
  dailyCostImpactDate?: string; // YYYY-MM-DD for reset
  kWhShifted?: number;
  peakAvoidedKw?: number;
  lastUpdateIso?: string;
}
