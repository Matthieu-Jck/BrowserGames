// gleaners.ts — the art of the Gleaners (D103, D112) and of what keeps them off: the small desert
// people themselves, their lantern eyes' glow, the glass hood over a glazed ribbon, and the fence.
//
// - **A Gleaner** (`drawGleaner`; owner, 2026-10-17: « un style amélioré … pas de jambes si c'est
//   trop compliqué à animer »): no legs — a hunched hooded cloak that floats a hand's breadth over
//   the sand and tapers behind into a tail like a blown flame, trailing two wisps of mist (four
//   frames: the tail and the wisps wave), a lumpy sack on its back, a deep hood bent low in front of the hunch with a long tip blown back, two lantern
//   eyes in the hood's dark, and a thin arm with three long fingers. It glides, carries (the arm
//   raised, holding up what it took: the views draw the item at `GLEANER_HAND`) or reaches (leant
//   in, armless: the views draw its long arm, `drawGleanerArm`, from `GLEANER_SHOULDER_REACH` out
//   to the ribbon, as long as it needs). A moonlit rim on the hood and the hunch gives it a shape
//   at night. Drawn facing right; the ground under it (its shadow, `drawGleanerShadow`) at
//   `GLEANER_GROUND`. The eyes are bright in the picture; their halo is a separate soft glow
//   (`drawEyeGlow`) the views lay on the additive lights layer, so the night never dims it.
// - **The glass hood** (`drawGlassCover`): what covers a glazed ribbon, laid by the views over the
//   items it carries — a pale translucent sheet over the band and its rails, two white glints, a
//   rib every quarter tile and an inked rim. A straight piece moving north, and the corner (the
//   belt pieces' own frames, recipes/belts.ts, so `beltMatrix` lays it).
// - **The fence** (`fenceIso`, `fenceTop`): a low square cage of steel mesh on four posts with a top
//   rail, one per tile — a line of them is a fence, and their corners meet whatever way it turns
//   (square, so its turn changes nothing); an amber reflector on a post.
import { C, mix } from '../tokens';
import { ellipsePts, flat, ink, shape, type Ctx, type Pt } from '../ink';
import { light } from '../shapes';
import type { IsoFrame } from '../iso-shapes';
import type { Frame } from '../shapes';
import { BELT_PX } from './belts';

/** A Gleaner's canvas (px) and its frames (the wisps' wave). */
export const GLEANER_W = 56, GLEANER_H = 60;
export const GLEANER_FRAMES = 4;
/** The body's axis and its hem, floating `FLOAT` px over the ground. */
const BX = 30, FLOAT = 8, GY = GLEANER_H - 3, HY = GY - FLOAT;
/** The ground under it: where its shadow lies and the views stand it (px). */
export const GLEANER_GROUND: Pt = [BX, GY];
/** How far it leans in to reach (radians, about its hem). */
const LEAN = 0.2;
const leant = (p: Pt): Pt => {
  const c = Math.cos(LEAN), s = Math.sin(LEAN), dx = p[0] - BX, dy = p[1] - HY;
  return [BX + dx * c - dy * s, HY + dx * s + dy * c];
};
/** Its eyes (px, facing right): upright, and leant in. */
export const GLEANER_EYE: Pt = [BX + 11.8, HY - 26.6];
export const GLEANER_EYE_REACH: Pt = leant(GLEANER_EYE);
/** Its shoulder, where the long arm starts when it reaches (leant in). */
export const GLEANER_SHOULDER_REACH: Pt = leant([BX + 7, HY - 20]);
/** What it carries, held up before its hood (px). */
export const GLEANER_HAND: Pt = [BX + 19, HY - 35];
/** The middle of its body (px): the halo's centre. */
export const GLEANER_HEART: Pt = [BX - 1, HY - 20];

/** How it floats: gliding (arm hanging), carrying (arm up, holding), reaching (leant in, its long arm drawn apart). */
export type GleanerPose = 'glide' | 'carry' | 'reach';

// A dusky silhouette against the night and its own halo, so the lantern eyes are what one sees first.
const CLOAK = mix(C.mesa, C.inkSoft, 0.55);
const CLOAK_D = mix(C.inkSoft, C.ink, 0.3);
const SACK = mix(C.mesa, C.inkSoft, 0.3);
const SACK_D = mix(SACK, C.ink, 0.35);
const LIMB = mix(C.mesa, C.lilacD, 0.55);
const RIM = C.lilacL;
const MIST = mix(C.lilacL, '#ffffff', 0.3);
const EYE = '#effffa';

/**
 * One frame of a Gleaner facing right (`frame` 0…3: its wisps' wave): gliding, carrying (its arm
 * raised, something held up at `GLEANER_HAND`: the views draw the item there) or reaching (leant
 * in, without its arm: the views draw it, `drawGleanerArm`).
 */
export function drawGleaner(ctx: Ctx, frame: number, pose: GleanerPose | boolean, seed = 7): void {
  const p: GleanerPose = pose === true ? 'carry' : pose === false ? 'glide' : pose;
  const ph = ((((frame % GLEANER_FRAMES) + GLEANER_FRAMES) % GLEANER_FRAMES) / GLEANER_FRAMES) * Math.PI * 2;
  const x = BX, y = HY;
  ctx.save();
  if (p === 'reach') { ctx.translate(x, y); ctx.rotate(LEAN); ctx.translate(-x, -y); }
  // The cloak: a hunched bell, its back high and round, tapering behind into a tail that streams
  // back like a blown flame (no legs: it floats); two wisps of mist trail off the tail's tip.
  const w = Math.sin(ph) * 1.6, w2 = Math.sin(ph + 1.3) * 1.8;
  for (let j = 0; j < 2; j++) {
    const pts: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x - 19 - t * (9 - j * 2), y + 0.5 + w2 * (1 - t) - j * 2.5 + Math.sin(t * 4 + ph + j * 2) * 1.4 * t - t * (1 + j)]);
    }
    ink(ctx, pts, { w: 1.6 - j * 0.3, color: MIST, alpha: 0.42 - j * 0.1, shade: false, taper: 0.8, jitter: 0, seed: seed + 20 + j });
  }
  const cloak: Pt[] = [
    [x + 4, y - 31], [x + 8, y - 21], [x + 8.5, y - 12], [x + 6, y - 4], [x + 2, y - 0.5],
    [x - 3, y + 1 + w * 0.3], [x - 9, y + 1.5 + w * 0.6], [x - 15, y + 2.5 + w], [x - 21, y + 0.5 + w2],
    [x - 17, y - 1.5 + w2 * 0.6], [x - 14.5, y - 6], [x - 13.5, y - 13], [x - 14, y - 21], [x - 10, y - 30], [x - 4, y - 34.5],
  ];
  shape(ctx, cloak, CLOAK, { w: 1.8, seed: seed + 3 });
  flat(ctx, [[x - 13.5, y - 13], [x - 14, y - 21], [x - 10, y - 30], [x - 6, y - 24], [x - 5, y - 4], [x - 9, y + 1.5 + w * 0.6], [x - 15, y + 2.5 + w], [x - 21, y + 0.5 + w2], [x - 17, y - 1.5 + w2 * 0.6], [x - 14.5, y - 6]], CLOAK_D, 0.45);
  // Folds running back into the tail.
  ink(ctx, [[x + 1, y - 25], [x - 0.5, y - 13], [x - 4, y - 3], [x - 12, y + 0.5 + w * 0.7]], { w: 1.1, color: CLOAK_D, alpha: 0.75, shade: false, taper: 0.6, jitter: 0.2, seed: seed + 4 });
  ink(ctx, [[x - 8, y - 9], [x - 13, y - 2], [x - 18, y + 0.5 + w2 * 0.8]], { w: 1, color: CLOAK_D, alpha: 0.6, shade: false, taper: 0.6, jitter: 0.2, seed: seed + 11 });
  // The sack on its back: lumpy, a darker patch, tied at the neck, its strap over the shoulder.
  ink(ctx, [[x - 8, y - 27], [x - 1, y - 26], [x + 6, y - 22]], { w: 1.4, color: SACK_D, shade: false, taper: 0, jitter: 0.2, seed: seed + 5 });
  shape(ctx, ellipsePts(x - 12, y - 19, 6.8, 6.2, seed + 6, 0.18, 22), SACK, { w: 1.5, seed: seed + 7 });
  flat(ctx, ellipsePts(x - 14, y - 17, 3.4, 3.4, seed + 8, 0.12, 14), SACK_D, 0.5);
  ink(ctx, [[x - 16.5, y - 20], [x - 13, y - 23], [x - 8.5, y - 21]], { w: 0.9, color: SACK_D, alpha: 0.8, shade: false, taper: 0.4, jitter: 0, seed: seed + 9 });
  shape(ctx, [[x - 11, y - 25], [x - 9.5, y - 28.5], [x - 7, y - 27.5], [x - 8, y - 24.5]], SACK_D, { w: 1, seed: seed + 12 });
  // The hood: bent low before the hunch, its long tip blown back over the sack.
  const fl = Math.sin(ph) * 1.2;
  shape(ctx, [[x + 1, y - 34], [x - 5, y - 38], [x - 11, y - 37.5 + fl], [x - 15.5, y - 34 + fl * 1.4], [x - 10, y - 33.5], [x - 4, y - 31.5]], CLOAK_D, { w: 1.3, seed: seed + 13 });
  const hood: Pt[] = [[x - 1, y - 31], [x + 3, y - 36.5], [x + 10, y - 37], [x + 15.5, y - 32], [x + 17.5, y - 25], [x + 15, y - 19.5], [x + 9, y - 18.5], [x + 4, y - 22.5]];
  shape(ctx, hood, CLOAK, { w: 1.9, seed: seed + 14 });
  // The moonlit rim: along the hood's crown and the hunch.
  ink(ctx, [[x - 9, y - 31], [x - 4, y - 34.5], [x + 3, y - 36.4], [x + 10, y - 36.6], [x + 14.5, y - 32.5]], { w: 1.6, color: RIM, alpha: 0.8, shade: false, taper: 0.4, jitter: 0, seed: seed + 15 });
  // The hood's deep mouth, lit faintly from within, and the lantern eyes.
  flat(ctx, ellipsePts(x + 11.8, y - 25.8, 4.6, 5, seed + 16, 0.06, 20), C.ink, 0.97);
  ink(ctx, [[x + 8, y - 22], [x + 11.5, y - 21.2], [x + 15.2, y - 23]], { w: 1, color: C.glowTurq, alpha: 0.45, shade: false, taper: 0.5, jitter: 0, seed: seed + 17 });
  const [ex, ey] = GLEANER_EYE;
  for (const dx of [-1.9, 1.9]) {
    flat(ctx, ellipsePts(ex + dx, ey + dx * 0.25, 2.9, 2.5, seed + 18, 0, 12), C.glowTurq, 0.4);
    flat(ctx, ellipsePts(ex + dx, ey + dx * 0.25, 1.5, 1.35, seed + 19, 0, 12), EYE);
  }
  if (p !== 'reach') arm(ctx, p === 'carry', seed + 40);
  ctx.restore();
}

/** The arm in the picture: hanging forward (gliding), or raised before the hood (carrying). */
function arm(ctx: Ctx, carry: boolean, seed: number): void {
  const sh: Pt = [BX + 7, HY - 20];
  const el: Pt = carry ? [BX + 15, HY - 18] : [BX + 11, HY - 13];
  const hd: Pt = carry ? [BX + 18.5, HY - 30] : [BX + 14, HY - 8];
  ink(ctx, [sh, el, hd], { w: 3.4, color: C.ink, shade: false, taper: 0.3, jitter: 0.2, seed });
  ink(ctx, [sh, el, hd], { w: 2, color: LIMB, shade: false, taper: 0.3, jitter: 0.2, seed });
  const fingers: ReadonlyArray<readonly [number, number]> = carry ? [[-3.5, -3.5], [0, -5], [3.5, -3]] : [[2.5, 2.5], [4, 0.5], [0.5, 4]];
  for (const [i, [dx, dy]] of fingers.entries()) {
    ink(ctx, [hd, [hd[0] + dx * 0.55 + (carry ? 0 : 0.6), hd[1] + dy * 0.55], [hd[0] + dx, hd[1] + dy]], { w: 1.1, color: LIMB, shade: false, taper: 0.7, jitter: 0, seed: seed + 1 + i });
  }
}

/** The long arm's canvas (px): from its root (the shoulder) to its hand, where it holds what it takes. */
export const ARM_W = 64, ARM_H = 16;
export const ARM_ROOT: Pt = [3, 8];
export const ARM_TIP: Pt = [57, 8];

/** A Gleaner's long arm, reaching right: a thin tendril bowed a little, a small palm, three long fingers spread. */
export function drawGleanerArm(ctx: Ctx, seed = 9): void {
  const pts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push([ARM_ROOT[0] + t * 49, ARM_ROOT[1] - Math.sin(t * Math.PI) * 2.4 + Math.sin(t * Math.PI * 2) * 0.7]);
  }
  ink(ctx, pts, { w: 4.4, color: C.ink, shade: false, taper: 0.4, jitter: 0, seed });
  ink(ctx, pts, { w: 2.8, color: LIMB, shade: false, taper: 0.45, jitter: 0, seed });
  ink(ctx, pts.slice(1, 9), { w: 0.9, color: RIM, alpha: 0.7, shade: false, taper: 0.5, jitter: 0, seed: seed + 1 });
  const fingers = [[61, 3], [63, 8], [61, 13]] as const;
  for (const [i, [fx, fy]] of fingers.entries()) ink(ctx, [[53, 8], [(53 + fx) / 2 + 0.5, (8 + fy) / 2], [fx, fy]], { w: 2.4, color: C.ink, shade: false, taper: 0.7, jitter: 0, seed: seed + 3 + i });
  shape(ctx, ellipsePts(53, 8, 2.8, 2.5, seed + 2, 0, 12), LIMB, { w: 1, seed: seed + 6 });
  for (const [i, [fx, fy]] of fingers.entries()) ink(ctx, [[53, 8], [(53 + fx) / 2 + 0.5, (8 + fy) / 2], [fx, fy]], { w: 1.3, color: LIMB, shade: false, taper: 0.7, jitter: 0, seed: seed + 3 + i });
}

/** Its shadow on the sand (32 × 16 px): soft, dark, under where it floats. */
export function drawGleanerShadow(ctx: Ctx): void {
  ctx.save();
  ctx.translate(16, 8);
  ctx.scale(1, 0.48);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
  g.addColorStop(0, 'rgba(20, 16, 40, 0.6)');
  g.addColorStop(0.6, 'rgba(20, 16, 40, 0.3)');
  g.addColorStop(1, 'rgba(20, 16, 40, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The soft halo of a Gleaner's lantern eyes (or of a taken item), additive: a 32 px canvas. */
export function drawEyeGlow(ctx: Ctx, color: string = C.glowTurq): void {
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, color);
  g.addColorStop(0.35, mix(color, '#000000', 0.55));
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
}

const S = BELT_PX;
/** The hood is a little wider than the belt and its rails (recipes/belts.ts: band 0.6, rails 6 px). */
const HOOD = 0.86;

/** The glass hood over a glazed ribbon: a straight piece (moving north) or the corner (in at the bottom, out at the right). */
export function drawGlassCover(ctx: Ctx, corner: boolean, seed = 5): void {
  const x0 = (S * (1 - HOOD)) / 2, x1 = S - x0;
  if (!corner) {
    flat(ctx, [[x0, 0], [x1, 0], [x1, S], [x0, S]], C.ice, 0.28);
    // Glints across the hood, over what rides under it: the glass reads on top.
    for (const y of [S * 0.18, S * 0.62]) ink(ctx, [[x0 + 6, y + 10], [x1 - 8, y]], { w: 2.4, color: '#ffffff', alpha: 0.6, shade: false, taper: 0.3, jitter: 0, seed: seed + y });
    // A rib every quarter tile: the hood's frame, faint.
    for (let y = 8; y < S; y += 16) ink(ctx, [[x0 + 1, y], [x1 - 1, y]], { w: 1, color: '#ffffff', alpha: 0.32, shade: false, taper: 0, jitter: 0, seed: seed + y });
    // Two glints along the light side, and the rims.
    ink(ctx, [[x0 + 5, -2], [x0 + 5, S + 2]], { w: 2.2, color: '#ffffff', alpha: 0.55, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
    ink(ctx, [[x0 + 9, S * 0.2], [x0 + 9, S * 0.45]], { w: 1.4, color: '#ffffff', alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: seed + 2 });
    for (const x of [x0, x1]) ink(ctx, [[x, -2], [x, S + 2]], { w: 1.3, color: mix(C.ice, C.ink, 0.45), alpha: 0.75, shade: false, taper: 0, jitter: 0.1, seed: seed + 3 + x });
    return;
  }
  const rIn = x0, rOut = x1; // radii round the bottom-right corner (S, S), as the belt's corner
  const arc = (r: number, n = 20): Pt[] => Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI + (i / n) * (Math.PI / 2);
    return [S + Math.cos(a) * r, S + Math.sin(a) * r] as Pt;
  });
  flat(ctx, [...arc(rIn), ...arc(rOut).reverse()], C.ice, 0.28);
  ink(ctx, arc(rOut - 5), { w: 2.2, color: '#ffffff', alpha: 0.55, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  for (const r of [rIn, rOut]) ink(ctx, arc(r), { w: 1.3, color: mix(C.ice, C.ink, 0.45), alpha: 0.75, shade: false, taper: 0, jitter: 0.1, seed: seed + 3 + r });
}

// ── the fence ───────────────────────────────────────────────────────────────

/** The fence's posts, inset from the tile's edges (tiles), its height (levels). */
const POST_IN = 0.12, FENCE_H = 0.55;
const STEEL = mix(C.steel, C.peachD, 0.2);

/** The mesh on one side of the cage, from post a to post b (local tiles), as a chain-link diamond. */
function meshIso(ctx: Ctx, f: IsoFrame, a: readonly [number, number], b: readonly [number, number], alpha: number, seed: number): void {
  const n = 6, z0 = 0.06, z1 = FENCE_H - 0.06;
  const at = (u: number, z: number): Pt => f.p(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, z);
  for (let i = 0; i <= n; i++) {
    const u = i / n, du = 1 / n;
    ink(ctx, [at(u, z0), at(Math.min(1, u + du * 2), z1)], { w: 0.9, color: C.steelL, alpha, shade: false, taper: 0, jitter: 0, seed: seed + i });
    ink(ctx, [at(u, z0), at(Math.max(0, u - du * 2), z1)], { w: 0.9, color: C.steelL, alpha, shade: false, taper: 0, jitter: 0, seed: seed + 20 + i });
  }
  // The top rail and the bottom wire.
  ink(ctx, [at(0, FENCE_H), at(1, FENCE_H)], { w: 2.2, color: C.ink, alpha: Math.min(1, alpha + 0.25), shade: false, taper: 0, jitter: 0.1, seed: seed + 40 });
  ink(ctx, [at(0, FENCE_H), at(1, FENCE_H)], { w: 1, color: STEEL, alpha, shade: false, taper: 0, jitter: 0, seed: seed + 41 });
  ink(ctx, [at(0, z0), at(1, z0)], { w: 1, color: C.inkSoft, alpha: alpha * 0.8, shade: false, taper: 0, jitter: 0.1, seed: seed + 42 });
}

/** A post: from the ground to above the rail, inked, a highlight on its lit side. */
function postIso(ctx: Ctx, f: IsoFrame, x: number, y: number, seed: number): void {
  const a = f.p(x, y, 0), b = f.p(x, y, FENCE_H + 0.12);
  ink(ctx, [a, b], { w: 3.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed });
  ink(ctx, [[a[0] - 0.6, a[1]], [b[0] - 0.6, b[1]]], { w: 1.4, color: STEEL, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
}

/** The fence in iso: its dusty footing, the far mesh, the posts far to near, the near mesh, a reflector. */
export function fenceIso(ctx: Ctx, f: IsoFrame, s: number): void {
  const lo = POST_IN, hi = 1 - POST_IN;
  flat(ctx, [f.p(0.04, 0.04), f.p(0.96, 0.04), f.p(0.96, 0.96), f.p(0.04, 0.96)], mix(C.sand, C.mesa, 0.4), 0.45);
  const corners: Array<readonly [number, number]> = [[lo, lo], [hi, lo], [hi, hi], [lo, hi]];
  // Sides by depth: the two far ones under the posts, the two near ones over them.
  const sides = corners.map((c, i) => [c, corners[(i + 1) % 4]!] as const)
    .map(([a, b]) => ({ a, b, d: f.depth((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }))
    .sort((p, q) => p.d - q.d);
  const mid = f.depth(0.5, 0.5);
  for (const [i, sd] of sides.entries()) if (sd.d < mid) meshIso(ctx, f, sd.a, sd.b, 0.55, s + i * 50);
  for (const [i, c] of corners.slice().sort((p, q) => f.depth(p[0], p[1]) - f.depth(q[0], q[1])).entries()) postIso(ctx, f, c[0], c[1], s + 200 + i * 3);
  for (const [i, sd] of sides.entries()) if (sd.d >= mid) meshIso(ctx, f, sd.a, sd.b, 0.95, s + 300 + i * 50);
  const near = corners.reduce((p, q) => (f.depth(q[0], q[1]) > f.depth(p[0], p[1]) ? q : p));
  const r = f.p(near[0], near[1], FENCE_H * 0.7);
  flat(ctx, ellipsePts(r[0], r[1], 2.6, 2.6, s + 400, 0, 12), C.warn);
  light(ctx, r[0], r[1], 1.2, C.ledWarm);
}

/** The fence from above: its shadow, the mesh's diamonds, the rail all round, the posts. */
export function fenceTop(ctx: Ctx, f: Frame, s: number): void {
  const lo = POST_IN, hi = 1 - POST_IN;
  const sq = [f.p(lo, lo), f.p(hi, lo), f.p(hi, hi), f.p(lo, hi)];
  const d = f.l(0.1);
  flat(ctx, sq.map(([x, y]) => [x + d * 0.7, y + d] as Pt), C.inkSoft, 0.22);
  flat(ctx, [f.p(0.04, 0.04), f.p(0.96, 0.04), f.p(0.96, 0.96), f.p(0.04, 0.96)], mix(C.sand, C.mesa, 0.4), 0.4);
  // The mesh seen from above: a diamond lattice inside the rail, faint.
  for (let i = -4; i <= 4; i++) {
    const t = i / 5;
    ink(ctx, [f.p(lo + Math.max(0, t) * (hi - lo), lo + Math.max(0, -t) * (hi - lo)), f.p(hi - Math.max(0, -t) * (hi - lo), hi - Math.max(0, t) * (hi - lo))], { w: 0.9, color: C.steelL, alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: s + i + 10 });
    ink(ctx, [f.p(lo + Math.max(0, t) * (hi - lo), hi - Math.max(0, -t) * (hi - lo)), f.p(hi - Math.max(0, -t) * (hi - lo), lo + Math.max(0, t) * (hi - lo))], { w: 0.9, color: C.steelL, alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: s + i + 30 });
  }
  ink(ctx, [...sq, sq[0]!], { w: f.l(0.07), color: C.ink, shade: false, taper: 0, jitter: 0.1, seed: s + 1 });
  ink(ctx, [...sq, sq[0]!], { w: f.l(0.035), color: STEEL, shade: false, taper: 0, jitter: 0, seed: s + 2 });
  for (const [x, y] of sq) shape(ctx, ellipsePts(x, y, f.l(0.06), f.l(0.06), s + 3, 0, 12), STEEL, { w: 1.2, shade: false, jitter: 0, seed: s + 4 });
  light(ctx, ...f.p(hi, hi), f.l(0.03), C.ledWarm);
}
