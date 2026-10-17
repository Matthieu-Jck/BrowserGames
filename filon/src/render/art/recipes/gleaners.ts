// gleaners.ts — the art of the Gleaners (D103) and of what keeps them off: the small desert people
// themselves, their lantern eyes' glow, the glass hood over a glazed ribbon, and the fence.
//
// - **A Gleaner** (`drawGleaner`): a small, quick, lanky figure, a bent hood ending in a long tip
//   blown back by the Sough, a dusty ochre cloak over spindly legs (four walk frames), a thin arm
//   reaching forward, and under the hood two lantern eyes. Drawn upright, its feet at the canvas's
//   bottom centre. The eyes are bright in the picture; their halo is a separate soft glow
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

/** A Gleaner's canvas (px) and where its feet stand in it. */
export const GLEANER_W = 40, GLEANER_H = 52;
export const GLEANER_FRAMES = 4;
/** Its eyes in the canvas (px, before any flip): the lantern glows go there. */
export const GLEANER_EYE: Pt = [22.5, 15.5];
/** Its raised hand, where it carries what it took (px). */
export const GLEANER_HAND: Pt = [32, 20];
/** Its hand reaching down onto a ribbon (px, the body leant in): where it picks the item up, or taps the glass. */
export const GLEANER_REACH: Pt = [33.5, 44.8];
/** Its eyes when it leans in to reach (px). */
export const GLEANER_EYE_REACH: Pt = [30, 16.9];

/** How it stands: walking (arm forward), carrying (arm up, holding), reaching (leaning in, arm down onto the ribbon). */
export type GleanerPose = 'walk' | 'carry' | 'reach';

// A dark silhouette against the night and its own halo, so the lantern eyes are what one sees first.
const CLOAK = mix(C.mesa, C.inkSoft, 0.5);
const CLOAK_D = mix(C.inkSoft, C.ink, 0.35);
const LIMB = mix(C.ink, C.lilacD, 0.3);
const EYE = '#e9fff6';

/**
 * One frame of a Gleaner facing right (`frame` 0…3: the legs' stride): walking, carrying (its arm
 * raised with something held up: the views draw the item there), or reaching (leaning in, its long
 * arm down onto the ribbon, `GLEANER_REACH`).
 */
export function drawGleaner(ctx: Ctx, frame: number, pose: GleanerPose | boolean, seed = 7): void {
  const p: GleanerPose = pose === true ? 'carry' : pose === false ? 'walk' : pose;
  const carry = p === 'carry';
  const bx = 20, by = GLEANER_H - 2; // feet
  const k = p === 'reach' ? 1 : frame % GLEANER_FRAMES;
  ctx.save();
  if (p === 'reach') { ctx.translate(bx, by); ctx.rotate(0.22); ctx.translate(-bx, -by); } // leaning in
  // Legs: two pairs, spindly, striding (a quick alien gait: the far pair opposite the near).
  const stride = ([[-5, 4], [-1, 1], [4, -5], [1, -1]] as const)[k]!;
  const hip: Pt = [bx + 1, by - 17];
  for (const [i, dx] of [stride[1], stride[0]].entries()) {
    const foot: Pt = [bx + dx * 1.2, by];
    const knee: Pt = [bx + dx * 0.5 + 3, by - 9 - (i ? 0 : 1)];
    ink(ctx, [hip, knee, foot], { w: i ? 2.2 : 1.6, color: i ? LIMB : mix(LIMB, C.lilacD, 0.4), shade: false, taper: 0.2, jitter: 0.2, seed: seed + i });
  }
  // The cloak: a teardrop from the shoulders to the hips, hem fluttering back.
  const flutter = k % 2 ? 1.5 : -0.5;
  const cloak: Pt[] = [
    [bx - 3, by - 34], [bx + 5, by - 33], [bx + 9, by - 26], [bx + 8, by - 18], [bx + 3, by - 13],
    [bx - 4, by - 14 + flutter], [bx - 10, by - 15 + flutter], [bx - 8, by - 22], [bx - 6, by - 29],
  ];
  shape(ctx, cloak, CLOAK, { w: 1.6, seed: seed + 3 });
  flat(ctx, [[bx - 8, by - 22], [bx - 6, by - 29], [bx - 3, by - 33], [bx - 1, by - 22], [bx - 4, by - 14 + flutter], [bx - 10, by - 15 + flutter]], CLOAK_D, 0.55);
  // The arm: reaching forward, or raised with what it carries.
  const sh: Pt = [bx + 5, by - 29];
  // Reaching, the hand is where the ribbon is once the body leans (GLEANER_REACH in the upright frame).
  const hand: Pt = carry ? GLEANER_HAND : p === 'reach' ? [bx + 12, by - 8] : [bx + 15, by - 22];
  const elbow: Pt = carry ? [bx + 10, by - 24] : p === 'reach' ? [bx + 11, by - 19] : [bx + 10, by - 25];
  ink(ctx, [sh, elbow, hand], { w: 1.8, color: LIMB, shade: false, taper: 0.1, jitter: 0.2, seed: seed + 4 });
  for (let i = 0; i < 3; i++) ink(ctx, [hand, [hand[0] + 2 + i, hand[1] - 2 + i * 2]], { w: 0.9, color: LIMB, shade: false, taper: 0.4, jitter: 0, seed: seed + 5 + i });
  // The hood: a round head bent forward, its long tip blown back by the wind.
  const hood: Pt[] = [
    [bx - 4, by - 33], [bx - 6, by - 39], [bx - 3, by - 44], [bx + 3, by - 46], [bx + 9, by - 43],
    [bx + 11, by - 37], [bx + 8, by - 32], [bx + 2, by - 31],
  ];
  shape(ctx, hood, CLOAK, { w: 1.7, seed: seed + 8 });
  shape(ctx, [[bx - 3, by - 44], [bx - 12, by - 47], [bx - 19, by - 45], [bx - 11, by - 43], [bx - 5, by - 40]], CLOAK_D, { w: 1.3, seed: seed + 9 });
  // The hood's dark mouth and the two lantern eyes in it.
  flat(ctx, ellipsePts(bx + 5, by - 37, 5, 4, seed + 10, 0.05, 20), C.ink, 0.92);
  const [ex, ey] = GLEANER_EYE;
  for (const dx of [-2.2, 2]) {
    flat(ctx, ellipsePts(ex + dx, ey, 1.6, 1.4, seed + 11, 0, 12), EYE);
    flat(ctx, ellipsePts(ex + dx, ey, 2.8, 2.4, seed + 12, 0, 12), C.glowTurq, 0.35);
  }
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
