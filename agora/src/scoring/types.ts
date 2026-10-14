// types.ts — scoring vocabulary and the persisted progress shape.
import type { Severity } from '@/core/kinds';

export interface PredictionScore {
  error: number;
  severity: Severity;
  stars: number;
}

export interface Progress {
  version: number;
  /** Best stars (0..3) earned per beat id. */
  beats: Record<string, number>;
  /** Best stars per chapter id. */
  chapters: Record<number, number>;
  completed: boolean;
}
