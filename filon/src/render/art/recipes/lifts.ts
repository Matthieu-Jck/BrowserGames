// lifts.ts — a traction ribbon's elevator up a terrace (owner, 2026-10-13: "the traction ribbon
// needs to look like a traction thing, and actually go up the blocs" — then "an actual elevator
// style and animation: the item arrives, gets lifted, advances again, and then the elevator goes
// down again"). Where a traction ribbon hands on to a tile one terrace up or down, an open shaft
// stands against the terrace's wall on its low side: a back plate on the wall with the drive
// chain, four guide posts, a hazard buffer at the foot, and over the top a head frame (crossbeam,
// pulley drum, motor box, warning lamp) high enough to clear the car. The car — a steel platform
// with side rails and a hazard edge — is a sprite of its own the views move up and down the shaft
// (world/belt-lift.ts works out where; world/buildings-view.ts moves it).
//
// Iso: a 1 × 2 frame, its way north (−y) as a ribbon's: local y ∈ [1, 2] the traction ribbon's
// own tile, y ∈ [0, 1] the tile it hands to, the wall between them at y = 1; heights from the low
// top (0) to the high one (`STEP_LEVELS`). The shaft stands on the low side: on the ribbon's own
// tile when it climbs, on the far tile when it comes down. Three sprites on that same frame: the
// back (drawn first), the car (drawn at its height above the low top), the front (posts and head,
// over the car). Seen from the camera (+x +y) the shaft shows where its low side faces it;
// otherwise it stands behind the high column and only the head peeks over (world/stand.ts `liftZ`).
//
// Plan: the shaft seen from above, its head across it, a short ink shadow on the low side.
import { STEP_LEVELS } from '../../relief';
import { flat, hatch, ink, type Ctx, type Pt } from '../ink';
import { IsoFrame, box, drumIso, faceHazard, faceQuad, type Face, type RRect } from '../iso-shapes';
import { light, rivet } from '../shapes';
import { C, mix } from '../tokens';
import type { Rot } from '@/sim/types';

/** The shaft across the way (local x), its depth off the wall (tiles), the head frame's height above the high top (levels). */
export const LIFT = { x0: 0.17, x1: 0.83, depth: 0.42, head: 0.62 } as const;
/** The frame's head room above the low top (levels): the step, the head frame and its drum. */
const FRAME_HEAD = STEP_LEVELS + LIFT.head + 0.45;

export type LiftPart = 'back' | 'car' | 'front';

const POST = 0.05;
const STEEL: { top: string; left: string; right: string } = { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.35) };

/** The shaft's span off the wall along local y: [near the wall, the low side's edge]. */
function span(up: boolean): [number, number] {
  return up ? [1, 1 + LIFT.depth] : [1 - LIFT.depth, 1];
}

/** A guide post at (x, y) (its foot on the low top), up past the head frame. */
function post(ctx: Ctx, f: IsoFrame, x: number, y: number, seed: number): void {
  box(ctx, f, x - POST / 2, y - POST / 2, x + POST / 2, y + POST / 2, 0, STEP_LEVELS + LIFT.head + 0.08, STEEL, seed, { shadow: false, outline: 1.3, hatchRight: false });
}

/** Of a box (rotated), the visible face that looks along local (0, s), or null when it faces away. */
function faceToward(f: IsoFrame, s: number): Face | null {
  const [ax, ay] = f.r(0.5, 1), [bx, by] = f.r(0.5, 1 + s);
  return by - ay > 0.5 ? 'L' : bx - ax > 0.5 ? 'R' : null;
}

/** The back: the plate on the wall with its drive chain, the posts against it, the buffer at the foot. */
function back(ctx: Ctx, f: IsoFrame, up: boolean, s: number): void {
  const { x0, x1 } = LIFT, H = STEP_LEVELS;
  const [ya, yb] = span(up);
  const wall = 1, toLow = up ? 1 : -1; // the wall's local y; from it towards the low side
  // The back plate, a hair off the wall.
  const pa = up ? wall : wall - 0.03, pb = up ? wall + 0.03 : wall;
  const plate = box(ctx, f, x0, pa, x1, pb, 0, H + LIFT.head, { top: C.steelD, left: mix(C.steelD, C.steel, 0.4), right: C.steelD }, s, { shadow: false, outline: 1.6, hatchRight: false });
  const face = faceToward(f, toLow);
  if (face) {
    hatch(ctx, faceQuad(f, plate, face, 0.04, 0.96, 0.05, H + LIFT.head - 0.05), Math.PI / 2.6, 6, { alpha: 0.25, seed: s + 1, w: 1 });
    // The drive chain up the middle: links as short brass dashes.
    for (let z = 0.1, k = 0; z < H + LIFT.head - 0.1; z += 0.16, k++) {
      const q = faceQuad(f, plate, face, 0.46, 0.54, z, z + 0.09);
      flat(ctx, q, k % 2 ? C.brass : mix(C.brass, C.ink, 0.3));
    }
    chainRivets(ctx, f, plate, face);
  }
  // The posts against the wall, and the buffer pad on the shaft's floor.
  for (const x of [x0, x1]) post(ctx, f, x, up ? ya + POST / 2 : yb - POST / 2, s + 10 + x * 10);
  box(ctx, f, x0 + 0.06, Math.min(ya, yb) + 0.05, x1 - 0.06, Math.max(ya, yb) - 0.05, 0, 0.07, { top: C.hazard, left: mix(C.hazard, C.ink, 0.2), right: mix(C.hazard, C.ink, 0.35) }, s + 20, { shadow: false, outline: 1.2 });
}

/** Rivets down the back plate's sides. */
function chainRivets(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face): void {
  for (const u of [0.12, 0.88]) for (const z of [0.4, 1.2, 1.9]) {
    const q = faceQuad(f, rr, face, u, u, z, z);
    rivet(ctx, q[0]![0], q[0]![1], 1.3, C.steelL);
  }
}

/** The car: a steel platform (its deck at the car's height), side rails, a hazard edge on the low side. */
function car(ctx: Ctx, f: IsoFrame, up: boolean, s: number): void {
  const { x0, x1 } = LIFT;
  const [ya, yb] = span(up);
  const cx0 = x0 + 0.05, cx1 = x1 - 0.05, cy0 = ya + 0.04, cy1 = yb - 0.04;
  const deck = box(ctx, f, cx0, cy0, cx1, cy1, -0.16, 0, { top: mix(C.steelL, C.paper, 0.15), left: C.steel, right: mix(C.steel, C.ink, 0.35) }, s, { shadow: false, outline: 1.6 });
  // Tread plate on the deck.
  for (let k = 1; k < 5; k++) {
    const x = cx0 + ((cx1 - cx0) * k) / 5;
    ink(ctx, [f.p(x, cy0 + 0.03, 0), f.p(x, cy1 - 0.03, 0)], { w: 1, color: C.steel, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + k });
  }
  const toLow = up ? 1 : -1;
  for (const fc of ['L', 'R'] as const) {
    if (faceToward(f, toLow) === fc) faceHazard(ctx, f, deck, fc, 0.03, 0.97, -0.14, -0.02, s + 6);
  }
  // Side rails: a bar along each side at hand height, on two stanchions.
  for (const x of [cx0 + 0.02, cx1 - 0.02]) {
    for (const y of [cy0 + 0.03, cy1 - 0.03]) ink(ctx, [f.p(x, y, 0), f.p(x, y, 0.42)], { w: 1.6, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 10 });
    ink(ctx, [f.p(x, cy0 + 0.03, 0.42), f.p(x, cy1 - 0.03, 0.42)], { w: 2.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 11 });
    ink(ctx, [f.p(x, cy0 + 0.03, 0.42), f.p(x, cy1 - 0.03, 0.42)], { w: 1.2, color: C.hazard, shade: false, taper: 0, jitter: 0, seed: s + 12 });
  }
}

/** The front: the posts on the low side, and over the shaft the head frame with its drum, motor and lamp. */
function front(ctx: Ctx, f: IsoFrame, up: boolean, s: number): void {
  const { x0, x1, head } = LIFT, H = STEP_LEVELS;
  const [ya, yb] = span(up);
  const yl = up ? yb - POST / 2 : ya + POST / 2; // the low side's edge
  for (const x of [x0, x1]) post(ctx, f, x, yl, s + x * 10);
  // The head frame: a beam along each side and one across the low side, at the posts' tops.
  const z0 = H + head - 0.04, z1 = H + head + 0.08;
  box(ctx, f, x0 - 0.03, Math.min(ya, yb), x0 + 0.03, Math.max(ya, yb), z0, z1, STEEL, s + 20, { shadow: false, outline: 1.2, hatchRight: false });
  box(ctx, f, x1 - 0.03, Math.min(ya, yb), x1 + 0.03, Math.max(ya, yb), z0, z1, STEEL, s + 21, { shadow: false, outline: 1.2, hatchRight: false });
  box(ctx, f, x0 - 0.03, yl - 0.03, x1 + 0.03, yl + 0.03, z0, z1, STEEL, s + 22, { shadow: false, outline: 1.2, hatchRight: false });
  // The pulley drum across the top, and the motor box over the high tile's edge.
  drumIso(ctx, f, 0.5, (ya + yb) / 2, z1 + 0.09, 0.075, 0.26, 'x', C.steelL, s + 30, { shadow: false, bands: [-0.6, 0.6] });
  const my0 = up ? 1 - 0.16 : 1 - 0.02, my1 = up ? 1 + 0.02 : 1 + 0.16;
  const motor = box(ctx, f, 0.36, my0, 0.64, my1, H, H + 0.3, { top: C.brassL, left: C.brass, right: mix(C.brass, C.ink, 0.35) }, s + 40, { shadow: false, outline: 1.5 });
  for (const fc of ['L', 'R'] as const) {
    const q = faceQuad(f, motor, fc, 0.5, 0.5, H + 0.15, H + 0.15);
    rivet(ctx, q[0]![0], q[0]![1], 1.3, C.steelL);
  }
  light(ctx, ...f.p(x1, yl, z1 + 0.05), 2.4, C.ledWarm);
}

/**
 * One part of the elevator for a traction ribbon facing `rot` (`up`: it climbs), on the 1 × 2
 * frame (anchored, as an iso building's, at its rotated footprint's top corner on the low top;
 * the car at its height 0, its deck flush with the low top). `make` gives a canvas.
 */
export function drawLift(part: LiftPart, rot: Rot, up: boolean, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const f = new IsoFrame(1, 2, rot, FRAME_HEAD);
  const { ctx, canvas } = make(f.W, f.H);
  if (part === 'back') back(ctx, f, up, 17);
  else if (part === 'car') car(ctx, f, up, 31);
  else front(ctx, f, up, 47);
  return { canvas, frame: f };
}

/** The plan mark's canvas size (px; one tile, centred on the wall). */
export const LIFT_TOP_PX = 64;

/**
 * An elevator from above, its way north, on a one-tile canvas centred on the wall (the canvas's
 * middle row): the shaft on the low side (south when it climbs, north when it comes down) with its
 * car, the head beam across it, and a short shadow falling on the low side — the plan's hint of the step.
 */
export function drawLiftTop(ctx: Ctx, up: boolean, seed = 23): void {
  const S = LIFT_TOP_PX, m = S / 2;
  const x0 = LIFT.x0 * S, x1 = LIFT.x1 * S;
  const low = up ? 1 : -1; // the low side on the canvas (+1: south)
  const edge = m + low * LIFT.depth * S;
  const a = Math.min(m, edge), b = Math.max(m, edge);
  // The shadow on the low side.
  flat(ctx, [[x0, edge], [x1, edge], [x1 + 2, edge + low * 6], [x0 + 2, edge + low * 6]], C.ink, 0.25);
  // The shaft and its car.
  flat(ctx, [[x0, a], [x1, a], [x1, b], [x0, b]], C.steelD);
  flat(ctx, [[x0 + 4, a + 3], [x1 - 4, a + 3], [x1 - 4, b - 3], [x0 + 4, b - 3]], mix(C.steelL, C.paper, 0.15));
  ink(ctx, [[x0, a], [x1, a], [x1, b], [x0, b]], { closed: true, w: 1.8, taper: 0, jitter: 0.2, seed });
  for (const [x, y] of [[x0, a], [x1, a], [x0, b], [x1, b]] as Pt[]) rivet(ctx, x, y, 2, C.steelL);
  // The head beam across the low side, its drum, and an arrow for the way the items go.
  const hb = edge - low * 3;
  flat(ctx, [[x0 - 2, hb - 2.5], [x1 + 2, hb - 2.5], [x1 + 2, hb + 2.5], [x0 - 2, hb + 2.5]], C.steel);
  ink(ctx, [[x0 - 2, hb], [x1 + 2, hb]], { w: 1.2, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  ink(ctx, [[m - 6, (a + b) / 2 + 4], [m, (a + b) / 2 - 3], [m + 6, (a + b) / 2 + 4]], { w: 2.6, color: C.ink, shade: false, taper: 0, jitter: 0.1, seed: seed + 3 });
  light(ctx, x1 - 3, hb, 1.6, C.ledWarm);
}
