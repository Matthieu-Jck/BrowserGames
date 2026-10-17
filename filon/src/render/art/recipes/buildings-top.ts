// buildings-top.ts — the plan-view recipes (build mode, and the build-bar icons): every building
// seen from straight above, the same object as its iso volume (buildings.ts) — machines purely
// industrial (derricks from above, hoppers, tank roofs, furnace shafts, sawtooth roofs, crates,
// drums); nobody lives at the base (D29), so even the Heart is machinery: depot, solar rows, uplink,
// and the pieces its levels mount on its corners (D86: the data outlet, the expertise archive, the
// grid station). Research reads as white lab roofs banded in violet, array panels, rack roofs with fans.
// Tall parts cast long shadows down-right (`dropShadow`), so height reads from above. Routing
// blocks are a plate whose band-wide mouths line up with the ribbons. Recipes draw in the
// building's own (unrotated) tile frame; the Frame rotates positions only, so light, hatching
// and cast shadows always fall the same way.
import { fenceTop } from './gleaners';
import { BUILDINGS, type BuildingId } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import { makeRng } from '@/core/rng';
import { sideIndex, type Rot } from '@/sim/types';
import { C, mix } from '../tokens';
import { castShadow, ellipsePts, flat, hatch, ink, pathOf, shadowCrescent, shape, stipple, type Ctx, type Pt } from '../ink';
import {
  Frame, arm, arrowPoly, bucketWheelTop, cable, chevron, crate, decal, dish, drumTop, glowSeam, grille, hatchDoor, hull,
  ledStrip, light, petals, pipe, plinth, port, rectPts as rr, rivet, spire, stack, tankTop, terminalTop, vault,
} from '../shapes';
import { pvPanel } from '../solar';
import { UNLIT, isUnlit } from '../unlit';
import { CHARGER_BUSHING, HEART_MASTS, KIT_K, POLE, PYLON, kitDrawn, onArm, terminalProbe, terminalsOf, turnsArt } from '../terminals';
import { BIG_ROTOR, BORE, CUTTER, PITCH_ROTOR, SAND_WHEEL, TURBINE, boreLeg, boreSquare, bucketFull, vaneAt, type HRotor } from './moving';
import { QZ, crystal } from '../rock';
import {
  BIG_WIND, COOLANT, COVER, DOT, DOT_G, EMBER, EMBER_D, HEART_BEACONS, HEART_CORNERS, HEART_FLOODS, JUNCTION, LAB, PCB, PIT, PIT_TEMPER, RACK, SCORCH, SKY, TP_BAND, TP_DECK, TP_DECK_R, TP_LAMPS, TP_PAD, TP_PED, TP_RIBBON, TP_TEMPER, TP_WALL, WIND,
  CAN, CAN_L, COPPER, ES_CAB_Z, ES_CERAMIC, ES_POT, ES_SLAB, MINER, SB, SB_COAL, SB_ENAMEL, SB_WATER, SB_WHEEL, SPOIL, apronMarks, rod, burnPts, heartCornerAt, heartLook, junctionHump, pitMarks, portDrawn, sparkIso, stationSpots, type SkyPiece, type WindSpec,
} from './buildings';

export const TOP_PX = 64;     // px per tile in the atlas (2× of the 32 plan world px)
export const TOP_MARGIN = 14; // room for shadows and overhangs

/** A plan recipe; `lv`: its look's level (buildings.ts `artLevels`: the Heart's, D86; 1 for any other). */
type Recipe = (ctx: Ctx, f: Frame, seed: number, lv: number) => void;

const LEDS = [C.led, C.led, C.ledGreen, C.led] as const;

// ── machine parts and human places seen from above ───────────────────────────

/** Fired brick and cooling-tower concrete (same tokens as the iso art). */
const BRICK = mix(C.coralD, C.mesa, 0.45);
const TOWER = mix(C.ice, C.steelL, 0.35);

/** Screen-space bounds of canvas points. */
function bounds(pts: readonly Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/** The shadow of an upright prism: its outline dragged down-right by its height (levels). */
function dropShadow(ctx: Ctx, f: Frame, pts: readonly Pt[], h: number, alpha = 0.26): void {
  const d = f.l(0.11 * h);
  flat(ctx, hull([...pts, ...pts.map(([x, y]) => [x + d * 0.7, y + d] as Pt)]), C.inkSoft, alpha);
}

/**
 * A battered block (furnace shaft, bunker, hip roof) from above: the outer outline, the top
 * inset, the slopes as bands — lit on the top/left of the screen, hatched on the bottom/right.
 */
function batter(ctx: Ctx, outer: readonly Pt[], inner: readonly Pt[], side: string, top: string, s: number): void {
  const [X0, Y0, X1, Y1] = bounds(outer), [x0, y0, x1, y1] = bounds(inner);
  flat(ctx, outer, mix(side, '#ffffff', 0.08));
  const right: Pt[] = [[x1, y0], [X1, Y0], [X1, Y1], [x1, y1]], bottom: Pt[] = [[x0, y1], [x1, y1], [X1, Y1], [X0, Y1]];
  for (const q of [right, bottom]) { flat(ctx, q, mix(side, C.ink, 0.3)); hatch(ctx, q, Math.PI / 4, 3, { alpha: 0.35, seed: s }); }
  for (const [a, b] of [[[X0, Y0], [x0, y0]], [[X1, Y0], [x1, y0]], [[X1, Y1], [x1, y1]], [[X0, Y1], [x0, y1]]] as const) ink(ctx, [a, b], { w: 1, alpha: 0.6, shade: false, taper: 0, seed: s + 1 });
  shape(ctx, inner, top, { w: 1.4, seed: s + 2 });
  ink(ctx, outer, { closed: true, w: 2, seed: s + 3 });
}

/** A lattice tower from above: legs converging from the base square to the crown, braces, rings. */
function derrickTop(ctx: Ctx, f: Frame, cx: number, cy: number, w0: number, w1: number, h: number, s: number, legCol: string = C.steelL): void {
  const K = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  const sq = (w: number): Pt[] => K.map(([a, b]) => f.p(cx + a * w, cy + b * w));
  const base = sq(w0), crown = sq(w1);
  const d = f.l(0.11 * h);
  flat(ctx, hull([...base, ...crown.map(([x, y]) => [x + d * 0.7, y + d] as Pt)]), C.inkSoft, 0.2);
  for (const t of [0.35, 0.68]) ink(ctx, sq(w0 + (w1 - w0) * t), { closed: true, w: 1.2, color: C.steelD, shade: false, taper: 0, seed: s + t * 10 });
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    ink(ctx, [base[k]!, crown[j]!], { w: 1, color: C.steelD, alpha: 0.8, shade: false, taper: 0, seed: s + k });
    ink(ctx, [base[j]!, crown[k]!], { w: 1, color: C.steelD, alpha: 0.8, shade: false, taper: 0, seed: s + 4 + k });
  }
  for (let k = 0; k < 4; k++) {
    ink(ctx, [base[k]!, crown[k]!], { w: 3.6, color: C.ink, shade: false, taper: 0, seed: s + 10 + k });
    ink(ctx, [base[k]!, crown[k]!], { w: 2.2, color: legCol, shade: false, taper: 0, seed: s + 20 + k });
  }
  shape(ctx, rr(f, cx - w1 - 0.03, cy - w1 - 0.03, cx + w1 + 0.03, cy + w1 + 0.03, 0.01), C.steelD, { w: 1.3, shade: false, seed: s + 30 });
  light(ctx, ...f.p(cx, cy), f.l(0.04), C.ledWarm);
}

/** A geared rotary table from above: a brass disc with teeth round its rim and the drill string's hole. */
function rotaryTop(ctx: Ctx, f: Frame, cx: number, cy: number, r: number, s: number): void {
  const [x, y] = f.p(cx, cy), R = f.l(r);
  const pts = ellipsePts(x, y, R, R, s, 0.004, 36);
  castShadow(ctx, pts, f.l(0.05), 0.3);
  shape(ctx, pts, C.brass, { w: 1.4, seed: s });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    ink(ctx, [[x + Math.cos(a) * R * 0.78, y + Math.sin(a) * R * 0.78], [x + Math.cos(a) * R * 0.97, y + Math.sin(a) * R * 0.97]], { w: 1.3, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
  flat(ctx, ellipsePts(x, y, R * 0.3, R * 0.3, s + 1, 0, 16), C.steelDD);
  flat(ctx, ellipsePts(x, y, R * 0.14, R * 0.14, s + 2, 0, 12), C.brassL);
}




/** A cargo container seen from above, on a local rect; its corrugations run across its long side. */
function crateAt(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, color: string, s: number, h = 0.7): void {
  const pts = rr(f, x0, y0, x1, y1, 0.02);
  const [X0, Y0, X1, Y1] = bounds(pts);
  crate(ctx, pts, color, s, X1 - X0 >= Y1 - Y0 ? 'x' : 'y', f.l(0.1 * h));
}

/** A furnace from above: battered brick with courses and straps, a steel cap, a hopper of embers, the mouth's glow. */
function furnaceTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, inset: number, s: number): void {
  const outer = rr(f, x0, y0, x1, y1, 0.03), inner = rr(f, x0 + inset, y0 + inset, x1 - inset, y1 - inset, 0.02);
  castShadow(ctx, outer, f.l(0.2), 0.32);
  // The mouth glows out of the south face onto the ground.
  const [mx, my] = f.p((x0 + x1) / 2, y1 + 0.04);
  flat(ctx, ellipsePts(mx, my, f.l(0.2), f.l(0.2), s + 5, 0, 20), C.ledWarm, 0.35);
  batter(ctx, outer, inner, BRICK, C.steelD, s);
  for (const t of [0.4, 0.75]) ink(ctx, rr(f, x0 + inset * t, y0 + inset * t, x1 - inset * t, y1 - inset * t, 0.02), { closed: true, w: 2, color: C.steelD, shade: false, taper: 0, seed: s + t * 10 });
  shape(ctx, rr(f, (x0 + x1) / 2 - 0.08, y1 - 0.06, (x0 + x1) / 2 + 0.08, y1 + 0.02, 0.01), C.warn, { w: 1.1, shade: false, jitter: 0, seed: s + 6 });
  const hw = Math.min(x1 - x0, y1 - y0) / 2 - inset - 0.06, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hop = rr(f, cx - hw, cy - hw, cx + hw, cy + hw, 0.02);
  shape(ctx, hop, C.steelL, { w: 1.3, seed: s + 7 });
  const throat = rr(f, cx - hw * 0.6, cy - hw * 0.6, cx + hw * 0.6, cy + hw * 0.6, 0.02);
  flat(ctx, throat, C.ink);
  const [hx, hy] = f.p(cx, cy);
  flat(ctx, ellipsePts(hx, hy, f.l(hw * 0.4), f.l(hw * 0.3), s + 8, 0.2, 14), C.warn);
  light(ctx, hx, hy, f.l(0.05), C.ledWarm);
}

/** A sawtooth roof from above: bays along local y, each a lit slope ending in a dark louvred face. */
function sawRoofTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, teeth: number, s: number): void {
  const hall = rr(f, x0, y0, x1, y1, 0.03);
  dropShadow(ctx, f, hall, 1.8, 0.3);
  flat(ctx, hall, C.violet);
  for (let k = 0; k < teeth; k++) {
    const ty0 = y0 + ((y1 - y0) * k) / teeth, ty1 = ty0 + (y1 - y0) / teeth;
    const bay = rr(f, x0 + 0.05, ty0 + 0.02, x1 - 0.05, ty1 - 0.02, 0.01);
    flat(ctx, bay, C.steelL);
    flat(ctx, rr(f, x0 + 0.05, ty0 + 0.02, x1 - 0.05, ty0 + (ty1 - ty0) * 0.35, 0.01), mix(C.steelL, C.ink, 0.18));
    const lv = rr(f, x0 + 0.05, ty1 - 0.12, x1 - 0.05, ty1 - 0.02, 0.01);
    flat(ctx, lv, C.steelDD);
    ctx.save();
    ctx.strokeStyle = C.steelL; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
    for (let i = 1; i < 12; i++) {
      const x = x0 + 0.05 + ((x1 - x0 - 0.1) * i) / 12;
      const [a, b] = [f.p(x, ty1 - 0.115), f.p(x, ty1 - 0.025)];
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();
    ink(ctx, bay, { closed: true, w: 1.3, seed: s + k });
  }
  ink(ctx, hall, { closed: true, w: 2.2, seed: s + 20 });
}

/** A gantry crane from above: hazard legs, runway beams, a coral bridge, the trolley, a crate on the hook. */
function gantryTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, s: number): void {
  const ym = (y0 + y1) / 2, tx = x0 + (x1 - x0) * 0.62;
  crateAt(ctx, f, tx - 0.22, ym + 0.1, tx + 0.22, ym + 0.38, C.teal, s, 1);
  for (const x of [x0, x1]) {
    const beam = rr(f, x - 0.07, y0 - 0.06, x + 0.07, y1 + 0.06, 0.01);
    dropShadow(ctx, f, beam, 2.0, 0.22);
    shape(ctx, beam, C.steelL, { w: 1.3, seed: s + 1 + x });
  }
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) shape(ctx, rr(f, x - 0.07, y - 0.07, x + 0.07, y + 0.07, 0.01), C.hazard, { w: 1.2, seed: s + 3 });
  const bridge = rr(f, x0 - 0.05, ym - 0.08, x1 + 0.05, ym + 0.08, 0.01);
  dropShadow(ctx, f, bridge, 2.2, 0.25);
  shape(ctx, bridge, C.coral, { w: 1.5, seed: s + 4 });
  shape(ctx, rr(f, tx - 0.13, ym - 0.12, tx + 0.13, ym + 0.12, 0.02), C.steelD, { w: 1.3, seed: s + 5 });
  light(ctx, ...f.p(tx, ym), f.l(0.03), C.ledWarm);
}


/** A steam puff from above: overlapping paper lobes inked as one cloud, its belly hatched. */
function puffTop(ctx: Ctx, x: number, y: number, r: number, s: number): void {
  const lobes = [[0, 0, 1], [-0.7, 0.25, 0.7], [0.7, 0.2, 0.75], [-0.25, -0.55, 0.65], [0.4, -0.45, 0.6]] as const;
  castShadow(ctx, ellipsePts(x, y, r * 1.4, r * 1.2, s, 0.05, 16), r * 1.6, 0.18);
  for (const [dx, dy, k] of lobes) flat(ctx, ellipsePts(x + dx * r, y + dy * r, r * k + 1.4, r * k + 1.4, s, 0.05, 18), C.ink, 0.75);
  for (const [dx, dy, k] of lobes) flat(ctx, ellipsePts(x + dx * r, y + dy * r, r * k, r * k, s, 0.05, 18), C.paper);
  const belly = ellipsePts(x + r * 0.3, y + r * 0.4, r * 0.8, r * 0.35, s + 1, 0.05, 18);
  hatch(ctx, belly, Math.PI / 4, 2.6, { alpha: 0.28, seed: s });
}

// ── routing blocks: shared plate and core parts ─────────────────────────────

/** Lip colour of each side's mouths, by local side (N, E, S, W). */
type Lips = readonly [string, string, string, string];
const NEUTRAL: Lips = [C.brass, C.brass, C.brass, C.brass];
/** The chosen item's way (cyan) and the others' (coral), for sorters' lips and lanes. */
const CHOSEN = C.cyan, OTHERS = C.coral;
/** Light painted steel of the routing blocks' plates. */
const PLATE = mix(C.steel, C.steelL, 0.35);
/** How deep a ribbon mouth cuts into the plate (tiles). */
const MOUTH_D = 0.12;
type LRect = readonly [number, number, number, number];

/** Local rect of the mouth of tile i along a side, d tiles deep from the plate's edge. */
function mouthRect(f: Frame, side: number, i: number, d: number): LRect {
  switch (side & 3) {
    case 0: return [i + 0.2, 0.04, i + 0.8, 0.04 + d];
    case 1: return [f.w - 0.04 - d, i + 0.2, f.w - 0.04, i + 0.8];
    case 2: return [i + 0.2, f.h - 0.04 - d, i + 0.8, f.h - 0.04];
    default: return [0.04, i + 0.2, 0.04 + d, i + 0.8];
  }
}

/** The point d tiles out of (cx, cy) towards a side. */
const lanePt = (side: number, cx: number, cy: number, d: number): [number, number] =>
  [cx + [0, d, 0, -d][side & 3]!, cy + [-d, 0, d, 0][side & 3]!];

/** Local rect of a lane from r0 to r1 tiles out of (cx, cy) towards a side, half-width hw. */
function laneRect(side: number, cx: number, cy: number, r0: number, r1: number, hw: number): LRect {
  switch (side & 3) {
    case 0: return [cx - hw, cy - r1, cx + hw, cy - r0];
    case 1: return [cx + r0, cy - hw, cx + r1, cy + hw];
    case 2: return [cx - hw, cy + r0, cx + hw, cy + r1];
    default: return [cx - r1, cy - hw, cx - r0, cy + hw];
  }
}

/**
 * A routing block's plate: riveted light steel on the whole footprint, each side opening on
 * ribbon mouths (one per tile, exactly the ribbon's band, so a ribbon at any side plugs straight
 * in): a dark throat framed by a coloured lip, and a flow chevron pointing `chev[side]` (null: none).
 */
function forkPlate(ctx: Ctx, f: Frame, lips: Lips, chev: ReadonlyArray<number | null>, s: number, color: string = PLATE): void {
  plinth(ctx, f, color, 0.04, s);
  for (let side = 0; side < 4; side++) {
    const n = side & 1 ? f.h : f.w;
    for (let i = 0; i < n; i++) {
      const m = mouthRect(f, side, i, MOUTH_D);
      // The lip frames the throat on its three inner sides.
      const [x0, y0, x1, y1] = m, k = 0.05;
      const frame: LRect = side === 0 ? [x0 - k, y0, x1 + k, y1 + k] : side === 2 ? [x0 - k, y0 - k, x1 + k, y1] : side === 1 ? [x0 - k, y0 - k, x1, y1 + k] : [x0, y0 - k, x1 + k, y1 + k];
      shape(ctx, rr(f, ...frame, 0.02), lips[side]!, { w: 1, shade: false, jitter: 0, seed: s + side * 5 + i });
      flat(ctx, rr(f, ...m, 0.012), C.ink);
      ctx.save();
      ctx.strokeStyle = C.steelD; ctx.lineWidth = 1;
      for (let j = 1; j < 4; j++) {
        const t = j / 4;
        const [a, b] = side & 1 ? [f.p(x0, y0 + (y1 - y0) * t), f.p(x1, y0 + (y1 - y0) * t)] : [f.p(x0 + (x1 - x0) * t, y0), f.p(x0 + (x1 - x0) * t, y1)];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.restore();
      const d = chev[side];
      if (d !== null && d !== undefined) chevron(ctx, f, (x0 + x1) / 2, (y0 + y1) / 2, d, 0.065, lips[side] === C.coral ? C.peachL : lips[side] === C.cyan ? C.led : C.ice, 2.2, s + 30 + side * 5 + i);
    }
  }
}

/**
 * The way in of a directional routing block from above (in from the back, S, only; owner
 * 2026-10-12): the turquoise hopper mouth flaring out of the plate over the incoming ribbon,
 * wide outside and narrowing to the mouth, its dark throat inside; it stands taller than the
 * plate, so it casts a shadow. Drawn last, over the plate's back edge.
 */
function intakeTop(ctx: Ctx, f: Frame, s: number): void {
  const rim: Pt[] = [f.p(0.19, 0.93), f.p(0.81, 0.93), f.p(0.96, 1.14), f.p(0.04, 1.14)];
  dropShadow(ctx, f, rim, 0.85, 0.3);
  flat(ctx, rim, C.turq);
  const throat: Pt[] = [f.p(0.27, 0.955), f.p(0.73, 0.955), f.p(0.86, 1.1), f.p(0.14, 1.1)];
  flat(ctx, throat, C.ink);
  // The inner walls: the far (lit) cheek and the near (shaded) one, a strip curtain at the mouth.
  flat(ctx, [f.p(0.27, 0.955), f.p(0.73, 0.955), f.p(0.7, 0.99), f.p(0.3, 0.99)], C.steelD);
  ink(ctx, throat, { closed: true, w: 1.1, alpha: 0.8, shade: false, jitter: 0, seed: s + 1 });
  ink(ctx, [f.p(0.04, 1.14), f.p(0.19, 0.93), f.p(0.81, 0.93)], { w: 1.4, color: C.turqL, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  ink(ctx, rim, { closed: true, w: 1.6, seed: s + 3 });
}

/** A flat arrow on the plate (local tiles), filled and inked, with a small drop shadow. */
function arrowTop(ctx: Ctx, f: Frame, a: Array<[number, number]>, color: string, w: number, s: number): void {
  const pts = a.map(([x, y]) => f.p(x, y));
  flat(ctx, pts.map(([x, y]) => [x + 1.5, y + 2] as Pt), C.ink, 0.3);
  shape(ctx, pts, color, { w, shade: false, jitter: 0, seed: s });
}

/** The router's turntable hub seen from above: a steel disc, four spokes, a cyan eye. */
function hub(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const [cx, cy] = f.p(x, y);
  const R = f.l(r);
  const pts = ellipsePts(cx, cy, R, R, s, 0.004, 32);
  castShadow(ctx, pts, f.l(0.06), 0.35);
  shape(ctx, pts, C.steelL, { w: 1.6, seed: s });
  ink(ctx, ellipsePts(cx, cy, R * 0.72, R * 0.72, s + 1, 0, 28), { closed: true, w: 1.1, color: C.steel, shade: false, seed: s + 1 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ink(ctx, [[cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3], [cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.72]], { w: 1.6, color: C.steelDD, shade: false, taper: 0, seed: s + 2 + i });
  }
  light(ctx, cx, cy, Math.max(1.6, R * 0.24), C.led);
}

/** A plain glyph window (the game draws the chosen item in it): paper, steel rim, ink frame. */
function glyphWindow(ctx: Ctx, f: Frame, x: number, y: number, hr: number, s: number): void {
  shape(ctx, rr(f, x - hr - 0.035, y - hr - 0.035, x + hr + 0.035, y + hr + 0.035, 0.03), C.steelDD, { w: 1.2, shade: false, jitter: 0, seed: s });
  const w = rr(f, x - hr, y - hr, x + hr, y + hr, 0.02);
  flat(ctx, w, C.paper);
  ink(ctx, w, { closed: true, w: 1.2, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 1 });
}

/**
 * Sorter / inverted sorter from above: lanes cross under a plain window (0.4 tile) for the
 * chosen item's glyph. The chosen item's way is cyan (lane and lips): straight on for the
 * sorter, to the sides for the inverted one, which also wears a coral bar across the straight lane.
 */
function sorterTop(ctx: Ctx, f: Frame, s: number, inverted: boolean): void {
  const [st, sd] = inverted ? [OTHERS, CHOSEN] : [CHOSEN, OTHERS];
  forkPlate(ctx, f, [st, sd, C.turq, sd], [0, 1, null, 3], s);
  shape(ctx, rr(f, 0.18, 0.18, 0.82, 0.82, 0.05), C.steel, { w: 1.5, seed: s + 1 });
  flat(ctx, rr(f, 0.35, 0.18, 0.65, 0.82, 0.01), mix(st, C.ink, 0.15));
  flat(ctx, rr(f, 0.18, 0.35, 0.82, 0.65, 0.01), mix(sd, C.ink, 0.15));
  glyphWindow(ctx, f, 0.5, 0.5, 0.2, s + 2);
  if (inverted) shape(ctx, rr(f, 0.29, 0.225, 0.71, 0.27, 0.01), C.coral, { w: 1.2, shade: false, jitter: 0, seed: s + 3 });
  intakeTop(ctx, f, s + 40);
}

/**
 * Overflow / underflow gate from above: the open way is a cyan lane with chevrons; the other
 * way is shut at its mouths by hazard-striped flaps (they swing open when the open way backs up);
 * a brass valve in the middle.
 */
function gateTop(ctx: Ctx, f: Frame, s: number, under: boolean): void {
  const open = C.cyan, shut = C.hazard;
  forkPlate(ctx, f, under ? [shut, open, C.turq, open] : [open, shut, C.turq, shut], under ? [null, 1, null, 3] : [0, null, null, null], s);
  shape(ctx, rr(f, 0.18, 0.18, 0.82, 0.82, 0.05), C.steel, { w: 1.5, seed: s + 1 });
  const lane = mix(C.steel, C.ink, 0.3), lit = mix(open, C.ink, 0.15);
  flat(ctx, rr(f, 0.35, 0.18, 0.65, 0.82, 0.01), under ? lane : lit);
  flat(ctx, rr(f, 0.18, 0.35, 0.82, 0.65, 0.01), under ? lit : lane);
  flat(ctx, rr(f, 0.35, 0.5, 0.65, 0.82, 0.01), lit);
  if (under) for (const side of [1, 3]) chevron(ctx, f, side === 1 ? 0.72 : 0.28, 0.5, side, 0.07, C.ice, 2.2, s + 4 + side);
  else chevron(ctx, f, 0.5, 0.28, 0, 0.07, C.ice, 2.2, s + 4);
  chevron(ctx, f, 0.5, 0.74, 0, 0.07, C.ice, 2.2, s + 9);
  const flaps: LRect[] = under ? [[0.2, 0.08, 0.8, 0.17]] : [[0.08, 0.2, 0.17, 0.8], [0.83, 0.2, 0.92, 0.8]];
  for (const [i, fl] of flaps.entries()) {
    const p = rr(f, ...fl, 0.015);
    castShadow(ctx, p, f.l(0.08), 0.35);
    flat(ctx, p, C.hazard);
    ctx.save(); ctx.beginPath(); ctx.moveTo(p[0]![0], p[0]![1]); for (const q of p) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.clip();
    hatch(ctx, p, Math.PI / 4, f.l(0.07), { w: f.l(0.03), alpha: 0.85, seed: s + 10 + i });
    ctx.restore();
    ink(ctx, p, { closed: true, w: 1.3, seed: s + 12 + i });
  }
  const c = f.p(0.5, 0.5);
  const v = ellipsePts(c[0], c[1], f.l(0.14), f.l(0.14), s + 20, 0, 28);
  castShadow(ctx, v, f.l(0.05), 0.35);
  shape(ctx, v, C.brass, { w: 1.5, seed: s + 20 });
  ink(ctx, [[c[0] - f.l(0.11), c[1]], [c[0] + f.l(0.11), c[1]]], { w: 2.2, color: C.steelD, shade: false, taper: 0, seed: s + 21 });
  ink(ctx, [[c[0], c[1] - f.l(0.11)], [c[0], c[1] + f.l(0.11)]], { w: 2.2, color: C.steelD, shade: false, taper: 0, seed: s + 22 });
  rivet(ctx, c[0], c[1], f.l(0.03), C.brassL);
  intakeTop(ctx, f, s + 40);
}

/** A roller apron from above (a port's conveyor into a wall): a dark bed, rollers across its run. */
function apronTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, run: 'x' | 'y', s: number): void {
  shape(ctx, rr(f, x0, y0, x1, y1, 0.01), C.steelDD, { w: 1.2, seed: s });
  const len = run === 'y' ? y1 - y0 : x1 - x0, n = Math.max(2, Math.round(len / 0.11));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a: Pt = run === 'y' ? f.p(x0 + 0.03, y0 + (y1 - y0) * t) : f.p(x0 + (x1 - x0) * t, y0 + 0.03);
    const b: Pt = run === 'y' ? f.p(x1 - 0.03, y0 + (y1 - y0) * t) : f.p(x0 + (x1 - x0) * t, y1 - 0.03);
    ink(ctx, [a, b], { w: 1.3, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + i });
  }
}

/**
 * The Heart's data outlet from above (buildings.ts `dataOutletIso`): the violet data cabinet set
 * back on the out port's tile, its LEDs and grille, the conduit from the depot, the dispenser
 * hood and the roller apron out to the nozzle, the whip antenna's cyan tip.
 */
function dataOutletTop(ctx: Ctx, f: Frame, tx: number, ty: number, side: number, s: number): void {
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const dx = DX[side]!, dy = DY[side]!, cx = tx + 0.5, cy = ty + 0.5;
  const ccx = cx - dx * 0.2, ccy = cy - dy * 0.2;
  const hx = Math.abs(dy) * 0.36 + Math.abs(dx) * 0.19, hy = Math.abs(dx) * 0.36 + Math.abs(dy) * 0.19;
  const w = 0.17, ex = cx + dx * 0.38, ey = cy + dy * 0.38;
  apronTop(ctx, f, Math.min(cx, ex) - Math.abs(dy) * w, Math.min(cy, ey) - Math.abs(dx) * w, Math.max(cx, ex) + Math.abs(dy) * w, Math.max(cy, ey) + Math.abs(dx) * w, dx === 0 ? 'y' : 'x', s);
  pipe(ctx, [f.p(Math.min(4, Math.max(1, ccx)) - dx * 0.1 - 0.08, Math.min(4, Math.max(1, ccy)) - dy * 0.1 - 0.08), f.p(ccx - 0.08, ccy - 0.08)], f.l(0.06), C.steelL, s + 1);
  const cab = rr(f, ccx - hx, ccy - hy, ccx + hx, ccy + hy, 0.03);
  dropShadow(ctx, f, cab, 1.0, 0.28);
  shape(ctx, cab, C.violet, { w: 1.6, seed: s + 2 });
  grille(ctx, rr(f, ccx - hx + 0.06, ccy - hy + 0.06, ccx - hx + 0.06 + (hx * 2 - 0.12) * 0.55, ccy - hy + 0.06 + (hy * 2 - 0.12) * 0.55, 0.01), 3, s + 3);
  ledStrip(ctx, f.p(ccx - hx * 0.6 * Math.abs(dy) - hx * 0.1 * Math.abs(dx), ccy - hy * 0.6 * Math.abs(dx) - hy * 0.1 * Math.abs(dy)), f.p(ccx + hx * 0.6 * Math.abs(dy) - hx * 0.1 * Math.abs(dx), ccy + hy * 0.6 * Math.abs(dx) - hy * 0.1 * Math.abs(dy)), 4, f.l(0.025), [C.led, C.ledGreen], s + 4);
  const hood = rr(f, cx + dx * 0.05 - Math.abs(dy) * 0.2 - Math.abs(dx) * 0.09, cy + dy * 0.05 - Math.abs(dx) * 0.2 - Math.abs(dy) * 0.09, cx + dx * 0.05 + Math.abs(dy) * 0.2 + Math.abs(dx) * 0.09, cy + dy * 0.05 + Math.abs(dx) * 0.2 + Math.abs(dy) * 0.09, 0.02);
  castShadow(ctx, hood, f.l(0.05), 0.28);
  shape(ctx, hood, C.steelD, { w: 1.2, seed: s + 5 });
  light(ctx, ...f.p(cx + dx * 0.15, cy + dy * 0.15), f.l(0.03), C.led);
  light(ctx, ...f.p(ccx + 0.12, ccy + 0.12), f.l(0.035), C.led);
}

/** A bare corner of the Heart's slab from above (D86; buildings.ts `mountPlateIso`): a mounting plate stencilled on it, its four bolts. */
function mountPlateTop(ctx: Ctx, f: Frame, tx: number, ty: number, s: number): void {
  const [cx, cy] = heartCornerAt(tx, ty, 0.08), h = 0.27;
  const q = rr(f, cx - h, cy - h, cx + h, cy + h, 0.01);
  flat(ctx, q, C.steelD, 0.3);
  ink(ctx, q, { closed: true, w: 1, alpha: 0.45, shade: false, jitter: 0, seed: s });
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) rivet(ctx, ...f.p(cx + a * (h - 0.06), cy + b * (h - 0.06)), f.l(0.022), C.steelL);
}

/** The expertise archive from above (D86, level 3; buildings.ts `archiveIso`): its long shadow, the plinth, the violet band, the white enamel cap, its ring of indicator dots, the antenna's cyan lamp. */
function archiveTop(ctx: Ctx, f: Frame, tx: number, ty: number, s: number): void {
  const [cx, cy] = heartCornerAt(tx, ty);
  const c = f.p(cx, cy), wx = Math.min(4, Math.max(1, cx)), wy = Math.min(4, Math.max(1, cy));
  pipe(ctx, [f.p(wx, wy), c], f.l(0.06), C.steelL, s, false);
  const plinth = ellipsePts(c[0], c[1], f.l(0.36), f.l(0.36), s + 1, 0, 32);
  dropShadow(ctx, f, plinth, 1.1, 0.26);
  shape(ctx, plinth, C.steelD, { w: 1.3, shade: false, jitter: 0, seed: s + 1 });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.31), f.l(0.31), s + 2, 0, 32), C.violet, { w: 1.2, shade: false, jitter: 0, seed: s + 2 });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.27), f.l(0.27), s + 3, 0, 32), mix(LAB, C.steelL, 0.25), { w: 1.2, shade: false, jitter: 0, seed: s + 3 });
  ink(ctx, ellipsePts(c[0], c[1], f.l(0.18), f.l(0.18), s + 4, 0, 28), { closed: true, w: 1, color: C.violetL, alpha: 0.8, shade: false, jitter: 0, seed: s + 4 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    light(ctx, c[0] + Math.cos(a) * f.l(0.33), c[1] + Math.sin(a) * f.l(0.33), f.l(0.018), i % 2 ? DOT_G : DOT);
  }
  light(ctx, ...f.p(cx + 0.08, cy - 0.06), f.l(0.035), C.led);
  light(ctx, ...f.p(cx - 0.08, cy + 0.06), f.l(0.025), C.ledGreen);
}

/** The grid station from above (D86, level 4; buildings.ts `stationIso`): the lattice mast and its long shadow, its copper coil ring and red light, the teal transformer cabinet with its fins and bushings. */
function stationTop(ctx: Ctx, f: Frame, tx: number, ty: number, s: number): void {
  const { mast: [fx, fy], cab: [bx, by], top } = stationSpots(tx, ty);
  derrickTop(ctx, f, fx, fy, 0.17, 0.05, top, s);
  const m = f.p(fx, fy);
  ink(ctx, ellipsePts(m[0], m[1], f.l(0.3), f.l(0.3), s + 1, 0, 32), { closed: true, w: f.l(0.05), color: mix(C.coral, C.brass, 0.4), shade: false, jitter: 0, seed: s + 1 });
  light(ctx, m[0], m[1], f.l(0.05), C.ledRed);
  const cab = rr(f, bx - 0.24, by - 0.2, bx + 0.24, by + 0.2, 0.02);
  dropShadow(ctx, f, cab, 0.82, 0.28);
  shape(ctx, cab, mix(C.teal, C.steelL, 0.3), { w: 1.4, seed: s + 2 });
  for (let i = 1; i < 6; i++) ink(ctx, [f.p(bx - 0.24 + i * 0.08, by - 0.17), f.p(bx - 0.24 + i * 0.08, by + 0.17)], { w: 1, color: C.ink, alpha: 0.4, shade: false, taper: 0, jitter: 0, seed: s + 3 + i });
  for (const u of [-0.1, 0.1]) {
    const b = f.p(bx + u, by - u);
    shape(ctx, ellipsePts(b[0], b[1], f.l(0.065), f.l(0.065), s + 10, 0, 14), C.ice, { w: 1, shade: false, jitter: 0, seed: s + 10 });
    rivet(ctx, b[0], b[1], f.l(0.02), C.steelL);
  }
  light(ctx, ...f.p(bx + 0.18, by + 0.14), f.l(0.022), C.ledGreen);
  cable(ctx, f.p(bx - 0.1, by + 0.1), f.p(Math.min(4, Math.max(1, bx)), Math.min(4, Math.max(1, by))), f.l(0.035), 0.12, C.steelDD, s + 20);
}

/** A floodlight on the slab's edge from above (level 4): a dark hood, its warm lamp. */
function floodTop(ctx: Ctx, f: Frame, x: number, y: number, s: number): void {
  shape(ctx, rr(f, x - 0.06, y - 0.06, x + 0.06, y + 0.06, 0.02), C.steelDD, { w: 1, shade: false, jitter: 0, seed: s });
  light(ctx, ...f.p(x, y), f.l(0.04), C.ledWarm);
}

/** A construction drone from above: a coral body, four arms, four rotor discs, a status LED. */
function droneTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const c = f.p(x, y);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const q: Pt = [c[0] + Math.cos(a) * f.l(r), c[1] + Math.sin(a) * f.l(r)];
    ink(ctx, [c, q], { w: f.l(0.035), color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + k });
    shape(ctx, ellipsePts(q[0], q[1], f.l(r * 0.45), f.l(r * 0.45), s + 10 + k, 0, 16), mix(C.ice, C.steelL, 0.35), { w: 1, seed: s + 10 + k });
  }
  const body = rr(f, x - r * 0.38, y - r * 0.38, x + r * 0.38, y + r * 0.38, 0.02);
  castShadow(ctx, body, f.l(0.06), 0.25);
  shape(ctx, body, C.coral, { w: 1.2, seed: s + 20 });
  light(ctx, c[0], c[1], f.l(0.028), C.led);
}

// ── desert machines with a moving part (moving.ts): the wind turbine, the sand collector ──────

/** The iso art's desert paints (buildings.ts): weathered ochre, the vanes' sand-white, rust, sifted sand. */
const OCHRE = mix(C.peachD, C.dune, 0.4);
const OCHRE_L = mix(OCHRE, C.sand, 0.45);
const SAIL = mix(C.paperD, C.sand, 0.3);
const RUST = mix(C.coralD, C.mesa, 0.35);
const SANDFILL = mix(C.sand, C.dune, 0.4);

/** Local tile points round an axis-aligned local ellipse (it turns with the frame). */
const ellLocal = (f: Frame, cx: number, cy: number, rx: number, ry: number, n = 36): Pt[] =>
  Array.from({ length: n }, (_, i) => f.p(cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry));

/**
 * The wind turbine's body from above: the long shadows of the tower and the crown, the battered
 * ochre foot with its four buttress fins on the diagonals, the generator cabinet (grille, LEDs),
 * the slatted tower ringed in steel, the bearing collar the crown turns on.
 */
function turbineBodyTop(ctx: Ctx, f: Frame, s: number, w: WindSpec = WIND): void {
  const { cx, cy, k } = w, r = TURBINE.r * k, hk = w.zt / WIND.zt;
  const c = f.p(cx, cy);
  const P = (dx: number, dy: number): Pt => f.p(cx + dx * k, cy + dy * k);
  const R = (x0: number, y0: number, x1: number, y1: number, rad: number): Pt[] => rr(f, cx + x0 * k, cy + y0 * k, cx + x1 * k, cy + y1 * k, rad);
  flat(ctx, ellipsePts(c[0] + f.l(0.36 * hk), c[1] + f.l(0.5 * hk), f.l(r * 0.92), f.l(r * 0.92), s, 0.01, 40), C.inkSoft, 0.16);
  batter(ctx, R(-0.72, -0.72, 0.72, 0.72, 0.06), R(-0.6, -0.6, 0.6, 0.6, 0.04), OCHRE, OCHRE_L, s + 1);
  const top = R(-0.6, -0.6, 0.6, 0.6, 0.04), [tx0, ty0] = bounds(top);
  stipple(ctx, tx0, ty0, f.l(1.2 * k), f.l(1.2 * k), Math.round(90 * k * k), { clip: top, color: C.inkSoft, alpha: 0.3, seed: s + 2, r: 0.75 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a), tx = -sa * 0.045, ty = ca * 0.045;
    const fin: Pt[] = [P(ca * 0.16 + tx, sa * 0.16 + ty), P(ca * 0.66 + tx * 0.7, sa * 0.66 + ty * 0.7), P(ca * 0.66 - tx * 0.7, sa * 0.66 - ty * 0.7), P(ca * 0.16 - tx, sa * 0.16 - ty)];
    dropShadow(ctx, f, fin, 1.2 * k, 0.26);
    shape(ctx, fin, OCHRE_L, { w: 1.2, seed: s + 3 + i });
    ink(ctx, [P(ca * 0.18, sa * 0.18), P(ca * 0.64, sa * 0.64)], { w: 1, color: mix(OCHRE, C.ink, 0.35), alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 8 + i });
  }
  const cab = R(0.24, 0.24, 0.62, 0.62, 0.03);
  dropShadow(ctx, f, cab, 1.0 * k, 0.28);
  shape(ctx, cab, OCHRE_L, { w: 1.4, seed: s + 12 });
  grille(ctx, R(0.3, 0.3, 0.56, 0.46, 0.01), 3, s + 13);
  ledStrip(ctx, P(0.32, 0.54), P(0.54, 0.54), 3, f.l(0.022), [C.led, C.ledGreen, C.led], s + 14);
  const foot = ellipsePts(c[0], c[1], f.l(0.27 * k), f.l(0.27 * k), s + 15, 0.003, 36);
  dropShadow(ctx, f, foot, 2.6 * hk, 0.24);
  shape(ctx, foot, OCHRE, { w: 1.6, seed: s + 15 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    ink(ctx, [[c[0] + Math.cos(a) * f.l(0.17 * k), c[1] + Math.sin(a) * f.l(0.17 * k)], [c[0] + Math.cos(a) * f.l(0.265 * k), c[1] + Math.sin(a) * f.l(0.265 * k)]], { w: 1.1, color: mix(OCHRE, C.ink, 0.4), shade: false, taper: 0, jitter: 0, seed: s + 16 + i });
  }
  ink(ctx, ellipsePts(c[0], c[1], f.l(0.215 * k), f.l(0.215 * k), s + 30, 0, 32), { closed: true, w: 2.2, color: C.steel, shade: false, seed: s + 30 });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.17 * k), f.l(0.17 * k), s + 31, 0, 28), C.steel, { w: 1.4, seed: s + 31 });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.11 * k), f.l(0.11 * k), s + 32, 0, 24), C.steelL, { w: 1.1, shade: false, seed: s + 32 });
}

/**
 * The turbine's crown from above at phase t (a third of a turn per period): the Savonius rotor's
 * three sail-vanes curling out from the shaft — each the top edge of a curved plate, its hollow
 * in shade and its tip rust-banded — inside the steel head ring, the hub and its red light.
 */
function turbineCrownTop(ctx: Ctx, f: Frame, s: number, t: number): void {
  const { cx, cy, r, vanes } = TURBINE;
  const c = f.p(cx, cy);
  const th = (t * 2 * Math.PI) / vanes;
  const ring = ellipsePts(c[0], c[1], f.l(r + 0.03), f.l(r + 0.03), s, 0, 48);
  // The foot ring and the inside of the crown, deep in its own shade.
  flat(ctx, ring, C.inkSoft, 0.18);
  const N = 12;
  for (let i = 0; i < vanes; i++) {
    const a0 = th + (i / vanes) * Math.PI * 2;
    const at = (u: number, off: number): Pt => {
      const v = vaneAt(a0, u), w = vaneAt(a0, Math.min(1, u + 0.02)), q = vaneAt(a0, Math.max(0, u - 0.02));
      const x = cx + Math.cos(v.a) * v.rho, y = cy + Math.sin(v.a) * v.rho;
      const dx = Math.cos(w.a) * w.rho - Math.cos(q.a) * q.rho, dy = Math.sin(w.a) * w.rho - Math.sin(q.a) * q.rho, L = Math.hypot(dx, dy) || 1;
      return f.p(x - (dy / L) * off, y + (dx / L) * off); // off > 0: towards the hollow (it curls towards growing angles)
    };
    const us = Array.from({ length: N + 1 }, (_, k) => k / N);
    const hollow = (u: number): number => 0.022 + 0.07 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1)), 0.7);
    const shadowSide = [...us.map((u) => at(u, -0.014)), ...us.slice().reverse().map((u) => at(u, hollow(u)))];
    flat(ctx, shadowSide, mix(SAIL, C.ink, 0.45));
    const edge = [...us.map((u) => at(u, -0.016)), ...us.slice().reverse().map((u) => at(u, 0.016))];
    flat(ctx, edge, SAIL);
    const tip = us.filter((u) => u >= 0.8);
    flat(ctx, [...tip.map((u) => at(u, -0.016)), ...tip.slice().reverse().map((u) => at(u, hollow(u)))], RUST);
    ink(ctx, shadowSide, { closed: true, w: 1.3, seed: s + 10 + i });
    ink(ctx, us.map((u) => at(u, -0.016)), { w: 1.6, shade: false, taper: 0, jitter: 0, seed: s + 14 + i });
  }
  ink(ctx, ring, { closed: true, w: f.l(0.055) + 2, color: C.ink, shade: false, seed: s + 20 });
  ink(ctx, ring, { closed: true, w: f.l(0.055), color: C.steel, shade: false, seed: s + 21 });
  ink(ctx, ring.filter(([x, y]) => x + y < c[0] + c[1]), { w: 1, color: C.steelL, shade: false, taper: 0.2, seed: s + 22 });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.075), f.l(0.075), s + 30, 0, 20), C.steelD, { w: 1.3, seed: s + 30 });
  light(ctx, c[0], c[1], f.l(0.04), C.ledRed);
}

/**
 * The sand collector's body from above (the hopper's side of the split): the steel skid, the
 * ochre hopper heaped with sifted sand (its outlet is the port at the front), the sieve over its
 * back, the teal motor house with its grille, motor drum and LEDs.
 */
function collectorBodyTop(ctx: Ctx, f: Frame, s: number): void {
  const { split } = SAND_WHEEL;
  const skid = rr(f, 0.05, 0.05, 1.95, split - 0.02, 0.06);
  castShadow(ctx, skid, f.l(0.05), 0.3);
  shape(ctx, skid, C.steel, { w: 1.6, seed: s });
  for (const [x, y] of [[0.14, 0.14], [1.86, 0.14], [0.14, split - 0.11], [1.86, split - 0.11]] as const) rivet(ctx, ...f.p(x, y), f.l(0.03), C.steelL);
  const outer = rr(f, 0.1, 0.08, 1.1, 0.84, 0.03), inner = rr(f, 0.22, 0.2, 0.98, 0.72, 0.02);
  dropShadow(ctx, f, outer, 1.05, 0.26);
  flat(ctx, outer, OCHRE_L);
  const [X0, Y0, X1, Y1] = bounds(outer), [x0, y0, x1, y1] = bounds(inner);
  flat(ctx, [[X0, Y0], [X1, Y0], [x1, y0], [x0, y0]], mix(OCHRE, C.ink, 0.3));
  flat(ctx, [[X0, Y0], [x0, y0], [x0, y1], [X0, Y1]], mix(OCHRE, C.ink, 0.2));
  flat(ctx, inner, C.ink);
  const hc = f.p(0.6, 0.48);
  const heap = ellipsePts(hc[0], hc[1], f.l(0.34), f.l(0.22), s + 1, 0.06, 24, f.rot & 1 ? Math.PI / 2 : 0);
  flat(ctx, heap, SANDFILL);
  flat(ctx, ellipsePts(hc[0] - f.l(0.07), hc[1] - f.l(0.05), f.l(0.18), f.l(0.11), s + 2, 0.05, 20, f.rot & 1 ? Math.PI / 2 : 0), mix(SANDFILL, '#ffffff', 0.35));
  stipple(ctx, hc[0] - f.l(0.36), hc[1] - f.l(0.36), f.l(0.72), f.l(0.72), 50, { clip: heap, color: C.inkSoft, alpha: 0.35, seed: s + 3, r: 0.8 });
  ink(ctx, outer, { closed: true, w: 1.8, seed: s + 4 });
  ink(ctx, inner, { closed: true, w: 1.1, alpha: 0.7, shade: false, seed: s + 5 });
  // The sieve: a screen over the hopper's back, on ochre rails.
  const sv = rr(f, 0.2, 0.42, 1.0, split - 0.03, 0.01);
  dropShadow(ctx, f, sv, 0.6, 0.22);
  flat(ctx, sv, mix(SANDFILL, C.ink, 0.1));
  ctx.save();
  ctx.strokeStyle = mix(OCHRE, C.ink, 0.55); ctx.lineWidth = 0.8; ctx.globalAlpha = 0.7;
  for (let i = 1; i < 9; i++) { const x = 0.2 + (0.8 * i) / 9; const [a, b] = [f.p(x, 0.44), f.p(x, split - 0.05)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  for (let j = 1; j < 4; j++) { const y = 0.42 + ((split - 0.45) * j) / 4; const [a, b] = [f.p(0.22, y), f.p(0.98, y)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.restore();
  for (const [i, x] of [0.38, 0.55, 0.74].entries()) ink(ctx, [f.p(x, split - 0.06), f.p(x + 0.02, 0.6 - 0.05 * i)], { w: f.l(0.035), color: mix(SANDFILL, '#ffffff', 0.3), shade: false, taper: 0.4, seed: s + 6 + i });
  ink(ctx, sv, { closed: true, w: 1.4, seed: s + 9 });
  for (const x of [0.2, 1.0]) ink(ctx, [f.p(x, 0.42), f.p(x, split - 0.03)], { w: f.l(0.04), color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 10 });
  const mh = rr(f, 1.26, 0.16, 1.86, 0.84, 0.04);
  castShadow(ctx, mh, f.l(0.12), 0.3);
  shape(ctx, mh, C.teal, { w: 1.8, seed: s + 11 });
  grille(ctx, rr(f, 1.34, 0.24, 1.78, 0.36, 0.02), 3, s + 12);
  drumTop(ctx, rr(f, 1.43, 0.3, 1.69, 0.72, 0.04), (f.rot & 1) === 0 ? 'y' : 'x', C.steelL, s + 13, 2, f.l(0.06));
  ledStrip(ctx, f.p(1.36, 0.77), f.p(1.62, 0.77), 3, f.l(0.024), [C.ledGreen, C.led, C.ledWarm], s + 14);
}

/**
 * The sand collector's wheel side from above at phase t (an eighth of a turn per period): the pit
 * in the bare floor with its spoil heaps, the trestles and the axle, the bucket wheel seen
 * foreshortened as the excavator's cutter is, its chain to the motor house.
 */
function collectorWheelTop(ctx: Ctx, f: Frame, s: number, t: number): void {
  const { cx, cy, r, half, buckets, split } = SAND_WHEEL;
  for (const [i, dx] of [-0.37, 0.37].entries()) {
    const heap = ellLocal(f, cx + dx, cy + 0.08, 0.13, 0.3, 24);
    shape(ctx, heap, mix(C.sand, C.dune, 0.45), { w: 1, alpha: 0.55, shade: false, seed: s + i });
  }
  const pit = ellLocal(f, cx, cy, 0.24, 0.5);
  flat(ctx, pit, mix(C.dug, C.mesa, 0.3));
  ctx.save(); pathOf(ctx, pit); ctx.clip();
  flat(ctx, pit.map(([x, y]) => [x + f.l(0.08), y + f.l(0.1)] as Pt), mix(C.dug, C.ink, 0.42));
  ctx.restore();
  ink(ctx, pit, { closed: true, w: 1.3, alpha: 0.7, shade: false, seed: s + 3 });
  for (const k of [-1, 1]) {
    const x = cx + k * (half + 0.13);
    pipe(ctx, [f.p(x, cy - 0.32), f.p(x, cy + 0.32)], f.l(0.05), C.steel, s + 4 + k, false);
  }
  pipe(ctx, [f.p(cx - half - 0.2, cy), f.p(cx + half + 0.2, cy)], f.l(0.06), C.steelL, s + 7, false);
  cable(ctx, f.p(cx + half + 0.21, cy), f.p(1.42, split + 0.01), f.l(0.03), 0.12, C.steelDD, s + 8);
  bucketWheelTop(ctx, f, cx, cy, r, half + 0.06, 'y', buckets, (t * 2 * Math.PI) / buckets, C.steelL, s + 10, { bucket: C.brass, load: SANDFILL, full: bucketFull });
}

// ── quartz (D87): the face cutter and the quartz workshop, from above ─────────────────────────

/** Chips of cut quartz lying round local (x, y) within ±(rx, ry), from above: small white points, inked. */
function quartzChipsTop(ctx: Ctx, f: Frame, x: number, y: number, rx: number, ry: number, n: number, s: number): void {
  const rng = makeRng(s);
  for (let i = 0; i < n; i++) {
    const cx = x + rng.range(-1, 1) * rx, cy = y + rng.range(-1, 1) * ry, a = rng.range(0, Math.PI * 2), k = rng.range(0.7, 1.15);
    crystal(ctx, f.p(cx, cy), f.p(cx + Math.cos(a) * 0.12 * k, cy + Math.sin(a) * 0.12 * k), f.l(0.035 * k), 1, true);
  }
}

/**
 * The face cutter's body from above (buildings.ts `cutterBody`): the skid, the two crawler tracks,
 * the gathering apron heaped with quartz, the conveyor up the left to the chute over the outlet,
 * the ochre power house with its amber beacon and the floodlight at its back, the cutter motor,
 * the boom's pivot blocks.
 */
function cutterBodyTop(ctx: Ctx, f: Frame, s: number): void {
  const { split } = CUTTER;
  plinth(ctx, f, C.steelD, 0.05, s, true, [0, 0, 2, split]);
  const ap = rr(f, 0.42, 1.18, 1.58, split - 0.02, 0.02);
  shape(ctx, ap, C.steel, { w: 1.3, seed: s + 1 });
  shape(ctx, rr(f, 0.44, split - 0.11, 1.56, split - 0.05, 0.005), C.hazard, { w: 0.9, shade: false, jitter: 0, seed: s + 2 });
  quartzChipsTop(ctx, f, 1.1, 1.32, 0.36, 0.1, 9, s + 3);
  for (const [i, x] of [0.24, 1.76].entries()) {
    const tr = rr(f, x - 0.16, 0.14, x + 0.16, 1.52, 0.05);
    castShadow(ctx, tr, f.l(0.07), 0.3);
    shape(ctx, tr, C.steelDD, { w: 1.6, seed: s + 10 + i });
    for (let k = 1; k < 12; k++) {
      const y = 0.14 + (1.38 * k) / 12;
      ink(ctx, [f.p(x - 0.13, y), f.p(x + 0.13, y)], { w: 1.4, color: C.steel, shade: false, taper: 0, jitter: 0, seed: s + 12 + k });
    }
    roofTop(ctx, f, x - 0.15, 1.28, x + 0.15, split - 0.02, 1.08, C.steelD, s + 20 + i, 0.02);
    rivet(ctx, ...f.p(x, 1.42), f.l(0.035), C.brassL);
  }
  // The chute over the outlet and the conveyor, quartz riding it, its head pulley.
  const hop = rr(f, 0.31, 0.08, 0.71, 0.4, 0.03);
  dropShadow(ctx, f, hop, 0.8, 0.24);
  shape(ctx, hop, C.steelL, { w: 1.4, seed: s + 30 });
  flat(ctx, rr(f, 0.38, 0.14, 0.64, 0.34, 0.02), C.ink);
  const belt = rr(f, 0.47, 0.3, 0.79, 1.4, 0.01);
  dropShadow(ctx, f, belt, 0.8, 0.22);
  shape(ctx, belt, C.steelDD, { w: 1.4, seed: s + 31 });
  for (let k = 1; k < 10; k++) { const y = 0.3 + (1.1 * k) / 10; ink(ctx, [f.p(0.5, y), f.p(0.76, y)], { w: 0.9, color: C.steel, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 32 + k }); }
  for (const x of [0.47, 0.79]) ink(ctx, [f.p(x, 0.3), f.p(x, 1.4)], { w: f.l(0.035), color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 43 });
  quartzChipsTop(ctx, f, 0.63, 0.9, 0.08, 0.42, 6, s + 44);
  drumTop(ctx, rr(f, 0.45, 0.25, 0.81, 0.37, 0.03), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 45, 1, f.l(0.08));
  // The cutter motor at the power house's back, then the house: its roof, a grille, the beacon, the lamp bar.
  drumTop(ctx, rr(f, 0.99, 1.1, 1.51, 1.34, 0.05), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 46, 2, f.l(0.09));
  roofTop(ctx, f, 0.9, 0.2, 1.6, 1.1, 1.1, mix(MINER, '#ffffff', 0.14), s + 50);
  grille(ctx, rr(f, 1.2, 0.58, 1.5, 0.86, 0.01), 3, s + 51);
  shape(ctx, rr(f, 0.94, 1.03, 1.56, 1.07, 0.005), C.hazard, { w: 0.8, shade: false, jitter: 0, seed: s + 52 });
  const lamp = rr(f, 1.02, 0.96, 1.48, 1.08, 0.02);
  shape(ctx, lamp, C.steelD, { w: 1.1, shade: false, jitter: 0, seed: s + 53 });
  for (const x of [1.15, 1.35]) light(ctx, ...f.p(x, 1.04), f.l(0.03), C.led);
  shape(ctx, ellipsePts(...f.p(1.08, 0.4), f.l(0.07), f.l(0.07), s + 54, 0, 16), C.steelDD, { w: 1, shade: false, jitter: 0, seed: s + 54 });
  light(ctx, ...f.p(1.08, 0.4), f.l(0.045), C.ledWarm);
  ledStrip(ctx, f.p(1.0, 0.86), f.p(1.0, 0.6), 3, f.l(0.022), [C.ledWarm, C.led, C.ledGreen], s + 55);
}

/**
 * The face cutter's drum from above at phase t (buildings.ts `cutterDrum`): the spoil at the foot
 * of the face, the boom's arms, the drum across the back — its upper half's flights and picks,
 * the picks at its rim jutting past it — so it turns into the rock in plan too.
 */
function cutterDrumTop(ctx: Ctx, f: Frame, s: number, t: number): void {
  const { cx, cy, r, half, starts, picks, twist, pick, split } = CUTTER;
  const rng = makeRng(s + 5);
  for (let k = 0; k < 7; k++) {
    const blob = ellLocal(f, cx + rng.range(-0.8, 0.8), cy + rng.range(-0.18, 0.12), rng.range(0.06, 0.11), rng.range(0.05, 0.09), 14);
    shape(ctx, blob, k % 2 ? mix(C.steel, C.peachD, 0.4) : mix(C.mesa, C.steelL, 0.3), { w: 1, shade: false, seed: s + 10 + k });
  }
  quartzChipsTop(ctx, f, cx, cy - 0.05, 0.75, 0.14, 8, s + 20);
  for (const k of [-1, 1]) pipe(ctx, [f.p(cx + k * 0.76, split + 0.01), f.p(cx + k * (half + 0.05), cy)], f.l(0.09), C.coral, s + 30 + k);
  const phase = (t * 2 * Math.PI) / starts;
  // A point of the drum's surface at angle a seen from above (a ∈ (0, π): its upper half).
  const at = (u: number, a: number, rho: number = r): Pt => f.p(cx + u * half, cy + Math.cos(a) * rho);
  drumTop(ctx, rr(f, cx - half, cy - r, cx + half, cy + r, 0.04), (f.rot & 1) === 0 ? 'x' : 'y', mix(C.steelL, C.ice, 0.35), s + 40, 0, f.l(0.14));
  for (let k = 0; k < starts; k++) {
    let run: Pt[] = [];
    const flush = (): void => { if (run.length > 1) ink(ctx, run, { w: 1.6, color: C.steelDD, shade: false, taper: 0.1, jitter: 0, seed: s + 50 + k }); run = []; };
    for (let q = 0; q <= 24; q++) {
      const u = -0.97 + (1.94 * q) / 24, a = phase + (k * 2 * Math.PI) / starts + u * twist;
      if (Math.sin(a) > 0) run.push(at(u, a, r * 0.98)); else flush();
    }
    flush();
  }
  for (let k = 0; k < starts; k++) for (let j = 0; j < picks; j++) {
    const u = -0.9 + (1.8 * j) / (picks - 1), a = phase + (k * 2 * Math.PI) / starts + u * twist;
    if (Math.sin(a + 0.2) < -0.25) continue;
    // (A little short of the iso picks: the sprite's margin holds the ones at the drum's rim.)
    const b = at(u, a, r * 0.96), e = at(u, a + 0.2, r + pick * 0.75);
    ink(ctx, [b, e], { w: f.l(0.07), color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 60 + j });
    ink(ctx, [at(u, a + 0.1, r + pick * 0.4), e], { w: f.l(0.045), color: C.brassL, shade: false, taper: 0.4, jitter: 0, seed: s + 61 + j });
  }
  for (const k of [-1, 1]) rivet(ctx, ...f.p(cx + k * half, cy), f.l(0.04), C.brassL);
}

/**
 * The quartz workshop from above (buildings.ts `quartzWorkshopIso`): the saw bench — the coolant
 * tray, the quartz bar and its cut blades, the saw's coral guard and motor — the winding bench —
 * the copper spool, the headstock and the blade in its chuck — the lapping wheel with its blanks
 * and pressure arm, the tray of tin-can oscillators by the outlet, the control cabinet.
 */
function quartzWorkshopTop(ctx: Ctx, f: Frame, s: number): void {
  plinth(ctx, f, C.steel, 0.05, s);
  roofTop(ctx, f, 0.12, 1.08, 0.92, 1.86, 0.7, C.steelD, s + 1);
  flat(ctx, rr(f, 0.18, 1.14, 0.86, 1.8, 0.01), mix(C.teal, C.ink, 0.5));
  const bar = rr(f, 0.2, 1.34, 0.6, 1.5, 0.01);
  shape(ctx, bar, QZ.lit, { w: 1.1, shade: false, jitter: 0, seed: s + 2 });
  flat(ctx, rr(f, 0.2, 1.44, 0.6, 1.5, 0), QZ.shade);
  for (let i = 0; i < 4; i++) { const x = 0.68 + i * 0.045; shape(ctx, rr(f, x, 1.3, x + 0.025, 1.54, 0), QZ.body, { w: 0.8, shade: false, jitter: 0, seed: s + 3 + i }); }
  roofTop(ctx, f, 0.12, 1.28, 0.22, 1.56, 1.34, C.teal, s + 8, 0.01);
  const guard = rr(f, 0.35, 1.14, 0.49, 1.7, 0.02);
  dropShadow(ctx, f, guard, 1.7, 0.24);
  shape(ctx, guard, C.coral, { w: 1.3, seed: s + 9 });
  light(ctx, ...f.p(0.42, 1.24), f.l(0.025), C.ledWarm);
  roofTop(ctx, f, 1.1, 1.08, 1.86, 1.86, 0.6, C.steelD, s + 10);
  drumTop(ctx, rr(f, 1.21, 1.49, 1.43, 1.75, 0.03), (f.rot & 1) === 0 ? 'x' : 'y', COPPER, s + 11, 3, f.l(0.1));
  for (const x of [1.18, 1.46]) shape(ctx, rr(f, x - 0.02, 1.42, x + 0.02, 1.82, 0.01), C.steelL, { w: 1, shade: false, jitter: 0, seed: s + 12 + x });
  roofTop(ctx, f, 1.56, 1.18, 1.82, 1.46, 1.0, C.violet, s + 14);
  ledStrip(ctx, f.p(1.62, 1.4), f.p(1.76, 1.4), 2, f.l(0.022), [C.led, C.ledWarm], s + 15);
  drumTop(ctx, rr(f, 1.4, 1.25, 1.56, 1.39, 0.02), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 16, 0, f.l(0.06));
  shape(ctx, rr(f, 1.3, 1.29, 1.4, 1.35, 0), QZ.lit, { w: 0.8, shade: false, jitter: 0, seed: s + 17 });
  ink(ctx, [f.p(1.32, 1.5), f.p(1.36, 1.32)], { w: f.l(0.025), color: COPPER, shade: false, taper: 0, jitter: 0, seed: s + 18 });
  // The lapping wheel: its base, the brass plate and its grooves, three blanks, the press head.
  const [lx, ly] = f.p(1.28, 0.55);
  const base = ellipsePts(lx, ly, f.l(0.3), f.l(0.3), s + 20, 0, 32);
  castShadow(ctx, base, f.l(0.07), 0.3);
  shape(ctx, base, C.steelD, { w: 1.5, seed: s + 20 });
  shape(ctx, ellipsePts(lx, ly, f.l(0.26), f.l(0.26), s + 21, 0, 32), C.brassL, { w: 1.2, shade: false, jitter: 0, seed: s + 21 });
  for (const k of [0.45, 0.72]) ink(ctx, ellipsePts(lx, ly, f.l(0.26 * k), f.l(0.26 * k), s + 22, 0, 28), { closed: true, w: 0.8, color: C.brass, shade: false, jitter: 0, seed: s + 22 });
  for (const [i, a] of [0.5, 2.6, 4.4].entries()) {
    const x = 1.28 + Math.cos(a) * 0.15, y = 0.55 + Math.sin(a) * 0.15;
    shape(ctx, rr(f, x - 0.045, y - 0.03, x + 0.045, y + 0.03, 0), QZ.lit, { w: 0.8, shade: false, jitter: 0, seed: s + 23 + i });
  }
  pipe(ctx, [f.p(1.66, 0.55), f.p(1.28, 0.55)], f.l(0.05), C.steelL, s + 27, false);
  shape(ctx, ellipsePts(lx, ly, f.l(0.06), f.l(0.06), s + 28, 0, 16), C.steelD, { w: 1, shade: false, jitter: 0, seed: s + 28 });
  // The tray of oscillators.
  roofTop(ctx, f, 0.14, 0.16, 0.84, 0.8, 0.46, C.steelDD, s + 30);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
    const [x, y] = f.p(0.24 + i * 0.165, 0.27 + j * 0.2);
    const c = ellipsePts(x, y, f.l(0.05), f.l(0.05), s + 31 + i + j * 4, 0, 14);
    flat(ctx, c.map(([a, b]) => [a + 1.5, b + 2] as Pt), C.ink, 0.3);
    shape(ctx, c, CAN, { w: 1, shade: false, jitter: 0, seed: s + 31 });
    flat(ctx, ellipsePts(x - f.l(0.015), y - f.l(0.015), f.l(0.025), f.l(0.025), s + 32, 0, 10), CAN_L);
  }
  cabinetTop(ctx, f, 1.66, 0.12, 1.9, 0.95, 1.2, mix(C.steel, C.violet, 0.3), s + 40);
}

// ── the deep bore from above (moving.ts `BORE`; the iso drawing's `boreBody` / `boreTable`) ─────

/** Pale cast concrete (the iso art's footings and collar). */
const CONCRETE = TOWER;

/** A heap of spoil from above at local (x, y): a lumpy violet mound, its shaded flank, lumps of deep rock. */
function spoilTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const [px, py] = f.p(x, y), R = f.l(r), rng = makeRng(s);
  const pts = ellipsePts(px, py, R, R * 0.92, s, 0.14, 18);
  castShadow(ctx, pts, f.l(0.07), 0.3);
  flat(ctx, pts, SPOIL);
  ctx.save(); pathOf(ctx, pts); ctx.clip();
  const sh = shadowCrescent(px, py, R, 0.45, s + 1);
  flat(ctx, sh, mix(SPOIL, C.ink, 0.3));
  hatch(ctx, sh, Math.PI / 4, 2.8, { alpha: 0.3, seed: s + 2 });
  stipple(ctx, px - R, py - R, R * 2, R * 2, Math.round(R * 1.4), { color: C.rock4, alpha: 0.7, seed: s + 3, r: 1 });
  ctx.restore();
  ink(ctx, pts, { closed: true, w: 1.4, seed: s + 4 });
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0.15, 0.6) * R, lr = rng.range(2.2, 3.4);
    const lx = px + Math.cos(a) * d, ly = py + Math.sin(a) * d;
    shape(ctx, ellipsePts(lx, ly, lr, lr * 0.85, s + 10 + k, 0.25, 7), mix(C.rock4, C.ink, 0.15), { w: 1, shade: false, jitter: 0, seed: s + 10 + k });
    flat(ctx, ellipsePts(lx - lr * 0.3, ly - lr * 0.3, lr * 0.32, lr * 0.28, s + 20 + k, 0, 6), C.rock2);
  }
}

/** A point of the bore's derrick seen from above: leg k's corner at height z. */
const legTop = (f: Frame, k: number, z: number): Pt => { const [x, y] = boreLeg(k, z); return f.p(x, y); };

/**
 * The bore's derrick from above: its shadow, two of its coral girts (the lowest and the middle one:
 * all five and the braces would mesh into a lid over the collar, the spoil and the turning table),
 * the four legs converging on the crown, the racking board on its east face with its lamps, the
 * drilling line. `over`: only the lattice and the line, redrawn by the part over the turning table
 * (no shadow over it, no board, no lamp lit twice).
 */
function boreRigTop(ctx: Ctx, f: Frame, s: number, over = false): void {
  const { top, foot, girts, board } = BORE;
  const base = [0, 1, 2, 3].map((k) => legTop(f, k, foot)), crown = [0, 1, 2, 3].map((k) => legTop(f, k, top));
  if (!over) {
    const d = f.l(0.11 * top * 0.5);
    flat(ctx, hull([...base, ...crown.map(([x, y]) => [x + d * 0.7, y + d] as Pt)]), C.inkSoft, 0.16);
  }
  for (const z of [girts[0], girts[2]]) for (let k = 0; k < 4; k++) rod(ctx, legTop(f, k, z), legTop(f, (k + 1) % 4, z), 2.2, C.coral);
  for (let k = 0; k < 4; k++) rod(ctx, base[k]!, crown[k]!, 3, C.steel);
  // The drilling line from the draw-works drum up to the crown's fast sheave.
  rod(ctx, f.p(0.36, 1.7), f.p(BORE.cx - 0.1, BORE.cy), 1, C.steelL);
  if (over) return;
  // The racking board on the east face, railed, two lamps at its edge.
  const x0 = boreLeg(1, board)[0] - 0.02, x1 = x0 + 0.24;
  const bd = rr(f, x0, 1.3, x1, 1.7, 0.01);
  dropShadow(ctx, f, bd, 1.2, 0.22);
  shape(ctx, bd, C.steelL, { w: 1.2, shade: false, jitter: 0, seed: s + 70 });
  ink(ctx, [f.p(x0, 1.3), f.p(x1, 1.3), f.p(x1, 1.7), f.p(x0, 1.7)], { w: 1.2, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 71 });
  for (const y of [1.36, 1.64]) floodTop(ctx, f, x1 + 0.02, y, s + 72);
}

/** The bore's body from above: everything but the turning table and the derrick's crown over it (`boreTableTop`). */
function boreBodyTop(ctx: Ctx, f: Frame, s: number): void {
  const { cx, cy, collar, table } = BORE;
  // The outlet works' skid, the draw-works' and the power house's.
  plinth(ctx, f, C.steelD, 0.04, s, true, [0, 0, 3, 0.54]);
  for (const [i, q] of [[0.04, 0.8, 0.6, 2.2], [0.74, 2.4, 2.06, 2.96]].entries()) roofTop(ctx, f, q[0]!, q[1]!, q[2]!, q[3]!, 0.12, C.steelD, s + 1 + i, 0.03);
  // The collar sunk in the ground: concrete, bolted, spoil splashed on it, the hole's dark mouth, the table's housing.
  const [px, py] = f.p(cx, cy);
  const ring = ellipsePts(px, py, f.l(collar), f.l(collar), s + 3, 0.004, 40);
  castShadow(ctx, ring, f.l(0.03), 0.22);
  shape(ctx, ring, mix(CONCRETE, '#ffffff', 0.3), { w: 1.4, seed: s + 3 });
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3; rivet(ctx, px + Math.cos(a) * f.l(collar - 0.06), py + Math.sin(a) * f.l(collar - 0.06), f.l(0.025), C.steelD); }
  stipple(ctx, px - f.l(collar), py - f.l(collar), f.l(collar * 2), f.l(collar * 2), 16, { clip: ring, color: C.rock4, alpha: 0.6, seed: s + 4, r: 1.1 });
  flat(ctx, ellipsePts(px, py, f.l(table + 0.1), f.l(table + 0.1), s + 5, 0, 32), C.steelDD);
  shape(ctx, ellipsePts(px, py, f.l(table + 0.04), f.l(table + 0.04), s + 6, 0, 32), C.steelD, { w: 1.3, shade: false, jitter: 0, seed: s + 6 });
  // The footings, the spoil heaps round the collar and in the back corners.
  for (let k = 0; k < 4; k++) { const [x, y] = boreLeg(k, 0); roofTop(ctx, f, x - 0.11, y - 0.11, x + 0.11, y + 0.11, 0.16, CONCRETE, s + 10 + k, 0.02); }
  for (const [i, [x, y, r]] of ([[0.95, 0.95, 0.24], [2.05, 0.95, 0.24], [2.05, 2.05, 0.25], [0.95, 2.05, 0.24], [2.66, 2.66, 0.27], [0.36, 2.66, 0.25]] as const).entries()) spoilTop(ctx, f, x, y, r, s + 20 + i * 9);
  // The draw-works (W): the motor house, the brass drum between its stands.
  roofTop(ctx, f, 0.08, 0.84, 0.56, 1.28, 1.05, C.teal, s + 80);
  grille(ctx, rr(f, 0.16, 0.92, 0.48, 1.1, 0.01), 3, s + 81);
  ledStrip(ctx, f.p(0.2, 1.2), f.p(0.44, 1.2), 2, f.l(0.025), [C.ledGreen, C.led], s + 82);
  for (const y of [1.33, 2.07]) roofTop(ctx, f, 0.14, y - 0.03, 0.5, y + 0.03, 0.74, C.steelD, s + 83, 0.01);
  drumTop(ctx, rr(f, 0.12, 1.37, 0.52, 2.03, 0.04), (f.rot & 1) === 0 ? 'y' : 'x', C.brass, s + 84, 5, f.l(0.1));
  // The power house (S): coral, its grilles, a radiator fan, a hazard band along its foot, LEDs.
  roofTop(ctx, f, 0.8, 2.44, 2.0, 2.92, 1.15, C.coral, s + 90);
  for (const x of [0.88, 1.74]) grille(ctx, rr(f, x, 2.52, x + 0.18, 2.84, 0.01), 3, s + 91);
  fanTop(ctx, f, 1.5, 2.68, 0.17, s + 92);
  shape(ctx, rr(f, 0.84, 2.86, 1.96, 2.9, 0.005), C.hazard, { w: 0.8, shade: false, jitter: 0, seed: s + 93 });
  ledStrip(ctx, f.p(1.1, 2.52), f.p(1.3, 2.52), 3, f.l(0.022), [C.ledWarm, C.led, C.ledGreen], s + 94);
  // The pipe rack (E): three trestles, drill pipe on them.
  for (const y of [0.95, 1.5, 2.05]) ink(ctx, [f.p(2.44, y), f.p(2.92, y)], { w: f.l(0.05), color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 100 });
  const along = (f.rot & 1) === 0 ? 'y' : 'x';
  for (const [i, x] of [2.56, 2.8, 2.62, 2.74, 2.68].entries()) drumTop(ctx, rr(f, x - 0.05, 0.88, x + 0.05, 2.12, 0.02), along, i % 2 ? C.steelL : C.ice, s + 101 + i, 0, f.l(0.04));
  // The outlet works (N): the hoppers over the outlets, the splitter, its chutes, the belt up from the collar.
  for (const [i, x] of [0.5, 2.5].entries()) {
    const hop = rr(f, x - 0.32, 0.14, x + 0.32, 0.52, 0.03);
    dropShadow(ctx, f, hop, 0.6, 0.24);
    shape(ctx, hop, C.steel, { w: 1.4, seed: s + 110 + i });
    const mouth = rr(f, x - 0.25, 0.2, x + 0.25, 0.46, 0.02);
    flat(ctx, mouth, C.steelDD);
    stipple(ctx, ...f.p(x - 0.25, 0.2), f.l(0.5), f.l(0.26), 30, { clip: mouth, color: C.dug, alpha: 0.9, seed: s + 112 + i, r: 1.6 });
    const xa = x < 1.5 ? 1.2 : 1.8, xb = x < 1.5 ? x + 0.26 : x - 0.26;
    pipe(ctx, [f.p(xa, 0.32), f.p(xb, 0.32)], f.l(0.1), C.steelL, s + 115 + i);
  }
  roofTop(ctx, f, 1.2, 0.14, 1.8, 0.5, 0.96, C.steelD, s + 120);
  flat(ctx, rr(f, 1.28, 0.2, 1.72, 0.44, 0.02), C.steelDD);
  const belt = rr(f, 1.37, 0.44, 1.63, 0.98, 0.01);
  dropShadow(ctx, f, belt, 0.6, 0.22);
  shape(ctx, belt, C.steelDD, { w: 1.3, seed: s + 121 });
  for (let k = 1; k < 7; k++) { const y = 0.44 + (0.54 * k) / 7; ink(ctx, [f.p(1.39, y), f.p(1.61, y)], { w: 0.9, color: C.steel, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 122 + k }); }
  for (const x of [1.37, 1.63]) ink(ctx, [f.p(x, 0.44), f.p(x, 0.98)], { w: f.l(0.03), color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 130 });
  for (const [i, y] of [0.58, 0.8].entries()) shape(ctx, ellipsePts(...f.p(1.5 + (i - 0.5) * 0.06, y), f.l(0.06), f.l(0.05), s + 131 + i, 0.25, 8), C.dug, { w: 1, shade: false, jitter: 0, seed: s + 131 + i });
  light(ctx, ...f.p(1.5, 0.2), f.l(0.03), C.ledGreen);
  // The derrick over it all.
  boreRigTop(ctx, f, s + 200);
}

/**
 * The bore's part from above at phase t (a quarter turn): the rotary table — brass, its teeth and
 * four slots turning — the kelly bushing and the kelly's square turning with it; then, still, the
 * derrick round the axis (redrawn over the table, its lamps left to the body), the crown block,
 * its sheaves and the red beacon on the axis.
 */
function boreTableTop(ctx: Ctx, f: Frame, s: number, t: number): void {
  const { cx, cy, table, kelly, crown } = BORE, a = (t * Math.PI) / 2;
  const [px, py] = f.p(cx, cy), R = f.l(table);
  const disc = ellipsePts(px, py, R, R, s, 0.004, 36);
  castShadow(ctx, disc, f.l(0.04), 0.3);
  shape(ctx, disc, C.brassL, { w: 1.4, shade: false, jitter: 0, seed: s });
  const at = (b: number, k: number, side = 0): Pt => f.p(cx + Math.cos(b) * table * k - Math.sin(b) * 0.045 * side, cy + Math.sin(b) * table * k + Math.cos(b) * 0.045 * side);
  for (let i = 0; i < 24; i++) { const b = a + (i / 24) * Math.PI * 2; ink(ctx, [at(b, 0.8), at(b, 0.97)], { w: 1.3, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 1 + i }); }
  // The slots reach out past the crown's shadow from above (the iso table's are shorter), so the turn shows.
  for (let i = 0; i < 4; i++) { const b = a + (i * Math.PI) / 2; shape(ctx, [at(b, 0.62, -1), at(b, 0.92, -1), at(b, 0.92, 1), at(b, 0.62, 1)], C.steelDD, { w: 0.9, shade: false, jitter: 0, seed: s + 30 + i }); }
  shape(ctx, boreSquare(a, 0.13).map(([x, y]) => f.p(x, y)), C.steelD, { w: 1.2, shade: false, jitter: 0, seed: s + 40 });
  shape(ctx, boreSquare(a, kelly).map(([x, y]) => f.p(x, y)), C.brass, { w: 1.2, shade: false, jitter: 0, seed: s + 41 });
  // The derrick round the axis, over the table.
  ctx.save();
  ctx.beginPath(); ctx.arc(px, py, f.l(0.42), 0, Math.PI * 2); ctx.clip();
  boreRigTop(ctx, f, s + 200, true);
  ctx.restore();
  // The crown block, its sheave cluster, the red beacon on the axis.
  const cb = rr(f, cx - crown - 0.03, cy - crown - 0.03, cx + crown + 0.03, cy + crown + 0.03, 0.02);
  dropShadow(ctx, f, cb, 2.2, 0.26);
  shape(ctx, cb, C.coral, { w: 1.6, seed: s + 50 });
  flat(ctx, rr(f, cx - crown + 0.02, cy - crown + 0.02, cx + crown - 0.02, cy + crown - 0.02, 0.01), C.steelD);
  drumTop(ctx, rr(f, cx - 0.1, cy - 0.14, cx + 0.1, cy + 0.14, 0.03), (f.rot & 1) === 0 ? 'y' : 'x', C.brass, s + 51, 2, f.l(0.06));
  shape(ctx, ellipsePts(px, py, f.l(0.06), f.l(0.06), s + 52, 0, 14), C.steelDD, { w: 1, shade: false, jitter: 0, seed: s + 52 });
  light(ctx, px, py, f.l(0.04), C.ledRed);
}

/** Plan recipes of the buildings with a moving part: their body, and the part at phase t (moving.ts). */
const MOVING_TOP: Partial<Record<BuildingId, { body: (ctx: Ctx, f: Frame, seed: number) => void; part: (ctx: Ctx, f: Frame, seed: number, t: number) => void }>> = {
  wind_flower: { body: turbineBodyTop, part: turbineCrownTop },
  sand_collector: { body: collectorBodyTop, part: collectorWheelTop },
  face_cutter: { body: cutterBodyTop, part: cutterDrumTop },
  pitch_turbine: { body: (ctx, f, s) => windBodyTop(ctx, f, s, WIND, C.coral), part: (ctx, f, s, t) => hRotorTop(ctx, f, PITCH_ROTOR, s, t) },
  big_turbine: { body: (ctx, f, s) => windBodyTop(ctx, f, s, BIG_WIND, C.teal), part: (ctx, f, s, t) => hRotorTop(ctx, f, BIG_ROTOR, s, t) },
  deep_bore: { body: boreBodyTop, part: boreTableTop },
  steam_boiler: { body: boilerBodyTop, part: (ctx, f, s, t) => flywheelTop(ctx, f, s + 400, t) },
};

/** The Heart's solar rows (same rects as its iso art): `n` framed panels along each row. */

const HEART_PV_TOP: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [1.3, 2.35, 2.0, 2.75, 1],
  [1.3, 2.95, 3.45, 3.35, 3],
  [1.3, 3.43, 3.45, 3.83, 3],
];

// ── poles and link masts from above ─────────────────────────────────────────

/** The poles' weathered steel, their arm, their concrete footing (as in the iso art). */
const POST = mix(C.steel, C.peachD, 0.25);
const ARM_STEEL = mix(C.steelL, C.peachD, 0.12);
const FOOTING = mix(C.salt, C.mesa, 0.3);

/** A crossarm seen from above: the beam along the diagonal through (cx, cy), `half` tiles each side, with its shadow dropped by `h` levels. */
function crossarmTop(ctx: Ctx, f: Frame, cx: number, cy: number, half: number, h: number, s: number): void {
  const w = 0.04;
  const beam = [onArm(cx, cy, -half, -w), onArm(cx, cy, half, -w), onArm(cx, cy, half, w), onArm(cx, cy, -half, w)].map(([x, y]) => f.p(x, y));
  const d = f.l(0.11 * h);
  flat(ctx, beam.map(([x, y]) => [x + d * 0.7, y + d] as Pt), C.inkSoft, 0.3);
  shape(ctx, beam, mix(ARM_STEEL, '#ffffff', 0.15), { w: 1.4, shade: false, jitter: 0, seed: s });
}

/**
 * The pole from straight above (it reads by its shadow, like a sundial's): the post's long
 * shadow and its crossarm's dropped down-right, the concrete footing, the post's cap, the
 * junction box on its front, the crossarm along the diagonal and its three insulators — the
 * wires' terminals (art/terminals.ts `POLE`).
 */
function poleTop(ctx: Ctx, f: Frame, s: number): void {
  const { cx, cy, top, arm, half } = POLE;
  const c = f.p(cx, cy), d = f.l(0.11 * top);
  ink(ctx, [c, [c[0] + d * 0.7, c[1] + d]], { w: f.l(0.075), color: C.inkSoft, alpha: 0.34, shade: false, taper: 0, jitter: 0, seed: s });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.16), f.l(0.16), s + 1, 0, 24), FOOTING, { w: 1.3, shade: false, jitter: 0, seed: s + 1 });
  const jb = rr(f, cx + 0.035, cy + 0.035, cx + 0.15, cy + 0.15, 0.01);
  shape(ctx, jb, C.steelL, { w: 1.1, shade: false, jitter: 0, seed: s + 2 });
  light(ctx, ...f.p(cx + 0.115, cy + 0.115), f.l(0.022), C.ledGreen);
  crossarmTop(ctx, f, cx, cy, half, arm, s + 3);
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.06), f.l(0.06), s + 4, 0, 16), POST, { w: 1.2, shade: false, jitter: 0, seed: s + 4 });
  for (const [i, t] of terminalsOf('mast').entries()) terminalTop(ctx, f, t, s + 10 + i * 4);
}

/**
 * The pylon from above: its square lattice narrowing to the head and its long shadow, the four
 * concrete feet, the crossarm and its two suspension strings' insulators (art/terminals.ts
 * `PYLON`), the aviation light on the peak.
 */
function pylonTop(ctx: Ctx, f: Frame, s: number): void {
  const { cx, cy, foot, apex, arm, half } = PYLON;
  const c = f.p(cx, cy), d = f.l(0.11 * apex);
  const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => f.p(cx + a * foot, cy + b * foot));
  flat(ctx, hull([...corners, [c[0] + d * 0.7, c[1] + d]]), C.inkSoft, 0.18);
  for (const [i, p] of corners.entries()) shape(ctx, ellipsePts(p[0], p[1], f.l(0.14), f.l(0.14), s + i, 0, 14), FOOTING, { w: 1.1, shade: false, jitter: 0, seed: s + i });
  for (const k of [0.66, 0.33]) ink(ctx, ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => f.p(cx + a * foot * k, cy + b * foot * k)), { closed: true, w: 1.2, color: C.steelD, alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: s + 4 + k * 10 });
  for (const p of corners) ink(ctx, [p, c], { w: f.l(0.035), color: C.steelL, shade: false, taper: 0.1, jitter: 0, seed: s + 5 });
  crossarmTop(ctx, f, cx, cy, half, arm, s + 6);
  for (const [i, t] of terminalsOf('pylon').entries()) terminalTop(ctx, f, t, s + 10 + i * 4);
  light(ctx, c[0], c[1], f.l(0.07), C.ledRed);
}

/** One of the Heart's link masts from above (art/terminals.ts `HEART_MASTS`): its long shadow, its plinth, the coral collar, the big insulator its wires clamp to. */
function linkMastTop(ctx: Ctx, f: Frame, x: number, y: number, s: number): void {
  const c = f.p(x, y), d = f.l(0.11 * HEART_MASTS.top);
  ink(ctx, [c, [c[0] + d * 0.7, c[1] + d]], { w: f.l(0.07), color: C.inkSoft, alpha: 0.28, shade: false, taper: 0, jitter: 0, seed: s });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.14), f.l(0.14), s + 1, 0, 20), C.steelD, { w: 1.3, shade: false, jitter: 0, seed: s + 1 });
  shape(ctx, ellipsePts(c[0], c[1], f.l(0.095), f.l(0.095), s + 2, 0, 18), C.coral, { w: 1.1, shade: false, jitter: 0, seed: s + 2 });
  terminalTop(ctx, f, { x, y, z: HEART_MASTS.top }, s + 3, 1.35);
}

/**
 * The first pole's plan art (until 2026-10-12): insulator petals round a light. Kept, like its
 * iso drawing (`petalMastIso`), for another building later; nothing wears it yet.
 */
export function petalMastTop(ctx: Ctx, f: Frame, s: number): void {
  const c = f.p(0.5, 0.52);
  flat(ctx, ellipsePts(c[0] + 4, c[1] + 5, f.l(0.22), f.l(0.13), s), C.ink, 0.25);
  petals(ctx, c[0], c[1], f.l(0.36), 5, [C.ice, C.violetL], -Math.PI / 2, s, 0.5);
  light(ctx, c[0], c[1], f.l(0.08), C.led);
}

// ── research, compute and the second tier, from above (buildings.ts draws them in iso) ───────

/** A roof seen from above: its shadow dropped by its height (levels), a flat rect, an outline. */
function roofTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, h: number, color: string, s: number, r = 0.04): Pt[] {
  const pts = rr(f, x0, y0, x1, y1, r);
  dropShadow(ctx, f, pts, h, 0.28);
  shape(ctx, pts, color, { w: 1.6, seed: s });
  return pts;
}

/** A fan grille from above: a pale rim, a dark throat, five swept blades, a hub. */
function fanTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const [cx, cy] = f.p(x, y), R = f.l(r);
  shape(ctx, ellipsePts(cx, cy, R, R, s, 0, 24), C.steelL, { w: 1.2, shade: false, jitter: 0, seed: s });
  flat(ctx, ellipsePts(cx, cy, R * 0.8, R * 0.8, s + 1, 0, 24), C.steelDD);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    ink(ctx, [[cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18], [cx + Math.cos(a + 0.3) * R * 0.5, cy + Math.sin(a + 0.3) * R * 0.5], [cx + Math.cos(a + 0.55) * R * 0.74, cy + Math.sin(a + 0.55) * R * 0.74]], { w: Math.max(1.4, R * 0.16), color: C.steel, shade: false, taper: 0.3, jitter: 0, seed: s + 2 + i });
  }
  flat(ctx, ellipsePts(cx, cy, R * 0.18, R * 0.18, s + 8, 0, 12), C.steelL);
}

/** A glazed case from above: its floor, what `inner` draws, tinted glass over it with a sheen streak, the steel frame. */
function glassTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, h: number, s: number, inner: () => void): void {
  const pts = rr(f, x0, y0, x1, y1, 0.02);
  dropShadow(ctx, f, pts, h, 0.18);
  flat(ctx, pts, C.steelD);
  inner();
  flat(ctx, pts, C.ice, 0.3);
  const [a, b] = [f.p(x0, y0), f.p(x1, y1)];
  const X0 = Math.min(a[0], b[0]), Y0 = Math.min(a[1], b[1]), X1 = Math.max(a[0], b[0]), Y1 = Math.max(a[1], b[1]);
  ink(ctx, [[X0 + (X1 - X0) * 0.15, Y0 + (Y1 - Y0) * 0.55], [X0 + (X1 - X0) * 0.55, Y0 + (Y1 - Y0) * 0.15]], { w: 2.2, color: '#ffffff', alpha: 0.6, shade: false, taper: 0.2, jitter: 0, seed: s });
  ink(ctx, pts, { closed: true, w: 3.2, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  ink(ctx, pts, { closed: true, w: 1.6, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: s + 2 });
}

/** The glowing sample seen from above: a brass cradle, a cyan sphere, its halo. */
function sampleTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const [cx, cy] = f.p(x, y), R = f.l(r);
  flat(ctx, ellipsePts(cx, cy, R * 2.2, R * 2.2, s, 0, 20), C.led, 0.2);
  ink(ctx, ellipsePts(cx, cy, R * 1.25, R * 1.25, s + 1, 0, 20), { closed: true, w: 2, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  shape(ctx, ellipsePts(cx, cy, R, R, s + 2, 0, 20), C.cyan, { w: 1.2, shade: false, jitter: 0, seed: s + 2 });
  light(ctx, cx - R * 0.2, cy - R * 0.2, R * 0.55, C.led);
}

/** The labs' turquoise intake hopper from above: a flared rim round a dark mouth, data files in it. */
function hopperTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, s: number): void {
  const outer = rr(f, x0, y0, x1, y1, 0.03), inner = rr(f, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0.02);
  dropShadow(ctx, f, outer, 0.85, 0.24);
  flat(ctx, outer, C.turqL);
  const [X0, Y0, X1, Y1] = bounds(outer), [ix0, iy0, ix1, iy1] = bounds(inner);
  flat(ctx, [[X0, Y0], [X1, Y0], [ix1, iy0], [ix0, iy0]], mix(C.turq, C.ink, 0.25));
  flat(ctx, [[X0, Y0], [ix0, iy0], [ix0, iy1], [X0, Y1]], C.turq);
  flat(ctx, inner, C.ink);
  const rng = makeRng(s);
  ctx.save(); pathOf(ctx, inner); ctx.clip();
  for (let i = 0; i < 5; i++) {
    const cx = ix0 + (ix1 - ix0) * (0.2 + 0.6 * rng.next()), cy = iy0 + (iy1 - iy0) * (0.25 + 0.5 * rng.next());
    const a = rng.range(-0.7, 0.7), w = f.l(0.1), h = f.l(0.07), c = Math.cos(a), sn = Math.sin(a);
    const q = ([[-w, -h], [w, -h], [w, h], [-w, h]] as const).map(([u, v]) => [cx + u * c - v * sn, cy + u * sn + v * c] as Pt);
    shape(ctx, q, i % 3 ? C.cyan : C.tealL, { w: 1, shade: false, jitter: 0, seed: s + i });
  }
  ctx.restore();
  ink(ctx, outer, { closed: true, w: 1.6, seed: s + 9 });
}

/** A data antenna's array panel from above (screen-fixed, as in iso): a frame of violet elements with cyan feeds, raised over its shadow. */
function arrayTop(ctx: Ctx, f: Frame, x: number, y: number, w: number, d: number, cols: number, rows: number, h: number, s: number): void {
  const [cx, cy] = f.p(x, y), W = f.l(w) / 2, D = f.l(d) / 2, sh = f.l(0.11 * h);
  const q = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[cx + x0, cy + y0], [cx + x1, cy + y0], [cx + x1, cy + y1], [cx + x0, cy + y1]];
  flat(ctx, q(-W + sh * 0.7, -D + sh, W + sh * 0.7, D + sh), C.inkSoft, 0.26);
  shape(ctx, q(-W, -D, W, D), C.steelL, { w: 1.6, shade: false, jitter: 0, seed: s });
  const g = Math.min(W * 2 / cols, D * 2 / rows) * 0.1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a0 = -W + (2 * W * i) / cols + g, a1 = -W + (2 * W * (i + 1)) / cols - g, b0 = -D + (2 * D * j) / rows + g, b1 = -D + (2 * D * (j + 1)) / rows - g;
    flat(ctx, q(a0, b0, a1, b1), (i + j) % 2 ? mix(C.violet, C.ink, 0.45) : mix(C.violet, C.ink, 0.32));
    flat(ctx, ellipsePts(cx + (a0 + a1) / 2, cy + (b0 + b1) / 2, 1.4, 1.4, 1, 0, 8), j === rows - 1 ? C.ice : C.cyan);
  }
  ink(ctx, [[cx - W, cy + D], [cx - W, cy - D], [cx + W, cy - D]], { w: 1.2, color: '#ffffff', alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: s + 1 });
}

/** A rack of servers from above: a dark violet roof, vent slots, its fan, status LEDs along its edge. */
function rackTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, h: number, s: number, col: string = RACK): void {
  const pts = roofTop(ctx, f, x0, y0, x1, y1, h, mix(col, C.steelD, 0.4), s, 0.02);
  ink(ctx, rr(f, x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, 0.01), { closed: true, w: 1, color: mix(col, C.steelL, 0.3), alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  fanTop(ctx, f, (x0 + x1) / 2, (y0 + y1) / 2, Math.min(x1 - x0, y1 - y0) * 0.32, s + 2);
  const [X0, , X1, Y1] = bounds(pts);
  ledStrip(ctx, [X0 + 5, Y1 - 4], [X1 - 5, Y1 - 4], Math.max(3, Math.round((X1 - X0) / 9)), f.l(0.018), [C.led, C.ledGreen, C.led], s + 3);
}

/** A cartridge stacker from above: a hazard-edged bin, a stack of cyan cartridges on it. */
function stackerTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, s: number): void {
  roofTop(ctx, f, x0, y0, x1, y1, 0.6, C.steelD, s);
  shape(ctx, rr(f, x0 + 0.04, y1 - 0.1, x1 - 0.04, y1 - 0.04, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 1 });
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  crateAt(ctx, f, cx - 0.13, cy - 0.09, cx + 0.13, cy + 0.09, C.cyan, s + 2, 0.5);
  shape(ctx, rr(f, cx - 0.06, cy - 0.04, cx + 0.06, cy + 0.04, 0.005), C.paper, { w: 0.8, shade: false, jitter: 0, seed: s + 3 });
}

/** An instrument cabinet from above: its roof, a grille, a strip of status LEDs. */
function cabinetTop(ctx: Ctx, f: Frame, x0: number, y0: number, x1: number, y1: number, h: number, col: string, s: number): void {
  roofTop(ctx, f, x0, y0, x1, y1, h, mix(col, C.steelD, 0.25), s);
  grille(ctx, rr(f, x0 + 0.07, y0 + 0.07, x1 - 0.07, y0 + (y1 - y0) * 0.45, 0.01), 3, s + 1);
  ledStrip(ctx, f.p(x0 + 0.1, y1 - 0.1), f.p(x1 - 0.1, y1 - 0.1), 3, f.l(0.025), [C.led, C.ledGreen], s + 2);
}

/** A geared turntable from above (an array's rig): a dark disc, teeth round its rim, a brass hub. */
function turntableTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const [cx, cy] = f.p(x, y), R = f.l(r);
  const pts = ellipsePts(cx, cy, R, R, s, 0.004, 36);
  castShadow(ctx, pts, f.l(0.05), 0.3);
  shape(ctx, pts, C.steelD, { w: 1.6, seed: s });
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ink(ctx, [[cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8], [cx + Math.cos(a) * R * 0.97, cy + Math.sin(a) * R * 0.97]], { w: 1.3, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + i }); }
  shape(ctx, ellipsePts(cx, cy, R * 0.4, R * 0.4, s + 30, 0, 20), C.brass, { w: 1.2, shade: false, seed: s + 30 });
}

/** A heap from above: a mound of `col`, its shaded side hatched, grains stippled. */
function heapTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, col: string, s: number, grainCol: string = C.inkSoft): void {
  const [cx, cy] = f.p(x, y), R = f.l(r);
  const pts = ellipsePts(cx, cy, R, R, s, 0.06, 24);
  castShadow(ctx, pts, f.l(0.05), 0.25);
  flat(ctx, pts, col);
  hatch(ctx, shadowCrescent(cx, cy, R, 0.4, s), Math.PI / 4, 2.8, { alpha: 0.35, seed: s });
  stipple(ctx, cx - R, cy - R, R * 2, R * 2, Math.round(R * 1.6), { clip: pts, color: grainCol, alpha: 0.5, seed: s + 1, r: 0.9 });
  ink(ctx, pts, { closed: true, w: 1.3, alpha: 0.8, seed: s + 2 });
}

/** A lens from above: a pale glass disc with a cyan rim, sheen arcs and a glint. */
function lensTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, s: number): void {
  const [cx, cy] = f.p(x, y), R = f.l(r);
  const pts = ellipsePts(cx, cy, R, R, s, 0, 36);
  castShadow(ctx, pts, f.l(0.04), 0.25);
  shape(ctx, pts, mix(C.ice, C.cyan, 0.22), { w: 1.4, shade: false, seed: s });
  ink(ctx, ellipsePts(cx, cy, R * 0.86, R * 0.86, s + 1, 0, 36), { closed: true, w: 1.6, color: C.cyan, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 1 });
  ink(ctx, ellipsePts(cx - R * 0.08, cy - R * 0.08, R * 0.6, R * 0.6, s + 2, 0, 36).filter(([px, py]) => px < cx && py < cy), { w: 2, color: '#ffffff', alpha: 0.85, shade: false, taper: 0.4, seed: s + 2 });
  flat(ctx, ellipsePts(cx + R * 0.3, cy - R * 0.35, R * 0.1, R * 0.06, s + 3, 0, 10, -0.5), '#ffffff', 0.9);
}

/** A bound codex from above: a dark cover, brass corners and an emblem. */
function codexTop(ctx: Ctx, f: Frame, x: number, y: number, w: number, h: number, s: number, lift = 0.4): void {
  const pts = rr(f, x - w / 2, y - h / 2, x + w / 2, y + h / 2, 0.01);
  dropShadow(ctx, f, pts, lift, 0.26);
  shape(ctx, pts, COVER, { w: 1.3, seed: s });
  const [X0, Y0, X1, Y1] = bounds(pts), k = Math.min(X1 - X0, Y1 - Y0) * 0.22;
  for (const [cx, cy, sx, sy] of [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X1, Y1, -1, -1], [X0, Y1, 1, -1]] as const) flat(ctx, [[cx, cy], [cx + sx * k, cy], [cx, cy + sy * k]], C.brass);
  const m = f.p(x, y);
  flat(ctx, [[m[0], m[1] - k * 0.7], [m[0] + k * 0.6, m[1]], [m[0], m[1] + k * 0.7], [m[0] - k * 0.6, m[1]]], C.brassL);
}

/** A pitch turbine's crown from above at phase t (moving.ts `HRotor`): faint sweep, struts out to the pitched blades, coral tips, the hub and its red light. */
function hRotorTop(ctx: Ctx, f: Frame, R: HRotor, s: number, t: number): void {
  const [cx, cy] = f.p(R.cx, R.cy), th = (t * 2 * Math.PI) / R.n;
  const sweep = ellipsePts(cx, cy, f.l(R.r + R.chord / 2), f.l(R.r + R.chord / 2), s, 0, 48);
  flat(ctx, sweep.map(([x, y]) => [x + f.l(0.35), y + f.l(0.5)] as Pt), C.inkSoft, 0.12);
  ink(ctx, sweep, { closed: true, w: 1, color: C.inkSoft, alpha: 0.25, shade: false, taper: 0, jitter: 0, seed: s });
  for (let i = 0; i < R.n; i++) {
    const a = th + (i / R.n) * Math.PI * 2;
    const bx = R.cx + Math.cos(a) * R.r, by = R.cy + Math.sin(a) * R.r;
    pipe(ctx, [f.p(R.cx, R.cy), f.p(bx, by)], f.l(0.045 * R.k), C.steelD, s + 1 + i, false);
    const ca = a + Math.PI / 2 + R.pitch, hx = (Math.cos(ca) * R.chord) / 2, hy = (Math.sin(ca) * R.chord) / 2;
    const nx = -Math.sin(ca) * 0.035, ny = Math.cos(ca) * 0.035;
    const blade: Pt[] = [f.p(bx - hx + nx, by - hy + ny), f.p(bx + hx + nx, by + hy + ny), f.p(bx + hx - nx, by + hy - ny), f.p(bx - hx - nx, by - hy - ny)];
    castShadow(ctx, blade, f.l(0.3), 0.2);
    shape(ctx, blade, R.blade, { w: 1.4, shade: false, jitter: 0, seed: s + 10 + i });
    flat(ctx, [f.p(bx + hx * 0.4 + nx, by + hy * 0.4 + ny), f.p(bx + hx + nx, by + hy + ny), f.p(bx + hx - nx, by + hy - ny), f.p(bx + hx * 0.4 - nx, by + hy * 0.4 - ny)], R.tip);
    rivet(ctx, ...f.p(bx, by), f.l(0.03 * R.k), C.brassL);
  }
  shape(ctx, ellipsePts(cx, cy, f.l(0.08 * R.k), f.l(0.08 * R.k), s + 30, 0, 20), C.steelD, { w: 1.3, seed: s + 30 });
  light(ctx, cx, cy, f.l(0.04), C.ledRed);
}

/** A pitch turbine's body from above: the wind tower's (scaled by `w`), a band of `band` round its bearing. */
function windBodyTop(ctx: Ctx, f: Frame, s: number, w: WindSpec, band: string): void {
  turbineBodyTop(ctx, f, s, w);
  const [cx, cy] = f.p(w.cx, w.cy);
  ink(ctx, ellipsePts(cx, cy, f.l(0.2 * w.k), f.l(0.2 * w.k), s + 40, 0, 32), { closed: true, w: f.l(0.04 * w.k), color: band, shade: false, taper: 0, seed: s + 40 });
}

/** A heliostat from above: its mirror, foreshortened as it leans to the receiver at (tx, ty), a sheen streak. */
function heliostatTop(ctx: Ctx, f: Frame, x: number, y: number, tx: number, ty: number, s: number): void {
  const dx = tx - x, dy = ty - y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = 0.2, k = 0.93;
  const P = (a: number, b: number): Pt => f.p(x + ux * b * k - uy * a, y + uy * b * k + ux * a);
  const q: Pt[] = [P(-h, -h), P(h, -h), P(h, h), P(-h, h)];
  castShadow(ctx, q, f.l(0.06), 0.28);
  shape(ctx, q, C.steelD, { w: 1.2, shade: false, jitter: 0, seed: s });
  flat(ctx, [P(-h * 0.86, -h * 0.86), P(h * 0.86, -h * 0.86), P(h * 0.86, h * 0.86), P(-h * 0.86, h * 0.86)], mix(C.ice, C.cyan, 0.18));
  ink(ctx, [P(-h * 0.5, h * 0.3), P(h * 0.3, -h * 0.5)], { w: 1.8, color: '#ffffff', alpha: 0.75, shade: false, taper: 0.3, jitter: 0, seed: s + 1 });
}

/** A store tank from above (the silo's): the catwalk rail's shadow and ring, the cone roof, the gauge light. */
function siloTop(ctx: Ctx, f: Frame, x: number, y: number, r: number, h: number, s: number): void {
  const c = f.p(x, y);
  const rail = ellipsePts(c[0], c[1], f.l(r + 0.08), f.l(r + 0.08), s, 0.002, 40);
  dropShadow(ctx, f, rail, h, 0.26);
  shape(ctx, rail, C.steelD, { w: 1.6, seed: s });
  tankTop(ctx, c[0], c[1], f.l(r), C.ice, s + 1, { shadow: 0, ribs: 12, cone: true });
  ink(ctx, rail, { closed: true, w: 1.4, color: C.steelL, shade: false, seed: s + 2 });
}

// ── the steam boiler (D114) from above: the parts of its iso drawing (buildings.ts `SB`) ──────

/** The coal hopper from above: its flared rim round the dark mouth, angular lumps of coal heaped in it; its chute to the firebox. */
function coalHopperTop(ctx: Ctx, f: Frame, s: number): void {
  const [x0, y0, x1, y1] = SB.hop;
  flat(ctx, rr(f, 0.32, SB.fire[3] - 0.04, 0.68, y0 + 0.06, 0.01), C.steelD);
  const outer = rr(f, x0, y0, x1, y1, 0.03), inner = rr(f, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0.02);
  dropShadow(ctx, f, outer, SB.hopZ, 0.24);
  flat(ctx, outer, C.steelL);
  const [X0, Y0, X1, Y1] = bounds(outer), [ix0, iy0, ix1, iy1] = bounds(inner);
  flat(ctx, [[X0, Y0], [X1, Y0], [ix1, iy0], [ix0, iy0]], mix(C.steel, C.ink, 0.2));
  flat(ctx, [[X0, Y0], [ix0, iy0], [ix0, iy1], [X0, Y1]], C.steel);
  flat(ctx, inner, SB_COAL);
  const rng = makeRng(s + 1);
  ctx.save(); pathOf(ctx, inner); ctx.clip();
  for (let i = 0; i < 14; i++) {
    const px = ix0 + (ix1 - ix0) * rng.range(0.1, 0.9), py = iy0 + (iy1 - iy0) * rng.range(0.15, 0.85), r = f.l(rng.range(0.045, 0.07));
    const pts = ellipsePts(px, py, r * 1.2, r, s + 2 + i, 0.28, 6);
    shape(ctx, pts, SB_COAL, { w: 0.9, shade: false, jitter: 0, seed: s + 20 + i });
    flat(ctx, [pts[3]!, pts[4]!, pts[5]!, [px, py]], mix(SB_COAL, C.steelL, i % 3 ? 0.3 : 0.55));
  }
  ctx.restore();
  ink(ctx, outer, { closed: true, w: 1.6, seed: s + 40 });
}

/** The brick chimney from above: its long shadow, the steel collar, the brick shaft in courses, the iron rim round the dark throat; its plume while it works. */
function chimneyTop(ctx: Ctx, f: Frame, s: number): void {
  const { x, y, r0, r1, top } = SB.stack, [cx, cy] = f.p(x, y);
  const collar = ellipsePts(cx, cy, f.l(r0 + 0.07), f.l(r0 + 0.07), s, 0.003, 32);
  dropShadow(ctx, f, collar, top, 0.24);
  shape(ctx, collar, C.steelD, { w: 1.5, seed: s });
  // The battered shaft seen from above: a ring of brick courses from its foot in to its crown.
  shape(ctx, ellipsePts(cx, cy, f.l(r0), f.l(r0), s + 1, 0.003, 32), BRICK, { w: 1.3, seed: s + 1 });
  for (let k = 0; k < 3; k++) {
    const rk = f.l(r0 - 0.025 - k * 0.022);
    ink(ctx, ellipsePts(cx, cy, rk, rk, s + 2 + k, 0, 28), { closed: true, w: 0.8, color: C.ink, alpha: 0.3, shade: false, jitter: 0, seed: s + 2 + k });
  }
  hatch(ctx, shadowCrescent(cx, cy, f.l(r0), 0.35, s), Math.PI / 4, 3, { alpha: 0.35, seed: s + 5 });
  // The crown's iron rim round the dark throat.
  const rim = ellipsePts(cx, cy, f.l(r1 + 0.02), f.l(r1 + 0.02), s + 6, 0, 28);
  shape(ctx, rim, C.steelL, { w: 1.4, seed: s + 6 });
  flat(ctx, ellipsePts(cx + 1, cy + 1, f.l(r1 - 0.04), f.l(r1 - 0.04), s + 7, 0, 24), C.ink);
  if (isUnlit(ctx)) return; // switched off (D83): no smoke
  // The plume drifting off downwind (screen-fixed, as the light), clear of the mouth.
  puffTop(ctx, cx + f.l(0.28), cy - f.l(0.05), f.l(0.11), s + 8);
  puffTop(ctx, cx + f.l(0.5), cy - f.l(0.16), f.l(0.15), s + 9);
}

/** The steam boiler from above but its flywheel (`MOVING_TOP`'s body): firebox, hopper, chimney, drum, engine, dynamo, pump and pipes. */
function boilerBodyTop(ctx: Ctx, f: Frame, s: number): void {
  plinth(ctx, f, C.steel, 0.06, s);
  const { x: wx, r: wr, half: wh } = SB.wheel, { y: sy } = SB.shaft, D = SB.drum, E = SB.eng, [px, py] = SB.pump;
  shape(ctx, rr(f, wx - wh - 0.04, sy - wr - 0.03, wx + wh + 0.04, sy + wr + 0.03, 0.01), C.steelDD, { w: 1.1, shade: false, jitter: 0, seed: s + 1 });
  // The engine: its bed, the crank and the crosshead between its guides, the cylinder and its steam chest; the work lamp.
  const bed = rr(f, E.x - 0.13, sy - 0.2, E.x + 0.13, E.y1 + 0.06, 0.02);
  dropShadow(ctx, f, bed, 0.8, 0.26);
  shape(ctx, bed, C.steelD, { w: 1.5, seed: s + 2 });
  pipe(ctx, [f.p(SB.dyn.x + SB.dyn.half, sy), f.p(SB.split, sy)], f.l(0.07), C.steelL, s + 3, false);
  shape(ctx, rr(f, E.x - 0.05, sy - 0.15, E.x - 0.01, sy + 0.15, 0.01), C.steelD, { w: 1, shade: false, jitter: 0, seed: s + 4 });
  for (const d of [-0.06, 0.03]) ink(ctx, [f.p(E.x + d, 0.77), f.p(E.x + d, E.y0)], { w: f.l(0.025), color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 5 });
  ink(ctx, [f.p(E.x - 0.03, 0.97), f.p(E.x - 0.03, E.y0)], { w: f.l(0.03), color: C.ice, shade: false, taper: 0, jitter: 0, seed: s + 6 });
  pipe(ctx, [f.p(E.x - 0.07, sy + 0.05), f.p(E.x - 0.03, 0.97)], f.l(0.045), C.steelL, s + 7, false);
  shape(ctx, rr(f, E.x - 0.09, 0.91, E.x + 0.03, 1.03, 0.01), C.brass, { w: 1, shade: false, jitter: 0, seed: s + 8 });
  drumTop(ctx, rr(f, E.x - E.r, E.y0, E.x + E.r, E.y1, 0.05), (f.rot & 1) === 0 ? 'y' : 'x', C.steelL, s + 9, 2, f.l(0.1));
  roofTop(ctx, f, E.x - 0.08, E.y0 + 0.08, E.x + 0.08, E.y1 - 0.08, 1.6, C.steel, s + 10, 0.02);
  light(ctx, ...f.p(E.x + 0.1, E.y1 + 0.04), f.l(0.04), C.ledWarm);
  // The dynamo on its pedestal: the teal field drum, coral end bells, the brass commutator; its LEDs.
  const dy = SB.dyn;
  roofTop(ctx, f, dy.x - dy.half - 0.16, sy - 0.27, dy.x + dy.half + 0.06, sy + 0.27, 0.7, mix(C.teal, C.steelD, 0.45), s + 11, 0.03);
  ledStrip(ctx, f.p(dy.x - dy.half - 0.1, sy + 0.22), f.p(dy.x - dy.half + 0.1, sy + 0.22), 3, f.l(0.025), [C.ledGreen, C.led, C.led], s + 12);
  shape(ctx, rr(f, dy.x - dy.half - 0.15, sy - 0.11, dy.x - dy.half - 0.05, sy + 0.11, 0.02), C.brass, { w: 1.1, shade: false, jitter: 0, seed: s + 13 });
  drumTop(ctx, rr(f, dy.x - dy.half + 0.03, sy - dy.r, dy.x + dy.half - 0.03, sy + dy.r, 0.05), (f.rot & 1) === 0 ? 'x' : 'y', C.teal, s + 14, 2, f.l(0.14));
  for (const bx of [dy.x - dy.half, dy.x + dy.half]) shape(ctx, rr(f, bx - 0.035, sy - dy.r * 0.86, bx + 0.035, sy + dy.r * 0.86, 0.02), C.coral, { w: 1.1, shade: false, jitter: 0, seed: s + 15 + bx });
  // The firebox: brick walls under a riveted steel roof; its fire doors' glow on the ground, east and west.
  const [fx0, fy0, fx1, fy1] = SB.fire, [d0, d1] = SB.doors;
  const fb = rr(f, fx0, fy0, fx1, fy1, 0.02);
  dropShadow(ctx, f, fb, SB.fireZ, 0.28);
  shape(ctx, fb, BRICK, { w: 1.8, seed: s + 24 });
  const roof = rr(f, fx0 + 0.07, fy0 + 0.07, fx1 - 0.07, fy1 - 0.07, 0.02);
  shape(ctx, roof, C.steelD, { w: 1.2, shade: false, seed: s + 25 });
  for (const [x, y] of [[fx0 + 0.13, fy0 + 0.13], [fx1 - 0.13, fy0 + 0.13], [fx0 + 0.13, fy1 - 0.13], [fx1 - 0.13, fy1 - 0.13]] as const) rivet(ctx, ...f.p(x, y), f.l(0.025), C.steelL);
  for (const [i, X] of [fx0 + 0.01, fx1 - 0.01].entries()) glowSeam(ctx, [f.p(X, d0 + 0.07), f.p(X, d1 - 0.07)], f.l(0.03), C.ledWarm, s + 22 + i);
  coalHopperTop(ctx, f, s + 30);
  // The feed water: from the intake to the pump, up into the drum's end; the pump's brass air vessel.
  pipe(ctx, [f.p(2.5, 1.95), f.p(2.5, 1.86), f.p(px + 0.04, 1.86)], f.l(0.06), SB_WATER, s + 50, false);
  pipe(ctx, [f.p(px - 0.04, py - 0.08), f.p(D.x + D.half + 0.1, D.y + 0.24), f.p(D.x + D.half - 0.01, D.y + 0.22)], f.l(0.05), SB_WATER, s + 51);
  const pc = f.p(px, py);
  tankTop(ctx, pc[0], pc[1], f.l(0.1), C.steel, s + 52, { shadow: f.l(0.08), ribs: 0 });
  shape(ctx, ellipsePts(pc[0], pc[1], f.l(0.07), f.l(0.07), s + 53, 0, 14), C.brass, { w: 1, shade: false, jitter: 0, seed: s + 53 });
  // The drum: pale enamel, brass bands; the steam dome, the safety valve, the gauge.
  drumTop(ctx, rr(f, D.x - D.half, D.y - D.r, D.x + D.half, D.y + D.r, 0.1), (f.rot & 1) === 0 ? 'x' : 'y', SB_ENAMEL, s + 54, 0, f.l(0.2));
  for (const t of [-0.66, 0, 0.66]) {
    const bx = D.x + t * D.half, band = [f.p(bx, D.y - D.r + 0.02), f.p(bx, D.y + D.r - 0.02)];
    ink(ctx, band, { w: f.l(0.05), color: C.ink, alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: s + 55 });
    ink(ctx, band, { w: f.l(0.03), color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 56 });
  }
  const [mx, my] = f.p(SB.dome[0], SB.dome[1]);
  tankTop(ctx, mx, my, f.l(0.15), C.brass, s + 57, { shadow: f.l(0.12), ribs: 0, rim: C.brassL });
  const [vx, vy] = f.p(SB.valve[0], SB.valve[1]);
  ink(ctx, [[vx, vy], f.p(SB.valve[0] + 0.26, SB.valve[1])], { w: f.l(0.03), color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 58 });
  shape(ctx, ellipsePts(vx, vy, f.l(0.085), f.l(0.085), s + 59, 0, 14), C.brass, { w: 1.1, shade: false, jitter: 0, seed: s + 59 });
  const [gx, gy] = f.p(SB.gauge[0], SB.gauge[1]);
  shape(ctx, ellipsePts(gx, gy, f.l(0.065), f.l(0.065), s + 60, 0, 14), C.brass, { w: 1, shade: false, jitter: 0, seed: s + 60 });
  flat(ctx, ellipsePts(gx, gy, f.l(0.045), f.l(0.045), s + 61, 0, 14), C.paper);
  // The steam main over the drum's back to the engine's steam chest, its stop valve's handwheel.
  pipe(ctx, [f.p(SB.dome[0], SB.dome[1]), f.p(SB.dome[0], D.y + 0.2), f.p(E.x, D.y + 0.2), f.p(E.x, E.y0 + 0.2)], f.l(0.07), C.steelL, s + 62);
  const [hx, hy] = f.p(1.72, D.y + 0.2);
  ink(ctx, ellipsePts(hx, hy, f.l(0.07), f.l(0.07), s + 63, 0, 16), { closed: true, w: 3, color: C.ink, shade: false, taper: 0, jitter: 0, seed: s + 63 });
  ink(ctx, ellipsePts(hx, hy, f.l(0.07), f.l(0.07), s + 63, 0, 16), { closed: true, w: 1.6, color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 64 });
  chimneyTop(ctx, f, s + 70);
}

/**
 * The flywheel from above at phase t of a sixth of a turn (`MOVING_TOP`'s part): the rim's coral
 * tread over its tall shadow, the hub; the joints of its cast segments on the upper half of the rim
 * are what shows it turning from above.
 */
function flywheelTop(ctx: Ctx, f: Frame, s: number, t: number): void {
  const { x, r, half } = SB.wheel, { y: cy, z: cz } = SB.shaft;
  pipe(ctx, [f.p(SB.split, cy), f.p(x, cy)], f.l(0.07), C.steelL, s, false);
  const rim = rr(f, x - half, cy - r, x + half, cy + r, 0.03);
  dropShadow(ctx, f, rim, cz + r * 2, 0.26);
  shape(ctx, rim, SB_WHEEL, { w: 1.5, seed: s + 1 });
  for (let i = 0; i < 6; i++) {
    const a = (t * Math.PI * 2) / 6 + 0.3 + Math.PI / 6 + (i * Math.PI) / 3;
    if (Math.sin(a) < 0.15) continue;
    const yy = cy + Math.cos(a) * r;
    ink(ctx, [f.p(x - half + 0.01, yy), f.p(x + half - 0.01, yy)], { w: 1.4, color: mix(SB_WHEEL, C.ink, 0.6), shade: false, taper: 0, jitter: 0, seed: s + 2 + i });
  }
  shape(ctx, rr(f, x - half - 0.05, cy - 0.08, x + half + 0.05, cy + 0.08, 0.02), C.steel, { w: 1.2, shade: false, jitter: 0, seed: s + 10 });
  rivet(ctx, ...f.p(x, cy), f.l(0.04), C.brassL);
}

const R: Partial<Record<BuildingId, Recipe>> = {
  hearth(ctx, f, s, lv) {
    // The base's core from above — the layout of its iso art (recipes/buildings.ts): roller
    // aprons from every port into the fortified depot; on its roof the solar rows, the uplink
    // dish and a drone hatch; its two link masts, west and east; status beacons. It grows with
    // its level (D86): bare corners with a mounting plate at level 1, then the data outlet, the
    // expertise archive and the grid station on three of them (`HEART_CORNERS`), and the trims of
    // `heartLook`. An automated base: nothing is lit from inside.
    const look = heartLook(lv);
    plinth(ctx, f, C.steel, 0.05, s);
    // Level 4: a hazard-striped skirt round the depot's foot (under the aprons that cross it).
    if (look.skirt) {
      const band = rr(f, 0.9, 0.9, 4.1, 4.1, 0.06);
      flat(ctx, band, C.hazard);
      ctx.save(); pathOf(ctx, band); ctx.clip();
      hatch(ctx, band, Math.PI / 4, f.l(0.12), { w: f.l(0.05), alpha: 0.85, seed: s + 1 });
      ctx.restore();
      ink(ctx, band, { closed: true, w: 1.2, alpha: 0.8, shade: false, jitter: 0, seed: s + 2 });
    }
    const ports = (BUILDINGS.hearth as BuildingDef).ports;
    for (const [i, p] of ports.entries()) {
      const side = sideIndex[p.side], c = (side & 1 ? p.y : p.x) + 0.5, h = 0.17, k = s + 100 + i * 5;
      if (p.io === 'out') continue; // the data outlet: a corner piece, below
      if (side === 0) apronTop(ctx, f, c - h, 0.12, c + h, 1.02, 'y', k);
      else if (side === 2) apronTop(ctx, f, c - h, 3.98, c + h, 4.88, 'y', k);
      else if (side === 1) apronTop(ctx, f, 3.98, c - h, 4.88, c + h, 'x', k);
      else apronTop(ctx, f, 0.12, c - h, 1.02, c + h, 'x', k);
    }
    // The corners: the piece a level has mounted, else a bare mounting plate.
    for (const [i, c] of HEART_CORNERS.entries()) {
      const k = s + 600 + i * 40;
      if (lv < c.lv || !c.piece) mountPlateTop(ctx, f, c.tx, c.ty, k);
      else if (c.piece === 'outlet') { const p = ports.find((q) => q.io === 'out')!; dataOutletTop(ctx, f, p.x, p.y, sideIndex[p.side], k); }
      else if (c.piece === 'archive') archiveTop(ctx, f, c.tx, c.ty, k);
      else stationTop(ctx, f, c.tx, c.ty, k);
    }
    // The depot: battered armour walls round a dark roof, a drone hatch, vents along the edges;
    // the level's trims (D86): a coral cornice along the walls' top, brass pilasters at the corners.
    const outer = rr(f, 1, 1, 4, 4, 0.05), inner = rr(f, 1.16, 1.16, 3.84, 3.84, 0.04);
    castShadow(ctx, outer, f.l(0.32), 0.32);
    batter(ctx, outer, inner, mix(C.steel, C.violet, 0.22), C.steelD, s + 200);
    if (look.cornice) ink(ctx, rr(f, 1.13, 1.13, 3.87, 3.87, 0.04), { closed: true, w: f.l(0.045), color: C.coral, shade: false, taper: 0, jitter: 0, seed: s + 205 });
    if (look.pilasters) for (const [x, y] of [[1, 1], [3.86, 1], [3.86, 3.86], [1, 3.86]] as const) shape(ctx, rr(f, x, y, x + 0.14, y + 0.14, 0.02), C.brass, { w: 1.1, shade: false, jitter: 0, seed: s + 206 });
    for (let i = 1; i < 12; i++) for (const y of [1.08, 3.92]) rivet(ctx, ...f.p(1 + i * 0.25, y), f.l(0.022), C.steelL);
    hatchDoor(ctx, rr(f, 1.3, 1.3, 1.85, 1.85, 0.02), s + 210);
    grille(ctx, rr(f, 3.45, 2.1, 3.75, 2.6, 0.01), s + 211);
    for (const [i, [x0, y0, x1, y1, n]] of HEART_PV_TOP.entries()) {
      const shadow = rr(f, x0, y0, x1, y1, 0.01);
      castShadow(ctx, shadow, f.l(0.05), 0.2);
      pvPanel(ctx, [f.p(x0, y0), f.p(x1, y0), f.p(x1, y1), f.p(x0, y1)], n * 3, 2, s + 400 + i * 20);
    }
    // The uplink: a big dish over the depot's north half (no mark on its face: owner, 2026-10-13).
    const dc = f.p(2.7, 1.72);
    castShadow(ctx, ellipsePts(dc[0], dc[1], f.l(0.62), f.l(0.62), s + 300, 0, 32), f.l(0.45), 0.25);
    dish(ctx, dc[0], dc[1], f.l(0.62), s + 300);
    // A drone at work over the hatch (level 3).
    if (look.drone) droneTop(ctx, f, 1.66, 1.7, 0.2, s + 50);
    // The two link masts its wires meet (art/terminals.ts `HEART_MASTS`); the status beacons the level lights.
    for (const [i, [x, y]] of HEART_MASTS.at.entries()) linkMastTop(ctx, f, x, y, s + 10 + i * 7);
    for (const [x, y, col] of HEART_BEACONS.slice(0, look.beacons)) light(ctx, ...f.p(x, y), f.l(0.05), col);
    ledStrip(ctx, f.p(1.7, 4.62), f.p(2.2, 4.62), 3, f.l(0.04), LEDS, s + 5);
    if (look.strips > 1) ledStrip(ctx, f.p(2.8, 0.38), f.p(3.3, 0.38), 3, f.l(0.04), [C.ledWarm, C.led], s + 6);
    // Level 4: floodlights on the slab's near edges, between the ports' aprons (as in iso).
    if (look.floods) for (const u of HEART_FLOODS) for (const [x, y] of [[0.05 + 4.9 * u, 4.88], [4.88, 4.95 - 4.9 * u]] as const) floodTop(ctx, f, x, y, s + 700);
    decal(ctx, ...f.p(4.6, 2.25), f.l(0.07), s);
  },

  drill(ctx, f, s) {
    // A drilling rig: the derrick from above over its geared table, the gearbox and motor, a coral power pack.
    plinth(ctx, f, C.steel, 0.05, s, true);
    const gb = rr(f, 0.15, 1.15, 1.85, 1.85, 0.06);
    castShadow(ctx, gb, f.l(0.1), 0.3);
    shape(ctx, gb, C.teal, { w: 2, seed: s + 1 });
    grille(ctx, rr(f, 1.42, 1.28, 1.75, 1.72, 0.02), 3.2, s + 2);
    drumTop(ctx, rr(f, 0.75, 1.38, 1.55, 1.62, 0.04), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 3, 3, f.l(0.06));
    ledStrip(ctx, f.p(0.3, 1.75), f.p(0.65, 1.75), 4, f.l(0.03), LEDS, s + 4);
    const pack = rr(f, 1.32, 0.2, 1.85, 0.82, 0.05);
    castShadow(ctx, pack, f.l(0.1), 0.3);
    shape(ctx, pack, C.coral, { w: 1.8, seed: s + 5 });
    grille(ctx, rr(f, 1.42, 0.3, 1.75, 0.55, 0.02), 3.2, s + 6);
    light(ctx, ...f.p(1.58, 0.7), f.l(0.035), C.ledWarm);
    pipe(ctx, [f.p(0.55, 1.35), f.p(0.7, 0.95)], f.l(0.07), C.steelD, s + 7);
    rotaryTop(ctx, f, 0.78, 0.68, 0.33, s + 8);
    derrickTop(ctx, f, 0.78, 0.68, 0.36, 0.08, 2.9, s + 9);
  },
  excavator(ctx, f, s) {
    // A tracked cutter from above: two crawler tracks, the turret house and its counterweight,
    // the coral boom arms and the toothed cutter wheel at the front (N).
    plinth(ctx, f, C.steel, 0.04, s, true);
    for (const x of [0.47, 2.53]) {
      const tr = rr(f, x - 0.27, 0.95, x + 0.27, 2.85, 0.06);
      castShadow(ctx, tr, f.l(0.08), 0.3);
      shape(ctx, tr, C.steelDD, { w: 1.8, seed: s + x * 10 });
      ctx.save();
      ctx.strokeStyle = C.steel; ctx.lineWidth = 1.6;
      for (let i = 1; i < 14; i++) {
        const y = 0.95 + (1.9 * i) / 14;
        const [a, b] = [f.p(x - 0.24, y), f.p(x + 0.24, y)];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.restore();
    }
    const house = rr(f, 0.76, 1.35, 2.24, 2.45, 0.06);
    castShadow(ctx, house, f.l(0.16), 0.32);
    shape(ctx, house, C.violet, { w: 2, seed: s + 1 });
    grille(ctx, rr(f, 1.6, 1.5, 2.1, 1.85, 0.02), 3.2, s + 2);
    hatchDoor(ctx, rr(f, 0.95, 1.5, 1.3, 1.85, 0.02), s + 3);
    const cw = rr(f, 0.78, 2.45, 2.22, 2.82, 0.04);
    castShadow(ctx, cw, f.l(0.14), 0.3);
    shape(ctx, cw, C.steelD, { w: 1.8, seed: s + 4 });
    shape(ctx, rr(f, 0.84, 2.7, 2.16, 2.78, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 5 });
    stack(ctx, ...f.p(2.0, 1.75), f.l(0.09), C.steelD, s + 6, C.ledWarm, f.l(0.2));
    ledStrip(ctx, f.p(0.9, 2.3), f.p(1.4, 2.3), 5, f.l(0.03), [C.ledWarm, C.ledRed], s + 7);
    pipe(ctx, [f.p(0.98, 1.45), f.p(1.02, 0.62)], f.l(0.1), C.coral, s + 8);
    pipe(ctx, [f.p(2.02, 1.45), f.p(1.98, 0.62)], f.l(0.1), C.coral, s + 9);
    // The cutter wheel stands across the front: seen from above, a toothed disc foreshortened.
    const wc = f.p(1.5, 0.56);
    const along = (f.rot & 1) === 0;
    const rx = f.l(along ? 0.84 : 0.26), ry = f.l(along ? 0.26 : 0.84);
    const teeth: Pt[] = [];
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, k = i % 2 ? 1 : 0.84; teeth.push([wc[0] + Math.cos(a) * rx * k, wc[1] + Math.sin(a) * ry * k]); }
    castShadow(ctx, teeth, f.l(0.3), 0.28);
    shape(ctx, teeth, C.steelL, { w: 1.8, seed: s + 10 });
    hatch(ctx, teeth, Math.PI / 4, 3, { alpha: 0.35, seed: s + 11 });
    ink(ctx, ellipsePts(wc[0], wc[1], rx * 0.55, ry * 0.55, s + 12, 0, 32), { closed: true, w: 1.3, color: C.steelD, shade: false, seed: s + 12 });
    rivet(ctx, wc[0], wc[1], f.l(0.05), C.brassL);
  },
  pump(ctx, f, s) {
    // A standpipe pump from above: the brimming chalice, its motor housing, a coral valve wheel.
    const c = f.p(0.5, 0.52);
    shape(ctx, ellipsePts(c[0], c[1], f.l(0.44), f.l(0.44), s), C.steel, { w: 1.8, seed: s });
    const mot = rr(f, 0.2, 0.66, 0.8, 0.9, 0.04);
    castShadow(ctx, mot, f.l(0.06), 0.3);
    shape(ctx, mot, C.teal, { w: 1.5, seed: s + 1 });
    drumTop(ctx, rr(f, 0.27, 0.71, 0.73, 0.85, 0.03), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 2, 1, f.l(0.04));
    const k = f.p(0.5, 0.4);
    const cup = ellipsePts(k[0], k[1], f.l(0.37), f.l(0.37), s + 3, 0.003, 40);
    castShadow(ctx, cup, f.l(0.14), 0.3);
    shape(ctx, cup, C.tealL, { w: 1.8, seed: s + 3 });
    flat(ctx, ellipsePts(k[0] + 1, k[1] + 1, f.l(0.29), f.l(0.29), s + 4, 0, 36), C.deep);
    ink(ctx, ellipsePts(k[0] + 2, k[1] + 2, f.l(0.17), f.l(0.17), s + 5, 0.05, 28), { closed: true, w: 1.2, color: C.shallow, shade: false, seed: s + 5 });
    ink(ctx, ellipsePts(...f.p(0.18, 0.55), f.l(0.07), f.l(0.07), s + 6, 0, 16), { closed: true, w: 2, color: C.coral, shade: false, seed: s + 6 });
  },
  backfiller(ctx, f, s) {
    // A rubble hopper on legs from above: its open mouth heaped with rubble, the incline belt
    // feeding it from the back, the chute dropping forward.
    plinth(ctx, f, C.steel, 0.05, s, true);
    const chute = rr(f, 0.72, 0.02, 1.28, 0.6, 0.03);
    castShadow(ctx, chute, f.l(0.1), 0.3);
    shape(ctx, chute, C.violet, { w: 1.5, seed: s + 1 });
    hatch(ctx, chute, Math.PI / 4, 3, { alpha: 0.3, seed: s + 1 });
    const outer = rr(f, 0.13, 0.08, 1.87, 1.57, 0.03), inner = rr(f, 0.38, 0.33, 1.62, 1.32, 0.02);
    dropShadow(ctx, f, outer, 2.3, 0.28);
    flat(ctx, outer, C.steelL);
    // Inside the mouth, the walls slope down: the lit far walls, the hatched near ones.
    const [X0, Y0, X1, Y1] = bounds(outer), [x0, y0, x1, y1] = bounds(inner);
    flat(ctx, [[X0, Y0], [X1, Y0], [x1, y0], [x0, y0]], mix(C.steelL, C.ink, 0.35));
    flat(ctx, [[X0, Y0], [x0, y0], [x0, y1], [X0, Y1]], mix(C.steelL, C.ink, 0.25));
    flat(ctx, inner, C.ink);
    const [hx, hy] = f.p(1.0, 0.83);
    const heap = ellipsePts(hx, hy, f.l(0.42), f.l(0.36), s + 2, 0.15, 20);
    flat(ctx, heap, C.dug);
    stipple(ctx, hx - f.l(0.45), hy - f.l(0.4), f.l(0.9), f.l(0.8), 70, { clip: heap, color: C.inkSoft, alpha: 0.55, seed: s + 3, r: 1.1 });
    ink(ctx, outer, { closed: true, w: 2, seed: s + 4 });
    ink(ctx, inner, { closed: true, w: 1.2, alpha: 0.7, shade: false, seed: s + 5 });
    const belt = rr(f, 0.28, 1.22, 0.72, 1.98, 0.01);
    dropShadow(ctx, f, belt, 1.2, 0.25);
    shape(ctx, belt, C.tealL, { w: 1.5, seed: s + 6 });
    ctx.save();
    ctx.strokeStyle = C.teal; ctx.lineWidth = 1.4;
    for (let i = 1; i < 8; i++) { const y = 1.22 + (0.76 * i) / 8; const [a, b] = [f.p(0.31, y), f.p(0.69, y)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.restore();
    ledStrip(ctx, f.p(1.2, 1.75), f.p(1.6, 1.75), 3, f.l(0.035), [C.ledWarm], s + 7);
  },

  // Routing blocks: a riveted steel plate whose sides open on band-wide ribbon mouths (dark,
  // with a coloured lip and a flow chevron); the core says what the block does.
  router(ctx, f, s) {
    // Directional (owner, 2026-10-12): in at the back (S) only, out to the front and both sides.
    // The way in cannot be missed: the turquoise hopper mouth over the incoming ribbon and a big
    // glowing turquoise arrow from it to the middle; the ways out are coral nozzles with arrows.
    forkPlate(ctx, f, [C.coral, C.coral, C.turq, C.coral], [null, null, null, null], s);
    const lid = rr(f, 0.18, 0.18, 0.82, 0.82, 0.06);
    shape(ctx, lid, C.teal, { w: 1.6, seed: s + 1 });
    flat(ctx, rr(f, ...laneRect(2, 0.5, 0.5, 0, 0.32, 0.15), 0.01), mix(C.turqD, C.ink, 0.3));
    for (const side of [0, 1, 3]) flat(ctx, rr(f, ...laneRect(side, 0.5, 0.5, 0.1, 0.32, 0.1), 0.01), mix(C.teal, C.ink, 0.42));
    for (const side of [0, 1, 3]) {
      const [ax, ay] = lanePt(side, 0.5, 0.5, 0.2), [bx, by] = lanePt(side, 0.5, 0.5, 0.48);
      arrowTop(ctx, f, arrowPoly(ax, ay, bx, by, 0.04, 0.11, 0.12), C.coral, 1.3, s + 10 + side);
    }
    // The way in glows (an LED token), so it reads at night too.
    arrowTop(ctx, f, arrowPoly(0.5, 1.0, 0.5, 0.4, 0.085, 0.215, 0.24), C.glowTurq, 1.8, s + 20);
    light(ctx, ...f.p(0.24, 0.24), f.l(0.025), C.led);
    intakeTop(ctx, f, s + 40);
  },
  incinerator: (ctx, f, s) => pitTop(ctx, f, s),
  distributor(ctx, f, s) {
    forkPlate(ctx, f, NEUTRAL, [null, null, null, null], s);
    const lid = rr(f, 0.18, 0.18, 1.82, 1.82, 0.1);
    shape(ctx, lid, C.teal, { w: 1.8, seed: s + 1 });
    for (let side = 0; side < 4; side++) {
      for (const t of [0.5, 1.5]) {
        const [cx, cy] = side & 1 ? [1, t] : [t, 1];
        flat(ctx, rr(f, ...laneRect(side, cx, cy, 0.42, 0.82, 0.1), 0.01), mix(C.teal, C.ink, 0.4));
        chevron(ctx, f, ...lanePt(side, cx, cy, 0.68), side, 0.07, C.ice, 2.2, s + 10 + side * 3 + t);
      }
    }
    const c = f.p(1, 1);
    flat(ctx, ellipsePts(c[0], c[1], f.l(0.42), f.l(0.42), s + 3, 0, 40), mix(C.teal, C.ink, 0.4));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      light(ctx, c[0] + Math.cos(a) * f.l(0.5), c[1] + Math.sin(a) * f.l(0.5), f.l(0.03), i % 2 ? C.led : C.ledWarm);
    }
    hub(ctx, f, 1, 1, 0.26, s + 2);
  },
  sorter: (ctx, f, s) => sorterTop(ctx, f, s, false),
  inverted_sorter: (ctx, f, s) => sorterTop(ctx, f, s, true),
  overflow_gate: (ctx, f, s) => gateTop(ctx, f, s, false),
  underflow_gate: (ctx, f, s) => gateTop(ctx, f, s, true),
  crossing(ctx, f, s) {
    // The junction from above: its little bridge (buildings.ts, `junctionIso`). The north–south
    // line rides the humped deck between two parapet girders; the east–west line runs under it on
    // the ground, where the items view lays its ribbon — the sprite leaves both sides see-through.
    const { x0, x1, r0, r1, parapet, deck } = JUNCTION;
    const N = 48;
    const ys = Array.from({ length: N + 1 }, (_, i) => i / N);
    const high = (y: number): number => deck * junctionHump(y) + parapet; // the parapets' top (levels)
    // Its shadow on the ground east of it, as long as the bridge is high there.
    const sh: Pt[] = ys.map((y) => { const d = f.l(0.11 * high(y)); const [px, py] = f.p(x1, y); return [px + d * 0.7, py + d]; });
    flat(ctx, [f.p(x1, 0), ...sh, f.p(x1, 1)], C.inkSoft, 0.26);
    // The deck: lighter on the north ramp (it leans to the light), darker on the south one, steel
    // slats across as on a skybridge's deck.
    flat(ctx, rr(f, r0, 0, r1, 1, 0.004), C.steelL);
    const steep = Math.max(...ys.slice(1).map((y, i) => (junctionHump(y) - junctionHump(ys[i]!)) * N));
    for (let i = 0; i < N; i++) {
      const slope = ((junctionHump(ys[i + 1]!) - junctionHump(ys[i]!)) * N) / steep;
      if (Math.abs(slope) < 0.05) continue;
      const band: Pt[] = [f.p(r0, ys[i]!), f.p(r1, ys[i]!), f.p(r1, ys[i + 1]!), f.p(r0, ys[i + 1]!)];
      if (slope > 0) flat(ctx, band, '#ffffff', 0.16 * slope);
      else flat(ctx, band, C.ink, -0.2 * slope);
    }
    for (let k = 0; k < 8; k++) {
      const y = (k + 0.5) / 8;
      ink(ctx, [f.p(r0 + 0.015, y), f.p(r1 - 0.015, y)], { w: 2, color: C.steel, shade: false, taper: 0, jitter: 0, seed: s + 10 + k });
    }
    // The crown's ridge, and the deck's edges against the parapets.
    ink(ctx, rr(f, r0, 0, r1, 1, 0.004), { closed: true, w: 1.2, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 20 });
    // The parapet girders: dark steel, a lit top, rivets.
    for (const [i, [a, b]] of ([[x0, r0], [r1, x1]] as const).entries()) {
      const g = rr(f, a, 0, b, 1, 0.006);
      flat(ctx, g, C.steelD);
      ink(ctx, [f.p((a + b) / 2, 0.03), f.p((a + b) / 2, 0.97)], { w: 1.1, color: mix(C.steelD, '#ffffff', 0.3), shade: false, taper: 0, jitter: 0, seed: s + 21 + i });
      for (const y of [0.3, 0.5, 0.7]) rivet(ctx, ...f.p((a + b) / 2, y), f.l(0.018), C.steelL);
      ink(ctx, g, { closed: true, w: 1.6, seed: s + 23 + i });
    }
    // A post with a work lamp at each corner.
    for (const [k, [x, y]] of ([[0.17, 0.045], [0.83, 0.045], [0.17, 0.955], [0.83, 0.955]] as const).entries()) {
      const p = rr(f, x - 0.055, y - 0.045, x + 0.055, y + 0.045, 0.012);
      dropShadow(ctx, f, p, parapet + 0.2, 0.28);
      shape(ctx, p, C.steel, { w: 1.3, shade: false, jitter: 0, seed: s + 30 + k });
      light(ctx, ...f.p(x, y), f.l(0.03), C.ledWarm);
    }
  },
  skybridge(ctx, f, s) {
    // A bridge end from above, start or far alike (buildings.ts `SKY`): a riveted footing, the
    // line's band across it towards the leap (its chevron), the hazard gantry over it. A pair's
    // ramps and deck are laid over it by the buildings view (`drawSkyPieceTop`).
    plinth(ctx, f, C.steel, 0.04, s);
    flat(ctx, rr(f, SKY.r0, 0.04, SKY.r1, 0.96, 0.01), C.tealL);
    for (let k = 0; k < 8; k++) {
      const y = (k + 0.5) / 8;
      ink(ctx, [f.p(SKY.r0 + 0.02, y), f.p(SKY.r1 - 0.02, y)], { w: 1.6, color: C.teal, shade: false, taper: 0, jitter: 0, seed: s + 2 + k });
    }
    for (const x of [SKY.r0, SKY.r1]) ink(ctx, [f.p(x, 0.04), f.p(x, 0.96)], { w: 1.4, shade: false, taper: 0, jitter: 0, seed: s + 12 + x * 10 });
    chevron(ctx, f, 0.5, 0.22, 0, 0.13, C.ice, 3.2, s + 14);
    skyGantryTop(ctx, f, s + 40);
  },
  silo(ctx, f, s) {
    // A tall store tank from above: the cone roof and its hatch inside the catwalk rail, the long
    // shadow it casts, a ladder head and the level gauge's light.
    plinth(ctx, f, C.steel, 0.05, s);
    const c = f.p(1, 1.02);
    const rail = ellipsePts(c[0], c[1], f.l(0.86), f.l(0.86), s + 1, 0.002, 48);
    dropShadow(ctx, f, rail, 2.9, 0.26);
    shape(ctx, rail, C.steelD, { w: 1.6, seed: s + 1 });
    tankTop(ctx, c[0], c[1], f.l(0.78), C.ice, s + 2, { shadow: 0, ribs: 12, cone: true });
    ink(ctx, rail, { closed: true, w: 1.4, color: C.steelL, shade: false, seed: s + 3 });
    const lad = rr(f, 0.15, 0.94, 0.27, 1.1, 0.01);
    shape(ctx, lad, C.steelD, { w: 1, shade: false, jitter: 0, seed: s + 4 });
    light(ctx, ...f.p(1.72, 1.45), f.l(0.04), C.led);
    light(ctx, ...f.p(1, 1.02), f.l(0.05), C.coral);
    ledStrip(ctx, f.p(0.25, 1.85), f.p(0.75, 1.85), 3, f.l(0.035), LEDS, s + 5);
  },

  kiln(ctx, f, s) {
    // A furnace from above: the battered brick shaft and its strapped steel cap, the charging
    // hopper of embers, the mouth glowing to the south; two stacks with hot throats.
    plinth(ctx, f, C.steel, 0.05, s);
    furnaceTop(ctx, f, 0.2, 0.3, 1.45, 1.62, 0.2, s + 1);
    pipe(ctx, [f.p(1.3, 0.75), f.p(1.6, 0.6)], f.l(0.08), C.steelL, s + 2);
    stack(ctx, ...f.p(1.72, 0.48), f.l(0.16), C.steelD, s + 3, C.ledWarm, f.l(0.38));
    stack(ctx, ...f.p(1.72, 1.3), f.l(0.16), C.steelD, s + 4, C.ledWarm, f.l(0.42));
    ledStrip(ctx, f.p(1.6, 1.82), f.p(1.85, 1.82), 2, f.l(0.035), [C.led, C.ledWarm], s + 5);
  },
  kiln_compact(ctx, f, s) {
    plinth(ctx, f, C.steel, 0.05, s);
    furnaceTop(ctx, f, 0.14, 0.68, 0.86, 1.86, 0.13, s + 1);
    stack(ctx, ...f.p(0.5, 0.38), f.l(0.15), C.steelD, s + 2, C.ledWarm, f.l(0.36));
  },
  wire_mill(ctx, f, s) {
    // Spools and rollers from above: two spools of brass wire between steel flanges on a teal
    // bed, the wire running between them through the drawing die.
    plinth(ctx, f, C.steel, 0.05, s);
    const bed = rr(f, 0.12, 0.14, 0.88, 1.86, 0.05);
    castShadow(ctx, bed, f.l(0.06), 0.3);
    shape(ctx, bed, C.teal, { w: 1.8, seed: s + 1 });
    hatch(ctx, rr(f, 0.6, 0.14, 0.88, 1.86, 0.05), Math.PI / 4, 3, { alpha: 0.25, seed: s + 1 });
    const along = (f.rot & 1) === 0 ? 'x' : 'y';
    for (const [i, y] of [0.5, 1.5].entries()) {
      for (const x of [0.16, 0.84]) light(ctx, ...f.p(x, y), f.l(0.03), C.steelL);
      drumTop(ctx, rr(f, 0.26, y - 0.19, 0.74, y + 0.19, 0.03), along, C.brass, s + 10 + i, 4, f.l(0.1));
      for (const x of [0.22, 0.75]) shape(ctx, rr(f, x, y - 0.31, x + 0.04, y + 0.31, 0.01), C.steelL, { w: 1.2, seed: s + 20 + i });
    }
    shape(ctx, rr(f, 0.32, 0.92, 0.68, 1.08, 0.02), C.steelD, { w: 1.3, seed: s + 30 });
    ink(ctx, [f.p(0.5, 0.62), f.p(0.5, 1.38)], { w: 1.6, color: C.brassL, shade: false, taper: 0, seed: s + 31 });
    ledStrip(ctx, f.p(0.25, 1.95), f.p(0.75, 1.95), 3, f.l(0.03), LEDS, s + 32);
  },
  press(ctx, f, s) {
    // A press from above (the first workshop's drawing): the crown beam across two violet columns, its cylinder; the bolster
    // with its hazard edge and coral blank under it; the control cabinet beside.
    plinth(ctx, f, C.steel, 0.05, s);
    const cab = rr(f, 0.18, 1.56, 0.72, 1.9, 0.04);
    castShadow(ctx, cab, f.l(0.1), 0.3);
    shape(ctx, cab, C.steelL, { w: 1.5, seed: s + 1 });
    ledStrip(ctx, f.p(0.28, 1.73), f.p(0.62, 1.73), 3, f.l(0.03), LEDS, s + 2);
    const bol = rr(f, 0.35, 0.62, 1.65, 1.48, 0.03);
    castShadow(ctx, bol, f.l(0.08), 0.3);
    shape(ctx, bol, C.steelL, { w: 1.6, seed: s + 3 });
    shape(ctx, rr(f, 0.38, 1.38, 1.62, 1.45, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 4 });
    shape(ctx, rr(f, 0.7, 0.72, 1.3, 0.8, 0.01), C.coral, { w: 1.2, seed: s + 5 });
    shape(ctx, rr(f, 0.7, 1.2, 1.3, 1.3, 0.01), C.coral, { w: 1.2, seed: s + 6 });
    for (const x of [0.2, 1.52]) {
      const col = rr(f, x, 0.85, x + 0.28, 1.25, 0.02);
      castShadow(ctx, col, f.l(0.2), 0.28);
      shape(ctx, col, C.violet, { w: 1.4, seed: s + 7 + x });
    }
    const crown = rr(f, 0.16, 0.79, 1.84, 1.31, 0.04);
    dropShadow(ctx, f, crown, 2.5, 0.25);
    shape(ctx, crown, C.violet, { w: 2, seed: s + 9 });
    grille(ctx, rr(f, 0.26, 0.88, 0.62, 1.22, 0.02), 3.2, s + 10);
    const cyl = ellipsePts(...f.p(1, 1.05), f.l(0.2), f.l(0.2), s + 11, 0, 28);
    castShadow(ctx, cyl, f.l(0.06), 0.3);
    shape(ctx, cyl, C.brass, { w: 1.4, seed: s + 11 });
    ink(ctx, ellipsePts(...f.p(1, 1.05), f.l(0.12), f.l(0.12), s + 12, 0, 20), { closed: true, w: 1.1, color: C.brassL, shade: false, seed: s + 12 });
    ledStrip(ctx, f.p(1.25, 0.95), f.p(1.7, 0.95), 3, f.l(0.03), LEDS, s + 13);
  },
  great_workshop(ctx, f, s) {
    // An assembly hall under a sawtooth roof; a gantry crane over the yard in front, a crate on its hook.
    plinth(ctx, f, C.steel, 0.04, s);
    shape(ctx, rr(f, 0.3, 0.3, 2.7, 0.95, 0.02), mix(C.steel, C.ink, 0.15), { w: 1, shade: false, seed: s + 1 });
    ledStrip(ctx, f.p(0.4, 0.22), f.p(1.2, 0.22), 5, f.l(0.03), [C.ledWarm, C.led], s + 2);
    sawRoofTop(ctx, f, 0.18, 1.15, 2.82, 2.8, 3, s + 3);
    gantryTop(ctx, f, 0.22, 0.14, 2.78, 1.0, s + 30);
  },
  great_workshop_compact(ctx, f, s) {
    plinth(ctx, f, C.steel, 0.05, s);
    sawRoofTop(ctx, f, 0.15, 0.85, 1.85, 1.86, 2, s + 1);
    arm(ctx, f.p(0.62, 0.42), f.p(0.74, 0.7), f.p(1.1, 0.74), f.l(0.06), C.coral, s + 30);
  },
  tower_workshop(ctx, f, s) {
    // A stepped assembly tower from above: four cone-topped feed tanks piping into the violet
    // core, its upper stage and mast; louvres and LEDs on its roofs.
    plinth(ctx, f, C.steelD, 0.04, s, true);
    for (const [i, [x, y]] of ([[0.55, 0.55], [2.45, 0.55], [0.55, 2.45], [2.45, 2.45]] as const).entries()) {
      pipe(ctx, [f.p(x, y), f.p(1.5, 1.5)], f.l(0.07), C.steelL, s + 40 + i, false);
      tankTop(ctx, ...f.p(x, y), f.l(0.34), i % 2 ? C.cyan : C.ice, s + 20 + i, { shadow: f.l(0.16), ribs: 8, cone: true });
    }
    const a = rr(f, 0.95, 0.95, 2.05, 2.05, 0.04);
    dropShadow(ctx, f, a, 2.6, 0.28);
    shape(ctx, a, C.violet, { w: 2, seed: s + 1 });
    grille(ctx, rr(f, 1.0, 1.0, 1.4, 1.2, 0.02), 3, s + 2);
    ledStrip(ctx, f.p(1.0, 1.95), f.p(1.6, 1.95), 4, f.l(0.03), LEDS, s + 3);
    const b = rr(f, 1.12, 1.12, 1.88, 1.88, 0.04);
    dropShadow(ctx, f, b, 2.0, 0.28);
    shape(ctx, b, mix(C.violet, '#ffffff', 0.12), { w: 1.8, seed: s + 4 });
    grille(ctx, rr(f, 1.2, 1.55, 1.8, 1.8, 0.02), 3, s + 5);
    spire(ctx, ...f.p(1.5, 1.5), f.l(0.28), C.steelD, C.led, s + 6);
  },
  ceramic_oven(ctx, f, s) {
    // A tunnel kiln from above: the long hip roof over brick walls, vent hoods with warm lights
    // along the ridge, the exhaust stack; the kiln car on its rails at the mouth.
    plinth(ctx, f, C.steel, 0.05, s);
    for (const y of [0.24, 0.42]) ink(ctx, [f.p(0.55, y), f.p(1.95, y)], { w: 2, color: C.steelL, shade: false, taper: 0, seed: s + 1 + y * 10 });
    const car = rr(f, 1.15, 0.18, 1.7, 0.48, 0.02);
    castShadow(ctx, car, f.l(0.05), 0.3);
    shape(ctx, car, C.steelD, { w: 1.3, seed: s + 2 });
    for (const x of [1.25, 1.42, 1.59]) shape(ctx, rr(f, x - 0.06, 0.24, x + 0.06, 0.42, 0.01), C.peachL, { w: 1, shade: false, seed: s + 3 + x });
    const walls = rr(f, 0.2, 0.57, 1.9, 1.67, 0.03);
    castShadow(ctx, walls, f.l(0.16), 0.32);
    flat(ctx, walls, BRICK);
    ink(ctx, walls, { closed: true, w: 2, seed: s + 4 });
    // The hip roof: four slopes meeting on a ridge along the kiln, the far-from-light ones hatched.
    const roof = rr(f, 0.26, 0.63, 1.84, 1.61, 0.01);
    const [X0, Y0, X1, Y1] = bounds(roof);
    const wide = X1 - X0 >= Y1 - Y0;
    const d = wide ? (Y1 - Y0) / 2 : (X1 - X0) / 2;
    const r0: Pt = wide ? [X0 + d, (Y0 + Y1) / 2] : [(X0 + X1) / 2, Y0 + d], r1: Pt = wide ? [X1 - d, (Y0 + Y1) / 2] : [(X0 + X1) / 2, Y1 - d];
    const slopes: Array<[Pt[], number]> = wide
      ? [[[[X0, Y0], [X1, Y0], r1, r0], 0], [[[X0, Y0], r0, [X0, Y1]], 0.1], [[[X0, Y1], r0, r1, [X1, Y1]], 0.32], [[[X1, Y0], [X1, Y1], r1], 0.38]]
      : [[[[X0, Y0], [X0, Y1], r1, r0], 0.1], [[[X0, Y0], r0, [X1, Y0]], 0], [[[X1, Y0], r0, r1, [X1, Y1]], 0.38], [[[X0, Y1], [X1, Y1], r1], 0.32]];
    for (const [q, k] of slopes) {
      flat(ctx, q, mix(C.steel, C.ink, k));
      if (k > 0.3) hatch(ctx, q, Math.PI / 4, 3, { alpha: 0.35, seed: s + 5 });
      ink(ctx, q, { closed: true, w: 1.1, alpha: 0.75, shade: false, seed: s + 6 });
    }
    for (const x of [0.62, 1.05, 1.48]) {
      const v = rr(f, x - 0.1, 1.04, x + 0.1, 1.2, 0.02);
      castShadow(ctx, v, f.l(0.06), 0.3);
      shape(ctx, v, C.steelL, { w: 1.2, seed: s + 7 + x });
      light(ctx, ...f.p(x, 1.12), f.l(0.03), C.ledWarm);
    }
    stack(ctx, ...f.p(0.3, 0.3), f.l(0.14), C.steelD, s + 8, C.ledWarm, f.l(0.42));
  },
  // ── research and compute (the research redesign) ─────────────────────────
  observatory(ctx, f, s) {
    // The research lab from above (3×3 since D84): the white roof banded in violet round the
    // glazed analysis chamber and its glowing sample, the vent stack; the intake hopper along the
    // back full of data files; the row of instrument cabinets and the antenna on the tall one.
    plinth(ctx, f, C.steel, 0.05, s);
    hopperTop(ctx, f, 0.2, 2.3, 2.8, 2.86, s + 1);
    roofTop(ctx, f, 0.18, 0.18, 2.05, 2.12, 1.75, LAB, s + 2);
    ink(ctx, rr(f, 0.22, 0.22, 2.01, 2.08, 0.03), { closed: true, w: f.l(0.05), color: C.violet, shade: false, taper: 0, jitter: 0, seed: s + 3 });
    glassTop(ctx, f, 0.4, 0.56, 1.5, 1.72, 0.75, s + 4, () => sampleTop(ctx, f, 0.95, 1.14, 0.12, s + 5));
    stack(ctx, ...f.p(1.78, 0.46), f.l(0.12), C.steelL, s + 6, undefined, f.l(0.1));
    cabinetTop(ctx, f, 2.22, 0.2, 2.84, 0.86, 1.65, C.violet, s + 10);
    cabinetTop(ctx, f, 2.22, 0.98, 2.84, 1.62, 1.3, mix(C.steel, C.violet, 0.3), s + 14);
    cabinetTop(ctx, f, 2.22, 1.74, 2.84, 2.16, 0.9, C.steel, s + 16);
    const a = f.p(2.53, 0.53);
    ink(ctx, [a, [a[0] + f.l(0.2), a[1] + f.l(0.3)]], { w: 1.4, color: C.inkSoft, alpha: 0.3, shade: false, taper: 0, jitter: 0, seed: s + 18 });
    light(ctx, a[0], a[1], f.l(0.035), C.ledRed);
  },
  workshop(ctx, f, s) {
    // The electronics workshop from above: the line's dark bed with green boards riding it from
    // the intakes to the reflow oven (its glowing slit, its fan), the brass gantry rails and the
    // coral bridge with its placing head, the reel rack, the control cabinet.
    plinth(ctx, f, C.steel, 0.05, s);
    const bed = rr(f, 0.2, 0.6, 0.8, 1.86, 0.02);
    castShadow(ctx, bed, f.l(0.06), 0.3);
    shape(ctx, bed, C.steelDD, { w: 1.6, seed: s + 1 });
    for (let k = 1; k < 14; k++) { const y = 0.6 + (1.26 * k) / 14; ink(ctx, [f.p(0.23, y), f.p(0.77, y)], { w: 1, color: C.steelL, alpha: 0.45, shade: false, taper: 0, jitter: 0, seed: s + 2 + k }); }
    for (const [i, y] of [0.7, 1.08, 1.48].entries()) {
      const b = rr(f, 0.28, y, 0.72, y + 0.3, 0.01);
      shape(ctx, b, PCB, { w: 1, shade: false, jitter: 0, seed: s + 20 + i });
      for (let k = 0; k < 3; k++) ink(ctx, [f.p(0.32, y + 0.07 + k * 0.08), f.p(0.6, y + 0.07 + k * 0.08), f.p(0.66, y + 0.1 + k * 0.08)], { w: 0.9, color: C.brassL, alpha: 0.9, shade: false, taper: 0, jitter: 0, seed: s + 24 + k });
      shape(ctx, rr(f, 0.36, y + 0.1, 0.5, y + 0.2, 0.005), C.steelDD, { w: 0.8, shade: false, jitter: 0, seed: s + 28 + i });
    }
    roofTop(ctx, f, 0.12, 0.1, 0.88, 0.58, 1.02, C.steelL, s + 30);
    fanTop(ctx, f, 0.36, 0.34, 0.15, s + 31);
    stack(ctx, ...f.p(0.7, 0.3), f.l(0.08), C.steelD, s + 32, undefined, f.l(0.12));
    shape(ctx, rr(f, 0.18, 0.5, 0.82, 0.56, 0.005), C.warn, { w: 1, shade: false, jitter: 0, seed: s + 33 });
    light(ctx, ...f.p(0.5, 0.53), f.l(0.03), C.ledWarm);
    cabinetTop(ctx, f, 1.12, 0.14, 1.86, 0.84, 1.0, mix(C.steel, C.violet, 0.35), s + 40);
    roofTop(ctx, f, 1.1, 1.06, 1.86, 1.8, 1.3, C.steelD, s + 44);
    for (const [i, x] of [1.23, 1.48, 1.73].entries()) {
      for (const [j, y] of [1.22, 1.62].entries()) {
        const reel = rr(f, x - 0.11, y - 0.04, x + 0.11, y + 0.04, 0.01);
        shape(ctx, reel, [C.brass, C.teal, C.coral, C.violetL, C.cyan, C.brassL][(i + j * 3) % 6]!, { w: 1, shade: false, jitter: 0, seed: s + 45 + i * 2 + j });
      }
    }
    for (const x of [0.1, 0.9]) pipe(ctx, [f.p(x, 0.66), f.p(x, 1.78)], f.l(0.05), C.brass, s + 50 + x * 10, false);
    const bridge = rr(f, 0.04, 1.08, 0.96, 1.22, 0.01);
    dropShadow(ctx, f, bridge, 1.4, 0.22);
    shape(ctx, bridge, C.coral, { w: 1.3, seed: s + 52 });
    const head = rr(f, 0.4, 1.06, 0.6, 1.24, 0.02);
    dropShadow(ctx, f, head, 1.5, 0.25);
    shape(ctx, head, C.violetL, { w: 1.2, seed: s + 53 });
    light(ctx, ...f.p(0.5, 1.15), f.l(0.025), C.led);
  },
  quartz_workshop: quartzWorkshopTop,
  test_bench(ctx, f, s) {
    // The test bench from above: the vibration table's plate on its springs with the clamped
    // board, the dynamometer — drive motor, the gear train edge-on under its coral clamp bar, the
    // coral load drum — and the violet instrument rack, cable looms between them.
    plinth(ctx, f, C.steel, 0.05, s, true);
    roofTop(ctx, f, 0.16, 1.02, 1.24, 1.8, 0.4, C.steelD, s + 1);
    roofTop(ctx, f, 0.2, 1.06, 1.18, 1.76, 0.67, C.steelL, s + 2);
    shape(ctx, rr(f, 0.22, 1.66, 1.16, 1.74, 0.005), C.hazard, { w: 0.8, shade: false, jitter: 0, seed: s + 3 });
    shape(ctx, rr(f, 0.4, 1.18, 0.98, 1.64, 0.01), PCB, { w: 1, shade: false, jitter: 0, seed: s + 4 });
    for (let k = 0; k < 4; k++) ink(ctx, [f.p(0.46, 1.25 + k * 0.1), f.p(0.8, 1.25 + k * 0.1), f.p(0.86, 1.29 + k * 0.1)], { w: 0.9, color: C.brassL, alpha: 0.9, shade: false, taper: 0, jitter: 0, seed: s + 5 + k });
    shape(ctx, rr(f, 0.5, 1.3, 0.66, 1.44, 0.005), C.steelDD, { w: 0.8, shade: false, jitter: 0, seed: s + 9 });
    for (const x of [0.36, 1.02]) shape(ctx, rr(f, x - 0.05, 1.14, x + 0.05, 1.68, 0.01), C.steelDD, { w: 1, shade: false, jitter: 0, seed: s + 10 + x });
    roofTop(ctx, f, 0.12, 0.22, 1.36, 0.7, 0.55, C.steelD, s + 12);
    shape(ctx, rr(f, 0.14, 0.62, 1.34, 0.68, 0.005), C.hazard, { w: 0.8, shade: false, jitter: 0, seed: s + 13 });
    roofTop(ctx, f, 0.14, 0.28, 0.4, 0.64, 1.3, C.teal, s + 14);
    grille(ctx, rr(f, 0.18, 0.32, 0.36, 0.5, 0.01), 3, s + 15);
    for (const [i, [x, r, col]] of ([[0.72, 0.27, C.brass], [1.05, 0.13, C.steelL], [1.26, 0.11, C.brassL]] as const).entries()) {
      const g = rr(f, x - r, 0.39, x + r, 0.53, 0.01);
      dropShadow(ctx, f, g, 1.5, 0.22);
      shape(ctx, g, col, { w: 1.1, shade: false, jitter: 0, seed: s + 16 + i });
      const n = Math.round(r * 40);
      for (let k = 1; k < n; k++) { const tx = x - r + (2 * r * k) / n; ink(ctx, [f.p(tx, 0.39), f.p(tx, 0.53)], { w: 0.7, color: C.ink, alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: s + 20 + k }); }
      pipe(ctx, [f.p(x, 0.32), f.p(x, 0.6)], f.l(0.03), C.steelD, s + 26 + i, false);
    }
    const bar = rr(f, 0.37, 0.435, 1.47, 0.485, 0.005);
    dropShadow(ctx, f, bar, 2.1, 0.22);
    shape(ctx, bar, C.coral, { w: 1.3, seed: s + 29 });
    for (const x of [0.42, 1.42]) rivet(ctx, ...f.p(x, 0.46), f.l(0.022), C.brassL);
    roofTop(ctx, f, 1.44, 0.24, 1.82, 0.6, 0.62, C.steelD, s + 30);
    drumTop(ctx, rr(f, 1.5, 0.24, 1.78, 0.64, 0.06), (f.rot & 1) === 0 ? 'x' : 'y', C.coral, s + 33, 1, f.l(0.12));
    roofTop(ctx, f, 1.48, 0.66, 1.82, 0.94, 0.72, C.steelD, s + 38);
    light(ctx, ...f.p(1.65, 0.8), f.l(0.025), C.ledWarm);
    cabinetTop(ctx, f, 1.44, 1.02, 1.86, 1.8, 1.25, C.violet, s + 40);
    for (const [k, [a, b, col]] of ([[[1.44, 1.3], [1.18, 1.4], C.teal], [[1.44, 1.42], [1.18, 1.52], C.steelDD], [[1.5, 0.8], [1.42, 0.5], C.coral]] as const).entries()) cable(ctx, f.p(a[0], a[1]), f.p(b[0], b[1]), f.l(0.03), 0.12, col, s + 50 + k);
  },
  data_collector(ctx, f, s) {
    // A data-gathering antenna from above: the geared turntable under its tilted array panel,
    // the receiver cabinet with its LEDs, the cartridge stacker by the outlet.
    plinth(ctx, f, C.steel, 0.05, s);
    stackerTop(ctx, f, 0.14, 0.14, 0.64, 0.66, s + 1);
    cabinetTop(ctx, f, 0.12, 0.86, 0.62, 1.86, 1.22, C.teal, s + 5);
    cable(ctx, f.p(0.62, 1.3), f.p(1.0, 1.25), f.l(0.03), 0.12, C.steelDD, s + 9);
    turntableTop(ctx, f, 1.3, 1.12, 0.48, s + 10);
    arrayTop(ctx, f, 1.3, 1.02, 1.1, 0.6, 6, 4, 1.8, s + 12);
  },
  data_relay(ctx, f, s) {
    // The relay from above: the guyed lattice mast, its big array and the head of three sector
    // panels, the receiver cabinet and power box at its foot, the stacker by the outlet.
    plinth(ctx, f, C.steelD, 0.04, s);
    const mx = 1.6, my = 1.5;
    for (const [i, [ax, ay]] of ([[0.3, 0.32], [2.7, 0.32], [0.3, 1.5]] as const).entries()) {
      ink(ctx, [f.p(ax, ay), f.p(mx, my)], { w: 1, color: C.steelDD, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: s + 1 + i });
      shape(ctx, rr(f, ax - 0.08, ay - 0.08, ax + 0.08, ay + 0.08, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 4 + i });
    }
    stackerTop(ctx, f, 1.1, 0.14, 1.9, 0.62, s + 10);
    cabinetTop(ctx, f, 0.2, 1.98, 1.3, 2.82, 1.45, C.teal, s + 14);
    roofTop(ctx, f, 2.05, 2.05, 2.8, 2.8, 1.0, C.coral, s + 18);
    grille(ctx, rr(f, 2.15, 2.15, 2.7, 2.45, 0.01), 3, s + 19);
    derrickTop(ctx, f, mx, my, 0.4, 0.11, 5.3, s + 20);
    arrayTop(ctx, f, mx + 0.1, my + 0.38, 0.95, 0.42, 6, 4, 2.4, s + 30);
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k * 2 * Math.PI) / 3, ux = Math.cos(a), uy = Math.sin(a), cx = mx + ux * 0.3, cy = my + uy * 0.3;
      const P = (u: number, v: number): Pt => f.p(cx + ux * v - uy * u, cy + uy * v + ux * u);
      const q: Pt[] = [P(-0.15, -0.04), P(0.15, -0.04), P(0.15, 0.04), P(-0.15, 0.04)];
      dropShadow(ctx, f, q, 4.2, 0.2);
      shape(ctx, q, mix(C.violet, C.ink, 0.3), { w: 1.2, shade: false, jitter: 0, seed: s + 40 + k });
      ink(ctx, [P(0, 0), f.p(mx, my)], { w: 1.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 44 + k });
    }
    light(ctx, ...f.p(mx, my), f.l(0.045), C.ledRed);
  },
  server(ctx, f, s) {
    // The server room from above: two rows of rack roofs with their fans and status LEDs, the
    // cable trunk bridging the aisle.
    plinth(ctx, f, C.steelD, 0.05, s);
    for (const [j, [y0, y1, h]] of ([[0.16, 0.7, 2.05], [1.2, 1.74, 1.72]] as const).entries()) {
      for (const [i, [x0, x1]] of ([[0.14, 0.7], [0.72, 1.28], [1.3, 1.86]] as const).entries()) rackTop(ctx, f, x0, y0, x1, y1, h, s + j * 30 + i * 9, i === 1 ? mix(RACK, C.steelL, 0.2) : RACK);
    }
    const tr = rr(f, 0.1, 0.72, 1.9, 0.9, 0.01);
    dropShadow(ctx, f, tr, 2.0, 0.22);
    shape(ctx, tr, C.hazard, { w: 1.3, seed: s + 80 });
    for (let k = 1; k < 12; k++) ink(ctx, [f.p(0.1 + (1.8 * k) / 12, 0.73), f.p(0.1 + (1.8 * k) / 12 - 0.04, 0.89)], { w: 1.1, color: C.ink, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 81 + k });
    for (const [k, x] of [0.42, 1.0, 1.58].entries()) cable(ctx, f.p(x, 0.88), f.p(x + 0.08, 1.3), f.l(0.035), 0.1, C.steelDD, s + 95 + k);
  },
  cooled_server(ctx, f, s) {
    // Racks sunk in a coolant bath, from above: the cyan bath, the rack tops standing out of it
    // with ripples and bubbles, the coolant pipes over the rim, the chiller and its three fans.
    plinth(ctx, f, C.steelD, 0.04, s);
    roofTop(ctx, f, 0.14, 0.16, 2.02, 2.84, 0.95, C.steelL, s + 1);
    const liq = rr(f, 0.22, 0.24, 1.94, 2.76, 0.01);
    shape(ctx, liq, COOLANT, { w: 1.2, shade: false, jitter: 0, seed: s + 2 });
    ctx.save(); pathOf(ctx, liq); ctx.clip();
    hatch(ctx, liq, -Math.PI / 8, 7, { color: '#ffffff', alpha: 0.18, seed: s + 3, w: 1 });
    ctx.restore();
    for (const [j, y0] of [0.42, 1.18, 1.94].entries()) {
      for (const [i, [x0, x1]] of ([[0.34, 1.06], [1.1, 1.82]] as const).entries()) {
        ink(ctx, rr(f, x0 - 0.06, y0 - 0.06, x1 + 0.06, y0 + 0.46, 0.06), { closed: true, w: 1.2, color: mix(COOLANT, '#ffffff', 0.55), alpha: 0.8, shade: false, taper: 0, seed: s + 10 + j });
        rackTop(ctx, f, x0, y0, x1, y0 + 0.4, 0.6, s + 20 + j * 10 + i * 4, i ? RACK : mix(RACK, C.steelL, 0.2));
      }
    }
    roofTop(ctx, f, 2.2, 0.26, 2.86, 2.74, 1.3, C.steelD, s + 60);
    for (const [i, y] of [0.7, 1.4, 2.1].entries()) fanTop(ctx, f, 2.53, y, 0.24, s + 61 + i);
    ledStrip(ctx, f.p(2.3, 2.62), f.p(2.76, 2.62), 3, f.l(0.025), [C.led, C.ledGreen], s + 66);
    for (const [i, y] of [0.62, 2.38].entries()) pipe(ctx, [f.p(2.2, y), f.p(1.9, y)], f.l(0.08), i ? C.tealL : C.steelL, s + 70 + i);
  },
  supercomputer(ctx, f, s) {
    // The supercomputer from above: three stepped violet tiers, their seams glowing cyan, the
    // glazed crown round the glowing core; four radiator towers with their fans on the corners,
    // cyan coolant pipes running in.
    plinth(ctx, f, C.steelDD, 0.04, s);
    for (const [i, [x, y]] of ([[0.62, 0.62], [3.38, 0.62], [0.62, 3.38], [3.38, 3.38]] as const).entries()) {
      pipe(ctx, [f.p(x + (2 - x) * 0.14, y + (2 - y) * 0.14), f.p(x + (2 - x) * 0.5, y + (2 - y) * 0.5)], f.l(0.08), C.cyan, s + 1 + i);
      roofTop(ctx, f, x - 0.36, y - 0.36, x + 0.36, y + 0.36, 2.25, C.steelD, s + 5 + i * 3);
      fanTop(ctx, f, x, y, 0.26, s + 6 + i * 3);
    }
    for (const [i, [k, h]] of ([[0.95, 1.65], [1.25, 2.75], [1.58, 3.6]] as const).entries()) {
      roofTop(ctx, f, k, k, 4 - k, 4 - k, h, mix(mix(C.violet, '#ffffff', 0.06 * i), C.steelD, 0.4), s + 20 + i * 5, 0.02);
      const n = Math.round((4 - 2 * k) / 0.5);
      for (let j = 1; j < n; j++) {
        const t = k + ((4 - 2 * k) * j) / n;
        for (const seg of [[f.p(t, k), f.p(t, k + 0.12)], [f.p(t, 4 - k - 0.12), f.p(t, 4 - k)], [f.p(k, t), f.p(k + 0.12, t)], [f.p(4 - k - 0.12, t), f.p(4 - k, t)]] as const) glowSeam(ctx, [...seg], 1.4, C.led, s + 30 + j);
      }
    }
    glassTop(ctx, f, 1.66, 1.66, 2.34, 2.34, 0.6, s + 50, () => sampleTop(ctx, f, 2, 2, 0.15, s + 51));
    light(ctx, ...f.p(2.3, 2.3), f.l(0.035), C.ledRed);
  },
  auto_lab(ctx, f, s) {
    // The automated lab from above: the long white roof banded in violet, its own array panel on
    // a turntable and a vent stack; the intake hoppers at the back; the glazed analysis annex and
    // the instrument cabinets beside.
    plinth(ctx, f, C.steel, 0.04, s);
    for (const [i, x] of [0.5, 2.5].entries()) hopperTop(ctx, f, x - 0.36, 2.3, x + 0.36, 2.86, s + 1 + i * 5);
    roofTop(ctx, f, 0.18, 0.18, 2.12, 2.16, 1.62, LAB, s + 10);
    ink(ctx, rr(f, 0.22, 0.22, 2.08, 2.12, 0.03), { closed: true, w: f.l(0.05), color: C.violet, shade: false, taper: 0, jitter: 0, seed: s + 11 });
    stack(ctx, ...f.p(1.86, 1.86), f.l(0.12), C.steelL, s + 12, undefined, f.l(0.1));
    turntableTop(ctx, f, 1.0, 1.0, 0.38, s + 13);
    arrayTop(ctx, f, 1.0, 0.92, 0.95, 0.5, 6, 4, 2.9, s + 14);
    roofTop(ctx, f, 2.26, 0.22, 2.88, 0.98, 0.55, C.steelD, s + 20);
    glassTop(ctx, f, 2.32, 0.28, 2.82, 0.92, 0.7, s + 21, () => sampleTop(ctx, f, 2.57, 0.6, 0.1, s + 22));
    cabinetTop(ctx, f, 2.28, 1.12, 2.86, 2.1, 1.25, C.violet, s + 25);
  },


  mast: poleTop,
  fence: fenceTop, // D103: recipes/gleaners.ts
  pylon: pylonTop,
  brazier(ctx, f, s) {
    // A fire-tube boiler from above: the firebox under its boiler drum, and at the front the
    // coal generator — a fire basket crowning the stack, flames licking out.
    plinth(ctx, f, C.steel, 0.07, s);
    const fb = rr(f, 0.14, 0.88, 0.86, 1.86, 0.04);
    castShadow(ctx, fb, f.l(0.1), 0.3);
    shape(ctx, fb, C.steelD, { w: 1.8, seed: s + 1 });
    grille(ctx, rr(f, 0.2, 1.62, 0.8, 1.8, 0.02), 3, s + 2);
    drumTop(ctx, rr(f, 0.28, 0.98, 0.72, 1.76, 0.06), (f.rot & 1) === 0 ? 'y' : 'x', C.steelL, s + 3, 3, f.l(0.12));
    pipe(ctx, [f.p(0.5, 0.95), f.p(0.5, 0.65)], f.l(0.06), C.brass, s + 4);
    const c = f.p(0.5, 0.45);
    const basket = ellipsePts(c[0], c[1], f.l(0.33), f.l(0.33), s + 5, 0.003, 32);
    castShadow(ctx, basket, f.l(0.36), 0.28);
    shape(ctx, basket, C.steelD, { w: 1.8, seed: s + 5 });
    const cold = isUnlit(ctx); // switched off (D83): cold coals, no flames
    flat(ctx, ellipsePts(c[0], c[1], f.l(0.25), f.l(0.25), s + 6, 0.02, 28), cold ? UNLIT : C.warn);
    if (cold) return;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, r0 = f.l(0.08), r1 = f.l(0.24 + (i % 2) * 0.06);
      shape(ctx, [[c[0] + Math.cos(a - 0.3) * r0, c[1] + Math.sin(a - 0.3) * r0], [c[0] + Math.cos(a) * r1, c[1] + Math.sin(a) * r1], [c[0] + Math.cos(a + 0.3) * r0, c[1] + Math.sin(a + 0.3) * r0]], i % 2 ? C.coral : C.glowPeach, { w: 1, shade: false, seed: s + 7 + i });
    }
    light(ctx, c[0], c[1], f.l(0.1), C.ledWarm);
  },
  sun_bulb(ctx, f, s) {
    // A dish concentrator from above: the faceted mirror bowl on its pedestal, three struts
    // holding the glowing receiver — the bulb — at its focus; the control box.
    plinth(ctx, f, C.steel, 0.05, s);
    const box = rr(f, 1.45, 1.5, 1.85, 1.85, 0.03);
    castShadow(ctx, box, f.l(0.07), 0.3);
    shape(ctx, box, C.teal, { w: 1.4, seed: s + 1 });
    light(ctx, ...f.p(1.65, 1.62), f.l(0.03), C.ledGreen);
    const c = f.p(0.92, 0.95), R = f.l(0.84);
    const rim = ellipsePts(c[0], c[1], R, R * 0.9, s + 2, 0.002, 64, -0.35);
    dropShadow(ctx, f, rim, 1.6, 0.24);
    shape(ctx, rim, C.steelD, { w: 1.8, seed: s + 2 });
    const face = ellipsePts(c[0] - 1, c[1] - 1, R * 0.93, R * 0.83, s + 3, 0.002, 64, -0.35);
    flat(ctx, face, mix(C.ice, C.ink, 0.2));
    ctx.save(); pathOf(ctx, face); ctx.clip();
    flat(ctx, face.map(([x, y]) => [x + R * 0.18, y + R * 0.14] as Pt), C.ice);
    for (const k of [0.35, 0.68]) ink(ctx, ellipsePts(c[0], c[1], R * 0.93 * k, R * 0.83 * k, s + 4 + k * 10, 0, 48, -0.35), { closed: true, w: 1.1, color: C.steelL, shade: false, seed: s + 5 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ink(ctx, [[c[0] + Math.cos(a) * R * 0.1, c[1] + Math.sin(a) * R * 0.1], [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R]], { w: 1, color: C.steelL, shade: false, taper: 0, seed: s + 6 + i });
    }
    ctx.restore();
    ink(ctx, face, { closed: true, w: 1.6, seed: s + 7 });
    const fp: Pt = [c[0] - f.l(0.12), c[1] - f.l(0.08)];
    for (const a of [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]) {
      ink(ctx, [[c[0] + Math.cos(a) * R * 0.88, c[1] + Math.sin(a) * R * 0.8], fp], { w: 2, color: C.steelD, shade: false, taper: 0, seed: s + 20 });
    }
    flat(ctx, ellipsePts(fp[0] + f.l(0.3), fp[1] + f.l(0.4), f.l(0.1), f.l(0.07), s + 21, 0, 16), C.inkSoft, 0.25);
    shape(ctx, ellipsePts(fp[0], fp[1], f.l(0.09), f.l(0.09), s + 22, 0, 20), C.glowPeach, { w: 1.3, seed: s + 22 });
    light(ctx, fp[0], fp[1], f.l(0.1), C.ledWarm);
  },
  accumulator(ctx, f, s) {
    // A capacitor bank from above: four cells with brass terminals and green charge rings, bus bars
    // tying them, the charge gauge on the plinth.
    plinth(ctx, f, C.steel, 0.05, s);
    const cells = [[0.55, 0.55, C.violet], [1.45, 0.55, C.violetL], [0.55, 1.45, C.violetL], [1.45, 1.45, C.violet]] as const;
    for (const [i, [x, y, col]] of cells.entries()) {
      const p = f.p(x, y);
      tankTop(ctx, p[0], p[1], f.l(0.35), col, s + i * 5, { shadow: f.l(0.18), ribs: 0 });
      ink(ctx, ellipsePts(p[0], p[1], f.l(0.29), f.l(0.29), s + 20 + i, 0, 32), { closed: true, w: 2.4, color: C.ledGreen, shade: false, seed: s + 20 + i });
    }
    for (const [a, b] of [[[0.55, 0.55], [1.45, 0.55]], [[0.55, 1.45], [1.45, 1.45]], [[0.55, 0.55], [0.55, 1.45]], [[1.45, 0.55], [1.45, 1.45]]] as const) {
      pipe(ctx, [f.p(a[0], a[1]), f.p(b[0], b[1])], f.l(0.04), C.brass, s + 40 + a[0] + b[1], false);
    }
    for (const [x, y] of cells) {
      const p = f.p(x, y);
      shape(ctx, ellipsePts(p[0], p[1], f.l(0.09), f.l(0.09), s + 50, 0, 16), C.brassL, { w: 1.1, seed: s + 50 });
      light(ctx, p[0], p[1], f.l(0.03), C.ledGreen);
    }
    ledStrip(ctx, f.p(0.25, 1.92), f.p(0.85, 1.92), 5, f.l(0.035), [C.ledGreen, C.ledGreen, C.ledGreen, C.led, C.ledWarm], s + 4);
  },
  cell_charger(ctx, f, s) {
    // A charging bay from above: the finned transformer and its three porcelain bushings, brass
    // bus bars to the rack where four cells glow green as they fill.
    plinth(ctx, f, C.steelD, 0.05, s);
    const tr = rr(f, 0.2, 0.86, 1.15, 1.8, 0.04);
    castShadow(ctx, tr, f.l(0.14), 0.3);
    shape(ctx, tr, C.violet, { w: 1.8, seed: s + 1 });
    const [X0, Y0, X1, Y1] = bounds(tr);
    ctx.save();
    ctx.strokeStyle = mix(C.violet, C.ink, 0.45); ctx.lineWidth = 1.6;
    for (let i = 1; i < 9; i++) {
      const t = i / 9;
      for (const [a, b] of [[[X0 + (X1 - X0) * t, Y0], [X0 + (X1 - X0) * t, Y0 + 4]], [[X0 + (X1 - X0) * t, Y1 - 4], [X0 + (X1 - X0) * t, Y1]], [[X0, Y0 + (Y1 - Y0) * t], [X0 + 4, Y0 + (Y1 - Y0) * t]], [[X1 - 4, Y0 + (Y1 - Y0) * t], [X1, Y0 + (Y1 - Y0) * t]]] as const) {
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    ctx.restore();
    const rack = rr(f, 1.15, 0.15, 1.95, 1.35, 0.04);
    castShadow(ctx, rack, f.l(0.08), 0.3);
    shape(ctx, rack, C.steel, { w: 1.6, seed: s + 2 });
    for (const [i, [x, y, full]] of ([[1.38, 0.45, 1], [1.72, 0.45, 1], [1.38, 1.05, 0], [1.72, 1.05, 1]] as const).entries()) {
      const p = f.p(x, y);
      tankTop(ctx, p[0], p[1], f.l(0.14), full ? C.ice : C.violetL, s + 10 + i, { shadow: f.l(0.08), ribs: 0 });
      ink(ctx, ellipsePts(p[0], p[1], f.l(0.16), f.l(0.16), s + 20 + i, 0, 24), { closed: true, w: 2, color: full ? C.ledGreen : C.violet, shade: false, seed: s + 20 + i });
    }
    for (const [i, x] of [0.42, 0.68, 0.94].entries()) {
      const p = f.p(x, 1.33);
      const b = ellipsePts(p[0], p[1], f.l(0.11), f.l(0.11), s + 30 + i, 0, 20);
      castShadow(ctx, b, f.l(0.1), 0.3);
      shape(ctx, b, C.ice, { w: 1.2, seed: s + 30 + i });
      ink(ctx, ellipsePts(p[0], p[1], f.l(0.07), f.l(0.07), s + 33 + i, 0, 16), { closed: true, w: 1, color: C.steelL, shade: false, seed: s + 33 + i });
      flat(ctx, ellipsePts(p[0], p[1], f.l(0.04), f.l(0.04), s + 36 + i, 0, 12), C.brassL);
    }
    // The free bushing takes the line in: its cap is the terminal (art/terminals.ts).
    terminalProbe.fn?.(CHARGER_BUSHING.x, CHARGER_BUSHING.y, CHARGER_BUSHING.z);
    pipe(ctx, [f.p(0.94, 1.33), f.p(1.4, 1.0), f.p(1.55, 0.75)], f.l(0.045), C.brass, s + 40, false);
    pipe(ctx, [f.p(0.68, 1.33), f.p(1.2, 1.3), f.p(1.55, 1.05)], f.l(0.045), C.brass, s + 41, false);
  },
  fumarole_tap(ctx, f, s) {
    // A geothermal tap from above: the cooling tower's throat breathing steam, the turbine house
    // and its generator, the wellhead's valve tree on the vent, steam pipes between them.
    plinth(ctx, f, C.steelD, 0.04, s, true);
    const th = rr(f, 0.2, 0.22, 1.15, 1.12, 0.05);
    castShadow(ctx, th, f.l(0.12), 0.3);
    shape(ctx, th, C.teal, { w: 1.8, seed: s + 1 });
    grille(ctx, rr(f, 0.3, 0.9, 0.7, 1.05, 0.02), 3, s + 2);
    drumTop(ctx, rr(f, 0.5, 0.38, 0.86, 0.96, 0.08), (f.rot & 1) === 0 ? 'y' : 'x', C.steelL, s + 3, 2, f.l(0.1));
    pipe(ctx, [f.p(0.95, 2.05), f.p(0.95, 1.2), f.p(0.85, 1.05)], f.l(0.07), C.steelL, s + 4);
    pipe(ctx, [f.p(1.05, 2.05), f.p(1.7, 1.6), f.p(1.7, 1.3)], f.l(0.07), C.steelL, s + 5);
    const w = f.p(0.95, 2.05);
    shape(ctx, ellipsePts(w[0], w[1], f.l(0.62), f.l(0.62), s + 6, 0.05), C.mesa, { w: 1.8, seed: s + 6 });
    stipple(ctx, w[0] - f.l(0.62), w[1] - f.l(0.62), f.l(1.24), f.l(1.24), 60, { clip: ellipsePts(w[0], w[1], f.l(0.6), f.l(0.6), s + 6, 0.05), color: C.inkSoft, alpha: 0.35, seed: s + 7 });
    const wh = ellipsePts(w[0], w[1], f.l(0.24), f.l(0.24), s + 8, 0, 24);
    castShadow(ctx, wh, f.l(0.2), 0.3);
    shape(ctx, wh, C.steel, { w: 1.5, seed: s + 8 });
    for (const a of [0, Math.PI / 2]) shape(ctx, rr(f, 0.95 - 0.22 * Math.cos(a) - 0.04 * Math.sin(a), 2.05 - 0.22 * Math.sin(a) - 0.04 * Math.cos(a), 0.95 + 0.22 * Math.cos(a) + 0.04 * Math.sin(a), 2.05 + 0.22 * Math.sin(a) + 0.04 * Math.cos(a), 0.01), C.coral, { w: 1.1, seed: s + 9 });
    shape(ctx, ellipsePts(w[0], w[1], f.l(0.08), f.l(0.08), s + 10, 0, 16), C.coral, { w: 1.1, seed: s + 10 });
    ink(ctx, ellipsePts(w[0] - f.l(0.26), w[1], f.l(0.06), f.l(0.06), s + 11, 0, 14), { closed: true, w: 1.6, color: C.brassL, shade: false, seed: s + 11 });
    // The tower: its broad base under the waist, the lip round the dark throat.
    const t = f.p(2.02, 1.0);
    const base = ellipsePts(t[0], t[1], f.l(0.84), f.l(0.84), s + 12, 0.003, 48);
    dropShadow(ctx, f, base, 3.0, 0.24);
    shape(ctx, base, mix(TOWER, C.ink, 0.15), { w: 1.8, seed: s + 12 });
    hatch(ctx, shadowCrescent(t[0], t[1], f.l(0.84), 0.3, s), Math.PI / 4, 3, { alpha: 0.35, seed: s + 12 });
    const lip = ellipsePts(t[0], t[1], f.l(0.62), f.l(0.62), s + 13, 0.003, 48);
    shape(ctx, lip, TOWER, { w: 1.6, seed: s + 13 });
    flat(ctx, ellipsePts(t[0] + 1, t[1] + 1, f.l(0.5), f.l(0.5), s + 14, 0, 40), C.ink);
    // Its steam, while it works (switched off, D83, the tower stands cold).
    if (!isUnlit(ctx)) for (const [i, [dx, dy, r]] of ([[-0.1, -0.15, 0.22], [0.2, 0.05, 0.18], [-0.25, 0.2, 0.15]] as const).entries()) {
      const [px, py] = f.p(2.02 + dx, 1.0 + dy);
      puffTop(ctx, px, py, f.l(r), s + 15 + i);
    }
  },
  sunheart(ctx, f, s) {
    // A star in a cage, from above: the ringed foundation, the burning core held in its coil
    // rings, four capacitor towers feeding it through brass conduits.
    plinth(ctx, f, C.steelDD, 0.04, s, true);
    const c = f.p(2.5, 2.5);
    for (const [x, y] of [[0.7, 0.7], [4.3, 0.7], [0.7, 4.3], [4.3, 4.3]] as const) pipe(ctx, [f.p(x, y), f.p(x + (2.5 - x) * 0.42, y + (2.5 - y) * 0.42)], f.l(0.12), C.brass, s + x + y);
    const base = ellipsePts(c[0], c[1], f.l(1.9), f.l(1.9), s + 1, 0.003, 72);
    castShadow(ctx, base, f.l(0.14), 0.3);
    shape(ctx, base, C.steelD, { w: 2.2, seed: s + 1 });
    ink(ctx, ellipsePts(c[0], c[1], f.l(1.75), f.l(1.75), s + 2, 0, 72), { closed: true, w: 1.2, color: C.steel, shade: false, seed: s + 2 });
    for (const [x, y] of [[0.7, 0.7], [4.3, 0.7], [0.7, 4.3], [4.3, 4.3]] as const) {
      const t = rr(f, x - 0.35, y - 0.35, x + 0.35, y + 0.35, 0.04);
      dropShadow(ctx, f, t, 3.2, 0.26);
      shape(ctx, t, C.steel, { w: 1.8, seed: s + 3 + x });
      grille(ctx, rr(f, x - 0.25, y - 0.25, x + 0.25, y + 0.05, 0.02), 3, s + 4);
      light(ctx, ...f.p(x, y + 0.2), f.l(0.04), C.led);
    }
    const ring0 = ellipsePts(c[0], c[1], f.l(1.62), f.l(1.62), s + 5, 0, 72);
    castShadow(ctx, ring0, f.l(0.4), 0.2);
    ink(ctx, ring0, { closed: true, w: f.l(0.13), color: C.ink, shade: false, seed: s + 6 });
    ink(ctx, ring0, { closed: true, w: f.l(0.08), color: C.brass, shade: false, seed: s + 7 });
    const core = ellipsePts(c[0], c[1], f.l(0.95), f.l(0.95), s + 8, 0.003, 48);
    castShadow(ctx, core, f.l(0.5), 0.25);
    flat(ctx, core, C.warn);
    hatch(ctx, shadowCrescent(c[0], c[1], f.l(0.95), 0.32, s), Math.PI / 4, 3.4, { alpha: 0.45, seed: s + 8 });
    ink(ctx, ellipsePts(c[0], c[1], f.l(0.62), f.l(0.62), s + 9, 0, 40), { closed: true, w: f.l(0.08), color: C.coral, shade: false, seed: s + 9 });
    ink(ctx, core, { closed: true, w: 2, seed: s + 10 });
    light(ctx, c[0] - f.l(0.15), c[1] - f.l(0.2), f.l(0.18), C.ledWarm);
    // The tilted coil rings cross over the core.
    for (const [k, rot, rx, ry] of [[0, Math.PI / 4, 1.38, 0.32], [1, -Math.PI / 4, 1.24, 0.62]] as const) {
      const ring = ellipsePts(c[0], c[1], f.l(rx), f.l(ry), s + 11 + k, 0, 72, rot);
      ink(ctx, ring, { closed: true, w: f.l(0.12), color: C.ink, shade: false, seed: s + 12 + k });
      ink(ctx, ring, { closed: true, w: f.l(0.07), color: C.steelL, shade: false, seed: s + 13 + k });
    }
  },

  // ── the second tier ───────────────────────────────────────────────────────
  optics_workshop(ctx, f, s) {
    // Lens grinding from above: the big lens on its geared turntable in the slurry basin, the
    // coral polishing arm from its violet column with the brass pad, the rack of finished lenses.
    plinth(ctx, f, C.steel, 0.05, s);
    roofTop(ctx, f, 1.22, 0.14, 1.86, 0.62, 0.46, C.steelD, s + 1);
    for (const [i, x] of [1.36, 1.54, 1.72].entries()) shape(ctx, rr(f, x - 0.075, 0.34, x + 0.075, 0.42, 0.03), mix(C.ice, C.cyan, 0.2 + i * 0.1), { w: 1, shade: false, jitter: 0, seed: s + 2 + i });
    turntableTop(ctx, f, 0.82, 0.98, 0.6, s + 5);
    lensTop(ctx, f, 0.82, 0.98, 0.44, s + 6);
    cabinetTop(ctx, f, 1.42, 1.3, 1.82, 1.74, 1.6, C.violet, s + 10);
    pipe(ctx, [f.p(1.62, 1.52), f.p(0.98, 0.84)], f.l(0.1), C.coral, s + 14);
    const pad = ellipsePts(...f.p(0.98, 0.84), f.l(0.13), f.l(0.13), s + 15, 0, 20);
    dropShadow(ctx, f, pad, 0.6, 0.25);
    shape(ctx, pad, C.brass, { w: 1.3, seed: s + 15 });
    shape(ctx, ellipsePts(...f.p(0.98, 0.84), f.l(0.07), f.l(0.07), s + 16, 0, 16), C.steelL, { w: 1, shade: false, seed: s + 16 });
  },
  scriptorium(ctx, f, s) {
    // The printing works from above: the peach canvas roll feeding the printing drum, the
    // delivery table with its printed sheets, the plotter's teal map under its gantry pen, the
    // stacks of dark codices with brass corners, the control cabinet.
    plinth(ctx, f, C.steel, 0.04, s);
    const along = (f.rot & 1) === 0 ? 'x' : 'y';
    shape(ctx, rr(f, 0.34, 1.62, 1.22, 2.37, 0.005), C.peachL, { w: 1, shade: false, jitter: 0, seed: s + 1 });
    drumTop(ctx, rr(f, 0.28, 2.12, 1.28, 2.62, 0.08), along, C.peach, s + 2, 2, f.l(0.1));
    for (const x of [0.2, 1.36]) roofTop(ctx, f, x - 0.08, 1.2, x + 0.08, 1.98, 1.45, C.violet, s + 3 + x);
    drumTop(ctx, rr(f, 0.28, 1.22, 1.28, 1.94, 0.1), along, C.steelL, s + 6, 3, f.l(0.2));
    roofTop(ctx, f, 0.32, 0.86, 1.24, 1.14, 0.62, mix(C.peachL, C.paper, 0.5), s + 7);
    shape(ctx, rr(f, 0.45, 0.9, 1.06, 1.1, 0.005), C.teal, { w: 1, shade: false, jitter: 0, seed: s + 8 });
    roofTop(ctx, f, 1.6, 0.86, 2.84, 2.3, 0.72, C.steelD, s + 10);
    const map = rr(f, 1.7, 0.96, 2.74, 2.2, 0.005);
    shape(ctx, map, C.teal, { w: 1.1, shade: false, jitter: 0, seed: s + 11 });
    ctx.save(); pathOf(ctx, map); ctx.clip();
    for (let k = 1; k <= 4; k++) {
      const pts = Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2, w = 1 + 0.18 * Math.sin(a * 3 + k); return f.p(2.14 + Math.cos(a) * 0.11 * k * w, 1.64 + Math.sin(a) * 0.12 * k * w); });
      ink(ctx, pts, { w: 1, color: k === 4 ? C.brassL : C.turqL, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 12 + k });
    }
    ctx.restore();
    for (const x of [1.62, 2.82]) pipe(ctx, [f.p(x, 0.9), f.p(x, 2.26)], f.l(0.05), C.brass, s + 20 + x, false);
    const beam = rr(f, 1.56, 1.6, 2.88, 1.72, 0.01);
    dropShadow(ctx, f, beam, 1.5, 0.22);
    shape(ctx, beam, C.coral, { w: 1.3, seed: s + 22 });
    shape(ctx, rr(f, 2.28, 1.56, 2.44, 1.76, 0.02), C.violetL, { w: 1.1, seed: s + 23 });
    roofTop(ctx, f, 0.14, 0.14, 1.06, 0.74, 0.4, C.steelD, s + 30);
    codexTop(ctx, f, 0.4, 0.44, 0.38, 0.28, s + 31, 0.8);
    codexTop(ctx, f, 0.84, 0.42, 0.38, 0.28, s + 32, 0.6);
    cabinetTop(ctx, f, 1.9, 0.14, 2.84, 0.62, 1.0, C.steelL, s + 34);
  },
  wire_mill_double(ctx, f, s) {
    // Two spool lines side by side from above, their common drive shaft and coral motor house.
    plinth(ctx, f, C.steel, 0.05, s);
    const along = (f.rot & 1) === 0 ? 'x' : 'y';
    for (const [j, cx] of [0.5, 1.5].entries()) {
      const bed = rr(f, cx - 0.38, 0.14, cx + 0.38, 1.86, 0.05);
      castShadow(ctx, bed, f.l(0.06), 0.3);
      shape(ctx, bed, j ? mix(C.teal, C.tealL, 0.25) : C.teal, { w: 1.8, seed: s + 1 + j });
      for (const [i, y] of [0.5, 1.5].entries()) {
        drumTop(ctx, rr(f, cx - 0.24, y - 0.19, cx + 0.24, y + 0.19, 0.03), along, C.brass, s + 10 + i + j * 4, 4, f.l(0.1));
        for (const x of [cx - 0.28, cx + 0.25]) shape(ctx, rr(f, x, y - 0.31, x + 0.04, y + 0.31, 0.01), C.steelL, { w: 1.2, seed: s + 20 + i + j });
      }
      shape(ctx, rr(f, cx - 0.18, 0.92, cx + 0.18, 1.08, 0.02), C.steelD, { w: 1.3, seed: s + 30 + j });
      ink(ctx, [f.p(cx, 0.62), f.p(cx, 1.38)], { w: 1.6, color: C.brassL, shade: false, taper: 0, seed: s + 31 + j });
    }
    pipe(ctx, [f.p(0.5, 1.72), f.p(1.5, 1.72)], f.l(0.06), C.steelL, s + 40, false);
    roofTop(ctx, f, 0.82, 1.56, 1.18, 1.88, 0.95, C.coral, s + 41);
    grille(ctx, rr(f, 0.88, 1.62, 1.12, 1.76, 0.01), 3, s + 42);
  },
  forge_press(ctx, f, s) {
    // The forging press from above: its deep violet crown with twin cylinders over the anvil,
    // the glowing billet showing past the ram, the columns; the brick reheating furnace and its
    // stack, the hydraulic power pack.
    plinth(ctx, f, C.steelD, 0.04, s, true);
    roofTop(ctx, f, 0.16, 2.16, 0.94, 2.84, 1.25, BRICK, s + 1);
    stack(ctx, ...f.p(0.4, 2.4), f.l(0.11), C.steelD, s + 2, C.ledWarm, f.l(0.25));
    shape(ctx, rr(f, 0.46, 2.08, 0.66, 2.16, 0.01), C.warn, { w: 1, shade: false, jitter: 0, seed: s + 3 });
    cabinetTop(ctx, f, 2.1, 2.18, 2.84, 2.82, 1.05, C.teal, s + 4);
    pipe(ctx, [f.p(2.2, 2.3), f.p(2.2, 1.7), f.p(2.4, 1.6)], f.l(0.05), C.coral, s + 8);
    roofTop(ctx, f, 0.62, 1.06, 2.38, 1.94, 0.9, C.steelL, s + 10);
    shape(ctx, rr(f, 0.66, 1.84, 2.34, 1.9, 0.005), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 11 });
    const b = f.p(1.5, 1.5);
    flat(ctx, ellipsePts(b[0], b[1], f.l(0.5), f.l(0.32), s + 12, 0, 20), C.ledWarm, 0.3);
    shape(ctx, rr(f, 1.22, 1.34, 1.78, 1.66, 0.02), C.glowPeach, { w: 1.2, seed: s + 13 });
    for (const xa of [0.42, 2.16]) roofTop(ctx, f, xa, 1.2, xa + 0.42, 1.8, 3.0, C.violet, s + 14 + xa);
    const crown = rr(f, 0.36, 1.12, 2.64, 1.38, 0.03);
    dropShadow(ctx, f, crown, 3.6, 0.26);
    shape(ctx, crown, C.violet, { w: 1.8, seed: s + 16 });
    grille(ctx, rr(f, 0.45, 1.16, 0.95, 1.34, 0.01), 3, s + 17);
    for (const dx of [-0.32, 0.32]) {
      const c = ellipsePts(...f.p(1.5 + dx, 1.25), f.l(0.16), f.l(0.16), s + 18, 0, 20);
      shape(ctx, c, C.brass, { w: 1.2, seed: s + 18 });
    }
    ledStrip(ctx, f.p(1.95, 1.2), f.p(2.5, 1.2), 3, f.l(0.025), [C.ledWarm, C.led], s + 19);
  },
  arc_furnace(ctx, f, s) {
    // The arc furnace from above: the refractory vessel under its domed lid, three graphite
    // electrodes glowing at their feet on arms from the mast, heavy cables from the finned
    // transformer, the pour spout glowing at the front.
    plinth(ctx, f, C.steelD, 0.05, s, true);
    roofTop(ctx, f, 1.3, 0.16, 1.88, 0.86, 1.15, C.violet, s + 1);
    for (const x of [1.45, 1.73]) shape(ctx, ellipsePts(...f.p(x, 0.5), f.l(0.08), f.l(0.08), s + 2, 0, 14), C.ice, { w: 1, shade: false, seed: s + 2 });
    roofTop(ctx, f, 1.5, 1.4, 1.86, 1.8, 2.3, C.steel, s + 3);
    const c = f.p(0.82, 1.0);
    const shell = ellipsePts(c[0], c[1], f.l(0.66), f.l(0.66), s + 4, 0.003, 40);
    castShadow(ctx, shell, f.l(0.14), 0.3);
    shape(ctx, shell, BRICK, { w: 1.8, seed: s + 4 });
    shape(ctx, ellipsePts(c[0], c[1], f.l(0.6), f.l(0.6), s + 5, 0.003, 40), C.steelD, { w: 1.3, seed: s + 5 });
    shape(ctx, ellipsePts(c[0] - 1, c[1] - 1, f.l(0.34), f.l(0.34), s + 6, 0.003, 32), C.steel, { w: 1.1, shade: false, seed: s + 6 });
    shape(ctx, rr(f, 0.72, 0.12, 0.92, 0.42, 0.02), C.steelD, { w: 1.2, seed: s + 7 });
    ink(ctx, [f.p(0.82, 0.38), f.p(0.82, 0.16)], { w: f.l(0.07), color: C.warn, shade: false, taper: 0, jitter: 0, seed: s + 8 });
    light(ctx, ...f.p(0.82, 0.18), f.l(0.04), C.ledWarm);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5, ex = 0.82 + Math.cos(a) * 0.15, ey = 1.0 + Math.sin(a) * 0.15;
      pipe(ctx, [f.p(1.62, 1.55), f.p(ex, ey)], f.l(0.055), C.steelL, s + 10 + k, false);
      const e = f.p(ex, ey);
      flat(ctx, ellipsePts(e[0], e[1], f.l(0.11), f.l(0.11), s + 14 + k, 0, 14), C.ledWarm, 0.35);
      shape(ctx, ellipsePts(e[0], e[1], f.l(0.06), f.l(0.06), s + 17 + k, 0, 14), mix(C.steelDD, C.steel, 0.35), { w: 1.2, shade: false, seed: s + 17 + k });
    }
    cable(ctx, f.p(1.6, 0.6), f.p(1.62, 1.45), f.l(0.06), 0.15, C.steelDD, s + 20);
    cable(ctx, f.p(1.75, 0.5), f.p(1.78, 1.5), f.l(0.06), 0.15, C.steelDD, s + 21);
  },
  electric_smelter(ctx, f, s) {
    // The induction furnace from above (D106): the crucible's ring of copper coil under its dark
    // yokes, the ceramic mouth and the melt glowing in it, the pour lip at the front; the teal
    // inverter cabinet with its cable gland under the terminal; the copper bus bars on porcelain
    // stand-offs to the coil; the capacitor cans by the intake. Cyan arcs while it works.
    plinth(ctx, f, ES_SLAB, 0.05, s);
    const { x: px, y: py, r } = ES_POT;
    cabinetTop(ctx, f, 1.38, 0.14, 1.88, 0.98, ES_CAB_Z, C.teal, s + 1);
    const g = f.p(1.56, 0.72);
    shape(ctx, ellipsePts(g[0], g[1], f.l(0.075), f.l(0.075), s + 2, 0, 14), C.brass, { w: 1.1, shade: false, seed: s + 2 });
    cable(ctx, f.p(1.74, 0.3), g, f.l(0.07), 0.12, C.steelDD, s + 3);
    // The capacitor bank.
    roofTop(ctx, f, 1.26, 1.46, 1.9, 1.88, 0.44, C.steelDD, s + 4);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
      const c = f.p(1.38 + i * 0.2, 1.56 + j * 0.2), R = f.l(0.07);
      castShadow(ctx, ellipsePts(c[0], c[1], R, R, s + 5, 0, 12), f.l(0.06), 0.3);
      shape(ctx, ellipsePts(c[0], c[1], R, R, s + 5 + i + j * 3, 0, 12), CAN_L, { w: 1, shade: false, seed: s + 5 });
    }
    ink(ctx, [f.p(1.36, 1.66), f.p(1.8, 1.66)], { w: f.l(0.035), color: C.brass, shade: false, taper: 0, jitter: 0, seed: s + 12 });
    // The bus bars on their stand-offs.
    for (const [k, d] of [0, 1].entries()) pipe(ctx, [f.p(1.62 - d * 0.06, 0.98), f.p(1.62 - d * 0.06, 1.32 - d * 0.06), f.p(px + 0.38 - d * 0.04, 1.32 - d * 0.06)], f.l(0.05), COPPER, s + 13 + k, false);
    for (const [x, y] of [[1.62, 1.32], [1.62, 1.04]] as const) {
      const c = f.p(x, y);
      shape(ctx, ellipsePts(c[0], c[1], f.l(0.07), f.l(0.07), s + 16, 0, 12), C.ice, { w: 1, shade: false, seed: s + 16 });
      flat(ctx, ellipsePts(c[0], c[1], f.l(0.03), f.l(0.03), s + 17, 0, 8), C.brassL);
    }
    // The crucible: coil ring, yokes, collar, ceramic mouth, melt; the lip towards the outlet.
    const c = f.p(px, py), R = f.l(r);
    const outer = ellipsePts(c[0], c[1], R, R, s + 20, 0.003, 40);
    dropShadow(ctx, f, outer, 1.24, 0.3);
    shape(ctx, outer, COPPER, { w: 1.8, seed: s + 20 });
    for (let i = 0; i < 3; i++) ink(ctx, ellipsePts(c[0], c[1], R * (0.94 - i * 0.05), R * (0.94 - i * 0.05), s + 21 + i, 0, 40), { closed: true, w: 0.9, color: mix(COPPER, C.ink, 0.45), alpha: 0.8, shade: false, jitter: 0, seed: s + 21 + i });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      ink(ctx, [[c[0] + Math.cos(a) * R * 0.8, c[1] + Math.sin(a) * R * 0.8], [c[0] + Math.cos(a) * R * 1.04, c[1] + Math.sin(a) * R * 1.04]], { w: f.l(0.09), color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 25 + k });
    }
    shape(ctx, ellipsePts(c[0], c[1], R * 0.86, R * 0.86, s + 34, 0.003, 36), C.steelD, { w: 1.3, seed: s + 34 });
    const lip = [f.p(px - 0.1, py - r + 0.1), f.p(px + 0.1, py - r + 0.1), f.p(px + 0.06, py - r - 0.12), f.p(px - 0.06, py - r - 0.12)];
    shape(ctx, lip, ES_CERAMIC, { w: 1.2, seed: s + 35 });
    shape(ctx, ellipsePts(c[0], c[1], R * 0.82, R * 0.82, s + 36, 0.003, 36), ES_CERAMIC, { w: 1.2, shade: false, seed: s + 36 });
    shape(ctx, ellipsePts(c[0], c[1], R * 0.72, R * 0.72, s + 37, 0.004, 32), C.ledWarm, { w: 1.3, shade: false, seed: s + 37 });
    flat(ctx, ellipsePts(c[0] - R * 0.1, c[1] + R * 0.06, R * 0.3, R * 0.27, s + 38, 0.01, 24), C.glowPeach);
    for (const [dx, dy] of [[-0.42, -0.28], [0.3, 0.36], [0.46, -0.26]] as const) flat(ctx, ellipsePts(c[0] + dx * R, c[1] + dy * R, f.l(0.045), f.l(0.028), s + 39, 0, 10), mix(C.coralD, C.ink, 0.3), 0.85);
    if (!isUnlit(ctx)) {
      sparkIso(ctx, [c[0] - R * 0.6, c[1] + R * 0.15], [c[0] + R * 0.05, c[1] - R * 0.35], 5, s + 41);
      sparkIso(ctx, [c[0] + R * 0.05, c[1] - R * 0.3], [c[0] + R * 0.6, c[1] + R * 0.2], 4, s + 42);
      for (const [k, d] of [0, 1].entries()) sparkIso(ctx, f.p(px + 0.38 - d * 0.04, 1.32 - d * 0.06), f.p(px + 0.2, py + 0.4 - d * 0.04), 4, s + 43 + k);
    }
  },
  etcher(ctx, f, s) {
    // The etching line from above: the long sealed hood's ribbed roof with its ridge duct to the
    // scrubber stack, violet UV glow at its windows, the load locks over the intakes, the wafer
    // racks by the outlet, the control cabinet.
    plinth(ctx, f, C.steel, 0.04, s);
    for (const [i, x] of [0.5, 2.5].entries()) {
      roofTop(ctx, f, x - 0.3, 2.42, x + 0.3, 2.84, 0.82, LAB, s + 1 + i);
      shape(ctx, rr(f, x - 0.25, 2.47, x + 0.25, 2.53, 0.005), C.violet, { w: 0.8, shade: false, jitter: 0, seed: s + 3 + i });
    }
    for (const x of [0.58, 2.42]) for (let k = 0; k < 4; k++) {
      const y = 0.45 + k * 0.52;
      flat(ctx, rr(f, x - 0.06, y, x + 0.06, y + 0.34, 0.01), C.violetL, 0.5);
    }
    const hood = rr(f, 0.62, 0.3, 2.38, 2.6, 0.04);
    dropShadow(ctx, f, hood, 1.6, 0.28);
    vault(ctx, rr(f, 0.68, 0.34, 2.32, 2.56, 0.04), C.ice, 6, (f.rot & 1) === 0 ? 'y' : 'x', s + 10);
    ink(ctx, hood, { closed: true, w: 1.8, seed: s + 11 });
    pipe(ctx, [f.p(1.5, 0.5), f.p(1.5, 2.2), f.p(2.62, 2.2)], f.l(0.11), C.steelL, s + 12);
    stack(ctx, ...f.p(2.66, 2.2), f.l(0.16), C.steelL, s + 13, undefined, f.l(0.35));
    for (const x of [0.36, 2.64]) {
      roofTop(ctx, f, x - 0.2, 0.4, x + 0.2, 0.8, 1.1, C.steelD, s + 20 + x);
      shape(ctx, ellipsePts(...f.p(x, 0.6), f.l(0.15), f.l(0.15), s + 22, 0, 24), mix(C.ice, C.violetL, 0.3), { w: 1, shade: false, seed: s + 22 });
      ink(ctx, [f.p(x - 0.08, 0.62), f.p(x, 0.52)], { w: 1.4, color: '#ffffff', alpha: 0.8, shade: false, taper: 0.3, jitter: 0, seed: s + 23 });
    }
    cabinetTop(ctx, f, 2.48, 1.02, 2.86, 1.9, 1.15, C.violet, s + 30);
  },
  chip_fab(ctx, f, s) {
    // The chip fab from above: the big white hall's roof edged in violet, its air handlers and
    // fans, the ducts to the tall exhaust filter tower, the load locks over the intakes.
    plinth(ctx, f, C.steel, 0.04, s);
    for (const [i, x] of [1.5, 2.5].entries()) {
      roofTop(ctx, f, x - 0.32, 3.42, x + 0.32, 3.86, 0.85, LAB, s + 1 + i);
      shape(ctx, rr(f, x - 0.27, 3.47, x + 0.27, 3.53, 0.005), C.violet, { w: 0.8, shade: false, jitter: 0, seed: s + 3 + i });
    }
    roofTop(ctx, f, 0.2, 0.3, 3.04, 3.4, 2.05, LAB, s + 5);
    ink(ctx, rr(f, 0.25, 0.35, 2.99, 3.35, 0.03), { closed: true, w: f.l(0.05), color: C.violetL, shade: false, taper: 0, jitter: 0, seed: s + 6 });
    for (const [i, [x, y]] of ([[0.75, 0.9], [1.6, 0.9], [0.75, 2.6], [1.6, 2.6]] as const).entries()) {
      roofTop(ctx, f, x - 0.32, y - 0.32, x + 0.32, y + 0.32, 0.4, C.steelL, s + 10 + i * 3);
      fanTop(ctx, f, x, y, 0.22, s + 11 + i * 3);
    }
    pipe(ctx, [f.p(2.45, 2.6), f.p(2.45, 0.9), f.p(3.45, 0.9)], f.l(0.13), C.steelL, s + 30);
    pipe(ctx, [f.p(1.95, 1.75), f.p(2.45, 1.75)], f.l(0.1), C.steelL, s + 31);
    ledStrip(ctx, f.p(0.5, 3.2), f.p(1.3, 3.2), 6, f.l(0.025), [C.led, C.ledGreen], s + 32);
    const t = f.p(3.5, 0.85);
    const tower = ellipsePts(t[0], t[1], f.l(0.38), f.l(0.38), s + 33, 0.003, 32);
    dropShadow(ctx, f, tower, 4.7, 0.24);
    shape(ctx, tower, C.steelL, { w: 1.8, seed: s + 33 });
    ink(ctx, ellipsePts(t[0], t[1], f.l(0.33), f.l(0.33), s + 34, 0, 28), { closed: true, w: f.l(0.04), color: C.violet, shade: false, taper: 0, seed: s + 34 });
    flat(ctx, ellipsePts(t[0] + 1, t[1] + 1, f.l(0.22), f.l(0.22), s + 35, 0, 24), C.ink);
    light(ctx, t[0] + f.l(0.28), t[1] - f.l(0.05), f.l(0.035), C.ledRed);
  },
  sifter(ctx, f, s) {
    // The vibrating screen from above: the mesh deck over the hopper of sifted sand, its springs
    // at the corners and the coral vibrator on its flank; heaps of sand and ore grains beside.
    plinth(ctx, f, C.steel, 0.05, s);
    heapTop(ctx, f, 1.62, 0.55, 0.28, SANDFILL, s + 1);
    heapTop(ctx, f, 1.63, 1.45, 0.27, mix(C.mesa, '#9b5a3c', 0.55), s + 2, C.ink);
    const outer = rr(f, 0.36, 0.2, 1.08, 0.66, 0.02);
    dropShadow(ctx, f, outer, 0.8, 0.24);
    shape(ctx, outer, OCHRE_L, { w: 1.4, seed: s + 3 });
    flat(ctx, rr(f, 0.44, 0.26, 1.0, 0.6, 0.01), C.ink);
    flat(ctx, ellipsePts(...f.p(0.72, 0.43), f.l(0.22), f.l(0.12), s + 4, 0.05, 20, f.rot & 1 ? Math.PI / 2 : 0), SANDFILL);
    const deck = rr(f, 0.2, 0.62, 1.24, 1.82, 0.01);
    dropShadow(ctx, f, deck, 1.6, 0.24);
    flat(ctx, deck, mix(SANDFILL, C.ink, 0.12));
    ctx.save();
    ctx.strokeStyle = mix(C.teal, C.ink, 0.5); ctx.lineWidth = 0.8; ctx.globalAlpha = 0.8;
    for (let i = 1; i < 12; i++) { const x = 0.2 + (1.04 * i) / 12; const [a, b] = [f.p(x, 0.64), f.p(x, 1.8)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (let j = 1; j < 9; j++) { const y = 0.62 + (1.2 * j) / 9; const [a, b] = [f.p(0.22, y), f.p(1.22, y)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.restore();
    const rng = makeRng(s + 5);
    for (let k = 0; k < 16; k++) { const p = f.p(0.3 + rng.next() * 0.84, 0.7 + rng.next() * 1.0); flat(ctx, ellipsePts(p[0], p[1], 2, 2, s + k, 0.2, 8), k % 3 ? SANDFILL : mix(C.mesa, '#9b5a3c', 0.6)); }
    ink(ctx, deck, { closed: true, w: 1.6, seed: s + 6 });
    for (const x of [0.2, 1.24]) ink(ctx, [f.p(x, 0.62), f.p(x, 1.82)], { w: f.l(0.05), color: C.teal, shade: false, taper: 0, jitter: 0, seed: s + 7 });
    roofTop(ctx, f, 1.24, 0.92, 1.44, 1.22, 1.6, C.coral, s + 8);
  },
  fast_drill(ctx, f, s) {
    // The beefier drill from above: two derricks over their geared tables, the gearbox banded
    // in coral with its twin motor drums.
    plinth(ctx, f, C.steel, 0.05, s, true);
    const gb = rr(f, 0.14, 1.12, 1.86, 1.86, 0.06);
    castShadow(ctx, gb, f.l(0.1), 0.3);
    shape(ctx, gb, C.steel, { w: 2, seed: s + 1 });
    shape(ctx, rr(f, 0.14, 1.12, 1.86, 1.24, 0.02), C.coral, { w: 1.2, shade: false, seed: s + 2 });
    for (const [i, x] of [0.62, 1.3].entries()) drumTop(ctx, rr(f, x - 0.26, 1.36, x + 0.26, 1.64, 0.04), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 3 + i, 2, f.l(0.06));
    ledStrip(ctx, f.p(0.3, 1.78), f.p(0.75, 1.78), 4, f.l(0.03), LEDS, s + 5);
    for (const [i, x] of [0.5, 1.42].entries()) {
      pipe(ctx, [f.p(x, 1.2), f.p(x, 0.94)], f.l(0.07), C.steelD, s + 6 + i);
      rotaryTop(ctx, f, x, 0.64, 0.3, s + 8 + i);
      derrickTop(ctx, f, x, 0.64, 0.3, 0.07, 3.0, s + 10 + i * 5, C.steelL);
      shape(ctx, rr(f, x - 0.09, 0.55, x + 0.09, 0.73, 0.01), C.coral, { w: 1.1, seed: s + 20 + i });
    }
  },
  giant_drill(ctx, f, s) {
    // The giant rig from above: its armoured drill floor, the towering derrick over the geared
    // table, the draw-works drum, the pipe rack, the two coral power houses and their stacks.
    plinth(ctx, f, C.steelD, 0.04, s, true);
    for (const [i, x] of [3.54, 3.6, 3.66, 3.72, 3.78].entries()) drumTop(ctx, rr(f, x - 0.03, 0.45, x + 0.03, 2.95, 0.02), (f.rot & 1) === 0 ? 'y' : 'x', i % 2 ? C.steelL : C.ice, s + 1 + i, 0, f.l(0.05));
    for (const [i, x0] of [0.18, 2.32].entries()) {
      roofTop(ctx, f, x0, 3.16, x0 + 1.3, 3.86, 1.35, C.coral, s + 10 + i * 4);
      grille(ctx, rr(f, x0 + 0.1, 3.26, x0 + 0.75, 3.56, 0.02), 3.2, s + 11 + i * 4);
      stack(ctx, ...f.p(x0 + 1.02, 3.42), f.l(0.14), C.steelD, s + 12 + i * 4, C.ledWarm, f.l(0.4));
    }
    roofTop(ctx, f, 0.3, 0.42, 3.3, 2.96, 1.2, C.steel, s + 20);
    shape(ctx, rr(f, 0.34, 2.84, 3.26, 2.92, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 21 });
    drumTop(ctx, rr(f, 1.18, 2.26, 2.42, 2.74, 0.06), (f.rot & 1) === 0 ? 'x' : 'y', C.brass, s + 22, 4, f.l(0.12));
    roofTop(ctx, f, 0.52, 2.2, 0.98, 2.8, 1.75, C.violet, s + 23);
    rotaryTop(ctx, f, 1.8, 1.42, 0.56, s + 24);
    derrickTop(ctx, f, 1.8, 1.42, 1.0, 0.2, 6.4, s + 25);
    shape(ctx, rr(f, 1.56, 1.18, 2.04, 1.66, 0.02), C.coral, { w: 1.6, seed: s + 30 });
    light(ctx, ...f.p(1.8, 1.42), f.l(0.05), C.ledRed);
  },
  hp_pump(ctx, f, s) {
    // The bigger pump from above: the brimming chalice at the outlet, the banded pressure vessel
    // and its gauge, the teal motor, the pipes between them.
    plinth(ctx, f, C.steel, 0.05, s);
    cabinetTop(ctx, f, 0.14, 1.12, 0.86, 1.86, 0.9, C.teal, s + 1);
    drumTop(ctx, rr(f, 0.38, 1.26, 0.62, 1.74, 0.04), (f.rot & 1) === 0 ? 'y' : 'x', C.steelL, s + 4, 2, f.l(0.08));
    pipe(ctx, [f.p(0.86, 1.4), f.p(1.15, 1.25)], f.l(0.08), C.steelL, s + 5);
    drumTop(ctx, rr(f, 1.08, 0.36, 1.76, 1.68, 0.3), (f.rot & 1) === 0 ? 'y' : 'x', mix(C.ice, C.tealL, 0.25), s + 6, 3, f.l(0.2));
    const g = f.p(1.42, 1.02);
    shape(ctx, ellipsePts(g[0], g[1], f.l(0.13), f.l(0.13), s + 7, 0, 20), C.steelD, { w: 1.2, shade: false, seed: s + 7 });
    flat(ctx, ellipsePts(g[0], g[1], f.l(0.095), f.l(0.095), s + 8, 0, 20), C.paper);
    ink(ctx, [[g[0], g[1]], [g[0] + f.l(0.07), g[1] - f.l(0.04)]], { w: 1.4, color: C.coral, shade: false, taper: 0, jitter: 0, seed: s + 9 });
    pipe(ctx, [f.p(1.25, 0.5), f.p(0.66, 0.5)], f.l(0.1), C.coral, s + 10);
    const k = f.p(0.5, 0.48);
    const cup = ellipsePts(k[0], k[1], f.l(0.44), f.l(0.44), s + 11, 0.003, 40);
    castShadow(ctx, cup, f.l(0.18), 0.3);
    shape(ctx, cup, C.tealL, { w: 1.8, seed: s + 11 });
    flat(ctx, ellipsePts(k[0] + 1, k[1] + 1, f.l(0.35), f.l(0.35), s + 12, 0, 36), C.deep);
    ink(ctx, ellipsePts(k[0] + 2, k[1] + 2, f.l(0.2), f.l(0.2), s + 13, 0.05, 28), { closed: true, w: 1.2, color: C.shallow, shade: false, seed: s + 13 });
  },
  heavy_excavator(ctx, f, s) {
    // The heavier excavator from above: the crawler tracks, the turret banded in hazard stripes
    // with its heavy counterweight and twin exhausts, the thick coral boom, the bucket wheel.
    plinth(ctx, f, C.steel, 0.04, s, true);
    for (const x of [0.45, 2.55]) {
      const tr = rr(f, x - 0.27, 0.92, x + 0.27, 2.88, 0.06);
      castShadow(ctx, tr, f.l(0.08), 0.3);
      shape(ctx, tr, C.steelDD, { w: 1.8, seed: s + x * 10 });
      ctx.save();
      ctx.strokeStyle = C.steel; ctx.lineWidth = 1.6;
      for (let i = 1; i < 14; i++) { const y = 0.92 + (1.96 * i) / 14; const [a, b] = [f.p(x - 0.24, y), f.p(x + 0.24, y)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.restore();
    }
    roofTop(ctx, f, 0.72, 1.28, 2.28, 2.44, 1.82, C.violet, s + 1);
    shape(ctx, rr(f, 0.72, 2.32, 2.28, 2.44, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 2 });
    grille(ctx, rr(f, 1.6, 1.45, 2.1, 1.8, 0.02), 3.2, s + 3);
    hatchDoor(ctx, rr(f, 0.95, 1.45, 1.3, 1.8, 0.02), s + 4);
    roofTop(ctx, f, 0.74, 2.44, 2.26, 2.86, 1.62, C.steelD, s + 5);
    shape(ctx, rr(f, 0.8, 2.74, 2.2, 2.82, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 6 });
    for (const [i, x] of [2.02, 1.78].entries()) stack(ctx, ...f.p(x, 1.68), f.l(0.1 - i * 0.02), C.steelD, s + 7 + i, C.ledWarm, f.l(0.25));
    ledStrip(ctx, f.p(0.9, 2.2), f.p(1.4, 2.2), 5, f.l(0.03), [C.ledWarm, C.ledRed], s + 9);
    for (const x of [0.95, 2.05]) pipe(ctx, [f.p(x, 1.42), f.p(x, 0.6)], f.l(0.13), C.coral, s + 10 + x);
    bucketWheelTop(ctx, f, 1.5, 0.52, 0.98, 0.2, 'x', 10, 0.2, C.steelL, s + 12, { bucket: C.brass, load: mix(C.dug, C.mesa, 0.3), full: bucketFull });
  },
  big_silo(ctx, f, s) {
    // Three store tanks from above, their roofs joined by walkways to the head house.
    plinth(ctx, f, C.steel, 0.04, s);
    const tanks = [[0.82, 0.84], [2.18, 0.84], [1.5, 2.12]] as const;
    for (const [i, [x, y]] of tanks.entries()) siloTop(ctx, f, x, y, 0.6, 3.2, s + 10 + i * 5);
    for (const [i, [x, y]] of tanks.entries()) pipe(ctx, [f.p(x + (1.5 - x) * 0.45, y + (1.27 - y) * 0.45), f.p(1.5, 1.27)], f.l(0.06), C.steelL, s + 30 + i, false);
    roofTop(ctx, f, 1.28, 1.07, 1.72, 1.47, 3.4, C.steelD, s + 40);
    light(ctx, ...f.p(1.5, 1.27), f.l(0.05), C.coral);
    ledStrip(ctx, f.p(0.3, 2.85), f.p(0.9, 2.85), 4, f.l(0.03), LEDS, s + 41);
  },
  heavy_accumulator(ctx, f, s) {
    // The heavier capacitor bank from above: four fat cans with double charge rings and twin
    // brass posts, heavy bus bars to the coral junction over the middle.
    plinth(ctx, f, C.steelD, 0.05, s);
    const cells = [[0.55, 0.55, C.violet], [1.45, 0.55, C.violetL], [0.55, 1.45, C.violetL], [1.45, 1.45, C.violet]] as const;
    for (const [i, [x, y, col]] of cells.entries()) {
      const p = f.p(x, y);
      tankTop(ctx, p[0], p[1], f.l(0.42), col, s + i * 5, { shadow: f.l(0.22), ribs: 0 });
      for (const r of [0.36, 0.3]) ink(ctx, ellipsePts(p[0], p[1], f.l(r), f.l(r), s + 20 + i, 0, 32), { closed: true, w: 2.2, color: C.ledGreen, shade: false, seed: s + 20 + i });
      for (const d of [-0.11, 0.11]) shape(ctx, ellipsePts(...f.p(x + d, y - d), f.l(0.055), f.l(0.055), s + 30 + i, 0, 12), C.brassL, { w: 1, shade: false, seed: s + 30 + i });
    }
    for (const [i, [x, y]] of cells.entries()) pipe(ctx, [f.p(x, y), f.p(1, 1)], f.l(0.07), C.brass, s + 40 + i, false);
    const j = rr(f, 0.84, 0.84, 1.16, 1.16, 0.02);
    dropShadow(ctx, f, j, 1.9, 0.26);
    shape(ctx, j, C.coral, { w: 1.4, seed: s + 50 });
    ledStrip(ctx, f.p(0.25, 1.92), f.p(0.95, 1.92), 6, f.l(0.03), [C.ledGreen, C.ledGreen, C.ledGreen, C.ledGreen, C.led, C.ledWarm], s + 51);
  },
  solar_farm(ctx, f, s) {
    // Rows of solar panels from above (their cells are `pvPanel`'s), the inverter in the corner.
    plinth(ctx, f, C.steel, 0.04, s);
    const rows = [[0.16, 0.14, 2.84, 0.6, 4], [0.16, 0.84, 2.84, 1.3, 4], [0.16, 1.54, 2.84, 2.0, 4], [0.16, 2.26, 2.12, 2.72, 3]] as const;
    for (const [i, [x0, y0, x1, y1, n]] of rows.entries()) {
      castShadow(ctx, rr(f, x0, y0, x1, y1, 0.01), f.l(0.08), 0.22);
      pvPanel(ctx, [f.p(x0, y0), f.p(x1, y0), f.p(x1, y1), f.p(x0, y1)], n * 3, 2, s + 10 + i * 20);
      for (let k = 1; k < n; k++) ink(ctx, [f.p(x0 + ((x1 - x0) * k) / n, y0), f.p(x0 + ((x1 - x0) * k) / n, y1)], { w: 2, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: s + 15 + i });
    }
    cabinetTop(ctx, f, 2.3, 2.26, 2.86, 2.86, 0.95, C.teal, s + 100);
  },
  solar_tower(ctx, f, s) {
    // The heliostat field from above: mirrors in rings leaning to the tower, the tower's long
    // shadow, its glowing receiver ring and cap, the power block at its foot.
    plinth(ctx, f, C.steel, 0.04, s);
    const spots: Array<[number, number]> = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.39; spots.push([2 + Math.cos(a) * 1.16, 2 + Math.sin(a) * 1.16]); }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.13; spots.push([2 + Math.cos(a) * 1.68, 2 + Math.sin(a) * 1.68]); }
    for (const p of [[0.42, 0.42], [3.58, 0.42], [0.42, 3.58], [3.58, 3.58]] as const) spots.push([p[0], p[1]]);
    const c = f.p(2, 2);
    ink(ctx, [c, [c[0] + f.l(0.11 * 5.6 * 0.7), c[1] + f.l(0.11 * 5.6)]], { w: f.l(0.4), color: C.inkSoft, alpha: 0.24, shade: false, taper: 0.5, jitter: 0, seed: s });
    for (const [i, [x, y]] of spots.entries()) heliostatTop(ctx, f, x, y, 2, 2, s + 10 + i * 3);
    cabinetTop(ctx, f, 1.52, 1.52, 2.48, 2.48, 0.9, C.steelL, s + 100);
    flat(ctx, ellipsePts(c[0], c[1], f.l(0.62), f.l(0.62), s + 102, 0, 28), C.ledWarm, 0.18);
    shape(ctx, ellipsePts(c[0], c[1], f.l(0.32), f.l(0.32), s + 103, 0, 28), C.warn, { w: 1.4, shade: false, seed: s + 103 });
    ink(ctx, ellipsePts(c[0], c[1], f.l(0.3), f.l(0.3), s + 104, 0, 28), { closed: true, w: 2, color: C.glowPeach, shade: false, taper: 0, seed: s + 104 });
    shape(ctx, ellipsePts(c[0], c[1], f.l(0.2), f.l(0.2), s + 105, 0, 24), C.steelD, { w: 1.3, seed: s + 105 });
    light(ctx, c[0], c[1], f.l(0.045), C.ledRed);
  },
  cell_generator(ctx, f, s) {
    // The battery generator from above: the magazine of charged cells glowing cyan, the loader
    // with a cell on its way, the generator's banded housing, the finned exciter cabinet.
    plinth(ctx, f, C.steelD, 0.05, s);
    roofTop(ctx, f, 0.14, 1.1, 1.86, 1.86, 0.52, C.steelD, s + 1);
    shape(ctx, rr(f, 0.18, 1.76, 1.82, 1.82, 0.005), C.hazard, { w: 0.8, shade: false, jitter: 0, seed: s + 2 });
    for (const [j, y] of [1.3, 1.66].entries()) for (const [i, x] of [0.4, 0.8, 1.2, 1.6].entries()) {
      const p = f.p(x, y);
      tankTop(ctx, p[0], p[1], f.l(0.14), C.ice, s + 10 + i + j * 4, { shadow: f.l(0.1), ribs: 0, rim: C.brassL });
      ink(ctx, ellipsePts(p[0], p[1], f.l(0.155), f.l(0.155), s + 20 + i, 0, 20), { closed: true, w: 2, color: C.led, shade: false, seed: s + 20 + i });
    }
    roofTop(ctx, f, 0.24, 0.24, 1.5, 0.92, 0.42, C.steelD, s + 30);
    drumTop(ctx, rr(f, 0.26, 0.26, 1.46, 0.9, 0.12), (f.rot & 1) === 0 ? 'x' : 'y', C.steelL, s + 31, 5, f.l(0.16));
    const p = f.p(0.86, 0.94);
    tankTop(ctx, p[0], p[1], f.l(0.11), C.ice, s + 32, { shadow: f.l(0.08), ribs: 0, rim: C.brassL });
    ink(ctx, ellipsePts(p[0], p[1], f.l(0.12), f.l(0.12), s + 33, 0, 20), { closed: true, w: 2, color: C.led, shade: false, seed: s + 33 });
    cabinetTop(ctx, f, 1.54, 0.2, 1.88, 0.96, 1.2, C.violet, s + 40);
  },

  trade_post(ctx, f, s) {
    // CrierBelt's cargo lift pad (as the iso art, recipes/buildings.ts): the scorched apron its
    // drones' flames keep clear round the pad (D62), the two flame-proof ribbons across it — the
    // entrance in, the exit out —, and on the pad its hazard edge, the raised round deck (hazard
    // ring, landing lights, the lift's shut iris), a lamp post on three corners, the power
    // pedestal on the fourth, and the hoods where the ribbons dive in and come out.
    scorchTop(ctx, f, s + 100);
    for (const io of ['in', 'out'] as const) tpRibbonTop(ctx, f, io, s + (io === 'in' ? 140 : 160));
    const [X0, Y0, X1] = TP_PAD;
    plinth(ctx, f, C.steel, 0.04, s, false, TP_PAD);
    for (const [a, b] of [[X0 + 0.18, 2.06], [2.94, X1 - 0.18]] as const) {
      const band = rr(f, a, Y0 + 0.1, b, Y0 + 0.22, 0.02);
      flat(ctx, band, C.hazard);
      ctx.save(); pathOf(ctx, band); ctx.clip();
      hatch(ctx, band, Math.PI / 4, f.l(0.12), { w: f.l(0.05), alpha: 0.85, seed: s + a * 10 });
      ctx.restore();
    }
    for (const io of ['in', 'out'] as const) tpHoodTop(ctx, f, io, s + (io === 'in' ? 50 : 60));
    const c = f.p(...TP_DECK);
    const deck = ellipsePts(c[0], c[1], f.l(TP_DECK_R), f.l(TP_DECK_R), s + 1, 0.003, 64);
    castShadow(ctx, deck, f.l(0.1), 0.32);
    shape(ctx, deck, C.steel, { w: 2, seed: s + 1 });
    ink(ctx, ellipsePts(c[0], c[1], f.l(0.78), f.l(0.78), s + 2, 0, 56), { closed: true, w: f.l(0.06), color: C.hazard, shade: false, seed: s + 2 });
    flat(ctx, ellipsePts(c[0], c[1], f.l(0.62), f.l(0.62), s + 3, 0, 48), C.steelDD);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2, r = f.l(0.62);
      flat(ctx, [[c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], [c[0] + Math.cos(a1 + 0.5) * r * 0.12, c[1] + Math.sin(a1 + 0.5) * r * 0.12]], i % 2 ? C.steel : mix(C.steel, C.steelL, 0.35));
    }
    ink(ctx, ellipsePts(c[0], c[1], f.l(0.62), f.l(0.62), s + 4, 0, 48), { closed: true, w: f.l(0.03), shade: false, seed: s + 4 });
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; light(ctx, c[0] + Math.cos(a) * f.l(0.9), c[1] + Math.sin(a) * f.l(0.9), f.l(0.035), i % 2 ? C.led : C.ledWarm); }
    for (const [x, y] of TP_LAMPS) {
      shape(ctx, ellipsePts(...f.p(x, y), f.l(0.09), f.l(0.09), s + 5, 0, 16), C.steelD, { w: 1.2, shade: false, seed: s + 5 });
      light(ctx, ...f.p(x, y), f.l(0.045), C.ledWarm);
    }
    const [px, py] = TP_PED;
    const ped = rr(f, px, py, px + 0.4, py + 0.4, 0.03);
    castShadow(ctx, ped, f.l(0.12), 0.3);
    shape(ctx, ped, C.teal, { w: 1.4, seed: s + 8 });
    light(ctx, ...f.p(px + 0.09, py + 0.09), f.l(0.035), C.ledGreen);
  },
};

/**
 * The trade post's scorched apron from above (the iso art's marks, `apronMarks`): baked earth at
 * the edge, ragged burns darker towards the pad, blast streaks, soot, cracks with a pale lip,
 * fused glass, embers, the half-burnt keep-out line.
 */
function scorchTop(ctx: Ctx, f: Frame, s: number): void {
  const m = apronMarks();
  const [cx, cy] = TP_DECK;
  const foot = rr(f, 0.03, 0.03, 4.97, 4.97, 0.02);
  flat(ctx, foot, SCORCH.baked);
  ctx.save(); pathOf(ctx, foot); ctx.clip();
  for (const b of m.burns) flat(ctx, burnPts(b.r).map(([x, y]) => f.p(x, y)), SCORCH[b.tone], b.alpha);
  for (const [i, k] of m.streaks.entries()) {
    ink(ctx, [f.p(cx + Math.cos(k.a) * k.r0, cy + Math.sin(k.a) * k.r0), f.p(cx + Math.cos(k.a) * k.r1, cy + Math.sin(k.a) * k.r1)], { w: f.l(k.w), color: C.ink, alpha: 0.22, shade: false, taper: 0.5, jitter: 0.6, seed: s + 10 + i });
  }
  const xs = foot.map(([x]) => x), ys = foot.map(([, y]) => y), x0 = Math.min(...xs), y0 = Math.min(...ys);
  stipple(ctx, x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0, 300, { r: 1.1, color: C.ink, alpha: 0.28, seed: s + 40, clip: foot });
  ctx.restore();
  const [px0, py0, px1, py1] = TP_PAD;
  flat(ctx, rr(f, px0 - 0.14, py0 - 0.14, px1 + 0.14, py1 + 0.14, 0.1), C.ink, 0.22);
  for (const [i, c] of m.cracks.entries()) {
    const pts = c.map(([x, y]) => f.p(x, y));
    ink(ctx, pts.map(([x, y]) => [x - 0.8, y - 0.8] as Pt), { w: 1.2, color: SCORCH.baked, alpha: 0.7, shade: false, taper: 0.4, jitter: 0.3, seed: s + 60 + i });
    ink(ctx, pts, { w: 1.6, color: C.ink, alpha: 0.75, shade: false, taper: 0.4, jitter: 0.3, seed: s + 60 + i });
  }
  for (const [i, q] of m.glass.entries()) {
    const [gx, gy] = f.p(q.x, q.y);
    const pts = ellipsePts(gx, gy, f.l(q.rx), f.l(q.ry), s + 80 + i, 0.15, 20, q.rot + (f.rot * Math.PI) / 2);
    flat(ctx, pts, C.lilacL, 0.55);
    ink(ctx, pts.slice(12, 18), { w: 1.2, color: '#ffffff', alpha: 0.6, shade: false, taper: 0.3, seed: s + 85 + i });
  }
  const rng = makeRng(s + 90);
  const L = 0.16, H = 5 - L;
  for (const [ax, ay, bx, by] of [[L, L, H, L], [H, L, H, H], [H, H, L, H], [L, H, L, L]] as const) {
    for (let t = 0.04; t < 0.96; t += 0.09) {
      if (rng.chance(0.3)) continue;
      const a = f.p(ax + (bx - ax) * t, ay + (by - ay) * t), b = f.p(ax + (bx - ax) * (t + 0.05), ay + (by - ay) * (t + 0.05));
      ink(ctx, [a, b], { w: f.l(0.04), color: C.hazard, alpha: rng.range(0.45, 0.85), shade: false, taper: 0, jitter: 0.2, seed: s + 91 });
    }
  }
  ink(ctx, foot, { closed: true, w: 1, alpha: 0.35, shade: false, seed: s + 95 });
  for (const [i, [x, y]] of m.embers.entries()) {
    const [ex, ey] = f.p(x, y);
    flat(ctx, ellipsePts(ex, ey, f.l(0.07), f.l(0.07), s + 100 + i, 0.1, 12), C.coral, 0.25);
    flat(ctx, ellipsePts(ex, ey, f.l(0.04), f.l(0.035), s + 105 + i, 0.1, 10), C.coral, 0.8);
    flat(ctx, ellipsePts(ex, ey, f.l(0.018), f.l(0.018), s + 110 + i, 0, 8), C.peachL);
  }
}

/**
 * A flame-proof ribbon from above: the dark chute across the apron, its band of ceramic
 * heat-shield plates, chevrons in the port's colour the way the items go, the two shield walls
 * tempered along their length (straw at the apron's edge, blue at the pad) and riveted.
 */
function tpRibbonTop(ctx: Ctx, f: Frame, io: 'in' | 'out', s: number): void {
  const { outer, pad } = TP_RIBBON[io];
  const [b0, b1] = TP_BAND, [w0, w1] = TP_WALL;
  const ya = Math.min(outer, pad), yb = Math.max(outer, pad);
  const yAt = (t: number): number => outer + (pad - outer) * t;
  const chute = rr(f, w0, ya, w1, yb, 0.02);
  dropShadow(ctx, f, chute, 0.8, 0.2);
  shape(ctx, chute, C.steelDD, { w: 1.6, seed: s });
  const n = 5;
  for (let i = 0; i < n; i++) {
    const p0 = yAt(i / n), p1 = yAt((i + 1) / n);
    const q = rr(f, b0 + 0.03, Math.min(p0, p1) + 0.012, b1 - 0.03, Math.max(p0, p1) - 0.012, 0.01);
    flat(ctx, q, i % 2 ? mix(C.steelDD, C.inkSoft, 0.4) : mix(C.steelDD, C.steel, 0.3));
  }
  const col = io === 'in' ? C.cyan : C.coral;
  for (const [i, t] of [0.3, 0.68].entries()) {
    const y = yAt(t), k = 0.13;
    ink(ctx, [f.p(2.33, y + k), f.p(2.5, y - k * 0.6), f.p(2.67, y + k)], { w: f.l(0.05), color: col, shade: false, taper: 0, jitter: 0.15, seed: s + 50 + i });
  }
  for (const [x0, x1] of [[w0, b0], [b1, w1]] as const) {
    const w = rr(f, x0, ya, x1, yb, 0.01);
    shape(ctx, w, C.steelD, { w: 1.2, shade: false, seed: s + 20 + x0 });
    const xm = (x0 + x1) / 2;
    for (let i = 0; i < 4; i++) {
      ink(ctx, [f.p(xm, yAt(i / 4)), f.p(xm, yAt((i + 1) / 4))], { w: f.l(0.035), color: TP_TEMPER[i]!, alpha: 0.85, shade: false, taper: 0, jitter: 0, seed: s + 30 + i });
    }
    for (const t of [0.18, 0.5, 0.82]) rivet(ctx, ...f.p(xm, yAt(t)), Math.max(1.4, f.l(0.025)), C.steelL);
  }
}

/** Where a flame-proof ribbon meets the pad, from above: an armoured hood, its dark mouth on the ribbon's side, a lamp in the port's colour. */
function tpHoodTop(ctx: Ctx, f: Frame, io: 'in' | 'out', s: number): void {
  const [h0, h1] = TP_RIBBON[io].hood;
  const [w0, w1] = TP_WALL;
  const hood = rr(f, w0, h0, w1, h1, 0.03);
  dropShadow(ctx, f, hood, 2.4, 0.26);
  shape(ctx, hood, C.steelD, { w: 1.6, seed: s });
  const my = io === 'in' ? [h1 - 0.07, h1 + 0.02] : [h0 - 0.02, h0 + 0.07];
  flat(ctx, rr(f, w0 + 0.1, my[0]!, w1 - 0.1, my[1]!, 0.01), C.ink);
  for (let i = 1; i < 4; i++) {
    const x = w0 + ((w1 - w0) * i) / 4;
    ink(ctx, [f.p(x, h0 + 0.04), f.p(x, h1 - 0.04)], { w: 1, color: C.steelL, alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: s + 2 + i });
  }
  light(ctx, ...f.p(2.5, (h0 + h1) / 2), f.l(0.04), io === 'in' ? C.led : C.ledWarm);
}

/**
 * The incinerator's pit from above (D51; owner, 2026-10-14: "a hole in the ground with a flame"),
 * the iso art's (`pitIso`): scorched ground with its soot and cracks, the four chutes in (a
 * turquoise band at each mouth, a cyan chevron pointing in, rails), the tempered collar and its
 * bolts, the dark throat with the grate over the glowing bed. The flame over it is the world's
 * (`pitFlameTop`, world/pits.ts).
 */
function pitTop(ctx: Ctx, f: Frame, s: number): void {
  const { ro, ri, hw, lip } = PIT;
  const foot = rr(f, 0.02, 0.02, 0.98, 0.98, 0.02);
  const m = pitMarks();
  flat(ctx, foot, SCORCH.baked);
  ctx.save(); pathOf(ctx, foot); ctx.clip();
  for (const b of m.burns) flat(ctx, b.r.map((v, i) => { const t = (i / b.r.length) * Math.PI * 2; return f.p(0.5 + Math.cos(t) * v, 0.5 + Math.sin(t) * v); }), SCORCH[b.tone], b.alpha);
  for (const [i, c] of m.cracks.entries()) {
    const pts = c.map(([x, y]) => f.p(x, y));
    ink(ctx, pts.map(([x, y]) => [x - 0.8, y - 0.8] as Pt), { w: 1.1, color: SCORCH.baked, alpha: 0.6, shade: false, taper: 0.4, jitter: 0.2, seed: s + 60 + i });
    ink(ctx, pts, { w: 1.5, color: C.ink, alpha: 0.7, shade: false, taper: 0.4, jitter: 0.2, seed: s + 60 + i });
  }
  ctx.restore();
  ink(ctx, foot, { closed: true, w: 1, alpha: 0.3, shade: false, seed: s + 61 });
  const [cx, cy] = f.p(0.5, 0.5);
  const disc = (r: number, n = 40): Pt[] => ellipsePts(cx, cy, f.l(r), f.l(r), s, 0, n);
  // The collar's shadow down-right, then its tempered top, outer edge first.
  flat(ctx, ellipsePts(cx + f.l(0.035), cy + f.l(0.05), f.l(ro), f.l(ro), s, 0, 40), C.inkSoft, 0.3);
  for (let i = 0; i < PIT_TEMPER.length; i++) flat(ctx, disc(ro - ((ro - ri) * i) / PIT_TEMPER.length), PIT_TEMPER[i]!);
  // The throat: dark, the bed glowing under the grate.
  flat(ctx, disc(ri), C.ink);
  flat(ctx, disc(ri * 0.82), EMBER_D);
  ctx.save(); pathOf(ctx, disc(ri * 0.82)); ctx.clip();
  for (let i = -3; i <= 3; i++) flat(ctx, rr(f, 0.5 - ri, 0.5 + i * 0.075 - 0.02, 0.5 + ri, 0.5 + i * 0.075 + 0.02, 0), i & 1 ? EMBER : mix(EMBER, C.peachL, 0.35), 0.9);
  for (let i = -3; i <= 4; i++) { const y = 0.5 + (i - 0.5) * 0.075; ink(ctx, [f.p(0.5 - ri, y), f.p(0.5 + ri, y)], { w: 2.2, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 10 + i }); }
  ctx.restore();
  ink(ctx, disc(ri), { closed: true, w: 1.6, shade: false, taper: 0, jitter: 0, seed: s + 3 });
  ink(ctx, disc(ro), { closed: true, w: 1.8, seed: s + 4 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, r = (ro + ri) / 2 + 0.035;
    rivet(ctx, ...f.p(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r), f.l(0.022), mix(C.steelL, C.brassL, 0.25));
  }
  // The chutes, edge to lip, over the collar.
  for (let side = 0; side < 4; side++) {
    const dx = [0, 1, 0, -1][side]!, dy = [-1, 0, 1, 0][side]!, nx = -dy, ny = dx;
    const at = (r: number, u: number): Pt => f.p(0.5 + dx * r + nx * u, 0.5 + dy * r + ny * u);
    flat(ctx, [at(0.5, -hw + 0.03), at(lip - 0.02, -hw + 0.03), at(lip - 0.02, hw + 0.03), at(0.5, hw + 0.03)].map(([x, y]) => [x + f.l(0.025), y + f.l(0.035)] as Pt), C.inkSoft, 0.3);
    shape(ctx, [at(0.5, -hw), at(lip, -hw), at(lip, hw), at(0.5, hw)], mix(C.steelD, C.steel, 0.35), { w: 1.3, shade: false, jitter: 0, seed: s + 20 + side });
    flat(ctx, [at(ro - 0.04, -hw), at(lip, -hw), at(lip, hw), at(ro - 0.04, hw)], mix(C.violetL, C.steelD, 0.45), 0.85);
    for (const u of [-hw, hw]) {
      ink(ctx, [at(0.5, u * 0.9), at(lip, u * 0.9)], { w: 2.6, color: C.steelDD, shade: false, taper: 0, jitter: 0, seed: s + 30 + side });
      ink(ctx, [at(0.5, u * 0.9), at(lip, u * 0.9)], { w: 1, color: C.steelL, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: s + 31 + side });
    }
    shape(ctx, [at(0.5, -hw), at(0.45, -hw), at(0.45, hw), at(0.5, hw)], C.turq, { w: 1, shade: false, jitter: 0, seed: s + 40 + side });
    const c = (ro + 0.5) / 2 + 0.01, k = 0.045;
    ink(ctx, [at(c + k, -0.08), at(c - k, 0), at(c + k, 0.08)], { w: 2.2, color: C.cyan, shade: false, taper: 0, jitter: 0, seed: s + 50 + side });
    ink(ctx, [at(lip, -hw), at(lip, hw)], { w: 1.5, shade: false, taper: 0, jitter: 0, seed: s + 55 + side });
  }
}

/**
 * The pit's flame from above, for the plan view (the world fades it in with the fire: world/pits.ts):
 * a ragged ring of coral tongues licking out of the throat over the collar, orange inside, a pale
 * core over the grate. Drawn in a 1 × 1 plan frame (TOP_PX a tile, margin TOP_MARGIN).
 */
export function pitFlameTop(ctx: Ctx, s: number): void {
  const f = new Frame(TOP_PX, TOP_MARGIN, 1, 1, 0);
  const [cx, cy] = f.p(0.5, 0.5);
  const rng = makeRng(s);
  const star = (r0: number, r1: number, n: number, seed: number): Pt[] => {
    const q = makeRng(seed);
    return Array.from({ length: n * 2 }, (_, i) => {
      const a = (i / (n * 2)) * Math.PI * 2 + q.range(-0.08, 0.08), r = f.l(i % 2 ? r0 : r1 * q.range(0.8, 1.1));
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
    });
  };
  const outer = star(PIT.ri * 0.85, PIT.ro * 1.05, 9, s + 1);
  flat(ctx, outer, C.coral, 0.92);
  ink(ctx, outer, { closed: true, w: 1.3, color: C.coralD, alpha: 0.85, shade: false, taper: 0, jitter: 0.2, seed: s + 2 });
  flat(ctx, star(PIT.ri * 0.55, PIT.ri * 1.05, 7, s + 3), mix(C.coral, C.warn, 0.62));
  flat(ctx, ellipsePts(cx, cy, f.l(PIT.ri * 0.42), f.l(PIT.ri * 0.42), s + 4, 0.2, 18), mix(C.warn, '#fff4d6', 0.7));
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2), r = f.l(rng.range(PIT.ro * 1.05, 0.48));
    flat(ctx, ellipsePts(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.6, 1.6, s + 10 + i, 0, 8), mix(C.warn, '#fff4d6', 0.5));
  }
}

const seedOf = (id: string): number => (id.length * 131 + id.charCodeAt(0) * 17) | 0;

/**
 * A plan sprite's body: the recipe (or a moving building's body), the ports over it, and its
 * power terminals of the generic kit (art/terminals.ts), last, where the wires end.
 */
function bodyTop(ctx: Ctx, f: Frame, id: BuildingId, def: BuildingDef, seed: number, lv = 1): void {
  const m = MOVING_TOP[id];
  if (m) m.body(ctx, f, seed);
  else (R[id] ?? fallback)(ctx, f, seed, lv);
  // The incinerator's in-ports are its plate's own ribbon mouths (as a routing block's): no nozzles.
  if (def.kind !== 'sink') for (const p of def.ports) if (portDrawn(def, p, lv)) port(ctx, f, p.x, p.y, sideIndex[p.side], p.io, seed + p.x * 5 + p.y);
  for (const [i, t] of terminalsOf(id).entries()) if (kitDrawn(t)) terminalTop(ctx, f, t, seed + 900 + i * 7, KIT_K);
}

/**
 * Draw a plan-view building sprite (body + ports) for one rotation into a fresh canvas, at its
 * look's level `lv`; a building with a moving part gets it at phase 0, over the body as the world
 * draws it.
 */
export function drawBuildingTop(id: BuildingId, rot: Rot, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }, lv = 1): { canvas: unknown; frame: Frame } {
  const def = BUILDINGS[id] as BuildingDef;
  const f = new Frame(TOP_PX, TOP_MARGIN, def.w, def.h, rot);
  const { ctx, canvas } = make(f.W, f.H);
  const seed = seedOf(id);
  bodyTop(ctx, f, id, def, seed, lv);
  MOVING_TOP[id]?.part(ctx, f, seed, 0);
  return { canvas, frame: f };
}

/**
 * A building with a moving part, drawn apart for the plan view (moving.ts): its body (with its
 * ports) and its part at `frames` phases of one period, each a canvas the size of the whole
 * sprite. In plan the part is always over the body. Null for a building without one.
 */
export function drawBuildingTopMoving(id: BuildingId, rot: Rot, frames: number, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { body: unknown; parts: unknown[]; frame: Frame } | null {
  const m = MOVING_TOP[id];
  if (!m) return null;
  const def = BUILDINGS[id] as BuildingDef;
  const f = new Frame(TOP_PX, TOP_MARGIN, def.w, def.h, rot);
  const seed = seedOf(id);
  const b = make(f.W, f.H);
  bodyTop(b.ctx, f, id, def, seed);
  const parts = Array.from({ length: frames }, (_, k) => {
    const p = make(f.W, f.H);
    m.part(p.ctx, f, seed, k / frames);
    return p.canvas;
  });
  return { body: b.canvas, parts, frame: f };
}

/**
 * The skybridge's gantry from above (buildings.ts `skyGantry`): the hazard beam across the line,
 * its shadow, a red lamp at each end over its legs. A ramp piece draws it again over itself, as the
 * end's own sprite does, so it stays over the ramp.
 */
function skyGantryTop(ctx: Ctx, f: Frame, s: number): void {
  const beam = rr(f, 0.005, 0.44, 0.995, 0.56, 0.015);
  dropShadow(ctx, f, beam, 1.84, 0.24);
  flat(ctx, beam, C.hazard);
  ctx.save(); pathOf(ctx, beam); ctx.clip();
  hatch(ctx, beam, Math.PI / 4, f.l(0.09), { w: f.l(0.035), alpha: 0.85, seed: s + 6 });
  ctx.restore();
  ink(ctx, beam, { closed: true, w: 1.5, seed: s + 7 });
  for (const x of [0.04, 0.96]) light(ctx, ...f.p(x, 0.5), f.l(0.045), C.ledRed);
}

/**
 * A skybridge pair's piece on its square, from above (buildings.ts `drawSkyPiece`): the span's
 * shadow down-right as long as it is high there (cut at the square, so neighbouring pieces' shadows
 * never overlap), the dark girders, the slatted running surface — a ramp shaded as it leans, a
 * hazard toe plate at its foot — and, over a ramp, the end's gantry again. On the end's own frame.
 */
export function drawSkyPieceTop(piece: SkyPiece, rot: Rot, make: (w: number, h: number) => { ctx: Ctx; canvas: unknown }): { canvas: unknown; frame: Frame } {
  const f = new Frame(TOP_PX, TOP_MARGIN, 1, 1, rot);
  const { ctx, canvas } = make(f.W, f.H);
  const s = seedOf('skybridge');
  const { r0, r1, g0, g1, rim, deck } = SKY;
  const high = (y: number): number => (piece === 'deck' ? deck : deck * (piece === 'up' ? 1 - y : y)) + rim;
  const E = 0.012;
  ctx.save();
  pathOf(ctx, rr(f, -1, 0, 2, 1, 0));
  ctx.clip();
  const lay = (x: number, y: number): Pt => { const d = f.l(0.11 * high(y)); const [px, py] = f.p(x, y); return [px + d * 0.7, py + d]; };
  flat(ctx, hull([f.p(g0, 0), f.p(g1, 0), f.p(g1, 1), f.p(g0, 1), lay(g0, 0), lay(g1, 0), lay(g1, 1), lay(g0, 1)]), C.inkSoft, 0.26);
  ctx.restore();
  flat(ctx, rr(f, r0, -E, r1, 1 + E, 0), C.steelL);
  if (piece !== 'deck') {
    // Leaning to the light (rising towards the top of the screen) a little lighter, else darker.
    const [, ya] = f.p(0.5, 0), [, yb] = f.p(0.5, 1);
    const toLight = (piece === 'up') === (ya < yb);
    flat(ctx, rr(f, r0, -E, r1, 1 + E, 0), toLight ? '#ffffff' : C.ink, toLight ? 0.12 : 0.14);
  }
  for (let k = 0; k < 8; k++) {
    const y = (k + 0.5) / 8;
    ink(ctx, [f.p(r0 + 0.02, y), f.p(r1 - 0.02, y)], { w: 2, color: C.steel, shade: false, taper: 0, jitter: 0, seed: s + 10 + k });
  }
  for (const [i, [a, b]] of ([[g0, r0], [r1, g1]] as const).entries()) {
    flat(ctx, rr(f, a, -E, b, 1 + E, 0), C.steelD);
    ink(ctx, [f.p((a + b) / 2, -E), f.p((a + b) / 2, 1 + E)], { w: 1.1, color: mix(C.steelD, '#ffffff', 0.3), shade: false, taper: 0, jitter: 0, seed: s + 20 + i });
    for (const y of [0.25, 0.75]) rivet(ctx, ...f.p((a + b) / 2, y), f.l(0.016), C.steelL);
    for (const x of [a, b]) ink(ctx, [f.p(x, -E), f.p(x, 1 + E)], { w: 1.5, shade: false, taper: 0, jitter: 0, seed: s + 22 + i * 2 + x });
  }
  if (piece !== 'deck') {
    const foot = piece === 'up' ? 1 : 0;
    const toe = rr(f, g0, Math.min(foot, 0.92), g1, Math.max(foot, 0.08), 0.01);
    flat(ctx, toe, C.hazard);
    ctx.save(); pathOf(ctx, toe); ctx.clip();
    hatch(ctx, toe, Math.PI / 4, f.l(0.07), { w: f.l(0.028), alpha: 0.85, seed: s + 30 });
    ctx.restore();
    ink(ctx, toe, { closed: true, w: 1.2, shade: false, taper: 0, jitter: 0, seed: s + 31 });
    skyGantryTop(ctx, f, s + 40);
  }
  return { canvas, frame: f };
}

function fallback(ctx: Ctx, f: Frame, s: number): void {
  // No recipe yet: a riveted crate-like machine — a steel housing, a bolted hatch, an intake,
  // a hazard stripe and LEDs. Never a dome.
  plinth(ctx, f, C.steel, 0.06, s);
  const body = rr(f, 0.2, 0.2, f.w - 0.2, f.h - 0.2, 0.06);
  dropShadow(ctx, f, body, 1.3, 0.3);
  shape(ctx, body, C.steelL, { w: 2, seed: s + 1 });
  hatchDoor(ctx, rr(f, f.w / 2 - 0.2, f.h / 2 - 0.2, f.w / 2 + 0.2, f.h / 2 + 0.2, 0.02), s + 2);
  grille(ctx, rr(f, 0.3, f.h - 0.46, f.w / 2 - 0.08, f.h - 0.3, 0.02), 3, s + 3);
  shape(ctx, rr(f, f.w / 2 + 0.08, f.h - 0.42, f.w - 0.3, f.h - 0.32, 0.01), C.hazard, { w: 1, shade: false, jitter: 0, seed: s + 4 });
  ledStrip(ctx, f.p(0.32, 0.32), f.p(Math.min(f.w - 0.32, 0.8), 0.32), 3, f.l(0.03), LEDS, s + 5);
}

/** Which buildings change shape when rotated in plan (others reuse rot 0 and its ports): the iso art's rule (art/terminals.ts `turnsArt`). */
export const needsRotationsTop = (id: BuildingId): boolean => turnsArt(id);
