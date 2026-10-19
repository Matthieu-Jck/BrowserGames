// falls.ts — a conduit's water pouring one terrace down (D114: a conduit whose next tile stands one
// terrace lower hands its water on to it; it never climbs). Where it does, the pipe goes down the
// terrace's wall on the low side (D145: the conduit is a raised pipe, recipes/pipes.ts): it runs on
// over the high tile's edge at its own height, bends down in a long-radius elbow just past the lip,
// drops as a riser against the wall on two clamps bolted to it — a sight window halfway showing the
// water falling in pale streaks — and comes down onto the low tile's pipe, a collar where they meet.
// It is the conduit's analogue of the traction ribbon's elevator (lifts.ts), drawn on the same
// frame and laid the same way (world/traction-lifts.ts `fallOfConduit`, world/buildings-view.ts).
//
// Iso: a 1 × 2 frame, its way north (−y) as a ribbon's: local y ∈ [1, 2] the conduit's own (high)
// tile, y ∈ [0, 1] the low tile it pours into, the wall between them at y = 1; heights from the
// low top (0) to the high one (`h` levels). One sprite: seen from the camera (+x +y) the riser shows
// where the low side faces it; otherwise it stands behind the high column and only its elbow peeks
// over (world/stand.ts `liftZ`).
//
// Plan: the pipe seen from above — the tube over the edge to the elbow's round back, a flange at the
// lip, a clamp — over a dark drop band on the low side. No chevron: the drop band says the way down.
import { ellipsePts, flat, ink, shape, type Ctx, type Pt } from '../ink';
import { IsoFrame, box } from '../iso-shapes';
import { rivet } from '../shapes';
import { C, mix } from '../tokens';
import { PLAN_R } from '../pipe-ports';
import { RUN, flangeIso, tube, type P3 } from './pipes';
import type { Rot } from '@/sim/types';

/** The riser's axis off the wall, the elbow's bend radius (tiles), how far over the high tile the drawing reaches; kept for the plan mark. */
export const FALL = { off: RUN.r + 0.035, bend: 0.2, reach: 0.15 } as const;

const GLASS = C.deep, GLASS_D = C.deepD, DARK = C.steelD;

/** A horizontal hoop round the riser at height z (the half the camera sees): a clamp, a collar. */
function hoop(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, r: number, w: number, seed: number): void {
  const [cx, cy] = f.p(x, y, z), [ex, ey] = f.ell(r);
  const arc = ellipsePts(cx, cy, ex, ey, seed, 0, 40).filter(([, py]) => py >= cy - 0.3).sort((a, b) => a[0] - b[0]);
  ink(ctx, arc, { w, color: DARK, shade: false, taper: 0, jitter: 0, seed });
}

/** The pipe down the wall on the 1 × 2 frame: over the edge, the elbow, the riser on its clamps, its window, the collar on the low pipe. */
function fall(ctx: Ctx, f: IsoFrame, h: number, s: number): void {
  const { off, bend } = FALL, Z = RUN.z, zH = h + Z, x = 0.5, y = 1 - off;
  const across = [1, 0, 0] as const;
  // Clamp brackets to the wall, behind the riser.
  const zc = [Z + 0.33, zH - 0.55];
  for (const z of zc) box(ctx, f, x - 0.035, y + RUN.r * 0.5, x + 0.035, 1, z - 0.05, z + 0.05, DARK, s + 1, { outline: 1.2, shadow: false });
  // Over the edge: the high pipe's last stretch, a flange at the lip, then the elbow and the riser down to the low pipe.
  tube(ctx, f, [[x, 1 + FALL.reach, zH], [x, 1.03, zH]], { across, ext0: true, seed: s });
  flangeIso(ctx, f, [x, 1.02, zH], 'y', s + 2);
  const arc: P3[] = Array.from({ length: 11 }, (_, i) => { const a = (i / 10) * (Math.PI / 2); return [x, y + bend - Math.sin(a) * bend, zH - (1 - Math.cos(a)) * bend * 2] as P3; });
  const w0 = Z + 0.6, w1 = zH - 0.82; // the window, between the clamps
  const foot = Z + RUN.r * 1.6; // into the low pipe's crown
  tube(ctx, f, [[x, 1.0, zH], [x, y + bend, zH], ...arc, [x, y, w1]], { across, seed: s + 3 });
  tube(ctx, f, [[x, y, w0], [x, y, foot]], { across, seed: s + 4 });
  if (w1 > w0 + 0.1) {
    tube(ctx, f, [[x, y, w1], [x, y, w0]], { across, col: GLASS, shade: GLASS_D, glint: 1.4, seed: s + 5 });
    // The water falling: pale streaks on the side the camera sees.
    const [nx, ny] = [x + 0.06, y - 0.06];
    for (let k = 0, z = w1 - 0.1; z > w0 + 0.1; z -= 0.24, k++) {
      const dx = k % 2 ? -0.03 : 0.03;
      ink(ctx, [f.p(nx + dx, ny - dx, z), f.p(nx + dx, ny - dx, z - 0.12)], { w: 1.4, color: C.shallow, alpha: 0.95, shade: false, taper: 0.3, jitter: 0, seed: s + 10 + k });
    }
    hoop(ctx, f, x, y, w1, RUN.r * 1.12, 3, s + 6);
    hoop(ctx, f, x, y, w0, RUN.r * 1.12, 3, s + 7);
  }
  for (const [k, z] of zc.entries()) {
    hoop(ctx, f, x, y, z, RUN.r * 1.08, 2.6, s + 20 + k);
    const [px, py] = f.p(x, y - RUN.r * 1.08, z);
    rivet(ctx, px, py, 1.5, C.steelL);
  }
  hoop(ctx, f, x, y, foot + 0.02, RUN.r * 1.2, 3.2, s + 30); // the collar on the low pipe
}

/**
 * A conduit's fall for a conduit facing `rot`, `h` levels down to the low top, on the 1 × 2 frame
 * (anchored, as an iso building's, at its rotated footprint's top corner on the low top). `make`
 * gives a canvas.
 */
export function drawFall(rot: Rot, h: number, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const f = new IsoFrame(1, 2, rot, h + RUN.z + RUN.flange * 2 + 0.25);
  const { ctx, canvas } = make(f.W, f.H);
  fall(ctx, f, h, 61);
  return { canvas, frame: f };
}

/** The plan mark's canvas size (px; one tile, centred on the wall). */
export const FALL_TOP_PX = 64;

/**
 * A fall from above, its way north, on a one-tile canvas centred on the wall (the canvas's middle
 * row; the low tile north of it): the dark drop band on the low side, the tube from the high side
 * over the lip — a flange there — to the elbow's round back over the riser, its clamp.
 */
export function drawFallTop(ctx: Ctx, seed = 29): void {
  const S = FALL_TOP_PX, m = S / 2, hw = PLAN_R * S, d = FALL.off * S;
  // The drop: a dark band across the line on the low side, the cliff's shade under the pipe.
  const b0 = S * 0.18, b1 = S * 0.82;
  flat(ctx, [[b0, m], [b1, m], [b1 + 2, m - d - 9], [b0 + 2, m - d - 9]], C.ink, 0.34);
  // The tube over the lip, rounded at the elbow's back.
  const end = m - d;
  const body: Pt[] = [[m - hw, S / 2 + 18], [m - hw, end], ...Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i / 8) * Math.PI; return [m + Math.cos(a) * hw, end + Math.sin(a) * hw] as Pt; }), [m + hw, end], [m + hw, S / 2 + 18]];
  flat(ctx, body.map(([x, y]) => [x + 1.5, y + 2] as Pt), C.ink, 0.2);
  shape(ctx, body, C.steelL, { w: 1.8, shade: false, jitter: 0, seed });
  flat(ctx, [[m + hw - 3.4, S / 2 + 18], [m + hw - 3.4, end], [m + hw, end], [m + hw, S / 2 + 18]], mix(C.steelL, C.ink, 0.32));
  ink(ctx, [[m, S / 2 + 18], [m, end - hw * 0.4]], { w: 2.4, color: '#ffffff', alpha: 0.62, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  // The flange at the lip and the clamp over the riser.
  const fl: Pt[] = [[m - hw - 3.6, m + 1], [m + hw + 3.6, m + 1], [m + hw + 3.6, m + 5], [m - hw - 3.6, m + 5]];
  shape(ctx, fl, mix(C.steelL, '#ffffff', 0.18), { w: 1.4, shade: false, jitter: 0, seed: seed + 2 });
  for (const x of [m - hw - 1.6, m + hw + 1.6]) rivet(ctx, x, m + 3, 1.4, C.brassL);
  flat(ctx, [[m - hw - 1, end - 1.3], [m + hw + 1, end - 1.3], [m + hw + 1, end + 1.3], [m - hw - 1, end + 1.3]], C.steelD, 0.9);
}
