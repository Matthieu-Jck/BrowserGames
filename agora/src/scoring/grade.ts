// grade.ts — pure scoring. Maps how far a guess is from the truth onto a severity band,
// and severities onto stars and letter grades. No DOM, no state.
import type { Severity } from '@/core/kinds';
import { SEVERITY_RANK } from '@/core/kinds';
import type { PredictionScore } from './types';

/** Error measured in tolerances → severity band. */
export function severityFromRatio(ratio: number): Severity {
  if (ratio <= 0.5) return 'nailed';
  if (ratio <= 1.5) return 'close';
  if (ratio <= 3) return 'wrong';
  return 'catastrophic';
}

export const starsFromSeverity = (s: Severity): number => SEVERITY_RANK[s];

/** Score a numeric prediction against the truth, judged in units of `tolerance`. */
export function scorePrediction(
  player: number,
  answer: number,
  tolerance: number,
): PredictionScore {
  const error = Math.abs(player - answer);
  const ratio = tolerance > 0 ? error / tolerance : error === 0 ? 0 : Infinity;
  const severity = severityFromRatio(ratio);
  return { error, severity, stars: SEVERITY_RANK[severity] };
}

/** Average stars (0..3) → a letter grade for the report card. */
export function gradeLetter(avgStars: number): string {
  if (avgStars >= 2.7) return 'A';
  if (avgStars >= 2.2) return 'B+';
  if (avgStars >= 1.7) return 'B';
  if (avgStars >= 1.2) return 'C';
  if (avgStars >= 0.6) return 'D';
  return 'F';
}
