// buildings.ts — one drawing recipe per building, in 2:1 isometric volume, in the Moebius ink
// idiom pushed to contrasted mechanical sci-fi. The base is fully automated — built by drones,
// piloted from Verrière, nobody lives there (docs/lore.md) — so every building is a machine and
// says what it does: rigs and derricks, hoppers and incline belts, banded tanks, brick furnaces
// with stacks, presses, sawtooth halls and gantries, spools, transformers, capacitor cans, a
// cooling tower… — riveted steel, teal/violet housings, coral/brass hot parts, hazard stripes,
// LEDs. Nothing shows people (no lit windows, doors, walkways, planters, houses): the base's own
// buildings show machine things — the Heart's fortified depot under its solar rows and uplink
// dish, drone pads and the drones on them, status beacons, sensor and relay masts, the trade
// post's landing pad in its scorched apron. Domes are for instruments only (the observatory's telescope).
// Routing blocks share one body: a box whose four sides open on ribbon mouths exactly as wide as
// the ribbon's band, the lid saying what the block does. Recipes draw in the building's own
// (unrotated) tile frame; the IsoFrame rotates the footprint so light and shading always fall the
// same way, and a Scene queue draws parts far to near (big neighbours are ordered by which one
// the rotation brings nearer). Ports come from the content (back ones first, front ones last).
import { BUILDINGS, type BuildingId } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import { makeRng } from '@/core/rng';
import { sideIndex, type Rot } from '@/sim/types';
import { C, mix } from '../tokens';
import { castShadow, ellipsePts, flat, hatch, ink, pathOf, shape, stipple, type Ctx, type Pt } from '../ink';
import { arrowPoly, crierMarkMapped, hull, light, rivet } from '../shapes';
import { pvPanel } from '../solar';
import {
  IS, IsoFrame, Scene, ShadowFrame, box, bucketWheelIso, cableIso, chevronIso, cupIso, cylinder,
  dishIso, domeIso, drumIso, faceGlow, faceGrille, faceHazard, faceInk, faceLeds, facePanel, facePt, faceQuad, frustumIso,
  latheIso, pipeIso, portIso, prismIso, slab, sphereIso, spireIso, terminalIso, trussIso, wheelIso, type Face, type Faces, type RRect,
} from '../iso-shapes';
import { CHARGER_BUSHING, HEART_MASTS, INSULATOR, KIT_K, POLE, PYLON, kitDrawn, onArm, terminalProbe, terminalsOf, turnsArt } from '../terminals';
import { SAND_WHEEL, TURBINE, bucketFull, vaneAt } from './moving';

/** Top of the foundation slab (levels). */
const SZ = 0.3;
const LEDS = [C.led, C.led, C.ledGreen, C.led] as const;

interface Recipe {
  /** Headroom above the ground (levels) for the tallest part. */
  head: number;
  /** The whole drawing (a building without a moving part). */
  draw?(ctx: Ctx, f: IsoFrame, s: number): void;
  /** A building with a moving part (moving.ts): its body and its part, drawn apart. */
  moving?: Moving;
}

/**
 * A moving part's two drawings (moving.ts). Body and part are parted by a plane (vertical, or
 * the horizontal one under a crown), so in each rotation one is wholly nearer the viewer than
 * the other: `over` says whether the part is the nearer one, drawn over the body.
 */
interface Moving {
  body(ctx: Ctx, f: IsoFrame, s: number): void;
  /** The part at phase t ∈ [0, 1) of its period. */
  part(ctx: Ctx, f: IsoFrame, s: number, t: number): void;
  over(f: IsoFrame): boolean;
  /** What the part casts as a shadow, if not its phase 0 (a spinning crown casts a solid band). */
  shadow?(ctx: Ctx, f: IsoFrame, s: number): void;
}

/** A derrick: legs from base points up to an apex, cross braces, a beacon on top. */
function derrick(ctx: Ctx, f: IsoFrame, legs: ReadonlyArray<readonly [number, number, number]>, apex: readonly [number, number, number], s: number): void {
  const sorted = [...legs].sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
  for (const [i, l] of sorted.entries()) {
    pipeIso(ctx, f, [l, apex], 3.2, C.steelL, s + i, false);
    const m: [number, number, number] = [(l[0] + apex[0]) / 2, (l[1] + apex[1]) / 2, (l[2] + apex[2]) / 2];
    const n = sorted[(i + 1) % sorted.length]!;
    const m2: [number, number, number] = [(n[0] + apex[0]) / 2, (n[1] + apex[1]) / 2, (n[2] + apex[2]) / 2];
    ink(ctx, [f.p(...m), f.p(...m2)], { w: 1.4, color: C.steelD, shade: false, taper: 0, seed: s + 10 + i });
  }
  const [ax, ay] = f.p(...apex);
  shape(ctx, ellipsePts(ax, ay, 5, 4, s + 20, 0, 14), C.steelD, { w: 1.2, shade: false });
  light(ctx, ax, ay - 2, 2.6, C.ledWarm);
}

// ── machine parts shared by several recipes ─────────────────────────────────

/** Fired brick (furnaces, kilns) and the pale concrete of cooling towers. */
const BRICK = mix(C.coralD, C.mesa, 0.45);
const TOWER = mix(C.ice, C.steelL, 0.35);
type V3 = [number, number, number];

/** Is a local side's face turned to the camera once rotated? */
const facing = (f: IsoFrame, side: number): boolean => { const d = f.dir(side); return d === 1 || d === 2; };

/** The local direction that the rotation turns into the screen-fixed rotated direction (rx, ry). */
function facingDir(f: IsoFrame, rx: number, ry: number): [number, number] {
  switch (f.rot) {
    case 0: return [rx, ry];
    case 1: return [ry, -rx];
    case 2: return [-rx, -ry];
    default: return [-ry, rx];
  }
}

/** Gear teeth: dark ticks round the top rim of a drum (rotary tables, turntables). */
function gearTeeth(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, z: number, n: number, s: number): void {
  const c = f.p(cx, cy, z);
  const [ex, ey] = f.ell(r);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ink(ctx, [[c[0] + Math.cos(a) * ex * 0.78, c[1] + Math.sin(a) * ey * 0.78], [c[0] + Math.cos(a) * ex * 0.98, c[1] + Math.sin(a) * ey * 0.98]], { w: 1.5, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
}

/** A chimney stack: a ringed steel tube with a flared lip, its throat glowing hot. */
function stackIso(ctx: Ctx, f: IsoFrame, x: number, y: number, r: number, z1: number, s: number, glow: string = C.ledWarm, z0 = SZ): void {
  latheIso(ctx, f, x, y, [[z0, r * 1.3], [z0 + 0.12, r * 1.3], [z0 + 0.12, r], [z1 - 0.22, r], [z1 - 0.22, r * 1.2], [z1, r * 1.2]], C.steelD, s, { open: C.ink });
  const t = f.p(x, y, z1);
  const [ex, ey] = f.ell(r * 0.85);
  flat(ctx, ellipsePts(t[0], t[1] + ey * 0.25, ex * 0.75, ey * 0.6, s + 1, 0, 16), glow, 0.9);
  light(ctx, t[0], t[1] - 2, 2.4, glow);
}

/** A crawler track along local y, centred on x: treads across the top, road wheels on its sides. */
function crawler(ctx: Ctx, f: IsoFrame, x: number, y0: number, y1: number, s: number): void {
  const rr = box(ctx, f, x - 0.27, y0, x + 0.27, y1, SZ, 0.78, { top: C.steelDD, left: mix(C.steelD, C.ink, 0.05), right: mix(C.steelD, C.ink, 0.35) }, s, { outline: 1.8 });
  for (let i = 1; i < 12; i++) {
    const y = y0 + ((y1 - y0) * i) / 12;
    ink(ctx, [f.p(x - 0.25, y, 0.78), f.p(x + 0.25, y, 0.78)], { w: 1.4, color: C.steel, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  for (const face of ['L', 'R'] as const) {
    const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
    const n = Math.max(1, Math.round(len / 0.36));
    for (let i = 0; i < n; i++) {
      const [px, py] = facePt(f, rr, face, (i + 0.5) / n, (SZ + 0.78) / 2);
      shape(ctx, ellipsePts(px, py, 5.5, 5.5, s + 20 + i, 0, 16), C.steel, { w: 1.3, shade: false, jitter: 0, seed: s + 20 + i });
      rivet(ctx, px, py, 1.8, C.steelL);
    }
  }
}

/** Rubble heaped in a hopper's mouth (the mouth's canvas polygon). */
function rubble(ctx: Ctx, mouth: readonly Pt[], s: number): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of mouth) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const heap = ellipsePts((x0 + x1) / 2, (y0 + y1) / 2 + 1, (x1 - x0) * 0.33, (y1 - y0) * 0.3, s, 0.18, 20);
  flat(ctx, heap, C.dug);
  stipple(ctx, x0, y0, x1 - x0, y1 - y0, 60, { clip: heap, color: C.inkSoft, alpha: 0.55, seed: s + 1, r: 1.1 });
  ink(ctx, heap, { closed: true, w: 1, alpha: 0.6, shade: false, seed: s + 2 });
}

/** An incline belt along local y between x0 and x1: from (ya, za) up to (yb, zb) on trestles. */
function incline(ctx: Ctx, f: IsoFrame, x0: number, x1: number, ya: number, za: number, yb: number, zb: number, s: number): void {
  const at = (x: number, t: number, dz = 0): Pt => f.p(x, ya + (yb - ya) * t, za + (zb - za) * t + dz);
  for (const t of [0.3, 0.72]) {
    for (const x of [x0 + 0.05, x1 - 0.05]) {
      const y = ya + (yb - ya) * t, z = za + (zb - za) * t;
      pipeIso(ctx, f, [[x, y, SZ], [x, y, z - 0.1]], 3, C.steelD, s + t * 10 + x * 3, false);
    }
  }
  for (const x of [x0, x1]) shape(ctx, [at(x, 0), at(x, 1), at(x, 1, -0.16), at(x, 0, -0.16)], C.steel, { w: 1.2, shade: false, jitter: 0, seed: s + x * 10 });
  const top: Pt[] = [at(x0, 0), at(x1, 0), at(x1, 1), at(x0, 1)];
  flat(ctx, top, C.tealL);
  for (let k = 1; k < 9; k++) ink(ctx, [at(x0 + 0.03, k / 9), at(x1 - 0.03, k / 9)], { w: 1.5, color: C.teal, shade: false, taper: 0, jitter: 0, seed: s + 20 + k });
  ink(ctx, top, { closed: true, w: 1.6, seed: s + 3 });
  for (const x of [x0, x1]) ink(ctx, [at(x, 0, 0.04), at(x, 1, 0.04)], { w: 2.4, color: C.steelL, shade: false, taper: 0, seed: s + 30 + x * 10 });
}

/** A ladder standing at local (x, y), rungs along local direction (tx, ty), from z0 to z1. */
function ladderIso(ctx: Ctx, f: IsoFrame, x: number, y: number, tx: number, ty: number, z0: number, z1: number, s: number): void {
  const w = 0.07;
  const a = (k: number, z: number): Pt => f.p(x + tx * w * k, y + ty * w * k, z);
  for (const k of [-1, 1]) ink(ctx, [a(k, z0), a(k, z1)], { w: 1.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + k });
  for (let z = z0 + 0.14; z < z1; z += 0.16) ink(ctx, [a(-1, z), a(1, z)], { w: 1, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + z * 10 });
}

/** A point on a visible sloped face of a frustum (same args as frustumIso): u across, t up. */
function frustumPt(f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, inset: number, face: Face, u: number, t: number): Pt {
  const [a0, b0, a1, b1] = f.rect(x0, y0, x1, y1);
  const k = inset * t, z = z0 + (z1 - z0) * t;
  return face === 'L' ? f.pr(a0 + k + (a1 - a0 - 2 * k) * u, b1 - k, z) : f.pr(a1 - k, b1 - k - (b1 - b0 - 2 * k) * u, z);
}

/** A glowing arched furnace mouth on a face, given its (u across, t up) → canvas mapping. */
function archMouth(ctx: Ctx, at: (u: number, t: number) => Pt, u0: number, u1: number, t1: number, s: number): void {
  const arch = (k: number): Pt[] => {
    const um = (u0 + u1) / 2, hu = ((u1 - u0) / 2) * k, th = t1 * (0.35 + 0.65 * k);
    const pts: Pt[] = [at(um - hu, 0)];
    for (let i = 0; i <= 10; i++) { const a = Math.PI - (i / 10) * Math.PI; pts.push(at(um + Math.cos(a) * hu, th * 0.55 + Math.sin(a) * th * 0.45)); }
    pts.push(at(um + hu, 0));
    return pts;
  };
  shape(ctx, arch(1), C.warn, { w: 1.6, shade: false, seed: s });
  flat(ctx, arch(0.62), C.glowPeach);
  ink(ctx, [at(u0 + 0.04, 0.05), at(u1 - 0.04, 0.05)], { w: 2, color: C.coralD, shade: false, taper: 0, seed: s + 1 });
  const [cx, cy] = at((u0 + u1) / 2, t1 * 0.4);
  light(ctx, cx, cy, 3.4, C.ledWarm);
}

/**
 * A furnace on a local rect: a battered brick shaft strapped with steel, a glowing arched mouth
 * on the lit face, a charging hopper on its roof full of embers.
 */
function furnace(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z1: number, inset: number, s: number): void {
  frustumIso(ctx, f, x0, y0, x1, y1, SZ, z1, inset, { top: C.steelD, left: BRICK, right: mix(BRICK, C.ink, 0.35) }, s);
  const at = (face: Face) => (u: number, t: number): Pt => frustumPt(f, x0, y0, x1, y1, SZ, z1, inset, face, u, t);
  for (const face of ['L', 'R'] as const) {
    for (let t = 0.11; t < 0.98; t += 0.11) ink(ctx, [at(face)(0.01, t), at(face)(0.99, t)], { w: 1, color: C.ink, alpha: 0.3, shade: false, taper: 0, jitter: 0.2, seed: s + t * 100 });
    for (const t of [0.4, 0.8]) ink(ctx, [at(face)(0, t), at(face)(1, t)], { w: 2.6, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + t * 10 });
  }
  archMouth(ctx, at('L'), 0.3, 0.7, 0.36, s + 5);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hw = Math.min(x1 - x0, y1 - y0) / 2 - inset - 0.1;
  const mouth = frustumIso(ctx, f, cx - hw, cy - hw, cx + hw, cy + hw, z1, z1 + 0.32, -0.07, { top: C.steelL }, s + 6, { open: C.ink, shadow: false });
  let mx = 0, my = 0;
  for (const [x, y] of mouth) { mx += x / mouth.length; my += y / mouth.length; }
  flat(ctx, ellipsePts(mx, my + 2, 8, 4, s + 7, 0.2, 16), C.warn);
  light(ctx, mx, my + 1, 3, C.ledWarm);
}

/** A wire spool across local x: brass windings between steel flanges, on A-frame stands. */
function spoolIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, s: number): void {
  const xs = [cx - 0.34, cx + 0.34].sort((a, b) => f.depth(a, cy) - f.depth(b, cy));
  pipeIso(ctx, f, [[xs[0]!, cy - 0.16, 0.55], [xs[0]!, cy, cz], [xs[0]!, cy + 0.16, 0.55]], 3, C.steelD, s, false);
  const parts = [cx - 0.26, cx, cx + 0.26].sort((a, b) => f.depth(a, cy) - f.depth(b, cy));
  for (const x of parts) {
    if (x === cx) drumIso(ctx, f, cx, cy, cz, 0.19, 0.24, 'x', C.brass, s + 1, { bands: [-0.6, -0.2, 0.2, 0.6], shadow: false });
    else drumIso(ctx, f, x, cy, cz, 0.3, 0.025, 'x', C.steelL, s + 2 + x * 10, { shadow: false });
  }
  pipeIso(ctx, f, [[xs[1]!, cy - 0.16, 0.55], [xs[1]!, cy, cz], [xs[1]!, cy + 0.16, 0.55]], 3, C.steelD, s + 3, false);
}

/**
 * A press frame across local x (x0…x1) centred on y0…y1: a hazard-edged bolster with a coral
 * blank, two violet columns, a ram with its die, and a crown beam carrying the cylinder.
 */
function pressFrame(ctx: Ctx, f: IsoFrame, sc: Scene, x0: number, x1: number, y0: number, y1: number, zt: number, s: number): void {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ym0 = cy - 0.2, ym1 = cy + 0.2;
  sc.add(f.depth(cx, cy) - 0.02, () => {
    const rr = box(ctx, f, x0 + 0.15, y0, x1 - 0.15, y1, SZ, 0.72, C.steelL, s);
    faceHazard(ctx, f, rr, 'L', 0.03, 0.97, 0.6, 0.7, s + 1);
    box(ctx, f, cx - 0.3, cy - 0.16, cx + 0.3, cy + 0.16, 0.72, 0.8, { top: C.coral }, s + 2, { outline: 1.4, shadow: false });
  });
  for (const [i, xa] of [x0, x1 - 0.28].entries()) {
    sc.add(f.depth(xa + 0.14, cy), () => {
      const rr = box(ctx, f, xa, ym0, xa + 0.28, ym1, SZ, zt, C.violet, s + 3 + i);
      faceLeds(ctx, f, rr, 'L', zt - 0.3, 0.5, 0.5, 1, [C.ledWarm]);
    });
  }
  sc.add(f.depth(cx, cy) + 0.01, () => {
    cylinder(ctx, f, cx, cy, 0.15, 1.34, zt, C.steelL, s + 5);
    box(ctx, f, cx - 0.36, ym0 + 0.02, cx + 0.36, ym1 - 0.02, 1.2, 1.36, { top: C.steelD }, s + 6, { outline: 1.5 });
  });
  sc.add(99, () => {
    const rr = box(ctx, f, x0 - 0.04, ym0 - 0.06, x1 + 0.04, ym1 + 0.06, zt, zt + 0.45, C.violet, s + 7);
    faceGrille(ctx, f, rr, 'L', 0.1, 0.35, zt + 0.08, zt + 0.37, s + 8, 3);
    faceLeds(ctx, f, rr, 'L', zt + 0.22, 0.6, 0.9, 3, LEDS);
    cylinder(ctx, f, cx, cy, 0.2, zt + 0.45, zt + 0.7, C.steelD, s + 9, { top: C.brass });
    light(ctx, ...f.p(cx, cy, zt + 0.72), 2.2, C.ledWarm);
  });
}

/**
 * A hall under a sawtooth roof: violet walls (a door, LEDs, an intake), then `teeth` roof bays
 * along local y, each rising to a louvred face that looks south (local +y).
 */
function sawHall(ctx: Ctx, f: IsoFrame, sc: Scene, x0: number, y0: number, x1: number, y1: number, zw: number, teeth: number, s: number, base = 0): void {
  sc.add(base, () => {
    const rr = box(ctx, f, x0, y0, x1, y1, SZ, zw, { top: C.steelD, left: C.violet, right: mix(C.violet, C.ink, 0.38) }, s);
    facePanel(ctx, f, rr, 'L', 0.62, 0.84, SZ + 0.02, zw - 0.2, C.steelL, s + 1);
    faceLeds(ctx, f, rr, 'L', zw - 0.12, 0.08, 0.5, 5, LEDS);
    faceGrille(ctx, f, rr, 'R', 0.12, 0.6, SZ + 0.15, zw - 0.15, s + 2);
  });
  const bays = Array.from({ length: teeth }, (_, k) => k).sort((a, b) => f.depth((x0 + x1) / 2, y0 + (a + 0.5) * (y1 - y0) / teeth) - f.depth((x0 + x1) / 2, y0 + (b + 0.5) * (y1 - y0) / teeth));
  for (const [i, k] of bays.entries()) {
    sc.add(base + 0.01 * (i + 1), () => {
      const ty0 = y0 + ((y1 - y0) * k) / teeth, ty1 = ty0 + (y1 - y0) / teeth, zt = zw + 0.6;
      prismIso(ctx, f, [[x0, ty0], [x1, ty0], [x1, ty1], [x0, ty1]], zw, [zw, zw, zt, zt], C.steelL, s + 10 + k, { outline: 1.8, shadow: false });
      if (!facing(f, 2)) return;
      const q: Pt[] = [f.p(x0 + 0.06, ty1, zw + 0.06), f.p(x1 - 0.06, ty1, zw + 0.06), f.p(x1 - 0.06, ty1, zt - 0.06), f.p(x0 + 0.06, ty1, zt - 0.06)];
      shape(ctx, q, C.steelDD, { w: 1.1, shade: false, jitter: 0, seed: s + 20 + k });
      for (const z of [zw + 0.18, zw + 0.3, zw + 0.42]) ink(ctx, [f.p(x0 + 0.08, ty1, z), f.p(x1 - 0.08, ty1, z)], { w: 1.2, color: C.steelL, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 30 + k });
    });
  }
}

/** A gantry crane over a yard (local rect): hazard legs, runway beams, a coral bridge, a crate on the hook. */
function gantry(ctx: Ctx, f: IsoFrame, sc: Scene, x0: number, y0: number, x1: number, y1: number, zt: number, s: number, base = 0): void {
  for (const [i, [x, y]] of ([[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const).entries()) {
    sc.add(base + f.depth(x, y), () => box(ctx, f, x - 0.06, y - 0.06, x + 0.06, y + 0.06, SZ, zt, { top: C.hazard, left: C.brass, right: mix(C.brass, C.ink, 0.4) }, s + i, { outline: 1.4 }));
  }
  const ym = (y0 + y1) / 2, tx = x0 + (x1 - x0) * 0.62;
  sc.add(base + f.depth((x0 + x1) / 2, ym) + 0.05, () => {
    for (const x of [x0, x1]) box(ctx, f, x - 0.07, y0 - 0.06, x + 0.07, y1 + 0.06, zt, zt + 0.12, { top: C.steelL }, s + 10 + x, { outline: 1.4, shadow: false });
    box(ctx, f, x0 - 0.05, ym - 0.08, x1 + 0.05, ym + 0.08, zt + 0.12, zt + 0.3, { top: C.coral }, s + 12, { outline: 1.6, shadow: false });
    box(ctx, f, tx - 0.14, ym - 0.12, tx + 0.14, ym + 0.12, zt + 0.3, zt + 0.42, { top: C.steelD }, s + 13, { outline: 1.4, shadow: false });
    ink(ctx, [f.p(tx, ym, zt + 0.12), f.p(tx, ym, 1.08)], { w: 1.4, color: C.steelDD, shade: false, taper: 0, seed: s + 14 });
    const rr = box(ctx, f, tx - 0.22, ym - 0.14, tx + 0.22, ym + 0.14, 0.72, 1.06, { top: C.teal }, s + 15, { outline: 1.6 });
    for (let k = 1; k < 6; k++) ink(ctx, [facePt(f, rr, 'L', k / 6, 0.75), facePt(f, rr, 'L', k / 6, 1.03)], { w: 1, color: mix(C.teal, C.ink, 0.5), shade: false, taper: 0, jitter: 0, seed: s + 16 + k });
  });
}

/** A robot arm on a turntable: coral segments, brass joints, a two-finger claw. */
function robotArm(ctx: Ctx, f: IsoFrame, x: number, y: number, s: number): void {
  cylinder(ctx, f, x, y, 0.2, SZ, 0.55, C.steelD, s, { top: C.coral });
  const j1: V3 = [x, y, 0.62], j2: V3 = [x + 0.12, y + 0.28, 1.5], tip: V3 = [x + 0.48, y + 0.32, 1.1];
  pipeIso(ctx, f, [j1, j2], 7, C.coral, s + 1);
  pipeIso(ctx, f, [j2, tip], 5, C.coral, s + 2);
  rivet(ctx, ...f.p(...j2), 4, C.brassL);
  const t = f.p(...tip);
  ink(ctx, [[t[0] - 6, t[1] + 7], [t[0] - 2, t[1]], [t[0] + 2, t[1]], [t[0] + 6, t[1] + 7]], { w: 2.4, color: C.steelD, shade: false, taper: 0, seed: s + 3 });
  light(ctx, ...f.p(x, y, 0.58), 2.2, C.ledWarm);
}

/** Courses and staggered joints of brickwork on a box face. */
function brickwork(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, z0: number, z1: number, s: number): void {
  for (let z = z0 + 0.1, row = 0; z < z1 - 0.02; z += 0.1, row++) {
    ink(ctx, [facePt(f, rr, face, 0.01, z), facePt(f, rr, face, 0.99, z)], { w: 1, color: C.ink, alpha: 0.3, shade: false, taper: 0, jitter: 0.2, seed: s + row });
    for (let u = (row % 2 ? 0.06 : 0.12); u < 0.98; u += 0.12) ink(ctx, [facePt(f, rr, face, u, z), facePt(f, rr, face, u, z - 0.1)], { w: 0.9, color: C.ink, alpha: 0.25, shade: false, taper: 0, jitter: 0, seed: s + row * 20 + u * 100 });
  }
}

/** A small glowing spy-hole on a face. */
function spyHole(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u: number, z: number): void {
  flat(ctx, faceQuad(f, rr, face, u - 0.07, u + 0.07, z - 0.17, z + 0.17), C.ledWarm, 0.25);
  shape(ctx, faceQuad(f, rr, face, u - 0.045, u + 0.045, z - 0.12, z + 0.12), C.warn, { w: 1.2, shade: false, jitter: 0 });
  const [x, y] = facePt(f, rr, face, u, z);
  light(ctx, x, y, 2, C.ledWarm);
}

/** Vertical cooling fins on a face (transformers, capacitors). */
function fins(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, z0: number, z1: number, n: number, s: number): void {
  for (let i = 1; i <= n; i++) {
    const u = i / (n + 1);
    ink(ctx, [facePt(f, rr, face, u, z0), facePt(f, rr, face, u, z1)], { w: 2.4, color: C.ink, alpha: 0.45, shade: false, taper: 0, jitter: 0, seed: s + i });
    ink(ctx, [facePt(f, rr, face, u - 0.012, z0), facePt(f, rr, face, u - 0.012, z1)], { w: 0.9, color: '#ffffff', alpha: 0.35, shade: false, taper: 0, jitter: 0, seed: s + 20 + i });
  }
}

/** A cartoon steam puff: overlapping lobes inked as one cloud, the belly hatched. */
function puff(ctx: Ctx, x: number, y: number, r: number, s: number): void {
  const lobes = [[0, 0, 1], [-0.75, 0.25, 0.7], [0.75, 0.2, 0.75], [-0.3, -0.45, 0.65], [0.35, -0.4, 0.6]] as const;
  for (const [dx, dy, k] of lobes) flat(ctx, ellipsePts(x + dx * r, y + dy * r, r * k + 1.6, r * k + 1.6, s, 0.05, 20), C.ink, 0.75);
  for (const [dx, dy, k] of lobes) flat(ctx, ellipsePts(x + dx * r, y + dy * r, r * k, r * k, s, 0.05, 20), C.paper);
  const belly = ellipsePts(x + r * 0.3, y + r * 0.45, r * 0.8, r * 0.35, s + 1, 0.05, 20);
  ctx.save(); pathOf(ctx, belly); ctx.clip();
  hatch(ctx, belly, Math.PI / 4, 2.6, { alpha: 0.3, seed: s });
  ctx.restore();
}

/**
 * A dish concentrator at local (cx, cy), its centre cz levels up: a faceted mirror bowl of
 * radius R tiles tilted to the light, three struts to the glowing receiver at its focus.
 */
function sunDish(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, R: number, s: number): void {
  const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const [hx, hy] = facingDir(f, -0.25, 0.12);
  const n = norm([hx, hy, 1]);
  const u = norm([-n[1], n[0], 0]);
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const czt = cz / 2; // in tiles (2 levels per tile) so the dish is round in 3D
  const P = (q: V3): Pt => f.p(q[0], q[1], q[2] * 2);
  const at = (a: number, rho: number, back = 0): V3 => {
    const sag = 0.17 * (1 - rho * rho) + back;
    return [cx + R * rho * (Math.cos(a) * u[0] + Math.sin(a) * v[0]) - n[0] * sag, cy + R * rho * (Math.cos(a) * u[1] + Math.sin(a) * v[1]) - n[1] * sag, czt + R * rho * (Math.cos(a) * u[2] + Math.sin(a) * v[2]) - n[2] * sag];
  };
  const ring = (rho: number, back = 0): Pt[] => Array.from({ length: 48 }, (_, i) => P(at((i / 48) * Math.PI * 2, rho, back)));
  pipeIso(ctx, f, [[cx, cy, 1.0], [cx - n[0] * 0.3, cy - n[1] * 0.3, (czt - n[2] * 0.3) * 2]], 7, C.steelD, s, false);
  const rim = ring(1);
  castShadow(ctx, rim, 10, 0.25);
  shape(ctx, ring(1, 0.06), C.steelD, { w: 1.6, seed: s + 1 });
  flat(ctx, rim, mix(C.ice, C.ink, 0.22));
  ctx.save(); pathOf(ctx, rim); ctx.clip();
  const lit = rim.map(([x, y]) => [x + 7, y + 5] as Pt);
  flat(ctx, lit, C.ice);
  hatch(ctx, rim, Math.PI / 4, 3, { alpha: 0.2, seed: s + 2 });
  for (const rho of [0.36, 0.7]) ink(ctx, ring(rho), { closed: true, w: 1.1, color: C.steelL, shade: false, seed: s + 3 + rho * 10 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ink(ctx, [P(at(a, 0.1)), P(at(a, 1))], { w: 1, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 5 + i });
  }
  ctx.restore();
  ink(ctx, rim, { closed: true, w: 2.2, seed: s + 6 });
  const F: V3 = [cx + n[0] * 0.62, cy + n[1] * 0.62, czt + n[2] * 0.62];
  for (const [i, a] of [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6].entries()) {
    const p = at(a, 0.96);
    ink(ctx, [P(p), P(F)], { w: 4.2, color: C.ink, shade: false, taper: 0, seed: s + 9 + i });
    ink(ctx, [P(p), P(F)], { w: 2.2, color: C.steelL, shade: false, taper: 0, seed: s + 10 + i });
  }
  const [fx, fy] = P(F);
  flat(ctx, ellipsePts(fx, fy, 30, 30, s + 18, 0, 28), C.ledWarm, 0.14);
  flat(ctx, ellipsePts(fx, fy, 19, 19, s + 19, 0, 24), C.ledWarm, 0.22);
  sphereIso(ctx, f, F[0], F[1], F[2] * 2, 0.15, C.glowPeach, s + 20, C.warn);
  light(ctx, fx - 2, fy - 4, 6, C.ledWarm);
}

/**
 * The sunheart's armillary: three coil rings round a core at (cx, cy, cz). Draw the far halves
 * (front = false) before the core and the near halves (front = true) after it.
 */
function armillary(ctx: Ctx, f: IsoFrame, cx: number, cy: number, cz: number, s: number, front: boolean): void {
  const czt = cz / 2;
  const rings: Array<{ e1: V3; e2: V3; R: number; col: string }> = [
    { e1: [1, 0, 0], e2: [0, 1, 0], R: 1.62, col: C.brass },
    { e1: [Math.SQRT1_2, -Math.SQRT1_2, 0], e2: [0, 0, 1], R: 1.38, col: C.steelL },
    { e1: [0.5, 0.5, Math.SQRT1_2], e2: [-Math.SQRT1_2, Math.SQRT1_2, 0], R: 1.24, col: C.steelL },
  ];
  const d0 = f.depth(cx, cy);
  for (const [k, { e1, e2, R, col }] of rings.entries()) {
    const pts = Array.from({ length: 97 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      const q: V3 = [cx + R * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]), cy + R * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]), czt + R * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])];
      return { p: f.p(q[0], q[1], q[2] * 2), near: f.depth(q[0], q[1]) - d0 + (q[2] - czt) > 0 };
    });
    let run: Pt[] = [];
    const flush = (): void => {
      if (run.length > 1) {
        ink(ctx, run, { w: 9, color: C.ink, shade: false, taper: 0, jitter: 0.1, seed: s + k });
        ink(ctx, run, { w: 6, color: col, shade: false, taper: 0, jitter: 0.1, seed: s + 10 + k });
        ink(ctx, run.map(([x, y]) => [x - 1, y - 1.5] as Pt), { w: 1.4, color: '#ffffff', alpha: 0.5, shade: false, taper: 0, jitter: 0.1, seed: s + 20 + k });
        if (front) for (let i = 4; i < run.length; i += 9) light(ctx, run[i]![0], run[i]![1], 1.8, k === 0 ? C.ledWarm : C.led);
      }
      run = [];
    };
    for (const { p, near } of pts) { if (near === front) run.push(p); else flush(); }
    flush();
  }
}

// ── the automated base: pads, drones, beacons, the uplink, solar rows ───────────
// Nobody lives at the base (docs/lore.md): drones build it, Verrière pilots it from afar. So
// nothing shows people — no windows lit from inside, doors, walkways, gardens or crews — and
// the buildings that once housed them show machine things instead: drone pads and the drones
// parked on them, status beacons, uplink dishes and sensor masts, the CrierBelt mark.

/** Height of the trade post's landing deck (levels): the Crier's cargo craft sets down on it (world/cargo-view; world/cargo-flight.ts mirrors it). */
export const DECK_Z = 0.8;
/** The construction drones' body: hazard yellow, like any site machine. */
const DRONE: Faces = { top: C.hazard, left: mix(C.hazard, C.coralD, 0.3), right: mix(C.hazard, C.ink, 0.42) };

/** Rotated (screen-fixed) footprint coords → local coords: the inverse of `IsoFrame.r`. */
function unrot(f: IsoFrame, rx: number, ry: number): [number, number] {
  switch (f.rot) {
    case 0: return [rx, ry];
    case 1: return [ry, f.h - rx];
    case 2: return [f.w - rx, f.h - ry];
    default: return [f.w - ry, rx];
  }
}

/** Yellow-and-ink hazard stripes over a canvas quad. */
function hazardQuad(ctx: Ctx, q: readonly Pt[], s: number): void {
  flat(ctx, q, C.hazard);
  ctx.save(); pathOf(ctx, q); ctx.clip();
  hatch(ctx, q, Math.PI / 4, 6, { w: 2.6, alpha: 0.85, seed: s });
  ctx.restore();
  ink(ctx, q, { closed: true, w: 1, shade: false, jitter: 0, seed: s + 1 });
}

/**
 * A construction drone — one of the remote builders — at local (x, y), its skids at height z: a
 * hazard-yellow body with a cyan eye, four arms out to translucent rotor discs, a red nav light.
 * `lift` levels up it hovers over its own shadow; `cargo` slings a crate of that colour under it.
 */
function droneIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, s: number, o: { lift?: number; cargo?: string } = {}): void {
  const zb = z + (o.lift ?? 0), zr = zb + 0.2;
  if (o.lift) {
    const c = f.p(x, y, z);
    const [ex, ey] = f.ell(0.18);
    flat(ctx, ellipsePts(c[0] + 2, c[1] + 1, ex, ey, s, 0, 20), C.ink, 0.2);
  }
  if (o.cargo) {
    for (const k of [-1, 1]) ink(ctx, [f.p(x + k * 0.04, y, zb + 0.06), f.p(x + k * 0.07, y, zb - 0.24)], { w: 1, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 30 + k });
    container(ctx, f, x - 0.11, y - 0.08, x + 0.11, y + 0.08, zb - 0.52, zb - 0.24, o.cargo, s + 31);
  }
  const hubs = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([a, b]) => [x + a * 0.15, y + b * 0.15] as const)
    .sort((p, q) => f.depth(p[0], p[1]) - f.depth(q[0], q[1]));
  for (const [i, [hx, hy]] of hubs.entries()) {
    if (i === 2) {
      // Skids, then the body between the far rotors and the near ones.
      for (const k of [-1, 1]) {
        ink(ctx, [f.p(x - 0.09, y + k * 0.06, zb), f.p(x + 0.09, y + k * 0.06, zb)], { w: 1.5, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 1 + k });
        for (const j of [-1, 1]) ink(ctx, [f.p(x + j * 0.05, y + k * 0.06, zb), f.p(x + j * 0.04, y + k * 0.05, zb + 0.07)], { w: 1, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 3 + k + j });
      }
      const rr = box(ctx, f, x - 0.075, y - 0.065, x + 0.075, y + 0.065, zb + 0.06, zb + 0.16, DRONE, s + 20, { outline: 1.3, shadow: false });
      light(ctx, ...facePt(f, rr, 'L', 0.5, zb + 0.11), 1.6, C.led);
    }
    const a = f.p(x, y, zb + 0.13), c = f.p(hx, hy, zr);
    ink(ctx, [a, c], { w: 3.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 8 + i });
    ink(ctx, [a, c], { w: 1.8, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 12 + i });
    const [ex, ey] = f.ell(0.1);
    const disc = ellipsePts(c[0], c[1], ex, ey, s + 16 + i, 0, 20);
    flat(ctx, disc, C.ice, 0.5);
    ink(ctx, disc, { closed: true, w: 0.9, alpha: 0.7, shade: false, jitter: 0, seed: s + 20 + i });
    ink(ctx, [[c[0] - ex * 0.75, c[1] + ey * 0.2], [c[0] + ex * 0.75, c[1] - ey * 0.2]], { w: 1.2, color: '#ffffff', alpha: 0.75, shade: false, taper: 0.3, jitter: 0, seed: s + 24 + i });
    rivet(ctx, c[0], c[1], 1.3, C.steelD);
  }
  const [nx, ny] = hubs[0]!;
  light(ctx, ...f.p(nx, ny, zr + 0.05), 1.1, C.ledRed);
}

/** A drone pad on a surface at height z: a dark disc, a hazard ring and a cross, rim lights. Returns its top. */
function padIso(ctx: Ctx, f: IsoFrame, x: number, y: number, r: number, z: number, s: number): number {
  const zt = z + 0.08;
  cylinder(ctx, f, x, y, r, z, zt, C.steelD, s, { top: mix(C.steelD, C.steel, 0.4) });
  const c = f.p(x, y, zt);
  const [ex, ey] = f.ell(r * 0.72);
  ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 1, 0, 40), { closed: true, w: 2.6, color: C.hazard, shade: false, jitter: 0.1, seed: s + 1 });
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    ink(ctx, [f.p(x - dx * r * 0.42, y - dy * r * 0.42, zt), f.p(x + dx * r * 0.42, y + dy * r * 0.42, zt)], { w: 2.2, color: C.ice, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 2 + dx });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    light(ctx, ...f.p(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, zt), 1.4, i % 2 ? C.ledGreen : C.led);
  }
  return zt;
}

/** A status beacon: a short post from z0 up to z1, crowned by a caged lamp of `color`. */
function beaconIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z0: number, z1: number, color: string, s: number): void {
  pipeIso(ctx, f, [[x, y, z0], [x, y, z1]], 2.6, C.steelD, s, false);
  const c = f.p(x, y, z1);
  shape(ctx, ellipsePts(c[0], c[1], 4.4, 2.4, s + 1, 0, 14), C.steelDD, { w: 1, shade: false, jitter: 0, seed: s + 1 });
  light(ctx, c[0], c[1] - 3.2, 2.8, color);
  ink(ctx, [[c[0] - 3.6, c[1] - 0.5], [c[0] - 2.8, c[1] - 6.5], [c[0] + 2.8, c[1] - 6.5], [c[0] + 3.6, c[1] - 0.5]], { w: 1, color: C.steelDD, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 2 });
}

/**
 * One of the Heart's two link masts (art/terminals.ts `HEART_MASTS`), where its wires meet: a
 * steel tube on its plinth, a coral collar with a status light, and on top a big porcelain
 * insulator (`terminalIso`) whose clamp, at `top`, is the wire's terminal.
 */
function linkMastIso(ctx: Ctx, f: IsoFrame, x: number, y: number, top: number, s: number): void {
  const c0 = top - INSULATOR;
  cylinder(ctx, f, x, y, 0.14, SZ, SZ + 0.24, C.steelD, s, { top: C.steel });
  pipeIso(ctx, f, [[x, y, SZ + 0.24], [x, y, c0 - 0.1]], 4.4, C.steelL, s + 1, false);
  latheIso(ctx, f, x, y, [[c0 - 0.14, 0.06], [c0 - 0.02, 0.06], [c0, 0.045]], C.coral, s + 2, { top: C.coralL, shadow: false, seams: false, outline: 1.2 });
  light(ctx, ...f.p(x, y, c0 - 0.08), 1.6, C.led);
  terminalIso(ctx, f, { x, y, z: top }, s + 3, 1.35);
}

const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along3 = (p: V3, n: V3, k: number): V3 => [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k];

/**
 * A parabolic dish in 3D — local tiles, z in TILES here (2 levels per tile, so it stays round):
 * centre D, radius R, unit axis n, its concave face turned to the camera. Draws the back edge,
 * the face (panel rings and ribs, lit on its lower right since it is concave; the CrierBelt mark
 * round the vertex if `mark`), then `struts` struts to a feed horn at `focal`·R on the axis.
 * Returns the feed point (same units).
 */
function dish3d(ctx: Ctx, f: IsoFrame, D: V3, R: number, n: V3, s: number, o: { focal?: number; struts?: number; mark?: boolean } = {}): V3 {
  const u = norm3([-n[1], n[0], 0]);
  const v = cross3(n, u);
  const depth = 0.2 * R, k = Math.min(1, R);
  const P = (q: V3): Pt => f.p(q[0], q[1], q[2] * 2);
  const at = (a: number, rho: number, back = 0): V3 => {
    const c = Math.cos(a) * R * rho, d = Math.sin(a) * R * rho, sag = depth * (1 - rho * rho) + back;
    return [D[0] + c * u[0] + d * v[0] - n[0] * sag, D[1] + c * u[1] + d * v[1] - n[1] * sag, D[2] + c * u[2] + d * v[2] - n[2] * sag];
  };
  const ring = (rho: number, back = 0): Pt[] => Array.from({ length: 64 }, (_, i) => P(at((i / 64) * Math.PI * 2, rho, back)));
  const rim = ring(1);
  castShadow(ctx, rim, 6 + 10 * k, 0.2);
  shape(ctx, ring(1, 0.08 * R), C.steelD, { w: 1.2 + 0.6 * k, seed: s });
  flat(ctx, rim, mix(C.ice, C.ink, 0.25));
  ctx.save(); pathOf(ctx, rim); ctx.clip();
  flat(ctx, rim.map(([x, y]) => [x + 14 * k, y + 10 * k] as Pt), C.ice);
  hatch(ctx, rim, Math.PI / 4, 3.2, { alpha: 0.16, seed: s + 1 });
  for (const rho of [0.36, 0.68]) ink(ctx, ring(rho), { closed: true, w: 0.8 + 0.4 * k, color: C.steelL, shade: false, seed: s + 2 + rho * 10 });
  const ribs = R >= 0.5 ? 16 : 8;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    ink(ctx, [P(at(a, 0.24)), P(at(a, 1))], { w: 1, color: C.steelL, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 5 + i });
  }
  if (o.mark) {
    // Painted on the curved face round the vertex: the mark's right along v, its down along −u.
    const mk = 0.42 * R;
    crierMarkMapped(ctx, (a, b) => {
      const pa = mk * a, pb = -mk * b, sag = depth * (1 - (pa * pa + pb * pb) / (R * R));
      return P([D[0] + pa * v[0] + pb * u[0] - n[0] * sag, D[1] + pa * v[1] + pb * u[1] - n[1] * sag, D[2] + pa * v[2] + pb * u[2] - n[2] * sag]);
    }, mk * IS * 1.2, s + 30);
  }
  ctx.restore();
  ink(ctx, rim, { closed: true, w: 1.4 + 1.2 * k, seed: s + 25 });
  const F = along3(D, n, (o.focal ?? 0.95) * R);
  const ns = o.struts ?? 4;
  for (let i = 0; i < ns; i++) {
    const p = P(at(((i + 0.5) / ns) * Math.PI * 2, 0.96));
    ink(ctx, [p, P(F)], { w: 2.2 + 2.2 * k, color: C.ink, shade: false, taper: 0, seed: s + 40 + i });
    ink(ctx, [p, P(F)], { w: 1 + 1.2 * k, color: C.steelL, shade: false, taper: 0, seed: s + 45 + i });
  }
  const h0 = along3(F, n, -0.14 * R);
  pipeIso(ctx, f, [[h0[0], h0[1], h0[2] * 2], [F[0], F[1], F[2] * 2]], 3 + 7 * k, C.steelL, s + 50, false);
  return F;
}

/**
 * The Heart's uplink to Verrière and CrierBelt: a big dish (`dish3d`) of radius R tiles whose
 * axis leans `tilt` from the vertical towards the screen's left — the far horizon — on a pedestal
 * and an arm from the roof at `roofZ` (no mark on its face: owner, 2026-10-13). Its feed horn sits on the
 * axis at local (fx, fy), just under `top` (levels): the topmost point. The uplink beacon blinks
 * there, where the night rig (recipes/fx `nightRig`) puts its pulse — over the footprint's
 * centre, at `isoHead`. Screen-fixed: the same dish in every rotation (`uplinkTop` in
 * buildings-top.ts draws it from above with the same numbers).
 */
function uplinkIso(ctx: Ctx, f: IsoFrame, fx: number, fy: number, top: number, R: number, tilt: number, roofZ: number, s: number): void {
  const [lx, ly] = facingDir(f, -Math.SQRT1_2, Math.SQRT1_2);
  const n: V3 = [lx * Math.sin(tilt), ly * Math.sin(tilt), Math.cos(tilt)];
  const depth = 0.2 * R;
  const D = along3([fx, fy, (top - 0.22) / 2], n, -0.95 * R);
  // The pedestal under the dish's back, its bearing, and the arm up to the dish.
  const hub = along3(D, n, -(depth + 0.16)), back = along3(D, n, -depth - 0.03);
  cylinder(ctx, f, hub[0], hub[1], 0.27, roofZ, roofZ + 0.42, C.steelD, s, { top: C.steel });
  cylinder(ctx, f, hub[0], hub[1], 0.17, roofZ + 0.42, hub[2] * 2 - 0.3, C.steelL, s + 1, { top: C.brass, rings: 1 });
  pipeIso(ctx, f, [[hub[0], hub[1], hub[2] * 2 - 0.34], [hub[0], hub[1], hub[2] * 2], [back[0], back[1], back[2] * 2]], 9, C.steelD, s + 2);
  const F = dish3d(ctx, f, D, R, n, s + 3, { focal: 0.95, struts: 4 });
  const b = f.p(fx, fy, top);
  ink(ctx, [f.p(F[0], F[1], F[2] * 2), b], { w: 2.4, color: C.steelD, shade: false, taper: 0, seed: s + 59 });
  light(ctx, b[0], b[1], 3.4, C.led);
}

/**
 * A row of solar panels on a roof at height z, laid out in ROTATED (screen-fixed) coords: rx0…rx1
 * along the row in `m` panels, ry0…ry1 across it. They tilt up towards the back on short legs,
 * facing the screen's lower left. Their cells are `pvPanel`'s (solar.ts), so the day / night
 * views find them: nothing may be drawn over a row afterwards.
 */
function pvRowIso(ctx: Ctx, f: IsoFrame, rx0: number, ry0: number, rx1: number, ry1: number, z: number, m: number, s: number): void {
  const lo = z + 0.14, hi = lo + (ry1 - ry0) * 0.95, t = 0.06;
  flat(ctx, [f.pr(rx0 + 0.05, ry0 + 0.03, z), f.pr(rx1 + 0.05, ry0 + 0.03, z), f.pr(rx1 + 0.05, ry1 + 0.05, z), f.pr(rx0 + 0.05, ry1 + 0.05, z)], C.ink, 0.22);
  const gap = 0.05, w = (rx1 - rx0 - gap * (m - 1)) / m;
  for (let i = 0; i < m; i++) {
    const a0 = rx0 + i * (w + gap), a1 = a0 + w;
    for (const [j, x] of [a0 + 0.08, a1 - 0.08].entries()) {
      ink(ctx, [f.pr(x, ry0 + 0.05, z), f.pr(x, ry0 + 0.05, hi - t)], { w: 1.5, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + i * 4 + j });
      ink(ctx, [f.pr(x, ry1 - 0.05, z), f.pr(x, ry1 - 0.05, lo - t)], { w: 1.5, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + i * 4 + j + 2 });
    }
    flat(ctx, [f.pr(a0, ry1, lo), f.pr(a1, ry1, lo), f.pr(a1, ry1, lo - t), f.pr(a0, ry1, lo - t)], C.steelD);
    flat(ctx, [f.pr(a1, ry0, hi), f.pr(a1, ry1, lo), f.pr(a1, ry1, lo - t), f.pr(a1, ry0, hi - t)], C.steelDD);
    pvPanel(ctx, [f.pr(a0, ry0, hi), f.pr(a1, ry0, hi), f.pr(a1, ry1, lo), f.pr(a0, ry1, lo)], 3, 2, s + 10 + i);
  }
}

/** A short roller conveyor laid on the slab between a port and the depot (local rect; rollers across `along`). */
function apronBelt(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, along: 'x' | 'y', s: number): void {
  const z = SZ + 0.005;
  const q: Pt[] = [f.p(x0, y0, z), f.p(x1, y0, z), f.p(x1, y1, z), f.p(x0, y1, z)];
  flat(ctx, q, C.steelDD);
  const L = along === 'y' ? y1 - y0 : x1 - x0, n = Math.max(2, Math.round(L / 0.09));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const [a, b] = along === 'y'
      ? [f.p(x0 + 0.04, y0 + (y1 - y0) * t, z), f.p(x1 - 0.04, y0 + (y1 - y0) * t, z)]
      : [f.p(x0 + (x1 - x0) * t, y0 + 0.04, z), f.p(x0 + (x1 - x0) * t, y1 - 0.04, z)];
    ink(ctx, [a, b], { w: 1.3, color: C.steelL, alpha: 0.55, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  ink(ctx, q, { closed: true, w: 1.3, alpha: 0.85, shade: false, jitter: 0, seed: s + 40 });
}

/** The Heart's depot: a battered block of armour plate in the middle of the slab (centred: local = rotated). */
const DEP = { x0: 1, y0: 1, x1: 4, y1: 4, z: 1.45, inset: 0.14 } as const;
const WALL = mix(C.steel, C.violet, 0.22);
/** The Heart's height: the uplink beacon over the centre (levels). */
const HEART_TOP = 4.6;
/** The Heart's solar rows on the roof, in rotated coords (rx0, ry0, rx1, ry1, panels): clear of the dish in both views. */
const HEART_PV: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [1.3, 2.35, 2.0, 2.75, 1],
  [1.3, 2.95, 3.45, 3.35, 3],
  [1.3, 3.43, 3.45, 3.83, 3],
];
/** Status beacons on the roof's corners (rotated coords, colour): the far one stands behind the dish. */
const HEART_BEACONS: ReadonlyArray<readonly [number, number, string]> = [
  [3.73, 1.27, C.ledWarm], [1.24, 3.78, C.ledGreen], [3.76, 3.76, C.ledGreen],
];

/**
 * The Heart's depot, fortified: battered walls of riveted armour plate on a dark foot, louvred
 * vents under the roof's edge, a drone hatch on the roof, and a curtained mouth wherever a ribbon
 * comes in — strip curtains under a hazard-striped lintel, as wide as the port it faces.
 * `mouths`: local points on the depot's base edge.
 */
function depotIso(ctx: Ctx, f: IsoFrame, mouths: ReadonlyArray<readonly [number, number]>, s: number): void {
  const { x0, y0, x1, y1, z, inset } = DEP;
  frustumIso(ctx, f, x0, y0, x1, y1, SZ, z, inset, { top: C.steelD, left: WALL, right: mix(WALL, C.ink, 0.4) }, s);
  const faceAt = (face: Face) => (u: number, t: number): Pt => frustumPt(f, x0, y0, x1, y1, SZ, z, inset, face, u, t);
  for (const face of ['L', 'R'] as const) {
    const A = faceAt(face);
    flat(ctx, [A(0, 0), A(1, 0), A(1, 0.09), A(0, 0.09)], C.steelDD);
    for (let i = 1; i < 6; i++) ink(ctx, [A(i / 6, 0.09), A(i / 6, 0.98)], { w: 1.1, color: C.ink, alpha: 0.32, shade: false, taper: 0, jitter: 0, seed: s + 10 + i });
    ink(ctx, [A(0.005, 0.62), A(0.995, 0.62)], { w: 3.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 20 });
    for (let i = 0; i < 12; i++) rivet(ctx, ...A((i + 0.5) / 12, 0.62), 1.5, C.steelL);
    for (let i = 0; i < 6; i++) {
      const um = (i + 0.5) / 6;
      flat(ctx, [A(um - 0.05, 0.74), A(um + 0.05, 0.74), A(um + 0.05, 0.9), A(um - 0.05, 0.9)], C.steelDD);
      for (const t of [0.79, 0.85]) ink(ctx, [A(um - 0.045, t), A(um + 0.045, t)], { w: 0.9, color: C.steelL, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 30 + i });
    }
  }
  const [a0, b0, a1, b1] = f.rect(x0, y0, x1, y1);
  for (const [i, [mx, my]] of mouths.entries()) {
    const [rx, ry] = f.r(mx, my);
    const face: Face | null = Math.abs(ry - b1) < 0.01 ? 'L' : Math.abs(rx - a1) < 0.01 ? 'R' : null;
    if (!face) continue;
    const u = face === 'L' ? (rx - a0) / (a1 - a0) : (b1 - ry) / (b1 - b0);
    const A = faceAt(face), du = 0.2 / 3, tm = 0.4;
    flat(ctx, [A(u - du, 0), A(u + du, 0), A(u + du, tm), A(u - du, tm)], C.ink);
    for (let k = 1; k < 5; k++) {
      const uk = u - du + (2 * du * k) / 5;
      ink(ctx, [A(uk, tm - 0.03), A(uk, 0.04)], { w: 1.2, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 40 + i * 5 + k });
    }
    hazardQuad(ctx, [A(u - du - 0.015, tm + 0.13), A(u + du + 0.015, tm + 0.13), A(u + du + 0.015, tm), A(u - du - 0.015, tm)], s + 60 + i);
    for (const e of [u - du - 0.015, u + du]) shape(ctx, [A(e, tm), A(e + 0.015, tm), A(e + 0.015, 0), A(e, 0)], C.steelL, { w: 0.9, shade: false, jitter: 0, seed: s + 70 + i });
  }
  // A drone hatch on the roof (screen-fixed, behind the solar rows): hazard frame, shut leaves.
  const hq = (k: number): Pt[] => [f.pr(1.36 + k, 1.52 + k, z), f.pr(1.92 - k, 1.52 + k, z), f.pr(1.92 - k, 2.08 - k, z), f.pr(1.36 + k, 2.08 - k, z)];
  hazardQuad(ctx, hq(0), s + 80);
  shape(ctx, hq(0.06), mix(C.steelD, C.steel, 0.5), { w: 1.1, shade: false, jitter: 0, seed: s + 82 });
  ink(ctx, [f.pr(1.64, 1.58, z), f.pr(1.64, 2.02, z)], { w: 1.2, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 83 });
}

/** A cargo container: a box with corrugated sides. */
function container(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, col: string, s: number): RRect {
  const rr = box(ctx, f, x0, y0, x1, y1, z0, z1, col, s, { outline: 1.6 });
  for (const face of ['L', 'R'] as const) {
    const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
    const n = Math.max(3, Math.round(len / 0.07));
    for (let i = 1; i < n; i++) ink(ctx, [facePt(f, rr, face, i / n, z0 + 0.03), facePt(f, rr, face, i / n, z1 - 0.03)], { w: 1, color: mix(col, C.ink, 0.45), alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  return rr;
}

// ── routing blocks: shared body and lid parts ───────────────────────────────

/** Lid height of the routing blocks (levels). The game seats the chosen-item glyph on it. */
const LID = 0.5;
/** Top of the unloader's suction head, where its glyph window is. */
const UNLOADER_TOP = LID + 0.27;
/** Height of a ribbon mouth on a face (levels). */
const MOUTH = 0.3;
/** Lip colour of each side's mouths, by local side (N, E, S, W). */
type Lips = readonly [string, string, string, string];
const NEUTRAL: Lips = [C.brass, C.brass, C.brass, C.brass];
/** The router: its way in (the back, S) is a turquoise intake, its three ways out coral nozzles (the ports' code). */
const ROUTER_LIPS: Lips = [C.coral, C.coral, C.turq, C.coral];
type LRect = readonly [number, number, number, number];
/** Light painted steel of the routing blocks' walls (lit +y face, shaded +x face). */
const WALL_L = mix(C.steelL, C.steel, 0.25), WALL_R = mix(C.steel, C.ink, 0.12);

/** u ranges (0…1 across a face of the 0.04-inset box) of the mouths along a side of n tiles. */
function mouthsU(n: number): Array<[number, number]> {
  const span = n - 0.08;
  return Array.from({ length: n }, (_, i) => [(i + 0.2 - 0.04) / span, (i + 0.8 - 0.04) / span] as [number, number]);
}

/**
 * A ribbon mouth on a visible face: a dark throat exactly as wide as the ribbon's band (so the
 * ribbon on the ground runs straight in), a strip curtain, and a lip framing it like a door.
 */
function mouthIso(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, lip: string, s: number): void {
  const q = faceQuad(f, rr, face, u0, u1, 0, MOUTH);
  flat(ctx, q, C.ink);
  for (let k = 1; k < 4; k++) {
    const u = u0 + ((u1 - u0) * k) / 4;
    ink(ctx, [facePt(f, rr, face, u, MOUTH - 0.03), facePt(f, rr, face, u, 0.08)], { w: 1.1, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + k });
  }
  const du = 0.035;
  shape(ctx, faceQuad(f, rr, face, u0 - du, u1 + du, MOUTH, MOUTH + 0.08), lip, { w: 1, shade: false, jitter: 0, seed: s + 6 });
  shape(ctx, faceQuad(f, rr, face, u0 - du, u0, 0, MOUTH), lip, { w: 1, shade: false, jitter: 0, seed: s + 7 });
  shape(ctx, faceQuad(f, rr, face, u1, u1 + du, 0, MOUTH), lip, { w: 1, shade: false, jitter: 0, seed: s + 8 });
}

/**
 * A routing block's body: a riveted steel box on the whole footprint, lid at LID, whose sides
 * open on ribbon mouths — one per tile of each side, as wide as the ribbon's band, so a ribbon
 * arriving at any side plugs straight in. The faces turned to the camera show their mouths; the
 * far ones show as dark slots at the lid's edge.
 */
function forkBox(ctx: Ctx, f: IsoFrame, lid: string, lips: Lips, s: number): RRect {
  const rr = box(ctx, f, 0.04, 0.04, f.w - 0.04, f.h - 0.04, 0, LID, { top: lid, left: WALL_L, right: WALL_R }, s, { outline: 2 });
  for (let side = 0; side < 4; side++) {
    const d = f.dir(side);
    const n = side & 1 ? f.h : f.w;
    if (d === 1 || d === 2) {
      for (const [u0, u1] of mouthsU(n)) mouthIso(ctx, f, rr, d === 2 ? 'L' : 'R', u0, u1, lips[side]!, s + side * 7);
    } else {
      for (let i = 0; i < n; i++) {
        const [x0, y0, x1, y1] = side === 0 ? [i + 0.2, 0.04, i + 0.8, 0.1] : side === 2 ? [i + 0.2, f.h - 0.1, i + 0.8, f.h - 0.04] : side === 1 ? [f.w - 0.1, i + 0.2, f.w - 0.04, i + 0.8] : [0.04, i + 0.2, 0.1, i + 0.8];
        const q: Pt[] = [f.p(x0, y0, LID), f.p(x1, y0, LID), f.p(x1, y1, LID), f.p(x0, y1, LID)];
        shape(ctx, q, C.ink, { w: 1, shade: false, jitter: 0, seed: s + side * 7 + i });
      }
    }
  }
  for (const [x, y] of [[0.13, 0.13], [f.w - 0.13, 0.13], [0.13, f.h - 0.13], [f.w - 0.13, f.h - 0.13]] as const) rivet(ctx, ...f.p(x, y, LID), 1.8, C.steelL);
  return rr;
}

/** Local rect of a lane from r0 to r1 tiles out of (cx, cy) towards a side, half-width hw. */
function laneRect(side: number, cx: number, cy: number, r0: number, r1: number, hw: number): LRect {
  switch (side & 3) {
    case 0: return [cx - hw, cy - r1, cx + hw, cy - r0];
    case 1: return [cx + r0, cy - hw, cx + r1, cy + hw];
    case 2: return [cx - hw, cy + r0, cx + hw, cy + r1];
    default: return [cx - r1, cy - hw, cx - r0, cy + hw];
  }
}
/** The point d tiles out of (cx, cy) towards a side. */
const lanePt = (side: number, cx: number, cy: number, d: number): [number, number] =>
  [cx + [0, d, 0, -d][side & 3]!, cy + [-d, 0, d, 0][side & 3]!];

/** A recessed lane painted on the lid. */
function lidLane(ctx: Ctx, f: IsoFrame, [x0, y0, x1, y1]: LRect, color: string, s: number, z = LID): void {
  const q: Pt[] = [f.p(x0, y0, z), f.p(x1, y0, z), f.p(x1, y1, z), f.p(x0, y1, z)];
  flat(ctx, q, color);
  ink(ctx, q, { closed: true, w: 1.1, alpha: 0.75, shade: false, taper: 0, seed: s });
}

/** Where the intake funnel of a directional block starts (inside its back face), ends, and how high its hood rises. */
const FUNNEL_IN = 0.93, FUNNEL_OUT = 1.13, FUNNEL_Z = 0.82;

/**
 * The way in of a directional routing block (in from the back, S, only; owner 2026-10-12): a
 * turquoise hopper mouth flaring out of the back face over the incoming ribbon, its hood rising
 * above the lid. When the back faces the camera it shows its dark throat framed in turquoise;
 * when it does not, its hood stands up behind the lid. Draw it before the box in the second
 * case (`intakeFirst`) and last in the first.
 */
function intakeIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const base: Array<[number, number]> = [[0.19, FUNNEL_IN], [0.81, FUNNEL_IN], [0.95, FUNNEL_OUT], [0.05, FUNNEL_OUT]];
  prismIso(ctx, f, base, 0, [LID, LID, FUNNEL_Z, FUNNEL_Z], { top: C.turqL, left: C.turq, right: C.turqD }, s, { outline: 1.8 });
  if (!facing(f, 2)) return;
  // Seen into: the opening in the hood's face, its walls narrowing to the box's own mouth.
  const O = (x: number, z: number): Pt => f.p(x, FUNNEL_OUT, z), M = (x: number, z: number): Pt => f.p(x, 0.965, z);
  const ox0 = 0.12, ox1 = 0.88, oz = FUNNEL_Z - 0.1, mx0 = 0.22, mx1 = 0.78, mz = MOUTH + 0.05;
  const open = [O(ox0, oz), O(ox1, oz), O(ox1, 0), O(ox0, 0)];
  flat(ctx, open, C.ink);
  ctx.save(); pathOf(ctx, open); ctx.clip();
  flat(ctx, [O(ox0, oz), M(mx0, mz), M(mx0, 0), O(ox0, 0)], mix(C.turq, C.ink, 0.3));
  flat(ctx, [O(ox0, 0), O(ox1, 0), M(mx1, 0), M(mx0, 0)], mix(C.turqD, C.ink, 0.35));
  flat(ctx, [O(ox0, oz), O(ox1, oz), M(mx1, mz), M(mx0, mz)], mix(C.turqD, C.ink, 0.62));
  flat(ctx, [O(ox1, oz), M(mx1, mz), M(mx1, 0), O(ox1, 0)], mix(C.turqD, C.ink, 0.5));
  flat(ctx, [M(mx0, mz), M(mx1, mz), M(mx1, 0), M(mx0, 0)], C.ink);
  for (let k = 1; k < 4; k++) {
    const x = mx0 + ((mx1 - mx0) * k) / 4;
    ink(ctx, [M(x, mz - 0.04), M(x, 0.06)], { w: 1, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + k });
  }
  for (const [a, b] of [[O(ox0, oz), M(mx0, mz)], [O(ox1, oz), M(mx1, mz)], [O(ox0, 0), M(mx0, 0)], [O(ox1, 0), M(mx1, 0)]] as const) {
    ink(ctx, [a, b], { w: 0.9, alpha: 0.65, shade: false, taper: 0, jitter: 0, seed: s + 5 });
  }
  ctx.restore();
  ink(ctx, open, { closed: true, w: 1.5, shade: false, taper: 0, jitter: 0, seed: s + 6 });
  flat(ctx, [O(0.16, 0.07), O(0.84, 0.07), O(0.84, 0), O(0.16, 0)], C.turqL);
}

/** Is the intake funnel behind the box in this rotation (draw it first)? */
const intakeFirst = (f: IsoFrame): boolean => !facing(f, 2);

/** A flat arrow on a lid at height z (local tiles), filled and inked. */
function arrowIso(ctx: Ctx, f: IsoFrame, a: Array<[number, number]>, z: number, color: string, w: number, s: number): void {
  const pts = a.map(([x, y]) => f.p(x, y, z));
  flat(ctx, pts.map(([x, y]) => [x + 1.5, y + 2] as Pt), C.ink, 0.3);
  shape(ctx, pts, color, { w, shade: false, jitter: 0, seed: s });
}

/** The router's turntable hub: a short drum with a ring of LEDs and a cyan eye. */
function hubIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, s: number): void {
  cylinder(ctx, f, cx, cy, r, LID, LID + 0.13, C.steelL, s, { top: C.steel });
  const c = f.p(cx, cy, LID + 0.13);
  const [ex, ey] = f.ell(r * 0.62);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ink(ctx, [[c[0] + Math.cos(a) * ex * 0.35, c[1] + Math.sin(a) * ey * 0.35], [c[0] + Math.cos(a) * ex, c[1] + Math.sin(a) * ey]], { w: 1.6, color: C.steelDD, shade: false, taper: 0, seed: s + i });
  }
  light(ctx, c[0], c[1], 2.6, C.led);
}

/** A plain glyph window on a lid: paper-light, ink frame, bolted corners (the game draws the item in it). */
function windowIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, hr: number, z: number, s: number): void {
  const q: Pt[] = [f.p(cx - hr, cy - hr, z), f.p(cx + hr, cy - hr, z), f.p(cx + hr, cy + hr, z), f.p(cx - hr, cy + hr, z)];
  const rim: Pt[] = [f.p(cx - hr - 0.03, cy - hr - 0.03, z), f.p(cx + hr + 0.03, cy - hr - 0.03, z), f.p(cx + hr + 0.03, cy + hr + 0.03, z), f.p(cx - hr - 0.03, cy + hr + 0.03, z)];
  shape(ctx, rim, C.steelDD, { w: 1.2, shade: false, jitter: 0, seed: s });
  flat(ctx, q, C.paper);
  ink(ctx, q, { closed: true, w: 1.3, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 1 });
}

/** The chosen item's way (cyan) and the others' (coral), for sorters' lips and lanes. */
const CHOSEN = C.cyan, OTHERS = C.coral;

/**
 * Sorter / inverted sorter: lanes cross under a plain window (40 % of the tile) where the game
 * draws the chosen item. The chosen item's way is cyan (lane, lips, bright chevrons): straight
 * through for the sorter, out to the sides for the inverted one — which also wears a coral bar
 * across its straight lane. In from the back (S), out to the front (N) and the sides.
 */
function sorterIso(ctx: Ctx, f: IsoFrame, s: number, inverted: boolean): void {
  const [st, sd] = inverted ? [OTHERS, CHOSEN] : [CHOSEN, OTHERS];
  if (intakeFirst(f)) intakeIso(ctx, f, s + 60);
  forkBox(ctx, f, C.steel, [st, sd, C.turq, sd], s);
  lidLane(ctx, f, [0.35, 0.04, 0.65, 0.96], mix(st, C.ink, 0.15), s + 1);
  lidLane(ctx, f, [0.04, 0.35, 0.96, 0.65], mix(sd, C.ink, 0.15), s + 2);
  for (const [x, y, dir] of [[0.5, 0.15, 0], [0.5, 0.86, 0], [0.86, 0.5, 1], [0.14, 0.5, 3]] as const) chevronIso(ctx, f, x, y, LID, dir, 0.09, C.ice, s + 10 + dir + y, 2.6);
  windowIso(ctx, f, 0.5, 0.5, 0.2, LID, s + 20);
  if (inverted) {
    const bar: Pt[] = [f.p(0.3, 0.23, LID), f.p(0.7, 0.23, LID), f.p(0.7, 0.28, LID), f.p(0.3, 0.28, LID)];
    shape(ctx, bar, C.coral, { w: 1.3, shade: false, jitter: 0, seed: s + 30 });
  }
  if (!intakeFirst(f)) intakeIso(ctx, f, s + 60);
}

/**
 * Overflow / underflow gate: the open way is a cyan lane with chevrons; the other way is shut by
 * hazard-striped flaps standing on the lid at its mouths (they swing open when the open way
 * backs up). A brass valve sits in the middle. In from the back (S).
 */
function gateIso(ctx: Ctx, f: IsoFrame, s: number, under: boolean): void {
  const open = C.cyan, shut = C.hazard;
  if (intakeFirst(f)) intakeIso(ctx, f, s + 60);
  forkBox(ctx, f, C.steel, under ? [shut, open, C.turq, open] : [open, shut, C.turq, shut], s);
  const lane = mix(C.steel, C.ink, 0.3);
  lidLane(ctx, f, [0.35, 0.04, 0.65, 0.96], under ? lane : mix(open, C.ink, 0.15), s + 1);
  lidLane(ctx, f, [0.04, 0.35, 0.96, 0.65], under ? mix(open, C.ink, 0.15) : lane, s + 2);
  lidLane(ctx, f, [0.35, 0.5, 0.65, 0.96], mix(open, C.ink, 0.15), s + 3); // the way in is always open
  chevronIso(ctx, f, 0.5, 0.84, LID, 0, 0.09, C.ice, s + 4, 2.6);
  if (under) for (const side of [1, 3]) chevronIso(ctx, f, ...lanePt(side, 0.5, 0.5, 0.33), LID, side, 0.09, C.ice, s + 5 + side, 2.6);
  else chevronIso(ctx, f, 0.5, 0.17, LID, 0, 0.09, C.ice, s + 5, 2.6);
  const flaps: LRect[] = under ? [[0.3, 0.07, 0.7, 0.13]] : [[0.07, 0.3, 0.13, 0.7], [0.87, 0.3, 0.93, 0.7]];
  const sc = new Scene();
  for (const [i, [x0, y0, x1, y1]] of flaps.entries()) {
    sc.add(f.depth((x0 + x1) / 2, (y0 + y1) / 2), () => {
      const rr = box(ctx, f, x0, y0, x1, y1, LID, LID + 0.28, { top: C.hazard }, s + 40 + i, { outline: 1.4 });
      faceHazard(ctx, f, rr, 'L', 0.04, 0.96, LID + 0.02, LID + 0.26, s + 41 + i);
      faceHazard(ctx, f, rr, 'R', 0.04, 0.96, LID + 0.02, LID + 0.26, s + 42 + i);
    });
  }
  sc.add(f.depth(0.5, 0.5), () => {
    cylinder(ctx, f, 0.5, 0.5, 0.15, LID, LID + 0.12, C.brass, s + 50, { top: C.brassL });
    const c = f.p(0.5, 0.5, LID + 0.12);
    const [ex, ey] = f.ell(0.13);
    ink(ctx, [[c[0] - ex, c[1]], [c[0] + ex, c[1]]], { w: 2.4, color: C.steelD, shade: false, taper: 0, seed: s + 51 });
    ink(ctx, [[c[0], c[1] - ey], [c[0], c[1] + ey]], { w: 2.4, color: C.steelD, shade: false, taper: 0, seed: s + 52 });
    rivet(ctx, c[0], c[1], 2, C.brassL);
  });
  sc.run();
  if (!intakeFirst(f)) intakeIso(ctx, f, s + 60);
}

// ── the junction: a little bridge (owner, 2026-10-13) ─────────────────────────────────────────
//
// "A junction should look a little bit more like a little bridge, with items going under it in
// one direction, and over it in another." Its art is drawn once (rot 0, `turnsArt` is false) and
// serves every rotation, so its axes are the world's: the north–south line rides over its humped
// deck, the east–west line runs under it, through a tunnel in its body. The items ride the deck
// on exactly this profile (world/item-flow.ts), and the game draws them over this sprite while
// they are on it; the ones under it are drawn beneath it (seen through the tunnel's mouth), on a
// ribbon the items view lays on the ground through the tunnel (world/junctions-view.ts).

/**
 * The junction's shape, shared by its plan recipe (buildings-top.ts) and the items riding it
 * (world/item-flow.ts): the body's sides and the running surface between its parapets (local x,
 * across the deck), the parapets' height over the surface and the surface's crown (levels).
 */
export const JUNCTION = { x0: 0.13, x1: 0.87, r0: 0.21, r1: 0.79, parapet: 0.17, deck: 1 } as const;
/** Each ramp's length (fraction of the tile); the crown is flat between them. */
const J_RAMP = 0.42;

/**
 * The junction's deck height along the bridge, as a fraction of its crown, at u ∈ [0, 1] from one
 * end to the other: a half-cosine ramp up, a short flat crown, the same ramp down. Flat where it
 * meets the ribbons at both ends, and symmetric, so it reads the same whichever way items cross.
 */
export function junctionHump(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  const v = Math.min(u, 1 - u) / J_RAMP;
  return v >= 1 ? 1 : (1 - Math.cos(Math.PI * v)) / 2;
}

const { x0: JX0, x1: JX1, r0: JR0, r1: JR1, parapet: J_PARAPET, deck: J_DECK } = JUNCTION;
/** The deck's thickness over the tunnel (levels). */
const J_THICK = 0.13;
/** The tunnel: its mouth on the ground (local y, the ribbon's band) and its arch's height (levels). */
const J_MOUTH0 = 0.2, J_MOUTH1 = 0.8, J_ARCH = 0.74;

/**
 * The junction in iso: a riveted steel hump (the deck between two dark parapet girders, slatted
 * like a skybridge's deck) whose body the tunnel goes through, its near mouth an arch framed in
 * brass, and a post with a work lamp at each corner. Drawn far to near: the far parapet, the
 * running surface slice by slice from north to south (a nearer slice over a farther one, so the
 * north ramp's steep back hides behind the crown), then the near wall with the arch cut out of
 * it. The mouth is left see-through (only the tunnel's shade washes it): what passes under the
 * bridge is drawn beneath this sprite, so the items show through the arch and vanish under the
 * deck; nothing drawn behind the wall is let through it (clipped out).
 */
function junctionIso(ctx: Ctx, f: IsoFrame, s: number): void {
  // Slices along the bridge, north to south; two in every nine are a slat (8 a tile, as on a
  // skybridge's deck), so the slats hide behind the crown exactly as the deck does.
  const N = 72;
  const ys = Array.from({ length: N + 1 }, (_, i) => i / N);
  const top = (y: number): number => J_DECK * junctionHump(y);
  const rim = (y: number): number => top(y) + J_PARAPET;
  // An arch over the ribbon's band, `w` wider each side and `hgt` high, kept `gap` under the deck.
  const archOf = (y: number, w: number, hgt: number, gap: number): number => {
    const v = (y - (J_MOUTH0 + J_MOUTH1) / 2) / ((J_MOUTH1 - J_MOUTH0) / 2 + w);
    return v <= -1 || v >= 1 ? 0 : Math.max(0, Math.min(hgt * Math.sqrt(1 - v * v), top(y) - gap));
  };
  const arch = (y: number): number => archOf(y, 0, J_ARCH, J_THICK);
  const AN = 24;
  const along = (y0: number, y1: number): number[] => Array.from({ length: AN + 1 }, (_, i) => y0 + ((y1 - y0) * i) / AN);
  const mouth: Pt[] = along(J_MOUTH0, J_MOUTH1).map((y) => f.p(JX1, y, arch(y)));
  const wall: Pt[] = [f.p(JX1, 0, 0), ...ys.map((y) => f.p(JX1, y, rim(y))), f.p(JX1, 1, 0), ...mouth.slice().reverse()];
  const farRim = ys.map((y) => f.p(JX0, y, rim(y)));
  const slice = (i: number): [number, number] => [ys[i]!, Math.min(1, ys[i + 1]! + 0.004)]; // a hair over the next: no seams
  const post = (x: number, y: number, k: number): void => {
    box(ctx, f, x - 0.055, y - 0.045, x + 0.055, y + 0.045, 0, J_PARAPET + 0.2, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.35) }, s + 70 + k, { outline: 1.4, shadow: false });
    light(ctx, ...f.p(x, y, J_PARAPET + 0.2), 2, C.ledWarm);
  };
  post(0.17, 0.045, 0);
  // Everything behind the near wall stays out of the tunnel's mouth.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-1e4, -1e4, 2e4, 2e4);
  ctx.moveTo(mouth[0]![0], mouth[0]![1]);
  for (const [x, y] of mouth) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip('evenodd');
  // The far parapet: its inner face above the deck, its top; its edges inked before the deck
  // covers what it hides.
  const PAR_IN = mix(C.steel, C.ink, 0.38), PAR_TOP = C.steelD, PAR_LIT = mix(C.steelD, '#ffffff', 0.35);
  for (let i = 0; i < N; i++) {
    const [a, b] = slice(i);
    flat(ctx, [f.p(JR0, a, rim(a)), f.p(JR0, b, rim(b)), f.p(JR0, b, top(b)), f.p(JR0, a, top(a))], PAR_IN);
    flat(ctx, [f.p(JX0, a, rim(a)), f.p(JR0, a, rim(a)), f.p(JR0, b, rim(b)), f.p(JX0, b, rim(b))], PAR_TOP);
  }
  ink(ctx, farRim, { w: 1.6, taper: 0, jitter: 0, seed: s + 1 });
  ink(ctx, ys.map((y) => f.p(JR0, y, rim(y))), { w: 1.1, color: PAR_LIT, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  ink(ctx, ys.map((y) => f.p(JR0, y, top(y))), { w: 1.2, alpha: 0.8, taper: 0, jitter: 0, seed: s + 3 });
  // The running surface, north to south: a little lighter on the north ramp (it leans to the
  // light), darker on the south one (it leans to the viewer).
  const steep = (Math.PI / (2 * J_RAMP)) * J_DECK;
  for (let i = 0; i < N; i++) {
    const [a, b] = slice(i);
    const slope = ((top(ys[i + 1]!) - top(ys[i]!)) * N) / steep;
    const base = i % 9 === 4 || i % 9 === 5 ? C.steel : C.steelL;
    const col = slope > 0 ? mix(base, '#ffffff', 0.14 * slope) : mix(base, C.ink, -0.24 * slope);
    flat(ctx, [f.p(JR0, a, top(a)), f.p(JR1, a, top(a)), f.p(JR1, b, top(b)), f.p(JR0, b, top(b))], col);
  }
  ctx.restore();
  // The near side: the body's wall, hatched in shade, the arch cut out of it, rivets.
  flat(ctx, wall, mix(C.steel, C.ink, 0.3));
  hatch(ctx, wall, Math.PI / 3, 3.4, { alpha: 0.35, seed: s + 30, w: 1 });
  for (const y of [0.09, 0.91]) rivet(ctx, ...f.p(JX1, y, rim(y) * 0.45), 1.5, C.steelL);
  for (let i = 1; i < 6; i++) {
    const y = J_MOUTH0 + ((J_MOUTH1 - J_MOUTH0) * i) / 6;
    rivet(ctx, ...f.p(JX1, y, (archOf(y, 0.035, J_ARCH + 0.09, 0.05) + rim(y)) / 2), 1.3, C.steelL);
  }
  // The tunnel's shade inside the mouth (washes: what passes under stays readable), deeper under
  // the deck; the mouth's brass lip.
  flat(ctx, mouth, C.ink, 0.2);
  flat(ctx, [...along(J_MOUTH0, J_MOUTH1).map((y) => f.p(JX1, y, arch(y) * 0.45)), ...mouth.slice().reverse()], C.ink, 0.14);
  const lip: Pt[] = [...mouth, ...along(J_MOUTH1 + 0.035, J_MOUTH0 - 0.035).map((y) => f.p(JX1, y, archOf(y, 0.035, J_ARCH + 0.09, 0.05)))];
  shape(ctx, lip, C.brass, { w: 1.1, shade: false, jitter: 0, seed: s + 31 });
  // The near parapet's top, slice by slice; its inner edge lit, the wall's outline inked.
  for (let i = 0; i < N; i++) {
    const [a, b] = slice(i);
    flat(ctx, [f.p(JR1, a, rim(a)), f.p(JX1, a, rim(a)), f.p(JX1, b, rim(b)), f.p(JR1, b, rim(b))], PAR_TOP);
  }
  ink(ctx, ys.map((y) => f.p(JR1, y, rim(y))), { w: 1.1, color: PAR_LIT, shade: false, taper: 0, jitter: 0, seed: s + 32 });
  ink(ctx, wall, { closed: true, w: 2, seed: s + 33 });
  post(0.83, 0.045, 1);
  post(0.17, 0.955, 2);
  post(0.83, 0.955, 3);
}

// ── the skybridge: two ends and the deck between them (owner, 2026-10-13) ─────────────────────
//
// "The bridge visuals are broken": the deck floated as a plank and the ends did not carry it. A
// pair's two ends face the same way and share one drawing (the atlas bakes one per rotation), so
// an end cannot tell the start from the far end: its art is what both are — a riveted footing,
// the line's band across it, a hazard-striped gantry over it (`skybridge`). What a pair makes of
// its ends is drawn by the buildings view, which knows the roles from the graph (`graph.jumps`):
// the start's ramp up to the deck, the deck over every square between, the far end's ramp down
// (`drawSkyPiece`), one continuous steel span on the ends' footings. The items ride its running
// surface (world/item-flow.ts: up over the start, `DECK_Z` across, down over the far end) and are
// drawn over it; the line it crosses runs under the deck and is drawn beneath it.

/**
 * The skybridge's span (local frame: the line runs towards −y): its running surface's height over
 * the squares between the ends (levels: the items ride it there), the surface across the line
 * (local x: the ribbon's band), the girders' outer sides, how far they stand over the surface and
 * how deep the deck is under it (levels).
 */
export const SKY = { deck: 1, r0: 0.2, r1: 0.8, g0: 0.12, g1: 0.88, rim: 0.16, depth: 0.26 } as const;
/** The ends' headroom (levels): the gantry's lamps. A piece is drawn on the end's own frame. */
const SKY_HEAD = 2.05;
/** The gantry across the middle of an end's square: its legs either side (local x), its beam (levels). */
const SKY_GANTRY = { x0: 0.04, x1: 0.96, w: 0.07, y0: 0.44, y1: 0.56, z0: 1.68, z1: 1.84 } as const;
/** What a pair makes of its squares: the start's ramp up, the deck over a square between, the far end's ramp down. */
export type SkyPiece = 'up' | 'deck' | 'down';

/**
 * The gantry over an end: two legs on the footing either side of the line, a hazard-striped beam
 * across, a red lamp on each leg. `front`: only what stands in front of a ramp running through it
 * (the leg nearer the viewer, the beam, the lamps) — a ramp piece draws them again over itself, as
 * the end's own sprite draws them, so the gantry stays in front of the ramp.
 */
function skyGantry(ctx: Ctx, f: IsoFrame, s: number, front: boolean): void {
  const G = SKY_GANTRY;
  const [far, near] = f.depth(G.x0, 0.5) < f.depth(G.x1, 0.5) ? [G.x0, G.x1] : [G.x1, G.x0];
  const leg = (x: number, k: number): void => {
    const rr = box(ctx, f, x - G.w / 2, G.y0 + 0.015, x + G.w / 2, G.y1 - 0.015, 0.1, G.z0, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.38) }, s + 10 + k, { outline: 1.6, shadow: false });
    faceLeds(ctx, f, rr, 'L', G.z0 - 0.3, 0.5, 0.5, 1, [C.ledWarm], 1.9);
  };
  if (!front) leg(far, 0);
  leg(near, 1);
  const rr = box(ctx, f, G.x0 - G.w / 2, G.y0, G.x1 + G.w / 2, G.y1, G.z0, G.z1, { top: C.hazard, left: C.hazard, right: mix(C.hazard, C.ink, 0.3) }, s + 4, { outline: 1.6, shadow: false });
  faceHazard(ctx, f, rr, 'L', 0.02, 0.98, G.z0 + 0.02, G.z1 - 0.02, s + 5);
  faceHazard(ctx, f, rr, 'R', 0.02, 0.98, G.z0 + 0.02, G.z1 - 0.02, s + 6);
  for (const x of [far, near]) light(ctx, ...f.p(x, 0.5, G.z1 + 0.07), 2.3, C.ledRed);
}

/** The running surface's height along a piece (levels), at y ∈ [0, 1] from its front edge. */
const skyTop = (piece: SkyPiece, y: number): number => {
  const v = Math.min(1, Math.max(0, y));
  return piece === 'deck' ? SKY.deck : SKY.deck * (piece === 'up' ? 1 - v : v);
};

/**
 * One piece of a pair's span on its square: the far girder, the slatted running surface (a little
 * darker where it leans to the viewer), the near girder; on the near side the deck's girder face
 * with its truss over the open square (the crossed line shows beneath it), or a ramp's solid
 * wedge down to the footing, with a hazard toe plate at its foot. Faces run a hair past the square
 * along the line so neighbouring pieces join without a seam; nothing is inked across the joins.
 * A ramp then draws the end's gantry over itself (`skyGantry`, front parts); a shadow (`bare`)
 * leaves it out, the end casts its own.
 */
function skyPieceIso(ctx: Ctx, f: IsoFrame, piece: SkyPiece, s: number, bare = false): void {
  const { r0, r1, g0, g1, rim, depth } = SKY;
  const nearHi = f.depth(g1, 0.5) > f.depth(g0, 0.5);
  const [fo, fi, ni, no] = nearHi ? [g0, r0, r1, g1] : [g1, r1, r0, g0]; // far outer, far inner, near inner, near outer
  const E = 0.015, ya = -E, yb = 1 + E;
  const z = (y: number): number => skyTop(piece, y);
  const strip = (x0: number, x1: number, dz: number): Pt[] => [f.p(x0, ya, z(ya) + dz), f.p(x1, ya, z(ya) + dz), f.p(x1, yb, z(yb) + dz), f.p(x0, yb, z(yb) + dz)];
  const along = (x: number, dz: number): Pt[] => [f.p(x, ya, z(ya) + dz), f.p(x, yb, z(yb) + dz)];
  const PAR_TOP = C.steelD, PAR_IN = mix(C.steel, C.ink, 0.38), LIT = mix(C.steelD, '#ffffff', 0.35);
  // The far girder: its top, its inner face over the surface.
  flat(ctx, strip(fo, fi, rim), PAR_TOP);
  flat(ctx, [f.p(fi, ya, z(ya) + rim), f.p(fi, yb, z(yb) + rim), f.p(fi, yb, z(yb)), f.p(fi, ya, z(ya))], PAR_IN);
  ink(ctx, along(fo, rim), { w: 1.5, taper: 0, jitter: 0, seed: s + 1 });
  ink(ctx, along(fi, rim), { w: 1.1, color: LIT, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  // The running surface: steel plate, slats across (as on the plan's deck), a ramp leaning to the
  // viewer a little darker, one leaning away a little lighter.
  const lean = piece === 'deck' ? 0 : (f.depth(0.5, 1) > f.depth(0.5, 0)) === (piece === 'up') ? 1 : -1;
  flat(ctx, strip(r0, r1, 0), lean > 0 ? mix(C.steelL, C.ink, 0.14) : lean < 0 ? mix(C.steelL, '#ffffff', 0.1) : C.steelL);
  for (let k = 0; k < 8; k++) {
    const y = (k + 0.5) / 8;
    ink(ctx, [f.p(r0 + 0.02, y, z(y)), f.p(r1 - 0.02, y, z(y))], { w: 1.6, color: C.steel, shade: false, taper: 0, jitter: 0, seed: s + 10 + k });
  }
  ink(ctx, along(fi, 0), { w: 1.1, alpha: 0.8, taper: 0, jitter: 0, seed: s + 3 });
  // The near girder's top, lit along its inner edge.
  flat(ctx, strip(ni, no, rim), PAR_TOP);
  ink(ctx, along(ni, rim), { w: 1.1, color: LIT, shade: false, taper: 0, jitter: 0, seed: s + 4 });
  // The near side: the deck's girder face (truss over the open square) or the ramp's wedge.
  const bot = (y: number): number => (piece === 'deck' ? z(y) - depth : 0);
  const face: Pt[] = [f.p(no, ya, z(ya) + rim), f.p(no, yb, z(yb) + rim), f.p(no, yb, bot(yb)), f.p(no, ya, bot(ya))];
  flat(ctx, face, mix(C.steel, C.ink, 0.3));
  hatch(ctx, face, Math.PI / 3, 3.4, { alpha: 0.3, seed: s + 5, w: 1 });
  if (piece === 'deck') {
    // Truss bracing on the girder: one X per half square (as on the plan's deck), seamless along the span.
    for (let k = 0; k < 2; k++) {
      const a = k / 2, b = (k + 1) / 2, lo = z(a) - depth + 0.04, hi = z(a) + rim - 0.04;
      ink(ctx, [f.p(no, a, lo), f.p(no, b, hi)], { w: 1.2, color: C.steelL, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 20 + k });
      ink(ctx, [f.p(no, a, hi), f.p(no, b, lo)], { w: 1.2, color: C.steelL, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 22 + k });
    }
  } else {
    for (const y of [0.25, 0.5, 0.75]) rivet(ctx, ...f.p(no, y, z(y) * 0.5 + rim * 0.5), 1.4, C.steelL);
  }
  ink(ctx, [f.p(no, ya, bot(ya)), f.p(no, yb, bot(yb))], { w: 1.8, taper: 0, jitter: 0, seed: s + 6 });
  ink(ctx, along(no, rim), { w: 1.8, taper: 0, jitter: 0, seed: s + 7 });
  if (piece !== 'deck') {
    // The ramp's foot: a hazard toe plate across its low end, where the ribbon comes in or goes on.
    const foot = piece === 'up' ? 1 : 0, side = piece === 'up' ? 2 : 0;
    if (facing(f, side)) {
      const toe: Pt[] = [f.p(g0, foot, rim), f.p(g1, foot, rim), f.p(g1, foot, 0), f.p(g0, foot, 0)];
      flat(ctx, toe, C.hazard);
      ctx.save(); pathOf(ctx, toe); ctx.clip();
      hatch(ctx, toe, Math.PI / 4, 5, { w: 2.4, alpha: 0.85, seed: s + 8 });
      ctx.restore();
      ink(ctx, toe, { closed: true, w: 1.3, shade: false, taper: 0, jitter: 0, seed: s + 9 });
    }
    ink(ctx, [f.p(no, foot, 0), f.p(no, foot, rim)], { w: 1.6, taper: 0, jitter: 0, seed: s + 30 });
    if (!bare) skyGantry(ctx, f, s + 40, true);
  }
}

/**
 * A pair's piece on its square, on the end's own frame (same size and anchor as an end's sprite:
 * a ramp's gantry lands exactly on the end's own). The buildings view bakes them on first use.
 */
export function drawSkyPiece(piece: SkyPiece, rot: Rot, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const f = new IsoFrame(1, 1, rot, SKY_HEAD);
  const { ctx, canvas } = make(f.W, f.H);
  skyPieceIso(ctx, f, piece, seedOf('skybridge'));
  return { canvas, frame: f };
}

/** The frame of a piece's cast shadow (as `shadowFrameOf` for a building). */
export const skyShadowFrame = (rot: Rot, dx: number, dy: number): ShadowFrame => new ShadowFrame(1, 1, rot, SKY_HEAD, dx, dy);

/** A piece's cast shadow, into a silhouette context (as `drawBuildingShadow`). */
export function drawSkyPieceShadow(piece: SkyPiece, rot: Rot, dx: number, dy: number, ctx: Ctx): void {
  skyPieceIso(ctx, skyShadowFrame(rot, dx, dy), piece, seedOf('skybridge'), true);
}

// ── desert machines with a moving part (moving.ts): the wind turbine, the sand collector ──────

/** Weathered ochre paint of the desert machines (lit, mid, shaded), the vanes' sand-white, rust bands. */
const OCHRE = mix(C.peachD, C.dune, 0.4);
const OCHRE_L = mix(OCHRE, C.sand, 0.45);
const OCHRE_D = mix(OCHRE, C.ink, 0.32);
const OCHRE_FACES: Faces = { top: OCHRE_L, left: OCHRE, right: OCHRE_D };
const SAIL = mix(C.paperD, C.sand, 0.3);
const RUST = mix(C.coralD, C.mesa, 0.35);
const SANDFILL = mix(C.sand, C.dune, 0.4);

/** Sand-scour: fine grit stippled over a polygon. */
function scour(ctx: Ctx, pts: readonly Pt[], n: number, s: number): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  stipple(ctx, x0, y0, x1 - x0, y1 - y0, n, { clip: pts, color: C.inkSoft, alpha: 0.3, seed: s, r: 0.75 });
}

/** A local horizontal direction once rotated (how a surface faces the camera, +x+y, and the light, −x). */
function turned(f: IsoFrame, dx: number, dy: number): [number, number] {
  const [ax, ay] = f.r(0, 0), [bx, by] = f.r(dx, dy);
  return [bx - ax, by - ay];
}

/** The wind tower: tapering, slatted like a windtrap, two steel bands, the bearing collar on top. */
function windTower(ctx: Ctx, f: IsoFrame, s: number): void {
  const { cx, cy, hub } = TURBINE;
  const z0 = 0.4, z1 = 2.5, r0 = 0.27, r1 = 0.15;
  const rad = (z: number): number => r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
  latheIso(ctx, f, cx, cy, [[z0, r0], [z1, r1]], OCHRE, s, { top: C.steelD, seams: false });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    const [nx, ny] = turned(f, Math.cos(a), Math.sin(a));
    if (nx + ny < 0.3) continue;
    const at = (z: number): Pt => f.p(cx + Math.cos(a) * rad(z), cy + Math.sin(a) * rad(z), z);
    const rib = [at(z0 + 0.12), at(z1 - 0.06)];
    ink(ctx, rib, { w: 1.4, color: OCHRE_D, shade: false, taper: 0, jitter: 0, seed: s + k });
    ink(ctx, rib.map(([x, y]) => [x - 1.5, y] as Pt), { w: 0.8, color: '#ffffff', alpha: 0.32, shade: false, taper: 0, jitter: 0, seed: s + 20 + k });
  }
  const [lx, ly] = f.p(cx, cy, 0.9), [ex] = f.ell(rad(0.9));
  scour(ctx, [[lx - ex, ly - 40], [lx + ex, ly - 40], [lx + ex, ly + 12], [lx - ex, ly + 12]], 50, s + 30);
  for (const [i, z] of [1.15, 1.95].entries()) {
    const c = f.p(cx, cy, z), [bx, by] = f.ell(rad(z) + 0.012);
    const front = ellipsePts(c[0], c[1], bx, by, s + 31 + i, 0, 40).filter(([, y]) => y >= c[1] - 0.5).sort((p, q) => p[0] - q[0]);
    ink(ctx, front, { w: 4.2, color: C.ink, shade: false, taper: 0, seed: s + 33 + i });
    ink(ctx, front, { w: 2.4, color: C.steel, shade: false, taper: 0, seed: s + 35 + i });
  }
  cylinder(ctx, f, cx, cy, 0.19, z1 - 0.04, hub, C.steel, s + 40, { top: C.steelL });
}

/**
 * The wind turbine's body (owner, 2026-10-12: "more Dune style"): a desert wind tower — a
 * battered, sand-scoured ochre foot with four buttress fins, a lean slatted tower like a
 * windtrap's, steel bands, the generator cabinet at its foot (access panel, grille, status
 * LEDs), the bearing on top. The crown turns above it (`turbineCrown`).
 */
function turbineBody(ctx: Ctx, f: IsoFrame, s: number): void {
  const { cx, cy } = TURBINE;
  const top = frustumIso(ctx, f, 0.28, 0.28, 1.72, 1.72, 0, 0.4, 0.1, OCHRE_FACES, s, { outline: 2 });
  scour(ctx, top, 90, s + 1);
  const sc = new Scene();
  // Buttress fins on the four sides (seen side-on whatever the view), far ones first.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a), tx = -sa * 0.036, ty = ca * 0.036;
    const at = (d: number, k: number): [number, number] => [cx + ca * d + tx * k, cy + sa * d + ty * k];
    sc.add(f.depth(cx + ca * 0.47, cy + sa * 0.47), () => {
      prismIso(ctx, f, [at(0.14, 1), at(0.66, 1), at(0.66, -1), at(0.14, -1)], 0.4, [1.85, 0.5, 0.5, 1.85], OCHRE_FACES, s + 10 + i, { outline: 1.5, shadow: false });
    });
  }
  sc.add(f.depth(cx, cy), () => windTower(ctx, f, s + 20));
  // The generator cabinet in the corner between the two near fins.
  sc.add(f.depth(1.43, 1.43), () => {
    const rr = box(ctx, f, 1.24, 1.24, 1.62, 1.62, 0.4, 0.94, OCHRE_FACES, s + 30, { outline: 1.8 });
    faceLeds(ctx, f, rr, 'L', 0.78, 0.25, 0.75, 3, [C.led, C.ledGreen, C.led]);
    facePanel(ctx, f, rr, 'L', 0.18, 0.82, 0.48, 0.66, C.steel, s + 31);
    faceGrille(ctx, f, rr, 'R', 0.15, 0.85, 0.5, 0.84, s + 32, 3);
    box(ctx, f, 1.3, 1.3, 1.56, 1.56, 0.94, 1.0, { top: C.steelD }, s + 33, { outline: 1.2, shadow: false });
  });
  sc.run();
}

/**
 * The turbine's crown at phase t (a third of a turn per period): a Savonius rotor — three
 * sand-white sail-vanes curving out from the shaft between two steel rings, a rust band across
 * each near its head, the cone and the red aviation light on top. The vanes are cut into upright
 * strips, each shaded by the face it turns to the camera (the hollow of a scoop darker), drawn
 * far to near with the shaft; the rings' far halves go first, their near halves last.
 */
function turbineCrown(ctx: Ctx, f: IsoFrame, s: number, t: number): void {
  const { cx, cy, r, vanes, z0, z1, hub, top } = TURBINE;
  const th = (t * 2 * Math.PI) / vanes;
  const ringHalf = (z: number, front: boolean): Pt[] => {
    const c = f.p(cx, cy, z), [ex, ey] = f.ell(r + 0.03);
    return ellipsePts(c[0], c[1], ex, ey, s, 0, 48).filter(([, y]) => (front ? y >= c[1] - 0.5 : y <= c[1] + 0.5)).sort((p, q) => p[0] - q[0]);
  };
  const band = (pts: Pt[], seed: number): void => {
    ink(ctx, pts, { w: 4.4, color: C.ink, shade: false, taper: 0, seed });
    ink(ctx, pts, { w: 2.4, color: C.steelL, shade: false, taper: 0, seed: seed + 1 });
  };
  for (const [i, z] of [z0, z1].entries()) band(ringHalf(z, false), s + 10 + i * 3);
  const items: Array<{ d: number; fn: () => void }> = [];
  items.push({ d: f.depth(cx, cy), fn: () => pipeIso(ctx, f, [[cx, cy, hub], [cx, cy, top - 0.2]], 4.4, C.steelL, s, false) });
  const S = 10, zb0 = z1 - 0.44, zb1 = z1 - 0.27;
  const at = (a0: number, u: number): [number, number] => { const v = vaneAt(a0, Math.min(1, u)); return [cx + Math.cos(v.a) * v.rho, cy + Math.sin(v.a) * v.rho]; };
  for (let i = 0; i < vanes; i++) {
    const a0 = th + (i / vanes) * Math.PI * 2;
    for (let k = 0; k < S; k++) {
      const [ax, ay] = at(a0, k / S), [bx, by] = at(a0, (k + 1) / S), [fx, fy] = at(a0, (k + 1.15) / S);
      // The strip's normal towards the hollow of the scoop (the vane curls towards growing angles).
      const [nx, ny] = turned(f, -(by - ay), bx - ax);
      const hollow = nx + ny > 0;
      const L = Math.hypot(nx, ny) || 1, sg = hollow ? 1 : -1;
      const shade = faceInk((sg * nx) / L, (sg * ny) / L) * 0.8 + (hollow ? 0.16 : 0);
      items.push({ d: f.depth((ax + bx) / 2, (ay + by) / 2), fn: () => {
        const q = (za: number, zb: number): Pt[] => [f.p(ax, ay, zb), f.p(fx, fy, zb), f.p(fx, fy, za), f.p(ax, ay, za)];
        flat(ctx, q(z0, z1), mix(SAIL, C.ink, shade));
        flat(ctx, q(zb0, zb1), mix(RUST, C.ink, shade * 0.8));
        ink(ctx, [f.p(ax, ay, z1), f.p(bx, by, z1)], { w: 1.5, shade: false, taper: 0, jitter: 0, seed: s + 30 + k });
        ink(ctx, [f.p(ax, ay, z0), f.p(bx, by, z0)], { w: 1.2, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 40 + k });
        if (k === S - 1) ink(ctx, [f.p(bx, by, z1), f.p(bx, by, z0)], { w: 1.6, shade: false, taper: 0, jitter: 0, seed: s + 50 });
      } });
    }
  }
  items.sort((p, q) => p.d - q.d);
  for (const it of items) it.fn();
  for (const [i, z] of [z0, z1].entries()) band(ringHalf(z, true), s + 20 + i * 3);
  latheIso(ctx, f, cx, cy, [[top - 0.24, 0.07], [top - 0.1, 0.07], [top, 0.025]], C.steelD, s + 60, { shadow: false, seams: false });
  light(ctx, ...f.p(cx, cy, top + 0.04), 2.6, C.ledRed);
}

/** Sifted sand heaped in a hopper's mouth (the mouth's canvas polygon): a soft mound with ripples. */
function sandHeap(ctx: Ctx, mouth: readonly Pt[], s: number): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of mouth) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 1, rx = (x1 - x0) * 0.38, ry = (y1 - y0) * 0.33;
  const heap = ellipsePts(cx, cy, rx, ry, s, 0.06, 24);
  flat(ctx, heap, SANDFILL);
  flat(ctx, ellipsePts(cx - rx * 0.22, cy - ry * 0.25, rx * 0.55, ry * 0.45, s + 1, 0.05, 20), mix(SANDFILL, '#ffffff', 0.35));
  for (const k of [0.45, 0.75]) ink(ctx, ellipsePts(cx + rx * 0.1, cy + ry * 0.1, rx * k, ry * k * 0.8, s + 2 + k * 10, 0.04, 24).filter(([, y]) => y > cy), { w: 0.9, color: mix(SANDFILL, C.ink, 0.35), alpha: 0.7, shade: false, taper: 0.3, seed: s + 4 });
  stipple(ctx, cx - rx, cy - ry, rx * 2, ry * 2, 40, { clip: heap, color: C.inkSoft, alpha: 0.35, seed: s + 5, r: 0.8 });
  ink(ctx, heap, { closed: true, w: 1, alpha: 0.5, shade: false, seed: s + 6 });
}

/** The sieve: a slanted screen from under the wheel's crest down over the hopper, on two struts, sand riding it. */
function sieveIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const yb = SAND_WHEEL.split - 0.03, yf = 0.36, zb = 1.6, zf = 1.14, x0 = 0.2, x1 = 1.0;
  const P = (x: number, u: number): Pt => f.p(x, yb + (yf - yb) * u, zb + (zf - zb) * u);
  for (const [i, x] of [x0 + 0.05, x1 - 0.05].entries()) pipeIso(ctx, f, [[x, yb, zb], [x, yb, 1.04]], 2.6, C.steelD, s + i, false);
  const deck = [P(x0, 0), P(x1, 0), P(x1, 1), P(x0, 1)];
  flat(ctx, deck, mix(SANDFILL, C.ink, 0.1));
  // The mesh: fine dark wires over the sand it holds back.
  for (let i = 1; i < 10; i++) ink(ctx, [P(x0 + ((x1 - x0) * i) / 10, 0.02), P(x0 + ((x1 - x0) * i) / 10, 0.98)], { w: 0.7, color: mix(OCHRE, C.ink, 0.55), alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: s + 2 + i });
  for (let j = 1; j < 6; j++) ink(ctx, [P(x0 + 0.02, j / 6), P(x1 - 0.02, j / 6)], { w: 0.7, color: mix(OCHRE, C.ink, 0.55), alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: s + 12 + j });
  for (const [i, x] of [0.36, 0.55, 0.76].entries()) ink(ctx, [P(x, 0.04), P(x + 0.03, 0.55 + 0.14 * i)], { w: 2.6, color: mix(SANDFILL, '#ffffff', 0.3), alpha: 0.95, shade: false, taper: 0.4, seed: s + 20 + i });
  ink(ctx, deck, { closed: true, w: 1.5, seed: s + 25 });
  for (const x of [x0, x1]) ink(ctx, [P(x, 0), P(x, 1)], { w: 2.6, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 26 });
}

/**
 * The sand collector's body (the hopper's side of the split plane): a low steel skid, the
 * flared ochre hopper heaped with sifted sand (its outlet is the port at the front), the sieve
 * slanting over it, the teal motor house with its grille, LEDs and motor drum.
 */
function collectorBody(ctx: Ctx, f: IsoFrame, s: number): void {
  box(ctx, f, 0.05, 0.05, 1.95, SAND_WHEEL.split - 0.02, 0, 0.2, { top: C.steel, left: mix(C.steel, C.ink, 0.3), right: mix(C.steel, C.ink, 0.5) }, s, { outline: 1.8 });
  const sc = new Scene();
  sc.add(f.depth(0.6, 0.46), () => {
    const top = frustumIso(ctx, f, 0.14, 0.12, 1.06, 0.8, 0.2, 1.05, -0.08, OCHRE_FACES, s + 1, { open: C.ink });
    sandHeap(ctx, top, s + 2);
  });
  sc.add(f.depth(1.56, 0.5), () => {
    const rr = box(ctx, f, 1.26, 0.16, 1.86, 0.84, 0.2, 0.9, C.teal, s + 3);
    faceGrille(ctx, f, rr, 'R', 0.12, 0.88, 0.3, 0.78, s + 4, 3);
    faceLeds(ctx, f, rr, 'L', 0.72, 0.18, 0.6, 3, [C.ledGreen, C.led, C.ledWarm]);
    drumIso(ctx, f, 1.56, 0.5, 1.04, 0.13, 0.22, 'y', C.steelL, s + 5, { bands: [-0.5, 0.5] });
  });
  sc.add(f.depth(0.6, 0.62) + 0.5, () => sieveIso(ctx, f, s + 6));
  sc.run();
}

/**
 * The sand collector's wheel side at phase t (an eighth of a turn per period): the pit it digs
 * in the bare floor with its spoil heaps, two A-frame trestles carrying the axle, the bucket
 * wheel turning so its buckets scoop the sand at the bottom, lift it up the back and tip it
 * over the crest onto the sieve, and the drive chain from the motor house.
 */
function collectorWheel(ctx: Ctx, f: IsoFrame, s: number, t: number): void {
  const { cx, cy, cz, r, half, buckets } = SAND_WHEEL;
  const loc = (a: number, rx: number, ry: number): Pt => f.p(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0);
  for (const [i, dx] of [-0.37, 0.37].entries()) {
    const c = f.p(cx + dx, cy + 0.1, 0);
    const heap = ellipsePts(c[0], c[1] - 2, 18, 8, s + i, 0.15, 20);
    shape(ctx, heap, mix(C.sand, C.dune, 0.45), { w: 1, alpha: 0.55, shade: false, seed: s + i });
    stipple(ctx, c[0] - 18, c[1] - 10, 36, 16, 26, { clip: heap, color: C.inkSoft, alpha: 0.35, seed: s + 2 + i, r: 0.8 });
  }
  const pit = Array.from({ length: 36 }, (_, i) => loc((i / 36) * Math.PI * 2, 0.24, 0.5));
  flat(ctx, pit, mix(C.dug, C.mesa, 0.3));
  ctx.save(); pathOf(ctx, pit); ctx.clip();
  flat(ctx, pit.map(([x, y]) => [x + 7, y + 6] as Pt), mix(C.dug, C.ink, 0.42));
  hatch(ctx, pit, Math.PI / 3, 3, { alpha: 0.25, seed: s + 5 });
  ctx.restore();
  ink(ctx, pit, { closed: true, w: 1.3, alpha: 0.7, shade: false, seed: s + 6 });
  const trestle = (k: number): void => {
    const x = cx + k * (half + 0.13);
    pipeIso(ctx, f, [[x, cy - 0.32, 0], [x, cy, cz + 0.05], [x, cy + 0.32, 0]], 3.4, C.steel, s + 10 + k, false);
    pipeIso(ctx, f, [[x, cy - 0.18, 0.45], [x, cy + 0.18, 0.45]], 2.2, C.steelD, s + 12 + k, false);
  };
  const axle = (k: number): void => pipeIso(ctx, f, [[cx + k * half, cy, cz], [cx + k * (half + 0.2), cy, cz]], 4.2, C.steelL, s + 30 + k, false);
  // The drive, on the motor house's end (+x): a sprocket, its chain up to the house.
  const drive = (): void => {
    const sp = f.p(cx + half + 0.21, cy, cz);
    shape(ctx, ellipsePts(sp[0], sp[1], 5.5, 7, s + 33, 0, 16), C.steelD, { w: 1.2, shade: false, jitter: 0, seed: s + 33 });
    cableIso(ctx, f, [cx + half + 0.21, cy, cz + 0.08], [1.42, SAND_WHEEL.split + 0.01, 0.78], 2.2, s + 34);
  };
  const [far, near] = [-1, 1].sort((a, b) => f.depth(cx + a, cy) - f.depth(cx + b, cy)) as [number, number];
  trestle(far);
  axle(far);
  if (far === 1) drive();
  bucketWheelIso(ctx, f, cx, cy, cz, r, half, 'x', buckets, (t * 2 * Math.PI) / buckets, C.steelL, s + 20, { bucket: C.brass, load: SANDFILL, full: bucketFull });
  axle(near);
  trestle(near);
  if (near === 1) drive();
}

// ── poles ──────────────────────────────────────────────────────────────────

/** The pole's weathered steel, its arm, its concrete footing. */
const POST = mix(C.steel, C.peachD, 0.25);
const ARM_STEEL = mix(C.steelL, C.peachD, 0.12);
const FOOTING = mix(C.salt, C.mesa, 0.3);

/** A crossarm: a steel beam along the diagonal through (cx, cy), `half` tiles each side, from z0 up `h` levels. */
function crossarmIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, half: number, z0: number, h: number, col: string, s: number): void {
  const w = 0.034;
  prismIso(ctx, f, [onArm(cx, cy, -half, -w), onArm(cx, cy, half, -w), onArm(cx, cy, half, w), onArm(cx, cy, -half, w)], z0, z0 + h,
    { top: mix(col, '#ffffff', 0.2), left: col, right: mix(col, C.ink, 0.35) }, s, { outline: 1.4, shadow: false, hatch: false });
}

/**
 * The pole (owner, 2026-10-12: "poles should look more like poles"): a slim, tapering post of
 * weathered steel on a concrete footing, two steel bands, a drop cable clipped down its flank to
 * a junction box with its status light (no climbing pegs: nobody climbs it, docs/lore.md); at
 * the top a crossarm level across the screen on two braces, a porcelain pin insulator near each
 * end and one on the post's cap — its wires' terminals (art/terminals.ts `POLE`). Drawn once: a
 * pole has no ports, so it stands the same whichever way it is turned.
 */
function poleIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { cx, cy, top, arm, armH, half } = POLE;
  latheIso(ctx, f, cx, cy, [[0, 0.16], [0.09, 0.15], [0.13, 0.1]], FOOTING, s, { top: mix(FOOTING, '#ffffff', 0.25), seams: false });
  const r0 = 0.058, r1 = 0.04, rad = (z: number): number => r0 + ((r1 - r0) * z) / top;
  latheIso(ctx, f, cx, cy, [[0.12, r0], [top - 0.05, r1], [top - 0.05, r1 + 0.012], [top, r1 + 0.012]], POST, s + 1, { top: C.steelD, seams: false });
  // Steel bands, front halves.
  for (const [i, z] of [0.42, arm - 0.5].entries()) {
    const c = f.p(cx, cy, z), [ex, ey] = f.ell(rad(z) + 0.008);
    const front = ellipsePts(c[0], c[1], ex, ey, s + 2 + i, 0, 24).filter(([, y]) => y >= c[1] - 0.3).sort((p, q) => p[0] - q[0]);
    ink(ctx, front, { w: 3.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 4 + i });
    ink(ctx, front, { w: 1.8, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 6 + i });
  }
  // The drop cable down its lit flank, from the crossarm to the junction box, clipped every so often.
  const flank = (z: number): Pt => { const c = f.p(cx, cy, z); return [c[0] - f.ell(rad(z))[0] * 0.55, c[1] + 1.5]; };
  ink(ctx, [flank(arm - 0.04), flank(1.34)], { w: 2.6, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 10 });
  ink(ctx, [flank(arm - 0.04), flank(1.34)], { w: 1.2, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 11 });
  for (let i = 0; i < 4; i++) { const [x, y] = flank(1.55 + i * 0.26); ink(ctx, [[x - 2, y], [x + 2, y]], { w: 1.4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 12 + i }); }
  // The junction box on its front, its status light.
  const jb = box(ctx, f, cx + 0.035, cy + 0.035, cx + 0.15, cy + 0.15, 1.02, 1.36, { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 20, { outline: 1.3, shadow: false });
  faceLeds(ctx, f, jb, 'L', 1.25, 0.5, 0.5, 1, [C.ledGreen], 1.5);
  // The crossarm on its braces, then the insulators: two pins on the arm, one on the cap.
  for (const k of [-1, 1]) pipeIso(ctx, f, [[cx, cy, arm - 0.34], [...onArm(cx, cy, k * half * 0.6), arm + 0.01]], 1.8, C.steelD, s + 30 + k, false);
  crossarmIso(ctx, f, cx, cy, half, arm, armH, ARM_STEEL, s + 40);
  for (const [i, t] of terminalsOf('mast').entries()) terminalIso(ctx, f, t, s + 50 + i * 4);
}

/**
 * The pylon, the long-reach pole: a square steel lattice tapering up from four concrete feet, a
 * peak over it carrying the aviation light, and a long crossarm at the lattice's head with a
 * suspension string of insulators hanging near each end — its wires' terminals (art/terminals.ts
 * `PYLON`).
 */
function pylonIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { cx, cy, apex, arm, armH, half, foot } = PYLON;
  const feet = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([a, b]) => [cx + a * foot, cy + b * foot] as const).sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
  for (const [i, [x, y]] of feet.entries()) latheIso(ctx, f, x, y, [[0, 0.085], [0.12, 0.065]], FOOTING, s + i, { top: mix(FOOTING, '#ffffff', 0.25), seams: false, shadow: false });
  trussIso(ctx, f, cx, cy, foot, 0.06, 0.1, arm + armH, 6, C.steelL, s + 5, 2.6);
  for (const [i, [a, b]] of ([[-1, -1], [1, 1]] as const).entries()) {
    pipeIso(ctx, f, [[cx + a * 0.06, cy + b * 0.06, arm + armH], [cx, cy, apex]], 2.2, C.steelL, s + 8 + i, false);
  }
  crossarmIso(ctx, f, cx, cy, half, arm, armH, ARM_STEEL, s + 20);
  for (const [i, t] of terminalsOf('pylon').entries()) terminalIso(ctx, f, t, s + 30 + i * 4);
  light(ctx, ...f.p(cx, cy, apex + 0.04), 2.6, C.ledRed);
}

/**
 * The first pole's art (until 2026-10-12): a slim mast on a round foot under a cup of insulator
 * petals, a light in the cup. The owner asked for poles that look like poles and to keep this
 * drawing for something else: no building wears it yet (the plan view's is `petalMastTop`).
 */
export function petalMastIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const b = f.p(0.5, 0.52, 0);
  flat(ctx, ellipsePts(b[0] + 6, b[1] + 3, f.ell(0.2)[0], f.ell(0.2)[1], s), C.ink, 0.22);
  cylinder(ctx, f, 0.5, 0.52, 0.16, 0, 0.25, C.steel, s + 1, { top: C.steelD });
  pipeIso(ctx, f, [[0.5, 0.52, 0.25], [0.5, 0.52, 2.0]], 3.4, C.steelL, s + 2, false);
  cupIso(ctx, f, 0.5, 0.52, 0.05, 0.36, 1.9, 2.5, 5, [C.ice, C.violetL], s + 3, -Math.PI / 2);
  light(ctx, ...f.p(0.5, 0.52, 2.2), 3, C.led);
}

const R: Partial<Record<BuildingId, Recipe>> = {
  // ── colony ────────────────────────────────────────────────────────────────
  hearth: {
    head: HEART_TOP,
    draw(ctx, f, s) {
      // The base's core — the starter kit the drones set down, piloted from Verrière: a fortified
      // depot whose walls swallow the ribbons through curtained mouths (roller conveyors run in
      // from every port), its roof a solar array; over it the uplink to Verrière and CrierBelt, a
      // big dish with the CrierBelt mark on its face and the beacon on its feed — the topmost
      // point, over the centre; two link masts for its wires, west and east, each between two
      // of that side's ribbons; drone pads on the corners, the builders parked or at work;
      // status beacons on the roof. The roof is laid out
      // screen-fixed, so it reads the same however the Heart is turned (in play it never is).
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const mouths: Array<readonly [number, number]> = [];
      for (const [i, p] of (BUILDINGS.hearth as BuildingDef).ports.entries()) {
        const side = sideIndex[p.side], c = (side & 1 ? p.y : p.x) + 0.5, h = 0.17, k = s + 100 + i * 50;
        if (side === 0) { apronBelt(ctx, f, c - h, 0.15, c + h, DEP.y0, 'y', k); mouths.push([c, DEP.y0]); }
        else if (side === 2) { apronBelt(ctx, f, c - h, DEP.y1, c + h, 4.85, 'y', k); mouths.push([c, DEP.y1]); }
        else if (side === 1) { apronBelt(ctx, f, DEP.x1, c - h, 4.85, c + h, 'x', k); mouths.push([DEP.x1, c]); }
        else { apronBelt(ctx, f, 0.15, c - h, DEP.x0, c + h, 'x', k); mouths.push([DEP.x0, c]); }
      }
      const sc = new Scene();
      // The two link masts, where the Heart's wires meet (art/terminals.ts `HEART_MASTS`).
      for (const [i, [x, y]] of HEART_MASTS.at.entries()) sc.add(f.depth(x, y), () => linkMastIso(ctx, f, x, y, HEART_MASTS.top, s + 10 + i * 7));
      // Drone pads on the slab's corners: builders parked, one lifting a crate, the far one out at work.
      for (const [i, [x, y]] of ([[0.64, 0.64], [4.36, 0.64], [0.64, 4.36], [4.36, 4.36]] as const).entries()) {
        const [rx, ry] = f.r(x, y);
        sc.add(f.depth(x, y) - 0.05, () => {
          const zt = padIso(ctx, f, x, y, 0.4, SZ, s + 20 + i * 7);
          if (rx > ry + 1) droneIso(ctx, f, x, y, zt, s + 50 + i * 9, { lift: 1.05, cargo: C.coral });
          else if (rx + ry > 4) droneIso(ctx, f, x, y, zt, s + 50 + i * 9);
        });
      }
      // The depot, then its roof: the uplink, the solar rows (nearer than the dish), the beacons.
      const d0 = f.depth(2.5, 2.5) + 0.01;
      sc.add(d0, () => depotIso(ctx, f, mouths, s + 200));
      sc.add(d0 + 0.001, () => uplinkIso(ctx, f, 2.5, 2.5, HEART_TOP, 1.0, 0.73, DEP.z, s + 300));
      for (const [i, [a0, b0, a1, b1, m]] of HEART_PV.entries()) sc.add(d0 + 0.002 + i * 0.0001, () => pvRowIso(ctx, f, a0, b0, a1, b1, DEP.z, m, s + 400 + i * 20));
      for (const [i, [rx, ry, col]] of HEART_BEACONS.entries()) {
        const [x, y] = unrot(f, rx, ry);
        sc.add(d0 + 0.003 + i * 0.0001, () => beaconIso(ctx, f, x, y, DEP.z, DEP.z + 0.42, col, s + 500 + i * 5));
      }
      sc.run();
      const rr = f.rect(0.05, 0.05, 4.95, 4.95);
      for (const face of ['L', 'R'] as const) {
        faceLeds(ctx, f, rr, face, SZ * 0.5, 0.05, 0.17, 3, face === 'L' ? LEDS : [C.ledWarm, C.led]);
        faceLeds(ctx, f, rr, face, SZ * 0.5, 0.83, 0.95, 3, face === 'L' ? LEDS : [C.ledWarm, C.led]);
      }
    },
  },
  beacon: {
    head: 3.2,
    draw(ctx, f, s) {
      const c = f.p(0.5, 0.55, 0);
      for (let k = 1; k <= 2; k++) {
        const [ex, ey] = f.ell(0.2 + k * 0.12);
        ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + k, 0.02), { closed: true, w: 1.3, alpha: 0.7, shade: false, color: C.cyan, seed: s + 10 + k });
      }
      derrick(ctx, f, [[0.15, 0.2, 0], [0.9, 0.35, 0], [0.4, 0.92, 0]], [0.5, 0.5, 2.4], s);
      dishIso(ctx, f, 0.5, 0.5, 0.3, 2.45, s + 5);
    },
  },

  // ── extraction ────────────────────────────────────────────────────────────
  drill: {
    head: 3.3,
    draw(ctx, f, s) {
      // A drilling rig on a skid: a lattice derrick over a geared rotary table and its auger,
      // driven by a gearbox and motor at the back; a coral power pack beside the derrick.
      slab(ctx, f, C.steel, 0.05, SZ, s, true);
      const sc = new Scene();
      sc.add(f.depth(0.78, 0.68), () => {
        cylinder(ctx, f, 0.78, 0.68, 0.33, SZ, 0.52, C.steelD, s + 3, { top: C.brass });
        gearTeeth(ctx, f, 0.78, 0.68, 0.33, 0.52, 18, s + 4);
        trussIso(ctx, f, 0.78, 0.68, 0.36, 0.08, 0.52, 2.85, 5, C.steelL, s + 5, 3);
        pipeIso(ctx, f, [[0.78, 0.68, 2.75], [0.78, 0.68, 0.6]], 4.5, C.brassL, s + 6, false);
        box(ctx, f, 0.68, 0.58, 0.88, 0.78, 2.82, 3.0, { top: C.steelD }, s + 7, { outline: 1.4, shadow: false });
        light(ctx, ...f.p(0.78, 0.68, 3.08), 2.8, C.ledWarm);
      });
      sc.add(f.depth(1.6, 0.55), () => {
        const rr = box(ctx, f, 1.32, 0.2, 1.85, 0.82, SZ, 1.0, C.coral, s + 1);
        faceLeds(ctx, f, rr, 'L', 0.82, 0.2, 0.8, 3, [C.ledWarm, C.led, C.ledWarm]);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.12, 0.82, s + 2, 3);
      });
      sc.add(f.depth(1.0, 1.5), () => {
        const rr = box(ctx, f, 0.15, 1.15, 1.85, 1.85, SZ, 0.95, C.teal, s + 8);
        faceGrille(ctx, f, rr, 'L', 0.55, 0.92, SZ + 0.12, 0.85, s + 9);
        faceLeds(ctx, f, rr, 'L', 0.72, 0.08, 0.4, 4, LEDS);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.12, 0.8, s + 10, 3);
        drumIso(ctx, f, 1.15, 1.5, 1.17, 0.17, 0.4, 'x', C.steelL, s + 11, { bands: [-0.5, 0, 0.5] });
        pipeIso(ctx, f, [[0.55, 1.35, 0.9], [0.7, 0.95, 0.5]], 5, C.steelD, s + 12);
        cableIso(ctx, f, [1.45, 1.25, 0.95], [1.5, 0.8, 0.95], 2, s + 13);
      });
      sc.run();
    },
  },
  deep_bore: {
    head: 5.0,
    draw(ctx, f, s) {
      // A heavy rig: a drill floor on its sub-structure, a tall derrick with crown block and
      // drill string over a geared rotary table, a pipe rack beside it and a power house with
      // its stack at the back.
      slab(ctx, f, C.steelD, 0.05, SZ, s, true);
      const sc = new Scene();
      sc.add(f.depth(2.62, 1.25), () => {
        for (const y of [0.45, 2.05]) {
          pipeIso(ctx, f, [[2.45, y, SZ], [2.45, y, 0.75]], 3, C.steelD, s + 30 + y * 10, false);
          pipeIso(ctx, f, [[2.8, y, SZ], [2.8, y, 0.75]], 3, C.steelD, s + 31 + y * 10, false);
        }
        const tubes = [[2.5, 0.82], [2.62, 0.82], [2.74, 0.82], [2.56, 0.95], [2.68, 0.95], [2.62, 1.08]] as const;
        for (const [i, [x, z]] of [...tubes].sort((a, b) => f.depth(a[0], 1) - f.depth(b[0], 1) || a[1] - b[1]).entries()) {
          drumIso(ctx, f, x, 1.25, z, 0.06, 0.95, 'y', i % 2 ? C.steelL : C.ice, s + 40 + i, { shadow: false, hub: false });
        }
      });
      sc.add(f.depth(1.3, 1.4), () => {
        const rr = box(ctx, f, 0.3, 0.45, 2.3, 2.3, SZ, 0.85, C.steel, s + 2);
        faceHazard(ctx, f, rr, 'L', 0.04, 0.96, 0.72, 0.82, s + 3);
        faceGrille(ctx, f, rr, 'R', 0.1, 0.9, SZ + 0.1, 0.65, s + 4, 3);
        cylinder(ctx, f, 1.3, 1.38, 0.36, 0.85, 1.02, C.steelD, s + 5, { top: C.brass });
        gearTeeth(ctx, f, 1.3, 1.38, 0.36, 1.02, 22, s + 6);
        trussIso(ctx, f, 1.3, 1.38, 0.72, 0.16, 0.85, 4.55, 7, C.steelL, s + 7, 3.6);
        pipeIso(ctx, f, [[1.3, 1.38, 4.45], [1.3, 1.38, 1.05]], 5.5, C.brassL, s + 8, false);
        box(ctx, f, 1.12, 1.2, 1.48, 1.56, 4.5, 4.75, { top: C.steelD }, s + 9, { outline: 1.6, shadow: false });
        light(ctx, ...f.p(1.3, 1.38, 4.85), 3.2, C.ledRed);
      });
      sc.add(f.depth(0.9, 2.62), () => {
        const rr = box(ctx, f, 0.22, 2.38, 1.6, 2.85, SZ, 1.15, C.coral, s + 10);
        faceGrille(ctx, f, rr, 'L', 0.08, 0.5, SZ + 0.12, 1.0, s + 11);
        faceLeds(ctx, f, rr, 'L', 0.9, 0.6, 0.92, 3, [C.ledWarm, C.led, C.ledWarm]);
        stackIso(ctx, f, 1.32, 2.62, 0.13, 2.2, s + 12);
      });
      sc.run();
    },
  },
  excavator: {
    head: 3.9,
    draw(ctx, f, s) {
      // A tracked cutter: two crawler tracks, a turret house with its counterweight and exhaust,
      // a boom carrying a toothed cutter wheel that bites the rock ahead (N).
      slab(ctx, f, C.steel, 0.04, SZ, s, true);
      const sc = new Scene();
      for (const [i, x] of [0.47, 2.53].entries()) sc.add(f.depth(x, 1.9), () => crawler(ctx, f, x, 0.95, 2.85, s + 10 * i));
      sc.add(f.depth(1.5, 2.05), () => {
        const rr = box(ctx, f, 0.76, 1.35, 2.24, 2.45, 0.78, 1.62, C.violet, s + 1);
        faceGrille(ctx, f, rr, 'R', 0.08, 0.5, 0.92, 1.48, s + 2);
        faceLeds(ctx, f, rr, 'L', 1.4, 0.08, 0.42, 5, [C.ledWarm, C.ledRed]);
        facePanel(ctx, f, rr, 'L', 0.55, 0.8, 0.85, 1.45, C.steelL, s + 3);
        const cw = box(ctx, f, 0.78, 2.45, 2.22, 2.82, 0.78, 1.42, C.steelD, s + 4);
        faceHazard(ctx, f, cw, 'L', 0.04, 0.96, 0.84, 1.0, s + 5);
        stackIso(ctx, f, 2.0, 1.75, 0.09, 2.25, s + 6, C.ledWarm, 1.62);
      });
      sc.add(f.depth(1.5, 0.7), () => {
        pipeIso(ctx, f, [[0.98, 1.45, 1.45], [1.02, 0.62, 2.0]], 7, C.coral, s + 7);
        pipeIso(ctx, f, [[2.02, 1.45, 1.45], [1.98, 0.62, 2.0]], 7, C.coral, s + 8);
        wheelIso(ctx, f, 1.5, 0.56, 2.0, 0.84, 'y', 14, C.steelL, s + 9);
      });
      sc.run();
    },
  },
  pump: {
    head: 1.72, // the service mast's insulator rises over the chalice (art/terminals.ts)
    draw(ctx, f, s) {
      // A standpipe pump: a motor housing on the plinth, the standpipe lifting water into a
      // brimming chalice head (the pump's namesake), a valve wheel on the riser.
      cylinder(ctx, f, 0.5, 0.52, 0.44, 0, 0.2, C.steel, s, { top: C.steelD });
      const sc = new Scene();
      sc.add(f.depth(0.5, 0.8), () => {
        const rr = box(ctx, f, 0.2, 0.66, 0.8, 0.9, 0.2, 0.62, C.teal, s + 1, { outline: 1.8 });
        faceGrille(ctx, f, rr, 'L', 0.12, 0.6, 0.27, 0.55, s + 2, 3);
        faceLeds(ctx, f, rr, 'L', 0.42, 0.72, 0.9, 2, [C.led, C.ledGreen]);
        drumIso(ctx, f, 0.5, 0.78, 0.76, 0.1, 0.24, 'x', C.steelL, s + 3, { bands: [0] });
      });
      sc.add(f.depth(0.5, 0.42), () => {
        latheIso(ctx, f, 0.5, 0.4, [[0.2, 0.1], [0.72, 0.1], [0.78, 0.14], [1.22, 0.36], [1.28, 0.38]], C.tealL, s + 4, { open: C.deep });
        const c = f.p(0.5, 0.4, 1.28);
        const [ex, ey] = f.ell(0.24);
        ink(ctx, ellipsePts(c[0] + 2, c[1] + 1, ex, ey, s + 5, 0.05, 24), { closed: true, w: 1.2, color: C.shallow, alpha: 0.9, shade: false, seed: s + 5 });
        const v = f.p(0.5, 0.4, 0.5);
        ink(ctx, ellipsePts(v[0] - 7, v[1] + 2, 5, 6, s + 6, 0, 16), { closed: true, w: 2, color: C.coral, shade: false, seed: s + 6 });
      });
      sc.run();
    },
  },
  sand_collector: {
    // A ground collector on the bare sand: its bucket wheel digs a pit at the back and tips the
    // sand onto a sieve over the hopper; the outlet is the port at the front (moving.ts).
    head: 2.25,
    moving: {
      body: collectorBody,
      part: collectorWheel,
      // The wheel's side is the nearer one when the back (S) is turned to the camera.
      over: (f) => f.depth(1, 1.9) > f.depth(1, 0.1),
    },
  },
  backfiller: {
    head: 2.72, // the service mast on the hopper's rim (art/terminals.ts)
    draw(ctx, f, s) {
      // A rubble hopper on legs: an incline belt climbs from the intake at the back into its open
      // mouth, and a chute under it drops the rubble forward, onto the land being won back.
      slab(ctx, f, C.steel, 0.05, SZ, s, true);
      const sc = new Scene();
      sc.add(f.depth(1.0, 0.8), () => {
        for (const [x, y] of ([[0.5, 0.4], [1.5, 0.4], [0.5, 1.2], [1.5, 1.2]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]))) {
          pipeIso(ctx, f, [[x, y, SZ], [x, y, 1.25]], 4, C.steelD, s + x * 10 + y, false);
        }
        prismIso(ctx, f, [[0.75, 0.04], [1.25, 0.04], [1.25, 0.55], [0.75, 0.55]], 0.5, [0.58, 0.58, 1.25, 1.25], { top: mix(C.violet, C.ink, 0.25), left: C.violet, right: mix(C.violet, C.ink, 0.35) }, s + 2, { outline: 1.8 });
        const top = frustumIso(ctx, f, 0.42, 0.3, 1.58, 1.3, 1.25, 2.15, -0.1, { top: C.steelL, left: mix(C.steelL, C.ink, 0.15), right: mix(C.steelL, C.ink, 0.4) }, s + 3, { open: C.ink });
        rubble(ctx, top, s + 4);
        const rr = f.rect(0.42, 0.3, 1.58, 1.3);
        faceLeds(ctx, f, rr, 'L', 1.15, 0.15, 0.4, 3, [C.ledWarm]);
      });
      sc.add(f.depth(0.5, 1.7), () => incline(ctx, f, 0.28, 0.72, 1.98, 0.42, 1.2, 2.08, s + 6));
      sc.run();
    },
  },

  // ── logistics ─────────────────────────────────────────────────────────────
  // Routing blocks: a riveted steel box whose four sides open on band-wide ribbon mouths; the lid
  // says what the block does (radiating chevrons, a sorting window, flap gates, a clamp…).
  router: {
    // Directional (owner, 2026-10-12): in at the back (S) only, out to the front and both sides.
    // The way in cannot be missed: a turquoise hopper mouth flares out of the back over the
    // ribbon, and a big glowing turquoise arrow runs from it across the lid to the middle; the
    // three ways out are coral nozzles, each with its own outward arrow.
    head: 0.85,
    draw(ctx, f, s) {
      if (intakeFirst(f)) intakeIso(ctx, f, s + 60);
      forkBox(ctx, f, C.teal, ROUTER_LIPS, s);
      lidLane(ctx, f, laneRect(2, 0.5, 0.5, 0, 0.46, 0.17), mix(C.turqD, C.ink, 0.3), s + 2);
      for (const side of [0, 1, 3]) lidLane(ctx, f, laneRect(side, 0.5, 0.5, 0.12, 0.46, 0.11), mix(C.teal, C.ink, 0.42), s + 3 + side);
      for (const side of [0, 1, 3]) {
        const [ax, ay] = lanePt(side, 0.5, 0.5, 0.2), [bx, by] = lanePt(side, 0.5, 0.5, 0.47);
        arrowIso(ctx, f, arrowPoly(ax, ay, bx, by, 0.04, 0.11, 0.12), LID, C.coral, 1.3, s + 10 + side);
      }
      // The way in: glowing (it is an LED token), so it reads at night too.
      arrowIso(ctx, f, arrowPoly(0.5, 0.97, 0.5, 0.4, 0.085, 0.215, 0.24), LID, C.glowTurq, 1.8, s + 20);
      light(ctx, ...f.p(0.16, 0.16, LID), 1.6, C.led);
      if (!intakeFirst(f)) intakeIso(ctx, f, s + 60);
    },
  },
  distributor: {
    head: 0.8,
    draw(ctx, f, s) {
      forkBox(ctx, f, C.teal, NEUTRAL, s);
      for (let side = 0; side < 4; side++) {
        for (const t of [0.5, 1.5]) {
          const [cx, cy] = side & 1 ? [1, t] : [t, 1];
          lidLane(ctx, f, laneRect(side, cx, cy, 0.5, 0.96, 0.13), mix(C.teal, C.ink, 0.38), s + side * 3 + t);
          chevronIso(ctx, f, ...lanePt(side, cx, cy, 0.76), LID, side, 0.1, C.ice, s + 10 + side * 3 + t);
        }
      }
      const c = f.p(1, 1, LID);
      const [ex, ey] = f.ell(0.5);
      flat(ctx, ellipsePts(c[0], c[1], ex, ey, s + 4, 0, 40), mix(C.teal, C.ink, 0.38));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        light(ctx, ...f.p(1 + Math.cos(a) * 0.42, 1 + Math.sin(a) * 0.42, LID), 1.8, i % 2 ? C.led : C.ledWarm);
      }
      hubIso(ctx, f, 1, 1, 0.3, s + 20);
    },
  },
  incinerator: {
    // The incinerator (D51): the routing blocks' riveted box in dark steel, a turquoise mouth on
    // each of its four sides (everything goes in, nothing comes out), and on the lid a round grated
    // firebox glowing amber (its one hot part) beside a short stack.
    head: 1.2,
    draw(ctx, f, s) {
      forkBox(ctx, f, mix(C.steel, C.ink, 0.25), [C.turq, C.turq, C.turq, C.turq], s);
      for (let side = 0; side < 4; side++) {
        lidLane(ctx, f, laneRect(side, 0.5, 0.5, 0.3, 0.47, 0.09), mix(C.turq, C.ink, 0.45), s + 2 + side);
        chevronIso(ctx, f, ...lanePt(side, 0.5, 0.5, 0.38), LID, (side + 2) & 3, 0.06, C.ice, s + 6 + side);
      }
      const c = f.p(0.5, 0.5, LID);
      const [ex, ey] = f.ell(0.27);
      flat(ctx, ellipsePts(c[0], c[1], ex, ey, s + 12, 0, 28), C.steelDD);
      flat(ctx, ellipsePts(c[0], c[1], ex * 0.74, ey * 0.74, s + 13, 0, 28), C.ledWarm, 0.95);
      for (const k of [-0.4, 0, 0.4]) ink(ctx, [[c[0] - ex * 0.7, c[1] + ey * k], [c[0] + ex * 0.7, c[1] + ey * k]], { w: 1.4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 14 });
      ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 15, 0, 28), { closed: true, w: 1.5, shade: false, taper: 0, seed: s + 15 });
      light(ctx, c[0], c[1], 4, C.ledWarm);
      stackIso(ctx, f, 0.8, 0.2, 0.07, 1.2, s + 20, C.ledWarm, LID);
    },
  },
  sorter: { head: LID, draw: (ctx, f, s) => sorterIso(ctx, f, s, false) },
  inverted_sorter: { head: LID, draw: (ctx, f, s) => sorterIso(ctx, f, s, true) },
  overflow_gate: { head: 0.85, draw: (ctx, f, s) => gateIso(ctx, f, s, false) },
  underflow_gate: { head: 0.85, draw: (ctx, f, s) => gateIso(ctx, f, s, true) },
  unloader: {
    head: UNLOADER_TOP,
    draw(ctx, f, s) {
      forkBox(ctx, f, C.violet, [C.brassL, C.brassL, C.brassL, C.brassL], s);
      for (let side = 0; side < 4; side++) lidLane(ctx, f, laneRect(side, 0.5, 0.5, 0.2, 0.46, 0.13), mix(C.violet, C.ink, 0.4), s + side);
      // Clamp jaws at the corners, far ones first; the suction head and its window in the middle.
      const jaws = ([[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
      const sc = new Scene();
      for (const [i, [x, y]] of jaws.entries()) {
        sc.add(f.depth(x, y), () => {
          box(ctx, f, x - 0.09, y - 0.09, x + 0.09, y + 0.09, LID, LID + 0.13, { top: C.brass }, s + 30 + i, { outline: 1.6, shadow: false });
          const [jx, jy] = f.p(x + (x < 0.5 ? -0.03 : 0.03), y + (y < 0.5 ? -0.03 : 0.03), LID + 0.13);
          rivet(ctx, jx, jy, 1.6, C.brassL);
        });
      }
      sc.add(f.depth(0.5, 0.5), () => {
        latheIso(ctx, f, 0.5, 0.5, [[LID, 0.3], [LID + 0.04, 0.3], [LID + 0.04, 0.25], [LID + 0.08, 0.28], [LID + 0.12, 0.24], [LID + 0.16, 0.28], [LID + 0.2, 0.25], [LID + 0.2, 0.22]], C.violetL, s + 40, { top: C.violet, shadow: false });
        box(ctx, f, 0.26, 0.26, 0.74, 0.74, LID + 0.2, UNLOADER_TOP, { top: C.steelL }, s + 41, { outline: 1.8, shadow: false });
        windowIso(ctx, f, 0.5, 0.5, 0.2, UNLOADER_TOP, s + 42);
      });
      sc.run();
    },
  },
  crossing: {
    // A little humped bridge: the north–south line over its deck, the east–west one through its
    // tunnel (`junctionIso`, with the routing blocks above).
    head: J_DECK + J_PARAPET + 0.25,
    draw: (ctx, f, s) => junctionIso(ctx, f, s),
  },
  skybridge: {
    // A bridge end, start or far alike (`SKY`, above): a riveted footing, the line's band across it
    // (towards the leap: its chevron), a hazard-striped gantry over it. A pair's ramps and deck are
    // the buildings view's (`drawSkyPiece`): they lie over the footing, under the gantry's front.
    head: SKY_HEAD,
    draw(ctx, f, s) {
      box(ctx, f, 0.05, 0.03, 0.95, 0.97, 0, 0.1, { top: C.steel }, s, { outline: 1.8, shadow: false });
      for (const [x0, x1] of [[0.06, SKY.g0], [SKY.g1, 0.94]] as const) {
        for (const y of [0.15, 0.85]) rivet(ctx, ...f.p((x0 + x1) / 2, y, 0.1), 1.6, C.steelL);
      }
      lidLane(ctx, f, [SKY.r0, 0.04, SKY.r1, 0.96], C.tealL, s + 1, 0.1);
      for (let k = 0; k < 8; k++) {
        const y = (k + 0.5) / 8;
        ink(ctx, [f.p(SKY.r0 + 0.02, y, 0.1), f.p(SKY.r1 - 0.02, y, 0.1)], { w: 1.5, color: C.teal, shade: false, taper: 0, jitter: 0, seed: s + 2 + k });
      }
      chevronIso(ctx, f, 0.5, 0.22, 0.1, 0, 0.13, C.ice, s + 12, 3.2);
      skyGantry(ctx, f, s + 40, false);
    },
  },
  silo: {
    head: 3.5,
    draw(ctx, f, s) {
      // A tall store tank: a banded cylinder with a catwalk ring, a cone roof and its hatch, a
      // ladder and a glowing level gauge on the side facing the camera.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const [lx, ly] = facingDir(f, -0.42, 0.91), [gx, gy] = facingDir(f, 0.6, 0.8);
      latheIso(ctx, f, 1, 1.02, [[SZ, 0.78], [0.95, 0.78], [1.55, 0.78], [2.15, 0.78], [2.62, 0.78], [2.62, 0.84], [2.68, 0.84], [2.68, 0.76], [3.12, 0.16], [3.16, 0.16]], C.ice, s + 1, { top: C.steelL });
      // Level gauge and ladder on the surface turned to the camera.
      ink(ctx, [f.p(1 + gx * 0.79, 1.02 + gy * 0.79, 0.55), f.p(1 + gx * 0.79, 1.02 + gy * 0.79, 2.45)], { w: 4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 2 });
      ink(ctx, [f.p(1 + gx * 0.79, 1.02 + gy * 0.79, 0.6), f.p(1 + gx * 0.79, 1.02 + gy * 0.79, 1.9)], { w: 2.2, color: C.led, shade: false, taper: 0, jitter: 0, seed: s + 3 });
      ladderIso(ctx, f, 1 + lx * 0.8, 1.02 + ly * 0.8, -ly, lx, SZ, 2.68, s + 4);
      // Catwalk railing round the top.
      const posts: Pt[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = 1 + Math.cos(a) * 0.84, y = 1.02 + Math.sin(a) * 0.84;
        if (f.depth(x, y) < f.depth(1, 1.02)) continue;
        ink(ctx, [f.p(x, y, 2.68), f.p(x, y, 2.88)], { w: 1.2, color: C.steelD, shade: false, taper: 0, seed: s + 10 + i });
        posts.push(f.p(x, y, 2.88));
      }
      ink(ctx, posts.sort((a, b) => a[0] - b[0]), { w: 1.4, color: C.steelD, shade: false, taper: 0, seed: s + 30 });
      box(ctx, f, 0.9, 0.92, 1.1, 1.12, 3.1, 3.22, { top: C.steelD }, s + 31, { outline: 1.2, shadow: false });
      light(ctx, ...f.p(1, 1.02, 3.3), 2.6, C.coral);
      const rr = f.rect(0.05, 0.05, 1.95, 1.95);
      faceLeds(ctx, f, rr, 'L', SZ * 0.5, 0.15, 0.4, 3, LEDS);
    },
  },
  skydock: {
    head: 5.5,
    draw(ctx, f, s) {
      // An automated mooring mast for the uncrewed drifters: a lattice tower over a lit landing
      // ring with three docking clamps; high up under the mooring cup, the winch pod that reels
      // the mooring line (a drum, LEDs, a hazard band — no cabin); at the mast's foot the hoist
      // cabinet whose cable runs up the tower.
      slab(ctx, f, C.steelD, 0.04, SZ, s);
      cylinder(ctx, f, 1.5, 1.5, 1.28, SZ, 0.5, C.steelDD, s + 1, { top: C.steelD });
      const c = f.p(1.5, 1.5, 0.5);
      const [ex, ey] = f.ell(1.06);
      ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 2, 0, 48), { closed: true, w: 3, color: C.cyan, shade: false, seed: s + 2 });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; light(ctx, c[0] + Math.cos(a) * ex, c[1] + Math.sin(a) * ey, 2.2, i % 2 ? C.led : C.ledWarm); }
      const sc = new Scene();
      for (const [i, a] of [0.5, 2.6, 4.7].entries()) {
        const x = 1.5 + Math.cos(a) * 0.82, y = 1.5 + Math.sin(a) * 0.82;
        sc.add(f.depth(x, y) - 0.5, () => {
          box(ctx, f, x - 0.1, y - 0.1, x + 0.1, y + 0.1, 0.5, 0.66, { top: C.hazard, left: C.brass, right: mix(C.brass, C.ink, 0.4) }, s + 30 + i, { outline: 1.4 });
          light(ctx, ...f.p(x, y, 0.7), 1.5, C.ledGreen);
        });
      }
      sc.add(f.depth(1.5, 1.5), () => {
        trussIso(ctx, f, 1.5, 1.5, 0.3, 0.12, 0.5, 4.35, 7, C.steelL, s + 3, 3);
        ink(ctx, [f.p(1.62, 1.86, 1.0), f.p(1.56, 1.62, 3.3)], { w: 1.6, color: C.steelDD, shade: false, taper: 0, seed: s + 9 });
        // The winch pod round the mast: a banded drum, its line drum on the side, LEDs.
        latheIso(ctx, f, 1.5, 1.5, [[3.3, 0.2], [3.36, 0.3], [3.86, 0.3], [3.92, 0.22], [3.96, 0.22]], C.steel, s + 4, { top: C.steelD });
        const pc = f.p(1.5, 1.5, 3.62), [px, py] = f.ell(0.3);
        ink(ctx, ellipsePts(pc[0], pc[1], px, py, s + 10, 0, 32).filter(([, y]) => y >= pc[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 5, color: C.hazard, shade: false, taper: 0, seed: s + 10 });
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (0.15 + i * 0.17);
          light(ctx, pc[0] + Math.cos(a) * px * 0.98, pc[1] + Math.sin(a) * py * 0.98 + 7, 1.6, i % 2 ? C.led : C.ledGreen);
        }
        const [dx, dy] = facingDir(f, 0.36, 0);
        drumIso(ctx, f, 1.5 + dx, 1.5 + dy, 3.55, 0.09, 0.12, Math.abs(dx) > Math.abs(dy) ? 'y' : 'x', C.brass, s + 11, { bands: [-0.4, 0.4] });
        latheIso(ctx, f, 1.5, 1.5, [[4.3, 0.08], [4.45, 0.12], [4.75, 0.34], [4.8, 0.36]], C.brass, s + 5, { open: C.steelDD });
        light(ctx, ...f.p(1.5, 1.5, 4.95), 3, C.ledRed);
        pipeIso(ctx, f, [[1.5, 1.5, 4.5], [2.35, 1.0, 4.4]], 3, C.steelD, s + 6);
        light(ctx, ...f.p(2.35, 1.0, 4.4), 2.4, C.ledWarm);
      });
      sc.add(f.depth(1.5, 2.15), () => {
        const rr = box(ctx, f, 1.22, 1.95, 1.78, 2.32, 0.5, 1.02, C.steel, s + 7);
        faceGrille(ctx, f, rr, 'L', 0.12, 0.55, 0.58, 0.92, s + 8, 3);
        faceLeds(ctx, f, rr, 'L', 0.82, 0.68, 0.9, 3, LEDS);
        faceHazard(ctx, f, rr, 'R', 0.08, 0.92, 0.56, 0.68, s + 12);
        drumIso(ctx, f, 1.5, 2.13, 1.1, 0.08, 0.2, 'x', C.steelL, s + 13, { bands: [0], shadow: false });
      });
      sc.run();
    },
  },

  // ── production ────────────────────────────────────────────────────────────
  kiln: {
    head: 3.25,
    draw(ctx, f, s) {
      // A furnace: a battered brick shaft with a glowing arched mouth, a charging hopper on top
      // full of embers, two stacks with hot rims behind it; steel straps hold the brickwork.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      for (const [i, y] of [0.48, 1.3].entries()) sc.add(f.depth(1.72, y), () => stackIso(ctx, f, 1.72, y, 0.15, 2.75 + i * 0.3, s + 10 + i));
      sc.add(f.depth(0.85, 0.95), () => {
        furnace(ctx, f, 0.2, 0.3, 1.45, 1.62, 1.85, 0.2, s + 1);
        pipeIso(ctx, f, [[1.3, 0.75, 1.45], [1.6, 0.6, 1.55]], 5, C.steelL, s + 20);
      });
      sc.run();
    },
  },
  kiln_compact: {
    head: 2.9,
    draw(ctx, f, s) {
      // The same furnace on a narrow footprint: one stack ahead of the shaft.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.5, 0.38), () => stackIso(ctx, f, 0.5, 0.38, 0.14, 2.6, s + 3));
      sc.add(f.depth(0.5, 1.25), () => furnace(ctx, f, 0.14, 0.68, 0.86, 1.86, 1.6, 0.13, s + 1));
      sc.run();
    },
  },
  wire_mill: {
    head: 1.95,
    draw(ctx, f, s) {
      // Spools and rollers on a teal bed: wire unwinds from the feed spool, through a drawing die
      // and a pair of rollers, onto the take-up spool.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const rr = box(ctx, f, 0.12, 0.14, 0.88, 1.86, SZ, 0.55, C.teal, s + 1);
      faceGrille(ctx, f, rr, 'L', 0.15, 0.85, SZ + 0.06, 0.48, s + 2, 2);
      faceLeds(ctx, f, rr, 'R', 0.43, 0.3, 0.7, 3, LEDS);
      const sc = new Scene();
      for (const [i, y] of [0.5, 1.5].entries()) sc.add(f.depth(0.5, y), () => spoolIso(ctx, f, 0.5, y, 1.15, s + 10 * i));
      sc.add(f.depth(0.5, 1.0), () => {
        box(ctx, f, 0.3, 0.9, 0.7, 1.1, 0.55, 0.82, C.steelD, s + 30, { outline: 1.6 });
        for (const z of [0.95, 1.13]) drumIso(ctx, f, 0.5, 1.0, z, 0.05, 0.2, 'x', C.steelL, s + 31 + z * 10, { shadow: false, hub: false });
        ink(ctx, [f.p(0.5, 0.5, 1.6), f.p(0.5, 1.0, 1.04), f.p(0.5, 1.5, 1.55)], { w: 1.6, color: C.brassL, shade: false, taper: 0, seed: s + 33 });
      });
      sc.run();
    },
  },
  workshop: {
    head: 2.85,
    draw(ctx, f, s) {
      // A press: two violet columns and a crown beam carrying a hydraulic ram over a hazard-edged
      // bolster with a coral blank on it; a control cabinet beside.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.45, 1.72), () => {
        const rr = box(ctx, f, 0.18, 1.56, 0.72, 1.9, SZ, 1.05, C.steelL, s + 1);
        faceLeds(ctx, f, rr, 'L', 0.88, 0.15, 0.85, 3, LEDS);
        facePanel(ctx, f, rr, 'L', 0.25, 0.75, SZ + 0.08, 0.7, C.steel, s + 2);
      });
      pressFrame(ctx, f, sc, 0.2, 1.8, 0.62, 1.48, 2.05, s + 10);
      sc.run();
    },
  },
  great_workshop: {
    head: 2.55,
    draw(ctx, f, s) {
      // An assembly hall under a sawtooth roof (louvred faces to the yard) and a gantry crane
      // over the yard in front, a crate on its hook.
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const sc = new Scene();
      const hallNear = f.depth(1.5, 2.0) > f.depth(1.5, 0.6);
      sawHall(ctx, f, sc, 0.18, 1.15, 2.82, 2.8, 1.2, 3, s + 1, hallNear ? 100 : 0);
      gantry(ctx, f, sc, 0.22, 0.14, 2.78, 1.0, 1.95, s + 30, hallNear ? 0 : 100);
      sc.run();
    },
  },
  great_workshop_compact: {
    head: 2.0,
    draw(ctx, f, s) {
      // The same hall on 2×2: two sawtooth bays, and a robot arm working the yard in front.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      const hallNear = f.depth(1, 1.35) > f.depth(1, 0.42);
      sawHall(ctx, f, sc, 0.15, 0.85, 1.85, 1.86, 1.1, 2, s + 1, hallNear ? 100 : 0);
      sc.add(hallNear ? 0 : 100, () => robotArm(ctx, f, 0.62, 0.42, s + 30));
      sc.run();
    },
  },
  tower_workshop: {
    head: 6.1,
    draw(ctx, f, s) {
      // A stepped assembly tower: four cone-topped feed tanks pipe their stock into a violet core
      // that climbs to a mast; louvres and LED rows on its faces.
      slab(ctx, f, C.steelD, 0.04, SZ, s, true);
      const sc = new Scene();
      for (const [i, [x, y]] of ([[0.55, 0.55], [2.45, 0.55], [0.55, 2.45], [2.45, 2.45]] as const).entries()) {
        sc.add(f.depth(x, y), () => {
          latheIso(ctx, f, x, y, [[SZ, 0.32], [0.75, 0.32], [1.15, 0.32], [1.15, 0.34], [1.2, 0.34], [1.5, 0.08], [1.55, 0.08]], i % 2 ? C.cyan : C.ice, s + 20 + i, { top: C.steelL });
          light(ctx, ...f.p(x, y, 1.62), 2.2, C.led);
        });
        const mx = x + (1.5 - x) * 0.55, my = y + (1.5 - y) * 0.55;
        sc.add((f.depth(x, y) + f.depth(mx, my)) / 2, () => pipeIso(ctx, f, [[x, y, 0.95], [mx, my, 0.95]], 4, C.steelL, s + 40 + i, false));
      }
      sc.add(f.depth(1.5, 1.5), () => {
        const a = box(ctx, f, 0.95, 0.95, 2.05, 2.05, SZ, 2.6, C.violet, s + 1);
        faceGrille(ctx, f, a, 'L', 0.15, 0.85, 1.5, 2.3, s + 2);
        faceGrille(ctx, f, a, 'R', 0.15, 0.85, 1.5, 2.3, s + 3);
        faceLeds(ctx, f, a, 'L', 0.95, 0.2, 0.8, 4, LEDS);
        faceLeds(ctx, f, a, 'R', 0.95, 0.2, 0.8, 4, [C.ledWarm, C.led]);
        const b = box(ctx, f, 1.12, 1.12, 1.88, 1.88, 2.6, 4.3, mix(C.violet, '#ffffff', 0.12), s + 4);
        faceGrille(ctx, f, b, 'L', 0.2, 0.8, 3.2, 3.9, s + 5);
        faceLeds(ctx, f, b, 'R', 3.5, 0.25, 0.75, 3, [C.ledWarm]);
        spireIso(ctx, f, 1.5, 1.5, 0.28, 4.3, 5.9, C.steelD, C.led, s + 6);
      });
      sc.run();
    },
  },
  ceramic_oven: {
    head: 3.05,
    draw(ctx, f, s) {
      // A tunnel kiln: a long brick body under a steel hip roof with vent hoods, a row of glowing
      // spy-holes along its sides, a tall exhaust stack, and a kiln car on rails at its mouth.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.3, 0.3), () => stackIso(ctx, f, 0.3, 0.3, 0.13, 2.85, s + 1));
      sc.add(f.depth(1.05, 0.33), () => {
        for (const y of [0.24, 0.42]) ink(ctx, [f.p(0.55, y, SZ), f.p(1.95, y, SZ)], { w: 2, color: C.steelL, shade: false, taper: 0, seed: s + 2 + y * 10 });
        box(ctx, f, 1.15, 0.18, 1.7, 0.48, SZ + 0.04, 0.42, C.steelD, s + 3, { outline: 1.4 });
        for (const [i, x] of [1.25, 1.42, 1.59].entries()) box(ctx, f, x - 0.06, 0.24, x + 0.06, 0.42, 0.42, 0.52, { top: C.peachL }, s + 4 + i, { outline: 1, shadow: false });
      });
      sc.add(f.depth(1.05, 1.15), () => {
        const rr = box(ctx, f, 0.25, 0.62, 1.85, 1.62, SZ, 1.05, { top: C.steel, left: BRICK, right: mix(BRICK, C.ink, 0.35) }, s + 5);
        brickwork(ctx, f, rr, 'L', SZ, 1.05, s + 6);
        brickwork(ctx, f, rr, 'R', SZ, 1.05, s + 7);
        for (let i = 0; i < 4; i++) spyHole(ctx, f, rr, 'L', 0.14 + i * 0.24, 0.66);
        for (let i = 0; i < 2; i++) spyHole(ctx, f, rr, 'R', 0.3 + i * 0.4, 0.66);
        frustumIso(ctx, f, 0.2, 0.57, 1.9, 1.67, 1.05, 1.45, 0.24, { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.35) }, s + 8);
        for (const [i, x] of [0.62, 1.05, 1.48].entries()) {
          box(ctx, f, x - 0.1, 1.04, x + 0.1, 1.2, 1.45, 1.68, { top: C.steelD }, s + 9 + i, { outline: 1.3 });
          light(ctx, ...f.p(x, 1.12, 1.72), 1.8, C.ledWarm);
        }
      });
      sc.run();
    },
  },
  observatory: {
    head: 3.3,
    draw(ctx, f, s) {
      // An automated science station: the telescope's dome (an instrument, not a home) on an
      // instrument drum of riveted panels, louvres and status LEDs; a weather mast with its cup
      // anemometer and vane; and the data uplink, a small dish that sends the readings to the
      // labs in Verrière.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(1, 1.05), () => {
        cylinder(ctx, f, 0.95, 1.05, 0.78, SZ, 1.1, C.steelL, s + 30, { top: C.steel, rings: 1 });
        const d0 = f.depth(0.95, 1.05);
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2, cx = 0.95 + Math.cos(a) * 0.78, cy = 1.05 + Math.sin(a) * 0.78;
          if (f.depth(cx, cy) - d0 < 0.3) continue;
          const P = (da: number, z: number): Pt => f.p(0.95 + Math.cos(a + da) * 0.78, 1.05 + Math.sin(a + da) * 0.78, z);
          ink(ctx, [P(0, SZ + 0.05), P(0, 1.05)], { w: 1, color: C.ink, alpha: 0.3, shade: false, taper: 0, jitter: 0, seed: s + 40 + k });
          if (k % 2) shape(ctx, [P(0.07, 0.82), P(0.3, 0.82), P(0.3, 0.6), P(0.07, 0.6)], C.steelDD, { w: 1, shade: false, jitter: 0, seed: s + 55 + k });
          else light(ctx, ...P(0.18, 0.88), 1.6, k % 4 ? C.led : C.ledGreen);
        }
        domeIso(ctx, f, 0.95, 1.05, 0.72, 1.1, 1.35, C.violet, s + 2, C.cyan);
        const a = f.p(0.95, 1.05, 2.45), b = f.p(0.62, 0.6, 2.0);
        ink(ctx, [a, b], { w: 9, color: C.steelDD, shade: false, taper: 0, jitter: 0 });
        pipeIso(ctx, f, [[0.95, 1.05, 2.2], [0.35, 0.45, 3.0]], 7, C.steelL, s + 3);
        light(ctx, ...f.p(0.35, 0.45, 3.0), 2.8, C.led);
      });
      // The data uplink on its pedestal: a small dish leaning to the screen's left, like the Heart's.
      sc.add(f.depth(1.6, 0.48), () => {
        cylinder(ctx, f, 1.62, 0.45, 0.12, SZ, 0.95, C.steelD, s + 6, { top: C.steel });
        const [lx, ly] = facingDir(f, -Math.SQRT1_2, Math.SQRT1_2);
        const n: V3 = [lx * 0.6, ly * 0.6, 0.8];
        pipeIso(ctx, f, [[1.62, 0.45, 0.95], [1.62 - n[0] * 0.04, 0.45 - n[1] * 0.04, 1.08]], 6, C.steelD, s + 7, false);
        dish3d(ctx, f, [1.62 + n[0] * 0.06, 0.45 + n[1] * 0.06, 0.6], 0.3, n, s + 8, { focal: 0.75, struts: 3 });
      });
      // The weather mast: cup anemometer, vane, a sensor box and its light.
      sc.add(f.depth(1.66, 1.62), () => {
        cylinder(ctx, f, 1.66, 1.62, 0.1, SZ, 0.45, C.steelD, s + 9, { top: C.steel });
        pipeIso(ctx, f, [[1.66, 1.62, 0.45], [1.66, 1.62, 2.55]], 3, C.steelL, s + 10, false);
        box(ctx, f, 1.6, 1.56, 1.72, 1.68, 1.35, 1.62, C.teal, s + 11, { outline: 1.2, shadow: false });
        light(ctx, ...f.p(1.72, 1.62, 1.5), 1.5, C.ledGreen);
        const top = f.p(1.66, 1.62, 2.55);
        for (let i = 0; i < 3; i++) {
          const a2 = (i / 3) * Math.PI * 2 + 0.4, e = f.p(1.66 + Math.cos(a2) * 0.16, 1.62 + Math.sin(a2) * 0.16, 2.55);
          ink(ctx, [top, e], { w: 1.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 12 + i });
          shape(ctx, ellipsePts(e[0], e[1] + 1, 3.2, 2.6, s + 15 + i, 0, 12), C.ice, { w: 1, shade: false, jitter: 0, seed: s + 15 + i });
        }
        ink(ctx, [f.p(1.66, 1.62, 2.35), f.p(1.86, 1.5, 2.35)], { w: 1.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 18 });
        shape(ctx, [f.p(1.86, 1.5, 2.43), f.p(1.98, 1.43, 2.35), f.p(1.86, 1.5, 2.27)], C.coral, { w: 1, shade: false, jitter: 0, seed: s + 19 });
        light(ctx, ...f.p(1.66, 1.62, 2.66), 2, C.ledRed);
      });
      sc.run();
      const rr = f.rect(0.05, 0.05, 1.95, 1.95);
      faceLeds(ctx, f, rr, 'L', SZ * 0.5, 0.1, 0.35, 3, LEDS);
    },
  },
  cell_charger: {
    head: 2.0,
    draw(ctx, f, s) {
      // A charging bay: a finned transformer with three porcelain bushings, brass bus bars to a
      // rack of cells that glow green as they fill.
      slab(ctx, f, C.steelD, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.68, 1.32), () => {
        const rr = box(ctx, f, 0.2, 0.86, 1.15, 1.8, SZ, 1.3, C.violet, s + 1);
        fins(ctx, f, rr, 'L', SZ + 0.08, 1.2, 9, s + 2);
        fins(ctx, f, rr, 'R', SZ + 0.08, 1.2, 9, s + 3);
        for (const [i, x] of ([0.42, 0.68, 0.94] as const).entries()) {
          latheIso(ctx, f, x, 1.33, [[1.3, 0.08], [1.36, 0.08], [1.36, 0.12], [1.42, 0.12], [1.42, 0.08], [1.5, 0.08], [1.5, 0.12], [1.56, 0.12], [1.56, 0.08], [1.64, 0.08], [1.64, 0.12], [1.7, 0.12], [1.7, 0.05], [1.8, 0.05]], C.ice, s + 4 + i, { top: C.brassL, shadow: false, seams: false });
        }
        // The free bushing (no bus bar to the rack) takes the line in: its cap is the terminal (art/terminals.ts).
        terminalProbe.fn?.(CHARGER_BUSHING.x, CHARGER_BUSHING.y, CHARGER_BUSHING.z);
      });
      sc.add(f.depth(1.5, 0.75), () => {
        for (const [x, y] of ([[1.22, 0.22], [1.88, 0.22], [1.22, 1.28], [1.88, 1.28]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]))) {
          pipeIso(ctx, f, [[x, y, SZ], [x, y, 1.05]], 3, C.steelL, s + x * 10 + y, false);
        }
        box(ctx, f, 1.15, 0.15, 1.95, 1.35, 0.5, 0.58, { top: C.steel }, s + 10, { outline: 1.6 });
        const cells = ([[1.37, 0.43, 1], [1.74, 0.43, 1], [1.37, 1.05, 0], [1.74, 1.05, 1]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
        for (const [i, [x, y, full]] of cells.entries()) {
          latheIso(ctx, f, x, y, [[0.58, 0.16], [1.12, 0.16], [1.12, 0.11], [1.2, 0.11]], full ? C.ice : C.violetL, s + 11 + i, { top: C.brassL, shadow: false });
          const b = f.p(x, y, 0.85);
          const [ex, ey] = f.ell(0.16);
          ink(ctx, ellipsePts(b[0], b[1], ex, ey, s + 20 + i, 0, 24).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 3, color: full ? C.ledGreen : C.violet, shade: false, taper: 0, seed: s + 21 + i });
        }
      });
      sc.add(99, () => {
        pipeIso(ctx, f, [[0.94, 1.33, 1.78], [1.4, 1.0, 1.4], [1.55, 0.75, 1.15]], 3, C.brass, s + 30, false);
        pipeIso(ctx, f, [[0.68, 1.33, 1.78], [1.2, 1.3, 1.45], [1.55, 1.05, 1.15]], 3, C.brass, s + 31, false);
      });
      sc.run();
    },
  },

  // ── energy ────────────────────────────────────────────────────────────────
  // The pole and the pylon: their wires' terminals are their crossarm insulators (art/terminals.ts).
  mast: { head: POLE.top + INSULATOR + 0.1, draw: poleIso },
  pylon: { head: PYLON.apex + 0.3, draw: pylonIso },
  brazier: {
    head: 3.3,
    draw(ctx, f, s) {
      // A fire-tube boiler: a firebox with a glowing grate door, the boiler drum on top, and the
      // coal generator itself — a flared fire basket crowning the stack at the front, flames leaping.
      slab(ctx, f, C.steel, 0.07, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.5, 0.45), () => {
        latheIso(ctx, f, 0.5, 0.45, [[SZ, 0.2], [0.5, 0.2], [0.5, 0.12], [1.62, 0.12], [1.66, 0.16], [2.02, 0.36], [2.08, 0.38]], C.steelD, s + 1, { open: C.ink });
        for (const z of [0.9, 1.3]) {
          const c = f.p(0.5, 0.45, z), [ex, ey] = f.ell(0.12);
          ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 2, 0, 20).filter(([, y]) => y >= c[1] - 0.5).sort((a, b) => a[0] - b[0]), { w: 2, color: C.brass, shade: false, taper: 0, seed: s + 2 + z });
        }
        const [x, y] = f.p(0.5, 0.45, 2.08);
        const [ex, ey] = f.ell(0.3);
        flat(ctx, ellipsePts(x, y, ex, ey, s + 3, 0.04, 24), C.warn);
        flat(ctx, ellipsePts(x + 2, y + 1, ex * 0.6, ey * 0.6, s + 4, 0.04, 20), C.glowPeach);
        light(ctx, x, y - 10, 9, C.ledWarm);
        for (let i = 0; i < 5; i++) {
          const ox = (i - 2) * 8.5, h = 26 + ((i * 7) % 3) * 9 - Math.abs(i - 2) * 4;
          shape(ctx, [[x + ox - 6, y + 3], [x + ox - 2, y - h * 0.55], [x + ox + 2, y - h], [x + ox + 3, y - h * 0.5], [x + ox + 7, y + 3]], i % 2 ? C.coral : C.glowPeach, { w: 1.3, shade: false, seed: s + 5 + i });
        }
        for (const [dx, dy] of [[-12, -46], [9, -54], [2, -62]] as const) light(ctx, x + dx, y + dy, 1.4, C.ledWarm);
      });
      sc.add(f.depth(0.5, 1.35), () => {
        const rr = box(ctx, f, 0.14, 0.88, 0.86, 1.86, SZ, 0.95, C.steelD, s + 6);
        faceGlow(ctx, f, rr, 'L', 0.28, 0.72, 0.42, 0.78, C.ledWarm);
        faceGrille(ctx, f, rr, 'R', 0.1, 0.9, SZ + 0.08, 0.85, s + 7, 3);
        drumIso(ctx, f, 0.5, 1.37, 1.2, 0.22, 0.42, 'y', C.steelL, s + 8, { bands: [-0.55, 0, 0.55] });
        pipeIso(ctx, f, [[0.5, 0.95, 1.25], [0.5, 0.6, 1.45]], 4, C.brass, s + 9);
      });
      sc.run();
    },
  },
  wind_flower: {
    // A Dune-style wind tower under a helical crown that turns with the wind (moving.ts).
    head: TURBINE.top + 0.25,
    moving: {
      body: turbineBody,
      part: turbineCrown,
      over: () => true,
      // Spinning, the crown casts a solid band: its two rings' hull, the shaft and cone over it.
      shadow(ctx, f, s) {
        const { cx, cy, r, z0, z1 } = TURBINE;
        const ring = (z: number): Pt[] => { const c = f.p(cx, cy, z), [ex, ey] = f.ell(r + 0.03); return ellipsePts(c[0], c[1], ex, ey, s, 0, 32); };
        flat(ctx, hull([...ring(z0), ...ring(z1)]), C.ink);
        turbineCrown(ctx, f, s, 0);
      },
    },
  },
  sun_bulb: {
    head: 3.1,
    draw(ctx, f, s) {
      // A dish concentrator: a pedestal and yoke tilt a faceted mirror dish to the sun; three
      // struts hold the receiver — the glowing "bulb" — at its focus.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const rr = box(ctx, f, 1.45, 1.5, 1.85, 1.85, SZ, 0.75, C.teal, s + 1, { outline: 1.6 });
      faceLeds(ctx, f, rr, 'L', 0.6, 0.25, 0.75, 2, [C.ledGreen, C.led]);
      cylinder(ctx, f, 0.95, 0.95, 0.15, SZ, 1.05, C.steelD, s + 2, { top: C.steel });
      sunDish(ctx, f, 0.95, 0.95, 1.55, 0.86, s + 3);
    },
  },
  accumulator: {
    head: 1.75,
    draw(ctx, f, s) {
      // A capacitor bank: four ribbed cells on the plinth, stepped lids with twin brass
      // terminals, green charge bands, bus bars tying them, a charge gauge.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const cells = ([[0.55, 0.55, C.violet], [1.45, 0.55, C.violetL], [0.55, 1.45, C.violetL], [1.45, 1.45, C.violet]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
      for (const [i, [x, y, col]] of cells.entries()) {
        latheIso(ctx, f, x, y, [[SZ, 0.35], [SZ + 0.08, 0.35], [SZ + 0.08, 0.32], [0.62, 0.32], [0.78, 0.32], [0.94, 0.32], [1.1, 0.32], [1.1, 0.27], [1.18, 0.27], [1.18, 0.2], [1.24, 0.2]], col, s + i * 5, { top: C.steelD });
        const b = f.p(x, y, 0.7);
        const [ex, ey] = f.ell(0.32);
        ink(ctx, ellipsePts(b[0], b[1], ex, ey, s + 20 + i, 0, 32).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 3.4, color: C.ledGreen, shade: false, taper: 0, seed: s + 21 + i });
        for (const [k, d] of [-0.09, 0.09].entries()) {
          const [tx, ty] = facingDir(f, d, -d);
          cylinder(ctx, f, x + tx, y + ty, 0.045, 1.24, 1.42, C.brass, s + 30 + i * 2 + k, { top: C.brassL });
        }
        light(ctx, ...f.p(x, y, 1.26), 1.8, C.ledGreen);
      }
      for (const [a, b] of [[[0.55, 0.55], [1.45, 0.55]], [[0.55, 1.45], [1.45, 1.45]], [[0.55, 0.55], [0.55, 1.45]], [[1.45, 0.55], [1.45, 1.45]]] as const) {
        pipeIso(ctx, f, [[a[0], a[1], 1.42], [b[0], b[1], 1.42]], 2.4, C.brass, s + 40 + a[0] + b[1], false);
      }
      const rr = f.rect(0.05, 0.05, 1.95, 1.95);
      faceLeds(ctx, f, rr, 'L', SZ * 0.5, 0.15, 0.6, 5, [C.ledGreen, C.ledGreen, C.ledGreen, C.led, C.ledWarm]);
    },
  },
  fumarole_tap: {
    head: 4.3,
    draw(ctx, f, s) {
      // A geothermal tap: a wellhead valve tree over the vent, steam pipes to a turbine house and
      // to a hyperbolic cooling tower that breathes steam.
      slab(ctx, f, C.steelD, 0.04, SZ, s, true);
      const sc = new Scene();
      sc.add(f.depth(0.68, 0.68), () => {
        const rr = box(ctx, f, 0.2, 0.22, 1.15, 1.12, SZ, 1.0, C.teal, s + 1);
        faceGrille(ctx, f, rr, 'L', 0.1, 0.55, SZ + 0.1, 0.88, s + 2);
        faceLeds(ctx, f, rr, 'L', 0.82, 0.65, 0.92, 3, LEDS);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.1, 0.85, s + 3, 3);
        drumIso(ctx, f, 0.68, 0.67, 1.22, 0.2, 0.36, 'y', C.steelL, s + 4, { bands: [-0.4, 0.4] });
      });
      sc.add(f.depth(2.02, 1.0), () => {
        latheIso(ctx, f, 2.02, 1.0, [[SZ, 0.84], [0.9, 0.7], [1.6, 0.56], [2.3, 0.54], [2.9, 0.6], [2.98, 0.62]], TOWER, s + 5, { open: C.ink });
        for (const [i, [dx, dz, r]] of ([[0, 3.25, 11], [-0.18, 3.6, 13], [0.15, 3.85, 10]] as const).entries()) {
          const [px, py] = f.p(2.02 + dx, 1.0 - dx, dz);
          puff(ctx, px, py, r, s + 6 + i);
        }
      });
      sc.add(f.depth(0.95, 2.05), () => {
        cylinder(ctx, f, 0.95, 2.05, 0.62, SZ, 0.5, C.mesa, s + 7, { top: mix(C.mesa, C.ink, 0.25) });
        cylinder(ctx, f, 0.95, 2.05, 0.24, 0.5, 0.75, C.steel, s + 8, { top: C.steelL, rings: 1 });
        pipeIso(ctx, f, [[0.95, 2.05, 0.75], [0.95, 2.05, 1.75]], 7, C.steelL, s + 9, false);
        for (const z of [1.05, 1.45]) {
          drumIso(ctx, f, 0.95, 2.05, z, 0.07, 0.22, 'x', C.coral, s + 10 + z * 10, { shadow: false, hub: false });
          const w = f.p(0.95, 2.05, z + 0.12);
          ink(ctx, ellipsePts(w[0] - 9, w[1] - 1, 6, 4, s + 12 + z * 10, 0, 16), { closed: true, w: 1.8, color: C.brassL, shade: false, seed: s + 13 });
        }
        box(ctx, f, 0.85, 1.95, 1.05, 2.15, 1.75, 1.88, { top: C.coral }, s + 14, { outline: 1.2, shadow: false });
      });
      sc.add(f.depth(1.5, 1.5) + 0.3, () => {
        pipeIso(ctx, f, [[0.95, 2.05, 1.3], [0.95, 1.2, 1.3], [0.85, 1.05, 1.1]], 5, C.steelL, s + 20);
        pipeIso(ctx, f, [[1.05, 2.05, 1.6], [1.7, 1.6, 1.6], [1.7, 1.25, 1.2]], 5, C.steelL, s + 21);
      });
      sc.run();
    },
  },
  sunheart: {
    head: 6.2,
    draw(ctx, f, s) {
      // A star in a cage: on a ringed foundation, an armillary of coil rings holds a burning core;
      // four capacitor towers feed it through brass conduits.
      slab(ctx, f, C.steelDD, 0.04, SZ, s, true);
      const sc = new Scene();
      for (const [i, [x, y]] of ([[0.7, 0.7], [4.3, 0.7], [0.7, 4.3], [4.3, 4.3]] as const).entries()) {
        sc.add(f.depth(x, y), () => {
          const rr = box(ctx, f, x - 0.35, y - 0.35, x + 0.35, y + 0.35, SZ, 3.2, C.steel, s + 20 + i);
          fins(ctx, f, rr, 'L', 0.6, 2.4, 6, s + 24 + i);
          faceLeds(ctx, f, rr, 'L', 2.75, 0.2, 0.8, 3, [C.led]);
          faceLeds(ctx, f, rr, 'R', 2.75, 0.2, 0.8, 3, [C.ledWarm]);
          pipeIso(ctx, f, [[x, y, 2.9], [x + (2.5 - x) * 0.42, y + (2.5 - y) * 0.42, 3.4]], 7, C.brass, s + 30 + i);
        });
      }
      sc.add(f.depth(2.5, 2.5), () => {
        cylinder(ctx, f, 2.5, 2.5, 1.9, SZ, 1.0, C.steelD, s + 1, { top: C.steel, rings: 1 });
        for (const [i, a] of [0.4, 2.5, 4.6].entries()) {
          const x = 2.5 + Math.cos(a) * 1.3, y = 2.5 + Math.sin(a) * 1.3;
          if (f.depth(x, y) > f.depth(2.5, 2.5)) continue;
          pipeIso(ctx, f, [[x, y, 1.0], [2.5 + Math.cos(a) * 1.55, 2.5 + Math.sin(a) * 1.55, 3.4]], 5, C.steelL, s + 40 + i, false);
        }
        armillary(ctx, f, 2.5, 2.5, 3.5, s + 2, false);
        sphereIso(ctx, f, 2.5, 2.5, 3.5, 0.95, C.warn, s + 3, C.coral);
        light(ctx, ...f.p(2.5, 2.5, 3.9), 7, C.ledWarm);
        armillary(ctx, f, 2.5, 2.5, 3.5, s + 2, true);
        for (const [i, a] of [0.4, 2.5, 4.6].entries()) {
          const x = 2.5 + Math.cos(a) * 1.3, y = 2.5 + Math.sin(a) * 1.3;
          if (f.depth(x, y) <= f.depth(2.5, 2.5)) continue;
          pipeIso(ctx, f, [[x, y, 1.0], [2.5 + Math.cos(a) * 1.55, 2.5 + Math.sin(a) * 1.55, 3.4]], 5, C.steelL, s + 40 + i, false);
        }
      });
      sc.run();
    },
  },

  // ── commerce ──────────────────────────────────────────────────────────────
  trade_post: {
    head: 1.6,
    draw(ctx, f, s) {
      // CrierBelt's cargo lift pad, a plain platform (owner, 2026-10-13: "a simple platform (keep
      // the animation of the cargo etc). The random blocs all around and the planet icons are not
      // needed") on the middle 3 × 3 of a 5 × 5 footprint: a slab with a hazard edge, the raised
      // round deck the Crier's drone sets down on — its hazard ring, landing lights and the lift's
      // shut iris (cargo-view opens it) —, a lamp post on three corners and a power pedestal on
      // the fourth (its wire terminal on top). Round it, the scorched apron its drones' flames keep
      // clear (owner, 2026-10-14: "should block any construction in a 1 case radius around it
      // because of the flames of the drones", D62), crossed by its two built-in flame-proof
      // ribbons: the entrance, ramping up into the pad, and the exit, ramping down out of it.
      // The apron and the ribbons lie on the ground: they cast no shadow (a ShadowFrame skips
      // them — a cast shadow stretched with the day would drag a 5 × 5 decal across the sand).
      const ground = !(f instanceof ShadowFrame);
      // The ribbon behind the pad goes before it, the one in front after everything on it.
      const near = (io: 'in' | 'out'): boolean => f.depth(2.5, TP_RIBBON[io].outer) > f.depth(2.5, 2.5);
      if (ground) {
        tpApron(ctx, f, s + 100);
        for (const io of ['in', 'out'] as const) if (!near(io)) tpRibbon(ctx, f, io, s + (io === 'in' ? 140 : 160));
      }
      const [X0, Y0, X1] = TP_PAD;
      slab(ctx, f, C.steel, 0.04, SZ, s, false, TP_PAD);
      // The hazard band along the pad's far edge, broken where the exit's hood stands.
      for (const [a, b] of [[X0 + 0.2, 2.06], [2.94, X1 - 0.2]] as const) {
        const band: Pt[] = [f.p(a, Y0 + 0.12, SZ), f.p(b, Y0 + 0.12, SZ), f.p(b, Y0 + 0.3, SZ), f.p(a, Y0 + 0.3, SZ)];
        flat(ctx, band, C.hazard);
        ctx.save(); pathOf(ctx, band); ctx.clip();
        hatch(ctx, band, Math.PI / 4, 9, { w: 4, alpha: 0.85, seed: s + a * 10 });
        ctx.restore();
        ink(ctx, band, { closed: true, w: 1, shade: false, seed: s + 3 + a * 10 });
      }
      const sc = new Scene();
      for (const [i, [x, y]] of TP_LAMPS.entries()) sc.add(f.depth(x, y), () => tpLamp(ctx, f, x, y, s + 20 + i * 3));
      sc.add(f.depth(TP_PED[0] + 0.2, TP_PED[1] + 0.2), () => {
        const [x, y] = TP_PED;
        const rr = box(ctx, f, x, y, x + 0.4, y + 0.4, SZ, TP_PED[2], { top: C.steelD, left: C.teal, right: mix(C.teal, C.ink, 0.35) }, s + 30, { outline: 1.5 });
        faceGrille(ctx, f, rr, 'R', 0.2, 0.8, SZ + 0.06, TP_PED[2] - 0.08, s + 31, 2);
        faceLeds(ctx, f, rr, 'L', TP_PED[2] - 0.1, 0.3, 0.7, 2, [C.ledGreen, C.led]);
      });
      const [dx, dy] = TP_DECK;
      sc.add(f.depth(dx, dy), () => {
        cylinder(ctx, f, dx, dy, TP_DECK_R, SZ, DECK_Z, C.steelD, s + 5, { top: C.steel });
        const c = f.p(dx, dy, DECK_Z);
        const [ex, ey] = f.ell(0.78);
        ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 6, 0, 48), { closed: true, w: 3, color: C.hazard, shade: false, seed: s + 6 });
        tpIris(ctx, f, dx, dy, DECK_Z, 0.62, s + 7);
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; light(ctx, c[0] + Math.cos(a) * ex * 1.13, c[1] + Math.sin(a) * ey * 1.13, 2, i % 2 ? C.led : C.ledWarm); }
      });
      for (const io of ['in', 'out'] as const) {
        const [h0, h1] = TP_RIBBON[io].hood;
        sc.add(f.depth(2.5, (h0 + h1) / 2), () => tpHood(ctx, f, io, s + (io === 'in' ? 50 : 60)));
      }
      sc.run();
      if (ground) for (const io of ['in', 'out'] as const) if (near(io)) tpRibbon(ctx, f, io, s + (io === 'in' ? 140 : 160));
    },
  },
};

// ── the trade post (D62): pad, scorched apron, flame-proof ribbons ─────────────

/** The trade post's pad: the middle 3 × 3 of its 5 × 5 footprint (local rect); the ring round it is its scorched apron. */
export const TP_PAD = [1, 1, 4, 4] as const;
/** The landing deck: its centre — the pad's, the footprint's — and radius (world/cargo-flight.ts mirrors them). */
export const TP_DECK = [2.5, 2.5] as const;
export const TP_DECK_R = 0.98;
/** The trade post's corner lamp posts (local tiles) and its power pedestal (corner, top height): on the pad. */
export const TP_LAMPS: ReadonlyArray<readonly [number, number]> = [[1.24, 1.24], [1.24, 3.76], [3.76, 3.76]];
export const TP_PED = [3.38, 1.22, 0.66] as const;

/**
 * The two built-in flame-proof ribbons, at rotation 0 (the content's ports: the entrance on the
 * south edge's middle tile, the exit on the north's): the edge the player's ribbon meets
 * (`outer`), the pad's edge (`pad`), the hood on the pad where it dives in or comes out (`hood`,
 * y from–to). Both carry items north: the entrance in, the exit out.
 */
export const TP_RIBBON = {
  in: { outer: 5, pad: 4, hood: [3.64, 3.96] },
  out: { outer: 0, pad: 1, hood: [1.04, 1.36] },
} as const;
/** The ribbons' band (x from–to: a ribbon's width) and their heat-shield walls' outer edges (x). */
export const TP_BAND = [2.22, 2.78] as const;
export const TP_WALL = [2.12, 2.88] as const;
/** Heat tint along the ribbons' walls, from the cool end to the hot one: straw, bronze, purple, blue (tempered steel). */
export const TP_TEMPER = [C.brassL, C.brass, C.violetL, C.steelL] as const;

/** Where the drones' flames left their marks on the apron (local tiles, the same in every view and rotation). */
export interface ApronMarks {
  /** Blast streaks out from the pad: angle (rad, local), from / to (tiles from the pad's centre), width (tiles). */
  streaks: ReadonlyArray<{ a: number; r0: number; r1: number; w: number }>;
  /** Cracks in the baked ground: polylines. */
  cracks: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Sand fused to glass by the heat, near the pad: centre, radii, turn. */
  glass: ReadonlyArray<{ x: number; y: number; rx: number; ry: number; rot: number }>;
  /** Embers still glowing. */
  embers: ReadonlyArray<readonly [number, number]>;
  /** The burn's blotches round the pad's centre, outermost first: radius (tiles) per angle step (a ragged ring) and its tone. */
  burns: ReadonlyArray<{ r: readonly number[]; tone: 'baked' | 'burnt' | 'soot'; alpha: number }>;
}

/** Is a local point on the apron, clear of the pad and of the ribbons (with a margin `m`)? */
const onApron = (x: number, y: number, m = 0.08): boolean =>
  x > m && y > m && x < 5 - m && y < 5 - m
  && !(x > 1 - m && x < 4 + m && y > 1 - m && y < 4 + m)
  && !(x > TP_WALL[0] - m && x < TP_WALL[1] + m && (y < 1 + m || y > 4 - m));

let apronMemo: ApronMarks | null = null;
/** The apron's marks, drawn once from a fixed seed (pure: the iso and plan art share them). */
export function apronMarks(): ApronMarks {
  if (apronMemo) return apronMemo;
  const rng = makeRng(6211);
  const [cx, cy] = TP_DECK;
  const streaks: Array<{ a: number; r0: number; r1: number; w: number }> = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rng.range(-0.08, 0.08);
    // Not under the ribbons (they cross the apron north and south of the pad).
    if (Math.abs(Math.sin(a)) > 0.93) continue;
    const edge = 2.5 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    streaks.push({ a, r0: 1.45, r1: edge * rng.range(0.78, 0.96), w: rng.range(0.07, 0.16) });
  }
  // Cracks: jagged walks running round the pad more than away from it (the ground shrank as it
  // baked), each with a short branch.
  const cracks: Array<Array<readonly [number, number]>> = [];
  const walk = (x: number, y: number, a: number, n: number): Array<readonly [number, number]> => {
    const line: Array<readonly [number, number]> = [[x, y]];
    for (let j = 0; j < n; j++) {
      a += rng.range(-0.6, 0.6);
      const l = rng.range(0.12, 0.24), nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
      if (!onApron(nx, ny, 0.1)) break;
      x = nx; y = ny;
      line.push([x, y]);
    }
    return line;
  };
  for (let k = 0; k < 60 && cracks.length < 18; k++) {
    const x = rng.range(0.2, 4.8), y = rng.range(0.2, 4.8);
    if (!onApron(x, y, 0.15)) continue;
    const a = Math.atan2(y - cy, x - cx) + (rng.chance(0.6) ? Math.PI / 2 : 0) + rng.range(-0.5, 0.5);
    const line = walk(x, y, a, rng.int(4, 8));
    if (line.length < 3) continue;
    cracks.push(line);
    const at = line[rng.int(1, line.length - 2)]!;
    const twig = walk(at[0], at[1], a + (rng.chance(0.5) ? 1 : -1) * rng.range(0.8, 1.3), rng.int(2, 3));
    if (twig.length > 1) cracks.push(twig);
  }
  const glass: Array<{ x: number; y: number; rx: number; ry: number; rot: number }> = [];
  for (let k = 0; k < 30 && glass.length < 4; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(1.62, 1.95);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (onApron(x, y, 0.22)) glass.push({ x, y, rx: rng.range(0.1, 0.17), ry: rng.range(0.05, 0.09), rot: rng.range(0, Math.PI) });
  }
  const embers: Array<readonly [number, number]> = [];
  for (let k = 0; k < 40 && embers.length < 6; k++) {
    const x = rng.range(0.25, 4.75), y = rng.range(0.25, 4.75);
    if (onApron(x, y, 0.15)) embers.push([x, y]);
  }
  // Ragged burns: each a ring of radii with a few random harmonics, so the scorch is a blotch, not a target.
  const burns: Array<{ r: number[]; tone: 'baked' | 'burnt' | 'soot'; alpha: number }> = [];
  for (const [r0, amp, tone, alpha] of [[2.85, 0.16, 'burnt', 0.45], [2.45, 0.14, 'burnt', 0.55], [2.1, 0.12, 'soot', 0.4], [1.82, 0.08, 'soot', 0.6]] as const) {
    const h = [1, 2, 3, 5].map((k) => ({ k, a: rng.range(0.3, 1) * amp / k ** 0.6, p: rng.range(0, Math.PI * 2) }));
    burns.push({ tone, alpha, r: Array.from({ length: 64 }, (_, i) => {
      const t = (i / 64) * Math.PI * 2;
      return r0 * (1 + h.reduce((v, q) => v + q.a * Math.sin(q.k * t + q.p), 0) + rng.range(-0.025, 0.025));
    }) });
  }
  apronMemo = { streaks, cracks, glass, embers, burns };
  return apronMemo;
}

/** The scorch's colours: baked ground at the edge, burnt nearer the pad, soot against it. */
export const SCORCH = { baked: mix(C.hardpan, C.mesa, 0.3), burnt: mix(C.coralD, C.inkSoft, 0.62), soot: mix(C.inkSoft, C.ink, 0.35) } as const;

/** A burn's ragged ring (radii per angle step round the pad's centre) as local points. */
export function burnPts(r: readonly number[]): Array<[number, number]> {
  const [cx, cy] = TP_DECK;
  return r.map((v, i) => { const t = (i / r.length) * Math.PI * 2; return [cx + Math.cos(t) * v, cy + Math.sin(t) * v]; });
}

/**
 * The scorched apron, on the ground of the whole footprint: baked earth at its edge, burnt and
 * sooty towards the pad (rings of soot: the flames reach round, the corners stay paler), blast
 * streaks out from the pad, cracks, sand fused to glass by the heat, a few embers still glowing,
 * and the keep-out line CrierBelt paints round it, half burnt off.
 */
function tpApron(ctx: Ctx, f: IsoFrame, s: number): void {
  const m = apronMarks();
  const [cx, cy] = TP_DECK;
  const g = (x: number, y: number): Pt => f.p(x, y, 0);
  const foot: Pt[] = [g(0.03, 0.03), g(4.97, 0.03), g(4.97, 4.97), g(0.03, 4.97)];
  flat(ctx, foot, SCORCH.baked);
  ctx.save(); pathOf(ctx, foot); ctx.clip();
  for (const b of m.burns) flat(ctx, burnPts(b.r).map(([x, y]) => g(x, y)), SCORCH[b.tone], b.alpha);
  // Blast streaks: tapered soot strokes fanning out from the pad.
  for (const [i, k] of m.streaks.entries()) {
    const p0 = g(cx + Math.cos(k.a) * k.r0, cy + Math.sin(k.a) * k.r0), p1 = g(cx + Math.cos(k.a) * k.r1, cy + Math.sin(k.a) * k.r1);
    ink(ctx, [p0, p1], { w: k.w * IS, color: C.ink, alpha: 0.22, shade: false, taper: 0.5, jitter: 0.6, seed: s + 10 + i });
  }
  const xs = foot.map(([x]) => x), ys = foot.map(([, y]) => y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  stipple(ctx, x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0, 260, { r: 1.1, color: C.ink, alpha: 0.28, seed: s + 40, clip: foot });
  ctx.restore();
  // Soot hugging the pad's base.
  const [px0, py0, px1, py1] = TP_PAD;
  flat(ctx, [g(px0 - 0.16, py0 - 0.16), g(px1 + 0.16, py0 - 0.16), g(px1 + 0.16, py1 + 0.16), g(px0 - 0.16, py1 + 0.16)], C.ink, 0.22);
  // Cracks: an ink line with a pale lip on its lit side, so the baked crust reads as split.
  for (const [i, c] of m.cracks.entries()) {
    const pts = c.map(([x, y]) => g(x, y));
    ink(ctx, pts.map(([x, y]) => [x - 0.8, y - 1] as Pt), { w: 1.2, color: SCORCH.baked, alpha: 0.7, shade: false, taper: 0.4, jitter: 0.3, seed: s + 60 + i });
    ink(ctx, pts, { w: 1.7, color: C.ink, alpha: 0.75, shade: false, taper: 0.4, jitter: 0.3, seed: s + 60 + i });
  }
  for (const [i, q] of m.glass.entries()) {
    const pts = ellipsePts(0, 0, q.rx, q.ry, s + 80 + i, 0.15, 20, q.rot).map(([x, y]) => g(q.x + x, q.y + y));
    flat(ctx, pts, C.lilacL, 0.55);
    ink(ctx, pts.slice(2, 8), { w: 1.2, color: '#ffffff', alpha: 0.6, shade: false, taper: 0.3, seed: s + 85 + i });
  }
  // The keep-out line: hazard dashes inset round the edge, some burnt away.
  const rng = makeRng(s + 90);
  const L = 0.16, H = 5 - L;
  const sides: ReadonlyArray<readonly [number, number, number, number]> = [[L, L, H, L], [H, L, H, H], [H, H, L, H], [L, H, L, L]];
  for (const [ax, ay, bx, by] of sides) {
    for (let t = 0.04; t < 0.96; t += 0.09) {
      if (rng.chance(0.3)) continue;
      const u0 = t, u1 = t + 0.05;
      const a = g(ax + (bx - ax) * u0, ay + (by - ay) * u0), b = g(ax + (bx - ax) * u1, ay + (by - ay) * u1);
      ink(ctx, [a, b], { w: 2.4, color: C.hazard, alpha: rng.range(0.45, 0.85), shade: false, taper: 0, jitter: 0.2, seed: s + 91 });
    }
  }
  ink(ctx, foot, { closed: true, w: 1, alpha: 0.35, shade: false, seed: s + 95 });
  // Embers: coral coals with a pale core. Not in an LED token: the night would light them as a
  // cold machine's work lamp (fx.ts: amber only glows amber on hot machines), so they stay paint.
  for (const [i, [x, y]] of m.embers.entries()) {
    const [ex, ey] = g(x, y);
    flat(ctx, ellipsePts(ex, ey, 5, 3, s + 100 + i, 0.1, 12), C.coral, 0.25);
    flat(ctx, ellipsePts(ex, ey, 2.8, 1.8, s + 105 + i, 0.1, 10), C.coral, 0.8);
    flat(ctx, ellipsePts(ex, ey, 1.3, 0.9, s + 110 + i, 0, 8), C.peachL);
  }
}

/**
 * A built-in flame-proof ribbon across the apron (`io`: the entrance or the exit): a heat-shielded
 * chute in dark steel ramping from the ground at the apron's edge up to the pad, its band laid
 * with ceramic heat-shield plates, two low shield walls tempered by the flames (straw at the cool
 * end, blue at the pad) and riveted, chevrons in the port's colour pointing the way the items go
 * — into the pad for the entrance, out of it for the exit.
 */
function tpRibbon(ctx: Ctx, f: IsoFrame, io: 'in' | 'out', s: number): void {
  const { outer, pad } = TP_RIBBON[io];
  const Z0 = 0.06, WALL = 0.13;
  const yAt = (t: number): number => outer + (pad - outer) * t;
  const zAt = (t: number): number => Z0 + (SZ - Z0) * t;
  const [b0, b1] = TP_BAND, [w0, w1] = TP_WALL;
  const body = (x0: number, x1: number, dz: number, col: Faces, seed: number): void => {
    prismIso(ctx, f, [[x0, outer], [x1, outer], [x1, pad], [x0, pad]], 0, [zAt(0) + dz, zAt(0) + dz, zAt(1) + dz, zAt(1) + dz], col, seed, { outline: 1.4, shadow: false });
  };
  const wall: Faces = { top: C.steelD, left: mix(C.steelD, C.ink, 0.25), right: mix(C.steelD, C.ink, 0.45) };
  // The far wall, the chute and its band, the near wall.
  const walls = ([[w0, b0], [b1, w1]] as const).slice().sort((a, b) => f.depth(a[0], 2.5) - f.depth(b[0], 2.5));
  const shield = (x0: number, x1: number, k: number): void => {
    body(x0, x1, WALL, wall, s + k);
    // Tempered by the heat along its top: four tints, cool end to hot.
    const xm = (x0 + x1) / 2;
    for (let i = 0; i < 4; i++) {
      const ta = i / 4, tb = (i + 1) / 4;
      ink(ctx, [f.p(xm, yAt(ta), zAt(ta) + WALL), f.p(xm, yAt(tb), zAt(tb) + WALL)], { w: 2.2, color: TP_TEMPER[i]!, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + k + 10 + i });
    }
    for (const t of [0.18, 0.5, 0.82]) rivet(ctx, ...f.p(xm, yAt(t), zAt(t) + WALL), 1.5, C.steelL);
  };
  shield(walls[0]![0], walls[0]![1], 1);
  body(b0, b1, 0, { top: C.steelDD }, s + 30);
  // Heat-shield plates across the band: dark ceramic tiles, light seams between.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const ta = i / n + 0.012, tb = (i + 1) / n - 0.012;
    const q: Pt[] = [f.p(b0 + 0.03, yAt(ta), zAt(ta)), f.p(b1 - 0.03, yAt(ta), zAt(ta)), f.p(b1 - 0.03, yAt(tb), zAt(tb)), f.p(b0 + 0.03, yAt(tb), zAt(tb))];
    flat(ctx, q, i % 2 ? mix(C.steelDD, C.inkSoft, 0.4) : mix(C.steelDD, C.steel, 0.3));
    ink(ctx, [q[0]!, q[1]!], { w: 1, color: C.steelL, alpha: 0.55, shade: false, taper: 0, jitter: 0, seed: s + 40 + i });
  }
  // Chevrons the way the items go (north, local −y), in the port's colour.
  const col = io === 'in' ? C.cyan : C.coral;
  for (const [i, t] of [0.3, 0.68].entries()) {
    const y = yAt(t), z = zAt(t) + 0.01, k = 0.13;
    ink(ctx, [f.p(2.33, y + k, z), f.p(2.5, y - k * 0.6, z), f.p(2.67, y + k, z)], { w: 3, color: col, shade: false, taper: 0, jitter: 0.15, seed: s + 50 + i });
  }
  shield(walls[1]![0], walls[1]![1], 60);
}

/**
 * Where a flame-proof ribbon meets the pad: a low armoured hood on the pad's edge over the band's
 * end, its mouth (dark, a brass frame) turned to the ribbon when that face shows, a lamp in the
 * port's colour on its brow, heat-shield plates on its back.
 */
function tpHood(ctx: Ctx, f: IsoFrame, io: 'in' | 'out', s: number): void {
  const [h0, h1] = TP_RIBBON[io].hood;
  const z1 = SZ + 0.32;
  const rr = box(ctx, f, TP_WALL[0], h0, TP_WALL[1], h1, SZ, z1, { top: C.steelD, left: mix(C.steelD, C.ink, 0.2), right: mix(C.steelD, C.ink, 0.42) }, s, { outline: 1.5 });
  const side = io === 'in' ? 2 : 0; // the ribbon's side: south for the entrance, north for the exit
  if (facing(f, side)) {
    const face: Face = f.dir(side) === 2 ? 'L' : 'R';
    const q = faceQuad(f, rr, face, 0.13, 0.87, SZ + 0.02, z1 - 0.07);
    shape(ctx, q, C.ink, { w: 1.4, color: C.brass, shade: false, jitter: 0, seed: s + 1 });
  }
  // Plates on its roof, tempered at the pad's side.
  for (let i = 1; i < 4; i++) {
    const x = TP_WALL[0] + ((TP_WALL[1] - TP_WALL[0]) * i) / 4;
    ink(ctx, [f.p(x, h0 + 0.03, z1), f.p(x, h1 - 0.03, z1)], { w: 1, color: C.steelL, alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: s + 2 + i });
  }
  const yl = io === 'in' ? h1 - 0.08 : h0 + 0.08;
  light(ctx, ...f.p(2.5, yl, z1 + 0.02), 2.2, io === 'in' ? C.led : C.ledWarm);
}

/** A lamp post on the trade post's pad: a slim steel post, a hooded lamp. */
function tpLamp(ctx: Ctx, f: IsoFrame, x: number, y: number, s: number): void {
  cylinder(ctx, f, x, y, 0.05, SZ, 1.25, C.steelD, s, { top: C.steel });
  box(ctx, f, x - 0.09, y - 0.09, x + 0.09, y + 0.09, 1.25, 1.36, { top: C.steelD }, s + 1, { outline: 1.2, shadow: false });
  light(ctx, ...f.p(x, y, 1.22), 2.4, C.ledWarm);
}

/** The lift's iris, shut, on the deck at height z: eight steel blades turning in to a dark centre. */
function tpIris(ctx: Ctx, f: IsoFrame, cx: number, cy: number, z: number, r: number, s: number): void {
  const n = 8;
  flat(ctx, ellipsePts(...f.p(cx, cy, z), ...f.ell(r), s, 0, 48), C.steelDD);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, tw = 0.5;
    const blade: Pt[] = [
      f.p(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z),
      f.p(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z),
      f.p(cx + Math.cos(a1 + tw) * r * 0.12, cy + Math.sin(a1 + tw) * r * 0.12, z),
    ];
    flat(ctx, blade, i % 2 ? C.steel : mix(C.steel, C.steelL, 0.35));
    ink(ctx, [blade[0]!, blade[2]!], { w: 1, color: C.ink, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  ink(ctx, ellipsePts(...f.p(cx, cy, z), ...f.ell(r), s + 20, 0, 48), { closed: true, w: 1.6, shade: false, seed: s + 21 });
}

const seedOf = (id: string): number => (id.length * 131 + id.charCodeAt(0) * 17) | 0;

/**
 * A building's body with its ports — those on the far sides under it, the near ones over it —
 * and its power terminals of the generic kit (art/terminals.ts: a service mast on a roof), last,
 * so a wire always meets one in sight. Poles, the Heart and the charger draw their own.
 */
function bodyWithPorts(ctx: Ctx, f: IsoFrame, id: BuildingId, def: BuildingDef, recipe: Recipe, seed: number): void {
  // The incinerator's in-ports are its box's own ribbon mouths (as a routing block's): no nozzles on top.
  const ports = (def.kind === 'sink' ? [] : def.ports).map((p) => ({ p, d: f.dir(sideIndex[p.side]) }));
  for (const { p, d } of ports) if (d === 0 || d === 3) portIso(ctx, f, p.x, p.y, sideIndex[p.side], p.io, SZ, seed + p.x * 5 + p.y);
  if (recipe.moving) recipe.moving.body(ctx, f, seed);
  else recipe.draw?.(ctx, f, seed);
  for (const { p, d } of ports) if (d === 1 || d === 2) portIso(ctx, f, p.x, p.y, sideIndex[p.side], p.io, SZ, seed + p.x * 5 + p.y);
  for (const [i, t] of terminalsOf(id).entries()) if (kitDrawn(t)) terminalIso(ctx, f, t, seed + 900 + i * 7, KIT_K);
}

/**
 * Draw a building sprite (body + ports) for one rotation into a fresh canvas. A building with a
 * moving part gets it at phase 0, under or over the body exactly as the world stacks the two
 * sprites (`drawBuildingMoving`).
 */
export function drawBuilding(id: BuildingId, rot: Rot, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const def = BUILDINGS[id] as BuildingDef;
  const recipe = R[id] ?? fallback;
  const f = new IsoFrame(def.w, def.h, rot, recipe.head);
  const { ctx, canvas } = make(f.W, f.H);
  const seed = seedOf(id);
  const m = recipe.moving, over = !!m && m.over(f);
  if (m && !over) m.part(ctx, f, seed, 0);
  bodyWithPorts(ctx, f, id, def, recipe, seed);
  if (m && over) m.part(ctx, f, seed, 0);
  return { canvas, frame: f };
}

/**
 * A building with a moving part, drawn apart for the world (moving.ts): its body (with its
 * ports) and its part at `frames` phases of one period, each in a canvas the size of the whole
 * sprite (same anchor); `over`: the part is drawn over the body in this rotation. Null for a
 * building without one.
 */
export function drawBuildingMoving(id: BuildingId, rot: Rot, frames: number, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { body: unknown; parts: unknown[]; over: boolean; frame: IsoFrame } | null {
  const recipe = R[id], m = recipe?.moving;
  if (!recipe || !m) return null;
  const def = BUILDINGS[id] as BuildingDef;
  const f = new IsoFrame(def.w, def.h, rot, recipe.head);
  const seed = seedOf(id);
  const b = make(f.W, f.H);
  bodyWithPorts(b.ctx, f, id, def, recipe, seed);
  const parts = Array.from({ length: frames }, (_, k) => {
    const p = make(f.W, f.H);
    m.part(p.ctx, f, seed, k / frames);
    return p.canvas;
  });
  return { body: b.canvas, parts, over: m.over(f), frame: f };
}

/**
 * The frame of a building's cast shadow (iso-shapes.ts `ShadowFrame`): every point laid on the
 * ground `(dx, dy)` tiles per level along the light, in screen-fixed tile terms. Its `SW` × `SH`
 * is the canvas the shadow needs; `ox`, `oy` the anchor (the footprint's ground corner, as in
 * the sprite).
 */
export function shadowFrameOf(id: BuildingId, rot: Rot, dx: number, dy: number): ShadowFrame {
  const def = BUILDINGS[id] as BuildingDef;
  return new ShadowFrame(def.w, def.h, rot, (R[id] ?? fallback).head, dx, dy);
}

/**
 * A building's cast shadow: its own recipe (body, ports, a moving part at phase 0) drawn through
 * its `shadowFrameOf` into `ctx` — a silhouette context (art/silhouette.ts) paints it in one
 * colour: the shadow's mask.
 */
export function drawBuildingShadow(id: BuildingId, rot: Rot, dx: number, dy: number, ctx: Ctx): void {
  const def = BUILDINGS[id] as BuildingDef;
  const recipe = R[id] ?? fallback;
  const f = shadowFrameOf(id, rot, dx, dy);
  const seed = seedOf(id);
  bodyWithPorts(ctx, f, id, def, recipe, seed);
  const m = recipe.moving;
  if (m?.shadow) m.shadow(ctx, f, seed);
  else m?.part(ctx, f, seed, 0);
}

const fallback: Recipe = {
  head: 1.9,
  draw(ctx, f, s) {
    // No recipe yet: a riveted crate-like machine — steel housing, a bolted hatch, an intake
    // grille, a hazard stripe and LEDs, a roof hatch with its lamp. Never a dome.
    slab(ctx, f, C.steel, 0.06, SZ, s);
    const rr = box(ctx, f, 0.2, 0.2, f.w - 0.2, f.h - 0.2, SZ, 1.3, C.steelL, s + 1);
    facePanel(ctx, f, rr, 'L', 0.12, 0.42, SZ + 0.1, 1.05, C.steel, s + 2);
    faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.15, 0.95, s + 3);
    faceLeds(ctx, f, rr, 'L', 1.12, 0.58, 0.9, 3, LEDS);
    faceHazard(ctx, f, rr, 'L', 0.55, 0.93, SZ + 0.06, SZ + 0.2, s + 4);
    box(ctx, f, f.w / 2 - 0.22, f.h / 2 - 0.22, f.w / 2 + 0.22, f.h / 2 + 0.22, 1.3, 1.48, { top: C.steelD }, s + 5, { outline: 1.4, shadow: false });
    light(ctx, ...f.p(f.w / 2, f.h / 2, 1.56), 2.4, C.led);
  },
};

/** Height (levels) of a building's iso sprite above the ground — for picking in the iso view. */
export function isoHead(id: BuildingId): number {
  return (R[id] ?? fallback).head;
}

/** Which buildings change look when rotated (others reuse rot 0): the rule their terminals follow too (art/terminals.ts `turnsArt`). */
export const needsRotations = (id: BuildingId): boolean => turnsArt(id);
