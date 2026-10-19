// belts.ts — ribbon tiles as inked conveyors: blue-steel side rails with rivets carrying a
// slatted belt in the tier colour (ribbon turquoise, swift lilac, express coral). A straight piece
// (moving north), a corner piece (entering from the south, leaving east), a side inlet (a line
// merging in from the west: the rail opens) and a skybridge deck; other orientations are rotations /
// mirrors at render time. Shadows are symmetric soft halos, so a piece looks the same whichever way
// it is turned.
//
// The conduit is a pipe, not a belt (D145): in plan (these pieces; in iso it is a raised tube,
// recipes/pipes.ts) a pale steel tube `PLAN_R` a side with darker edges and a highlight down its
// crown, inked along both sides, the saddle under it showing either side at the tile's middle with
// its strap across; a bend a long-radius elbow between two flanged joints (at the stub's mouth from
// each edge, as in iso); a side inlet a tee's branch with a collar at its root; every few tiles a
// flanged joint (`drawConduitJoint`, the tiles iso draws one on). No rails, no lights, no chevron.
//
// The glazed ribbon (D103) is a ribbon whose rails are glass-edged, pale ice with a bright edge;
// its hood is laid over its items by the views (recipes/gleaners.ts `drawGlassCover`).
//
// The camouflaged ribbon (D109) is buried: a low mound of sand over the line, soft at its edges,
// small dune ridges across it (a lit crest, its shadow behind), the buried rails' edges as a faint
// dashed outline, a faint chevron for its way — the trail one reads in plan —, and on the odd tile a
// vent, a dark seam with a glint of what rides inside (`drawCamoVent`; the views pick it by tile).
// No rails, no lights: the items it carries are not drawn (items-view.ts).
//
// The traction ribbon is a track, not a belt (owner, 2026-10-13: "the traction ribbon needs to
// look like a traction thing"): brass grouser plates on a dark rubber band, between heavy rails
// with sprocket wheels. Where it changes level, its lift up the terrace's wall is drawn apart
// (art/recipes/lifts.ts).
import { C, mix } from '../tokens';
import { ink, flat, shape, type Ctx, type Pt } from '../ink';
import { light, rivet } from '../shapes';
import { PIPE, PLAN_R } from '../pipe-ports';

export const BELT_PX = 64;
const S = BELT_PX;
const BAND = 0.6;  // belt width in tiles
const RAIL = 6;    // rail width in px

export const BELT_TIERS = {
  ribbon: { fill: C.tealL, slat: C.teal, chevron: C.ice, rail: C.steel },
  swift_ribbon: { fill: C.violetL, slat: C.violet, chevron: C.ice, rail: C.steel },
  express_ribbon: { fill: C.coral, slat: C.coralD, chevron: C.peachL, rail: C.steel },
  traction_ribbon: { fill: mix(C.steelDD, C.inkSoft, 0.45), slat: C.brass, chevron: C.brassL, rail: C.steelD }, // a track: grouser plates (`treadPlates`)
  conduit: { fill: C.steelL, slat: C.steel, chevron: C.shallow, rail: C.steel },
  glazed_ribbon: { fill: C.tealL, slat: C.teal, chevron: C.ice, rail: mix(C.ice, C.steelL, 0.35) }, // under glass (D103): its hood is laid over the items
  camo_ribbon: { fill: C.sand, slat: C.dune, chevron: mix(C.dune, C.ink, 0.45), rail: C.dune }, // buried (D109): a mound of sand (`camoStraight`…)
} as const;
export type BeltTier = keyof typeof BELT_TIERS;

/** Straight piece, motion towards the top. Canvas S×S (seamless top/bottom edges). */
export function drawStraight(ctx: Ctx, tier: BeltTier, seed: number): void {
  if (tier === 'camo_ribbon') { camoStraight(ctx, seed, false); return; }
  if (tier === 'conduit') { conduitStraight(ctx, seed, false); return; }
  const t = BELT_TIERS[tier];
  const x0 = (S * (1 - BAND)) / 2, x1 = S - x0;
  flat(ctx, [[x0 - RAIL - 2, 0], [x1 + RAIL + 2, 0], [x1 + RAIL + 2, S], [x0 - RAIL - 2, S]], C.ink, 0.12); // soft halo
  flat(ctx, [[x0, 0], [x1, 0], [x1, S], [x0, S]], t.fill);
  if (tier === 'traction_ribbon') {
    treadPlates(ctx, x0, x1, seed);
  } else {
    // Slats across the belt (the belt "moves" under them).
    ctx.save();
    ctx.strokeStyle = t.slat;
    ctx.lineWidth = 2;
    for (let y = 4; y < S; y += 8) { ctx.beginPath(); ctx.moveTo(x0 + 1, y); ctx.lineTo(x1 - 1, y); ctx.stroke(); }
    ctx.restore();
    ink(ctx, [[S / 2 - 8, S * 0.5 + 5], [S / 2, S * 0.5 - 4], [S / 2 + 8, S * 0.5 + 5]], { w: 3.4, color: t.chevron, shade: false, taper: 0, jitter: 0.2, seed: seed + 9 });
  }
  if (tier === 'traction_ribbon') { treadRails(ctx, x0, x1, seed); return; }
  // Steel rails, inked, running past the tile so neighbours join seamlessly.
  for (const [xa, xb] of [[x0 - RAIL, x0], [x1, x1 + RAIL]] as const) {
    flat(ctx, [[xa, -1], [xb, -1], [xb, S + 1], [xa, S + 1]], t.rail);
    ink(ctx, [[xa + 1.5, -2], [xa + 1.5, S + 2]], { w: 1.4, color: tier === 'glazed_ribbon' ? '#ffffff' : C.steelL, shade: false, taper: 0, jitter: 0, seed: seed + 3 });
    ink(ctx, [[xa, -2], [xa, S + 2]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 1 });
    ink(ctx, [[xb, -2], [xb, S + 2]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 2 });
    rivet(ctx, (xa + xb) / 2, S * 0.25, 1.5, C.steelL);
    light(ctx, (xa + xb) / 2, S * 0.75, 1.6, tier === 'express_ribbon' ? C.ledWarm : tier === 'glazed_ribbon' ? C.glowCyan : C.led);
  }
}

/**
 * A track's grouser plates across the band [x0, x1] (straight piece, moving north): brass bars
 * with a lit leading edge, a cleat ridge across each and dark gaps between, seamless top to
 * bottom; one inked arrow of brass over them for the way it runs.
 */
function treadPlates(ctx: Ctx, x0: number, x1: number, seed: number): void {
  for (let y = 0; y < S; y += 8) {
    flat(ctx, [[x0 + 1.5, y + 1], [x1 - 1.5, y + 1], [x1 - 1.5, y + 6.5], [x0 + 1.5, y + 6.5]], C.brass);
    ink(ctx, [[x0 + 2, y + 1.4], [x1 - 2, y + 1.4]], { w: 1.2, color: C.brassL, shade: false, taper: 0, jitter: 0, seed: seed + y });
    ink(ctx, [[x0 + 2, y + 4], [x1 - 2, y + 4]], { w: 1.4, color: mix(C.brass, C.ink, 0.45), shade: false, taper: 0, jitter: 0, seed: seed + y + 1 });
  }
  ink(ctx, [[S / 2 - 7, S * 0.5 + 5], [S / 2, S * 0.5 - 3], [S / 2 + 7, S * 0.5 + 5]], { w: 3, color: C.ink, alpha: 0.85, shade: false, taper: 0, jitter: 0.2, seed: seed + 9 });
}

/** A track's rails: heavier and darker than a ribbon's, with sprocket wheels that bite the plates. */
function treadRails(ctx: Ctx, x0: number, x1: number, seed: number): void {
  const R = RAIL + 2;
  for (const [xa, xb] of [[x0 - R, x0], [x1, x1 + R]] as const) {
    flat(ctx, [[xa, -1], [xb, -1], [xb, S + 1], [xa, S + 1]], C.steelD);
    ink(ctx, [[xa + 1.5, -2], [xa + 1.5, S + 2]], { w: 1.2, color: C.steel, shade: false, taper: 0, jitter: 0, seed: seed + 3 });
    ink(ctx, [[xa, -2], [xa, S + 2]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 1 });
    ink(ctx, [[xb, -2], [xb, S + 2]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 2 });
    for (const y of [S * 0.25, S * 0.75]) {
      const cx = (xa + xb) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, y, R / 2 + 1.2, 0, Math.PI * 2);
      ctx.fillStyle = C.steel;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      ctx.restore();
      rivet(ctx, cx, y, 1.6, C.brassL);
    }
  }
}

/** Corner piece: enters through the bottom edge, leaves through the right edge. */
export function drawCorner(ctx: Ctx, tier: BeltTier, seed: number): void {
  if (tier === 'camo_ribbon') { camoCorner(ctx, seed); return; }
  if (tier === 'conduit') { conduitCorner(ctx, seed); return; }
  const t = BELT_TIERS[tier];
  const rIn = (S * (1 - BAND)) / 2, rOut = S - rIn; // radii around the bottom-right corner (S, S)
  const arc = (r: number, n = 20): Pt[] => Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI + (i / n) * (Math.PI / 2);
    return [S + Math.cos(a) * r, S + Math.sin(a) * r] as Pt;
  });
  const band = (ra: number, rb: number): Pt[] => [...arc(ra), ...arc(rb).reverse()];
  flat(ctx, band(Math.max(0, rIn - RAIL - 2), rOut + RAIL + 2), C.ink, 0.12); // soft halo
  flat(ctx, band(rIn, rOut), t.fill);
  if (tier === 'traction_ribbon') {
    // Grouser plates fanning round the bend, each a brass bar lit on its leading edge.
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + ((i + 0.5) / 8) * (Math.PI / 2), da = 0.07;
      const pt = (r: number, b: number): Pt => [S + Math.cos(b) * r, S + Math.sin(b) * r];
      flat(ctx, [pt(rIn + 2, a - da), pt(rOut - 2, a - da * 0.6), pt(rOut - 2, a + da * 0.6), pt(rIn + 2, a + da)], C.brass);
      ink(ctx, [pt(rIn + 2, a - da), pt(rOut - 2, a - da * 0.6)], { w: 1.2, color: C.brassL, shade: false, taper: 0, jitter: 0, seed: seed + i });
      ink(ctx, [pt(rIn + 2, a + da), pt(rOut - 2, a + da * 0.6)], { w: 1.2, color: C.ink, alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: seed + 20 + i });
    }
  } else {
    ctx.save();
    ctx.strokeStyle = t.slat;
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      const a = Math.PI + (i / 8) * (Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(S + Math.cos(a) * (rIn + 1), S + Math.sin(a) * (rIn + 1));
      ctx.lineTo(S + Math.cos(a) * (rOut - 1), S + Math.sin(a) * (rOut - 1));
      ctx.stroke();
    }
    ctx.restore();
    const m = arc(S / 2)[10]!;
    ink(ctx, [[m[0] - 4, m[1] - 8], [m[0] + 5, m[1]], [m[0] - 4, m[1] + 8]], { w: 3.4, color: t.chevron, shade: false, taper: 0, seed: seed + 3 });
  }
  const rail = tier === 'traction_ribbon' ? RAIL + 2 : RAIL;
  for (const [ra, rb] of [[rIn - rail, rIn], [rOut, rOut + rail]] as const) {
    flat(ctx, band(ra, rb), t.rail);
    ink(ctx, arc(ra), { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 1 });
    ink(ctx, arc(rb), { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 2 });
  }
}

/**
 * Side inlet of a straight piece moving north: a line coming in from the west edge. The belt
 * runs through the west rail (the rail opens), framed by two short rails that continue the
 * feeder's own. Drawn over the straight piece; mirrored for the east side.
 */
export function drawInlet(ctx: Ctx, tier: BeltTier, seed: number): void {
  if (tier === 'camo_ribbon') { camoInlet(ctx, seed); return; }
  if (tier === 'conduit') { conduitInlet(ctx, seed); return; }
  const t = BELT_TIERS[tier];
  const x0 = (S * (1 - BAND)) / 2, x1 = S - x0; // the feeder's band spans y ∈ [x0, x1]
  const reach = x0 + 2; // just past the opened rail, onto the belt
  flat(ctx, [[0, x0], [reach, x0], [reach, x1], [0, x1]], t.fill);
  ctx.save();
  ctx.strokeStyle = t.slat;
  ctx.lineWidth = 2;
  for (let x = 4; x < reach; x += 8) { ctx.beginPath(); ctx.moveTo(x, x0 + 1); ctx.lineTo(x, x1 - 1); ctx.stroke(); }
  ctx.restore();
  for (const [ya, yb] of [[x0 - RAIL, x0], [x1, x1 + RAIL]] as const) {
    flat(ctx, [[-1, ya], [x0, ya], [x0, yb], [-1, yb]], t.rail);
    ink(ctx, [[-2, ya], [x0, ya]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 1 });
    ink(ctx, [[-2, yb], [x0, yb]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 2 });
  }
}

/**
 * A skybridge deck, one tile long, seamless along its length (moving north): a riveted steel
 * truss either side of a slatted running surface. The views lift it above the ground in iso.
 */
export function drawDeck(ctx: Ctx, seed: number): void {
  const x0 = (S * (1 - BAND)) / 2, x1 = S - x0;
  const G = RAIL + 3; // girder width
  flat(ctx, [[x0, 0], [x1, 0], [x1, S], [x0, S]], C.steelL);
  ctx.save();
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = 2;
  for (let y = 4; y < S; y += 8) { ctx.beginPath(); ctx.moveTo(x0 + 1, y); ctx.lineTo(x1 - 1, y); ctx.stroke(); }
  ctx.restore();
  for (const [xa, xb] of [[x0 - G, x0], [x1, x1 + G]] as const) {
    flat(ctx, [[xa, -1], [xb, -1], [xb, S + 1], [xa, S + 1]], C.steelD);
    // Truss bracing: one X per half tile, seamless top to bottom.
    for (let y = 0; y < S; y += S / 2) {
      ink(ctx, [[xa + 1, y], [xb - 1, y + S / 2]], { w: 1.1, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: seed + y });
      ink(ctx, [[xb - 1, y], [xa + 1, y + S / 2]], { w: 1.1, color: C.steelL, shade: false, taper: 0, jitter: 0, seed: seed + y + 1 });
    }
    ink(ctx, [[xa, -2], [xa, S + 2]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 3 });
    ink(ctx, [[xb, -2], [xb, S + 2]], { w: 1.8, taper: 0, jitter: 0.2, seed: seed + 4 });
    rivet(ctx, (xa + xb) / 2, S * 0.25, 1.4, C.steelL);
    light(ctx, (xa + xb) / 2, S * 0.75, 1.5, C.ledWarm);
  }
  void mix;
}

// ── the conduit in plan (D145) ───────────────────────────────────────────────

const HW = PLAN_R * S; // the tube's half-width (px)
const PIPE_FILL = C.steelL, PIPE_EDGE = mix(C.steelL, C.ink, 0.32), PIPE_FLANGE = mix(C.steelL, '#ffffff', 0.18);

/** Offset a polyline by d px to its left (its way's normal). */
function offset(pts: readonly Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [p[0] - (ty / l) * d, p[1] + (tx / l) * d] as Pt;
  });
}

/** A tube seen from above along a centre line: its halo, the steel, darker edges, the crown's highlight, inked sides. */
function tubeTop(ctx: Ctx, mid: readonly Pt[], seed: number, halo = true): void {
  const strip = (d0: number, d1: number): Pt[] => [...offset(mid, d0), ...offset(mid, d1).reverse()];
  if (halo) flat(ctx, strip(-HW - 3, HW + 3), C.ink, 0.12);
  flat(ctx, strip(-HW, HW), PIPE_FILL);
  flat(ctx, strip(-HW, -HW + 3.4), PIPE_EDGE);
  flat(ctx, strip(HW - 3.4, HW), PIPE_EDGE);
  ink(ctx, mid, { w: 2.4, color: '#ffffff', alpha: 0.62, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  ink(ctx, offset(mid, -HW), { w: 1.8, taper: 0, jitter: 0, shade: false, seed: seed + 2 });
  ink(ctx, offset(mid, HW), { w: 1.8, taper: 0, jitter: 0, shade: false, seed: seed + 3 });
}

/** A flange across the tube at (x, y), the tube running along angle `a` (radians): a pale bar, bolted at both ends. */
function flangeTop(ctx: Ctx, x: number, y: number, a: number, seed: number, w = 4): void {
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, h = HW + 3.6;
  const q: Pt[] = [[x - ux * w / 2 + nx * h, y - uy * w / 2 + ny * h], [x + ux * w / 2 + nx * h, y + uy * w / 2 + ny * h], [x + ux * w / 2 - nx * h, y + uy * w / 2 - ny * h], [x - ux * w / 2 - nx * h, y - uy * w / 2 - ny * h]];
  flat(ctx, q.map(([px, py]) => [px + 1.2, py + 1.6] as Pt), C.ink, 0.22);
  shape(ctx, q, PIPE_FLANGE, { w: 1.4, seed, shade: false, jitter: 0 });
  for (const k of [-1, 1]) rivet(ctx, x + nx * (h - 2) * k, y + ny * (h - 2) * k, 1.4, C.brassL);
}

/** The saddle under the tube at the tile's middle (moving north): its plate either side, its dark strap across. */
function saddleTop(ctx: Ctx): void {
  const w = (PLAN_R + 0.06) * S;
  shape(ctx, [[S / 2 - w, S / 2 - 3.6], [S / 2 + w, S / 2 - 3.6], [S / 2 + w, S / 2 + 3.6], [S / 2 - w, S / 2 + 3.6]], C.steelD, { w: 1.3, shade: false, jitter: 0, seed: 3 });
}
function strapTop(ctx: Ctx): void {
  flat(ctx, [[S / 2 - HW - 0.5, S / 2 - 1.3], [S / 2 + HW + 0.5, S / 2 - 1.3], [S / 2 + HW + 0.5, S / 2 + 1.3], [S / 2 - HW - 0.5, S / 2 + 1.3]], C.steelD, 0.9);
}

/** The conduit's straight (moving north): the tube on its saddle; `joint`: a flanged joint just inside its top edge. */
function conduitStraight(ctx: Ctx, seed: number, joint: boolean): void {
  saddleTop(ctx);
  tubeTop(ctx, [[S / 2, -2], [S / 2, S + 2]], seed);
  strapTop(ctx);
  if (joint) { flangeTop(ctx, S / 2, 3.6, Math.PI / 2, seed + 10); flangeTop(ctx, S / 2, 8.4, Math.PI / 2, seed + 11); }
}

/** A straight with a flanged joint (the plan's mark where iso draws one: every few tiles of a run). */
export function drawConduitJoint(ctx: Ctx, seed: number): void {
  conduitStraight(ctx, seed, true);
}

/** The conduit's bend (in at the bottom edge, out at the right): straight to the mouth, a joint, the long-radius elbow, a joint, straight on. */
function conduitCorner(ctx: Ctx, seed: number): void {
  const m = PIPE.tOut * S, R = S / 2 - m; // the mouth from each edge; the bend's radius
  const c: Pt = [S / 2 + R, S / 2 + R];
  const arc: Pt[] = Array.from({ length: 17 }, (_, i) => { const a = Math.PI + (i / 16) * (Math.PI / 2); return [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R] as Pt; });
  const sx = c[0] - R * 0.71, sy = c[1] - R * 0.71; // the bend's middle: the saddle's plate under it
  shape(ctx, [[sx - 7, sy], [sx, sy - 7], [sx + 7, sy], [sx, sy + 7]], C.steelD, { w: 1.3, shade: false, jitter: 0, seed: seed + 4 });
  tubeTop(ctx, [[S / 2, S + 2], [S / 2, S - m + 1], ...arc, [S - m - 1, S / 2], [S + 2, S / 2]], seed);
  flangeTop(ctx, S / 2, S - m - 2.4, Math.PI / 2, seed + 10);
  flangeTop(ctx, S / 2, S - m + 2.4, Math.PI / 2, seed + 11);
  flangeTop(ctx, S - m - 2.4, S / 2, 0, seed + 12);
  flangeTop(ctx, S - m + 2.4, S / 2, 0, seed + 13);
}

/** A tee's branch coming in from the west edge onto a straight moving north: the branch to the main tube, a collar at its root. */
function conduitInlet(ctx: Ctx, seed: number): void {
  const reach = S / 2 - HW + 1.5;
  tubeTop(ctx, [[-2, S / 2], [reach, S / 2]], seed, false);
  flat(ctx, [[reach - 4.5, S / 2 - HW - 1.6], [reach - 1.5, S / 2 - HW - 1.6], [reach - 1.5, S / 2 + HW + 1.6], [reach - 4.5, S / 2 + HW + 1.6]], C.steel);
  ink(ctx, [[reach - 4.5, S / 2 - HW - 1.6], [reach - 4.5, S / 2 + HW + 1.6]], { w: 1.3, taper: 0, jitter: 0, shade: false, seed: seed + 5 });
}

// ── the camouflaged ribbon (D109) ────────────────────────────────────────────

/** The buried line's ink: dune shadow, never black (it hides). */
const CAMO_EDGE = mix(C.dune, C.ink, 0.45);
const CAMO_SHADE = mix(C.dune, C.ink, 0.3);

/** The mound over the band [x0, x1] from y0 to y1: soft edges (two low washes of dune), a paler crown. */
function camoMound(ctx: Ctx, x0: number, x1: number, y0: number, y1: number): void {
  flat(ctx, [[x0 - 7, y0], [x1 + 7, y0], [x1 + 7, y1], [x0 - 7, y1]], C.dune, 0.16);
  flat(ctx, [[x0 - 3, y0], [x1 + 3, y0], [x1 + 3, y1], [x0 - 3, y1]], C.dune, 0.3);
  flat(ctx, [[x0 + 2, y0], [x1 - 2, y0], [x1 - 2, y1], [x0 + 2, y1]], C.sand, 0.6);
}

/** A small dune ridge across the band at y (moving north): an asymmetric crest, lit, its shadow just behind. */
function camoRidge(ctx: Ctx, x0: number, x1: number, y: number, seed: number): void {
  const m = (x0 + x1) / 2, flip = seed % 2 ? 1 : -1;
  const crest: Pt[] = [[x0 + 2, y + 1.4], [m - 7 * flip, y - 0.8], [m + 5 * flip, y - 1.6], [x1 - 2, y + 0.8]];
  ink(ctx, crest.map(([x, yy]) => [x, yy + 2.2] as Pt), { w: 2, color: CAMO_SHADE, alpha: 0.45, shade: false, taper: 0.3, jitter: 0.3, seed });
  ink(ctx, crest, { w: 1.5, color: C.paper, alpha: 0.8, shade: false, taper: 0.3, jitter: 0.3, seed: seed + 1 });
}

/** A buried line, straight (moving north): its mound, three ridges, the dashed edges of what lies under it, a faint chevron. */
function camoStraight(ctx: Ctx, seed: number, vent: boolean): void {
  const x0 = (S * (1 - BAND)) / 2, x1 = S - x0;
  camoMound(ctx, x0, x1, 0, S);
  for (let k = 0; k < 3; k++) camoRidge(ctx, x0, x1, 9 + k * 21, seed + 10 * k);
  // The buried rails' edges: short dashes, seamless top to bottom (a dash every 8 px).
  for (const x of [x0 - 1, x1 + 1]) {
    for (let y = 2; y < S; y += 8) ink(ctx, [[x, y], [x, y + 3.6]], { w: 1.25, color: CAMO_EDGE, alpha: 0.7, shade: false, taper: 0, jitter: 0.2, seed: seed + y + Math.round(x) });
  }
  ink(ctx, [[S / 2 - 7, S * 0.5 + 4], [S / 2, S * 0.5 - 3], [S / 2 + 7, S * 0.5 + 4]], { w: 2.2, color: CAMO_EDGE, alpha: vent ? 0.25 : 0.4, shade: false, taper: 0, jitter: 0.2, seed: seed + 9 });
  if (!vent) return;
  // A vent: a dark seam across the mound, its lip lit, a glint of what rides inside.
  const vy = S * 0.66;
  flat(ctx, [[x0 + 6, vy - 1.6], [x1 - 6, vy - 2.2], [x1 - 6, vy + 1.8], [x0 + 6, vy + 1.4]], C.ink, 0.5);
  ink(ctx, [[x0 + 6, vy - 2.6], [x1 - 6, vy - 3.2]], { w: 1.2, color: C.paper, alpha: 0.85, shade: false, taper: 0.2, jitter: 0.2, seed: seed + 31 });
  light(ctx, S / 2 + 4, vy, 1.4, C.glowPeach);
}

/** The vent tile of a buried straight line (the views lay it on the odd tile). */
export function drawCamoVent(ctx: Ctx, seed: number): void {
  camoStraight(ctx, seed, true);
}

/** A buried corner: in at the bottom edge, out at the right. */
function camoCorner(ctx: Ctx, seed: number): void {
  const rIn = (S * (1 - BAND)) / 2, rOut = S - rIn;
  const arc = (r: number, a0 = 0, a1 = 1, n = 20): Pt[] => Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI + (a0 + ((a1 - a0) * i) / n) * (Math.PI / 2);
    return [S + Math.cos(a) * r, S + Math.sin(a) * r] as Pt;
  });
  const band = (ra: number, rb: number): Pt[] => [...arc(ra), ...arc(rb).reverse()];
  flat(ctx, band(Math.max(0, rIn - 7), rOut + 7), C.dune, 0.16);
  flat(ctx, band(Math.max(0, rIn - 3), rOut + 3), C.dune, 0.3);
  flat(ctx, band(rIn + 2, rOut - 2), C.sand, 0.6);
  // Ridges across the bend, each a crest lit and its shadow on the outer side.
  for (let k = 0; k < 3; k++) {
    const a = Math.PI + ((k + 0.5) / 3) * (Math.PI / 2);
    const pt = (r: number, da: number): Pt => [S + Math.cos(a + da) * r, S + Math.sin(a + da) * r];
    const crest: Pt[] = [pt(rIn + 2, 0.02), pt((rIn + rOut) / 2, -0.04), pt(rOut - 2, 0.01)];
    ink(ctx, crest.map(([x, y]) => [x + 1.4, y + 1.4] as Pt), { w: 2, color: CAMO_SHADE, alpha: 0.45, shade: false, taper: 0.3, jitter: 0.3, seed: seed + k });
    ink(ctx, crest, { w: 1.5, color: C.paper, alpha: 0.8, shade: false, taper: 0.3, jitter: 0.3, seed: seed + 5 + k });
  }
  // The dashed edges along the arcs.
  for (const r of [rIn - 1, rOut + 1]) {
    for (let i = 0; i < 8; i++) ink(ctx, arc(r, i / 8 + 0.02, i / 8 + 0.08, 4), { w: 1.25, color: CAMO_EDGE, alpha: 0.7, shade: false, taper: 0, jitter: 0.2, seed: seed + 20 + i });
  }
  const m = arc(S / 2)[10]!;
  ink(ctx, [[m[0] - 3, m[1] - 7], [m[0] + 4, m[1]], [m[0] - 3, m[1] + 7]], { w: 2.2, color: CAMO_EDGE, alpha: 0.4, shade: false, taper: 0, seed: seed + 3 });
}

/** A buried line merging in from the west edge: its mound up to the band, one ridge across it, its dashed edges. */
function camoInlet(ctx: Ctx, seed: number): void {
  const x0 = (S * (1 - BAND)) / 2, x1 = S - x0; // the feeder's band spans y ∈ [x0, x1]
  const reach = x0 + 2;
  flat(ctx, [[0, x0 - 3], [reach, x0 - 3], [reach, x1 + 3], [0, x1 + 3]], C.dune, 0.3);
  flat(ctx, [[0, x0 + 2], [reach, x0 + 2], [reach, x1 - 2], [0, x1 - 2]], C.sand, 0.6);
  ink(ctx, [[6.6, x0 + 2], [5.2, S / 2], [6.2, x1 - 2]], { w: 2, color: CAMO_SHADE, alpha: 0.45, shade: false, taper: 0.3, jitter: 0.3, seed });
  ink(ctx, [[4.4, x0 + 2], [3, S / 2], [4, x1 - 2]], { w: 1.5, color: C.paper, alpha: 0.8, shade: false, taper: 0.3, jitter: 0.3, seed: seed + 1 });
  for (const y of [x0 - 1, x1 + 1]) for (let x = 1; x < reach; x += 8) ink(ctx, [[x, y], [x + 3.6, y]], { w: 1.25, color: CAMO_EDGE, alpha: 0.7, shade: false, taper: 0, jitter: 0.2, seed: seed + x });
}
