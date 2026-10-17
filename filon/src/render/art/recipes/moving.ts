// moving.ts — the buildings with a moving part, and the geometry their iso and plan drawings
// share. A moving part (the wind turbines' rotors, the sand collector's bucket wheel, the face
// cutter's drum, the deep bore's rotary table and kelly, the steam boiler's flywheel) is drawn
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
  face_cutter: { frames: 8, sym: 6 },
  pitch_turbine: { frames: 16, sym: 3 },
  big_turbine: { frames: 16, sym: 4 },
  deep_bore: { frames: 8, sym: 4 },
  steam_boiler: { frames: 8, sym: 6 }, // the flywheel's six spokes (D114; its geometry: buildings.ts `SB`)
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

/**
 * The face cutter's drum (D87; local tiles and levels, iso and plan alike): it turns on an axle
 * along x across the machine's back, against the cliff — radius `r` (2r levels tall), `half` tiles
 * either side of `cx`, its axle at height `cz` — so it overhangs the footprint's back edge into the
 * wall. Its helical flights wind round it in `starts` starts, `twist` radians end to end, a pick
 * standing `pick` tiles proud every `picks`-th of its length on each, so a sixth of a turn brings the
 * picture back (moving.ts `sym`). `split`: the plane y = split parts the drum and its boom (the
 * part) from the machine (the body); cy − r − pick ≥ split, so nothing of the drum crosses it.
 */
export const CUTTER = { cx: 1, cy: 1.88, cz: 0.92, r: 0.27, half: 0.82, starts: 6, picks: 6, twist: 1.7, pick: 0.06, split: 1.54 } as const;

/**
 * The deep bore's rig (local tiles and levels, iso and plan alike): a derrick on four concrete
 * footings (`foot` levels high) over the wellhead collar sunk in the ground at (cx, cy) — its
 * legs from `base` tiles either side of the axis at the ground up to `crown` at `top`, its coral
 * girts at `girts`, the racking board on its east face at `board` — and at its heart the rotary
 * table on the collar (radius `table`, its turning top from `t0` to `t1`) driving the kelly, a
 * square bar `kelly` tiles either side of the axis, up to the swivel at `swivel`. The table's
 * four slots and the kelly's square repeat every quarter turn (MOVING `sym` 4). The part is the
 * table, the kelly and the derrick leg in front of them (buildings.ts `boreNearLeg`), always the nearer:
 * nothing else the rig draws stands in front of its axis (deep-bore.test.ts).
 */
export const BORE = {
  cx: 1.5, cy: 1.5, base: 0.85, crown: 0.17, top: 5.3, foot: 0.16,
  girts: [1.15, 2.15, 3.05, 3.85, 4.6], board: 3.4,
  collar: 0.52, table: 0.32, t0: 0.32, t1: 0.4, kelly: 0.07, swivel: 3.15,
} as const;

/** A point of the bore's derrick leg k (0 NW, 1 NE, 2 SE, 3 SW) at height z (local tiles, levels). */
export function boreLeg(k: number, z: number): [number, number, number] {
  const w = BORE.base + ((BORE.crown - BORE.base) * z) / BORE.top;
  return [BORE.cx + (k === 1 || k === 2 ? w : -w), BORE.cy + (k >= 2 ? w : -w), z];
}

/** The kelly's square at turn a (radians): its four corners round the axis, `r` tiles out along each half-diagonal. */
export function boreSquare(a: number, r: number): Array<[number, number]> {
  return [0, 1, 2, 3].map((i) => {
    const b = a + Math.PI / 4 + (i * Math.PI) / 2;
    return [BORE.cx + Math.cos(b) * r * Math.SQRT2, BORE.cy + Math.sin(b) * r * Math.SQRT2];
  });
}

/** Does the bucket at wheel angle a (0 = the back, π/2 = the top) carry sand? It fills at the bottom and tips past the crest. */
export function bucketFull(a: number): boolean {
  const n = Math.atan2(Math.sin(a), Math.cos(a));
  return n > -1.35 && n < 1.9;
}
