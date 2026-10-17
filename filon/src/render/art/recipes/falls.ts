// falls.ts — a conduit's water pouring one terrace down (D114: a conduit whose next tile stands one
// terrace lower hands its water on to it; it never climbs). Where it does, a glazed downpipe in
// the conduit's own colours (belts.ts `BELT_TIERS.conduit`: pale glazed steel, the deep water in
// its window) stands against the terrace's wall on the low side: a hood bends the line over the
// edge of the high tile, the duct runs down the wall on two clamps, its window showing the water
// falling in streaks, and a little foam rises at its foot where the water meets the low conduit.
// It is the conduit's analogue of the traction ribbon's elevator (lifts.ts), drawn on the same
// frame and laid the same way (world/traction-lifts.ts `fallOfConduit`, world/buildings-view.ts).
//
// Iso: a 1 × 2 frame, its way north (−y) as a ribbon's: local y ∈ [1, 2] the conduit's own (high)
// tile, y ∈ [0, 1] the low tile it pours into, the wall between them at y = 1; heights from the
// low top (0) to the high one (`h` levels). One sprite: seen from the camera (+x +y) the pipe shows
// where the low side faces it; otherwise it stands behind the high column and only its hood peeks
// over the edge (world/stand.ts `liftZ`).
//
// Plan: the hood and the duct seen from above, a dark drop band on the low side, a double chevron
// in the water's pale for the way down, a fleck of foam beyond.
import { flat, ink, type Ctx, type Pt } from '../ink';
import { IsoFrame, box, faceQuad, facePt, type Face, type RRect } from '../iso-shapes';
import { rivet } from '../shapes';
import { C, mix } from '../tokens';
import { BELT_TIERS } from './belts';
import type { Rot } from '@/sim/types';

const T = BELT_TIERS.conduit;
/** The downpipe across the way (local x), its depth off the wall (tiles); the hood's reach over the high tile and its rise above it. */
export const FALL = { x0: 0.29, x1: 0.71, depth: 0.17, reach: 0.13, rise: 0.13 } as const;
/** The glazed steel's faces (the conduit's fill and its rails' steel). */
const GLAZE = { top: mix(T.fill, C.paper, 0.2), left: T.fill, right: mix(T.fill, C.ink, 0.35) };

/** Of a box (rotated), the visible face that looks along local (0, s), or null when it faces away. */
function faceToward(f: IsoFrame, s: number): Face | null {
  const [ax, ay] = f.r(0.5, 1), [bx, by] = f.r(0.5, 1 + s);
  return by - ay > 0.5 ? 'L' : bx - ax > 0.5 ? 'R' : null;
}

/** The faces of a box (rotated) that look across the way (along local ±x) and are in sight. */
function sideFaces(f: IsoFrame): Face[] {
  const out: Face[] = [];
  for (const s of [-1, 1]) {
    const [ax, ay] = f.r(0.5, 1), [bx, by] = f.r(0.5 + s, 1);
    if (by - ay > 0.5) out.push('L'); else if (bx - ax > 0.5) out.push('R');
  }
  return out;
}

/** The window down a face: the deep water, pale streaks falling in it, a glint on its lit edge. */
function waterWindow(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, z0: number, z1: number, s: number): void {
  const q = faceQuad(f, rr, face, 0.28, 0.72, z0, z1);
  flat(ctx, q, C.deep, 0.95);
  for (let k = 0, z = z1 - 0.12; z > z0 + 0.08; z -= 0.23, k++) {
    const u = k % 2 ? 0.42 : 0.56;
    ink(ctx, [facePt(f, rr, face, u, z), facePt(f, rr, face, u, z - 0.13)], { w: 1.4, color: C.shallow, alpha: 0.9, shade: false, taper: 0.3, jitter: 0, seed: s + k });
  }
  ink(ctx, [facePt(f, rr, face, 0.34, z1 - 0.02), facePt(f, rr, face, 0.34, z0 + 0.02)], { w: 1.4, color: '#ffffff', alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: s + 20 });
  ink(ctx, q, { closed: true, w: 1.1, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 21 });
}

/** Foam at the downpipe's foot on the low tile: pale lobes in the water's light, a few drops. */
function foam(ctx: Ctx, f: IsoFrame, y: number): void {
  const lobes: ReadonlyArray<readonly [number, number, number]> = [[0.5, 0, 4.2], [0.39, 0.03, 3.2], [0.61, 0.02, 3.4], [0.45, -0.05, 2.6], [0.56, -0.06, 2.4]];
  for (const [x, dy, r] of lobes) { const [px, py] = f.p(x, y + dy, 0.05); flat(ctx, [[px - r - 1, py], [px, py - r * 0.7 - 1], [px + r + 1, py], [px, py + r * 0.55 + 1]], C.shallow, 0.9); }
  for (const [i, [x, dy, r]] of lobes.entries()) {
    const [px, py] = f.p(x, y + dy, 0.07);
    flat(ctx, Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * Math.PI * 2; return [px + Math.cos(a) * r, py + Math.sin(a) * r * 0.62] as Pt; }), C.paper, 0.95);
    if (i < 2) flat(ctx, [[px - r * 0.4, py - r * 0.2], [px, py - r * 0.45], [px + r * 0.2, py - r * 0.2]], '#ffffff', 0.9);
  }
  for (const [x, dz] of [[0.36, 0.22], [0.64, 0.3], [0.52, 0.4]] as const) {
    const [px, py] = f.p(x, y - 0.02, dz);
    flat(ctx, [[px - 1.2, py], [px, py - 1.6], [px + 1.2, py], [px, py + 1.2]], C.paper, 0.9);
  }
}

/** The downpipe on the 1 × 2 frame: the duct on its clamps, its window, the hood over the edge, the foam at its foot. */
function fall(ctx: Ctx, f: IsoFrame, h: number, s: number): void {
  const { x0, x1, depth, reach, rise } = FALL;
  const y0 = 1 - depth, y1 = 1;
  const duct = box(ctx, f, x0, y0, x1, y1, 0.02, h, GLAZE, s, { shadow: false, outline: 1.6, hatchRight: false });
  const front = faceToward(f, -1);
  if (front) waterWindow(ctx, f, duct, front, 0.12, h - 0.1, s + 1);
  // Two clamps round the duct, bolted to the wall.
  for (const [k, z] of [0.42, h - 0.42].entries()) {
    for (const fc of [front, ...sideFaces(f)]) {
      if (!fc) continue;
      flat(ctx, faceQuad(f, duct, fc, 0, 1, z - 0.06, z + 0.06), T.rail);
      ink(ctx, [facePt(f, duct, fc, 0, z + 0.06), facePt(f, duct, fc, 1, z + 0.06)], { w: 0.9, color: C.steelL, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 10 + k });
    }
    if (front) { const [px, py] = facePt(f, duct, front, 0.5, z); rivet(ctx, px, py, 1.4, C.steelL); }
  }
  // The hood: the conduit's end bent over the edge, down into the duct.
  const hood = box(ctx, f, x0 - 0.03, y0 - 0.02, x1 + 0.03, y1 + reach, h - 0.12, h + rise, GLAZE, s + 20, { shadow: false, outline: 1.6, hatchRight: false });
  const [a0, b0, a1, b1] = hood;
  flat(ctx, [f.pr(a0 + 0.06, b0 + 0.06, h + rise), f.pr(a1 - 0.06, b0 + 0.06, h + rise), f.pr(a1 - 0.06, b1 - 0.06, h + rise), f.pr(a0 + 0.06, b1 - 0.06, h + rise)], mix(T.fill, C.steel, 0.25), 0.6);
  for (const fc of [front, ...sideFaces(f)]) {
    if (!fc) continue;
    flat(ctx, faceQuad(f, hood, fc, 0, 1, h - 0.12, h - 0.06), T.rail);
  }
  foam(ctx, f, y0 - 0.08);
}

/**
 * A conduit's fall for a conduit facing `rot`, `h` levels down to the low top, on the 1 × 2 frame
 * (anchored, as an iso building's, at its rotated footprint's top corner on the low top). `make`
 * gives a canvas.
 */
export function drawFall(rot: Rot, h: number, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const f = new IsoFrame(1, 2, rot, h + FALL.rise + 0.35);
  const { ctx, canvas } = make(f.W, f.H);
  fall(ctx, f, h, 61);
  return { canvas, frame: f };
}

/** The plan mark's canvas size (px; one tile, centred on the wall). */
export const FALL_TOP_PX = 64;

/**
 * A fall from above, its way north, on a one-tile canvas centred on the wall (the canvas's middle
 * row; the low tile north of it): the hood over the edge with the water in its mouth, the duct's
 * top beyond it, the dark drop band on the low side, a double chevron for the way down, foam.
 */
export function drawFallTop(ctx: Ctx, seed = 29): void {
  const S = FALL_TOP_PX, m = S / 2;
  const x0 = FALL.x0 * S, x1 = FALL.x1 * S, d = FALL.depth * S, r = FALL.reach * S;
  // The drop: a dark band across the whole line on the low side, the cliff's shade under the pipe.
  const b0 = S * 0.11, b1 = S * 0.89;
  flat(ctx, [[b0, m], [b1, m], [b1 + 2, m - d - 10], [b0 + 2, m - d - 10]], C.ink, 0.38);
  // Foam beyond it.
  for (const [dx, dy, rr] of [[0, -11, 3.4], [-6, -9, 2.4], [6, -10, 2.6]] as const) {
    flat(ctx, Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * Math.PI * 2; return [m + dx + Math.cos(a) * rr, m - d + dy + Math.sin(a) * rr] as Pt; }), C.paper, 0.9);
  }
  // The hood and the duct's top: glazed steel, the deep water in the mouth.
  const hood: Pt[] = [[x0 - 2, m - d - 1], [x1 + 2, m - d - 1], [x1 + 2, m + r], [x0 - 2, m + r]];
  flat(ctx, hood, GLAZE.top);
  flat(ctx, [[x0 + 3, m - d + 2], [x1 - 3, m - d + 2], [x1 - 3, m + r - 3], [x0 + 3, m + r - 3]], C.deep, 0.95);
  ink(ctx, [[x0 + 5, m + r - 4], [x0 + 5, m - d + 3]], { w: 1.4, color: '#ffffff', alpha: 0.6, shade: false, taper: 0, jitter: 0, seed });
  ink(ctx, hood, { closed: true, w: 1.8, taper: 0, jitter: 0.2, seed: seed + 1 });
  // The way down: a double chevron in the water's pale.
  for (const [k, y] of [m + 4, m - 3].entries()) ink(ctx, [[m - 6, y], [m, y - 5], [m + 6, y]], { w: 2.2, color: C.shallow, shade: false, taper: 0, jitter: 0, seed: seed + 2 + k });
  for (const x of [x0 - 2, x1 + 2]) rivet(ctx, x, m, 1.6, C.steelL);
}
