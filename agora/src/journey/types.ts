// types.ts — the journey is data. A chapter is a list of beats; a beat is one screen the
// player moves through. Beats bind to a generative scene and, where relevant, to the
// economics engine (prediction answers, sandbox controls, challenge scoring).
import type { BeatKind, SceneId, Severity } from '@/core/kinds';

/** The blunt feedback payload — what the verdict component renders. */
export interface VerdictView {
  metric: string;
  playerLabel: string; // e.g. "You set the price at $30"
  optimalLabel: string; // e.g. "The market clears at $60"
  headline: string; // the harsh one-liner
  detail: string; // the consequence, in plain terms
}

export interface PredictSpec {
  prompt: string;
  kind: 'slider' | 'choice';
  // slider:
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  initial?: number;
  // choice:
  options?: Array<{ label: string; value: number }>;
  // grading:
  answer: number;
  tolerance: number;
  // build the consequence text from the player's guess:
  verdict: (playerValue: number) => VerdictView;
}

export interface SandboxControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  unit?: string;
}

export interface ChallengeOutcome {
  stars: number; // 0..3
  score: number;
  severity: Severity;
  view: VerdictView;
}

export interface ChallengeSpec {
  prompt: string;
  controls: SandboxControl[];
  /** Pure: given the current control values, score the attempt and write the verdict. */
  evaluate: (params: Record<string, number>) => ChallengeOutcome;
  /** Optional: the param values that would solve it (used by the debug API). */
  solution?: Record<string, number>;
}

export interface Beat {
  id: string;
  kind: BeatKind;
  scene: SceneId;
  title?: string;
  body?: string;
  predict?: PredictSpec;
  sandbox?: { intro: string; controls: SandboxControl[] };
  challenge?: ChallengeSpec;
  /** Parameters pushed to the scene when the beat is entered. */
  sceneParams?: Record<string, number>;
}

export interface ChapterDef {
  id: number;
  title: string;
  subtitle: string;
  accent: string;
  law: string; // the one-line takeaway, for the report card
  beats: Beat[];
}
