// buildings.ts — one drawing recipe per building, in 2:1 isometric volume, in the Moebius ink
// idiom pushed to contrasted mechanical sci-fi. The base is fully automated — built by drones,
// piloted from Verrière, nobody lives there (docs/lore.md) — so every building is a machine and
// says what it does: rigs and derricks, hoppers and incline belts, banded tanks, brick furnaces
// with stacks, presses, sawtooth halls and gantries, spools, transformers, capacitor cans, a
// cooling tower… — riveted steel, teal/violet housings, coral/brass hot parts, hazard stripes,
// LEDs. Nothing shows people (no lit windows, doors, walkways, planters, houses): the base's own
// buildings show machine things — the Heart's fortified depot under its solar rows and uplink
// dish, drone pads and the drones on them, status beacons, sensor and relay masts, the trade
// post's landing pad in its scorched apron; research is labs in white enamel banded in violet,
// phased-array antennas and racks of servers dense with indicator dots (no domes left: the
// observatory became the research lab). Upgrades (the second tier) keep their base machine's
// look, bigger or doubled, with a coral band or a heavier frame.
// Routing blocks share one body: a box whose four sides open on ribbon mouths exactly as wide as
// the ribbon's band, the lid saying what the block does. Recipes draw in the building's own
// (unrotated) tile frame; the IsoFrame rotates the footprint so light and shading always fall the
// same way, and a Scene queue draws parts far to near (big neighbours are ordered by which one
// the rotation brings nearer). Ports come from the content (back ones first, front ones last).
import { fenceIso } from './gleaners';
import { BAL } from '@/content/balance';
import { BUILDINGS, type BuildingId } from '@/content/buildings';
import type { BuildingDef, PortDef } from '@/content/types';
import { makeRng } from '@/core/rng';
import { sideIndex, type Rot } from '@/sim/types';
import { C, mix } from '../tokens';
import { castShadow, ellipsePts, flat, hatch, ink, pathOf, shape, stipple, type Ctx, type Pt } from '../ink';
import { arrowPoly, cable, crierMarkMapped, hull, light, rivet } from '../shapes';
import { pvPanel } from '../solar';
import { UNLIT, isUnlit } from '../unlit';
import {
  ILH, IS, IsoFrame, Scene, ShadowFrame, box, bucketWheelIso, cableIso, chevronIso, cupIso, cylinder,
  drumIso, faceGlow, faceGrille, faceHazard, faceInk, faceLeds, facePanel, facePt, faceQuad, frustumIso,
  latheIso, pipeIso, portIso, prismIso, slab, sphereIso, spireIso, terminalIso, trussIso, vaultIso, wheelIso, type Face, type Faces, type RRect,
} from '../iso-shapes';
import { CHARGER_BUSHING, HEART_MASTS, INSULATOR, KIT_K, POLE, PYLON, kitDrawn, onArm, terminalProbe, terminalsOf, turnsArt } from '../terminals';
import { BIG_ROTOR, BORE, CUTTER, PITCH_ROTOR, SAND_WHEEL, TURBINE, boreLeg, boreSquare, bucketFull, vaneAt, type HRotor } from './moving';
import { QZ, crystal } from '../rock';

/** Top of the foundation slab (levels). */
const SZ = 0.3;
const LEDS = [C.led, C.led, C.ledGreen, C.led] as const;

interface Recipe {
  /** Headroom above the ground (levels) for the tallest part. */
  head: number;
  /** The whole drawing (a building without a moving part); `lv`: its look's level (`artLevels`: the Heart's, D86; 1 for any other). */
  draw?(ctx: Ctx, f: IsoFrame, s: number, lv: number): void;
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

/** A crawler track along local y, centred on x (`hw` tiles either side, up to `z1`): treads across the top, road wheels on its sides. */
function crawler(ctx: Ctx, f: IsoFrame, x: number, y0: number, y1: number, s: number, hw = 0.27, z1 = 0.78): void {
  const rr = box(ctx, f, x - hw, y0, x + hw, y1, SZ, z1, { top: C.steelDD, left: mix(C.steelD, C.ink, 0.05), right: mix(C.steelD, C.ink, 0.35) }, s, { outline: 1.8 });
  for (let i = 1; i < 12; i++) {
    const y = y0 + ((y1 - y0) * i) / 12;
    ink(ctx, [f.p(x - hw + 0.02, y, z1), f.p(x + hw - 0.02, y, z1)], { w: 1.4, color: C.steel, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  const wr = Math.min(5.5, (z1 - SZ) * 11.5);
  for (const face of ['L', 'R'] as const) {
    const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
    const n = Math.max(1, Math.round(len / 0.36));
    for (let i = 0; i < n; i++) {
      const [px, py] = facePt(f, rr, face, (i + 0.5) / n, (SZ + z1) / 2);
      shape(ctx, ellipsePts(px, py, wr, wr, s + 20 + i, 0, 16), C.steel, { w: 1.3, shade: false, jitter: 0, seed: s + 20 + i });
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
/** Status beacons on the roof's corners (rotated coords, colour), the nearest first: each level lights one more (D86, `heartLook`); the far one stands behind the dish. */
export const HEART_BEACONS: ReadonlyArray<readonly [number, number, string]> = [
  [3.76, 3.76, C.ledGreen], [3.73, 1.27, C.ledWarm], [1.24, 3.78, C.ledGreen],
];

/**
 * The Heart's depot, fortified: battered walls of riveted armour plate on a dark foot, louvred
 * vents under the roof's edge, a drone hatch on the roof, and a curtained mouth wherever a ribbon
 * comes in — strip curtains under a hazard-striped lintel, as wide as the port it faces.
 * `mouths`: local points on the depot's base edge.
 */
function depotIso(ctx: Ctx, f: IsoFrame, mouths: ReadonlyArray<readonly [number, number]>, s: number, look = heartLook(1)): void {
  const { x0, y0, x1, y1, z, inset } = DEP;
  frustumIso(ctx, f, x0, y0, x1, y1, SZ, z, inset, { top: C.steelD, left: WALL, right: mix(WALL, C.ink, 0.4) }, s);
  const faceAt = (face: Face) => (u: number, t: number): Pt => frustumPt(f, x0, y0, x1, y1, SZ, z, inset, face, u, t);
  for (const face of ['L', 'R'] as const) {
    const A = faceAt(face);
    // Its foot: a dark course, hazard-striped from level 4 (D86).
    if (look.skirt) hazardQuad(ctx, [A(0, 0), A(1, 0), A(1, 0.14), A(0, 0.14)], s + (face === 'L' ? 3 : 7));
    else flat(ctx, [A(0, 0), A(1, 0), A(1, 0.09), A(0, 0.09)], C.steelDD);
    for (let i = 1; i < 6; i++) ink(ctx, [A(i / 6, 0.09), A(i / 6, 0.98)], { w: 1.1, color: C.ink, alpha: 0.32, shade: false, taper: 0, jitter: 0, seed: s + 10 + i });
    ink(ctx, [A(0.005, 0.62), A(0.995, 0.62)], { w: 3.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 20 });
    for (let i = 0; i < 12; i++) rivet(ctx, ...A((i + 0.5) / 12, 0.62), 1.5, C.steelL);
    for (let i = 0; i < 6; i++) {
      const um = (i + 0.5) / 6;
      flat(ctx, [A(um - 0.05, 0.74), A(um + 0.05, 0.74), A(um + 0.05, 0.9), A(um - 0.05, 0.9)], C.steelDD);
      for (const t of [0.79, 0.85]) ink(ctx, [A(um - 0.045, t), A(um + 0.045, t)], { w: 0.9, color: C.steelL, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 30 + i });
    }
    // The level's trims (D86): a coral cornice under the roof's edge, brass pilasters at the corners.
    if (look.cornice) {
      shape(ctx, [A(0, 0.92), A(1, 0.92), A(1, 1), A(0, 1)], C.coral, { w: 1, shade: false, jitter: 0, seed: s + 90 });
      ink(ctx, [A(0.01, 0.95), A(0.99, 0.95)], { w: 1, color: C.coralL, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 91 });
    }
    if (look.pilasters) {
      for (const [k, [u0, u1]] of ([[0, 0.04], [0.96, 1]] as const).entries()) {
        shape(ctx, [A(u0, 0.09), A(u1, 0.09), A(u1, look.cornice ? 0.92 : 1), A(u0, look.cornice ? 0.92 : 1)], C.brass, { w: 1, shade: false, jitter: 0, seed: s + 92 + k });
        for (const t of [0.25, 0.5, 0.75]) rivet(ctx, ...A((u0 + u1) / 2, t), 1.3, C.brassL);
      }
    }
    // Level 5's crown (D118): a brass rim along the cornice's top, lamps studded along the band.
    if (look.crown) {
      ink(ctx, [A(0.005, 0.99), A(0.995, 0.99)], { w: 2.2, color: C.brassL, shade: false, taper: 0, jitter: 0, seed: s + 94 });
      for (const [j, u] of HEART_CROWN.entries()) light(ctx, ...A(u, 0.955), 1.7, j % 2 ? C.ledWarm : C.led);
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

/**
 * The Heart's data outlet (D68) on the out port's tile (tx, ty), its port on local `side`: a violet
 * data cabinet set back from the edge — LED rows, a grille, a short whip antenna with a cyan tip
 * — fed by a conduit from the depot, its dispenser hood dropping files onto a roller apron that
 * runs out to the port's coral nozzle.
 */
function dataOutletIso(ctx: Ctx, f: IsoFrame, tx: number, ty: number, side: number, s: number): void {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const dx = DX[side]!, dy = DY[side]!, cx = tx + 0.5, cy = ty + 0.5;
  const ccx = cx - dx * 0.2, ccy = cy - dy * 0.2;
  const hx = Math.abs(dy) * 0.36 + Math.abs(dx) * 0.19, hy = Math.abs(dx) * 0.36 + Math.abs(dy) * 0.19;
  // The apron from under the hood out to the nozzle.
  const a0 = 0.0, a1 = 0.36, w = 0.17;
  const bx0 = Math.min(cx + dx * a0 - Math.abs(dy) * w, cx + dx * a1 + Math.abs(dy) * w), bx1 = Math.max(cx + dx * a0 - Math.abs(dy) * w, cx + dx * a1 + Math.abs(dy) * w);
  const by0 = Math.min(cy + dy * a0 - Math.abs(dx) * w, cy + dy * a1 + Math.abs(dx) * w), by1 = Math.max(cy + dy * a0 - Math.abs(dx) * w, cy + dy * a1 + Math.abs(dx) * w);
  apronBelt(ctx, f, bx0, by0, bx1, by1, dx === 0 ? 'y' : 'x', s);
  // The conduit from the depot's wall into the cabinet's roof.
  pipeIso(ctx, f, [[Math.min(DEP.x1, Math.max(DEP.x0, ccx)) - dx * 0.12 - 0.08, Math.min(DEP.y1, Math.max(DEP.y0, ccy)) - dy * 0.12 - 0.08, 1.05], [ccx - 0.08, ccy - 0.08, 1.2], [ccx - 0.08, ccy - 0.08, 0.98]], 4, C.steelL, s + 1, false);
  const rr = box(ctx, f, ccx - hx, ccy - hy, ccx + hx, ccy + hy, SZ, 1.0, { top: mix(C.violet, C.steelD, 0.25), left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 2, { outline: 1.8 });
  faceLeds(ctx, f, rr, 'L', 0.84, 0.15, 0.85, 5, [C.led, C.ledGreen, C.led]);
  faceLeds(ctx, f, rr, 'R', 0.84, 0.2, 0.8, 4, [C.led, C.led, C.ledGreen]);
  faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.08, 0.66, s + 3, 3);
  facePanel(ctx, f, rr, 'L', 0.18, 0.82, SZ + 0.08, 0.66, mix(C.violet, C.steelL, 0.35), s + 4);
  // The dispenser hood over the apron's head, a cyan light at its mouth.
  const hdx = cx + dx * 0.05, hdy = cy + dy * 0.05, hw = 0.2, hd = 0.09;
  box(ctx, f, hdx - Math.abs(dy) * hw - Math.abs(dx) * hd, hdy - Math.abs(dx) * hw - Math.abs(dy) * hd, hdx + Math.abs(dy) * hw + Math.abs(dx) * hd, hdy + Math.abs(dx) * hw + Math.abs(dy) * hd, 0.52, 0.72, { top: C.steelD }, s + 5, { outline: 1.4, shadow: false });
  light(ctx, ...f.p(hdx + dx * 0.1, hdy + dy * 0.1, 0.56), 1.8, C.led);
  // The whip antenna, its cyan tip.
  pipeIso(ctx, f, [[ccx + 0.12, ccy + 0.12, 1.0], [ccx + 0.12, ccy + 0.12, 1.75]], 2, C.steelD, s + 6, false);
  light(ctx, ...f.p(ccx + 0.12, ccy + 0.12, 1.8), 2, C.led);
}

// ── the Heart's levels (D86): bare corners, the pieces each level mounts, its trims ─────────

/**
 * The Heart's look at a level (D86): what its trims show. Each level mounts a corner piece
 * (`HEART_CORNERS`) and fills the body out — level 2 a coral cornice round the depot's walls, a
 * second roof beacon, a second LED strip on each face of the slab; level 3 brass pilasters at the
 * depot's corners, a third beacon, a drone at work over the roof hatch; level 4 a hazard-striped
 * skirt at the depot's foot and floodlights on the slab; level 5 (D118) a crown of lamps — a
 * brass rim on the cornice, studded with lamps all round, cold and warm in turn (`HEART_CROWN`).
 * The beacons stop at three: the roof's fourth corner holds the claim's flag (world/heart-flag.ts).
 * The plan art (buildings-top.ts) reads it too.
 */
export function heartLook(lv: number): { beacons: number; strips: number; cornice: boolean; pilasters: boolean; drone: boolean; skirt: boolean; floods: boolean; crown: boolean } {
  return { beacons: Math.min(HEART_BEACONS.length, lv), strips: lv >= 2 ? 2 : 1, cornice: lv >= 2, pilasters: lv >= 3, drone: lv >= 3, skirt: lv >= 4, floods: lv >= 4, crown: lv >= 5 };
}

/** Level 5's crown (D118): the lamps along each visible face of the depot's cornice (u, 0…1 across it), clear of the brass pilasters at its ends. */
export const HEART_CROWN = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

/** What a level mounts on one of the Heart's corners (D86, D118). */
export type HeartPiece = 'outlet' | 'archive' | 'station' | 'uplink';

/**
 * The Heart's four corner tiles (local) and the level that mounts a piece on each (D86): level 2
 * the data outlet, on its out port's tile (south-east, the nearest in iso); level 3 the expertise
 * archive (south-west) — the way into the Expertise window (D93: a click on it, app/picking.ts
 * `heartPieceAt`); level 4 the grid station (north-east), a placeholder that unlocks nothing yet;
 * level 5 (D118) the uplink mast on the last one, north-west, behind the depot — a placeholder
 * too, and tall so it shows over the depot's roof. A piece that does nothing on a click is left
 * alone by the picker: only the Archive opens a window.
 */
export const HEART_CORNERS: ReadonlyArray<{ tx: number; ty: number; lv: number; piece: HeartPiece | null }> = (() => {
  const out = (BUILDINGS.hearth as BuildingDef).ports.find((p) => p.io === 'out')!;
  return [
    { tx: out.x, ty: out.y, lv: BAL.hearthDataLevel, piece: 'outlet' },
    { tx: 0, ty: 4, lv: 3, piece: 'archive' },
    { tx: 4, ty: 0, lv: 4, piece: 'station' },
    { tx: 0, ty: 0, lv: 5, piece: 'uplink' },
  ];
})();

/** A corner piece's centre on its tile: pulled a little in from the slab's edges (local). */
export function heartCornerAt(tx: number, ty: number, pull = 0.06): [number, number] {
  return [tx + 0.5 + (tx === 0 ? pull : -pull), ty + 0.5 + (ty === 0 ? pull : -pull)];
}

/**
 * A bare corner of the Heart's slab (D86): only a mounting plate stencilled on it, its four bolts
 * — room for what a level mounts there, nothing standing yet.
 */
function mountPlateIso(ctx: Ctx, f: IsoFrame, tx: number, ty: number, s: number): void {
  const [cx, cy] = heartCornerAt(tx, ty, 0.08), h = 0.27, z = SZ + 0.004;
  const q: Pt[] = [f.p(cx - h, cy - h, z), f.p(cx + h, cy - h, z), f.p(cx + h, cy + h, z), f.p(cx - h, cy + h, z)];
  flat(ctx, q, C.steelD, 0.3);
  ink(ctx, q, { closed: true, w: 1, alpha: 0.45, shade: false, jitter: 0, seed: s });
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) rivet(ctx, ...f.p(cx + a * (h - 0.06), cy + b * (h - 0.06), z), 1.5, C.steelL);
}

/** Half a level ring of radius r round (cx, cy, z), as an arc to ink: the half towards the viewer, or the far one. */
function ringArc(f: IsoFrame, cx: number, cy: number, r: number, z: number, near: boolean, s: number): Pt[] {
  const c = f.p(cx, cy, z), [ex, ey] = f.ell(r);
  return ellipsePts(c[0], c[1], ex, ey, s, 0, 40).filter(([, y]) => (near ? y >= c[1] - 0.5 : y <= c[1] + 0.5)).sort((p, q) => p[0] - q[0]);
}

/**
 * The expertise archive (D86, level 3): where the base keeps the record of what it has learnt to do
 * well — its expertises (D93); a click on it opens their window. A squat drum of white enamel banded in violet
 * on a steel plinth, a glazed band showing its stack of brass memory platters, a ring of
 * indicator dots, a cap with a stub antenna and its cyan lamp; a conduit from the depot's wall.
 */
function archiveIso(ctx: Ctx, f: IsoFrame, tx: number, ty: number, s: number): void {
  const [cx, cy] = heartCornerAt(tx, ty);
  // The conduit from inside the depot's wall (its nearest corner) over to the drum.
  const wx = Math.min(DEP.x1, Math.max(DEP.x0, cx)), wy = Math.min(DEP.y1, Math.max(DEP.y0, cy));
  const ix = wx + (wx === DEP.x0 ? 0.12 : -0.12), iy = wy + (wy === DEP.y0 ? 0.12 : -0.12);
  pipeIso(ctx, f, [[ix, iy, 1.02], [cx, cy, 1.02]], 4.4, C.steelL, s, false);
  cylinder(ctx, f, cx, cy, 0.37, SZ, SZ + 0.1, C.steelD, s + 1, { top: C.steel });
  cylinder(ctx, f, cx, cy, 0.31, SZ + 0.1, 0.72, LAB, s + 2, { top: LAB });
  // Indicator dots round the drum's near half (rotated coords: screen-left to screen-right).
  const [rcx, rcy] = f.r(cx, cy);
  for (const [i, a] of [0.12, 0.27, 0.42, 0.58, 0.73, 0.88].entries()) {
    const ang = (3 * Math.PI) / 4 - Math.PI * a;
    for (const z of [0.5, 0.6]) light(ctx, ...f.pr(rcx + Math.cos(ang) * 0.31, rcy + Math.sin(ang) * 0.31, z), 1.3, (i + (z > 0.55 ? 1 : 0)) % 2 ? DOT_G : DOT);
  }
  cylinder(ctx, f, cx, cy, 0.32, 0.72, 0.79, C.violet, s + 3, { top: C.violetL });
  cylinder(ctx, f, cx, cy, 0.29, 0.79, 1.13, mix(C.ice, C.steelD, 0.45), s + 4, { top: C.violetL });
  for (const [i, z] of [0.84, 0.9, 0.96, 1.02, 1.08].entries()) ink(ctx, ringArc(f, cx, cy, 0.26, z, true, s + 10 + i), { w: 2.2, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 10 + i });
  ink(ctx, [f.p(cx - 0.1, cy + 0.15, 0.82), f.p(cx - 0.1, cy + 0.15, 1.1)], { w: 1.6, color: '#ffffff', alpha: 0.5, shade: false, taper: 0.2, jitter: 0, seed: s + 16 });
  cylinder(ctx, f, cx, cy, 0.32, 1.13, 1.2, C.violet, s + 5, { top: C.violetL });
  latheIso(ctx, f, cx, cy, [[1.2, 0.29], [1.3, 0.27], [1.38, 0.19], [1.42, 0.1], [1.43, 0]], LAB, s + 6, { top: mix(LAB, C.steelL, 0.25), shadow: false, outline: 1.6 });
  pipeIso(ctx, f, [[cx, cy, 1.42], [cx, cy, 1.95]], 2, C.steelD, s + 7, false);
  light(ctx, ...f.p(cx, cy, 1.99), 1.9, C.led);
  light(ctx, ...f.p(cx - 0.12, cy + 0.12, 1.3), 1.5, C.ledGreen);
}

/** Where the grid station's parts stand on its corner tile (local; the Heart never turns): the mast on its far side, the cabinet before it; the mast's top and coil ring (levels). */
export function stationSpots(tx: number, ty: number): { mast: [number, number]; cab: [number, number]; top: number; ring: number } {
  const [cx, cy] = heartCornerAt(tx, ty);
  return { mast: [cx - 0.16, cy - 0.16], cab: [cx + 0.1, cy + 0.1], top: 3.6, ring: 3.15 };
}

/**
 * The grid station (D86, level 4 — a placeholder: it unlocks nothing yet): the claim's tie to the
 * orbital grid. A teal transformer cabinet with cooling fins and two porcelain bushings, and
 * behind it a slender lattice mast with a copper coil ring near its head and a red aviation light
 * on its tip; a cable from the cabinet into the depot.
 */
function stationIso(ctx: Ctx, f: IsoFrame, tx: number, ty: number, s: number): void {
  const { mast: [fx, fy], cab: [bx, by], top, ring } = stationSpots(tx, ty);
  const copper = mix(C.coral, C.brass, 0.4);
  ink(ctx, ringArc(f, fx, fy, 0.3, ring, false, s), { w: 3.6, color: mix(copper, C.ink, 0.35), shade: false, taper: 0, jitter: 0, seed: s + 1 });
  trussIso(ctx, f, fx, fy, 0.17, 0.05, SZ, top, 9, C.steelL, s + 2, 2.4);
  ink(ctx, ringArc(f, fx, fy, 0.3, ring, true, s + 3), { w: 4.2, color: copper, shade: false, taper: 0, jitter: 0, seed: s + 3 });
  pipeIso(ctx, f, [[fx, fy, top], [fx, fy, top + 0.3]], 1.8, C.steelD, s + 4, false);
  light(ctx, ...f.p(fx, fy, top + 0.34), 2.4, C.ledRed);
  light(ctx, ...f.p(fx, fy, ring + 0.02), 1.4, C.ledWarm);
  const rr = box(ctx, f, bx - 0.24, by - 0.2, bx + 0.24, by + 0.2, SZ, 0.82, { top: mix(C.teal, C.steelL, 0.3), left: C.teal, right: mix(C.teal, C.ink, 0.4) }, s + 5, { outline: 1.6 });
  for (const face of ['L', 'R'] as const) for (let i = 1; i < 6; i++) ink(ctx, [facePt(f, rr, face, i / 6, SZ + 0.08), facePt(f, rr, face, i / 6, 0.74)], { w: 1.2, color: C.ink, alpha: 0.4, shade: false, taper: 0, jitter: 0, seed: s + 6 + i });
  faceHazard(ctx, f, rr, 'L', 0.1, 0.9, SZ + 0.02, SZ + 0.1, s + 12);
  for (const [i, u] of [-0.1, 0.1].entries()) latheIso(ctx, f, bx + u, by - u, [[0.82, 0.05], [0.9, 0.05], [0.92, 0.07], [0.96, 0.05], [1.0, 0.065], [1.04, 0.04]], C.ice, s + 14 + i, { top: C.steelL, shadow: false, seams: false, outline: 1.1 });
  light(ctx, ...facePt(f, rr, 'R', 0.8, 0.7), 1.4, C.ledGreen);
  cableIso(ctx, f, [bx - 0.1, by + 0.1, 0.6], [Math.min(DEP.x1, Math.max(DEP.x0, bx)), Math.min(DEP.y1, Math.max(DEP.y0, by)), 0.7], 2.2, s + 20);
}

/**
 * Where the uplink's parts stand on its corner tile (local; the Heart never turns). The tile's
 * diagonal is the claim's flag's column in iso — its pole on the roof's back corner
 * (world/heart-flag.ts `FLAG`, laid over the Heart, the cloth flying to the right) —, so the mast
 * stands off it towards the screen's left, where the sky is clear, its dish on an arm towards the
 * south — further left on screen, and over the slab in plan. The radio cabinet stands behind it,
 * on the strip of slab the depot leaves in sight (anything nearer shows over the roof's back edge
 * and reads as standing on the roof); the guys' three anchors round it (the third under the dish
 * in plan, close by the dish). Heights in levels.
 */
export function uplinkSpots(tx: number, ty: number): { mast: [number, number]; dish: [number, number]; dishZ: number; top: number; cab: [number, number]; guys: ReadonlyArray<readonly [number, number]> } {
  const [cx, cy] = heartCornerAt(tx, ty);
  const mx = cx - 0.32, my = cy + 0.18;
  return { mast: [mx, my], dish: [mx, my + 0.36], dishZ: 3.0, top: 3.85, cab: [cx - 0.41, cy - 0.15], guys: [[cx - 0.01, cy - 0.46], [cx + 0.34, cy - 0.26], [cx - 0.49, cy + 0.41]] };
}

/**
 * A slim square lattice mast, as `trussIso`, its legs banded coral and white segment by segment
 * like an aviation mast (`segs` odd: coral at both ends).
 */
function bandedMastIso(ctx: Ctx, f: IsoFrame, cx: number, cy: number, w0: number, w1: number, z0: number, z1: number, segs: number, s: number, legW = 2.2): void {
  const K: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (k: number, t: number): Pt => {
    const w = w0 + (w1 - w0) * t, [sx, sy] = K[k]!;
    return f.p(cx + sx * w, cy + sy * w, z0 + (z1 - z0) * t);
  };
  const dep = (k: number): number => f.depth(cx + K[k]![0], cy + K[k]![1]);
  const legs = [0, 1, 2, 3].sort((a, b) => dep(a) - dep(b));
  const near = (k: number): boolean => dep(k) + dep((k + 1) % 4) > 2 * f.depth(cx, cy);
  const panel = (k: number, alpha: number, w: number): void => {
    const j = (k + 1) % 4;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      ink(ctx, [at(k, t0), at(j, t1)], { w, color: C.steelD, alpha, shade: false, taper: 0, jitter: 0, seed: s + k * 20 + i });
      ink(ctx, [at(j, t0), at(k, t1)], { w, color: C.steelD, alpha, shade: false, taper: 0, jitter: 0, seed: s + k * 20 + i + 7 });
      ink(ctx, [at(k, t1), at(j, t1)], { w: w + 0.3, color: C.steelDD, alpha, shade: false, taper: 0, jitter: 0, seed: s + k * 20 + i + 14 });
    }
  };
  const leg = (k: number, front: boolean): void => {
    ink(ctx, [at(k, 0), at(k, 1)], { w: legW + (front ? 2 : 1.4), color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 90 + k });
    for (let i = 0; i < segs; i++) ink(ctx, [at(k, i / segs), at(k, (i + 1) / segs)], { w: legW, color: i % 2 ? C.paper : C.coral, shade: false, taper: 0, jitter: 0, seed: s + 100 + k * 20 + i });
  };
  for (let k = 0; k < 4; k++) if (!near(k)) panel(k, 0.7, 1);
  for (const k of legs.slice(0, 2)) leg(k, false);
  for (let k = 0; k < 4; k++) if (near(k)) panel(k, 1, 1.2);
  for (const k of legs.slice(2)) leg(k, true);
}

/**
 * The uplink (D118, level 5 — a placeholder: it unlocks nothing): the base's own line to
 * CrierBelt's servers, on the north-west corner behind the depot, tall enough to show over its
 * roof. A slim lattice mast banded coral and white, guyed to the slab, on a concrete footing; high
 * up on an arm a small dish (`dish3d`) turned to the same sky as the roof's big one; on its top a
 * whip with a cyan lamp. Behind it a violet radio cabinet with its LEDs, cabled to the mast.
 * No lamp where the depot or the flag could cover it: the night glows go wherever a lamp is drawn.
 */
function uplinkPieceIso(ctx: Ctx, f: IsoFrame, tx: number, ty: number, s: number): void {
  const { mast: [mx, my], dish: [dx, dy], dishZ, top, cab: [bx, by], guys } = uplinkSpots(tx, ty);
  const z0 = SZ + 0.12, guyZ = 2.55;
  // Behind the mast: the radio cabinet, its LEDs on its far face from the mast, its cable to the
  // mast's foot; the guys' hazard-yellow anchor blocks on the slab, taut wires up to the mast.
  cableIso(ctx, f, [bx + 0.06, by + 0.06, 0.55], [mx - 0.04, my - 0.04, 0.75], 1.8, s + 62);
  const rr = box(ctx, f, bx - 0.1, by - 0.09, bx + 0.1, by + 0.09, SZ, 0.85, { top: mix(C.violet, C.steelL, 0.3), left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 60, { outline: 1.5 });
  faceLeds(ctx, f, rr, 'R', 0.68, 0.3, 0.7, 2, [C.led, C.ledGreen], 1.5);
  faceGrille(ctx, f, rr, 'R', 0.2, 0.8, SZ + 0.08, 0.5, s + 61, 3);
  for (const [i, [ax, ay]] of guys.entries()) {
    box(ctx, f, ax - 0.06, ay - 0.06, ax + 0.06, ay + 0.06, SZ, SZ + 0.12, { top: C.hazard, left: C.brass, right: mix(C.brass, C.ink, 0.4) }, s + i, { outline: 1.1, shadow: false });
    ink(ctx, [f.p(ax, ay, SZ + 0.12), f.p(mx, my, guyZ)], { w: 1, color: C.steelDD, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 4 + i });
  }
  cylinder(ctx, f, mx, my, 0.16, SZ, z0, C.steelD, s + 8, { top: C.steel });
  bandedMastIso(ctx, f, mx, my, 0.11, 0.035, z0, top, 7, s + 10, 2);
  // The dish's arm from the mast, then the dish (nearer than the mast), its face to the far horizon (the screen's left).
  const n = leanTo(f, -Math.SQRT1_2, Math.SQRT1_2, 0.95), R = 0.23;
  const D: V3 = [dx, dy, dishZ / 2], back = along3(D, n, -0.2 * R - 0.03);
  pipeIso(ctx, f, [[mx, my, dishZ - 0.05], [back[0], back[1], back[2] * 2]], 3.2, C.steelD, s + 20, false);
  dish3d(ctx, f, D, R, n, s + 30, { focal: 0.9, struts: 3 });
  // The whip on top and its cyan lamp.
  pipeIso(ctx, f, [[mx, my, top - 0.05], [mx, my, top + 0.42]], 1.6, C.steelD, s + 50, false);
  light(ctx, ...f.p(mx, my, top + 0.47), 2.6, C.led);
}

/** Where the level-4 floodlights stand along each near face of the slab (0…1): between the ports' aprons. */
export const HEART_FLOODS = [0.4, 0.6] as const;

/** A floodlight on the slab's face (level 4): a short steel hood, its warm lamp. */
function floodIso(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u: number, s: number): void {
  const a = facePt(f, rr, face, u - 0.025, SZ * 0.82), b = facePt(f, rr, face, u + 0.025, SZ * 0.82);
  ink(ctx, [a, b], { w: 4.2, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s });
  light(ctx, ...facePt(f, rr, face, u, SZ * 0.55), 2.6, C.ledWarm);
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

/**
 * A wind tower's layout (local tiles, levels): centred on (cx, cy), its sizes scaled by k round
 * that centre (the foot, the fins, the cabinet, the tower's girth), the slatted tower up to zt,
 * its bearing collar up to `hub`. `WIND` is the wind flower's (and the pitch turbine's).
 */
export interface WindSpec { cx: number; cy: number; k: number; zt: number; hub: number }
export const WIND: WindSpec = { cx: TURBINE.cx, cy: TURBINE.cy, k: 1, zt: 2.5, hub: TURBINE.hub };
/** The big turbine's tower (3×3): half as big again, much taller. */
export const BIG_WIND: WindSpec = { cx: 1.5, cy: 1.5, k: 1.45, zt: 4.1, hub: 4.42 };

/** The wind tower: tapering, slatted like a windtrap, two steel bands, the bearing collar on top. */
function windTower(ctx: Ctx, f: IsoFrame, s: number, w: WindSpec = WIND): void {
  const { cx, cy, hub, k } = w;
  const z0 = 0.4 * k, z1 = w.zt, r0 = 0.27 * k, r1 = 0.15 * k;
  const rad = (z: number): number => r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
  latheIso(ctx, f, cx, cy, [[z0, r0], [z1, r1]], OCHRE, s, { top: C.steelD, seams: false });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const [nx, ny] = turned(f, Math.cos(a), Math.sin(a));
    if (nx + ny < 0.3) continue;
    const at = (z: number): Pt => f.p(cx + Math.cos(a) * rad(z), cy + Math.sin(a) * rad(z), z);
    const rib = [at(z0 + 0.12), at(z1 - 0.06)];
    ink(ctx, rib, { w: 1.4, color: OCHRE_D, shade: false, taper: 0, jitter: 0, seed: s + i });
    ink(ctx, rib.map(([x, y]) => [x - 1.5, y] as Pt), { w: 0.8, color: '#ffffff', alpha: 0.32, shade: false, taper: 0, jitter: 0, seed: s + 20 + i });
  }
  const [lx, ly] = f.p(cx, cy, z0 + 0.5 * k), [ex] = f.ell(rad(z0 + 0.5 * k));
  scour(ctx, [[lx - ex, ly - 40 * k], [lx + ex, ly - 40 * k], [lx + ex, ly + 12 * k], [lx - ex, ly + 12 * k]], Math.round(50 * k), s + 30);
  const bands = k === 1 ? [1.15, 1.95] : [z0 + (z1 - z0) * 0.36, z0 + (z1 - z0) * 0.74];
  for (const [i, z] of bands.entries()) {
    const c = f.p(cx, cy, z), [bx, by] = f.ell(rad(z) + 0.012);
    const front = ellipsePts(c[0], c[1], bx, by, s + 31 + i, 0, 40).filter(([, y]) => y >= c[1] - 0.5).sort((p, q) => p[0] - q[0]);
    ink(ctx, front, { w: 4.2, color: C.ink, shade: false, taper: 0, seed: s + 33 + i });
    ink(ctx, front, { w: 2.4, color: C.steel, shade: false, taper: 0, seed: s + 35 + i });
  }
  cylinder(ctx, f, cx, cy, 0.19 * k, z1 - 0.04, hub, C.steel, s + 40, { top: C.steelL });
}

/**
 * The wind turbine's body (owner, 2026-10-12: "more Dune style"): a desert wind tower — a
 * battered, sand-scoured ochre foot with four buttress fins, a lean slatted tower like a
 * windtrap's, steel bands, the generator cabinet at its foot (access panel, grille, status
 * LEDs), the bearing on top. The crown turns above it (`turbineCrown`, `hRotorIso`). `w` scales
 * it (the big turbine's); `band` rings the bearing collar in that colour (the pitch turbines').
 */
function turbineBody(ctx: Ctx, f: IsoFrame, s: number, w: WindSpec = WIND, band?: string): void {
  const { cx, cy, k } = w;
  const top = frustumIso(ctx, f, cx - 0.72 * k, cy - 0.72 * k, cx + 0.72 * k, cy + 0.72 * k, 0, 0.4 * k, 0.1 * k, OCHRE_FACES, s, { outline: 2 });
  scour(ctx, top, Math.round(90 * k * k), s + 1);
  const sc = new Scene();
  // Buttress fins on the four sides (seen side-on whatever the view), far ones first.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a), tx = -sa * 0.036 * k, ty = ca * 0.036 * k;
    const at = (d: number, j: number): [number, number] => [cx + ca * d * k + tx * j, cy + sa * d * k + ty * j];
    sc.add(f.depth(cx + ca * 0.47 * k, cy + sa * 0.47 * k), () => {
      prismIso(ctx, f, [at(0.14, 1), at(0.66, 1), at(0.66, -1), at(0.14, -1)], 0.4 * k, [1.85 * k, 0.5 * k, 0.5 * k, 1.85 * k], OCHRE_FACES, s + 10 + i, { outline: 1.5, shadow: false });
    });
  }
  sc.add(f.depth(cx, cy), () => {
    windTower(ctx, f, s + 20, w);
    if (band) {
      const c = f.p(cx, cy, w.hub - 0.12), [bx, by] = f.ell(0.19 * k + 0.015);
      const front = ellipsePts(c[0], c[1], bx, by, s + 25, 0, 32).filter(([, y]) => y >= c[1] - 0.5).sort((p, q) => p[0] - q[0]);
      ink(ctx, front, { w: 6 * k, color: C.ink, shade: false, taper: 0, seed: s + 26 });
      ink(ctx, front, { w: 4 * k, color: band, shade: false, taper: 0, seed: s + 27 });
    }
  });
  // The generator cabinet in the corner between the two near fins.
  const c0 = 0.24 * k, c1 = 0.62 * k;
  sc.add(f.depth(cx + 0.43 * k, cy + 0.43 * k), () => {
    const rr = box(ctx, f, cx + c0, cy + c0, cx + c1, cy + c1, 0.4 * k, 0.94 * k, OCHRE_FACES, s + 30, { outline: 1.8 });
    faceLeds(ctx, f, rr, 'L', 0.78 * k, 0.25, 0.75, 3, [C.led, C.ledGreen, C.led]);
    facePanel(ctx, f, rr, 'L', 0.18, 0.82, 0.48 * k, 0.66 * k, C.steel, s + 31);
    faceGrille(ctx, f, rr, 'R', 0.15, 0.85, 0.5 * k, 0.84 * k, s + 32, 3);
    box(ctx, f, cx + 0.3 * k, cy + 0.3 * k, cx + 0.56 * k, cy + 0.56 * k, 0.94 * k, 1.0 * k, { top: C.steelD }, s + 33, { outline: 1.2, shadow: false });
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

/**
 * The pitch turbines' crowns (moving.ts `PITCH_ROTOR`, `BIG_ROTOR`) at phase t (1/n of a turn per
 * period): an H-rotor — n straight blades standing at radius r, each pitched off the tangent on
 * brass knuckles at the ends of its struts, banded at both tips; the shaft, the cone and the red
 * aviation light on its axis. Blades and struts are drawn far to near with the shaft.
 */
function hRotorIso(ctx: Ctx, f: IsoFrame, R: HRotor, s: number, t: number): void {
  const { cx, cy, r, n, z0, z1 } = R;
  const th = (t * 2 * Math.PI) / n, tip = (z1 - z0) * 0.14;
  const items: Array<{ d: number; fn: () => void }> = [];
  items.push({ d: f.depth(cx, cy), fn: () => {
    pipeIso(ctx, f, [[cx, cy, R.hub - 0.05], [cx, cy, R.top - 0.2]], 5.5 * R.k, C.steelL, s, false);
    for (const z of R.struts) latheIso(ctx, f, cx, cy, [[z - 0.07, 0.07 * R.k], [z + 0.07, 0.07 * R.k]], C.steelD, s + 1 + z, { top: C.steel, shadow: false, seams: false, outline: 1.2 });
  } });
  for (let i = 0; i < n; i++) {
    const a = th + (i / n) * Math.PI * 2;
    const bx = cx + Math.cos(a) * r, by = cy + Math.sin(a) * r;
    const ca = a + Math.PI / 2 + R.pitch, hx = (Math.cos(ca) * R.chord) / 2, hy = (Math.sin(ca) * R.chord) / 2;
    const [nx, ny] = turned(f, -hy, hx), L = Math.hypot(nx, ny) || 1;
    const sh = faceInk((nx + ny > 0 ? nx : -nx) / L, (nx + ny > 0 ? ny : -ny) / L);
    items.push({ d: f.depth(bx, by), fn: () => {
      for (const [j, z] of R.struts.entries()) {
        pipeIso(ctx, f, [[cx + Math.cos(a) * 0.08, cy + Math.sin(a) * 0.08, z], [bx, by, z]], 3 * R.k, C.steelD, s + 10 + i * 4 + j, false);
      }
      const q = (za: number, zb: number): Pt[] => [f.p(bx - hx, by - hy, zb), f.p(bx + hx, by + hy, zb), f.p(bx + hx, by + hy, za), f.p(bx - hx, by - hy, za)];
      flat(ctx, q(z0, z1), mix(R.blade, C.ink, sh));
      flat(ctx, q(z1 - tip, z1), mix(R.tip, C.ink, sh * 0.8));
      flat(ctx, q(z0, z0 + tip), mix(R.tip, C.ink, sh * 0.8));
      ink(ctx, [f.p(bx - hx, by - hy, z1 - 0.04), f.p(bx - hx, by - hy, z0 + 0.04)], { w: 1, color: '#ffffff', alpha: 0.35, shade: false, taper: 0, jitter: 0, seed: s + 20 + i });
      ink(ctx, q(z0, z1), { closed: true, w: 1.5, shade: false, taper: 0, jitter: 0, seed: s + 24 + i });
      for (const z of R.struts) rivet(ctx, ...f.p(bx, by, z), 2.6 * R.k, C.brassL);
    } });
  }
  items.sort((p, q) => p.d - q.d);
  for (const it of items) it.fn();
  latheIso(ctx, f, cx, cy, [[R.top - 0.24, 0.08 * R.k], [R.top - 0.1, 0.08 * R.k], [R.top, 0.03]], C.steelD, s + 40, { shadow: false, seams: false });
  light(ctx, ...f.p(cx, cy, R.top + 0.04), 2.6, C.ledRed);
}

/** What a spinning H-rotor casts: the solid band its blades sweep, the crown at phase 0 over it. */
function hRotorShadow(ctx: Ctx, f: IsoFrame, R: HRotor, s: number): void {
  const ring = (z: number): Pt[] => { const c = f.p(R.cx, R.cy, z), [ex, ey] = f.ell(R.r + R.chord / 2); return ellipsePts(c[0], c[1], ex, ey, s, 0, 32); };
  flat(ctx, hull([...ring(R.z0), ...ring(R.z1)]), C.ink);
  hRotorIso(ctx, f, R, s, 0);
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
  // 2×2 and about three tiles tall since D75: broad concrete feet, a lattice of nine bays narrowing to a wide head.
  for (const [i, [x, y]] of feet.entries()) latheIso(ctx, f, x, y, [[0, 0.16], [0.2, 0.12]], FOOTING, s + i, { top: mix(FOOTING, '#ffffff', 0.25), seams: false, shadow: false });
  trussIso(ctx, f, cx, cy, foot, 0.15, 0.1, arm + armH, 9, C.steelL, s + 5, 3);
  for (const [i, [a, b]] of ([[-1, -1], [1, 1]] as const).entries()) {
    pipeIso(ctx, f, [[cx + a * 0.15, cy + b * 0.15, arm + armH], [cx, cy, apex]], 2.6, C.steelL, s + 8 + i, false);
  }
  crossarmIso(ctx, f, cx, cy, half, arm, armH, ARM_STEEL, s + 20);
  for (const [i, t] of terminalsOf('pylon').entries()) terminalIso(ctx, f, t, s + 30 + i * 4);
  light(ctx, ...f.p(cx, cy, apex + 0.04), 3.2, C.ledRed);
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

// ── research and compute: labs, data antennas, server racks (the research redesign) ─────────
// Research runs on data files (D68): collectors and relays pull them out of the air with
// phased-array panels, labs take them in through a turquoise intake hopper and analyse them in a
// glazed chamber (a glowing cyan sample), servers crunch them in racks dense with indicator dots.
// Clean white enamel banded in violet says "lab"; violet racks and cyan dots say "compute".

/** The labs' white enamel (top, lit +y face, shaded +x face). */
export const LAB = mix(C.paper, C.ice, 0.45);
const LAB_FACES: Faces = { top: mix(LAB, C.steelL, 0.12), left: mix(LAB, C.steelL, 0.16), right: mix(LAB, C.ink, 0.3) };
/**
 * Indicator dots in near-LED paint (not the LED tokens): a rack carries hundreds of them without
 * each one becoming a night emitter (recipes/fx.ts); a few real LEDs per door glow at night.
 */
export const DOT = mix(C.led, C.teal, 0.18), DOT_G = mix(C.ledGreen, C.teal, 0.22), DOT_OFF = mix(C.steelD, C.steel, 0.4);
/** The cooled servers' coolant: cyan, not an LED token (it must not glow at night). */
export const COOLANT = mix(C.cyan, C.tealL, 0.35);
/** Printed circuit boards' green. */
export const PCB = mix(C.teal, '#3f9a52', 0.55);
/** The compute racks' violet steel. */
export const RACK = mix(C.violet, C.steel, 0.35);

/** A coloured band round the two visible faces of a box (a lab's violet stripe), z0…z1. */
function bandIso(ctx: Ctx, f: IsoFrame, rr: RRect, z0: number, z1: number, color: string, s: number): void {
  flat(ctx, faceQuad(f, rr, 'L', 0, 1, z0, z1), color);
  const r = faceQuad(f, rr, 'R', 0, 1, z0, z1);
  flat(ctx, r, mix(color, C.ink, 0.36));
  hatch(ctx, r, Math.PI / 3, 3.4, { alpha: 0.35, seed: s, w: 1 });
  for (const face of ['L', 'R'] as const) for (const z of [z0, z1]) ink(ctx, [facePt(f, rr, face, 0, z), facePt(f, rr, face, 1, z)], { w: 1, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 1 });
}

/** Dense rows of indicator dots on a face (u0…u1 across, z0…z1 up): seeded, a few dark. */
function dotRows(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number, s: number, dz = 0.11): void {
  const rng = makeRng(s);
  const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
  const n = Math.max(3, Math.round(((u1 - u0) * len) / 0.075));
  const dim = face === 'R' ? 0.28 : 0;
  ctx.save();
  for (let z = z0; z <= z1 + 1e-6; z += dz) {
    for (let k = 0; k < n; k++) {
      const r = rng.next();
      ctx.fillStyle = mix(r < 0.5 ? DOT : r < 0.78 ? DOT_G : DOT_OFF, C.ink, dim);
      const [x, y] = facePt(f, rr, face, u0 + ((u1 - u0) * (k + 0.5)) / n, z);
      ctx.fillRect(x - 1.3, y - 1, 2.6, 2);
    }
  }
  ctx.restore();
}

/**
 * A glazed case on a local rect, z0…z1 (a lab's analysis chamber): a steel floor, faint far
 * panes, whatever `inner` draws, near panes of tinted glass with sheen streaks, a steel frame.
 */
function glassCase(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, s: number, inner: () => void): RRect {
  const rr = f.rect(x0, y0, x1, y1);
  const [a0, b0, a1, b1] = rr;
  const P = (a: number, b: number, z: number): Pt => f.pr(a, b, z);
  castShadow(ctx, [P(a0, b0, z1), P(a1, b0, z1), P(a1, b0, z0), P(a1, b1, z0), P(a0, b1, z0), P(a0, b1, z1)], 4 + (z1 - z0) * 5, 0.18);
  const bar = (pts: Pt[], w: number): void => {
    ink(ctx, pts, { w: w + 1.8, shade: false, taper: 0, jitter: 0, seed: s });
    ink(ctx, pts, { w, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  };
  shape(ctx, [P(a0, b0, z0), P(a1, b0, z0), P(a1, b1, z0), P(a0, b1, z0)], C.steelD, { w: 1.2, shade: false, jitter: 0, seed: s + 2 });
  flat(ctx, [P(a0, b0, z0), P(a1, b0, z0), P(a1, b0, z1), P(a0, b0, z1)], C.ice, 0.3);
  flat(ctx, [P(a0, b0, z0), P(a0, b1, z0), P(a0, b1, z1), P(a0, b0, z1)], C.ice, 0.42);
  bar([P(a0, b0, z0), P(a0, b0, z1)], 1.4);
  inner();
  const L: Pt[] = [P(a0, b1, z1), P(a1, b1, z1), P(a1, b1, z0), P(a0, b1, z0)];
  const R: Pt[] = [P(a1, b0, z1), P(a1, b1, z1), P(a1, b1, z0), P(a1, b0, z0)];
  flat(ctx, L, C.ice, 0.3);
  flat(ctx, R, mix(C.ice, C.steel, 0.45), 0.4);
  flat(ctx, [P(a0, b0, z1), P(a1, b0, z1), P(a1, b1, z1), P(a0, b1, z1)], C.ice, 0.22);
  for (const face of ['L', 'R'] as const) {
    for (const [u, k] of [[0.18, 1], [0.34, 0.6]] as const) {
      ink(ctx, [facePt(f, rr, face, u + 0.22, z0 + (z1 - z0) * 0.88), facePt(f, rr, face, u, z0 + (z1 - z0) * (0.88 - 0.62 * k))], { w: 2.4 * k, color: '#ffffff', alpha: 0.6, shade: false, taper: 0.2, jitter: 0, seed: s + 3 });
    }
  }
  bar([P(a0, b1, z1), P(a0, b0, z1), P(a1, b0, z1)], 1.6);
  for (const [a, b] of [[a0, b1], [a1, b1], [a1, b0]] as const) bar([P(a, b, z0), P(a, b, z1)], 2);
  bar([P(a0, b1, z1), P(a1, b1, z1), P(a1, b0, z1)], 2.2);
  bar([P(a0, b1, z0), P(a1, b1, z0), P(a1, b0, z0)], 2.2);
  return rr;
}

/** The sample under analysis: a pedestal, a brass cradle, a glowing cyan sphere and its halo. */
function sampleIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z0: number, s: number, r = 0.1): void {
  cylinder(ctx, f, x, y, r * 1.1, z0, z0 + 0.12, C.steelD, s, { top: C.steel });
  const c = f.p(x, y, z0 + 0.12 + r * 2.2);
  flat(ctx, ellipsePts(c[0], c[1], r * 160, r * 160, s, 0, 20), C.led, 0.2);
  sphereIso(ctx, f, x, y, z0 + 0.12 + r * 2.2, r, C.cyan, s + 1);
  const b = f.p(x, y, z0 + 0.12 + r * 1.2), [ex, ey] = f.ell(r * 1.15);
  ink(ctx, ellipsePts(b[0], b[1], ex, ey, s + 2, 0, 24).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 2.2, color: C.brass, shade: false, taper: 0, seed: s + 3 });
  light(ctx, c[0] - 1, c[1] - 1, r * 34, C.led);
}

/** Data files (D68: cyan cards) lying in an open mouth (its canvas polygon). */
function fileChips(ctx: Ctx, mouth: readonly Pt[], n: number, s: number): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of mouth) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const rng = makeRng(s);
  ctx.save(); pathOf(ctx, mouth); ctx.clip();
  for (let i = 0; i < n; i++) {
    const cx = x0 + (x1 - x0) * (0.25 + 0.5 * rng.next()), cy = y0 + (y1 - y0) * (0.35 + 0.45 * rng.next());
    const a = rng.range(-0.6, 0.6), w = 7, h = 4.6, c = Math.cos(a), sn = Math.sin(a);
    const q: Pt[] = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [cx + u! * c - v! * sn, cy + u! * sn + v! * c] as Pt);
    shape(ctx, q, i % 3 ? C.cyan : C.tealL, { w: 1, shade: false, jitter: 0, seed: s + i });
    flat(ctx, [q[0]!, [(q[0]![0] + q[1]![0]) / 2, (q[0]![1] + q[1]![1]) / 2], [(q[3]![0] + q[2]![0]) / 2, (q[3]![1] + q[2]![1]) / 2], q[3]!], C.paper, 0.85);
  }
  ctx.restore();
}

/** The labs' turquoise intake hopper (the way data files come in), flaring open, files inside. */
function intakeHopperIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z1: number, s: number): Pt[] {
  const top = frustumIso(ctx, f, x0, y0, x1, y1, SZ, z1, -0.07, { top: C.turqL, left: C.turq, right: mix(C.turq, C.ink, 0.38) }, s, { open: C.ink });
  fileChips(ctx, top, 5, s + 1);
  return top;
}

/** An instrument cabinet: a panelled box with rows of status LEDs and a grille. */
function cabinetIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z1: number, col: string, s: number, rows = 2): RRect {
  const rr = box(ctx, f, x0, y0, x1, y1, SZ, z1, { top: mix(col, C.steelD, 0.35), left: col, right: mix(col, C.ink, 0.4) }, s, { outline: 1.8 });
  facePanel(ctx, f, rr, 'L', 0.14, 0.86, SZ + 0.08, z1 - 0.12 - rows * 0.16, mix(col, C.steelL, 0.3), s + 1);
  for (let i = 0; i < rows; i++) faceLeds(ctx, f, rr, 'L', z1 - 0.14 - i * 0.16, 0.2, 0.8, 4, i % 2 ? [C.ledGreen, C.led] : [C.led, C.led, C.ledGreen], 1.7);
  faceGrille(ctx, f, rr, 'R', 0.18, 0.82, SZ + 0.12, z1 - 0.2, s + 2, 4);
  return rr;
}

/** A fan grille lying on a roof at height z: a pale rim, a dark throat, five swept blades, a hub. */
function fanIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, r: number, s: number): void {
  const c = f.p(x, y, z), [ex, ey] = f.ell(r);
  shape(ctx, ellipsePts(c[0], c[1], ex, ey, s, 0, 28), C.steelL, { w: 1.3, shade: false, jitter: 0, seed: s });
  flat(ctx, ellipsePts(c[0], c[1] + 0.6, ex * 0.8, ey * 0.8, s + 1, 0, 28), C.steelDD);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4, b = a + 0.55;
    ink(ctx, [[c[0] + Math.cos(a) * ex * 0.18, c[1] + Math.sin(a) * ey * 0.18], [c[0] + Math.cos(a + 0.3) * ex * 0.5, c[1] + Math.sin(a + 0.3) * ey * 0.5], [c[0] + Math.cos(b) * ex * 0.74, c[1] + Math.sin(b) * ey * 0.74]], { w: Math.max(1.4, ex * 0.12), color: C.steel, shade: false, taper: 0.3, jitter: 0, seed: s + 2 + i });
  }
  flat(ctx, ellipsePts(c[0], c[1], ex * 0.16, ey * 0.16, s + 8, 0, 12), C.steelL);
  ink(ctx, [[c[0] - ex * 0.8, c[1]], [c[0] + ex * 0.8, c[1]]], { w: 0.8, color: C.steelL, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 9 });
}

/**
 * A server rack (a cabinet on a local rect, SZ…z1): its doors dense with indicator dots
 * (`dotRows`) between real status LEDs, a vent strip under the roof, `fans` fan grilles on top.
 */
function rackIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z1: number, s: number, o: { col?: string; fans?: number; z0?: number } = {}): RRect {
  const col = o.col ?? RACK, z0 = o.z0 ?? SZ;
  const rr = box(ctx, f, x0, y0, x1, y1, z0, z1, { top: mix(col, C.steelD, 0.5), left: col, right: mix(col, C.ink, 0.42) }, s, { outline: 1.8 });
  for (const face of ['L', 'R'] as const) {
    const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
    const doors = Math.max(1, Math.round(len / 0.5));
    for (let d = 0; d < doors; d++) {
      const u0 = d / doors + 0.05 / len, u1 = (d + 1) / doors - 0.05 / len;
      const zt = z1 - 0.2;
      shape(ctx, faceQuad(f, rr, face, u0, u1, z0 + 0.08, zt), C.steelDD, { w: 1, shade: false, jitter: 0, seed: s + 10 + d });
      dotRows(ctx, f, rr, face, u0 + 0.02 / len, u1 - 0.02 / len, z0 + 0.2, zt - 0.14, s + 20 + d * 7 + (face === 'L' ? 0 : 50));
      light(ctx, ...facePt(f, rr, face, u0 + 0.06 / len, zt - 0.06), 1.5, face === 'L' ? C.led : C.ledGreen);
    }
    for (const z of [z1 - 0.13, z1 - 0.07]) ink(ctx, [facePt(f, rr, face, 0.03, z), facePt(f, rr, face, 0.97, z)], { w: 1, color: C.steelDD, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 5 });
  }
  const n = o.fans ?? 0;
  if (n > 0) {
    const [a0, b0, a1, b1] = rr;
    const along = a1 - a0 >= b1 - b0, L = along ? a1 - a0 : b1 - b0, r = Math.min(0.2, Math.min(a1 - a0, b1 - b0) * 0.36, L / n / 2.4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const [x, y] = unrot(f, along ? a0 + L * t : (a0 + a1) / 2, along ? (b0 + b1) / 2 : b0 + L * t);
      fanIso(ctx, f, x, y, z1, r, s + 40 + i);
    }
  }
  return rr;
}

/**
 * A phased-array panel (a data antenna) centred on c (local tiles, z in levels), w × h tiles,
 * facing the unit normal n (its z in tiles): a steel frame of `cols × rows` dark violet
 * elements with cyan feeds, seen from the front, or its ribbed back plate from behind.
 */
function arrayPanel(ctx: Ctx, f: IsoFrame, c: V3, w: number, h: number, n: V3, cols: number, rows: number, s: number): void {
  const C3: V3 = [c[0], c[1], c[2] / 2];
  const u = norm3([-n[1], n[0], 0]);
  const v = cross3(n, u);
  const P = (a: number, b: number, off = 0): Pt => f.p(C3[0] + u[0] * a + v[0] * b + n[0] * off, C3[1] + u[1] * a + v[1] * b + n[1] * off, (C3[2] + u[2] * a + v[2] * b + n[2] * off) * 2);
  const quad = (a0: number, b0: number, a1: number, b1: number, off = 0): Pt[] => [P(a0, b0, off), P(a1, b0, off), P(a1, b1, off), P(a0, b1, off)];
  const [nrx, nry] = turned(f, n[0], n[1]);
  const front = nrx + nry + n[2] > 0;
  const W = w / 2, H = h / 2;
  castShadow(ctx, quad(-W, -H, W, H), 8, 0.22);
  // The mount: an arm from behind the panel's middle.
  pipeIso(ctx, f, [[C3[0] - n[0] * 0.2, C3[1] - n[1] * 0.2, (C3[2] - n[2] * 0.2) * 2], [C3[0], C3[1], C3[2] * 2]], 5, C.steelD, s, false);
  shape(ctx, quad(-W, -H, W, H, -0.05), C.steelD, { w: 1.6, shade: false, jitter: 0, seed: s + 1 });
  if (!front) {
    shape(ctx, quad(-W, -H, W, H, -0.05), C.steel, { w: 1.6, shade: false, jitter: 0, seed: s + 2 });
    for (let i = 1; i < cols; i++) ink(ctx, [P(-W + (w * i) / cols, -H, -0.05), P(-W + (w * i) / cols, H, -0.05)], { w: 1.4, color: C.steelDD, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 3 + i });
    return;
  }
  shape(ctx, quad(-W, -H, W, H), C.steelL, { w: 1.8, shade: false, jitter: 0, seed: s + 3 });
  const g = Math.min(w / cols, h / rows) * 0.12;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a0 = -W + (w * i) / cols + g, a1 = -W + (w * (i + 1)) / cols - g, b0 = -H + (h * j) / rows + g, b1 = -H + (h * (j + 1)) / rows - g;
    flat(ctx, quad(a0, b0, a1, b1), (i + j) % 2 ? mix(C.violet, C.ink, 0.45) : mix(C.violet, C.ink, 0.32));
    const m = P((a0 + a1) / 2, (b0 + b1) / 2);
    flat(ctx, ellipsePts(m[0], m[1], 1.5, 1.2, 1, 0, 8), j === rows - 1 ? C.ice : C.cyan);
  }
  ink(ctx, [P(-W, -H), P(-W, H), P(W, H)], { w: 1.4, color: '#ffffff', alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: s + 4 });
  ink(ctx, quad(-W, -H, W, H), { closed: true, w: 1.8, shade: false, jitter: 0, seed: s + 5 });
  light(ctx, ...P(W - 0.05, H - 0.05), 1.5, C.led);
}

/** A unit normal leaning `tilt` radians from the vertical towards the screen-fixed rotated direction (rx, ry). */
function leanTo(f: IsoFrame, rx: number, ry: number, tilt: number): V3 {
  const [lx, ly] = facingDir(f, rx, ry), l = Math.hypot(lx, ly) || 1;
  return [(lx / l) * Math.sin(tilt), (ly / l) * Math.sin(tilt), Math.cos(tilt)];
}

/** A stack of n data cartridges (cyan shells, paper labels) at local (x, y) on a surface at z. */
function cartStackIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, n: number, s: number): void {
  for (let i = 0; i < n; i++) {
    const zz = z + i * 0.085, dx = (((i * 37 + s) % 5) - 2) * 0.01;
    const rr = box(ctx, f, x - 0.13 + dx, y - 0.09, x + 0.13 + dx, y + 0.09, zz, zz + 0.075, { top: C.cyan, left: mix(C.cyan, C.ink, 0.18), right: mix(C.cyan, C.ink, 0.4) }, s + i, { outline: 1.1, shadow: i === 0 });
    flat(ctx, faceQuad(f, rr, 'L', 0.25, 0.7, zz + 0.015, zz + 0.06), C.paper);
  }
}

/** A circuit board lying on a surface at z (local rect): green laminate, brass traces, black chips. */
function pcbIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z: number, s: number): void {
  box(ctx, f, x0, y0, x1, y1, z, z + 0.04, { top: PCB, left: mix(PCB, C.ink, 0.25), right: mix(PCB, C.ink, 0.45) }, s, { outline: 1.2, shadow: false });
  const zt = z + 0.04, rng = makeRng(s);
  for (let i = 0; i < 4; i++) {
    const y = y0 + (y1 - y0) * (0.2 + 0.2 * i), xa = x0 + (x1 - x0) * rng.range(0.08, 0.3), xb = x0 + (x1 - x0) * rng.range(0.6, 0.92);
    ink(ctx, [f.p(xa, y, zt), f.p((xa + xb) / 2, y, zt), f.p((xa + xb) / 2 + 0.04, y + 0.03, zt), f.p(xb, y + 0.03, zt)], { w: 0.9, color: C.brassL, alpha: 0.9, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  for (const [cx, cy, hw] of [[0.32, 0.4, 0.1], [0.68, 0.62, 0.07]] as const) {
    const x = x0 + (x1 - x0) * cx, y = y0 + (y1 - y0) * cy;
    box(ctx, f, x - hw, y - hw * 0.8, x + hw, y + hw * 0.8, zt, zt + 0.05, { top: C.steelDD }, s + 9, { outline: 1, shadow: false });
  }
}

/**
 * The research lab (`observatory`, 3×3 since D84; the telescope dome is gone with the research
 * redesign): a clean white block banded in violet, along its whole back the turquoise intake
 * hopper where the data files arrive (its three in-ports), a glazed analysis chamber on its roof
 * round a glowing cyan sample, a vent stack; a row of instrument cabinets with status LEDs on its
 * side, a short antenna on the tall one. A machine: no windows, no doors.
 */
function labIso(ctx: Ctx, f: IsoFrame, s: number): void {
  slab(ctx, f, C.steel, 0.05, SZ, s);
  const sc = new Scene();
  sc.add(f.depth(1.5, 2.58), () => intakeHopperIso(ctx, f, 0.2, 2.3, 2.8, 2.86, 0.9, s + 1));
  sc.add(f.depth(1.1, 1.15), () => {
    const rr = box(ctx, f, 0.18, 0.18, 2.05, 2.12, SZ, 1.75, LAB_FACES, s + 2);
    bandIso(ctx, f, rr, SZ, SZ + 0.1, C.steelD, s + 3);
    bandIso(ctx, f, rr, 1.38, 1.56, C.violet, s + 4);
    faceGrille(ctx, f, rr, 'R', 0.08, 0.42, 0.5, 1.2, s + 5, 5);
    facePanel(ctx, f, rr, 'R', 0.52, 0.88, 0.5, 1.2, LAB, s + 6);
    faceLeds(ctx, f, rr, 'L', 1.2, 0.08, 0.4, 4, [C.led, C.ledGreen, C.led, C.led], 1.8);
    faceGrille(ctx, f, rr, 'L', 0.48, 0.72, 0.5, 1.05, s + 7, 4);
    faceLeds(ctx, f, rr, 'L', 1.2, 0.78, 0.94, 2, [C.ledGreen, C.led], 1.8);
    latheIso(ctx, f, 1.78, 0.46, [[1.75, 0.085], [2.3, 0.085], [2.3, 0.16], [2.39, 0.16], [2.43, 0.07]], C.steelL, s + 8, { top: C.steelD, seams: false });
    glassCase(ctx, f, 0.4, 0.56, 1.5, 1.72, 1.75, 2.5, s + 9, () => sampleIso(ctx, f, 0.95, 1.14, 1.75, s + 10, 0.12));
  });
  sc.add(f.depth(2.53, 0.53), () => {
    cabinetIso(ctx, f, 2.22, 0.2, 2.84, 0.86, 1.65, C.violet, s + 20, 3);
    pipeIso(ctx, f, [[2.53, 0.53, 1.65], [2.53, 0.53, 2.95]], 2.4, C.steelD, s + 21, false);
    for (const [i, z] of [2.3, 2.62].entries()) ink(ctx, [f.p(2.53 - 0.11, 0.53 + 0.11, z), f.p(2.53 + 0.11, 0.53 - 0.11, z)], { w: 1.7, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 22 + i });
    light(ctx, ...f.p(2.53, 0.53, 3.0), 2.4, C.ledRed);
  });
  sc.add(f.depth(2.53, 1.3), () => cabinetIso(ctx, f, 2.22, 0.98, 2.84, 1.62, 1.3, mix(C.steel, C.violet, 0.3), s + 25, 2));
  sc.add(f.depth(2.53, 1.95), () => cabinetIso(ctx, f, 2.22, 1.74, 2.84, 2.16, 0.9, C.steel, s + 28, 1));
  sc.run();
}

/** The electronics line's reel rack: a back panel, two shelves, component reels standing on them (axles along y). */
function reelRackIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, s: number): void {
  box(ctx, f, x0, y0, x1, y0 + 0.07, SZ, 1.3, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s, { outline: 1.5 });
  const cols = [C.brass, C.teal, C.coral, C.violetL, C.cyan, C.brassL];
  for (const [j, z] of [0.42, 0.86].entries()) {
    box(ctx, f, x0, y0, x1, y1, z - 0.05, z, { top: C.steelL }, s + 1 + j, { outline: 1.3, shadow: false });
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n, y = (y0 + y1) / 2 + 0.02;
      drumIso(ctx, f, x, y, z + 0.16, 0.115, 0.05, 'y', cols[(i + j * 3) % cols.length]!, s + 10 + i + j * 3, { shadow: false, bands: [0] });
    }
  }
  for (const x of [x0 + 0.03, x1 - 0.03]) pipeIso(ctx, f, [[x, y1 - 0.03, SZ], [x, y1 - 0.03, 1.3]], 2.4, C.steelD, s + 30 + x * 10, false);
}

/**
 * The electronics workshop (`workshop`, 2×2): a circuit-board line — a low conveyor bed from the
 * intakes at the back to the front, green boards riding it under a pick-and-place gantry (brass
 * rails, a coral bridge, a placing head), a reflow oven over its front end (a coral glow at its
 * mouth, a glowing slit down its side); a rack of component reels, the line's control cabinet.
 */
function electronicsIso(ctx: Ctx, f: IsoFrame, s: number): void {
  slab(ctx, f, C.steel, 0.05, SZ, s);
  const sc = new Scene();
  const posts: ReadonlyArray<readonly [number, number]> = [[0.1, 0.72], [0.9, 0.72], [0.1, 1.72], [0.9, 1.72]];
  for (const [i, [x, y]] of posts.entries()) sc.add(f.depth(x, y), () => pipeIso(ctx, f, [[x, y, SZ], [x, y, 1.32]], 3, C.steelD, s + 40 + i, false));
  sc.add(f.depth(0.5, 1.23), () => {
    const bed = box(ctx, f, 0.2, 0.6, 0.8, 1.86, SZ, 0.56, { top: C.steelDD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 1);
    for (let k = 1; k < 14; k++) { const y = 0.6 + (1.26 * k) / 14; ink(ctx, [f.p(0.23, y, 0.56), f.p(0.77, y, 0.56)], { w: 1.2, color: C.steelL, alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: s + 2 + k }); }
    faceHazard(ctx, f, bed, 'L', 0.04, 0.96, SZ + 0.04, SZ + 0.12, s + 3);
    faceHazard(ctx, f, bed, 'R', 0.02, 0.98, SZ + 0.04, SZ + 0.12, s + 4);
    for (const [i, y] of [0.7, 1.08, 1.48].entries()) pcbIso(ctx, f, 0.28, y, 0.72, y + 0.3, 0.56, s + 5 + i * 3);
  });
  sc.add(f.depth(0.5, 0.35), () => {
    const rr = box(ctx, f, 0.12, 0.1, 0.88, 0.58, SZ, 1.02, { top: C.steelL, left: mix(C.steelL, C.ink, 0.12), right: mix(C.steel, C.ink, 0.22) }, s + 20);
    faceGrille(ctx, f, rr, 'R', 0.12, 0.88, SZ + 0.08, 0.56, s + 21, 3);
    faceGlow(ctx, f, rr, 'R', 0.1, 0.9, 0.7, 0.78, C.ledWarm);
    if (facing(f, 2)) {
      shape(ctx, faceQuad(f, rr, 'L', 0.16, 0.84, 0.52, 0.76), C.ink, { w: 1, shade: false, jitter: 0, seed: s + 22 });
      flat(ctx, faceQuad(f, rr, 'L', 0.2, 0.8, 0.6, 0.7), C.warn);
      light(ctx, ...facePt(f, rr, 'L', 0.5, 0.65), 2.6, C.ledWarm);
    } else faceGlow(ctx, f, rr, 'L', 0.1, 0.9, 0.7, 0.78, C.ledWarm);
    faceLeds(ctx, f, rr, 'L', 0.9, 0.2, 0.8, 4, [C.ledWarm, C.led], 1.6);
    fanIso(ctx, f, 0.36, 0.34, 1.02, 0.15, s + 23);
    latheIso(ctx, f, 0.7, 0.3, [[1.02, 0.07], [1.32, 0.07], [1.32, 0.1], [1.38, 0.1]], C.steelD, s + 24, { open: C.ink, seams: false });
  });
  sc.add(f.depth(1.47, 0.49), () => cabinetIso(ctx, f, 1.12, 0.14, 1.86, 0.84, 1.0, mix(C.steel, C.violet, 0.35), s + 30, 2));
  sc.add(f.depth(1.47, 1.42), () => reelRackIso(ctx, f, 1.1, 1.06, 1.86, 1.8, s + 50));
  // The gantry: brass rails on the posts, the coral bridge across, the placing head over a board.
  sc.add(f.depth(0.5, 1.2) + 1.5, () => {
    for (const x of [0.1, 0.9]) pipeIso(ctx, f, [[x, 0.66, 1.32], [x, 1.78, 1.32]], 4, C.brass, s + 60 + x * 10, false);
    box(ctx, f, 0.04, 1.08, 0.96, 1.22, 1.32, 1.44, { top: C.coral }, s + 62, { outline: 1.5, shadow: false });
    const hr = box(ctx, f, 0.4, 1.06, 0.6, 1.24, 0.98, 1.5, { top: C.violetL, left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 63, { outline: 1.4, shadow: false });
    pipeIso(ctx, f, [[0.5, 1.15, 0.98], [0.5, 1.15, 0.66]], 2.2, C.steelL, s + 64, false);
    light(ctx, ...facePt(f, hr, 'L', 0.5, 1.3), 1.6, C.led);
  });
  sc.run();
}

/** A scope screen on a visible face (u0…u1 across, z0…z1 up): a dark bezel, a green grid, a glowing trace. */
function scopeIso(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u0: number, u1: number, z0: number, z1: number, s: number): void {
  shape(ctx, faceQuad(f, rr, face, u0, u1, z0, z1), C.steelDD, { w: 1.2, shade: false, jitter: 0, seed: s });
  const du = (u1 - u0) * 0.1, dz = (z1 - z0) * 0.14;
  const a0 = u0 + du, a1 = u1 - du, b0 = z0 + dz, b1 = z1 - dz;
  flat(ctx, faceQuad(f, rr, face, a0, a1, b0, b1), mix(C.teal, C.ink, 0.6));
  for (let k = 1; k < 4; k++) ink(ctx, [facePt(f, rr, face, a0 + ((a1 - a0) * k) / 4, b0), facePt(f, rr, face, a0 + ((a1 - a0) * k) / 4, b1)], { w: 0.7, color: C.teal, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + k });
  ink(ctx, [facePt(f, rr, face, a0, (b0 + b1) / 2), facePt(f, rr, face, a1, (b0 + b1) / 2)], { w: 0.7, color: C.teal, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 5 });
  const trace: Pt[] = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return facePt(f, rr, face, a0 + (a1 - a0) * t, (b0 + b1) / 2 + Math.sin(t * Math.PI * 4) * (b1 - b0) * 0.32 * (1 - 0.5 * t));
  });
  ink(ctx, trace, { w: 1.5, color: C.ledGreen, shade: false, taper: 0, jitter: 0, seed: s + 6 });
}

/**
 * The test bench (`test_bench`, 2×2): it load-tests gears and circuits and records Mechanics
 * Data. A dynamometer at the front — a teal drive motor turning a gear train clamped in an open
 * frame under a coral clamp bar, braked by a coral load drum; a vibration table at the back on brass
 * springs, a circuit board clamped on it, over its shaker; the instrument rack beside them, its
 * status LEDs and a scope screen showing the trace; cable looms tying the rigs to the rack.
 */
function testBenchIso(ctx: Ctx, f: IsoFrame, s: number): void {
  slab(ctx, f, C.steel, 0.05, SZ, s, true);
  const sc = new Scene();
  // The vibration table: base and shaker, springs, the plate, the clamped board.
  sc.add(f.depth(0.68, 1.4), () => {
    const base = box(ctx, f, 0.16, 1.02, 1.24, 1.8, SZ, 0.4, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 1);
    faceGrille(ctx, f, base, 'L', 0.08, 0.4, SZ + 0.03, 0.37, s + 2, 2);
    faceLeds(ctx, f, base, 'L', 0.35, 0.6, 0.9, 3, [C.ledGreen, C.led], 1.3);
    drumIso(ctx, f, 0.69, 1.41, 0.48, 0.07, 0.16, 'x', C.coral, s + 3, { shadow: false });
    for (const [i, [x, y]] of ([[0.26, 1.12], [1.12, 1.12], [0.26, 1.7], [1.12, 1.7]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1])).entries()) springIso(ctx, f, x, y, 0.4, 0.58, s + 4 + i);
    const plate = box(ctx, f, 0.2, 1.06, 1.18, 1.76, 0.58, 0.67, { top: C.steelL, left: mix(C.steelL, C.ink, 0.15), right: mix(C.steel, C.ink, 0.3) }, s + 8, { outline: 1.6, shadow: false });
    faceHazard(ctx, f, plate, 'L', 0.02, 0.98, 0.59, 0.66, s + 9);
    pcbIso(ctx, f, 0.4, 1.18, 0.98, 1.64, 0.67, s + 10);
    for (const x of [0.36, 1.02]) box(ctx, f, x - 0.05, 1.14, x + 0.05, 1.68, 0.67, 0.77, { top: C.steelDD }, s + 12 + x, { outline: 1.1, shadow: false });
  });
  // The dynamometer: a hazard-edged bed, the drive motor, the gear train clamped in an open frame
  // (gears on shafts between two posts under a clamp bar), the coral load brake on its stand.
  sc.add(f.depth(0.74, 0.46), () => {
    const bed = box(ctx, f, 0.12, 0.22, 1.36, 0.7, SZ, 0.55, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 20);
    faceHazard(ctx, f, bed, 'L', 0.03, 0.97, SZ + 0.04, SZ + 0.13, s + 21);
    const m = box(ctx, f, 0.14, 0.28, 0.4, 0.64, 0.55, 1.3, C.teal, s + 22, { outline: 1.6 });
    faceGrille(ctx, f, m, 'L', 0.15, 0.85, 0.62, 1.08, s + 23, 3);
    faceLeds(ctx, f, m, 'L', 1.2, 0.25, 0.75, 2, [C.led, C.ledGreen], 1.3);
  });
  const gears = [[0.72, 1.36, 0.27, 16, C.brass], [1.05, 1.44, 0.13, 9, C.steelL], [1.26, 1.3, 0.11, 8, C.brassL]] as const;
  for (const [i, [x, z, r, n, col]] of gears.entries()) {
    sc.add(f.depth(x, 0.46) + 0.001 * i, () => {
      pipeIso(ctx, f, [[x, 0.34, z], [x, 0.58, z]], 2.6, C.steelD, s + 30 + i, false);
      wheelIso(ctx, f, x, 0.46, z, r, 'y', n, col, s + 33 + i);
    });
  }
  for (const [i, x] of [0.42, 1.42].entries()) sc.add(f.depth(x, 0.46) + 0.002, () => box(ctx, f, x - 0.035, 0.4, x + 0.035, 0.52, 0.55, 1.98, { top: C.steelD, left: C.steelL, right: mix(C.steel, C.ink, 0.3) }, s + 37 + i, { outline: 1.3 }));
  sc.add(f.depth(0.92, 0.46) + 0.5, () => {
    pipeIso(ctx, f, [[0.4, 0.46, 1.2], [0.6, 0.46, 1.3], [0.72, 0.46, 1.36]], 3.2, C.steelL, s + 39, false);
    const bar = box(ctx, f, 0.37, 0.43, 1.47, 0.49, 1.98, 2.08, { top: C.coral }, s + 40, { outline: 1.4, shadow: false });
    for (const u of [0.2, 0.5, 0.78]) rivet(ctx, ...facePt(f, bar, 'L', u, 2.03), 1.6, C.brassL);
  });
  sc.add(f.depth(1.62, 0.42), () => {
    box(ctx, f, 1.44, 0.24, 1.82, 0.6, SZ, 0.62, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 41, { outline: 1.4 });
    pipeIso(ctx, f, [[1.26, 0.46, 1.3], [1.5, 0.46, 1.0]], 3, C.steelL, s + 42, false);
    drumIso(ctx, f, 1.64, 0.44, 0.98, 0.2, 0.13, 'x', C.coral, s + 43, { bands: [0], end: mix(C.coral, C.coralD, 0.4) });
    box(ctx, f, 1.56, 0.32, 1.72, 0.42, 1.32, 1.44, { top: C.steelD }, s + 44, { outline: 1.2, shadow: false });
  });
  // The instrument rack: status LEDs, the scope screen with its trace, a vent.
  sc.add(f.depth(1.65, 0.8), () => {
    const jb = box(ctx, f, 1.48, 0.66, 1.82, 0.94, SZ, 0.72, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 48, { outline: 1.4 });
    faceLeds(ctx, f, jb, 'L', 0.6, 0.3, 0.7, 2, [C.ledWarm, C.led], 1.3);
  });
  sc.add(f.depth(1.65, 1.41), () => {
    const rr = box(ctx, f, 1.44, 1.02, 1.86, 1.8, SZ, 1.25, { top: mix(C.violet, C.steelD, 0.35), left: C.violet, right: mix(C.violet, C.ink, 0.42) }, s + 50);
    scopeIso(ctx, f, rr, 'L', 0.12, 0.88, 0.8, 1.14, s + 51);
    faceLeds(ctx, f, rr, 'L', 0.66, 0.16, 0.84, 4, [C.led, C.ledGreen, C.ledWarm], 1.5);
    faceGrille(ctx, f, rr, 'L', 0.14, 0.86, SZ + 0.06, 0.54, s + 52, 3);
    for (const z of [0.55, 0.78, 1.01]) faceLeds(ctx, f, rr, 'R', z, 0.08, 0.45, 5, [C.led, C.ledGreen, C.led], 1.3);
    faceGrille(ctx, f, rr, 'R', 0.58, 0.92, 0.45, 1.1, s + 53, 4);
  });
  // The cable looms: from the rack's flank to the vibration table and to the dynamometer's plate.
  sc.add(f.depth(1.3, 1.0) + 2, () => {
    const loom = (a: V3, b: V3, col: string, k: number): void => cable(ctx, f.p(...a), f.p(...b), 2.2, 0.16, col, s + 60 + k);
    loom([1.44, 1.3, 0.95], [1.18, 1.4, 0.7], C.teal, 0);
    loom([1.44, 1.42, 0.85], [1.18, 1.52, 0.66], C.steelDD, 1);
    loom([1.6, 1.02, 1.0], [1.6, 0.8, 0.72], C.coral, 2);
    loom([1.5, 0.8, 0.7], [1.42, 0.5, 1.6], C.coral, 3);
    loom([1.55, 0.7, 0.66], [1.42, 0.5, 1.25], C.steelDD, 4);
  });
  sc.run();
}

/**
 * A data collector's rig: a geared turntable carrying a yoke and a tilted phased-array panel,
 * screen-fixed (like the Heart's uplink): turned to the camera and a little to the left, so its
 * rows of elements run level across the screen whatever the rotation.
 */
function arrayTurntable(ctx: Ctx, f: IsoFrame, x: number, y: number, r: number, z0: number, panel: { z: number; w: number; h: number; cols: number; rows: number; tilt: number }, s: number): void {
  cylinder(ctx, f, x, y, r, z0, z0 + 0.22, C.steelD, s, { top: C.steel });
  gearTeeth(ctx, f, x, y, r, z0 + 0.22, Math.round(r * 44), s + 1);
  cylinder(ctx, f, x, y, r * 0.4, z0 + 0.22, z0 + 0.55, C.steelL, s + 2, { top: C.brass });
  const n = leanTo(f, 0.35, 0.94, panel.tilt);
  const zt = panel.z / 2;
  pipeIso(ctx, f, [[x, y, z0 + 0.5], [x - n[0] * 0.2, y - n[1] * 0.2, (zt - n[2] * 0.2) * 2]], 6, C.steelD, s + 3, false);
  arrayPanel(ctx, f, [x, y, panel.z], panel.w, panel.h, n, panel.cols, panel.rows, s + 4);
}

/** The cartridge stacker by a collector's outlet: a hazard-edged bin, a stack of fresh files on it. */
function stackerIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, n: number, s: number): void {
  const rr = box(ctx, f, x0, y0, x1, y1, SZ, 0.58, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s);
  faceHazard(ctx, f, rr, 'L', 0.05, 0.95, SZ + 0.04, SZ + 0.13, s + 1);
  faceLeds(ctx, f, rr, 'R', 0.46, 0.3, 0.7, 2, [C.led, C.ledGreen], 1.5);
  cartStackIso(ctx, f, (x0 + x1) / 2, (y0 + y1) / 2, 0.58, n, s + 2);
}

/**
 * The supercomputer's core (4×4): three stepped tiers of violet cabinets, their seams leaking
 * cyan light, LED strips and dot rows on every face; on top a glazed crown round the glowing core.
 */
function superCore(ctx: Ctx, f: IsoFrame, s: number): void {
  const tiers: ReadonlyArray<readonly [number, number, number]> = [[0.95, SZ, 1.65], [1.25, 1.65, 2.75], [1.58, 2.75, 3.6]];
  for (const [i, [k, z0, z1]] of tiers.entries()) {
    const col = mix(C.violet, '#ffffff', 0.06 * i);
    const rr = box(ctx, f, k, k, 4 - k, 4 - k, z0, z1, { top: mix(col, C.steelD, 0.4), left: col, right: mix(col, C.ink, 0.42) }, s + i * 10, { outline: 2.2 });
    for (const face of ['L', 'R'] as const) {
      const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1], n = Math.round(len / 0.5);
      for (let j = 1; j < n; j++) {
        const u = j / n;
        ink(ctx, [facePt(f, rr, face, u, z0 + 0.06), facePt(f, rr, face, u, z1 - 0.06)], { w: 4, color: C.led, alpha: 0.25, shade: false, taper: 0, jitter: 0, seed: s + i * 10 + j });
        ink(ctx, [facePt(f, rr, face, u, z0 + 0.06), facePt(f, rr, face, u, z1 - 0.06)], { w: 1.4, color: C.led, shade: false, taper: 0, jitter: 0, seed: s + i * 10 + j + 5 });
      }
      for (let j = 0; j < n; j++) dotRows(ctx, f, rr, face, (j + 0.15) / n, (j + 0.85) / n, z0 + 0.22, z1 - 0.32, s + 100 + i * 20 + j + (face === 'L' ? 0 : 9), 0.13);
      faceLeds(ctx, f, rr, face, z1 - 0.14, 0.08, 0.92, Math.max(3, n * 2), face === 'L' ? [C.ledGreen, C.led] : [C.led], 1.5);
    }
  }
  glassCase(ctx, f, 1.66, 1.66, 2.34, 2.34, 3.6, 4.2, s + 40, () => sampleIso(ctx, f, 2, 2, 3.6, s + 41, 0.15));
  pipeIso(ctx, f, [[2.3, 2.3, 4.2], [2.3, 2.3, 4.55]], 2.2, C.steelD, s + 42, false);
  light(ctx, ...f.p(2.3, 2.3, 4.6), 2.2, C.ledRed);
}

/** A radiator tower (supercomputer, chillers): a finned steel box, a fan on top, cyan coolant pipe stubs. */
function radiatorIso(ctx: Ctx, f: IsoFrame, x0: number, y0: number, x1: number, y1: number, z1: number, s: number): RRect {
  const rr = box(ctx, f, x0, y0, x1, y1, SZ, z1, { top: C.steelD, left: C.steelL, right: mix(C.steel, C.ink, 0.3) }, s, { outline: 2 });
  fins(ctx, f, rr, 'L', SZ + 0.15, z1 - 0.18, 7, s + 1);
  fins(ctx, f, rr, 'R', SZ + 0.15, z1 - 0.18, 7, s + 2);
  bandIso(ctx, f, rr, z1 - 0.14, z1 - 0.05, C.teal, s + 3);
  fanIso(ctx, f, (x0 + x1) / 2, (y0 + y1) / 2, z1, Math.min(x1 - x0, y1 - y0) * 0.36, s + 4);
  return rr;
}

// ── the second-tier machines: upgrades of the first ones, and the new trades ──────────────────
// An upgrade keeps its base machine's look and says it is bigger or faster at a glance: twin
// heads, a coral band, heavier frames, more of what made the base one (D21: machines only).

/** The codices' dark covers (the item's colour). */
export const COVER = '#3a3550';

/** A coil spring standing at local (x, y) from z0 to z1: a brass zigzag, screen-level (a screen deck's mount). */
function springIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z0: number, z1: number, s: number): void {
  const b = f.p(x, y, z0), t = f.p(x, y, z1), n = 8;
  const pts: Pt[] = Array.from({ length: n * 2 + 1 }, (_, i) => [b[0] + (i % 2 ? 4.5 : -4.5) * (i === 0 || i === n * 2 ? 0 : 1), b[1] + ((t[1] - b[1]) * i) / (n * 2)] as Pt);
  ink(ctx, pts, { w: 3.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s });
  ink(ctx, pts, { w: 1.8, color: C.brassL, shade: false, taper: 0, jitter: 0, seed: s + 1 });
}

/** A heap at local (x, y) on the slab: radius r tiles, h levels high, grains stippled in, the shaded flank hatched. */
function heapIso(ctx: Ctx, f: IsoFrame, x: number, y: number, r: number, h: number, col: string, s: number, grain: string = C.inkSoft): void {
  const c = f.p(x, y, SZ), [ex, ey] = f.ell(r), hp = h * ILH;
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; pts.push([c[0] + Math.cos(a) * ex, c[1] + Math.sin(a) * ey]); }
  for (let i = 0; i <= 16; i++) { const a = Math.PI - (i / 16) * Math.PI; pts.push([c[0] + Math.cos(a) * ex * (1 - 0.12 * Math.sin(a)), c[1] - Math.pow(Math.sin(a), 0.75) * hp]); }
  castShadow(ctx, pts, 4 + h * 4, 0.25);
  flat(ctx, pts, col);
  ctx.save(); pathOf(ctx, pts); ctx.clip();
  const shade: Pt[] = [[c[0] + ex * 0.12, c[1] - hp - 4], [c[0] + ex + 4, c[1] - hp - 4], [c[0] + ex + 4, c[1] + ey + 4], [c[0] - ex * 0.2, c[1] + ey + 4]];
  flat(ctx, shade, mix(col, C.ink, 0.28));
  hatch(ctx, shade, Math.PI / 3, 3, { alpha: 0.3, seed: s });
  stipple(ctx, c[0] - ex, c[1] - hp, ex * 2, hp + ey, Math.round(ex * 1.4), { color: grain, alpha: 0.55, seed: s + 1, r: 1 });
  ctx.restore();
  ink(ctx, pts, { closed: true, w: 1.5, seed: s + 2 });
}

/** A glass lens lying at local (x, y) on a surface at z, radius r tiles: a domed pale disc, a cyan rim, sheen arcs. */
function lensIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, r: number, s: number): void {
  const GL = mix(C.ice, C.cyan, 0.22);
  latheIso(ctx, f, x, y, [[z, r], [z + 0.05, r], [z + 0.13, r * 0.84], [z + 0.2, r * 0.56], [z + 0.24, r * 0.18]], GL, s, { top: mix(GL, '#ffffff', 0.4), seams: false, outline: 1.6 });
  const b = f.p(x, y, z + 0.05), [bx, by] = f.ell(r);
  ink(ctx, ellipsePts(b[0], b[1], bx, by, s + 1, 0, 40).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 2.2, color: C.cyan, shade: false, taper: 0, seed: s + 2 });
  const c = f.p(x, y, z + 0.16), [ex, ey] = f.ell(r * 0.62);
  ink(ctx, ellipsePts(c[0] - ex * 0.1, c[1] - ey * 0.1, ex, ey, s + 3, 0, 40).filter(([px, py]) => px < c[0] - ex * 0.15 && py < c[1] + ey * 0.2), { w: 2.2, color: '#ffffff', alpha: 0.85, shade: false, taper: 0.4, seed: s + 4 });
  flat(ctx, ellipsePts(c[0] + ex * 0.3, c[1] - ey * 0.5, 2.4, 1.4, s + 5, 0, 10, -0.4), '#ffffff', 0.9);
}

/** A stack of n bound codices at local (x, y) from z: dark covers with brass corners, page edges on the lit side. */
function codexStackIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z: number, n: number, s: number): void {
  for (let i = 0; i < n; i++) {
    const zz = z + i * 0.13, d = ((((i * 29 + s) % 5) + 5) % 5 - 2) * 0.014;
    const rr = box(ctx, f, x - 0.19 + d, y - 0.14 - d, x + 0.19 + d, y + 0.14 - d, zz, zz + 0.12, { top: COVER, left: mix(C.paper, C.paperD, 0.5), right: mix(COVER, C.ink, 0.25) }, s + i, { outline: 1.2, shadow: i === 0 });
    ink(ctx, [facePt(f, rr, 'L', 0.04, zz + 0.06), facePt(f, rr, 'L', 0.96, zz + 0.06)], { w: 0.8, color: C.peachD, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 10 + i });
    for (const z of [zz + 0.025, zz + 0.095]) ink(ctx, [facePt(f, rr, 'L', 0, z), facePt(f, rr, 'L', 1, z)], { w: 1.4, color: COVER, shade: false, taper: 0, jitter: 0, seed: s + 20 + i });
    for (const u of [0.25, 0.75]) ink(ctx, [facePt(f, rr, 'R', u, zz + 0.01), facePt(f, rr, 'R', u, zz + 0.11)], { w: 1.4, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 30 + i });
    const [a0, b0, a1, b1] = rr, zt = zz + 0.12, k = 0.08;
    for (const [ca, cb, sa, sb] of [[a0, b0, 1, 1], [a1, b0, -1, 1], [a1, b1, -1, -1], [a0, b1, 1, -1]] as const) {
      flat(ctx, [f.pr(ca, cb, zt), f.pr(ca + sa * k, cb, zt), f.pr(ca, cb + sb * k, zt)], C.brass);
    }
    const m = f.pr((a0 + a1) / 2, (b0 + b1) / 2, zt);
    flat(ctx, ellipsePts(m[0], m[1], 3.2, 1.8, s + 40 + i, 0, 10), C.brassL);
  }
}

/** A rack of silicon wafers at local (x, y): two posts, a back, five wafers stacked on its slots. */
function waferRackIso(ctx: Ctx, f: IsoFrame, x: number, y: number, s: number): void {
  box(ctx, f, x - 0.2, y - 0.2, x + 0.2, y + 0.2, SZ, 0.42, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s, { outline: 1.4 });
  for (let i = 0; i < 5; i++) {
    const c = f.p(x, y, 0.5 + i * 0.13), [ex, ey] = f.ell(0.15);
    const w = ellipsePts(c[0], c[1], ex, ey, s + i, 0, 28);
    flat(ctx, w.map(([px, py]) => [px, py + 2] as Pt), C.steelD);
    shape(ctx, w, mix(C.ice, C.violetL, 0.3), { w: 1, shade: false, jitter: 0, seed: s + i });
    ink(ctx, [[c[0] - ex * 0.55, c[1] - ey * 0.1], [c[0] - ex * 0.05, c[1] - ey * 0.55]], { w: 1.3, color: '#ffffff', alpha: 0.8, shade: false, taper: 0.3, jitter: 0, seed: s + 10 + i });
  }
  const [px, py] = facingDir(f, -0.17, -0.17);
  pipeIso(ctx, f, [[x + px, y + py, 0.42], [x + px, y + py, 1.2]], 2.6, C.steelD, s + 20, false);
}

/**
 * A wire-drawing line on a bed (the wire mill's) along local y at x = cx: two spools, the die and
 * rollers, the wire between. Queued at ten times its depth, so two lines side by side are drawn
 * whole, the far one first.
 */
function spoolLine(ctx: Ctx, f: IsoFrame, sc: Scene, cx: number, bed: string, s: number): void {
  const key = f.depth(cx, 1) * 10;
  sc.add(key - 1, () => {
    const rr = box(ctx, f, cx - 0.38, 0.14, cx + 0.38, 1.86, SZ, 0.55, bed, s + 1);
    faceGrille(ctx, f, rr, 'L', 0.15, 0.85, SZ + 0.06, 0.48, s + 2, 2);
    faceLeds(ctx, f, rr, 'R', 0.43, 0.3, 0.7, 3, LEDS);
  });
  for (const [i, y] of [0.5, 1.5].entries()) sc.add(key + f.depth(cx, y) * 0.1, () => spoolIso(ctx, f, cx, y, 1.15, s + 10 * i));
  sc.add(key + f.depth(cx, 1.0) * 0.1, () => {
    box(ctx, f, cx - 0.2, 0.9, cx + 0.2, 1.1, 0.55, 0.82, C.steelD, s + 30, { outline: 1.6 });
    for (const z of [0.95, 1.13]) drumIso(ctx, f, cx, 1.0, z, 0.05, 0.2, 'x', C.steelL, s + 31 + z * 10, { shadow: false, hub: false });
    ink(ctx, [f.p(cx, 0.5, 1.6), f.p(cx, 1.0, 1.04), f.p(cx, 1.5, 1.55)], { w: 1.6, color: C.brassL, shade: false, taper: 0, seed: s + 33 });
  });
}

/**
 * The forging press (3×3): a heavier frame than the press — square violet columns on a
 * hazard-edged anvil block, a deep crown beam with twin cylinders, a ram with its die over a
 * glowing billet.
 */
function forgeFrame(ctx: Ctx, f: IsoFrame, sc: Scene, s: number): void {
  const x0 = 0.42, x1 = 2.58, cx = 1.5, cy = 1.5, y0 = 1.06, y1 = 1.94, zt = 3.0;
  sc.add(f.depth(cx, cy) - 0.02, () => {
    const rr = box(ctx, f, x0 + 0.2, y0, x1 - 0.2, y1, SZ, 0.9, C.steelL, s);
    faceHazard(ctx, f, rr, 'L', 0.03, 0.97, 0.74, 0.86, s + 1);
    faceHazard(ctx, f, rr, 'R', 0.03, 0.97, 0.74, 0.86, s + 2);
    box(ctx, f, cx - 0.4, cy - 0.24, cx + 0.4, cy + 0.24, 0.9, 1.0, { top: C.steelD }, s + 3, { outline: 1.4, shadow: false });
    const b = f.p(cx, cy, 1.15);
    flat(ctx, ellipsePts(b[0], b[1], 34, 18, s + 4, 0, 24), C.ledWarm, 0.22);
    box(ctx, f, cx - 0.28, cy - 0.16, cx + 0.28, cy + 0.16, 1.0, 1.28, { top: C.glowPeach, left: C.warn, right: mix(C.warn, C.coralD, 0.5) }, s + 5, { outline: 1.5, shadow: false });
    light(ctx, b[0], b[1] - 2, 3.4, C.ledWarm);
  });
  for (const [i, xa] of [x0, x1 - 0.42].entries()) {
    sc.add(f.depth(xa + 0.21, cy), () => {
      const rr = box(ctx, f, xa, cy - 0.3, xa + 0.42, cy + 0.3, SZ, zt, C.violet, s + 6 + i);
      for (const z of [1.2, 2.2]) bandIso(ctx, f, rr, z, z + 0.1, C.steelD, s + 8 + i);
      faceLeds(ctx, f, rr, 'L', zt - 0.35, 0.3, 0.7, 2, [C.ledWarm]);
    });
  }
  sc.add(f.depth(cx, cy) + 0.01, () => {
    for (const dx of [-0.32, 0.32]) cylinder(ctx, f, cx + dx, cy, 0.14, 1.9, zt, C.steelL, s + 10 + dx * 10);
    box(ctx, f, cx - 0.62, cy - 0.24, cx + 0.62, cy + 0.24, 1.55, 1.9, { top: C.steelD }, s + 12, { outline: 1.6 });
    box(ctx, f, cx - 0.32, cy - 0.17, cx + 0.32, cy + 0.17, 1.4, 1.55, { top: C.steel }, s + 13, { outline: 1.3, shadow: false });
  });
  sc.add(99, () => {
    const rr = box(ctx, f, x0 - 0.06, cy - 0.38, x1 + 0.06, cy + 0.38, zt, zt + 0.62, C.violet, s + 14);
    faceGrille(ctx, f, rr, 'L', 0.08, 0.3, zt + 0.1, zt + 0.5, s + 15, 3);
    faceHazard(ctx, f, rr, 'L', 0.36, 0.64, zt + 0.12, zt + 0.24, s + 16);
    faceLeds(ctx, f, rr, 'L', zt + 0.4, 0.7, 0.92, 3, LEDS);
    faceGrille(ctx, f, rr, 'R', 0.15, 0.85, zt + 0.1, zt + 0.5, s + 17, 3);
    for (const dx of [-0.32, 0.32]) cylinder(ctx, f, cx + dx, cy, 0.18, zt + 0.62, zt + 0.95, C.steelD, s + 18 + dx * 10, { top: C.brass });
    light(ctx, ...f.p(cx, cy, zt + 0.66), 2.2, C.ledWarm);
  });
}

/** Louvres round the camera-facing half of a vertical cylinder (a filter tower's intake band). */
function ringGrille(ctx: Ctx, f: IsoFrame, x: number, y: number, r: number, z0: number, z1: number, s: number): void {
  const half = (z: number): Pt[] => { const c = f.p(x, y, z), [ex, ey] = f.ell(r); return ellipsePts(c[0], c[1], ex, ey, s, 0, 40).filter(([, py]) => py >= c[1] - 0.5).sort((p, q) => p[0] - q[0]); };
  const lo = half(z0), hi = half(z1);
  shape(ctx, [...hi, ...lo.slice().reverse()], C.steelDD, { w: 1.2, shade: false, jitter: 0, seed: s });
  for (let z = z0 + 0.07; z < z1 - 0.03; z += 0.07) ink(ctx, half(z), { w: 1, color: C.steelL, alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: s + z * 100 });
}

/**
 * A store tank (the silo's, buildings `silo`) at local (cx, cy), radius r, its wall up to zw: a
 * banded ice cylinder, a catwalk rail round its top, a cone roof and its hatch, a ladder and a
 * glowing level gauge on the side turned to the camera.
 */
function siloTank(ctx: Ctx, f: IsoFrame, cx: number, cy: number, r: number, zw: number, s: number): void {
  const k = r / 0.78;
  const [lx, ly] = facingDir(f, -0.42, 0.91), [gx, gy] = facingDir(f, 0.6, 0.8);
  latheIso(ctx, f, cx, cy, [[SZ, r], [SZ + (zw - SZ) * 0.3, r], [SZ + (zw - SZ) * 0.55, r], [SZ + (zw - SZ) * 0.8, r], [zw, r], [zw, r + 0.06], [zw + 0.06, r + 0.06], [zw + 0.06, r - 0.02], [zw + 0.5 * k, 0.16 * k], [zw + 0.54 * k, 0.16 * k]], C.ice, s, { top: C.steelL });
  const gr = r + 0.01;
  ink(ctx, [f.p(cx + gx * gr, cy + gy * gr, 0.55), f.p(cx + gx * gr, cy + gy * gr, zw - 0.2)], { w: 4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  ink(ctx, [f.p(cx + gx * gr, cy + gy * gr, 0.6), f.p(cx + gx * gr, cy + gy * gr, SZ + (zw - SZ) * 0.65)], { w: 2.2, color: C.led, shade: false, taper: 0, jitter: 0, seed: s + 3 });
  ladderIso(ctx, f, cx + lx * (r + 0.02), cy + ly * (r + 0.02), -ly, lx, SZ, zw + 0.06, s + 4);
  const posts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2, x = cx + Math.cos(a) * (r + 0.06), y = cy + Math.sin(a) * (r + 0.06);
    if (f.depth(x, y) < f.depth(cx, cy)) continue;
    ink(ctx, [f.p(x, y, zw + 0.06), f.p(x, y, zw + 0.24)], { w: 1.2, color: C.steelD, shade: false, taper: 0, seed: s + 10 + i });
    posts.push(f.p(x, y, zw + 0.24));
  }
  ink(ctx, posts.sort((a, b) => a[0] - b[0]), { w: 1.4, color: C.steelD, shade: false, taper: 0, seed: s + 30 });
  box(ctx, f, cx - 0.08, cy - 0.08, cx + 0.08, cy + 0.08, zw + 0.5 * k - 0.02, zw + 0.5 * k + 0.1, { top: C.steelD }, s + 31, { outline: 1.2, shadow: false });
}

/**
 * A heliostat at local (x, y): a post and a small square mirror on a gimbal, tilted halfway
 * between the sky and the receiver at (tx, ty) — pale glass with a sheen streak seen from the
 * front, its steel back from behind.
 */
function heliostatIso(ctx: Ctx, f: IsoFrame, x: number, y: number, tx: number, ty: number, s: number): void {
  pipeIso(ctx, f, [[x, y, SZ], [x, y, 0.62]], 2.4, C.steelD, s, false);
  const dx = tx - x, dy = ty - y, L = Math.hypot(dx, dy) || 1;
  const n = norm3([(dx / L) * 0.4, (dy / L) * 0.4, 1]);
  const u = norm3([-n[1], n[0], 0]), v = cross3(n, u), zc = 0.75 / 2, h = 0.21;
  const P = (a: number, b: number): Pt => f.p(x + u[0] * a + v[0] * b, y + u[1] * a + v[1] * b, (zc + u[2] * a + v[2] * b) * 2);
  const q: Pt[] = [P(-h, -h), P(h, -h), P(h, h), P(-h, h)];
  const [nrx, nry] = turned(f, n[0], n[1]);
  castShadow(ctx, q, 6, 0.2);
  if (nrx + nry + n[2] <= 0) { shape(ctx, q, C.steel, { w: 1.4, shade: false, jitter: 0, seed: s + 1 }); return; }
  shape(ctx, q, C.steelD, { w: 1.4, shade: false, jitter: 0, seed: s + 1 });
  flat(ctx, [P(-h * 0.86, -h * 0.86), P(h * 0.86, -h * 0.86), P(h * 0.86, h * 0.86), P(-h * 0.86, h * 0.86)], mix(C.ice, C.cyan, 0.18));
  ink(ctx, [P(-h * 0.6, h * 0.2), P(h * 0.2, -h * 0.6)], { w: 2.2, color: '#ffffff', alpha: 0.75, shade: false, taper: 0.3, jitter: 0, seed: s + 2 });
  ink(ctx, [P(-h * 0.1, h * 0.7), P(h * 0.7, -h * 0.1)], { w: 1.2, color: '#ffffff', alpha: 0.55, shade: false, taper: 0.3, jitter: 0, seed: s + 3 });
}

/** A plotter table (local rect, top at z): a teal map with contour lines being drawn, a gantry pen over it. */
function plotterIso(ctx: Ctx, f: IsoFrame, sc: Scene, x0: number, y0: number, x1: number, y1: number, z: number, s: number): void {
  sc.add(f.depth((x0 + x1) / 2, (y0 + y1) / 2), () => {
    const rr = box(ctx, f, x0, y0, x1, y1, SZ, z, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s);
    faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.08, z - 0.1, s + 1, 2);
    const mx0 = x0 + 0.1, my0 = y0 + 0.1, mx1 = x1 - 0.1, my1 = y1 - 0.1;
    const map: Pt[] = [f.p(mx0, my0, z), f.p(mx1, my0, z), f.p(mx1, my1, z), f.p(mx0, my1, z)];
    shape(ctx, map, C.teal, { w: 1.2, shade: false, jitter: 0, seed: s + 2 });
    const cx = mx0 + (mx1 - mx0) * 0.42, cy = my0 + (my1 - my0) * 0.55;
    for (let k = 1; k <= 4; k++) {
      const pts: Pt[] = Array.from({ length: 33 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2, w = 1 + 0.18 * Math.sin(a * 3 + k);
        return f.p(cx + Math.cos(a) * (mx1 - mx0) * 0.11 * k * w, cy + Math.sin(a) * (my1 - my0) * 0.1 * k * w, z);
      });
      ctx.save(); pathOf(ctx, map); ctx.clip();
      ink(ctx, pts, { w: 1, color: k === 4 ? C.brassL : C.turqL, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 3 + k });
      ctx.restore();
    }
    ink(ctx, [f.p(mx0 + 0.1, my1 - 0.12, z), f.p(cx, cy + 0.15, z), f.p(mx1 - 0.15, my0 + 0.2, z)], { w: 1.2, color: C.coral, alpha: 0.9, shade: false, taper: 0, jitter: 0, seed: s + 9 });
  });
  const zg = z + 0.75, ym = (y0 + y1) / 2 + 0.12, px = x0 + (x1 - x0) * 0.62;
  sc.add(f.depth((x0 + x1) / 2, (y0 + y1) / 2) + 0.4, () => {
    for (const x of [x0 + 0.02, x1 - 0.02]) {
      pipeIso(ctx, f, [[x, y0 + 0.04, z], [x, y0 + 0.04, zg]], 2.4, C.steelD, s + 20 + x, false);
      pipeIso(ctx, f, [[x, y1 - 0.04, z], [x, y1 - 0.04, zg]], 2.4, C.steelD, s + 21 + x, false);
      pipeIso(ctx, f, [[x, y0, zg], [x, y1, zg]], 3.4, C.brass, s + 22 + x, false);
    }
    box(ctx, f, x0 - 0.04, ym - 0.06, x1 + 0.04, ym + 0.06, zg, zg + 0.1, { top: C.coral }, s + 24, { outline: 1.4, shadow: false });
    const hr = box(ctx, f, px - 0.08, ym - 0.1, px + 0.08, ym + 0.1, z + 0.32, zg + 0.16, { top: C.violetL, left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 25, { outline: 1.3, shadow: false });
    pipeIso(ctx, f, [[px, ym, z + 0.32], [px, ym, z + 0.04]], 1.8, C.coral, s + 26, false);
    light(ctx, ...facePt(f, hr, 'L', 0.5, zg), 1.4, C.led);
  });
}

// ── quartz (D87): the face cutter and the quartz workshop ─────────────────────────────────────

/** Mining ochre: the face cutter's housing (no other machine wears it), its faces. */
export const MINER = mix(C.hazard, C.peachD, 0.38);
const MINER_FACES: Faces = { top: mix(MINER, '#ffffff', 0.14), left: MINER, right: mix(MINER, C.ink, 0.42) };
/** The cutter drum's bright machined steel. */
const DRUM = mix(C.steelL, C.ice, 0.35);
/** Copper (the oscillators' leads, the workshop's wire spool). */
export const COPPER = '#d9844a';
/** The oscillators' tin cans (content colour of `oscillator`), their lit top. */
export const CAN = '#b9c3cc', CAN_L = mix('#b9c3cc', '#ffffff', 0.4);

/** The electric smelter (D106): its slab, its crucible's place and radius (local tiles), its ceramic, its cabinet's roof (levels). */
export const ES_SLAB = mix(C.steel, C.teal, 0.22);
export const ES_POT = { x: 0.72, y: 1.0, r: 0.47, coil: 1.3, top: 1.44 } as const;
export const ES_CERAMIC = mix(C.peachL, C.ice, 0.35);
export const ES_CAB_Z = 1.42;

/**
 * An electric arc between two screen points: a jagged line, seeded, its halo translucent and its
 * core in the cold light token (the night finds it). Drawn only while the machine works: callers
 * skip it when `isUnlit`.
 */
export function sparkIso(ctx: Ctx, a: Pt, b: Pt, n: number, s: number): void {
  const rng = makeRng(s);
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const pts: Pt[] = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n, k = (rng.next() - 0.5) * Math.min(9, len * 0.45);
    pts.push([a[0] + dx * t + nx * k, a[1] + dy * t + ny * k]);
  }
  pts.push(b);
  ink(ctx, pts, { w: 6, color: C.glowCyan, alpha: 0.3, shade: false, taper: 0.4, jitter: 0, seed: s });
  ink(ctx, pts, { w: 2, color: C.glowCyan, shade: false, taper: 0.3, jitter: 0, seed: s + 1 });
  ink(ctx, pts, { w: 0.8, color: '#ffffff', alpha: 0.9, shade: false, taper: 0.3, jitter: 0, seed: s + 2 });
}

/** A high-voltage sign on a face: a hazard-yellow triangle with an ink bolt. */
function hvSignIso(ctx: Ctx, f: IsoFrame, rr: RRect, face: Face, u: number, z: number, s: number): void {
  const du = 0.16, dz = 0.14;
  const tri = [facePt(f, rr, face, u, z + dz), facePt(f, rr, face, u + du, z - dz), facePt(f, rr, face, u - du, z - dz)];
  shape(ctx, tri, C.hazard, { w: 1.2, shade: false, jitter: 0, seed: s });
  ink(ctx, [facePt(f, rr, face, u + 0.02, z + dz * 0.55), facePt(f, rr, face, u - 0.04, z - dz * 0.05), facePt(f, rr, face, u + 0.04, z + dz * 0.05), facePt(f, rr, face, u - 0.02, z - dz * 0.7)], { w: 1.3, shade: false, taper: 0.2, jitter: 0, seed: s + 1 });
}
/** Quartz as a solid's faces (a bar, a blade): rock crystal's own tones (rock.ts `QZ`). */
const QZ_FACES: Faces = { top: QZ.lit, left: QZ.body, right: QZ.shade };

/** A few chips of cut quartz lying on a surface at height z round local (x, y) within ±(rx, ry): small white points, inked. */
function quartzChips(ctx: Ctx, f: IsoFrame, x: number, y: number, rx: number, ry: number, z: number, n: number, s: number): void {
  const rng = makeRng(s);
  const chips = Array.from({ length: n }, () => [x + rng.range(-1, 1) * rx, y + rng.range(-1, 1) * ry, rng.range(0, Math.PI * 2), rng.range(0.7, 1.15)] as const)
    .sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
  for (const [cx, cy, a, k] of chips) {
    const b = f.p(cx, cy, z), t = f.p(cx + Math.cos(a) * 0.09 * k, cy + Math.sin(a) * 0.09 * k, z + 0.14 * k);
    crystal(ctx, b, t, 2.6 * k, 1.1, true);
  }
}

/**
 * The face cutter's body (D87, `face_cutter`; the machine's side of `CUTTER.split`): a continuous
 * miner in miniature on a skid — two low crawler tracks, the gathering apron at its back heaped with
 * the quartz the drum brings down, a belt conveyor carrying it up the left to the chute over its
 * outlet (the port at the front-left), the ochre power house on the right with its amber beacon, a
 * floodlight turned on the face and the cutter motor at its back; the boom's pivots on the tracks.
 */
function cutterBody(ctx: Ctx, f: IsoFrame, s: number): void {
  const { split } = CUTTER;
  slab(ctx, f, C.steelD, 0.05, SZ, s, true, [0, 0, 2, split]);
  // The gathering apron: a low steel ramp across the back, its lip hazard-striped, heaped with quartz.
  const ap = box(ctx, f, 0.42, 1.18, 1.58, split - 0.02, SZ, 0.42, { top: C.steel, left: mix(C.steel, C.ink, 0.22), right: mix(C.steel, C.ink, 0.42) }, s + 1, { outline: 1.6, shadow: false });
  faceHazard(ctx, f, ap, 'L', 0.02, 0.98, SZ + 0.02, 0.4, s + 2);
  quartzChips(ctx, f, 1.12, 1.38, 0.34, 0.12, 0.42, 9, s + 3);
  const sc = new Scene();
  for (const [i, x] of [0.24, 1.76].entries()) {
    sc.add(f.depth(x, 0.82), () => crawler(ctx, f, x, 0.14, 1.52, s + 10 + i * 10, 0.16, 0.62));
    // The boom's pivot block on the track's rear, a brass pin through it.
    sc.add(f.depth(x, 1.42) + 0.01, () => {
      const pv = box(ctx, f, x - 0.15, 1.28, x + 0.15, split - 0.02, 0.62, 1.08, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 30 + i, { outline: 1.5 });
      rivet(ctx, ...facePt(f, pv, 'L', 0.5, 0.92), 2.6, C.brassL);
      rivet(ctx, ...facePt(f, pv, 'R', 0.5, 0.92), 2.6, C.brassL);
    });
  }
  // The conveyor: from the apron up the left to its head over the chute, quartz riding it.
  sc.add(f.depth(0.63, 0.8), () => {
    frustumIso(ctx, f, 0.31, 0.08, 0.71, 0.4, SZ, 0.8, -0.05, { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 40, { open: C.ink });
    const x0 = 0.47, x1 = 0.79, yb = 1.4, zb = 0.5, yf = 0.3, zf = 1.02;
    const P = (x: number, u: number, dz = 0): Pt => f.p(x, yb + (yf - yb) * u, zb + (zf - zb) * u + dz);
    for (const [i, u] of [0.45, 0.82].entries()) for (const x of [x0 + 0.03, x1 - 0.03]) pipeIso(ctx, f, [[x, yb + (yf - yb) * u, SZ], [x, yb + (yf - yb) * u, zb + (zf - zb) * u - 0.1]], 2.4, C.steelD, s + 41 + i, false);
    for (const x of [x0, x1]) flat(ctx, [P(x, 0), P(x, 1), P(x, 1, -0.12), P(x, 0, -0.12)], x === x1 ? mix(C.steel, C.ink, 0.4) : C.steel);
    flat(ctx, [P(x0, 1), P(x1, 1), P(x1, 1, -0.12), P(x0, 1, -0.12)], mix(C.steel, C.ink, 0.2));
    const belt: Pt[] = [P(x0, 0), P(x1, 0), P(x1, 1), P(x0, 1)];
    flat(ctx, belt, C.steelDD);
    for (let i = 1; i < 10; i++) ink(ctx, [P(x0 + 0.02, i / 10), P(x1 - 0.02, i / 10)], { w: 0.9, color: C.steel, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 44 + i });
    const rng = makeRng(s + 55);
    for (let k = 0; k < 6; k++) {
      const u = 0.08 + k * 0.15 + rng.range(-0.03, 0.03), x = x0 + 0.08 + rng.next() * (x1 - x0 - 0.16);
      const b = P(x, u, 0.01), t = P(x + rng.range(-0.06, 0.06), u + 0.08, 0.1);
      crystal(ctx, b, t, 2.6, 1.1, true);
    }
    ink(ctx, belt, { closed: true, w: 1.4, seed: s + 56 });
    for (const x of [x0, x1]) ink(ctx, [P(x, 0, 0.03), P(x, 1, 0.03)], { w: 2.6, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 57 });
    drumIso(ctx, f, (x0 + x1) / 2, yf, zf - 0.07, 0.07, 0.18, 'x', C.steelL, s + 58, { shadow: false });
  });
  // The power house: ochre, a grille and LEDs, a hazard band at its foot, the amber beacon, the
  // floodlight on its back edge turned on the face, the cutter motor behind it.
  sc.add(f.depth(1.25, 0.66), () => {
    const rr = box(ctx, f, 0.9, 0.2, 1.6, 1.1, SZ, 1.1, MINER_FACES, s + 60);
    faceGrille(ctx, f, rr, 'L', 0.1, 0.5, SZ + 0.2, 0.86, s + 61, 4);
    faceLeds(ctx, f, rr, 'L', 0.96, 0.6, 0.9, 3, [C.ledWarm, C.led, C.ledGreen], 1.7);
    faceHazard(ctx, f, rr, 'L', 0.03, 0.97, SZ + 0.03, SZ + 0.13, s + 62);
    faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.2, 0.86, s + 63, 4);
    faceHazard(ctx, f, rr, 'R', 0.03, 0.97, SZ + 0.03, SZ + 0.13, s + 64);
    beaconIso(ctx, f, 1.08, 0.4, 1.1, 1.36, C.ledWarm, s + 65);
    const lamp = box(ctx, f, 1.02, 0.96, 1.48, 1.08, 1.1, 1.22, { top: C.steelD }, s + 66, { outline: 1.2, shadow: false });
    for (const u of [0.3, 0.7]) light(ctx, ...facePt(f, lamp, 'L', u, 1.16), 1.9, C.led);
  });
  sc.add(f.depth(1.25, 1.22), () => drumIso(ctx, f, 1.25, 1.22, 0.86, 0.12, 0.26, 'x', C.steelL, s + 70, { bands: [-0.5, 0.5] }));
  sc.run();
}

/**
 * The face cutter's drum at phase t of its period (a sixth of a turn, moving.ts `CUTTER`): the
 * spoil at the foot of the face (quartz chips and rock rubble), the boom's two coral arms from
 * their pivots down to its ends, and the drum across the back — steel, its helical flights wound
 * round it, a pick on each every sixth of its length: the picks behind it first (their tips show
 * over its rim), the near ones over it, so it reads turning into the rock.
 */
function cutterDrum(ctx: Ctx, f: IsoFrame, s: number, t: number): void {
  const { cx, cy, cz, r, half, starts, picks, twist, pick, split } = CUTTER;
  // The spoil: rubble and quartz chips on the ground under the drum (static: the same every phase).
  const rng = makeRng(s + 5);
  for (let k = 0; k < 7; k++) {
    const p = f.p(cx + rng.range(-0.8, 0.8), cy + rng.range(-0.18, 0.12), 0);
    shape(ctx, ellipsePts(p[0], p[1] - 2, rng.range(5, 9), rng.range(3, 5), s + 10 + k, 0.2, 12), k % 2 ? mix(C.steel, C.peachD, 0.4) : mix(C.mesa, C.steelL, 0.3), { w: 1, shade: false, seed: s + 10 + k });
  }
  quartzChips(ctx, f, cx, cy - 0.05, 0.75, 0.14, 0, 8, s + 20);
  const phase = (t * 2 * Math.PI) / starts;
  const P = (u: number, a: number, rho: number = r): Pt => f.p(cx + u * half, cy + Math.cos(a) * rho, cz + Math.sin(a) * rho * 2);
  // Does the drum's surface at angle a face the camera? (Its normal's rotated depth gain plus its rise.)
  const [r0x, r0y] = f.r(cx, cy), [r1x, r1y] = f.r(cx, cy + 1);
  const gain = r1x - r0x + (r1y - r0y);
  const vis = (a: number): boolean => Math.cos(a) * gain + Math.sin(a) > 0;
  const arm = (k: number): void => pipeIso(ctx, f, [[cx + k * 0.76, split + 0.01, 1.0], [cx + k * (half + 0.05), cy, cz]], 6, C.coral, s + 30 + k);
  const [farArm, nearArm] = [-1, 1].sort((a, b) => f.depth(cx + a, cy) - f.depth(cx + b, cy)) as [number, number];
  const all: Array<{ u: number; a: number }> = [];
  for (let k = 0; k < starts; k++) for (let j = 0; j < picks; j++) {
    const u = -0.9 + (1.8 * j) / (picks - 1);
    all.push({ u, a: phase + (k * 2 * Math.PI) / starts + u * twist });
  }
  const pickAt = ({ u, a }: { u: number; a: number }, i: number): void => {
    const b = P(u, a, r * 0.96), m = P(u, a + 0.1, r + pick * 0.5), e = P(u, a + 0.2, r + pick);
    ink(ctx, [b, m], { w: 5, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 40 + i });
    ink(ctx, [m, e], { w: 3.2, color: C.brassL, shade: false, taper: 0.4, jitter: 0, seed: s + 41 + i });
  };
  arm(farArm);
  for (const [i, p] of all.entries()) if (!vis(p.a)) pickAt(p, i);
  drumIso(ctx, f, cx, cy, cz, r, half, 'x', DRUM, s + 50, { end: mix(DRUM, C.ink, 0.25) });
  // The flights: the near half of each helix, inked.
  for (let k = 0; k < starts; k++) {
    let run: Pt[] = [];
    // A raised vane: dark on its trailing side, a bright lip on its leading one.
    let lip: Pt[] = [];
    const flush = (): void => {
      if (run.length > 1) {
        ink(ctx, run, { w: 2.6, color: C.steelDD, shade: false, taper: 0.1, jitter: 0, seed: s + 60 + k });
        ink(ctx, lip, { w: 1.1, color: mix(DRUM, '#ffffff', 0.55), shade: false, taper: 0.2, jitter: 0, seed: s + 70 + k });
      }
      run = [];
      lip = [];
    };
    for (let q = 0; q <= 24; q++) {
      const u = -0.97 + (1.94 * q) / 24, a = phase + (k * 2 * Math.PI) / starts + u * twist;
      if (vis(a)) { run.push(P(u, a, r * 1.01)); lip.push(P(u - 0.025, a - 0.04, r * 1.02)); } else flush();
    }
    flush();
  }
  for (const [i, p] of all.entries()) if (vis(p.a)) pickAt(p, i);
  arm(nearArm);
}

/**
 * The quartz workshop (D87, `quartz_workshop`): it cuts quartz into blades and mounts each on two
 * copper wires. Over its two intakes at the back, the saw bench — a quartz bar clamped on a coolant
 * tray, a diamond saw coming down through it under a coral guard, the cut blades standing in a
 * rack — and the winding spindle — a copper-wire spool paying out to a little lathe that mounts the
 * leads on a blade. At the front, the lapping wheel (a brass plate under its pressure arm, blanks
 * on it) and the tray of finished oscillators by the outlet; the control cabinet down the right.
 */
function quartzWorkshopIso(ctx: Ctx, f: IsoFrame, s: number): void {
  slab(ctx, f, C.steel, 0.05, SZ, s);
  const BENCH = mix(C.violet, C.steel, 0.45);
  const benchFaces: Faces = { top: C.steelD, left: BENCH, right: mix(BENCH, C.ink, 0.4) };
  const sc = new Scene();
  // The saw bench.
  sc.add(f.depth(0.52, 1.46), () => {
    const bench = box(ctx, f, 0.12, 1.08, 0.92, 1.86, SZ, 0.7, benchFaces, s + 1);
    faceGrille(ctx, f, bench, 'L', 0.1, 0.45, SZ + 0.1, 0.6, s + 2, 3);
    faceLeds(ctx, f, bench, 'L', 0.5, 0.6, 0.9, 3, [C.led, C.ledGreen, C.led], 1.5);
    flat(ctx, [f.p(0.18, 1.14, 0.7), f.p(0.86, 1.14, 0.7), f.p(0.86, 1.8, 0.7), f.p(0.18, 1.8, 0.7)], mix(C.teal, C.ink, 0.5));
    box(ctx, f, 0.2, 1.34, 0.6, 1.5, 0.7, 0.84, QZ_FACES, s + 3, { outline: 1.3, shadow: false });
    for (let i = 0; i < 4; i++) {
      const x = 0.68 + i * 0.045;
      box(ctx, f, x, 1.3, x + 0.025, 1.54, 0.7, 0.86, QZ_FACES, s + 4 + i, { outline: 1, shadow: false });
    }
    wheelIso(ctx, f, 0.42, 1.42, 1.18, 0.24, 'x', 34, mix(C.steelL, C.ice, 0.45), s + 10);
    pipeIso(ctx, f, [[0.36, 1.42, 1.18], [0.2, 1.42, 1.18]], 3, C.steelD, s + 11, false);
    const mot = box(ctx, f, 0.12, 1.28, 0.22, 1.56, 0.7, 1.34, { top: C.steelD, left: C.teal, right: mix(C.teal, C.ink, 0.4) }, s + 12, { outline: 1.3, shadow: false });
    faceLeds(ctx, f, mot, 'L', 1.18, 0.5, 0.5, 1, [C.ledGreen], 1.4);
    const guard = box(ctx, f, 0.35, 1.14, 0.49, 1.7, 1.54, 1.7, { top: C.coral }, s + 13, { outline: 1.4, shadow: false });
    light(ctx, ...facePt(f, guard, 'L', 0.5, 1.62), 1.8, C.ledWarm);
  });
  // The winding spindle: a lower bench, the copper spool, the headstock and its chuck holding a blade.
  sc.add(f.depth(1.48, 1.46), () => {
    const bench = box(ctx, f, 1.1, 1.08, 1.86, 1.86, SZ, 0.6, benchFaces, s + 20);
    faceGrille(ctx, f, bench, 'L', 0.55, 0.9, SZ + 0.08, 0.52, s + 21, 3);
    const parts = [1.2, 1.32, 1.44].sort((a, b) => f.depth(a, 1.62) - f.depth(b, 1.62));
    for (const x of parts) {
      if (x === 1.32) drumIso(ctx, f, x, 1.62, 0.84, 0.13, 0.1, 'x', COPPER, s + 22, { bands: [-0.5, 0, 0.5], shadow: false });
      else drumIso(ctx, f, x, 1.62, 0.84, 0.2, 0.02, 'x', C.steelL, s + 23 + x * 10, { shadow: false });
    }
    const hs = box(ctx, f, 1.56, 1.18, 1.82, 1.46, 0.6, 1.0, { top: C.steelD, left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 26, { outline: 1.4 });
    faceLeds(ctx, f, hs, 'L', 0.88, 0.25, 0.75, 2, [C.led, C.ledWarm], 1.4);
    drumIso(ctx, f, 1.48, 1.32, 0.82, 0.07, 0.08, 'x', C.steelL, s + 27, { shadow: false });
    box(ctx, f, 1.3, 1.29, 1.4, 1.35, 0.74, 0.9, QZ_FACES, s + 28, { outline: 1, shadow: false });
    ink(ctx, [f.p(1.32, 1.5, 0.98), f.p(1.36, 1.32, 0.86)], { w: 1.4, color: COPPER, shade: false, taper: 0, jitter: 0, seed: s + 29 });
  });
  // The lapping wheel and its pressure arm from the cabinet.
  sc.add(f.depth(1.28, 0.55), () => {
    cylinder(ctx, f, 1.28, 0.55, 0.3, SZ, 0.52, C.steelD, s + 30, { top: C.steel });
    cylinder(ctx, f, 1.28, 0.55, 0.26, 0.52, 0.6, C.brass, s + 31, { top: C.brassL });
    const c = f.p(1.28, 0.55, 0.6);
    for (const k of [0.45, 0.72]) { const [ex, ey] = f.ell(0.26 * k); ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 32 + k * 10, 0, 32), { closed: true, w: 0.8, color: C.brass, alpha: 0.9, shade: false, jitter: 0, seed: s + 33 }); }
    for (const [i, a] of [0.5, 2.6, 4.4].entries()) {
      const x = 1.28 + Math.cos(a) * 0.15, y = 0.55 + Math.sin(a) * 0.15;
      box(ctx, f, x - 0.045, y - 0.03, x + 0.045, y + 0.03, 0.6, 0.65, QZ_FACES, s + 34 + i, { outline: 0.9, shadow: false });
    }
    pipeIso(ctx, f, [[1.66, 0.55, 0.98], [1.28, 0.55, 0.98], [1.28, 0.55, 0.78]], 3.2, C.steelL, s + 38, false);
    cylinder(ctx, f, 1.28, 0.55, 0.06, 0.62, 0.78, C.steelD, s + 39, { top: C.steel });
  });
  // The tray of finished oscillators by the outlet: rows of tin cans.
  sc.add(f.depth(0.49, 0.48), () => {
    box(ctx, f, 0.14, 0.16, 0.84, 0.8, SZ, 0.46, { top: C.steelDD, left: C.steelL, right: mix(C.steelL, C.ink, 0.4) }, s + 40, { outline: 1.6 });
    const cans: Array<[number, number]> = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) cans.push([0.24 + i * 0.165, 0.27 + j * 0.2]);
    cans.sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
    for (const [i, [x, y]] of cans.entries()) cylinder(ctx, f, x, y, 0.05, 0.46, 0.6, CAN, s + 41 + i, { top: CAN_L });
  });
  sc.add(f.depth(1.78, 0.54), () => cabinetIso(ctx, f, 1.66, 0.12, 1.9, 0.95, 1.2, mix(C.steel, C.violet, 0.3), s + 60, 2));
  sc.run();
}

// ── the deep bore (moving.ts `BORE`) ─────────────────────────────────────────

/** What the deep bore brings up from far below the sand: violet heartrock spoil. */
export const SPOIL = mix(C.rock3, C.dug, 0.3);
/** Its footings and collar: pale cast concrete. */
const CONCRETE = TOWER;

/**
 * The bore's derrick leg nearest the viewer in this rotation (0 NW, 1 NE, 2 SE, 3 SW): it stands
 * in front of the kelly, so the moving part draws it, over the table and the kelly.
 */
export function boreNearLeg(f: IsoFrame): number {
  let best = 0, d = -Infinity;
  for (let k = 0; k < 4; k++) {
    const [x, y] = boreLeg(k, 0), e = f.depth(x, y);
    if (e > d) { d = e; best = k; }
  }
  return best;
}

/** One leg of the bore's derrick: a heavy steel tube from its footing up to the crown. */
function boreLegIso(ctx: Ctx, f: IsoFrame, k: number, s: number): void {
  pipeIso(ctx, f, [boreLeg(k, BORE.foot), boreLeg(k, BORE.top)], 4.4, C.steel, s + 300 + k * 3, false);
}

/**
 * A straight rod between two canvas points, plainly stroked — an ink edge under its colour, round
 * ends — for lattice bars by the hundred (the deep bore's derrick), where ink's ribbons would
 * cost the atlas's bake for no visible wobble.
 */
export function rod(ctx: Ctx, a: Pt, b: Pt, w: number, col: string): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = C.ink; ctx.lineWidth = w + 2; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  ctx.restore();
}

/** One face of the derrick, between legs k and k + 1: X-braces in every bay above the open portal, coral girts. */
function boreFaceIso(ctx: Ctx, f: IsoFrame, k: number): void {
  const j = (k + 1) % 4, zs = [...BORE.girts, BORE.top];
  const bar = (a: V3, b: V3, w: number, col: string): void => rod(ctx, f.p(...a), f.p(...b), w, col);
  for (let i = 0; i + 1 < zs.length; i++) {
    bar(boreLeg(k, zs[i]!), boreLeg(j, zs[i + 1]!), 1.1, C.steelL);
    bar(boreLeg(j, zs[i]!), boreLeg(k, zs[i + 1]!), 1.1, C.steelL);
  }
  for (const z of BORE.girts) bar(boreLeg(k, z), boreLeg(j, z), 2.6, C.coral);
}

/** A heap of spoil on the ground at local (x, y): radius r tiles, h levels high, lumps of deep rock on its flanks. */
function spoilIso(ctx: Ctx, f: IsoFrame, x: number, y: number, r: number, h: number, s: number): void {
  const c = f.p(x, y, 0), [ex, ey] = f.ell(r), hp = h * ILH, rng = makeRng(s);
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; pts.push([c[0] + Math.cos(a) * ex, c[1] + Math.sin(a) * ey]); }
  for (let i = 1; i < 16; i++) {
    const a = Math.PI - (i / 16) * Math.PI, k = 1 + rng.range(-0.1, 0.1);
    pts.push([c[0] + Math.cos(a) * ex * (1 - 0.1 * Math.sin(a)), c[1] + Math.cos(a) * ey * 0.15 - Math.pow(Math.sin(a), 0.8) * hp * k]);
  }
  castShadow(ctx, pts, 4 + h * 4, 0.25);
  flat(ctx, pts, SPOIL);
  ctx.save(); pathOf(ctx, pts); ctx.clip();
  const shade: Pt[] = [[c[0] + ex * 0.1, c[1] - hp - 4], [c[0] + ex + 4, c[1] - hp - 4], [c[0] + ex + 4, c[1] + ey + 4], [c[0] - ex * 0.25, c[1] + ey + 4]];
  flat(ctx, shade, mix(SPOIL, C.ink, 0.3));
  hatch(ctx, shade, Math.PI / 3, 3, { alpha: 0.3, seed: s + 1 });
  stipple(ctx, c[0] - ex, c[1] - hp, ex * 2, hp + ey, Math.round(ex * 1.2), { color: C.rock4, alpha: 0.7, seed: s + 2, r: 1 });
  ctx.restore();
  ink(ctx, pts, { closed: true, w: 1.5, seed: s + 3 });
  // Lumps of deep rock on its flanks, a few pale glints.
  for (let k = 0; k < 5; k++) {
    const u = rng.range(-0.7, 0.7), v = rng.range(0.25, 0.75);
    const lx = c[0] + u * ex, ly = c[1] - Math.pow(1 - Math.abs(u), 0.8) * hp * v + ey * 0.25, lr = rng.range(2.2, 3.6);
    const lump = ellipsePts(lx, ly, lr, lr * 0.8, s + 10 + k, 0.25, 7);
    shape(ctx, lump, mix(C.rock4, C.ink, 0.15), { w: 1, shade: false, jitter: 0, seed: s + 10 + k });
    flat(ctx, ellipsePts(lx - lr * 0.35, ly - lr * 0.3, lr * 0.3, lr * 0.25, s + 20 + k, 0, 6), C.rock2);
  }
  for (let k = 0; k < 2; k++) flat(ctx, ellipsePts(c[0] + rng.range(-0.5, 0.5) * ex, c[1] - hp * rng.range(0.3, 0.7), 1.2, 1.2, s + 30 + k, 0, 6), C.paper);
}

/** The wellhead collar sunk in the ground: a concrete ring flush with the land, bolted, the dark mouth of the hole round the table. */
function boreCollarIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { cx, cy, collar, table } = BORE;
  cylinder(ctx, f, cx, cy, collar, 0, 0.08, CONCRETE, s, { top: mix(CONCRETE, '#ffffff', 0.3) });
  const c = f.p(cx, cy, 0.08), [ex, ey] = f.ell(table + 0.1), [bx, by] = f.ell(collar - 0.06);
  flat(ctx, ellipsePts(c[0], c[1], ex, ey, s + 1, 0, 32), C.steelDD);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3; rivet(ctx, c[0] + Math.cos(a) * bx, c[1] + Math.sin(a) * by, 1.6, C.steelD); }
  stipple(ctx, c[0] - bx, c[1] - by, bx * 2, by * 2, 14, { clip: ellipsePts(c[0], c[1], bx, by, s + 2, 0, 24), color: C.rock4, alpha: 0.6, seed: s + 3, r: 1.1 });
}

/** The racking board on the derrick's east face at `BORE.board`: a railed steel platform, two work lamps at its edge. */
function boreBoardIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const z = BORE.board, x0 = boreLeg(1, z)[0] - 0.02, x1 = x0 + 0.24, y0 = 1.3, y1 = 1.7;
  box(ctx, f, x0, y0, x1, y1, z - 0.06, z, { top: C.steelL, left: C.steel, right: C.steelD }, s, { outline: 1.4, shadow: false });
  const rail = (a: V3, b: V3, n: number): void => ink(ctx, [f.p(...a), f.p(...b)], { w: 1.3, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + n });
  rail([x0, y0, z + 0.24], [x1, y0, z + 0.24], 1); rail([x1, y0, z + 0.24], [x1, y1, z + 0.24], 2); rail([x1, y1, z + 0.24], [x0, y1, z + 0.24], 3);
  for (const [i, [x, y]] of ([[x1, y0], [x1, y1], [x0, y0], [x0, y1]] as const).entries()) rail([x, y, z], [x, y, z + 0.24], 5 + i);
  for (const y of [y0 + 0.05, y1 - 0.05]) {
    const p = f.p(x1 + 0.02, y, z + 0.3);
    ink(ctx, [[p[0] - 2.5, p[1] - 1], [p[0] + 2.5, p[1] + 1]], { w: 4.2, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 12 });
    light(ctx, p[0], p[1] + 1.6, 2.1, C.ledWarm);
  }
}

/** The crown: the coral crown block on the legs' heads, its sheave cluster, work lamps on the side legs' heads, the red beacon on top. */
function boreCrownIso(ctx: Ctx, f: IsoFrame, near: number, s: number): void {
  const { cx, cy, top, crown } = BORE, w = crown + 0.03;
  const rr = box(ctx, f, cx - w, cy - w, cx + w, cy + w, top - 0.04, top + 0.2, { top: C.steelD, left: C.coral, right: mix(C.coral, C.ink, 0.4) }, s, { outline: 1.8, shadow: false });
  faceHazard(ctx, f, rr, 'L', 0.06, 0.94, top + 0.02, top + 0.09, s + 1);
  drumIso(ctx, f, cx, cy, top + 0.4, 0.1, 0.14, 'y', C.brass, s + 2, { bands: [-0.45, 0, 0.45], shadow: false });
  for (const k of [(near + 1) % 4, (near + 3) % 4]) {
    const p = f.p(...boreLeg(k, top - 0.14));
    ink(ctx, [[p[0] - 3, p[1]], [p[0] + 3, p[1]]], { w: 4.4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 3 + k });
    light(ctx, p[0], p[1] + 2, 2.2, C.ledWarm);
  }
  beaconIso(ctx, f, cx, cy, top + 0.6, top + 0.86, C.ledRed, s + 8);
}

/**
 * The deep bore's body (`deep_bore`; its part is `boreTable`): a heavy rig over its own hole. A
 * tall steel derrick on four concrete footings — coral girts, X-braced bays over an open portal,
 * a racking board with work lamps on its east face, the coral crown block, its sheaves and a red
 * beacon on top — stands over the wellhead collar sunk in the ground, spoil from the deep heaped
 * round it between the legs; the hoisting lines run down from the crown to the travelling block.
 * Round it: the draw-works on the west (a teal motor house, the big brass drum whose drilling
 * line runs up to the crown), the coral power house on the south (where the wires come in), a
 * rack of drill pipe on the east, and at the front the outlet works on a skid: a belt up from the
 * collar to a splitter that tips the ore down two chutes into the hoppers over the two outlets.
 */
function boreBody(ctx: Ctx, f: IsoFrame, s: number): void {
  const { cx, cy, top, foot } = BORE;
  const near = boreNearLeg(f), far = (near + 2) % 4, dC = f.depth(cx, cy);
  const legD = (k: number): number => { const [x, y] = boreLeg(k, 0); return f.depth(x, y); };
  // Flat on the ground first: the outlet works' skid, the collar, the draw-works' and power house's skids.
  slab(ctx, f, C.steelD, 0.04, 0.14, s, true, [0, 0, 3, 0.54]);
  boreCollarIso(ctx, f, s + 10);
  box(ctx, f, 0.04, 0.8, 0.6, 2.2, 0, 0.12, { top: C.steelD }, s + 11, { outline: 1.4 });
  box(ctx, f, 0.74, 2.4, 2.06, 2.96, 0, 0.12, { top: C.steelD }, s + 12, { outline: 1.4 });
  const sc = new Scene();
  for (let k = 0; k < 4; k++) {
    const [x, y] = boreLeg(k, 0);
    sc.add(legD(k) - 0.02, () => box(ctx, f, x - 0.11, y - 0.11, x + 0.11, y + 0.11, 0, foot, { top: CONCRETE }, s + 20 + k, { outline: 1.4 }));
  }
  // Spoil heaped round the collar between the legs, two bigger heaps in the back corners.
  const heaps = [[0.95, 0.95, 0.24, 0.28], [2.05, 0.95, 0.24, 0.26], [2.05, 2.05, 0.25, 0.32], [0.95, 2.05, 0.24, 0.3], [2.66, 2.66, 0.27, 0.4], [0.36, 2.66, 0.25, 0.34]] as const;
  for (const [i, [x, y, r, h]] of heaps.entries()) sc.add(f.depth(x, y), () => spoilIso(ctx, f, x, y, r, h, s + 40 + i * 9));
  // The derrick: its far leg (behind the far heap), its two far faces, the table's housing on the
  // collar (its turning top is the part), the hoisting lines, the near faces and the two side legs.
  sc.add(legD(far) + 0.01, () => boreLegIso(ctx, f, far, s));
  sc.add(dC - 0.05, () => { for (const k of [far, (far + 3) % 4]) boreFaceIso(ctx, f, k); });
  sc.add(dC - 0.02, () => cylinder(ctx, f, cx, cy, BORE.table + 0.04, 0.04, BORE.t0, C.steelD, s + 80, { top: C.steel }));
  sc.add(dC, () => {
    for (const dx of [-0.06, -0.02, 0.02, 0.06]) rod(ctx, f.p(cx + dx, cy, top - 0.04), f.p(cx + dx * 0.7, cy, 4.08), 0.9, C.steelL);
  });
  // The drilling line from the draw-works drum to the crown's fast sheave: inside the derrick when the drum is behind it.
  sc.add(f.depth(0.32, 1.7) < dC ? dC - 0.01 : dC + 0.45, () => {
    rod(ctx, f.p(0.36, 1.7, 1.0), f.p(cx - 0.1, cy, top + 0.42), 1.1, C.steelL);
  });
  sc.add(dC + 0.3, () => {
    for (const k of [near, (near + 3) % 4]) boreFaceIso(ctx, f, k);
    for (const k of [(near + 1) % 4, (near + 3) % 4]) boreLegIso(ctx, f, k, s);
  });
  sc.add(f.depth(2.03, 1.5), () => boreBoardIso(ctx, f, s + 330));
  sc.add(dC + 0.6, () => boreCrownIso(ctx, f, near, s + 340));
  // The draw-works (W): the motor house, the drum between its two stands.
  sc.add(f.depth(0.32, 1.06), () => {
    const rr = box(ctx, f, 0.08, 0.84, 0.56, 1.28, 0.12, 1.05, C.teal, s + 360);
    faceGrille(ctx, f, rr, 'R', 0.12, 0.88, 0.24, 0.9, s + 361, 4);
    faceGrille(ctx, f, rr, 'L', 0.12, 0.5, 0.24, 0.8, s + 362, 3);
    faceLeds(ctx, f, rr, 'L', 0.92, 0.62, 0.88, 2, [C.ledGreen, C.led], 1.7);
  });
  for (const [i, y] of [1.33, 2.07].entries()) sc.add(f.depth(0.32, y), () => box(ctx, f, 0.14, y - 0.03, 0.5, y + 0.03, 0.12, 0.74, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 365 + i, { outline: 1.3, shadow: false }));
  sc.add(f.depth(0.32, 1.7), () => drumIso(ctx, f, 0.32, 1.7, 0.62, 0.2, 0.33, 'y', C.brass, s + 370, { bands: [-0.66, -0.33, 0, 0.33, 0.66] }));
  // The power house (S): coral, grilles and LEDs, a hazard band at its foot, a radiator fan on its roof.
  sc.add(f.depth(1.4, 2.68), () => {
    const rr = box(ctx, f, 0.8, 2.44, 2.0, 2.92, 0.12, 1.15, C.coral, s + 380);
    for (const face of ['L', 'R'] as const) {
      faceGrille(ctx, f, rr, face, 0.08, 0.42, 0.28, 0.98, s + 381, 4);
      faceLeds(ctx, f, rr, face, 1.0, 0.56, 0.9, 3, [C.ledWarm, C.led, C.ledGreen], 1.8);
      faceHazard(ctx, f, rr, face, 0.02, 0.98, 0.14, 0.23, s + 382);
    }
    fanIso(ctx, f, 1.5, 2.68, 1.15, 0.17, s + 383);
  });
  // The pipe rack (E): drill pipe on three trestles.
  sc.add(f.depth(2.68, 1.5) - 0.01, () => {
    for (const [i, y] of [0.95, 1.5, 2.05].sort((a, b) => f.depth(2.68, a) - f.depth(2.68, b)).entries()) {
      for (const x of [2.48, 2.88]) pipeIso(ctx, f, [[x, y, 0], [x, y, 0.42]], 3, C.steelD, s + 390 + i, false);
      ink(ctx, [f.p(2.44, y, 0.42), f.p(2.92, y, 0.42)], { w: 3.2, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 394 + i });
    }
  });
  sc.add(f.depth(2.68, 1.5), () => {
    const tubes = [[2.56, 0.5], [2.68, 0.5], [2.8, 0.5], [2.62, 0.62], [2.74, 0.62], [2.68, 0.74]] as const;
    for (const [i, [x, z]] of [...tubes].sort((a, b) => f.depth(a[0], 1.5) - f.depth(b[0], 1.5) || a[1] - b[1]).entries()) {
      drumIso(ctx, f, x, 1.5, z, 0.05, 0.62, 'y', i % 2 ? C.steelL : C.ice, s + 400 + i, { shadow: false, hub: false });
    }
  });
  // The outlet works (N): the belt up from the collar, the splitter, its chutes, the two hoppers.
  sc.add(f.depth(1.5, 0.75), () => boreBeltIso(ctx, f, s + 420));
  sc.add(f.depth(1.5, 0.32), () => {
    const rr = box(ctx, f, 1.2, 0.14, 1.8, 0.5, 0.14, 0.82, { top: C.steelD, left: C.steelL, right: mix(C.steelL, C.ink, 0.4) }, s + 430);
    faceHazard(ctx, f, rr, 'L', 0.04, 0.96, 0.62, 0.72, s + 431);
    faceHazard(ctx, f, rr, 'R', 0.04, 0.96, 0.62, 0.72, s + 432);
    faceLeds(ctx, f, rr, 'L', 0.4, 0.3, 0.7, 2, [C.ledGreen, C.ledWarm], 1.6);
    frustumIso(ctx, f, 1.26, 0.18, 1.74, 0.46, 0.82, 0.96, -0.04, { top: C.steel }, s + 433, { open: C.steelDD, shadow: false });
  });
  for (const [i, x] of [0.5, 2.5].entries()) {
    sc.add(f.depth(x, 0.33), () => {
      const mouth = frustumIso(ctx, f, x - 0.32, 0.14, x + 0.32, 0.52, 0.14, 0.6, -0.04, { top: C.steel }, s + 440 + i * 5, { open: C.steelDD });
      rubble(ctx, mouth, s + 442 + i * 5);
    });
    const xa = x < 1.5 ? 1.2 : 1.8, xb = x < 1.5 ? x + 0.26 : x - 0.26;
    sc.add(f.depth((xa + xb) / 2, 0.32) + 0.01, () => pipeIso(ctx, f, [[xa, 0.32, 0.74], [xb, 0.32, 0.62]], 7, C.steelL, s + 450 + i));
  }
  sc.run();
}

/** The belt from the collar's edge up to the splitter (along local y), ore riding it, on one trestle. */
function boreBeltIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const x0 = 1.37, x1 = 1.63, ya = 0.98, za = 0.12, yb = 0.48, zb = 0.92;
  const P = (x: number, u: number, dz = 0): Pt => f.p(x, ya + (yb - ya) * u, za + (zb - za) * u + dz);
  for (const x of [x0 + 0.04, x1 - 0.04]) { const y = ya + (yb - ya) * 0.55; pipeIso(ctx, f, [[x, y, 0], [x, y, za + (zb - za) * 0.55 - 0.08]], 2.6, C.steelD, s + x * 10, false); }
  for (const x of [x0, x1]) flat(ctx, [P(x, 0), P(x, 1), P(x, 1, -0.1), P(x, 0, -0.1)], x === x1 ? mix(C.steel, C.ink, 0.4) : C.steel);
  const belt: Pt[] = [P(x0, 0), P(x1, 0), P(x1, 1), P(x0, 1)];
  flat(ctx, belt, C.steelDD);
  for (let i = 1; i < 8; i++) ink(ctx, [P(x0 + 0.02, i / 8), P(x1 - 0.02, i / 8)], { w: 0.9, color: C.steel, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + i });
  for (const [i, u] of [0.18, 0.46, 0.74].entries()) {
    const [px, py] = P((x0 + x1) / 2 + (i - 1) * 0.04, u, 0.04);
    shape(ctx, ellipsePts(px, py - 1.5, 3.4, 2.6, s + 20 + i, 0.25, 8), C.dug, { w: 1, shade: false, jitter: 0, seed: s + 20 + i });
  }
  ink(ctx, belt, { closed: true, w: 1.4, seed: s + 30 });
  for (const x of [x0, x1]) ink(ctx, [P(x, 0, 0.03), P(x, 1, 0.03)], { w: 2.4, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 31 });
}

/**
 * The deep bore's moving part at phase t (a quarter turn, moving.ts `BORE`): the rotary table's
 * turning top on the collar — brass, its teeth and four slots turning — the kelly bushing and the
 * square kelly turning with it, up to the swivel; the hook and the travelling block it hangs from
 * (still, on the axis); and last the derrick leg in front of them all (`boreNearLeg`). No lamp on
 * it: its night lights and its switched-off look come from the body.
 */
function boreTable(ctx: Ctx, f: IsoFrame, s: number, t: number): void {
  const { cx, cy, table, t0, t1, kelly, swivel } = BORE, a = (t * Math.PI) / 2;
  cylinder(ctx, f, cx, cy, table, t0, t1, C.brass, s + 500, { top: C.brassL });
  for (let i = 0; i < 24; i++) {
    const b = a + (i / 24) * Math.PI * 2, co = Math.cos(b), si = Math.sin(b);
    const p = (k: number): Pt => { const [px, py] = f.p(cx + co * table * k, cy + si * table * k, t1); return [px, py]; };
    ink(ctx, [p(0.82), p(0.97)], { w: 1.4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 501 + i });
  }
  for (let i = 0; i < 4; i++) {
    const b = a + (i * Math.PI) / 2, co = Math.cos(b), si = Math.sin(b), nx = -si * 0.045, ny = co * 0.045;
    const q = (k: number, side: number): Pt => f.p(cx + co * table * k + nx * side, cy + si * table * k + ny * side, t1);
    shape(ctx, [q(0.48, -1), q(0.72, -1), q(0.72, 1), q(0.48, 1)], C.steelDD, { w: 0.9, shade: false, jitter: 0, seed: s + 530 + i });
  }
  prismIso(ctx, f, boreSquare(a, 0.13), t1, t1 + 0.08, { top: C.steelD }, s + 540, { outline: 1.4, shadow: false });
  prismIso(ctx, f, boreSquare(a, kelly), t1 + 0.08, swivel, { top: C.brass }, s + 550, { outline: 1.6, shadow: false });
  // The swivel, its coral gooseneck, the brass hook and the hazard-yellow travelling block.
  cylinder(ctx, f, cx, cy, 0.09, swivel - 0.02, swivel + 0.24, C.steelL, s + 560, { top: C.steel });
  pipeIso(ctx, f, [[cx + 0.06, cy, swivel + 0.16], [cx + 0.16, cy, swivel + 0.24], [cx + 0.2, cy, swivel + 0.1]], 3, C.coral, s + 561, false);
  const hk = (z: number, dx = 0): Pt => f.p(cx + dx, cy, z);
  ink(ctx, [hk(swivel + 0.24), hk(swivel + 0.38, 0.05), hk(3.62)], { w: 3.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 562 });
  ink(ctx, [hk(swivel + 0.24), hk(swivel + 0.38, 0.05), hk(3.62)], { w: 1.8, color: C.brassL, shade: false, taper: 0, jitter: 0, seed: s + 563 });
  const rr = box(ctx, f, cx - 0.1, cy - 0.08, cx + 0.1, cy + 0.08, 3.6, 4.1, { top: C.steelD, left: C.hazard, right: mix(C.hazard, C.ink, 0.38) }, s + 564, { outline: 1.6, shadow: false });
  faceHazard(ctx, f, rr, 'L', 0.05, 0.95, 3.66, 3.74, s + 565);
  boreLegIso(ctx, f, boreNearLeg(f), s);
}

// ── the steam boiler (D114) ─────────────────────────────────────────────────

/**
 * The steam boiler (D114, 3×2, its front north at rot 0): where its parts stand, in local tiles
 * and levels, the same in iso and in plan (buildings-top.ts). On the left the brick firebox
 * (`fire`, its roof at `fireZ`), a fire door on its east and west faces over `doors` (y), the coal
 * hopper behind it over the coal intake (`hop`) and the brick chimney on its roof (`stack`); the
 * boiler drum across the middle along x (`drum`: centre, axis height, radius, half-length) with
 * its steam dome, safety valve and gauge; on the right the engine on one shaft (`shaft`, along x):
 * the dynamo (`dyn`), the cylinder lying along y (`eng`) and, beyond the plane x = `split`, the
 * flywheel (`wheel`, its part in moving.ts); the feed pump by the water intake (`pump`).
 */
export const SB = {
  fire: [0.1, 0.14, 0.95, 1.38], fireZ: 1.5, doors: [0.2, 0.62], hop: [0.14, 1.44, 0.86, 1.9], hopZ: 1.02,
  stack: { x: 0.52, y: 0.62, r0: 0.25, r1: 0.17, z0: 1.5, top: 4.0 },
  drum: { x: 1.42, y: 1.12, z: 1.08, r: 0.34, half: 0.47 },
  dome: [1.22, 1.12], valve: [1.84, 1.02], gauge: [1.04, 0.84],
  shaft: { y: 0.55, z: 1.15 },
  dyn: { x: 2.18, r: 0.27, half: 0.15 },
  eng: { x: 2.52, y0: 1.15, y1: 1.66, r: 0.16 },
  pump: [2.17, 1.74],
  wheel: { x: 2.84, r: 0.46, half: 0.06 },
  split: 2.7,
} as const;
/** The boiler drum's pale enamel; coal (content colour of `coal`); the feed water's pipes; the flywheel's paint. */
export const SB_ENAMEL = mix(C.paper, C.ice, 0.55), SB_COAL = '#34303f', SB_WATER = mix(C.steelL, C.cyan, 0.45), SB_WHEEL = C.coral;
/** The boiler's tallest part: its chimney's cap (the plume rises over it in the sprite's margin). */
const SB_HEAD = SB.stack.top + 0.5;

/** Ink fraction of a local vertical face whose outward normal is local (nx, ny), once rotated (`faceInk`: the light from −x whatever the rotation). */
function localInk(f: IsoFrame, nx: number, ny: number): number {
  const [ax, ay] = f.r(0, 0), [bx, by] = f.r(nx, ny);
  return faceInk(bx - ax, by - ay);
}

/** Twice the signed area of a screen polygon (its winding). */
const wind2 = (q: readonly Pt[]): number => {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i]!, n = q[(i + 1) % q.length]!; a += p[0] * n[1] - n[0] * p[1]; }
  return a;
};
/** A ring as one polygon: `outer` with `inner` cut out (wound the other way, so a plain fill leaves the hole). */
function ringPoly(outer: readonly Pt[], inner: readonly Pt[]): Pt[] {
  const inn = Math.sign(wind2(inner)) === Math.sign(wind2(outer)) ? inner.slice().reverse() : inner.slice();
  return [...outer, outer[0]!, ...inn, inn[0]!];
}

/**
 * Thin plain polylines in one path, for marks by the hundred — brick courses and joints: ink's
 * ribbons would cost the bake for no visible wobble at this size (as the deep bore's `rod`).
 */
function hairlines(ctx: Ctx, lines: ReadonlyArray<readonly Pt[]>, w: number, color: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const l of lines) { if (l.length < 2) continue; ctx.moveTo(l[0]![0], l[0]![1]); for (let i = 1; i < l.length; i++) ctx.lineTo(l[i]![0], l[i]![1]); }
  ctx.stroke();
  ctx.restore();
}

/** Small bolt heads in one path: plain discs with an ink rim (`rivet` inks each, too dear by the dozen in every phase of a part). */
function bolts(ctx: Ctx, at: readonly Pt[], r: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  for (const [x, y] of at) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
  ctx.fillStyle = color; ctx.fill();
  ctx.globalAlpha = 0.7; ctx.strokeStyle = C.ink; ctx.lineWidth = 0.7; ctx.stroke();
  ctx.restore();
}

/** Brick courses and staggered joints on a box face (`brickwork`'s marks, in `hairlines`). */
function brickFace(f: IsoFrame, rr: RRect, face: Face, z0: number, z1: number): Pt[][] {
  const out: Pt[][] = [];
  for (let z = z0 + 0.1, row = 0; z < z1 - 0.02; z += 0.1, row++) {
    out.push([facePt(f, rr, face, 0.01, z), facePt(f, rr, face, 0.99, z)]);
    for (let u = row % 2 ? 0.06 : 0.12; u < 0.98; u += 0.12) out.push([facePt(f, rr, face, u, z), facePt(f, rr, face, u, z - 0.1)]);
  }
  return out;
}

/** The arc of a closed screen ring (centre c) that faces the light (top-left of the screen): where a rim catches it. */
function litArc(ring: readonly Pt[], c: Pt): Pt[] {
  const lit = (p: Pt): boolean => { const dx = p[0] - c[0], dy = p[1] - c[1], l = Math.hypot(dx, dy) || 1; return (-0.6 * dx - 0.8 * dy) / l > 0.5; };
  const k = ring.findIndex((p) => !lit(p));
  const from = k < 0 ? 0 : k;
  return Array.from({ length: ring.length }, (_, i) => ring[(from + i) % ring.length]!).filter(lit);
}

/** A dark puff of coal smoke (the steam `puff`'s shape, in soot). */
function sootPuff(ctx: Ctx, x: number, y: number, r: number, s: number): void {
  const lobes = [[0, 0, 1], [-0.7, 0.3, 0.7], [0.7, 0.25, 0.7], [0.1, -0.5, 0.62]] as const;
  for (const [dx, dy, k] of lobes) flat(ctx, ellipsePts(x + dx * r, y + dy * r, r * k + 1.4, r * k + 1.4, s, 0.06, 18), C.ink, 0.7);
  for (const [dx, dy, k] of lobes) flat(ctx, ellipsePts(x + dx * r, y + dy * r, r * k, r * k, s, 0.06, 18), mix(C.steel, C.inkSoft, 0.35));
  flat(ctx, ellipsePts(x - r * 0.3, y - r * 0.35, r * 0.42, r * 0.3, s + 1, 0.05, 14), mix(C.steel, C.steelL, 0.5), 0.85);
}

/**
 * The chimney's plume while the boiler burns: coal smoke at the mouth thinning into white steam
 * puffs that drift up and to the right (screen-fixed, as the light). Gone when it is switched off
 * (D83) and in its cast shadow (a plume is no solid).
 */
function plumeIso(ctx: Ctx, f: IsoFrame, s: number): void {
  if (isUnlit(ctx) || f instanceof ShadowFrame) return;
  const { x, y, top } = SB.stack;
  const [tx, ty] = f.p(x, y, top);
  sootPuff(ctx, tx + 4, ty - 15, 7, s);
  puff(ctx, tx + 12, ty - 26, 11, s + 1);
  sootPuff(ctx, tx + 5, ty - 22, 5, s + 2);
  puff(ctx, tx + 27, ty - 38, 12.5, s + 3);
  puff(ctx, tx + 46, ty - 46, 9, s + 4);
}

/**
 * A fire door on the firebox's local face x = X (its outward normal ±x: `out`), over `SB.doors`:
 * a riveted plate, the arched opening with the fire in it — lamp tokens, so it goes dark when the
 * boiler stops and glows at night —, the grate bars across it, the ash-pit door under it.
 */
function fireDoorIso(ctx: Ctx, f: IsoFrame, X: number, out: number, s: number): void {
  const [y0, y1] = SB.doors;
  const at = (u: number, z: number): Pt => f.p(X + out * 0.004, y0 + (y1 - y0) * u, z);
  const quad = (u0: number, u1: number, z0: number, z1: number): Pt[] => [at(u0, z1), at(u1, z1), at(u1, z0), at(u0, z0)];
  const k = localInk(f, out, 0), zd = SB.fireZ - 0.12; // the plate's top
  shape(ctx, quad(0, 1, SZ + 0.06, zd), mix(C.steelD, C.ink, k * 0.6), { w: 1.3, shade: false, jitter: 0, seed: s });
  for (const [u, z] of [[0.08, zd - 0.08], [0.92, zd - 0.08], [0.08, SZ + 0.14], [0.92, SZ + 0.14]] as const) rivet(ctx, ...at(u, z), 1.2, C.steelL);
  const arch = (w: number, zb: number, zt: number): Pt[] => {
    const pts: Pt[] = [at(0.5 - w, zb)];
    for (let i = 0; i <= 10; i++) { const a = Math.PI - (i / 10) * Math.PI; pts.push(at(0.5 + Math.cos(a) * w, zt - 0.14 + Math.sin(a) * 0.14)); }
    pts.push(at(0.5 + w, zb));
    return pts;
  };
  const z0 = zd - 0.54, z1 = zd - 0.1; // the opening
  flat(ctx, arch(0.42, z0 - 0.06, z1 + 0.06), C.ledWarm, 0.28);
  shape(ctx, arch(0.33, z0, z1), C.ledWarm, { w: 1.4, shade: false, jitter: 0, seed: s + 1 });
  flat(ctx, arch(0.2, z0 + 0.02, z1 - 0.1), C.glowPeach);
  for (const u of [0.36, 0.5, 0.64]) ink(ctx, [at(u, z0 + 0.01), at(u, z1 - 0.04)], { w: 1.3, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 2 + u * 10 });
  light(ctx, ...at(0.5, z0 + 0.16), 2.8, C.ledWarm);
  // The ash-pit door: dark steel, a latch.
  shape(ctx, quad(0.24, 0.76, SZ + 0.12, z0 - 0.14), C.steelDD, { w: 1.1, shade: false, jitter: 0, seed: s + 5 });
  ink(ctx, [at(0.42, (SZ + z0) / 2 - 0.02), at(0.58, (SZ + z0) / 2 - 0.02)], { w: 1.6, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 6 });
}

/** The brick chimney on the firebox's roof: a steel collar, the battered shaft in courses with iron bands, an iron cap round its dark throat. */
function chimneyIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { x, y, r0, r1, z0, top } = SB.stack;
  const rAt = (z: number): number => r0 + ((r1 - r0) * (z - z0)) / (top - z0);
  latheIso(ctx, f, x, y, [[z0, r0 + 0.07], [z0 + 0.14, r0 + 0.07]], C.steelD, s, { top: C.steel, seams: false });
  const z1 = top - 0.22, bands = [2.2, 3.0];
  latheIso(ctx, f, x, y, [[z0 + 0.14, rAt(z0 + 0.14)], ...bands.map((z) => [z, rAt(z)] as const), [z1, rAt(z1)]], BRICK, s + 1, { top: C.steelD });
  // Courses, and a staggered joint here and there, on the near half of the shaft.
  const courses: Pt[][] = [], joints: Pt[][] = [];
  for (let z = z0 + 0.26, i = 0; z < z1 - 0.04; z += 0.13, i++) {
    const c = f.p(x, y, z), [ex, ey] = f.ell(rAt(z));
    courses.push(Array.from({ length: 13 }, (_, k) => { const a = (k / 12) * Math.PI; return [c[0] + Math.cos(a) * ex, c[1] + Math.sin(a) * ey] as Pt; }));
    for (let j = 0; j < 3; j++) {
      const a = Math.PI * (0.2 + 0.3 * j + (i % 2 ? 0.15 : 0)), px = c[0] + Math.cos(a) * ex, py = c[1] + Math.sin(a) * ey;
      joints.push([[px, py], [px, py - 0.13 * ILH]]);
    }
  }
  hairlines(ctx, courses, 0.9, C.ink, 0.26);
  hairlines(ctx, joints, 0.8, C.ink, 0.22);
  // Iron bands over the courses where the shaft is strapped.
  for (const [i, z] of bands.entries()) {
    const c = f.p(x, y, z), [ex, ey] = f.ell(rAt(z) + 0.01);
    ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 60, 0, 28).filter(([, py]) => py >= c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 2.6, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 61 + i });
  }
  // The crown: a corbelled brick lip, an iron rim round the dark throat.
  const rc = rAt(z1);
  latheIso(ctx, f, x, y, [[z1, rc], [z1 + 0.08, rc + 0.045], [top - 0.05, rc + 0.045]], BRICK, s + 70, { top: C.steelL, shadow: false });
  latheIso(ctx, f, x, y, [[top - 0.05, rc + 0.06], [top, rc + 0.06]], C.steelL, s + 71, { open: C.ink, shadow: false, seams: false });
}

/** The coal hopper over the coal intake, flared and heaped with coal, its chute into the firebox's back. */
function coalHopperIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const [x0, y0, x1, y1] = SB.hop;
  box(ctx, f, 0.32, SB.fire[3] - 0.04, 0.68, y0 + 0.06, 0.6, 0.86, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s, { outline: 1.4, shadow: false });
  const mouth = frustumIso(ctx, f, x0, y0, x1, y1, SZ, SB.hopZ, -0.07, { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 1, { open: C.ink });
  let mx = 0, my = 0;
  for (const [px, py] of mouth) { mx += px / mouth.length; my += py / mouth.length; }
  let w = 0, h = 0;
  for (const [px, py] of mouth) { w = Math.max(w, Math.abs(px - mx)); h = Math.max(h, Math.abs(py - my)); }
  // Coal heaped in it: angular lumps, back to front, higher in the middle, a lit facet on each.
  flat(ctx, ellipsePts(mx, my + 1, w * 0.78, h * 0.7, s + 2, 0.1, 22), SB_COAL);
  const rng = makeRng(s + 3), lumps: Array<[number, number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next());
    lumps.push([mx + Math.cos(a) * d * w * 0.64, my + 1 + Math.sin(a) * d * h * 0.56 - (1 - d) * 4, rng.range(2.4, 3.8)]);
  }
  lumps.sort((p, q) => p[1] - q[1]);
  for (const [i, [px, py, r]] of lumps.entries()) {
    const pts = ellipsePts(px, py, r * 1.25, r, s + 10 + i, 0.28, 6);
    shape(ctx, pts, SB_COAL, { w: 0.9, shade: false, jitter: 0, seed: s + 30 + i });
    flat(ctx, [pts[3]!, pts[4]!, pts[5]!, [px, py]], mix(SB_COAL, C.steelL, i % 3 ? 0.3 : 0.55));
  }
}

/** One of the boiler drum's brass bands: the half of the ring at t (−1…1 along the drum) that faces the camera. */
function drumBandIso(ctx: Ctx, f: IsoFrame, t: number, s: number): void {
  const { x, y, z, r, half } = SB.drum;
  const sg = Math.sign(f.depth(x, y + 1) - f.depth(x, y)) || 1;
  const P = (a: number, k = 1): Pt => f.p(x + t * half, y + Math.cos(a) * r * k, z + Math.sin(a) * r * 2 * k);
  const arc = Array.from({ length: 17 }, (_, i) => P(Math.PI / 2 + (sg > 0 ? -1 : 1) * (i / 16) * Math.PI, 1.01));
  ink(ctx, arc, { w: 4.4, color: C.ink, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s });
  ink(ctx, arc, { w: 2.6, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  ink(ctx, arc.slice(0, 7), { w: 0.9, color: C.brassL, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  bolts(ctx, [2, 5, 8, 11, 14].map((i) => arc[i]!), 1.1, C.brassL);
}

/**
 * The boiler drum on its saddles: pale enamel, three brass bands, the steam dome and the safety
 * valve on top (its wisp while it works), the pressure gauge on a stalk at the front, its dial
 * turned to the camera.
 */
function boilerDrumIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { x, y, z, r, half } = SB.drum;
  for (const [i, sx] of [x - half * 0.62, x + half * 0.62].entries()) {
    box(ctx, f, sx - 0.07, y - 0.26, sx + 0.07, y + 0.26, SZ, 0.62, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + i, { outline: 1.4 });
  }
  const body = drumIso(ctx, f, x, y, z, r, half, 'x', SB_ENAMEL, s + 2, { hub: false });
  ctx.save(); pathOf(ctx, body); ctx.clip();
  for (const [i, t] of [-0.66, 0, 0.66].entries()) drumBandIso(ctx, f, t, s + 3 + i * 4);
  ctx.restore();
  // The near end again, over the bands (drumIso's end disc), with a manhole and its bolts.
  const nearT = f.depth(x + half, y) >= f.depth(x - half, y) ? 1 : -1;
  const end = Array.from({ length: 32 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return f.p(x + nearT * half, y + Math.cos(a) * r, z + Math.sin(a) * r * 2); });
  shape(ctx, end, mix(SB_ENAMEL, C.ink, localInk(f, nearT, 0) * 0.7), { w: 1.6, seed: s + 16 });
  const mh = Array.from({ length: 20 }, (_, i) => { const a = (i / 20) * Math.PI * 2; return f.p(x + nearT * (half + 0.01), y + Math.cos(a) * r * 0.36, z - 0.12 + Math.sin(a) * r * 0.5); });
  shape(ctx, mh, mix(SB_ENAMEL, C.steelD, 0.45), { w: 1.1, shade: false, jitter: 0, seed: s + 17 });
  bolts(ctx, Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return f.p(x + nearT * (half + 0.01), y + Math.cos(a) * r * 0.78, z + Math.sin(a) * r * 1.56); }), 1.1, C.steelL);
  const top = z + r * 2;
  const parts: Array<[number, number, () => void]> = [
    [SB.dome[0], SB.dome[1], () => latheIso(ctx, f, SB.dome[0], SB.dome[1], [[top - 0.1, 0.17], [top - 0.02, 0.17], [top - 0.02, 0.15], [top + 0.26, 0.15], [top + 0.33, 0.12], [top + 0.37, 0.06]], C.brass, s + 20, { top: C.brassL })],
    [SB.valve[0], SB.valve[1], () => {
      const [vx, vy] = SB.valve, vt = top - 0.04;
      latheIso(ctx, f, vx, vy, [[vt, 0.06], [vt + 0.16, 0.06], [vt + 0.16, 0.085], [vt + 0.22, 0.085], [vt + 0.22, 0.04], [vt + 0.3, 0.04]], C.brass, s + 21, { top: C.brassL, seams: false });
      const a = f.p(vx, vy, vt + 0.26), b = f.p(vx + 0.26, vy, vt + 0.26);
      ink(ctx, [a, b], { w: 2, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 22 });
      shape(ctx, ellipsePts(b[0], b[1] + 1, 3.2, 3.2, s + 23, 0, 12), C.steelD, { w: 1.1, shade: false, jitter: 0, seed: s + 23 });
      if (!isUnlit(ctx) && !(f instanceof ShadowFrame)) {
        const w0 = f.p(vx, vy, vt + 0.32);
        puff(ctx, w0[0] + 2, w0[1] - 7, 3.6, s + 24);
        puff(ctx, w0[0] + 7, w0[1] - 14, 2.8, s + 25);
      }
    }],
    [SB.gauge[0], SB.gauge[1], () => {
      const [gx, gy] = SB.gauge;
      pipeIso(ctx, f, [[gx, gy, z + 0.3], [gx, gy, top + 0.28]], 2.2, C.steelL, s + 26, false);
      const [dx, dy] = f.p(gx, gy, top + 0.4);
      shape(ctx, ellipsePts(dx, dy, 6, 6, s + 27, 0, 18), C.brass, { w: 1.3, shade: false, jitter: 0, seed: s + 27 });
      flat(ctx, ellipsePts(dx, dy, 4.4, 4.4, s + 28, 0, 18), C.paper);
      for (let i = 0; i < 5; i++) { const a = Math.PI * (0.8 + i * 0.35); ink(ctx, [[dx + Math.cos(a) * 3.2, dy + Math.sin(a) * 3.2], [dx + Math.cos(a) * 4.2, dy + Math.sin(a) * 4.2]], { w: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 29 + i }); }
      ink(ctx, [[dx, dy], [dx + 2.8, dy - 2.2]], { w: 1.2, color: C.coralD, shade: false, taper: 0, jitter: 0, seed: s + 35 });
    }],
  ];
  parts.sort((p, q) => f.depth(p[0], p[1]) - f.depth(q[0], q[1]));
  for (const [, , draw] of parts) draw();
}

/** The dynamo on the shaft: a teal field drum between coral end bells on a pedestal, the brass commutator and its brushes at its west end, status LEDs. */
function dynamoIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { y, z } = SB.shaft, { x, r, half } = SB.dyn;
  const rr = box(ctx, f, x - half - 0.16, y - 0.27, x + half + 0.06, y + 0.27, SZ, z - r * 2 + 0.08, { top: C.steelD, left: mix(C.teal, C.steelD, 0.45), right: mix(C.teal, C.ink, 0.55) }, s, { outline: 1.6 });
  faceLeds(ctx, f, rr, 'L', SZ + 0.18, 0.25, 0.75, 3, [C.ledGreen, C.led, C.led], 1.7);
  hvSignIso(ctx, f, rr, 'R', 0.5, SZ + 0.2, s + 1);
  const pieces: Array<[number, () => void]> = [
    [x - half - 0.1, () => {
      drumIso(ctx, f, x - half - 0.1, y, z, 0.11, 0.05, 'x', C.brass, s + 2, { shadow: false, hub: false });
      for (const k of [-1, 1]) ink(ctx, [f.p(x - half - 0.1, y + k * 0.06, z + 0.3), f.p(x - half - 0.1, y + k * 0.04, z + 0.2)], { w: 2.2, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 3 + k });
    }],
    [x - half, () => drumIso(ctx, f, x - half, y, z, r * 0.86, 0.035, 'x', C.coral, s + 4, { shadow: false, hub: false })],
    [x, () => drumIso(ctx, f, x, y, z, r, half - 0.03, 'x', C.teal, s + 5, { bands: [-0.4, 0.4], shadow: false, hub: false })],
    [x + half, () => drumIso(ctx, f, x + half, y, z, r * 0.86, 0.035, 'x', C.coral, s + 6, { shadow: false })],
  ];
  pieces.sort((p, q) => f.depth(p[0], y) - f.depth(q[0], y));
  for (const [, draw] of pieces) draw();
}

/**
 * The engine: its bed along y, the cylinder lying on it (brass-banded, the steam chest on top),
 * the piston rod into the crosshead between its guides, the connecting rod down to the crank on
 * the shaft, the main bearing; a work lamp on a post at the bed's end.
 */
function engineIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const { x, y0, y1, r } = SB.eng, { y: sy, z: sz } = SB.shaft, bz = sz - r * 2 - 0.02;
  const bed = box(ctx, f, x - 0.13, sy - 0.2, x + 0.13, y1 + 0.06, SZ, bz, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.42) }, s, { outline: 1.6 });
  faceHazard(ctx, f, bed, 'L', 0.08, 0.92, SZ + 0.08, SZ + 0.18, s + 1);
  const xh = 0.97; // the crosshead's place (y)
  const parts: Array<[number, () => void]> = [
    // The crank on the shaft, its main bearing, the connecting rod up to the crosshead.
    [sy, () => {
      pipeIso(ctx, f, [[SB.dyn.x + SB.dyn.half, sy, sz], [SB.split, sy, sz]], 4.6, C.steelL, s + 2, false);
      box(ctx, f, x + 0.04, sy - 0.12, x + 0.13, sy + 0.12, bz, sz + 0.1, { top: C.steel }, s + 3, { outline: 1.3, shadow: false });
      drumIso(ctx, f, x - 0.03, sy, sz, 0.15, 0.03, 'x', C.steelD, s + 4, { shadow: false });
      const pin: [number, number, number] = [x - 0.07, sy + Math.cos(1) * 0.1, sz + Math.sin(1) * 0.2];
      pipeIso(ctx, f, [pin, [x - 0.03, xh, sz]], 3.2, C.steelL, s + 5, false);
      rivet(ctx, ...f.p(...pin), 2, C.brassL);
    }],
    // The crosshead between its guides, the piston rod into the cylinder.
    [xh, () => {
      for (const dz of [-0.12, 0.12]) pipeIso(ctx, f, [[x - 0.03, xh - 0.2, sz + dz], [x - 0.03, y0, sz + dz]], 2, C.steelD, s + 6 + dz * 10, false);
      ink(ctx, [f.p(x - 0.03, xh, sz), f.p(x - 0.03, y0, sz)], { w: 2.2, color: C.ice, shade: false, taper: 0, jitter: 0, seed: s + 8 });
      box(ctx, f, x - 0.09, xh - 0.06, x + 0.03, xh + 0.06, sz - 0.1, sz + 0.1, { top: C.brassL, left: C.brass, right: mix(C.brass, C.ink, 0.4) }, s + 9, { outline: 1.2, shadow: false });
    }],
    // The cylinder, its covers and the steam chest; the work lamp at the bed's end.
    [(y0 + y1) / 2, () => {
      drumIso(ctx, f, x, (y0 + y1) / 2, sz, r, (y1 - y0) / 2, 'y', C.steelL, s + 10, { bands: [-0.55, 0, 0.55], shadow: false, end: C.steel });
      box(ctx, f, x - 0.08, y0 + 0.08, x + 0.08, y1 - 0.08, sz + r * 2 - 0.05, sz + r * 2 + 0.14, { top: C.steel, left: C.steelD, right: mix(C.steelD, C.ink, 0.4) }, s + 11, { outline: 1.3, shadow: false });
      pipeIso(ctx, f, [[x + 0.1, y1 + 0.04, bz], [x + 0.1, y1 + 0.04, bz + 0.5]], 2.2, C.steelD, s + 12, false);
      box(ctx, f, x + 0.04, y1 - 0.02, x + 0.16, y1 + 0.1, bz + 0.48, bz + 0.6, { top: C.steelD }, s + 13, { outline: 1, shadow: false });
      light(ctx, ...f.p(x + 0.1, y1 + 0.04, bz + 0.44), 2.4, C.ledWarm);
    }],
  ];
  parts.sort((p, q) => f.depth(x, p[0]) - f.depth(x, q[0]));
  for (const [, draw] of parts) draw();
}

/** The feed pump by the water intake (a brass air vessel on top) and its pipes: from the intake, and up into the drum's east end. */
function feedPumpIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const [px, py] = SB.pump, { x, y, z, half } = SB.drum;
  pipeIso(ctx, f, [[2.5, 1.95, 0.42], [2.5, 1.86, 0.42], [px + 0.04, 1.86, 0.42]], 3.4, SB_WATER, s, false);
  cylinder(ctx, f, px, py, 0.1, SZ, 0.78, C.steel, s + 1, { top: C.steelL, rings: 1 });
  latheIso(ctx, f, px, py, [[0.78, 0.06], [0.82, 0.09], [0.98, 0.09], [1.04, 0.06], [1.08, 0.02]], C.brass, s + 2, { top: C.brassL, seams: false });
  pipeIso(ctx, f, [[px - 0.04, py - 0.08, 0.66], [x + half + 0.1, y + 0.24, 0.8], [x + half - 0.01, y + 0.22, z - 0.24]], 3, SB_WATER, s + 3);
}

/** The steam main: from the dome's crown over the back of the drum, along to the engine and down into its steam chest; a stop valve's handwheel on it. */
function steamMainIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const top = SB.drum.z + SB.drum.r * 2, zm = top + 0.4, ym = SB.drum.y + 0.2, { x: ex, y0, r } = SB.eng, cz = SB.shaft.z + r * 2 + 0.14;
  pipeIso(ctx, f, [[SB.dome[0], SB.dome[1], top + 0.34], [SB.dome[0], ym, zm], [ex, ym, zm], [ex, y0 + 0.2, cz]], 4, C.steelL, s);
  const w = f.p(1.72, ym, zm + 0.1);
  ink(ctx, [f.p(1.72, ym, zm), w], { w: 1.6, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  ink(ctx, ellipsePts(w[0], w[1], 5, 2.4, s + 2, 0, 16), { closed: true, w: 3.2, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  ink(ctx, ellipsePts(w[0], w[1], 5, 2.4, s + 2, 0, 16), { closed: true, w: 1.7, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 3 });
}

/** Everything of the steam boiler but its flywheel: the far side of the plane x = `SB.split`. */
function boilerBody(ctx: Ctx, f: IsoFrame, s: number): void {
  slab(ctx, f, C.steel, 0.06, SZ, s);
  // The flywheel's pit in the slab.
  const { x: wx, r: wr, half: wh } = SB.wheel, wy = SB.shaft.y;
  shape(ctx, [f.p(wx - wh - 0.04, wy - wr - 0.03, SZ), f.p(wx + wh + 0.04, wy - wr - 0.03, SZ), f.p(wx + wh + 0.04, wy + wr + 0.03, SZ), f.p(wx - wh - 0.04, wy + wr + 0.03, SZ)], C.steelDD, { w: 1.2, shade: false, jitter: 0, seed: s + 1 });
  const [fx0, fy0, fx1, fy1] = SB.fire;
  const sc = new Scene();
  sc.add(f.depth((fx0 + fx1) / 2, (fy0 + fy1) / 2), () => {
    const rr = box(ctx, f, fx0, fy0, fx1, fy1, SZ, SB.fireZ, { top: C.steelD, left: BRICK, right: mix(BRICK, C.ink, 0.35) }, s + 2);
    hairlines(ctx, [...brickFace(f, rr, 'L', SZ, SB.fireZ), ...brickFace(f, rr, 'R', SZ, SB.fireZ)], 0.9, C.ink, 0.28);
    for (const face of ['L', 'R'] as const) for (const z of [0.55, SB.fireZ - 0.08]) ink(ctx, [facePt(f, rr, face, 0, z), facePt(f, rr, face, 1, z)], { w: 2.6, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 4 + z * 10 });
    // A fire door on whichever of the east and west faces turns to the camera (one in each rotation).
    if (facing(f, 1)) fireDoorIso(ctx, f, fx1, 1, s + 10);
    if (facing(f, 3)) fireDoorIso(ctx, f, fx0, -1, s + 20);
    chimneyIso(ctx, f, s + 30);
    plumeIso(ctx, f, s + 110);
  });
  sc.add(f.depth(0.5, (SB.hop[1] + SB.hop[3]) / 2), () => coalHopperIso(ctx, f, s + 130));
  sc.add(f.depth(SB.drum.x, SB.drum.y), () => { boilerDrumIso(ctx, f, s + 160); steamMainIso(ctx, f, s + 230); });
  sc.add(f.depth(SB.dyn.x, SB.shaft.y), () => dynamoIso(ctx, f, s + 260));
  sc.add(f.depth(SB.eng.x, 1.0), () => engineIso(ctx, f, s + 290));
  sc.add(f.depth(SB.pump[0], SB.pump[1]), () => feedPumpIso(ctx, f, s + 330));
  sc.run();
}

/**
 * The flywheel on the shaft's east end, at phase t of a sixth of a turn (its six spokes): the
 * shaft's stub from the split plane, the rim's tread and the near face's ring in the boiler's
 * coral, the inner tread glimpsed through it, the spokes, the steel hub and its brass boss.
 */
function flywheelIso(ctx: Ctx, f: IsoFrame, s: number, t: number): void {
  const { x, r, half } = SB.wheel, { y: cy, z: cz } = SB.shaft;
  const near = f.depth(x + 1, cy) > f.depth(x, cy) ? 1 : -1;
  const W = (a: number, rho: number, d: number): Pt => f.p(x + d, cy + Math.cos(a) * rho, cz + Math.sin(a) * rho * 2);
  const ring = (d: number, rho: number, m = 48): Pt[] => Array.from({ length: m }, (_, i) => W((i / m) * Math.PI * 2, rho, d));
  pipeIso(ctx, f, [[SB.split, cy, cz], [x + near * (half + 0.05), cy, cz]], 4.6, C.steelL, s, false);
  const ri = r * 0.84, outer = hull([...ring(-half, r), ...ring(half, r)]);
  const innerNear = ring(near * half, ri), innerFar = ring(-near * half, ri);
  castShadow(ctx, outer, 6, 0.26);
  flat(ctx, ringPoly(outer, innerNear), mix(SB_WHEEL, C.ink, 0.45));
  ctx.save(); pathOf(ctx, innerNear); ctx.clip();
  flat(ctx, ringPoly(innerNear, innerFar), mix(SB_WHEEL, C.ink, 0.6));
  ctx.restore();
  const face = mix(SB_WHEEL, C.ink, localInk(f, near, 0) * 0.75);
  const a0 = (t * Math.PI * 2) / 6 + 0.3;
  for (let i = 0; i < 6; i++) { const a = a0 + (i * Math.PI) / 3; rod(ctx, W(a, r * 0.16, 0), W(a, ri + 0.01, 0), 3.8, mix(SB_WHEEL, C.ink, 0.25)); }
  flat(ctx, ringPoly(ring(near * half, r), innerNear), face);
  ink(ctx, ring(near * half, r), { closed: true, w: 1.7, seed: s + 20 });
  ink(ctx, innerNear, { closed: true, w: 1.2, alpha: 0.8, shade: false, seed: s + 21 });
  ink(ctx, litArc(ring(near * half, r * 0.92), W(0, 0, near * half)), { w: 1.2, color: '#ffffff', alpha: 0.4, shade: false, taper: 0.2, jitter: 0, seed: s + 22 });
  const hubRing = ring(near * (half + 0.02), r * 0.2, 20);
  shape(ctx, hubRing, C.steel, { w: 1.3, shade: false, jitter: 0, seed: s + 23 });
  bolts(ctx, Array.from({ length: 6 }, (_, i) => W(a0 + (i * Math.PI) / 3 + Math.PI / 6, r * 0.13, near * (half + 0.03))), 1, C.steelL);
  rivet(ctx, ...W(0, 0, near * (half + 0.05)), 3.2, C.brassL);
}

const R: Partial<Record<BuildingId, Recipe>> = {
  // ── colony ────────────────────────────────────────────────────────────────
  hearth: {
    head: HEART_TOP,
    draw(ctx, f, s, lv) {
      // The base's core — the starter kit the drones set down, piloted from Verrière: a fortified
      // depot whose walls swallow the ribbons through curtained mouths (roller conveyors run in
      // from every port), its roof a solar array and a drone hatch; over it the uplink to Verrière
      // and CrierBelt, a big dish with the beacon on its feed — the topmost point, over the
      // centre; two link masts for its wires, west and east, each between two of that side's
      // ribbons. It grows with its level (D86): its four slab corners stand bare at level 1, a
      // mounting plate stencilled on each, and each level mounts one piece on one (`HEART_CORNERS`:
      // the data outlet, the expertise archive, the grid station, the uplink mast) while its trims,
      // beacons and lamps fill out (`heartLook`, level 5's crown of lamps). The roof is laid out screen-fixed, so it reads the same
      // however the Heart is turned (in play it never is).
      const look = heartLook(lv);
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const mouths: Array<readonly [number, number]> = [];
      const ports = (BUILDINGS.hearth as BuildingDef).ports;
      for (const [i, p] of ports.entries()) {
        const side = sideIndex[p.side], c = (side & 1 ? p.y : p.x) + 0.5, h = 0.17, k = s + 100 + i * 50;
        // The data outlet (D68) stands on its corner tile, off the depot: a corner piece, below.
        if (p.io === 'out') continue;
        if (side === 0) { apronBelt(ctx, f, c - h, 0.15, c + h, DEP.y0, 'y', k); mouths.push([c, DEP.y0]); }
        else if (side === 2) { apronBelt(ctx, f, c - h, DEP.y1, c + h, 4.85, 'y', k); mouths.push([c, DEP.y1]); }
        else if (side === 1) { apronBelt(ctx, f, DEP.x1, c - h, 4.85, c + h, 'x', k); mouths.push([DEP.x1, c]); }
        else { apronBelt(ctx, f, 0.15, c - h, DEP.x0, c + h, 'x', k); mouths.push([DEP.x0, c]); }
      }
      const sc = new Scene();
      // The two link masts, where the Heart's wires meet (art/terminals.ts `HEART_MASTS`).
      for (const [i, [x, y]] of HEART_MASTS.at.entries()) sc.add(f.depth(x, y), () => linkMastIso(ctx, f, x, y, HEART_MASTS.top, s + 10 + i * 7));
      // The corners: the piece a level has mounted, else a bare mounting plate (flat: drawn now).
      for (const [i, c] of HEART_CORNERS.entries()) {
        const k = s + 600 + i * 40;
        if (lv < c.lv || !c.piece) { mountPlateIso(ctx, f, c.tx, c.ty, k); continue; }
        const d = f.depth(c.tx + 0.5, c.ty + 0.5) - 0.04;
        if (c.piece === 'outlet') {
          const p = ports.find((q) => q.io === 'out')!;
          sc.add(d, () => dataOutletIso(ctx, f, p.x, p.y, sideIndex[p.side], k));
        } else if (c.piece === 'archive') sc.add(d, () => archiveIso(ctx, f, c.tx, c.ty, k));
        else if (c.piece === 'station') sc.add(d, () => stationIso(ctx, f, c.tx, c.ty, k));
        else sc.add(d, () => uplinkPieceIso(ctx, f, c.tx, c.ty, k));
      }
      // The depot, then its roof: a drone at work over the hatch (level 3), the uplink, the solar
      // rows (nearer than the dish), the beacons the level lights.
      const d0 = f.depth(2.5, 2.5) + 0.01;
      sc.add(d0, () => depotIso(ctx, f, mouths, s + 200, look));
      if (look.drone) {
        const [x, y] = unrot(f, 1.64, 1.8);
        sc.add(d0 + 0.0005, () => droneIso(ctx, f, x, y, DEP.z, s + 50, { lift: 0.62, cargo: C.coral }));
      }
      sc.add(d0 + 0.001, () => uplinkIso(ctx, f, 2.5, 2.5, HEART_TOP, 1.0, 0.73, DEP.z, s + 300));
      for (const [i, [a0, b0, a1, b1, m]] of HEART_PV.entries()) sc.add(d0 + 0.002 + i * 0.0001, () => pvRowIso(ctx, f, a0, b0, a1, b1, DEP.z, m, s + 400 + i * 20));
      for (const [i, [rx, ry, col]] of HEART_BEACONS.slice(0, look.beacons).entries()) {
        const [x, y] = unrot(f, rx, ry);
        sc.add(d0 + 0.003 + i * 0.0001, () => beaconIso(ctx, f, x, y, DEP.z, DEP.z + 0.42, col, s + 500 + i * 5));
      }
      sc.run();
      // The slab's faces: a strip of LEDs (two from level 2), floodlights from level 4.
      const rr = f.rect(0.05, 0.05, 4.95, 4.95);
      for (const face of ['L', 'R'] as const) {
        const leds = face === 'L' ? LEDS : [C.ledWarm, C.led];
        faceLeds(ctx, f, rr, face, SZ * 0.5, 0.05, 0.17, 3, leds);
        if (look.strips > 1) faceLeds(ctx, f, rr, face, SZ * 0.5, 0.83, 0.95, 3, leds);
        if (look.floods) for (const [j, u] of HEART_FLOODS.entries()) floodIso(ctx, f, rr, face, u, s + 700 + j * 3 + (face === 'L' ? 0 : 10));
      }
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
    // A heavy rig over its own hole (moving.ts `BORE`): the derrick over the wellhead collar and its
    // spoil, the draw-works, the power house, the pipe rack, the outlet works (`boreBody`); the
    // rotary table and the kelly turn while it works (`boreTable`), always the nearer part.
    head: 6.4,
    moving: { body: boreBody, part: boreTable, over: () => true },
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
    // The incinerator (D51): a pit sunk into scorched ground, chutes in from every side, a flame
    // that flares when an item falls in (owner, 2026-10-14; `pitIso` below, world/pits.ts).
    head: 0.45,
    draw: (ctx, f, s) => pitIso(ctx, f, s, 'all'),
  },
  sorter: { head: LID, draw: (ctx, f, s) => sorterIso(ctx, f, s, false) },
  inverted_sorter: { head: LID, draw: (ctx, f, s) => sorterIso(ctx, f, s, true) },
  overflow_gate: { head: 0.85, draw: (ctx, f, s) => gateIso(ctx, f, s, false) },
  underflow_gate: { head: 0.85, draw: (ctx, f, s) => gateIso(ctx, f, s, true) },
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
  press: {
    head: 2.85,
    draw(ctx, f, s) {
      // A press (the first workshop's drawing until the research redesign): two violet columns
      // and a crown beam carrying a hydraulic ram over a hazard-edged bolster with a coral blank
      // on it; a control cabinet beside.
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
  // ── research and compute (the research redesign): labs, data antennas, servers ──────────
  observatory: {
    // The research lab (the id is kept from the observatory it replaces; 3×3 since D84): see `labIso`.
    head: 3.15,
    draw: labIso,
  },
  workshop: {
    // The electronics workshop (the old press drawing went to `press`): see `electronicsIso`.
    head: 1.95,
    draw: electronicsIso,
  },
  test_bench: {
    // The test bench: a dynamometer and a vibration table under load, the instrument rack and
    // its scope; see `testBenchIso`.
    head: 2.25,
    draw: testBenchIso,
  },
  data_collector: {
    head: 2.75,
    draw(ctx, f, s) {
      // A data-gathering antenna: a phased-array panel tilted on a geared turntable, the
      // receiver cabinet with its blinking LEDs, a cartridge stacker by the outlet (N).
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.39, 0.4), () => stackerIso(ctx, f, 0.14, 0.14, 0.64, 0.66, 4, s + 1));
      sc.add(f.depth(0.37, 1.36), () => {
        const rr = cabinetIso(ctx, f, 0.12, 0.86, 0.62, 1.86, 1.22, C.teal, s + 10, 3);
        dotRows(ctx, f, rr, 'R', 0.15, 0.85, 0.5, 0.62, s + 11);
      });
      sc.add(f.depth(1.3, 1.12), () => {
        cableIso(ctx, f, [0.62, 1.3, 0.7], [1.0, 1.25, 0.45], 2.2, s + 20);
        arrayTurntable(ctx, f, 1.3, 1.12, 0.48, SZ, { z: 1.78, w: 1.1, h: 0.76, cols: 6, rows: 4, tilt: 0.95 }, s + 21);
      });
      sc.run();
    },
  },
  data_relay: {
    head: 5.9,
    draw(ctx, f, s) {
      // The collector writ large: a guyed lattice mast carrying three array panels at different
      // heights and bearings, the receiver cabinet and the power box at its foot, the stacker by
      // the outlet (N), a red light on top.
      slab(ctx, f, C.steelD, 0.04, SZ, s);
      const sc = new Scene();
      const mx = 1.6, my = 1.5, top = 5.3;
      for (const [i, [ax, ay]] of ([[0.3, 0.32], [2.7, 0.32], [0.3, 1.5]] as const).entries()) {
        sc.add(f.depth(ax, ay) - (f.depth(ax, ay) < f.depth(mx, my) ? 0 : -0.3), () => {
          box(ctx, f, ax - 0.08, ay - 0.08, ax + 0.08, ay + 0.08, SZ, 0.44, { top: C.hazard, left: C.brass, right: mix(C.brass, C.ink, 0.4) }, s + 60 + i, { outline: 1.3 });
          ink(ctx, [f.p(ax, ay, 0.44), f.p(mx, my, 4.3)], { w: 1.1, color: C.steelDD, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 64 + i });
        });
      }
      sc.add(f.depth(1.5, 0.38), () => stackerIso(ctx, f, 1.1, 0.14, 1.9, 0.62, 5, s + 1));
      sc.add(f.depth(0.75, 2.4), () => {
        const rr = cabinetIso(ctx, f, 0.2, 1.98, 1.3, 2.82, 1.45, C.teal, s + 10, 3);
        dotRows(ctx, f, rr, 'L', 0.12, 0.88, 0.48, 0.7, s + 11);
      });
      sc.add(f.depth(2.42, 2.42), () => {
        const rr = box(ctx, f, 2.05, 2.05, 2.8, 2.8, SZ, 1.0, { top: C.steelD, left: C.coral, right: mix(C.coral, C.ink, 0.42) }, s + 12);
        faceGrille(ctx, f, rr, 'L', 0.12, 0.6, SZ + 0.1, 0.85, s + 13, 4);
        faceLeds(ctx, f, rr, 'L', 0.84, 0.68, 0.9, 2, [C.ledWarm, C.led], 1.6);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.1, 0.85, s + 14, 4);
      });
      sc.add(f.depth(mx, my), () => {
        cableIso(ctx, f, [1.3, 2.1, 1.1], [1.45, 1.75, 0.6], 2.4, s + 15);
        cylinder(ctx, f, mx, my, 0.5, SZ, 0.45, C.steelD, s + 16, { top: C.steel });
        trussIso(ctx, f, mx, my, 0.4, 0.11, 0.45, top, 8, C.steelL, s + 17, 3.2);
        pipeIso(ctx, f, [[mx, my, top - 0.1], [mx, my, top + 0.4]], 2.4, C.steelD, s + 18, false);
        light(ctx, ...f.p(mx, my, top + 0.45), 2.8, C.ledRed);
      });
      // Low on the mast, the big array on its arm (screen-fixed, as the collector's); high up, a
      // head of three sector panels a third of a turn apart, turning with the footprint.
      const big = leanTo(f, 0.35, 0.94, 1.05), bl = Math.hypot(big[0], big[1]) || 1;
      const bx = mx + (big[0] / bl) * 0.42, by = my + (big[1] / bl) * 0.42;
      sc.add(f.depth(bx, by), () => arrayPanel(ctx, f, [bx, by, 2.35], 1.0, 0.7, big, 6, 4, s + 30));
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / 3, t = 1.48;
        const n: V3 = [Math.cos(a) * Math.sin(t), Math.sin(a) * Math.sin(t), Math.cos(t)];
        const cx = mx + Math.cos(a) * 0.3, cy = my + Math.sin(a) * 0.3;
        sc.add(f.depth(cx, cy) + 0.01 * k, () => arrayPanel(ctx, f, [cx, cy, 4.25], 0.3, 0.86, n, 2, 5, s + 40 + k * 9));
      }
      sc.run();
    },
  },
  server: {
    head: 2.45,
    draw(ctx, f, s) {
      // Two rows of tall violet racks, their doors dense with cyan and green indicator dots, fan
      // grilles on their roofs, a cable trunk bridging the aisle. Drawn once (no ports): the
      // rows run along x so their long lit faces turn to the camera.
      slab(ctx, f, C.steelD, 0.05, SZ, s);
      const sc = new Scene();
      for (const [j, [y0, y1, z1]] of ([[0.16, 0.7, 2.05], [1.2, 1.74, 1.72]] as const).entries()) {
        for (const [i, [x0, x1]] of ([[0.14, 0.7], [0.72, 1.28], [1.3, 1.86]] as const).entries()) {
          sc.add(f.depth((x0 + x1) / 2, (y0 + y1) / 2), () => rackIso(ctx, f, x0, y0, x1, y1, z1, s + j * 100 + i * 20, { fans: 1, col: i === 1 ? mix(RACK, C.steelL, 0.2) : RACK }));
        }
      }
      sc.add(f.depth(1, 0.95) + 1.2, () => {
        const tr = box(ctx, f, 0.1, 0.72, 1.9, 0.9, 1.92, 2.04, { top: C.steelD, left: C.hazard, right: mix(C.hazard, C.ink, 0.4) }, s + 300, { outline: 1.4, shadow: false });
        for (let k = 1; k < 9; k++) ink(ctx, [facePt(f, tr, 'L', k / 9, 1.93), facePt(f, tr, 'L', k / 9 - 0.03, 2.03)], { w: 1.2, color: C.ink, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 301 + k });
        for (const [k, x] of [0.42, 1.0, 1.58].entries()) cableIso(ctx, f, [x, 0.88, 1.94], [x + 0.08, 1.3, 1.72], 2.4, s + 310 + k);
      });
      sc.run();
    },
  },
  cooled_server: {
    head: 2.2,
    draw(ctx, f, s) {
      // Racks sunk in a coolant bath: a steel tank brimming with cyan coolant, three rows of
      // racks standing out of it (ripples round their feet, bubbles), coolant pipes over the rim
      // to a chiller with three fans on its roof. Drawn once (no ports).
      slab(ctx, f, C.steelD, 0.04, SZ, s);
      const sc = new Scene();
      const ZL = 0.9;
      sc.add(-10, () => {
        const rr = box(ctx, f, 0.14, 0.16, 2.02, 2.84, SZ, ZL + 0.06, { top: C.steelL, left: C.steelL, right: mix(C.steel, C.ink, 0.25) }, s + 1);
        faceHazard(ctx, f, rr, 'L', 0.02, 0.98, ZL - 0.1, ZL + 0.0, s + 2);
        faceHazard(ctx, f, rr, 'R', 0.02, 0.98, ZL - 0.1, ZL + 0.0, s + 3);
        faceGrille(ctx, f, rr, 'L', 0.3, 0.7, SZ + 0.1, ZL - 0.2, s + 4, 3);
        const liq: Pt[] = [f.p(0.22, 0.24, ZL), f.p(1.94, 0.24, ZL), f.p(1.94, 2.76, ZL), f.p(0.22, 2.76, ZL)];
        shape(ctx, liq, COOLANT, { w: 1.2, shade: false, jitter: 0, seed: s + 5 });
        ctx.save(); pathOf(ctx, liq); ctx.clip();
        hatch(ctx, liq, -Math.PI / 8, 7, { color: '#ffffff', alpha: 0.18, seed: s + 6, w: 1 });
        ctx.restore();
      });
      for (const [j, y0] of [0.42, 1.18, 1.94].entries()) {
        for (const [i, [x0, x1]] of ([[0.34, 1.06], [1.1, 1.82]] as const).entries()) {
          sc.add(f.depth((x0 + x1) / 2, y0 + 0.2) - 5, () => {
            const c = f.p((x0 + x1) / 2, y0 + 0.2, ZL), [ex, ey] = f.ell(0.5);
            ink(ctx, ellipsePts(c[0], c[1] + 2, ex, ey * 0.62, s + 50 + j * 4 + i, 0.04, 36), { closed: true, w: 1.2, color: mix(COOLANT, '#ffffff', 0.55), alpha: 0.8, shade: false, taper: 0, seed: s + 50 });
            rackIso(ctx, f, x0, y0, x1, y0 + 0.4, ZL + 0.62, s + 100 + j * 20 + i * 7, { z0: ZL, col: i ? RACK : mix(RACK, C.steelL, 0.2) });
            for (let b = 0; b < 3; b++) {
              const p = f.p(x0 + 0.15 + b * 0.24, y0 + 0.52 + (b % 2) * 0.05, ZL);
              ink(ctx, ellipsePts(p[0], p[1], 2.2 - b * 0.4, 1.8 - b * 0.3, s + 70 + b, 0, 10), { closed: true, w: 0.9, color: '#ffffff', alpha: 0.8, shade: false, taper: 0, seed: s + 70 });
            }
          });
        }
      }
      sc.add(f.depth(2.53, 1.5), () => {
        const rr = box(ctx, f, 2.2, 0.26, 2.86, 2.74, SZ, 1.3, { top: C.steelD, left: C.teal, right: mix(C.teal, C.ink, 0.42) }, s + 200);
        fins(ctx, f, rr, 'R', SZ + 0.12, 1.15, 14, s + 201);
        faceGrille(ctx, f, rr, 'L', 0.15, 0.85, SZ + 0.12, 1.1, s + 202, 5);
        faceLeds(ctx, f, rr, 'L', 1.18, 0.2, 0.8, 3, [C.led, C.ledGreen], 1.6);
        for (const [i, y] of [0.7, 1.4, 2.1].entries()) fanIso(ctx, f, 2.53, y, 1.3, 0.24, s + 210 + i);
      });
      sc.add(f.depth(2.1, 1.5) + 0.5, () => {
        for (const [i, y] of [0.62, 2.38].entries()) pipeIso(ctx, f, [[2.2, y, 1.05], [1.9, y, 1.05], [1.9, y, ZL - 0.05]], 6, i ? C.tealL : C.steelL, s + 220 + i);
      });
      sc.run();
    },
  },
  supercomputer: {
    head: 4.55,
    draw(ctx, f, s) {
      // A monumental compute core: three stepped tiers of violet cabinets, their seams leaking
      // cyan, a glazed crown round the glowing core; four finned radiator towers on the corners,
      // cyan coolant pipes running in. Drawn once (no ports).
      slab(ctx, f, C.steelDD, 0.04, SZ, s);
      const sc = new Scene();
      const corners = [[0.62, 0.62], [3.38, 0.62], [0.62, 3.38], [3.38, 3.38]] as const;
      for (const [i, [x, y]] of corners.entries()) {
        sc.add(f.depth(x, y), () => {
          const rr = radiatorIso(ctx, f, x - 0.36, y - 0.36, x + 0.36, y + 0.36, 2.25, s + 10 + i * 9);
          faceLeds(ctx, f, rr, 'L', 0.5, 0.25, 0.75, 3, [C.led], 1.5);
        });
        const ex = x + (2 - x) * 0.5, ey = y + (2 - y) * 0.5;
        sc.add((f.depth(x, y) + f.depth(ex, ey)) / 2, () => pipeIso(ctx, f, [[x + (2 - x) * 0.14, y + (2 - y) * 0.14, 1.2], [ex, ey, 1.2]], 6, C.cyan, s + 60 + i));
      }
      sc.add(f.depth(2, 2), () => superCore(ctx, f, s + 100));
      sc.run();
    },
  },
  auto_lab: {
    head: 3.55,
    draw(ctx, f, s) {
      // The research lab grown into an automated laboratory: a long white block banded in violet,
      // an intake hopper behind each in-port, a glazed analysis annex and instrument cabinets
      // beside it, and on its roof its own data antenna — an array panel on a turntable — and a
      // vent stack.
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const sc = new Scene();
      for (const [i, x] of [0.5, 2.5].entries()) sc.add(f.depth(x, 2.58), () => intakeHopperIso(ctx, f, x - 0.36, 2.3, x + 0.36, 2.86, 0.9, s + 1 + i * 5));
      sc.add(f.depth(1.18, 1.18), () => {
        const rr = box(ctx, f, 0.18, 0.18, 2.12, 2.16, SZ, 1.62, LAB_FACES, s + 10);
        bandIso(ctx, f, rr, SZ, SZ + 0.1, C.steelD, s + 11);
        bandIso(ctx, f, rr, 1.26, 1.44, C.violet, s + 12);
        faceGrille(ctx, f, rr, 'R', 0.08, 0.4, 0.5, 1.1, s + 13, 5);
        facePanel(ctx, f, rr, 'R', 0.5, 0.7, 0.5, 1.1, LAB, s + 14);
        faceGrille(ctx, f, rr, 'L', 0.38, 0.62, 0.48, 0.9, s + 15, 4);
        faceLeds(ctx, f, rr, 'L', 1.1, 0.06, 0.3, 4, [C.led, C.ledGreen], 1.7);
        faceLeds(ctx, f, rr, 'L', 1.1, 0.7, 0.94, 4, [C.led, C.ledGreen], 1.7);
        latheIso(ctx, f, 1.86, 1.86, [[1.62, 0.09], [2.12, 0.09], [2.12, 0.16], [2.2, 0.16], [2.24, 0.07]], C.steelL, s + 16, { top: C.steelD, seams: false });
        arrayTurntable(ctx, f, 1.0, 1.0, 0.38, 1.62, { z: 2.86, w: 0.95, h: 0.64, cols: 6, rows: 4, tilt: 0.95 }, s + 17);
      });
      sc.add(f.depth(2.57, 0.6), () => {
        box(ctx, f, 2.26, 0.22, 2.88, 0.98, SZ, 0.55, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 30);
        glassCase(ctx, f, 2.32, 0.28, 2.82, 0.92, 0.55, 1.22, s + 31, () => sampleIso(ctx, f, 2.57, 0.6, 0.55, s + 32));
      });
      sc.add(f.depth(2.57, 1.6), () => cabinetIso(ctx, f, 2.28, 1.12, 2.86, 2.1, 1.25, C.violet, s + 40, 3));
      sc.run();
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
  // The fence (D103, recipes/gleaners.ts): a low mesh cage that keeps the Gleaners off.
  fence: { head: 0.8, draw: fenceIso },
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
        const cold = isUnlit(ctx); // switched off (D83): cold coals, no flames, no sparks
        flat(ctx, ellipsePts(x, y, ex, ey, s + 3, 0.04, 24), cold ? UNLIT : C.warn);
        flat(ctx, ellipsePts(x + 2, y + 1, ex * 0.6, ey * 0.6, s + 4, 0.04, 20), C.glowPeach);
        if (!cold) {
          light(ctx, x, y - 10, 9, C.ledWarm);
          for (let i = 0; i < 5; i++) {
            const ox = (i - 2) * 8.5, h = 26 + ((i * 7) % 3) * 9 - Math.abs(i - 2) * 4;
            shape(ctx, [[x + ox - 6, y + 3], [x + ox - 2, y - h * 0.55], [x + ox + 2, y - h], [x + ox + 3, y - h * 0.5], [x + ox + 7, y + 3]], i % 2 ? C.coral : C.glowPeach, { w: 1.3, shade: false, seed: s + 5 + i });
          }
          for (const [dx, dy] of [[-12, -46], [9, -54], [2, -62]] as const) light(ctx, x + dx, y + dy, 1.4, C.ledWarm);
        }
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
  steam_boiler: {
    // A steam power plant (D114): the brick firebox with its glowing fire door and coal hopper,
    // the tall brick chimney and its plume, the pale riveted drum, and the engine — cylinder,
    // crosshead, the dynamo and the big coral flywheel on one shaft (SB, `boilerBody`). The
    // flywheel turns while it burns (moving.ts: six spokes, a sixth of a turn a period).
    head: SB_HEAD,
    moving: {
      body: boilerBody,
      part: (ctx, f, s, t) => flywheelIso(ctx, f, s + 400, t),
      // The flywheel stands beyond the plane x = SB.split, all the rest this side of it: it is the
      // nearer when the east side faces the camera.
      over: (f) => facing(f, 1),
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
        // Its steam, while it works (switched off, D83, the tower stands cold).
        if (!isUnlit(ctx)) for (const [i, [dx, dz, r]] of ([[0, 3.25, 11], [-0.18, 3.6, 13], [0.15, 3.85, 10]] as const).entries()) {
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

  // ── the second tier: production ───────────────────────────────────────────
  optics_workshop: {
    head: 2.2,
    draw(ctx, f, s) {
      // A lens-grinding works: a big glass lens on a geared turntable in its slurry basin, a
      // polishing arm reaching over it from its column, a rack of finished lenses by the outlet.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(1.55, 0.38), () => {
        box(ctx, f, 1.22, 0.14, 1.86, 0.62, SZ, 0.46, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 1);
        for (const [i, x] of [1.36, 1.54, 1.72].entries()) drumIso(ctx, f, x, 0.38, 0.62, 0.12, 0.025, 'y', mix(C.ice, C.cyan, 0.2 + i * 0.1), s + 2 + i, { shadow: false, hub: false, end: mix(C.ice, '#ffffff', 0.3) });
        pipeIso(ctx, f, [[1.24, 0.38, 0.46], [1.24, 0.38, 0.8]], 2, C.steelD, s + 6, false);
      });
      sc.add(f.depth(0.82, 0.98), () => {
        cylinder(ctx, f, 0.82, 0.98, 0.6, SZ, 0.5, C.steelD, s + 10, { top: mix(C.steelD, C.teal, 0.3) });
        gearTeeth(ctx, f, 0.82, 0.98, 0.6, 0.5, 26, s + 11);
        const c = f.p(0.82, 0.98, 0.5), [ex, ey] = f.ell(0.5);
        ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 12, 0, 40), { closed: true, w: 2.4, color: C.brass, shade: false, taper: 0, seed: s + 12 });
        flat(ctx, ellipsePts(c[0] + 2, c[1] + 1, ex * 0.86, ey * 0.86, s + 13, 0.03, 40), mix(C.ice, C.steelL, 0.45), 0.6);
        lensIso(ctx, f, 0.82, 0.98, 0.52, 0.44, s + 14);
      });
      sc.add(f.depth(1.62, 1.52), () => {
        const rr = box(ctx, f, 1.42, 1.3, 1.82, 1.74, SZ, 1.6, C.violet, s + 20);
        faceLeds(ctx, f, rr, 'L', 1.36, 0.2, 0.8, 3, LEDS, 1.6);
        faceGrille(ctx, f, rr, 'R', 0.2, 0.8, 0.5, 1.2, s + 21, 4);
        facePanel(ctx, f, rr, 'L', 0.18, 0.82, 0.5, 1.15, mix(C.violet, C.steelL, 0.3), s + 22);
      });
      sc.add(f.depth(1.2, 1.2) + 2, () => {
        pipeIso(ctx, f, [[1.62, 1.52, 1.5], [0.98, 0.84, 1.5]], 7, C.coral, s + 30);
        cylinder(ctx, f, 0.98, 0.84, 0.07, 0.9, 1.42, C.steelL, s + 31, { top: C.steelD });
        cylinder(ctx, f, 0.98, 0.84, 0.13, 0.76, 0.88, C.brass, s + 32, { top: C.brassL });
        light(ctx, ...f.p(1.62, 1.52, 1.62), 1.8, C.ledWarm);
      });
      sc.run();
    },
  },
  scriptorium: {
    head: 2.2,
    draw(ctx, f, s) {
      // A printing and binding works: a roll of peach resin canvas feeding a big printing drum,
      // a plotter table drawing a teal map (the atlas) under its gantry pen, stacks of bound
      // dark codices with brass corners by the outlet.
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.78, 2.4), () => {
        // The canvas runs off the top of the roll onto the drum.
        flat(ctx, [f.p(0.34, 2.37, 1.44), f.p(1.22, 2.37, 1.44), f.p(1.22, 1.62, 1.8), f.p(0.34, 1.62, 1.8)], C.peachL);
        ink(ctx, [f.p(0.34, 2.37, 1.44), f.p(0.34, 1.62, 1.8)], { w: 1.2, shade: false, taper: 0, jitter: 0, seed: s + 1 });
        ink(ctx, [f.p(1.22, 2.37, 1.44), f.p(1.22, 1.62, 1.8)], { w: 1.2, shade: false, taper: 0, jitter: 0, seed: s + 2 });
        for (const x of [0.24, 1.32]) box(ctx, f, x - 0.05, 2.22, x + 0.05, 2.52, SZ, 0.95, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 3 + x, { outline: 1.3 });
        drumIso(ctx, f, 0.78, 2.37, 0.95, 0.25, 0.5, 'x', C.peach, s + 5, { bands: [-0.85, 0.85], end: C.peachD });
      });
      sc.add(f.depth(0.78, 1.6), () => {
        for (const x of [0.2, 1.36]) {
          const rr = box(ctx, f, x - 0.08, 1.2, x + 0.08, 1.98, SZ, 1.45, { top: C.steelD, left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 5 + x, { outline: 1.6 });
          faceLeds(ctx, f, rr, 'L', 1.25, 0.3, 0.7, 2, [C.led, C.ledGreen], 1.4);
        }
        drumIso(ctx, f, 0.78, 1.58, 1.08, 0.36, 0.5, 'x', C.steelL, s + 8, { bands: [-0.6, 0, 0.6] });
        drumIso(ctx, f, 0.78, 1.22, 0.62, 0.13, 0.5, 'x', C.teal, s + 9, { shadow: false });
        box(ctx, f, 0.32, 0.86, 1.24, 1.14, SZ, 0.62, { top: mix(C.peachL, C.paper, 0.5), left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 10, { outline: 1.5 });
        for (let k = 0; k < 3; k++) box(ctx, f, 0.42 + k * 0.03, 0.9, 1.0 + k * 0.03, 1.1, 0.62 + k * 0.035, 0.65 + k * 0.035, { top: k === 2 ? C.teal : C.peachL }, s + 11 + k, { outline: 1, shadow: false });
      });
      plotterIso(ctx, f, sc, 1.6, 0.86, 2.84, 2.3, 0.72, s + 20);
      sc.add(f.depth(0.6, 0.5), () => {
        box(ctx, f, 0.14, 0.14, 1.06, 0.74, SZ, 0.4, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 40);
        codexStackIso(ctx, f, 0.4, 0.44, 0.4, 3, s + 41);
        codexStackIso(ctx, f, 0.84, 0.42, 0.4, 2, s + 45);
      });
      sc.add(f.depth(2.3, 0.4), () => cabinetIso(ctx, f, 1.9, 0.14, 2.84, 0.62, 1.0, C.steelL, s + 50, 2));
      sc.run();
    },
  },
  wire_mill_double: {
    head: 1.95,
    draw(ctx, f, s) {
      // The wire mill doubled: two spool lines side by side on teal beds, one drive between
      // them — a coral motor house at the back turning both lines through a common shaft.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      spoolLine(ctx, f, sc, 0.5, C.teal, s);
      spoolLine(ctx, f, sc, 1.5, mix(C.teal, C.tealL, 0.25), s + 50);
      sc.add(f.depth(1, 1.72) * 10, () => {
        pipeIso(ctx, f, [[0.5, 1.72, 0.72], [1.5, 1.72, 0.72]], 5, C.steelL, s + 80, false);
        const rr = box(ctx, f, 0.82, 1.56, 1.18, 1.88, SZ, 0.95, C.coral, s + 81, { outline: 1.8 });
        faceGrille(ctx, f, rr, 'L', 0.15, 0.85, 0.42, 0.82, s + 82, 3);
        faceLeds(ctx, f, rr, 'R', 0.8, 0.3, 0.7, 2, [C.ledWarm, C.led], 1.5);
      });
      sc.run();
    },
  },
  forge_press: {
    head: 4.0,
    draw(ctx, f, s) {
      // A heavy forging press: square violet columns, a deep crown with twin cylinders, a ram
      // over a glowing billet on its hazard-edged anvil; a brick reheating furnace with its
      // glowing mouth behind, the hydraulic power pack beside.
      slab(ctx, f, C.steelD, 0.04, SZ, s, true);
      const sc = new Scene();
      sc.add(f.depth(0.55, 2.5), () => {
        const rr = box(ctx, f, 0.16, 2.16, 0.94, 2.84, SZ, 1.25, { top: C.steelD, left: BRICK, right: mix(BRICK, C.ink, 0.35) }, s + 1);
        brickwork(ctx, f, rr, 'L', SZ, 1.25, s + 2);
        brickwork(ctx, f, rr, 'R', SZ, 1.25, s + 3);
        spyHole(ctx, f, rr, 'L', 0.5, 0.7);
        spyHole(ctx, f, rr, 'R', 0.5, 0.7);
        stackIso(ctx, f, 0.4, 2.4, 0.11, 2.2, s + 4, C.ledWarm, 1.25);
      });
      sc.add(f.depth(2.45, 2.5), () => {
        const rr = box(ctx, f, 2.1, 2.18, 2.84, 2.82, SZ, 1.05, C.teal, s + 5);
        faceGrille(ctx, f, rr, 'L', 0.12, 0.55, SZ + 0.1, 0.9, s + 6, 4);
        faceLeds(ctx, f, rr, 'L', 0.88, 0.65, 0.9, 3, LEDS, 1.6);
        drumIso(ctx, f, 2.47, 2.5, 1.2, 0.14, 0.28, 'y', C.steelL, s + 7, { bands: [-0.5, 0.5] });
        pipeIso(ctx, f, [[2.2, 2.3, 1.0], [2.2, 1.7, 1.9], [2.4, 1.6, 2.9]], 3.2, C.coral, s + 8, false);
      });
      forgeFrame(ctx, f, sc, s + 20);
      sc.run();
    },
  },
  arc_furnace: {
    head: 2.75,
    draw(ctx, f, s) {
      // An electric arc furnace: a squat refractory vessel strapped in steel under a domed lid,
      // three graphite electrodes through it glowing at their feet, held by arms from a mast;
      // heavy cables from the finned transformer; a glowing pour spout at the front. No stack.
      slab(ctx, f, C.steelD, 0.05, SZ, s, true);
      const sc = new Scene();
      const vx = 0.82, vy = 1.0;
      sc.add(f.depth(1.6, 0.52), () => {
        const rr = box(ctx, f, 1.3, 0.16, 1.88, 0.86, SZ, 1.15, C.violet, s + 1);
        fins(ctx, f, rr, 'L', SZ + 0.1, 1.05, 6, s + 2);
        fins(ctx, f, rr, 'R', SZ + 0.1, 1.05, 7, s + 3);
        for (const [i, x] of [1.45, 1.73].entries()) latheIso(ctx, f, x, 0.5, [[1.15, 0.06], [1.2, 0.09], [1.26, 0.06], [1.32, 0.09], [1.38, 0.05]], C.ice, s + 4 + i, { top: C.brassL, shadow: false, seams: false });
      });
      sc.add(f.depth(1.68, 1.6), () => {
        const rr = box(ctx, f, 1.5, 1.4, 1.86, 1.8, SZ, 2.3, C.steel, s + 10);
        faceHazard(ctx, f, rr, 'L', 0.05, 0.95, 0.5, 0.66, s + 11);
        faceLeds(ctx, f, rr, 'L', 1.9, 0.3, 0.7, 2, [C.ledWarm, C.ledRed], 1.5);
      });
      sc.add(f.depth(vx, vy), () => {
        latheIso(ctx, f, vx, vy, [[SZ, 0.6], [0.42, 0.66], [1.02, 0.66], [1.1, 0.6]], BRICK, s + 20, { top: C.steelD });
        for (const z of [0.55, 0.85]) {
          const c = f.p(vx, vy, z), [ex, ey] = f.ell(0.67);
          ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 21, 0, 40).filter(([, py]) => py >= c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 3.6, color: C.steelD, shade: false, taper: 0, seed: s + 21 + z * 10 });
        }
        // The pour spout at the front: a trough out of the vessel, molten metal glowing in it.
        const [px, py] = [vx, vy - 0.62];
        prismIso(ctx, f, [[px - 0.12, py + 0.2], [px + 0.12, py + 0.2], [px + 0.08, py - 0.3], [px - 0.08, py - 0.3]], 0.7, [0.95, 0.95, 0.82, 0.82], { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 22, { outline: 1.4 });
        ink(ctx, [f.p(px, py + 0.12, 0.96), f.p(px, py - 0.26, 0.84)], { w: 4, color: C.warn, shade: false, taper: 0, jitter: 0, seed: s + 23 });
        ink(ctx, [f.p(px, py + 0.1, 0.97), f.p(px, py - 0.24, 0.85)], { w: 1.6, color: C.glowPeach, shade: false, taper: 0, jitter: 0, seed: s + 24 });
        light(ctx, ...f.p(px, py - 0.26, 0.86), 2.8, C.ledWarm);
        latheIso(ctx, f, vx, vy, [[1.1, 0.62], [1.16, 0.62], [1.3, 0.52], [1.4, 0.34], [1.44, 0.24]], C.steelD, s + 25, { top: C.steel });
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.5, ex = vx + Math.cos(a) * 0.15, ey = vy + Math.sin(a) * 0.15;
          const g = f.p(ex, ey, 1.42);
          flat(ctx, ellipsePts(g[0], g[1], 9, 5, s + 30 + k, 0, 14), C.ledWarm, 0.35);
        }
        const els = [0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2 + 0.5; return [vx + Math.cos(a) * 0.15, vy + Math.sin(a) * 0.15] as const; })
          .sort((p, q) => f.depth(p[0], p[1]) - f.depth(q[0], q[1]));
        for (const [i, [ex, ey]] of els.entries()) {
          cylinder(ctx, f, ex, ey, 0.055, 1.38, 2.35, mix(C.steelDD, C.steel, 0.35), s + 40 + i, { top: C.steelD });
          cylinder(ctx, f, ex, ey, 0.075, 2.0, 2.1, C.brass, s + 44 + i, { top: C.brassL });
          light(ctx, ...f.p(ex, ey, 1.42), 2.2, C.ledWarm);
        }
      });
      sc.add(f.depth(1.3, 1.3) + 1, () => {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.5, ex = vx + Math.cos(a) * 0.15, ey = vy + Math.sin(a) * 0.15;
          pipeIso(ctx, f, [[1.6, 1.55, 1.95 + k * 0.1], [ex, ey, 1.95 + k * 0.1]], 4, C.steelL, s + 50 + k, false);
        }
        cableIso(ctx, f, [1.6, 0.6, 1.38], [1.62, 1.45, 2.25], 4.2, s + 55);
        cableIso(ctx, f, [1.75, 0.5, 1.38], [1.78, 1.5, 2.2], 4.2, s + 56);
      });
      sc.run();
    },
  },
  electric_smelter: {
    head: 2.3,
    draw(ctx, f, s) {
      // An induction furnace (D106): a squat crucible in a copper induction coil under laminated
      // steel yokes, the melt glowing in its ceramic mouth, a pour lip at the front; copper bus
      // bars on porcelain stand-offs from the teal inverter cabinet (its high-voltage sign, the
      // heavy cable from its terminal into a gland on its roof); a bank of capacitor cans by the
      // intake. No stack, no smoke: power, not coal — cyan arcs at the coil's leads while it works.
      slab(ctx, f, ES_SLAB, 0.05, SZ, s);
      const sc = new Scene();
      const { x: cx, y: cy } = ES_POT;
      // The inverter cabinet on the east side, its cable gland and the heavy cable to its terminal.
      sc.add(f.depth(1.63, 0.56), () => {
        const rr = cabinetIso(ctx, f, 1.38, 0.14, 1.88, 0.98, ES_CAB_Z, C.teal, s + 1, 2);
        faceHazard(ctx, f, rr, 'R', 0.06, 0.94, ES_CAB_Z - 0.16, ES_CAB_Z - 0.06, s + 2);
        hvSignIso(ctx, f, rr, 'L', 0.5, 0.62, s + 3);
        cylinder(ctx, f, 1.56, 0.72, 0.075, ES_CAB_Z, ES_CAB_Z + 0.1, C.brass, s + 4, { top: C.steelDD });
        cableIso(ctx, f, [1.74, 0.3, ES_CAB_Z + 0.22], [1.56, 0.72, ES_CAB_Z + 0.08], 5, s + 5);
      });
      // The crucible: its base drum, the coil (each turn a seam), the yokes over it, the collar and the melt.
      sc.add(f.depth(cx, cy), () => {
        const { r, coil, top } = ES_POT;
        cylinder(ctx, f, cx, cy, r - 0.02, SZ, 0.44, C.steelD, s + 10, { top: C.steelD });
        cylinder(ctx, f, cx, cy, r, 0.44, coil, COPPER, s + 11, { rings: 8 });
        const c = f.p(cx, cy, 0), [ex, ey] = f.ell(r + 0.03);
        for (const a of [0.32, 0.9, 1.5, 2.1, 2.7]) {
          const px = c[0] + Math.cos(a) * ex, py = c[1] + Math.sin(a) * ey;
          ink(ctx, [[px, py - 0.4 * ILH], [px, py - (coil + 0.04) * ILH]], { w: 5.5, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 12 });
          ink(ctx, [[px - 1.2, py - 0.42 * ILH], [px - 1.2, py - (coil + 0.02) * ILH]], { w: 1, color: C.steelL, alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: s + 13 });
        }
        cylinder(ctx, f, cx, cy, r - 0.02, coil, top, C.steelD, s + 14, { top: ES_CERAMIC });
        // The pour lip, towards the front (the outlet).
        prismIso(ctx, f, [[cx - 0.1, cy - r + 0.1], [cx + 0.1, cy - r + 0.1], [cx + 0.06, cy - r - 0.12], [cx - 0.06, cy - r - 0.12]], coil, [top, top, top - 0.06, top - 0.06], { top: ES_CERAMIC, left: C.steelD, right: mix(C.steelD, C.ink, 0.4) }, s + 15, { outline: 1.3 });
        // The melt: orange-hot, its core paler, a few dark crusts of slag.
        const m = f.p(cx, cy, top), [mx, my] = f.ell(r * 0.74);
        shape(ctx, ellipsePts(m[0], m[1], mx, my, s + 16, 0.004, 32), C.ledWarm, { w: 1.4, shade: false, seed: s + 16 });
        flat(ctx, ellipsePts(m[0] - mx * 0.16, m[1] + my * 0.1, mx * 0.4, my * 0.36, s + 17, 0.01, 24), C.glowPeach);
        for (const [dx, dy] of [[-0.5, -0.25], [0.32, 0.4], [0.55, -0.35]] as const) flat(ctx, ellipsePts(m[0] + dx * mx, m[1] + dy * my, 2.6, 1.4, s + 18, 0, 10), mix(C.coralD, C.ink, 0.3), 0.85);
        if (!isUnlit(ctx)) {
          // Over the melt: arcs jumping across it.
          sparkIso(ctx, [m[0] - mx * 0.85, m[1] - 1], [m[0] + mx * 0.2, m[1] - 9], 5, s + 20);
          sparkIso(ctx, [m[0] + mx * 0.15, m[1] - 8], [m[0] + mx * 0.8, m[1] - 2], 4, s + 21);
        }
      });
      // The bus bars, coil leads to the cabinet, on porcelain stand-offs; arcs at the leads.
      sc.add(f.depth(1.4, 1.32), () => {
        for (const [i, [x, y]] of ([[1.62, 1.32], [1.62, 1.04]] as const).entries()) {
          cylinder(ctx, f, x, y, 0.05, SZ, 0.82, C.steelD, s + 30 + i, { top: C.steel });
          latheIso(ctx, f, x, y, [[0.82, 0.06], [0.86, 0.085], [0.9, 0.06], [0.94, 0.085], [0.98, 0.05]], C.ice, s + 32 + i, { top: C.brassL, shadow: false, seams: false });
        }
        for (const [k, z] of [1.0, 1.12].entries()) {
          const run: Array<[number, number, number]> = [[1.62 - k * 0.06, 0.98, z], [1.62 - k * 0.06, 1.32 - k * 0.06, z], [cx + 0.38 - k * 0.04, 1.32 - k * 0.06, z]];
          pipeIso(ctx, f, run, 3.6, COPPER, s + 34 + k, false);
        }
        if (!isUnlit(ctx)) for (const [k, z] of [1.0, 1.12].entries()) {
          const a = f.p(cx + 0.38 - k * 0.04, 1.32 - k * 0.06, z), b = f.p(cx + 0.18, cy + 0.44, z + 0.2 + k * 0.08);
          sparkIso(ctx, a, b, 5, s + 40 + k);
        }
      });
      // The capacitor bank by the intake: cans on a low rack, a brass bus strap across their caps.
      sc.add(f.depth(1.6, 1.68), () => {
        const rr = box(ctx, f, 1.26, 1.46, 1.9, 1.88, SZ, 0.44, { top: C.steelDD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 50, { outline: 1.6 });
        faceLeds(ctx, f, rr, 'L', 0.37, 0.15, 0.4, 2, [C.ledGreen, C.led], 1.4);
        const cans: Array<[number, number]> = [];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) cans.push([1.38 + i * 0.2, 1.56 + j * 0.2]);
        cans.sort((p, q) => f.depth(p[0], p[1]) - f.depth(q[0], q[1]));
        for (const [i, [x, y]] of cans.entries()) cylinder(ctx, f, x, y, 0.07, 0.44, 0.74, CAN, s + 51 + i, { top: CAN_L, rings: 1 });
        ink(ctx, [f.p(1.36, 1.66, 0.76), f.p(1.8, 1.66, 0.76)], { w: 2.4, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 58 });
      });
      sc.run();
    },
  },
  etcher: {
    head: 2.9,
    draw(ctx, f, s) {
      // A clean-room etching line: a long sealed white hood down the middle, its UV windows
      // glowing violet, ducts along its ridge to a scrubber stack; wafer racks by the outlet, a
      // load lock over each intake, the control cabinet.
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const sc = new Scene();
      for (const [i, x] of [0.5, 2.5].entries()) sc.add(f.depth(x, 2.6), () => {
        const rr = box(ctx, f, x - 0.3, 2.42, x + 0.3, 2.84, SZ, 0.82, LAB_FACES, s + 1 + i * 3, { outline: 1.6 });
        faceGlow(ctx, f, rr, 'L', 0.2, 0.8, 0.55, 0.68, C.led);
        bandIso(ctx, f, rr, 0.74, 0.82, C.violet, s + 2 + i * 3);
      });
      sc.add(f.depth(1.5, 1.45), () => {
        const rr = box(ctx, f, 0.62, 0.3, 2.38, 2.6, SZ, 1.2, LAB_FACES, s + 10);
        bandIso(ctx, f, rr, SZ, SZ + 0.1, C.steelD, s + 11);
        for (const face of ['L', 'R'] as const) {
          const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1], n = Math.max(2, Math.round(len / 0.5));
          for (let k = 0; k < n; k++) {
            const u0 = (k + 0.2) / n, u1 = (k + 0.8) / n;
            flat(ctx, faceQuad(f, rr, face, u0 - 0.02, u1 + 0.02, 0.5, 0.98), C.violetL, 0.3);
            shape(ctx, faceQuad(f, rr, face, u0, u1, 0.55, 0.92), mix(C.violetL, '#ffffff', face === 'L' ? 0.25 : 0), { w: 1.2, shade: false, jitter: 0, seed: s + 12 + k });
            ink(ctx, [facePt(f, rr, face, u0 + 0.02, 0.88), facePt(f, rr, face, u1 - 0.02, 0.88)], { w: 1.2, color: '#ffffff', alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 20 + k });
          }
          faceLeds(ctx, f, rr, face, 1.08, 0.1, 0.3, 3, [C.led, C.ledGreen], 1.4);
        }
        vaultIso(ctx, f, 0.7, 0.36, 2.3, 2.54, 1.2, 1.62, C.ice, 6, 'y', s + 30);
        pipeIso(ctx, f, [[1.5, 0.5, 1.7], [1.5, 2.2, 1.7], [2.62, 2.2, 1.7]], 7, C.steelL, s + 31);
      });
      for (const [i, x] of [0.36, 2.64].entries()) sc.add(f.depth(x, 0.6), () => waferRackIso(ctx, f, x, 0.6, s + 40 + i * 9));
      sc.add(f.depth(2.66, 1.45), () => cabinetIso(ctx, f, 2.48, 1.02, 2.86, 1.9, 1.15, C.violet, s + 60, 2));
      sc.add(f.depth(2.66, 2.2) + 0.5, () => latheIso(ctx, f, 2.66, 2.2, [[1.15, 0.16], [2.5, 0.16], [2.5, 0.2], [2.62, 0.2]], C.steelL, s + 62, { open: C.ink }));
      sc.run();
    },
  },
  chip_fab: {
    head: 5.3,
    draw(ctx, f, s) {
      // A chip fab: a big sealed white hall glowing in violet strips, its roof crowded with air
      // handlers and ducts that run to a tall exhaust filter tower; load locks over the intakes.
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const sc = new Scene();
      for (const [i, x] of [1.5, 2.5].entries()) sc.add(f.depth(x, 3.65), () => {
        const rr = box(ctx, f, x - 0.32, 3.42, x + 0.32, 3.86, SZ, 0.85, LAB_FACES, s + 1 + i * 3, { outline: 1.6 });
        faceGlow(ctx, f, rr, 'L', 0.2, 0.8, 0.55, 0.68, C.led);
        bandIso(ctx, f, rr, 0.77, 0.85, C.violet, s + 2 + i * 3);
      });
      sc.add(f.depth(1.62, 1.85), () => {
        const rr = box(ctx, f, 0.2, 0.3, 3.04, 3.4, SZ, 2.05, LAB_FACES, s + 10);
        bandIso(ctx, f, rr, SZ, SZ + 0.12, C.steelD, s + 11);
        for (const z of [0.92, 1.66]) {
          for (const face of ['L', 'R'] as const) flat(ctx, faceQuad(f, rr, face, 0, 1, z - 0.08, z + 0.28), C.violetL, 0.35);
          bandIso(ctx, f, rr, z, z + 0.2, C.violetL, s + 12 + z);
          for (const face of ['L', 'R'] as const) ink(ctx, [facePt(f, rr, face, 0.01, z + 0.1), facePt(f, rr, face, 0.99, z + 0.1)], { w: 2, color: mix(C.violetL, '#ffffff', 0.6), shade: false, taper: 0, jitter: 0, seed: s + 14 });
        }
        for (const face of ['L', 'R'] as const) {
          faceGrille(ctx, f, rr, face, 0.06, 0.22, 0.45, 0.85, s + 15, 4);
          faceLeds(ctx, f, rr, face, 1.38, 0.3, 0.7, 6, [C.led, C.ledGreen], 1.5);
        }
        for (const [i, [x, y]] of ([[0.75, 0.9], [1.6, 0.9], [0.75, 2.6], [1.6, 2.6]] as const).entries()) {
          const u = box(ctx, f, x - 0.32, y - 0.32, x + 0.32, y + 0.32, 2.05, 2.4, { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 20 + i * 4, { outline: 1.5 });
          faceGrille(ctx, f, u, 'L', 0.15, 0.85, 2.1, 2.32, s + 21 + i * 4, 2);
          fanIso(ctx, f, x, y, 2.4, 0.22, s + 22 + i * 4);
        }
        pipeIso(ctx, f, [[2.45, 2.6, 2.3], [2.45, 0.9, 2.3], [3.45, 0.9, 2.3]], 9, C.steelL, s + 40);
        pipeIso(ctx, f, [[1.95, 1.75, 2.15], [2.45, 1.75, 2.15]], 7, C.steelL, s + 41);
      });
      sc.add(f.depth(3.5, 0.85), () => {
        latheIso(ctx, f, 3.5, 0.85, [[SZ, 0.42], [0.5, 0.42], [0.5, 0.34], [3.6, 0.3], [3.6, 0.38], [4.1, 0.38], [4.1, 0.3], [4.6, 0.26], [4.6, 0.3], [4.72, 0.3]], C.steelL, s + 50, { open: C.ink });
        for (const z of [1.4, 2.5]) {
          const c = f.p(3.5, 0.85, z), [ex, ey] = f.ell(0.33);
          ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 51, 0, 32).filter(([, py]) => py >= c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 4, color: C.violet, shade: false, taper: 0, seed: s + 52 + z });
        }
        ringGrille(ctx, f, 3.5, 0.85, 0.385, 3.72, 4.0, s + 53);
        light(ctx, ...f.p(3.5, 0.85, 4.85), 2.6, C.ledRed);
      });
      sc.run();
    },
  },

  // ── the second tier: extraction and logistics ──────────────────────────────
  sifter: {
    head: 2.25,
    draw(ctx, f, s) {
      // A vibrating screen: a mesh deck sloping from the intake at the back down over a hopper,
      // riding on coil springs, its vibrator motor on its flank; the sifted sand in the hopper
      // (the outlet), heaps of sand and ore grains sorted apart beside it.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.72, 0.62), () => {
        const top = frustumIso(ctx, f, 0.36, 0.28, 1.08, 0.96, SZ, 0.78, -0.07, OCHRE_FACES, s + 1, { open: C.ink });
        sandHeap(ctx, top, s + 2);
      });
      sc.add(f.depth(1.62, 0.55), () => heapIso(ctx, f, 1.62, 0.55, 0.28, 0.8, SANDFILL, s + 3));
      sc.add(f.depth(1.63, 1.45), () => heapIso(ctx, f, 1.63, 1.45, 0.27, 0.75, mix(C.mesa, '#9b5a3c', 0.55), s + 4, C.ink));
      const yb = 1.78, yf = 0.62, zb = 1.72, zf = 1.1, x0 = 0.2, x1 = 1.24;
      const P = (x: number, u: number, dz = 0): Pt => f.p(x, yb + (yf - yb) * u, zb + (zf - zb) * u + dz);
      const zAt = (y: number): number => zb + ((zf - zb) * (y - yb)) / (yf - yb);
      for (const [i, [x, y]] of ([[0.24, 0.74], [1.2, 0.74], [0.24, 1.66], [1.2, 1.66]] as const).entries()) {
        sc.add(f.depth(x, y) + 0.4, () => {
          box(ctx, f, x - 0.06, y - 0.06, x + 0.06, y + 0.06, SZ, zAt(y) - 0.42, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 10 + i, { outline: 1.2 });
          springIso(ctx, f, x, y, zAt(y) - 0.42, zAt(y) - 0.1, s + 14 + i);
        });
      }
      sc.add(f.depth(0.72, 1.06) + 1.5, () => {
        const deck: Pt[] = [P(x0, 0), P(x1, 0), P(x1, 1), P(x0, 1)];
        // Side plates under the mesh, then the mesh with its riding grains, then the rails.
        for (const x of [x0, x1]) flat(ctx, [P(x, 0), P(x, 1), P(x, 1, -0.16), P(x, 0, -0.16)], x === x1 ? mix(C.teal, C.ink, 0.35) : C.teal);
        flat(ctx, [P(x0, 1), P(x1, 1), P(x1, 1, -0.16), P(x0, 1, -0.16)], mix(C.teal, C.ink, 0.15));
        flat(ctx, deck, mix(SANDFILL, C.ink, 0.12));
        for (let i = 1; i < 12; i++) ink(ctx, [P(x0 + ((x1 - x0) * i) / 12, 0.02), P(x0 + ((x1 - x0) * i) / 12, 0.98)], { w: 0.7, color: mix(C.teal, C.ink, 0.5), alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 20 + i });
        for (let j = 1; j < 8; j++) ink(ctx, [P(x0 + 0.02, j / 8), P(x1 - 0.02, j / 8)], { w: 0.7, color: mix(C.teal, C.ink, 0.5), alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 32 + j });
        const rng = makeRng(s + 40);
        for (let k = 0; k < 22; k++) {
          const p = P(x0 + 0.08 + rng.next() * (x1 - x0 - 0.16), 0.05 + rng.next() * 0.75);
          flat(ctx, ellipsePts(p[0], p[1], 2.2, 1.6, s + k, 0.2, 8), k % 3 ? SANDFILL : mix(C.mesa, '#9b5a3c', 0.6));
        }
        ink(ctx, deck, { closed: true, w: 1.5, seed: s + 41 });
        for (const x of [x0, x1]) ink(ctx, [P(x, 0, 0.04), P(x, 1, 0.04)], { w: 3, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 42 });
        // The lips: sand falls through into the hopper, the oversize spills off the front.
        ink(ctx, [P(0.55, 1, -0.16), f.p(0.6, 0.5, 0.82)], { w: 3, color: SANDFILL, alpha: 0.9, shade: false, taper: 0.5, seed: s + 43 });
        const mr = box(ctx, f, x1, 0.92, x1 + 0.2, 1.22, zAt(1.07) - 0.25, zAt(1.07) + 0.12, { top: C.steelD, left: C.coral, right: mix(C.coral, C.ink, 0.42) }, s + 44, { outline: 1.4, shadow: false });
        faceLeds(ctx, f, mr, 'L', zAt(1.07) - 0.02, 0.3, 0.7, 2, [C.ledWarm, C.led], 1.3);
        drumIso(ctx, f, x1 + 0.1, 1.07, zAt(1.07) - 0.3, 0.07, 0.12, 'y', C.steelL, s + 45, { shadow: false });
      });
      sc.run();
    },
  },
  face_cutter: {
    // A face cutter (D87): a continuous miner in miniature whose drum turns into the cliff behind
    // it (its back), the quartz carried to its outlet at the front (moving.ts `CUTTER`).
    head: 1.8,
    moving: {
      body: cutterBody,
      part: cutterDrum,
      // The drum's side is the nearer one when the back (S) is turned to the camera.
      over: (f) => f.depth(1, CUTTER.cy) > f.depth(1, 0.1),
    },
  },
  quartz_workshop: {
    // The quartz workshop (D87): saw bench, winding spindle, lapping wheel, a tray of oscillators.
    head: 1.85,
    draw: quartzWorkshopIso,
  },
  fast_drill: {
    head: 3.4,
    draw(ctx, f, s) {
      // The drill, beefier: two derricks over two geared tables, their augers driven by a
      // steel gearbox banded in coral with its twin motor drums.
      slab(ctx, f, C.steel, 0.05, SZ, s, true);
      const sc = new Scene();
      for (const [i, x] of [0.5, 1.42].entries()) sc.add(f.depth(x, 0.64), () => {
        cylinder(ctx, f, x, 0.64, 0.3, SZ, 0.5, C.steelD, s + 3 + i * 10, { top: C.brass });
        gearTeeth(ctx, f, x, 0.64, 0.3, 0.5, 16, s + 4 + i * 10);
        trussIso(ctx, f, x, 0.64, 0.3, 0.07, 0.5, 2.95, 5, C.steelL, s + 5 + i * 10, 2.8);
        pipeIso(ctx, f, [[x, 0.64, 2.86], [x, 0.64, 0.58]], 4.2, C.brassL, s + 6 + i * 10, false);
        box(ctx, f, x - 0.09, 0.55, x + 0.09, 0.73, 2.92, 3.08, { top: C.coral }, s + 7 + i * 10, { outline: 1.4, shadow: false });
        light(ctx, ...f.p(x, 0.64, 3.15), 2.6, C.ledWarm);
      });
      sc.add(f.depth(1.0, 1.5), () => {
        const rr = box(ctx, f, 0.14, 1.12, 1.86, 1.86, SZ, 1.0, C.steel, s + 30);
        bandIso(ctx, f, rr, 0.64, 0.8, C.coral, s + 31);
        faceHazard(ctx, f, rr, 'L', 0.04, 0.96, SZ + 0.04, SZ + 0.13, s + 32);
        faceGrille(ctx, f, rr, 'L', 0.64, 0.94, SZ + 0.18, 0.58, s + 33, 3);
        faceLeds(ctx, f, rr, 'L', 0.9, 0.08, 0.4, 4, LEDS);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.12, 0.58, s + 34, 3);
        for (const [i, x] of [0.62, 1.3].entries()) drumIso(ctx, f, x, 1.5, 1.18, 0.16, 0.26, 'x', C.steelL, s + 35 + i, { bands: [-0.5, 0.5] });
        for (const [i, x] of [0.5, 1.42].entries()) pipeIso(ctx, f, [[x, 1.2, 0.9], [x, 0.94, 0.56]], 5, C.steelD, s + 38 + i);
      });
      sc.run();
    },
  },
  giant_drill: {
    head: 6.9,
    draw(ctx, f, s) {
      // A huge mining rig: a drill floor on its armoured sub-structure, a towering derrick over
      // a geared table and its drill string, the draw-works drum, a pipe rack down one side,
      // two coral power houses with their stacks at the back.
      slab(ctx, f, C.steelD, 0.04, SZ, s, true);
      const sc = new Scene();
      sc.add(f.depth(3.66, 1.7), () => {
        for (const y of [0.55, 1.7, 2.85]) for (const x of [3.48, 3.84]) pipeIso(ctx, f, [[x, y, SZ], [x, y, 0.95]], 3, C.steelD, s + 10 + x * 10 + y, false);
        const tubes = [[3.54, 1.0], [3.66, 1.0], [3.78, 1.0], [3.6, 1.13], [3.72, 1.13], [3.66, 1.26]] as const;
        for (const [i, [x, z]] of [...tubes].sort((a, b) => f.depth(a[0], 1) - f.depth(b[0], 1) || a[1] - b[1]).entries()) drumIso(ctx, f, x, 1.7, z, 0.06, 1.25, 'y', i % 2 ? C.steelL : C.ice, s + 20 + i, { shadow: false, hub: false });
      });
      for (const [i, x0] of [0.18, 2.32].entries()) sc.add(f.depth(x0 + 0.65, 3.5), () => {
        const rr = box(ctx, f, x0, 3.16, x0 + 1.3, 3.86, SZ, 1.35, C.coral, s + 30 + i * 9);
        faceGrille(ctx, f, rr, 'L', 0.08, 0.5, SZ + 0.12, 1.15, s + 31 + i * 9, 4);
        faceLeds(ctx, f, rr, 'L', 1.2, 0.6, 0.92, 3, [C.ledWarm, C.led, C.ledWarm]);
        faceGrille(ctx, f, rr, 'R', 0.12, 0.88, SZ + 0.12, 1.15, s + 32 + i * 9, 4);
        stackIso(ctx, f, x0 + 1.02, 3.42, 0.14, 2.9, s + 33 + i * 9, C.ledWarm, 1.35);
      });
      sc.add(f.depth(1.8, 1.7), () => {
        const rr = box(ctx, f, 0.3, 0.42, 3.3, 2.96, SZ, 1.2, C.steel, s + 50);
        faceHazard(ctx, f, rr, 'L', 0.03, 0.97, 1.02, 1.14, s + 51);
        faceHazard(ctx, f, rr, 'R', 0.03, 0.97, 1.02, 1.14, s + 52);
        for (const face of ['L', 'R'] as const) for (let k = 0; k < 4; k++) faceGrille(ctx, f, rr, face, 0.06 + k * 0.24, 0.2 + k * 0.24, SZ + 0.12, 0.88, s + 53 + k, 3);
        drumIso(ctx, f, 1.8, 2.5, 1.55, 0.24, 0.62, 'x', C.brass, s + 60, { bands: [-0.7, -0.3, 0.3, 0.7] });
        box(ctx, f, 0.52, 2.2, 0.98, 2.8, 1.2, 1.75, { top: C.steelD, left: C.violet, right: mix(C.violet, C.ink, 0.4) }, s + 61, { outline: 1.6 });
        cylinder(ctx, f, 1.8, 1.42, 0.56, 1.2, 1.42, C.steelD, s + 62, { top: C.brass });
        gearTeeth(ctx, f, 1.8, 1.42, 0.56, 1.42, 28, s + 63);
        trussIso(ctx, f, 1.8, 1.42, 1.0, 0.2, 1.42, 6.35, 9, C.steelL, s + 64, 4.2);
        pipeIso(ctx, f, [[1.8, 1.42, 6.2], [1.8, 1.42, 1.48]], 6.5, C.brassL, s + 65, false);
        box(ctx, f, 1.56, 1.18, 2.04, 1.66, 6.28, 6.58, { top: C.coral }, s + 66, { outline: 1.7, shadow: false });
        light(ctx, ...f.p(1.8, 1.42, 6.7), 3.2, C.ledRed);
        cableIso(ctx, f, [1.8, 2.3, 1.75], [1.8, 1.6, 5.9], 2.4, s + 67);
      });
      sc.run();
    },
  },
  hp_pump: {
    head: 2.25,
    draw(ctx, f, s) {
      // A bigger pump: a banded pressure vessel on saddles with its big gauge, the teal motor
      // driving it, and at the outlet a tall standpipe brimming into its chalice, a coral valve.
      slab(ctx, f, C.steel, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(0.5, 1.48), () => {
        const rr = box(ctx, f, 0.14, 1.12, 0.86, 1.86, SZ, 0.9, C.teal, s + 1);
        faceGrille(ctx, f, rr, 'L', 0.12, 0.58, SZ + 0.1, 0.78, s + 2, 3);
        faceLeds(ctx, f, rr, 'L', 0.74, 0.68, 0.9, 2, [C.led, C.ledGreen], 1.6);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.1, 0.78, s + 3, 3);
        drumIso(ctx, f, 0.5, 1.48, 1.08, 0.16, 0.3, 'y', C.steelL, s + 4, { bands: [-0.5, 0.5] });
      });
      sc.add(f.depth(1.42, 1.02), () => {
        for (const y of [0.62, 1.42]) box(ctx, f, 1.2, y - 0.08, 1.64, y + 0.08, SZ, 0.55, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 10 + y * 10, { outline: 1.3 });
        drumIso(ctx, f, 1.42, 1.02, 1.0, 0.34, 0.66, 'y', mix(C.ice, C.tealL, 0.25), s + 12, { bands: [-0.62, 0, 0.62], end: mix(C.tealL, C.ink, 0.1) });
        pipeIso(ctx, f, [[1.42, 1.02, 1.62], [1.42, 1.02, 1.86]], 2.6, C.steelD, s + 13, false);
        const g = f.p(1.42, 1.02, 2.02);
        shape(ctx, ellipsePts(g[0], g[1], 10, 10, s + 14, 0, 24), C.steelD, { w: 1.4, shade: false, jitter: 0, seed: s + 14 });
        flat(ctx, ellipsePts(g[0], g[1], 7.5, 7.5, s + 15, 0, 24), C.paper);
        for (let k = 0; k < 7; k++) { const a = Math.PI * (0.8 + (k / 6) * 1.4); ink(ctx, [[g[0] + Math.cos(a) * 5.5, g[1] + Math.sin(a) * 5.5], [g[0] + Math.cos(a) * 7, g[1] + Math.sin(a) * 7]], { w: 0.9, shade: false, taper: 0, jitter: 0, seed: s + 16 + k }); }
        ink(ctx, [[g[0], g[1]], [g[0] + 5, g[1] - 3]], { w: 1.6, color: C.coral, shade: false, taper: 0, jitter: 0, seed: s + 24 });
        flat(ctx, ellipsePts(g[0], g[1], 1.5, 1.5, s + 25, 0, 8), C.ink);
      });
      sc.add(f.depth(0.5, 0.5), () => {
        latheIso(ctx, f, 0.5, 0.48, [[SZ, 0.17], [0.95, 0.15], [1.02, 0.2], [1.55, 0.42], [1.62, 0.44]], C.tealL, s + 30, { open: C.deep });
        for (const z of [0.55, 0.8]) {
          const c = f.p(0.5, 0.48, z), [ex, ey] = f.ell(0.17);
          ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 31, 0, 20).filter(([, y]) => y >= c[1] - 0.5).sort((a, b) => a[0] - b[0]), { w: 2.4, color: C.steelD, shade: false, taper: 0, seed: s + 32 + z * 10 });
        }
        const c = f.p(0.5, 0.48, 1.62), [ex, ey] = f.ell(0.3);
        ink(ctx, ellipsePts(c[0] + 2, c[1] + 1, ex, ey, s + 33, 0.05, 24), { closed: true, w: 1.2, color: C.shallow, alpha: 0.9, shade: false, seed: s + 33 });
        const v = f.p(0.5, 0.48, 0.66);
        ink(ctx, ellipsePts(v[0] - 9, v[1] + 2, 6, 7, s + 34, 0, 16), { closed: true, w: 2.2, color: C.coral, shade: false, seed: s + 34 });
      });
      sc.add(f.depth(1, 1) + 1.2, () => {
        pipeIso(ctx, f, [[0.86, 1.4, 0.7], [1.15, 1.25, 0.8]], 5.5, C.steelL, s + 40);
        pipeIso(ctx, f, [[1.25, 0.5, 0.85], [0.66, 0.5, 0.85]], 6.5, C.coral, s + 41);
      });
      sc.run();
    },
  },
  heavy_excavator: {
    head: 4.55,
    draw(ctx, f, s) {
      // The excavator, heavier: crawler tracks under a bigger turret banded in hazard stripes, a
      // heavier counterweight and exhaust, thick coral boom arms carrying a bucket wheel whose
      // buckets bite the rock ahead (N) and come up full.
      slab(ctx, f, C.steel, 0.04, SZ, s, true);
      const sc = new Scene();
      for (const [i, x] of [0.45, 2.55].entries()) sc.add(f.depth(x, 1.9), () => crawler(ctx, f, x, 0.92, 2.88, s + 10 * i));
      sc.add(f.depth(1.5, 2.05), () => {
        const rr = box(ctx, f, 0.72, 1.28, 2.28, 2.44, 0.78, 1.82, C.violet, s + 1);
        faceHazard(ctx, f, rr, 'L', 0.02, 0.98, 1.58, 1.72, s + 2);
        faceHazard(ctx, f, rr, 'R', 0.02, 0.98, 1.58, 1.72, s + 3);
        faceGrille(ctx, f, rr, 'R', 0.08, 0.5, 0.92, 1.48, s + 4);
        faceLeds(ctx, f, rr, 'L', 1.42, 0.08, 0.42, 5, [C.ledWarm, C.ledRed]);
        facePanel(ctx, f, rr, 'L', 0.55, 0.82, 0.86, 1.46, C.steelL, s + 5);
        const cw = box(ctx, f, 0.74, 2.44, 2.26, 2.86, 0.78, 1.62, C.steelD, s + 6);
        faceHazard(ctx, f, cw, 'L', 0.04, 0.96, 0.86, 1.04, s + 7);
        faceHazard(ctx, f, cw, 'R', 0.04, 0.96, 0.86, 1.04, s + 8);
        stackIso(ctx, f, 2.02, 1.68, 0.11, 2.55, s + 9, C.ledWarm, 1.82);
        stackIso(ctx, f, 1.78, 1.68, 0.09, 2.4, s + 10, C.ledWarm, 1.82);
      });
      sc.add(f.depth(1.5, 0.7), () => {
        pipeIso(ctx, f, [[0.92, 1.42, 1.6], [0.98, 0.6, 2.25]], 10, C.coral, s + 11);
        pipeIso(ctx, f, [[2.08, 1.42, 1.6], [2.02, 0.6, 2.25]], 10, C.coral, s + 12);
        bucketWheelIso(ctx, f, 1.5, 0.52, 2.25, 0.98, 0.17, 'y', 10, 0.2, C.steelL, s + 13, { bucket: C.brass, load: mix(C.dug, C.mesa, 0.3), full: bucketFull });
        drumIso(ctx, f, 1.5, 0.52, 2.25, 0.12, 0.42, 'y', C.steelD, s + 14, { shadow: false });
      });
      sc.run();
    },
  },
  big_silo: {
    head: 3.75,
    draw(ctx, f, s) {
      // Three store tanks in a cluster, each the silo's (banded, a catwalk rail, a cone roof,
      // ladder and glowing level gauge), their roofs joined by walkways to a head house.
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const tanks = ([[0.82, 0.84], [2.18, 0.84], [1.5, 2.12]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
      for (const [i, [x, y]] of tanks.entries()) siloTank(ctx, f, x, y, 0.6, 2.9, s + 10 + i * 20);
      const hx = 1.5, hy = 1.27, zw = 2.96;
      for (const [i, [x, y]] of ([[0.82, 0.84], [2.18, 0.84], [1.5, 2.12]] as const).entries()) {
        const dx = hx - x, dy = hy - y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
        const a: V3 = [x + ux * 0.5, y + uy * 0.5, zw], b: V3 = [hx - ux * 0.2, hy - uy * 0.2, zw];
        ink(ctx, [f.p(...a), f.p(...b)], { w: 5, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 80 + i });
        ink(ctx, [f.p(...a), f.p(...b)], { w: 3, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 81 + i });
        ink(ctx, [f.p(a[0], a[1], zw + 0.2), f.p(b[0], b[1], zw + 0.2)], { w: 1.2, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 82 + i });
      }
      const rr = box(ctx, f, hx - 0.22, hy - 0.2, hx + 0.22, hy + 0.2, zw - 0.1, zw + 0.42, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 90, { outline: 1.5 });
      faceLeds(ctx, f, rr, 'L', zw + 0.28, 0.3, 0.7, 2, [C.led, C.ledGreen], 1.4);
      light(ctx, ...f.p(hx, hy, zw + 0.5), 2.4, C.coral);
      const sr = f.rect(0.05, 0.05, 2.95, 2.95);
      faceLeds(ctx, f, sr, 'L', SZ * 0.5, 0.1, 0.3, 4, LEDS);
    },
  },

  // ── the second tier: energy ───────────────────────────────────────────────
  pitch_turbine: {
    // The wind flower's tower under an H-rotor whose ice-teal blades are pitched on brass
    // knuckles, coral-tipped; a coral band round its bearing (moving.ts `PITCH_ROTOR`).
    head: PITCH_ROTOR.top + 0.25,
    moving: {
      body: (ctx, f, s) => turbineBody(ctx, f, s, WIND, C.coral),
      part: (ctx, f, s, t) => hRotorIso(ctx, f, PITCH_ROTOR, s, t),
      over: () => true,
      shadow: (ctx, f, s) => hRotorShadow(ctx, f, PITCH_ROTOR, s),
    },
  },
  big_turbine: {
    // The wind tower half as big again and much taller, a teal band round its bearing, under a
    // four-bladed H-rotor of long white pitched blades on three strut levels (`BIG_ROTOR`).
    head: BIG_ROTOR.top + 0.25,
    moving: {
      body: (ctx, f, s) => turbineBody(ctx, f, s, BIG_WIND, C.teal),
      part: (ctx, f, s, t) => hRotorIso(ctx, f, BIG_ROTOR, s, t),
      over: () => true,
      shadow: (ctx, f, s) => hRotorShadow(ctx, f, BIG_ROTOR, s),
    },
  },
  heavy_accumulator: {
    head: 2.5,
    draw(ctx, f, s) {
      // The capacitor bank, heavier: four taller, fatter cans with two green charge rings and a
      // steel ring band each, twin brass posts on their lids, heavy brass bus bars on porcelain
      // running in to a coral junction block over the middle.
      slab(ctx, f, C.steelD, 0.05, SZ, s);
      const cells = ([[0.55, 0.55, C.violet], [1.45, 0.55, C.violetL], [0.55, 1.45, C.violetL], [1.45, 1.45, C.violet]] as const).slice().sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
      const junction = (): void => {
        latheIso(ctx, f, 1, 1, [[SZ, 0.09], [0.5, 0.09], [0.55, 0.13], [0.62, 0.09], [0.85, 0.09], [0.9, 0.13], [0.97, 0.09], [1.2, 0.09], [1.25, 0.13], [1.32, 0.09], [1.62, 0.08]], C.ice, s + 60, { top: C.steelD, seams: false });
        const rr = box(ctx, f, 0.84, 0.84, 1.16, 1.16, 1.62, 1.9, { top: C.coral, left: C.coral, right: mix(C.coral, C.ink, 0.42) }, s + 61, { outline: 1.6 });
        faceHazard(ctx, f, rr, 'L', 0.05, 0.95, 1.65, 1.74, s + 62);
      };
      let jDone = false;
      for (const [i, [x, y, col]] of cells.entries()) {
        if (!jDone && f.depth(x, y) > f.depth(1, 1)) { junction(); jDone = true; }
        latheIso(ctx, f, x, y, [[SZ, 0.43], [SZ + 0.08, 0.43], [SZ + 0.08, 0.39], [0.62, 0.39], [0.92, 0.39], [1.22, 0.39], [1.5, 0.39], [1.5, 0.33], [1.58, 0.33], [1.58, 0.25], [1.64, 0.25]], col, s + i * 5, { top: C.steelD });
        for (const [k, z] of [0.75, 1.08].entries()) {
          const b = f.p(x, y, z), [ex, ey] = f.ell(0.39);
          ink(ctx, ellipsePts(b[0], b[1], ex, ey, s + 20 + i, 0, 32).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 3.4, color: C.ledGreen, shade: false, taper: 0, seed: s + 21 + i + k });
        }
        const b = f.p(x, y, 1.36), [ex, ey] = f.ell(0.395);
        ink(ctx, ellipsePts(b[0], b[1], ex, ey, s + 30 + i, 0, 32).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 5, color: C.steelDD, shade: false, taper: 0, seed: s + 31 + i });
        for (const [k, d] of [-0.11, 0.11].entries()) {
          const [tx, ty] = facingDir(f, d, -d);
          cylinder(ctx, f, x + tx, y + ty, 0.055, 1.64, 1.86, C.brass, s + 40 + i * 2 + k, { top: C.brassL });
        }
        light(ctx, ...f.p(x, y, 1.66), 1.8, C.ledGreen);
      }
      if (!jDone) junction();
      for (const [i, [x, y]] of ([[0.55, 0.55], [1.45, 0.55], [0.55, 1.45], [1.45, 1.45]] as const).entries()) {
        pipeIso(ctx, f, [[x, y, 1.86], [x + (1 - x) * 0.5, y + (1 - y) * 0.5, 1.86], [x + (1 - x) * 0.8, y + (1 - y) * 0.8, 1.78]], 4.6, C.brass, s + 50 + i, false);
      }
      const rr = f.rect(0.05, 0.05, 1.95, 1.95);
      faceLeds(ctx, f, rr, 'L', SZ * 0.5, 0.12, 0.62, 6, [C.ledGreen, C.ledGreen, C.ledGreen, C.ledGreen, C.led, C.ledWarm]);
    },
  },
  solar_farm: {
    head: 1.5,
    draw(ctx, f, s) {
      // Rows of solar panels tilted to the sun on short legs (their cells are `pvPanel`'s, so the
      // day and night views find them), the inverter cabinet in the corner. Drawn once (no ports).
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const rows: ReadonlyArray<readonly [number, number, number, number, number]> = [
        [0.16, 0.14, 2.84, 0.6, 4], [0.16, 0.84, 2.84, 1.3, 4], [0.16, 1.54, 2.84, 2.0, 4], [0.16, 2.26, 2.12, 2.72, 3],
      ];
      for (const [i, [a0, b0, a1, b1, m]] of rows.entries()) pvRowIso(ctx, f, a0, b0, a1, b1, SZ, m, s + 10 + i * 20);
      const rr = box(ctx, f, 2.3, 2.26, 2.86, 2.86, SZ, 0.95, C.teal, s + 100);
      faceGrille(ctx, f, rr, 'L', 0.12, 0.55, SZ + 0.1, 0.8, s + 101, 3);
      faceLeds(ctx, f, rr, 'L', 0.82, 0.65, 0.9, 2, [C.ledGreen, C.led], 1.6);
      fins(ctx, f, rr, 'R', SZ + 0.1, 0.85, 5, s + 102);
    },
  },
  solar_tower: {
    head: 6.1,
    draw(ctx, f, s) {
      // A solar tower: a field of heliostats — small mirrors on posts in rings, each tilted to
      // throw the sun onto the receiver — round a tall concrete tower whose receiver glows hot
      // at its top, the power block at its foot. Drawn once (no ports).
      slab(ctx, f, C.steel, 0.04, SZ, s);
      const sc = new Scene();
      const spots: Array<[number, number]> = [];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.39; spots.push([2 + Math.cos(a) * 1.16, 2 + Math.sin(a) * 1.16]); }
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.13; spots.push([2 + Math.cos(a) * 1.68, 2 + Math.sin(a) * 1.68]); }
      for (const p of [[0.42, 0.42], [3.58, 0.42], [0.42, 3.58], [3.58, 3.58]] as const) spots.push([p[0], p[1]]);
      for (const [i, [x, y]] of spots.entries()) sc.add(f.depth(x, y), () => heliostatIso(ctx, f, x, y, 2, 2, s + 100 + i * 7));
      sc.add(f.depth(2, 2), () => {
        const rr = box(ctx, f, 1.52, 1.52, 2.48, 2.48, SZ, 0.9, C.steelL, s + 1);
        faceGrille(ctx, f, rr, 'L', 0.1, 0.45, SZ + 0.1, 0.75, s + 2, 3);
        faceLeds(ctx, f, rr, 'L', 0.76, 0.6, 0.9, 3, LEDS, 1.6);
        faceGrille(ctx, f, rr, 'R', 0.15, 0.85, SZ + 0.1, 0.75, s + 3, 3);
        latheIso(ctx, f, 2, 2, [[0.9, 0.36], [1.4, 0.33], [4.5, 0.21], [4.58, 0.27], [4.62, 0.27]], TOWER, s + 4, { top: C.steelD });
        const g = f.p(2, 2, 5.0);
        flat(ctx, ellipsePts(g[0], g[1], 44, 44, s + 5, 0, 28), C.ledWarm, 0.14);
        flat(ctx, ellipsePts(g[0], g[1], 28, 28, s + 6, 0, 24), C.ledWarm, 0.22);
        latheIso(ctx, f, 2, 2, [[4.62, 0.3], [5.4, 0.3]], C.warn, s + 7, { top: C.steelD, seams: false });
        for (const z of [4.8, 5.0, 5.2]) {
          const c = f.p(2, 2, z), [ex, ey] = f.ell(0.305);
          ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 8, 0, 32).filter(([, py]) => py >= c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 2.2, color: C.glowPeach, shade: false, taper: 0, seed: s + 9 + z * 10 });
        }
        light(ctx, g[0] - 6, g[1] - 2, 5, C.ledWarm);
        // The sun the mirrors throw, converging on the receiver: faint beams (washes, under 50 %).
        for (const [i, [x, y]] of spots.entries()) if (i % 3 === 0) ink(ctx, [f.p(x, y, 0.8), f.p(2, 2, 5.0)], { w: 2.4, color: C.glowPeach, alpha: 0.28, shade: false, taper: 0.6, jitter: 0, seed: s + 20 + i });
        latheIso(ctx, f, 2, 2, [[5.4, 0.36], [5.48, 0.36], [5.62, 0.16], [5.72, 0.06]], C.steelD, s + 10, { top: C.steel, seams: false });
        light(ctx, ...f.p(2, 2, 5.82), 2.4, C.ledRed);
      });
      sc.run();
    },
  },
  cell_generator: {
    head: 1.95,
    draw(ctx, f, s) {
      // A battery generator: a magazine of charged cells glowing cyan at the back (fed by the
      // intake), a loader pushing one into the turbine-like generator housing, its exciter
      // cabinet on the end.
      slab(ctx, f, C.steelD, 0.05, SZ, s);
      const sc = new Scene();
      sc.add(f.depth(1, 1.48), () => {
        const rr = box(ctx, f, 0.14, 1.1, 1.86, 1.86, SZ, 0.52, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 1);
        faceHazard(ctx, f, rr, 'L', 0.04, 0.96, SZ + 0.04, SZ + 0.12, s + 2);
        const cells: Array<[number, number]> = [];
        for (const y of [1.3, 1.66]) for (const x of [0.4, 0.8, 1.2, 1.6]) cells.push([x, y]);
        cells.sort((a, b) => f.depth(a[0], a[1]) - f.depth(b[0], b[1]));
        for (const [i, [x, y]] of cells.entries()) {
          latheIso(ctx, f, x, y, [[0.52, 0.14], [1.02, 0.14], [1.02, 0.09], [1.1, 0.09]], C.ice, s + 10 + i, { top: C.brassL, shadow: false, seams: false });
          const b = f.p(x, y, 0.8), [ex, ey] = f.ell(0.14);
          ink(ctx, ellipsePts(b[0], b[1], ex, ey, s + 30 + i, 0, 24).filter(([, py]) => py >= b[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 3, color: C.led, shade: false, taper: 0, seed: s + 31 + i });
        }
      });
      sc.add(f.depth(0.9, 0.58), () => {
        box(ctx, f, 0.24, 0.24, 1.5, 0.92, SZ, 0.42, { top: C.steelD, left: C.steel, right: mix(C.steel, C.ink, 0.4) }, s + 40, { outline: 1.6 });
        drumIso(ctx, f, 0.86, 0.58, 0.88, 0.32, 0.6, 'x', C.steelL, s + 41, { bands: [-0.7, -0.35, 0, 0.35, 0.7] });
        const w = f.p(0.86, 0.58, 1.2);
        flat(ctx, ellipsePts(w[0], w[1], 10, 4, s + 42, 0, 16), C.led, 0.3);
        latheIso(ctx, f, 0.86, 0.94, [[0.42, 0.11], [0.95, 0.11]], C.ice, s + 43, { top: C.brassL, shadow: false, seams: false });
        const c = f.p(0.86, 0.94, 0.7), [ex, ey] = f.ell(0.11);
        ink(ctx, ellipsePts(c[0], c[1], ex, ey, s + 44, 0, 20).filter(([, py]) => py >= c[1] - 0.5).sort((p, q) => p[0] - q[0]), { w: 2.6, color: C.led, shade: false, taper: 0, seed: s + 45 });
      });
      sc.add(f.depth(1.7, 0.58), () => {
        const rr = box(ctx, f, 1.54, 0.2, 1.88, 0.96, SZ, 1.2, C.violet, s + 50);
        fins(ctx, f, rr, 'R', SZ + 0.1, 1.05, 6, s + 51);
        faceLeds(ctx, f, rr, 'L', 1.02, 0.25, 0.75, 2, [C.led, C.ledGreen], 1.5);
        faceGrille(ctx, f, rr, 'L', 0.15, 0.85, SZ + 0.12, 0.85, s + 52, 4);
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

// ── the incinerator's pit (D51; owner, 2026-10-14) ───────────────────────────
//
// "The incinerator should have a style that shows more clearly that it will destroy the item.
// Maybe a hole in the ground with a flame that activates when an item falls in it?" The block is
// a pit sunk into scorched ground: a low riveted collar whose top is tempered by the heat (straw
// at its outer edge, bronze, purple, blue at the throat, as the trade post's flame-proof walls),
// a dark throat whose far wall glows down to a grate over the fire bed, and on each side a steel
// chute from the tile's edge up over the collar to a lip above the throat (a turquoise band at
// its mouth: the way in, as every port; chevrons pointing in). Items ride a chute and tip over
// its lip into the dark; the flame flares out of the throat when one falls (world/pits.ts).
//
// The world draws it in two parts with what moves between them (world/pits.ts): the `back` (the
// ground, the throat, the collar's far half and the chutes on the far sides) and the `front` (the
// collar's near half and the near chutes), so an item tipping in and the flame's root sink
// behind the near rim. The atlas sprite is both (`all`: icons, picking).

/** The pit's geometry (local tiles, levels): the collar's outer and inner radius and its top; the throat's floor (below the ground); the chutes' half-width, and where each ends over the throat (its lip, from the centre). */
export const PIT = { ro: 0.44, ri: 0.3, zr: 0.17, floor: -0.42, hw: 0.125, lip: 0.265 } as const;
/** The tempered collar, from its outer edge in (brass to blue: hotter towards the throat). */
export const PIT_TEMPER = [mix(C.brassL, C.steelD, 0.25), mix(C.brass, C.steelD, 0.3), mix(C.violetL, C.steelD, 0.35), mix(C.steelL, C.steelD, 0.3)] as const;
/** The fire bed's paint (not LED tokens: the night glow is the pit's own, world/lights-view.ts). */
export const EMBER = mix(C.coral, C.warn, 0.45), EMBER_D = mix(C.coralD, C.ink, 0.35);

/** The pit's marks on its ground (local tiles, the same in both views and every rotation): soot blotches, cracks. */
interface PitMarks { burns: ReadonlyArray<{ r: readonly number[]; tone: 'baked' | 'burnt' | 'soot'; alpha: number }>; cracks: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }
let pitMemo: PitMarks | null = null;
export function pitMarks(): PitMarks {
  if (pitMemo) return pitMemo;
  const rng = makeRng(5150);
  const burns: Array<{ r: number[]; tone: 'baked' | 'burnt' | 'soot'; alpha: number }> = [];
  for (const [r0, amp, tone, alpha] of [[0.66, 0.2, 'burnt', 0.5], [0.55, 0.16, 'soot', 0.45], [0.47, 0.08, 'soot', 0.7]] as const) {
    const h = [2, 3, 5].map((k) => ({ k, a: (rng.range(0.4, 1) * amp) / k ** 0.5, p: rng.range(0, Math.PI * 2) }));
    burns.push({ tone, alpha, r: Array.from({ length: 48 }, (_, i) => {
      const t = (i / 48) * Math.PI * 2;
      return r0 * (1 + h.reduce((v, q) => v + q.a * Math.sin(q.k * t + q.p), 0));
    }) });
  }
  const cracks: Array<Array<readonly [number, number]>> = [];
  for (let i = 0; i < 6; i++) {
    // Short jagged cracks out from the collar, between the chutes (diagonals of the tile).
    let a = Math.PI / 4 + (i % 4) * (Math.PI / 2) + rng.range(-0.35, 0.35), r = PIT.ro + 0.02;
    const line: Array<readonly [number, number]> = [];
    for (let j = 0; j < 4 && r < 0.68; j++) { line.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]); r += rng.range(0.05, 0.09); a += rng.range(-0.35, 0.35); }
    if (line.length > 1) cracks.push(line);
  }
  pitMemo = { burns, cracks };
  return pitMemo;
}

/** A pit's part: the back (ground, throat, the collar's far half, the far chutes), the front (the collar's near half, the near chutes), or both. */
export type PitPart = 'back' | 'front' | 'all';

/** Points of a horizontal ring's arc at height z, radius r, between screen angles a0 → a1 (0 = screen right, π/2 = towards the viewer). */
function pitArc(f: IsoFrame, r: number, z: number, a0: number, a1: number, n = 24): Pt[] {
  const [cx, cy] = f.p(0.5, 0.5, z), [ex, ey] = f.ell(r);
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * ex, cy + Math.sin(a) * ey] as Pt; });
}

/**
 * A chute from a side's tile edge up onto the collar and on to its lip over the throat (local
 * side, unrotated): a dark steel plate between two rails, a turquoise band at its mouth (the way
 * in), a cyan chevron pointing in; heat-tinted where it overhangs the throat.
 */
function pitChute(ctx: Ctx, f: IsoFrame, side: number, s: number): void {
  const { hw, ro, zr, lip } = PIT;
  const dx = [0, 1, 0, -1][side]!, dy = [-1, 0, 1, 0][side]!, nx = -dy, ny = dx;
  // A point at distance r from the centre along the side, offset u across it, at height z.
  const at = (r: number, u: number, z: number): Pt => f.p(0.5 + dx * r + nx * u, 0.5 + dy * r + ny * u, z);
  const zt = zr + 0.03;
  const zAt = (r: number): number => (r >= 0.5 ? 0.02 : r >= ro ? 0.02 + (zt - 0.02) * ((0.5 - r) / (0.5 - ro)) : zt);
  const rs = [0.5, ro, lip];
  const plate: Pt[] = [...rs.map((r) => at(r, -hw, zAt(r))), ...rs.slice().reverse().map((r) => at(r, hw, zAt(r)))];
  shape(ctx, plate, mix(C.steelD, C.steel, 0.35), { w: 1.4, shade: false, jitter: 0, seed: s });
  // The overhang over the throat: heat-tinted.
  flat(ctx, [at(ro - 0.04, -hw, zt), at(lip, -hw, zt), at(lip, hw, zt), at(ro - 0.04, hw, zt)], mix(C.violetL, C.steelD, 0.45), 0.85);
  // Rails along both sides (lit inner edge), the mouth's turquoise band, a chevron pointing in.
  for (const u of [-hw, hw]) {
    const rail = rs.map((r) => at(r, u * 0.92, zAt(r) + 0.05));
    ink(ctx, rail, { w: 3, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 3 });
    ink(ctx, rail, { w: 1.1, color: C.steelL, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 4 });
  }
  shape(ctx, [at(0.5, -hw, 0.02), at(0.455, -hw, 0.04), at(0.455, hw, 0.04), at(0.5, hw, 0.02)], C.turq, { w: 1, shade: false, jitter: 0, seed: s + 5 });
  const cr = (ro + 0.5) / 2 + 0.01, k = 0.07;
  ink(ctx, [at(cr + k * 0.6, -0.09, zAt(cr) + 0.01), at(cr - k * 0.6, 0, zAt(cr) + 0.01), at(cr + k * 0.6, 0.09, zAt(cr) + 0.01)], { w: 2.2, color: C.cyan, shade: false, taper: 0, jitter: 0, seed: s + 6 });
  // The lip's edge, sharp: the item tips over it.
  ink(ctx, [at(lip, -hw, zt), at(lip, hw, zt)], { w: 1.6, shade: false, taper: 0, jitter: 0, seed: s + 7 });
}

/** The throat seen from above: dark, its far wall glowing hotter down to a grate over the fire bed. */
function pitThroat(ctx: Ctx, f: IsoFrame, s: number): void {
  const { ri, zr, floor } = PIT;
  const open = pitArc(f, ri, zr, 0, Math.PI * 2, 40);
  flat(ctx, open, C.ink);
  ctx.save(); pathOf(ctx, open); ctx.clip();
  // The far wall, in bands from the rim down: tempered steel, then hotter, then the glow at its foot.
  const bands: Array<[number, number, string, number]> = [[zr, zr - 0.1, mix(C.steelD, C.violetL, 0.3), 1], [zr - 0.1, -0.16, mix(C.steelDD, C.coralD, 0.12), 1], [-0.16, floor + 0.07, mix(C.steelDD, C.coralD, 0.5), 1], [floor + 0.07, floor, mix(C.coralD, C.coral, 0.4), 0.95]];
  for (const [z0, z1, col, a] of bands) {
    const r0 = ri, r1 = ri * 0.94;
    flat(ctx, [...pitArc(f, r0, z0, Math.PI, Math.PI * 2), ...pitArc(f, r1, z1, Math.PI * 2, Math.PI)], col, a);
  }
  hatch(ctx, [...pitArc(f, ri, zr, Math.PI, Math.PI * 2), ...pitArc(f, ri * 0.94, -0.12, Math.PI * 2, Math.PI)], Math.PI / 2, 3.4, { alpha: 0.35, seed: s + 1 });
  // The fire bed and its grate: bars across (local x), coals glowing between them.
  const bed = pitArc(f, ri * 0.92, floor, 0, Math.PI * 2, 32);
  flat(ctx, bed, EMBER_D);
  ctx.save(); pathOf(ctx, bed); ctx.clip();
  for (let i = -3; i <= 3; i++) {
    const y = 0.5 + i * 0.075;
    flat(ctx, [f.p(0.2, y - 0.022, floor), f.p(0.8, y - 0.022, floor), f.p(0.8, y + 0.022, floor), f.p(0.2, y + 0.022, floor)], i & 1 ? EMBER : mix(EMBER, C.peachL, 0.35), 0.9);
  }
  for (let i = -3; i <= 4; i++) {
    const y = 0.5 + (i - 0.5) * 0.075;
    ink(ctx, [f.p(0.18, y, floor), f.p(0.82, y, floor)], { w: 2.4, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 10 + i });
  }
  ctx.restore();
  // The rim's shadow on the far wall; the dark under the near rim, where the fall goes out of sight.
  flat(ctx, [...pitArc(f, ri, zr, Math.PI, Math.PI * 2), ...pitArc(f, ri * 0.97, zr - 0.07, Math.PI * 2, Math.PI)], C.ink, 0.55);
  flat(ctx, [...pitArc(f, ri, zr, 0, Math.PI), ...pitArc(f, ri * 0.86, zr + 0.1, Math.PI, 0)], C.ink, 0.6);
  ctx.restore();
}

/**
 * The collar's half (`far`: the screen's upper half, else the near one): its outer wall where it
 * shows (the near half), its tempered top, rivets; the outline of its silhouette.
 */
function pitCollar(ctx: Ctx, f: IsoFrame, far: boolean, s: number): void {
  const { ro, ri, zr } = PIT;
  const [a0, a1] = far ? [Math.PI, Math.PI * 2] : [0, Math.PI];
  if (!far) {
    const wall = [...pitArc(f, ro, zr, 0, Math.PI), ...pitArc(f, ro, 0, Math.PI, 0)];
    flat(ctx, wall, C.steelD);
    // Soot streaks up the wall and a lit band at its top.
    ctx.save(); pathOf(ctx, wall); ctx.clip();
    hatch(ctx, wall, Math.PI / 2, 4, { alpha: 0.4, seed: s + 1, w: 1.2 });
    ctx.restore();
    ink(ctx, pitArc(f, ro, zr - 0.03, 0.15, Math.PI - 0.15), { w: 1, color: C.steelL, alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  }
  // The top: concentric tempered bands, outer edge first.
  for (let i = 0; i < PIT_TEMPER.length; i++) {
    const r0 = ro - ((ro - ri) * i) / PIT_TEMPER.length, r1 = ro - ((ro - ri) * (i + 1)) / PIT_TEMPER.length;
    flat(ctx, [...pitArc(f, r0, zr, a0, a1), ...pitArc(f, r1, zr, a1, a0)], PIT_TEMPER[i]!);
  }
  ink(ctx, pitArc(f, ri, zr, a0, a1), { w: 1.4, shade: false, taper: 0, jitter: 0, seed: s + 3 });
  ink(ctx, pitArc(f, ro, zr, a0, a1), { w: 1.2, color: mix(C.steelL, '#ffffff', 0.2), alpha: far ? 0.55 : 0.3, shade: false, taper: 0, jitter: 0, seed: s + 4 });
  // Bolts round the top, between the chutes (each half its own).
  const cy = f.p(0.5, 0.5, zr)[1];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, r = (ro + ri) / 2 + 0.035;
    const p = f.p(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, zr);
    if ((p[1] < cy) === far) rivet(ctx, p[0], p[1], 1.5, mix(C.steelL, C.brassL, 0.25));
  }
  // The silhouette: the far half's back edge; the near half's flanks and foot.
  const [ex] = f.ell(ro), c1 = f.p(0.5, 0.5, zr);
  if (far) ink(ctx, pitArc(f, ro, zr, Math.PI, Math.PI * 2), { w: 2, seed: s + 6 });
  else ink(ctx, [[c1[0] + ex, c1[1]], ...pitArc(f, ro, 0, 0, Math.PI), [c1[0] - ex, c1[1]]], { w: 2, seed: s + 5 });
}

/**
 * The incinerator's pit, or one of its parts (`PitPart`, above). In a cast shadow's frame only
 * the collar and the chutes cast one (the ground and the hole cannot).
 */
export function pitIso(ctx: Ctx, f: IsoFrame, s: number, part: PitPart = 'all'): void {
  const solid = !(f instanceof ShadowFrame);
  const near = (side: number): boolean => facing(f, side);
  if (part !== 'front') {
    if (solid) {
      // Scorched ground: baked earth, soot blotches round the collar, cracks with a pale lip.
      const g = (x: number, y: number): Pt => f.p(x, y, 0);
      const foot: Pt[] = [g(0.02, 0.02), g(0.98, 0.02), g(0.98, 0.98), g(0.02, 0.98)];
      const m = pitMarks();
      flat(ctx, foot, SCORCH.baked);
      ctx.save(); pathOf(ctx, foot); ctx.clip();
      for (const b of m.burns) flat(ctx, b.r.map((v, i) => { const t = (i / b.r.length) * Math.PI * 2; return g(0.5 + Math.cos(t) * v, 0.5 + Math.sin(t) * v); }), SCORCH[b.tone], b.alpha);
      for (const [i, c] of m.cracks.entries()) {
        const pts = c.map(([x, y]) => g(x, y));
        ink(ctx, pts.map(([x, y]) => [x - 0.8, y - 1] as Pt), { w: 1.1, color: SCORCH.baked, alpha: 0.6, shade: false, taper: 0.4, jitter: 0.2, seed: s + 60 + i });
        ink(ctx, pts, { w: 1.5, color: C.ink, alpha: 0.7, shade: false, taper: 0.4, jitter: 0.2, seed: s + 60 + i });
      }
      ctx.restore();
      ink(ctx, foot, { closed: true, w: 1, alpha: 0.3, shade: false, seed: s + 61 });
      pitThroat(ctx, f, s + 100);
    }
    pitCollar(ctx, f, true, s + 200);
    for (let side = 0; side < 4; side++) if (!near(side)) pitChute(ctx, f, side, s + 300 + side * 11);
  }
  if (part !== 'back') {
    pitCollar(ctx, f, false, s + 400);
    // The near chutes, the one nearer the viewer last.
    const sides = [0, 1, 2, 3].filter(near).sort((a, b) => f.dir(a) - f.dir(b));
    for (const side of sides) pitChute(ctx, f, side, s + 500 + side * 11);
  }
}

/** The pit's flame: `level` 1…`PIT_FLAMES` (how high it flares), `variant` (its flicker), or embers and smoke (level 0). In the pit's own frame (`PIT_FLAME_HEAD`). */
export const PIT_FLAMES = 6, PIT_FLAME_HEAD = 2.1;

/**
 * A flame flaring out of the pit's throat, as flat tongues: coral outside, orange, a pale core,
 * inked in dark coral, a few sparks over the tallest; or, at level 0, embers rising from the bed
 * and a thin wisp of smoke. Its root sits deep in the throat (the near rim hides it).
 */
export function pitFlameIso(ctx: Ctx, f: IsoFrame, level: number, variant: number, s: number): void {
  const rng = makeRng(s + level * 31 + variant * 977);
  const { ri, zr } = PIT;
  const [cx, cy] = f.p(0.5, 0.5, zr - 0.08);
  const [ex] = f.ell(ri);
  if (level <= 0) {
    for (let i = 0; i < 5; i++) {
      const x = cx + rng.range(-0.6, 0.6) * ex, y = cy - rng.range(2, 26);
      flat(ctx, ellipsePts(x, y, 2.6, 2.2, s + i, 0, 8), C.coral, 0.85);
      flat(ctx, ellipsePts(x, y, 1.2, 1, s + i + 5, 0, 6), C.peachL);
    }
    const wisp: Pt[] = [];
    for (let k = 0; k <= 8; k++) wisp.push([cx + Math.sin(k * 0.8 + variant * 2) * 6 + rng.range(-1, 1), cy - 6 - k * 9]);
    ink(ctx, wisp, { w: 5, color: mix(C.lilacL, C.inkSoft, 0.35), alpha: 0.3, shade: false, taper: 0.5, jitter: 0.6, seed: s + 40 + variant });
    return;
  }
  const h = level / PIT_FLAMES;
  const H = (0.3 + 1.75 * h) * ILH, W = ex * (0.95 + 0.3 * h);
  /** A tongue: from the left of its base up round `n` tips to its right, `k` its size (0…1). */
  const tongue = (k: number, n: number, seed: number): Pt[] => {
    const r = makeRng(seed);
    const w = W * k, top = H * k;
    const pts: Pt[] = [[cx - w, cy]];
    const tips = Array.from({ length: n }, (_, i) => {
      const u = n === 1 ? 0 : -0.62 + (1.24 * i) / (n - 1);
      return { x: cx + u * w * 0.85 + r.range(-0.1, 0.1) * w, y: cy - top * (i === Math.floor(n / 2) ? 1 : r.range(0.62, 0.88)) };
    });
    for (const [i, t] of tips.entries()) {
      const lx = i === 0 ? cx - w : (tips[i - 1]!.x + t.x) / 2, ly = i === 0 ? cy : cy - top * r.range(0.36, 0.52);
      // Up the tongue's flank (a slight S), to its tip.
      for (let j = 1; j <= 5; j++) { const q = j / 5; pts.push([lx + (t.x - lx) * q + Math.sin(q * Math.PI) * w * 0.12 * (i % 2 ? -1 : 1), ly + (t.y - ly) * q * q]); }
      const nx = i === n - 1 ? cx + w : (t.x + tips[i + 1]!.x) / 2, ny = i === n - 1 ? cy : cy - top * r.range(0.36, 0.52);
      for (let j = 1; j <= 5; j++) { const q = j / 5; pts.push([t.x + (nx - t.x) * q, t.y + (ny - t.y) * Math.sqrt(q)]); }
    }
    // The base: the near half of an ellipse (hidden behind the near rim).
    for (let j = 1; j < 10; j++) { const a = (j / 10) * Math.PI; pts.push([cx + Math.cos(a) * w, cy + Math.sin(a) * w * 0.5]); }
    return pts;
  };
  const outer = tongue(1, level >= 3 ? 3 : 2, s + variant * 13 + level);
  flat(ctx, outer, C.coral);
  flat(ctx, tongue(0.72, level >= 4 ? 3 : 2, s + 50 + variant * 7 + level), mix(C.coral, C.warn, 0.62));
  flat(ctx, tongue(0.42, 1, s + 90 + variant * 3 + level), mix(C.warn, '#fff4d6', 0.7));
  ink(ctx, outer.slice(0, outer.length - 8), { w: 1.5, color: C.coralD, alpha: 0.9, shade: false, taper: 0.1, jitter: 0.2, seed: s + 7 });
  // Sparks over a tall flame.
  if (level >= 3) {
    for (let i = 0; i < level - 1; i++) {
      const x = cx + rng.range(-1, 1) * W, y = cy - H * rng.range(0.85, 1.35);
      ink(ctx, [[x, y], [x + rng.range(-1.5, 1.5), y - rng.range(3, 6)]], { w: 1.8, color: mix(C.warn, '#fff4d6', 0.5), shade: false, taper: 0.3, jitter: 0, seed: s + 60 + i });
    }
  }
}
/** One of the pit's parts drawn into a fresh canvas for a rotation (the world's back and front, world/pits.ts); `frame`: its anchor. */
export function drawPitPart(part: PitPart, rot: Rot, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const f = new IsoFrame(1, 1, rot, R.incinerator!.head);
  const { ctx, canvas } = make(f.W, f.H);
  pitIso(ctx, f, seedOf('incinerator'), part);
  return { canvas, frame: f };
}

/** A frame of the pit's flame (level 0: embers), anchored as the pit's sprite (the footprint's ground corner). */
export function drawPitFlame(level: number, variant: number, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: IsoFrame } {
  const f = new IsoFrame(1, 1, 0, PIT_FLAME_HEAD);
  const { ctx, canvas } = make(f.W, f.H);
  pitFlameIso(ctx, f, level, variant, seedOf('incinerator') + 700);
  return { canvas, frame: f };
}

const seedOf = (id: string): number => (id.length * 131 + id.charCodeAt(0) * 17) | 0;

/**
 * A building's body with its ports — those on the far sides under it, the near ones over it —
 * and its power terminals of the generic kit (art/terminals.ts: a service mast on a roof), last,
 * so a wire always meets one in sight. Poles, the Heart and the charger draw their own.
 */
function bodyWithPorts(ctx: Ctx, f: IsoFrame, id: BuildingId, def: BuildingDef, recipe: Recipe, seed: number, lv = 1): void {
  // The incinerator's in-ports are its box's own ribbon mouths (as a routing block's): no nozzles on top.
  const ports = (def.kind === 'sink' ? [] : def.ports).filter((p) => portDrawn(def, p, lv)).map((p) => ({ p, d: f.dir(sideIndex[p.side]) }));
  for (const { p, d } of ports) if (d === 0 || d === 3) portIso(ctx, f, p.x, p.y, sideIndex[p.side], p.io, SZ, seed + p.x * 5 + p.y);
  if (recipe.moving) recipe.moving.body(ctx, f, seed);
  else recipe.draw?.(ctx, f, seed, lv);
  for (const { p, d } of ports) if (d === 1 || d === 2) portIso(ctx, f, p.x, p.y, sideIndex[p.side], p.io, SZ, seed + p.x * 5 + p.y);
  for (const [i, t] of terminalsOf(id).entries()) if (kitDrawn(t)) terminalIso(ctx, f, t, seed + 900 + i * 7, KIT_K);
}

/**
 * Draw a building sprite (body + ports) for one rotation into a fresh canvas, at its look's level
 * `lv` (`artLevels`). A building with a moving part gets it at phase 0, under or over the body
 * exactly as the world stacks the two sprites (`drawBuildingMoving`).
 */
export function drawBuilding(id: BuildingId, rot: Rot, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }, lv = 1): { canvas: unknown; frame: IsoFrame } {
  const def = BUILDINGS[id] as BuildingDef;
  const recipe = R[id] ?? fallback;
  const f = new IsoFrame(def.w, def.h, rot, recipe.head);
  const { ctx, canvas } = make(f.W, f.H);
  const seed = seedOf(id);
  const m = recipe.moving, over = !!m && m.over(f);
  if (m && !over) m.part(ctx, f, seed, 0);
  bodyWithPorts(ctx, f, id, def, recipe, seed, lv);
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
 * A building's cast shadow: its own recipe (body, ports, a moving part at phase 0) at its look's
 * level `lv`, drawn through its `shadowFrameOf` into `ctx` — a silhouette context
 * (art/silhouette.ts) paints it in one colour: the shadow's mask.
 */
export function drawBuildingShadow(id: BuildingId, rot: Rot, dx: number, dy: number, ctx: Ctx, lv = 1): void {
  const def = BUILDINGS[id] as BuildingDef;
  const recipe = R[id] ?? fallback;
  const f = shadowFrameOf(id, rot, dx, dy);
  const seed = seedOf(id);
  bodyWithPorts(ctx, f, id, def, recipe, seed, lv);
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

/**
 * How many looks a building has, one per level (D86): the Heart one per level it can reach, so
 * its art grows with it; every other building one. Both views bake each (atlas.ts) and pick the
 * one `artLevelOf` names.
 */
export const artLevels = (id: BuildingId): number => (id === 'hearth' ? BAL.hearthUpgrades.length + 1 : 1);

/** The look a building of `id` wears in a base whose Heart stands at `hearthLevel`. */
export const artLevelOf = (id: BuildingId, hearthLevel: number): number => Math.max(1, Math.min(artLevels(id), hearthLevel));

/** Is a port's nozzle drawn at look `lv`? All are, but the Heart's data outlet before the level that mounts it (D86): a bare corner. */
export const portDrawn = (def: BuildingDef, p: PortDef, lv: number): boolean => def.kind !== 'hearth' || p.io !== 'out' || lv >= BAL.hearthDataLevel;
