// kinds.ts — shared literal-union vocabulary used across journey, render, ui and scoring.
// Kept in core/ so the event bus can type its payloads without import cycles.

// How well a player's prediction / policy choice landed. Drives the blunt verdict copy.
export type Severity = 'nailed' | 'close' | 'wrong' | 'catastrophic';

// Phases a beat can move through. A beat declares which it uses.
export type BeatKind = 'narrate' | 'predict' | 'reveal' | 'verdict' | 'sandbox' | 'challenge';

// Which generative scene the active beat drives.
export type SceneId =
  | 'ambient'
  | 'supply-demand'
  | 'auction'
  | 'controls'
  | 'trade'
  | 'fishery';

export const SEVERITY_RANK: Record<Severity, number> = {
  nailed: 3,
  close: 2,
  wrong: 1,
  catastrophic: 0,
};
