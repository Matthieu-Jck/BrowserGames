// moving.ts — the buildings with a moving part, and the geometry their iso and plan drawings
// share. A moving part (the wind turbines' rotors, the sand collector's bucket wheel) is drawn
// apart from its building's body and baked at boot in `frames` phases of one period — its
// symmetry: a 3-vane rotor looks the same every third of a turn, so 16 phases of a third of a
// turn make a smooth spin. In the world the body is one sprite and the part another whose
// texture steps through the phases (BuildingsView.animate): never a repaint, never a re-upload.
// The full static picture (build-bar icon, artboard, picking, night lights) is the body with
// the part at phase 0, composed exactly as the world composes the two sprites.
import type { BuildingId } from '@/content/buildings';
import { C, mix } from '../tokens';

export interface MovingSpec {
  /** Phases baked per period. */
  frames: number;
  /** Periods per turn: the part's symmetry (3 vanes → 3, 8 buckets → 8). */
  sym: number;
}

export const MOVING: Partial<Record<BuildingId, MovingSpec>> = {
  wind_flower: { frames: 16, sym: 3 },
  sand_collector: { frames: 8, sym: 8 },
  pitch_turbine: { frames: 16, sym: 3 },
  big_turbine: { frames: 16, sym: 4 },
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
 * A pitch turbine's crown (local tiles and levels, iso and plan alike): an H-rotor — `n` straight
 * blades of `chord` tiles standing at radius r from z0 to z1, each pitched `pitch` radians off the
 * tangent, on struts at the `struts` heights; the shaft from the bearing (`hub`) to the mast's tip
 * (`top`); `k` scales the shaft, struts and knuckles; blade, tip-band colours.
 */
export interface HRotor {
  cx: number; cy: number; r: number; n: number; z0: number; z1: number; hub: number; top: number;
  chord: number; pitch: number; struts: readonly number[]; k: number; blade: string; tip: string;
}

/** The pitch turbine's (2×2, on the wind flower's tower): three ice-teal blades, coral tips. */
export const PITCH_ROTOR: HRotor = {
  cx: TURBINE.cx, cy: TURBINE.cy, r: 0.5, n: 3, z0: 2.95, z1: 4.75, hub: TURBINE.hub, top: 5.08,
  chord: 0.24, pitch: 0.42, struts: [3.35, 4.35], k: 1, blade: mix(C.tealL, C.ice, 0.45), tip: C.coral,
};

/** The big turbine's (3×3, on its taller tower): four long white blades, coral tips, three strut levels. */
export const BIG_ROTOR: HRotor = {
  cx: 1.5, cy: 1.5, r: 0.78, n: 4, z0: 4.55, z1: 7.35, hub: 4.42, top: 7.75,
  chord: 0.26, pitch: 0.38, struts: [5.0, 5.95, 6.9], k: 1.3, blade: mix(C.ice, C.paper, 0.6), tip: C.coral,
};

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
