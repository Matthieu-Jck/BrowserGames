// moving.ts — the buildings with a moving part, and the geometry their iso and plan drawings
// share. A moving part (the wind turbine's rotor, the sand collector's bucket wheel) is drawn
// apart from its building's body and baked at boot in `frames` phases of one period — its
// symmetry: a 3-vane rotor looks the same every third of a turn, so 16 phases of a third of a
// turn make a smooth spin. In the world the body is one sprite and the part another whose
// texture steps through the phases (BuildingsView.animate): never a repaint, never a re-upload.
// The full static picture (build-bar icon, artboard, picking, night lights) is the body with
// the part at phase 0, composed exactly as the world composes the two sprites.
import type { BuildingId } from '@/content/buildings';

export interface MovingSpec {
  /** Phases baked per period. */
  frames: number;
  /** Periods per turn: the part's symmetry (3 vanes → 3, 8 buckets → 8). */
  sym: number;
}

export const MOVING: Partial<Record<BuildingId, MovingSpec>> = {
  wind_flower: { frames: 16, sym: 3 },
  sand_collector: { frames: 8, sym: 8 },
};

/**
 * The turbine's crown (local tiles and levels, iso and plan alike): a Savonius rotor — three
 * curved sail-vanes standing between a steel ring at the foot and one at the head, each sweeping
 * out from the shaft to the rings (radius `r`) as a spiral that turns `curl` radians, its scoop
 * catching the wind.
 */
export const TURBINE = {
  cx: 1, cy: 1,
  r: 0.4,
  vanes: 3,
  curl: 1.2,
  /** The tower's bearing (its top), the vanes' foot and head, the mast's tip (levels). */
  hub: 2.78, z0: 2.9, z1: 4.75, top: 5.08,
} as const;

/** A crown vane's horizontal curve at u ∈ [0, 1] (shaft → ring), for a vane whose root is at angle a0. */
export function vaneAt(a0: number, u: number): { rho: number; a: number } {
  return { rho: 0.05 + (TURBINE.r - 0.05) * u, a: a0 + TURBINE.curl * u };
}

/**
 * The sand collector's bucket wheel (local tiles and levels): it turns in the y–z plane on an
 * axle along x at the back, `buckets` scoops round its rim dig the sand in a pit and tip it over
 * the top into the sieve. `split`: the plane y = split parts the wheel's side (the part) from the
 * hopper's (the body), so whichever side the rotation brings nearer is drawn over the other —
 * hence cy − r − (bucket lip ≈ 0.095) ≥ split: nothing of the wheel crosses it.
 */
export const SAND_WHEEL = { cx: 1, cy: 1.42, cz: 0.95, r: 0.46, half: 0.12, buckets: 8, split: 0.86 } as const;

/** Does the bucket at wheel angle a (0 = the back, π/2 = the top) carry sand? It fills at the bottom and tips past the crest. */
export function bucketFull(a: number): boolean {
  const n = Math.atan2(Math.sin(a), Math.cos(a));
  return n > -1.35 && n < 1.9;
}
