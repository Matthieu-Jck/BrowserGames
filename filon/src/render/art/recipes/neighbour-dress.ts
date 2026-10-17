// neighbour-dress.ts — what dresses a neighbouring base (D110; owner, 2026-10-17: « leurs bâtiments
// ressemblent trop aux miens, je n'arrive pas à les distinguer »): the pieces no base of the claim
// ever has, in the colony's emblem colours, so its land reads as someone else's at a glance, near or
// far. Canvas2D in the ink kit's hand, baked once per colour pair by the neighbours view:
// - a covered depot: a canvas dome tent in gores of its colours, a dark door, guy ropes, a pennant
//   on its crown (iso, 2 × 2 tiles; plan: the gores seen from above);
// - a banner pole: a tall weathered pole, a long swallow-tailed banner hanging from its crossbar;
// - a cairn: stacked stones with a strip of its cloth tied round, along the holding's edge;
// - a tarp: the patched, stitched ground cloth every one of its buildings stands on (flat, in tile
//   units: the same in both views), the widest patch of colour on its land;
// - its name on a cloth band, the billboard over its base from mid zoom out.
// Iso pieces are drawn at twice world px (sprites at half scale, like the buildings), anchored at
// their footprint's ground corner (tile x, y); plan and ground pieces at 64 px a tile.
import { flat, ink, ellipsePts, type Ctx, type Pt } from '../ink';
import { light } from '../shapes';
import { C, mix } from '../tokens';
import { LH, TH, TW } from '../../iso';

/** A base's colours: its emblem's field and symbol colours, and the weathered cloth they fade to. */
export interface DressColours { field: string; mark: string }

/** Iso pieces' bake scale (px of texture a world px), and plan pieces' px a tile. */
export const DRESS_K = 2;
export const PLAN_PX = 64;

/** A tile point (u, v) at height z (levels) in a footprint's iso frame, at the bake scale, from origin (ox, oy). */
const iso = (ox: number, oy: number, u: number, v: number, z = 0): Pt => [ox + ((u - v) * TW) / 2 * DRESS_K, oy + (((u + v) * TH) / 2 - z * LH) * DRESS_K];

/** The cloth's own colours: the field and paper striped, both a little sun-faded (weathered). */
export function cloth(c: DressColours): { a: string; b: string; dark: string } {
  return { a: mix(c.field, C.paperD, 0.18), b: mix(C.paper, c.field, 0.12), dark: mix(c.field, C.ink, 0.45) };
}

/** A canvas of w × h px with the ink kit's joins. */
function canvas(w: number, h: number): CanvasRenderingContext2D {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h));
  const ctx = cv.getContext('2d')!;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  return ctx;
}

/** Iso piece sizes: the frame's width and height (px at the bake scale) and its anchor (the footprint's ground corner). */
export interface IsoPiece { w: number; h: number; ox: number; oy: number }

/** A covered depot's frame: `n` tiles a side, its crown `top` levels up. */
export function tentFrame(n: number): IsoPiece {
  const w = n * TW * DRESS_K + 24, h = (n * TH + 3.2 * LH) * DRESS_K + 24;
  return { w, h, ox: w / 2, oy: 3.2 * LH * DRESS_K + 12 };
}

/** A covered depot in iso: a dome tent of gores, its door towards the viewer, guy ropes and a pennant. */
export function drawTent(ctx: Ctx, n: number, c: DressColours, f = tentFrame(n)): void {
  const col = cloth(c), cu = n / 2, cv = n / 2, r = n * 0.46, H = 2.2;
  const O = (u: number, v: number, z = 0): Pt => iso(f.ox, f.oy, u, v, z);
  // The shadow it casts on the ground, down-right.
  flat(ctx, ellipsePts(...O(cu + 0.25, cv + 0.15), r * TW * 0.78 * DRESS_K, r * TH * 0.78 * DRESS_K, 3, 0.04), C.ink, 0.16);
  // The dome: gores from the base circle to the crown, the far ones first; each a lune between two meridians.
  const G = 10;
  const meridian = (a: number): Pt[] => Array.from({ length: 9 }, (_, k) => {
    const t = k / 8, rr = r * Math.cos((t * Math.PI) / 2), z = H * Math.sin((t * Math.PI) / 2);
    return O(cu + rr * Math.cos(a), cv + rr * Math.sin(a), z);
  });
  const order = Array.from({ length: G }, (_, g) => g).sort((a, b) => Math.sin(((a + 0.5) / G) * Math.PI * 2 + Math.PI / 4) - Math.sin(((b + 0.5) / G) * Math.PI * 2 + Math.PI / 4));
  for (const g of order) {
    const a0 = (g / G) * Math.PI * 2, a1 = ((g + 1) / G) * Math.PI * 2;
    const pts = [...meridian(a0), ...meridian(a1).reverse()];
    flat(ctx, pts, g % 2 ? col.a : col.b);
    // Shade the gores turned from the light (top-left).
    const facing = Math.cos(((a0 + a1) / 2) - Math.PI * 1.25);
    if (facing < 0) flat(ctx, pts, C.ink, -facing * 0.22);
  }
  // A patch sewn on, and the seams of the front gores.
  const pa = Math.PI * 0.62;
  const patch = [O(cu + r * 0.7 * Math.cos(pa), cv + r * 0.7 * Math.sin(pa), 0.5), O(cu + r * 0.62 * Math.cos(pa + 0.3), cv + r * 0.62 * Math.sin(pa + 0.3), 0.55), O(cu + r * 0.55 * Math.cos(pa + 0.3), cv + r * 0.55 * Math.sin(pa + 0.3), 1.0), O(cu + r * 0.62 * Math.cos(pa), cv + r * 0.62 * Math.sin(pa), 0.95)];
  flat(ctx, patch, mix(C.peachD, c.field, 0.3));
  ink(ctx, patch, { closed: true, w: 1.1, alpha: 0.7, jitter: 0.3 });
  for (let g = 0; g < G; g++) {
    const a = (g / G) * Math.PI * 2;
    if (Math.sin(a + Math.PI / 4) < -0.2) continue; // the far side's seams are hidden
    ink(ctx, meridian(a), { w: 1, alpha: 0.55, taper: 0, jitter: 0.2 });
  }
  // The door: a dark arch on the front, its flap rolled up.
  const da = Math.PI / 4, dw = 0.32;
  const door = [O(cu + r * Math.cos(da - dw), cv + r * Math.sin(da - dw), 0), O(cu + r * 0.93 * Math.cos(da - dw * 0.7), cv + r * 0.93 * Math.sin(da - dw * 0.7), 0.9), O(cu + r * 0.88 * Math.cos(da), cv + r * 0.88 * Math.sin(da), 1.15), O(cu + r * 0.93 * Math.cos(da + dw * 0.7), cv + r * 0.93 * Math.sin(da + dw * 0.7), 0.9), O(cu + r * Math.cos(da + dw), cv + r * Math.sin(da + dw), 0)];
  flat(ctx, door, mix(C.ink, c.field, 0.2));
  ink(ctx, door, { closed: true, w: 1.3, jitter: 0.2 });
  // The outline: the base's near half and the dome's silhouette.
  const rim = Array.from({ length: 25 }, (_, k) => { const a = -Math.PI / 4 + (k / 24) * Math.PI; return O(cu + r * Math.cos(a), cv + r * Math.sin(a)); });
  ink(ctx, rim, { w: 1.8, jitter: 0.3 });
  const sil = [...meridian(-Math.PI * 0.75), ...meridian(Math.PI * 0.25).reverse()];
  ink(ctx, sil, { w: 2, jitter: 0.3 });
  // Guy ropes to pegs, and the pennant on the crown.
  for (const a of [Math.PI * 0.05, Math.PI * 0.5, Math.PI * 0.95]) {
    ink(ctx, [O(cu + r * 0.75 * Math.cos(a), cv + r * 0.75 * Math.sin(a), H * 0.55), O(cu + (r + 0.32) * Math.cos(a), cv + (r + 0.32) * Math.sin(a), 0)], { w: 0.9, alpha: 0.6, jitter: 0.1 });
  }
  const top = O(cu, cv, H), mast = O(cu, cv, H + 0.9);
  ink(ctx, [top, mast], { w: 1.4, jitter: 0 });
  const pen = [mast, [mast[0] + 18, mast[1] + 5], [mast[0], mast[1] + 10]] as Pt[];
  flat(ctx, pen, c.field);
  ink(ctx, pen, { closed: true, w: 1, jitter: 0.1 });
}

/** A covered depot from above (plan, `n` tiles a side at PLAN_PX a tile): the gores round its crown. */
export function drawTentPlan(ctx: Ctx, n: number, c: DressColours): void {
  const col = cloth(c), R = n * PLAN_PX * 0.46, cx = (n * PLAN_PX) / 2, cy = cx, G = 10;
  for (let g = 0; g < G; g++) {
    const a0 = (g / G) * Math.PI * 2, a1 = ((g + 1) / G) * Math.PI * 2;
    flat(ctx, [[cx, cy], [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], [cx + R * Math.cos((a0 + a1) / 2) * 1.02, cy + R * Math.sin((a0 + a1) / 2) * 1.02], [cx + R * Math.cos(a1), cy + R * Math.sin(a1)]], g % 2 ? col.a : col.b);
  }
  ink(ctx, ellipsePts(cx, cy, R, R, 5, 0.02, 40), { closed: true, w: 2.2, jitter: 0.3 });
  flat(ctx, ellipsePts(cx, cy, R * 0.12, R * 0.12, 6, 0, 12), c.mark);
}

/** A banner pole's frame: 1 tile, its pole `POLE` levels high. */
const POLE = 5.4;
export function bannerFrame(): IsoPiece {
  const w = TW * DRESS_K + 60, h = (TH + (POLE + 0.6) * LH) * DRESS_K + 16;
  return { w, h, ox: w / 2 - 6, oy: (POLE + 0.6) * LH * DRESS_K + 8 };
}

/** A banner pole in iso: a weathered pole, a crossbar, a long swallow-tailed banner in its colours. */
export function drawBanner(ctx: Ctx, c: DressColours, f = bannerFrame()): void {
  const col = cloth(c);
  const foot = iso(f.ox, f.oy, 0.5, 0.5, 0), top = iso(f.ox, f.oy, 0.5, 0.5, POLE);
  flat(ctx, ellipsePts(foot[0] + 8, foot[1] + 3, 14, 6, 2, 0.05), C.ink, 0.15);
  // The pole: a dark timber, lit on its left.
  flat(ctx, [[foot[0] - 2.4, foot[1]], [foot[0] + 2.4, foot[1]], [top[0] + 1.6, top[1]], [top[0] - 1.6, top[1]]], mix(C.steelD, C.peachD, 0.35));
  ink(ctx, [[foot[0] - 2.4, foot[1]], [top[0] - 1.6, top[1]]], { w: 1.2, jitter: 0, taper: 0 });
  ink(ctx, [[foot[0] + 2.4, foot[1]], [top[0] + 1.6, top[1]]], { w: 1.2, jitter: 0, taper: 0 });
  // The crossbar and the banner hanging from it, swallow-tailed, a band of the symbol's colour.
  const bx0 = top[0] + 1, by = top[1] + 6, bw = 34, bh = 3.0 * LH * DRESS_K;
  ink(ctx, [[top[0] - 4, by], [bx0 + bw + 4, by]], { w: 2, jitter: 0 });
  const ban: Pt[] = [[bx0, by], [bx0 + bw, by], [bx0 + bw + 2, by + bh], [bx0 + bw / 2 + 1, by + bh - 16], [bx0 + 2, by + bh]];
  flat(ctx, ban, col.a);
  flat(ctx, [[bx0, by + bh * 0.22], [bx0 + bw, by + bh * 0.22], [bx0 + bw + 0.4, by + bh * 0.36], [bx0 + 0.4, by + bh * 0.36]], c.mark, 0.9);
  flat(ctx, ellipsePts(bx0 + bw / 2 + 1, by + bh * 0.6, 7, 7, 4, 0.02, 14), c.mark, 0.9);
  // The cloth's fold shading, its outline.
  flat(ctx, [[bx0 + bw * 0.62, by], [bx0 + bw, by], [bx0 + bw + 2, by + bh], [bx0 + bw * 0.75, by + bh - 9]], C.ink, 0.14);
  ink(ctx, ban, { closed: true, w: 1.5, jitter: 0.2 });
  light(ctx, top[0], top[1] - 4, 2.4, C.ledWarm);
}

/** A banner pole from above (plan, one tile): its top and the banner's end. */
export function drawBannerPlan(ctx: Ctx, c: DressColours): void {
  const col = cloth(c), m = PLAN_PX / 2;
  flat(ctx, [[m, m - 4], [m + 26, m - 4], [m + 30, m + 6], [m + 22, m + 2], [m + 16, m + 8], [m, m + 4]], col.a);
  ink(ctx, [[m, m - 4], [m + 26, m - 4], [m + 30, m + 6], [m + 22, m + 2], [m + 16, m + 8], [m, m + 4]], { closed: true, w: 1.6, jitter: 0.2 });
  flat(ctx, ellipsePts(m, m, 6, 6, 3, 0, 12), mix(C.steelD, C.peachD, 0.35));
  ink(ctx, ellipsePts(m, m, 6, 6, 3, 0, 12), { closed: true, w: 1.4, jitter: 0 });
}

/** A cairn's frame: 1 tile, a little over a level high. */
export function cairnFrame(): IsoPiece {
  const w = TW * DRESS_K + 8, h = (TH + 1.6 * LH) * DRESS_K + 8;
  return { w, h, ox: w / 2, oy: 1.6 * LH * DRESS_K + 4 };
}

/** A cairn in iso: three stacked stones, a strip of its cloth tied round the middle one. */
export function drawCairn(ctx: Ctx, c: DressColours, f = cairnFrame()): void {
  const [x, y] = iso(f.ox, f.oy, 0.5, 0.5, 0);
  flat(ctx, ellipsePts(x + 6, y + 2, 20, 8, 2, 0.05), C.ink, 0.15);
  const stones: Array<[number, number, number, number, string]> = [[0, -6, 17, 9, C.rock3], [1, -17, 13, 8, C.rock2], [-1, -27, 9, 6, C.rock1]];
  for (const [dx, dy, rx, ry, col] of stones) {
    const pts = ellipsePts(x + dx, y + dy, rx, ry, 7 + dy, 0.12, 20);
    flat(ctx, pts, col);
    flat(ctx, ellipsePts(x + dx + rx * 0.3, y + dy + ry * 0.3, rx * 0.7, ry * 0.6, 3, 0.1, 16), C.ink, 0.18);
    ink(ctx, pts, { closed: true, w: 1.4, jitter: 0.4 });
  }
  const strip: Pt[] = [[x - 12, y - 18], [x + 13, y - 19], [x + 15, y - 14], [x + 22, y - 6], [x + 17, y - 5], [x + 11, y - 13], [x - 11, y - 13]];
  flat(ctx, strip, c.field);
  ink(ctx, strip, { closed: true, w: 1.1, jitter: 0.2 });
}

/** A cairn from above (plan, one tile). */
export function drawCairnPlan(ctx: Ctx, c: DressColours): void {
  const m = PLAN_PX / 2;
  flat(ctx, ellipsePts(m, m, 15, 13, 4, 0.12, 18), C.rock2);
  ink(ctx, ellipsePts(m, m, 15, 13, 4, 0.12, 18), { closed: true, w: 1.6, jitter: 0.4 });
  flat(ctx, [[m - 14, m - 3], [m + 14, m - 4], [m + 22, m + 4], [m + 14, m + 3], [m - 14, m + 4]], c.field);
  ink(ctx, [[m - 14, m - 3], [m + 14, m - 4], [m + 22, m + 4], [m + 14, m + 3], [m - 14, m + 4]], { closed: true, w: 1.1, jitter: 0.2 });
}

/** A tarp under a w × h footprint, `m` tiles of hem round it (flat, PLAN_PX a tile): patched and stitched cloth. */
export function drawTarp(ctx: Ctx, w: number, h: number, m: number, c: DressColours, seed: number): void {
  const col = cloth(c), W = (w + 2 * m) * PLAN_PX, H = (h + 2 * m) * PLAN_PX;
  let s = (seed * 2654435761) >>> 0;
  const rnd = (): number => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  const edge: Pt[] = [[3 + rnd() * 6, 3 + rnd() * 6], [W - 3 - rnd() * 6, 3 + rnd() * 6], [W - 3 - rnd() * 6, H - 3 - rnd() * 6], [3 + rnd() * 6, H - 3 - rnd() * 6]];
  flat(ctx, edge, col.a, 0.95);
  // Patches sewn over it: squares of the other cloth and of a faded ochre.
  const patches = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < patches; k++) {
    const pw = (0.6 + rnd() * 1.1) * PLAN_PX, ph = (0.5 + rnd() * 0.9) * PLAN_PX, px = 6 + rnd() * Math.max(1, W - pw - 12), py = 6 + rnd() * Math.max(1, H - ph - 12);
    const pts: Pt[] = [[px, py], [px + pw, py + rnd() * 3], [px + pw - rnd() * 3, py + ph], [px + rnd() * 3, py + ph]];
    flat(ctx, pts, k % 2 ? col.b : mix(C.peachD, c.field, 0.25), 0.95);
    // Its stitches.
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!, b = pts[(i + 1) % 4]!, n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9));
      for (let j = 0; j < n; j++) {
        const t0 = (j + 0.2) / n, t1 = (j + 0.6) / n;
        ink(ctx, [[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]], { w: 0.9, alpha: 0.45, jitter: 0, taper: 0 });
      }
    }
  }
  // A band of its colours along the hem, the hem stitched, the edge inked.
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 6;
  ctx.beginPath(); edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
  ctx.restore();
  ink(ctx, edge, { closed: true, w: 1.6, alpha: 0.75, jitter: 0.4 });
}

/** The name band's frame for a name: its texture size at the bake scale and its anchor (the band's bottom middle). */
export function nameFrame(name: string): IsoPiece {
  const ctx = canvas(4, 4);
  ctx.font = NAME_FONT;
  const tw = Math.ceil(ctx.measureText(name).width);
  const w = tw + 76, h = 58;
  return { w, h, ox: w / 2, oy: h - 4 };
}
const NAME_FONT = "600 30px 'Patrick Hand SC', 'Comic Sans MS', sans-serif";

/** A neighbouring base's name on a cloth band with folded ends, in its colours (the billboard over it). */
export function drawName(ctx: Ctx, name: string, c: DressColours, f = nameFrame(name)): void {
  const col = cloth(c), x0 = 22, x1 = f.w - 22, y0 = 8, y1 = f.h - 14;
  // The folded ends behind the band.
  for (const [a, b] of [[x0, x0 - 16], [x1, x1 + 16]] as const) {
    const end: Pt[] = [[a, y0 + 8], [b, y0 + 8], [b + (b < a ? 7 : -7), (y0 + y1) / 2 + 4], [b, y1 + 8], [a, y1 + 8]];
    flat(ctx, end, col.dark);
    ink(ctx, end, { closed: true, w: 1.4, jitter: 0.2 });
  }
  const band: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  flat(ctx, band, col.a);
  flat(ctx, [[x0, y1 - 6], [x1, y1 - 6], [x1, y1], [x0, y1]], c.mark, 0.8);
  ink(ctx, band, { closed: true, w: 1.8, jitter: 0.2 });
  ctx.save();
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = mix(C.paper, c.field, 0.2);
  const ty = (y0 + y1) / 2 - 2;
  ctx.strokeText(name, f.w / 2, ty);
  ctx.fillStyle = C.ink;
  ctx.fillText(name, f.w / 2, ty);
  ctx.restore();
}

// ── a neighbouring base's Core ─────────────────────────────────────────────────

/** What crowns a neighbouring base's Core (content `NEIGHBOUR_CORE_TOP`, by trade). */
export type CoreTop = 'mast' | 'chimney' | 'lantern' | 'dish';

/** The Core's footprint (tiles a side) and its heights (levels): the plinth's top, the drum's, the roof's apex. */
export const CORE = { n: 3, plinth: 0.32, drum: 1.35, apex: 2.45 } as const;

/** Where its wires hang (levels, at the footprint's middle) and its lanterns glow, by top piece. */
export function coreWireZ(top: CoreTop): number {
  return top === 'mast' ? 4.15 : top === 'lantern' ? 3.05 : top === 'dish' ? 2.95 : CORE.apex + 0.1;
}

/** The Core's iso frame. */
export function coreFrame(): IsoPiece {
  const w = CORE.n * TW * DRESS_K + 60, h = (CORE.n * TH + 5 * LH) * DRESS_K + 36;
  return { w, h, ox: w / 2, oy: 5 * LH * DRESS_K + 18 };
}

/**
 * A neighbouring base's Core in iso (owner, 2026-10-17: « ils devraient avoir un cœur, juste pas le
 * même que le mien », « plus petit »): no deck, no modules — a low octagonal plinth of patched stone,
 * a drum of weathered planks with a dark arched door, a conical canvas roof in gores of its colours,
 * canvas-wrapped crates on its four corners, two pennants from the roof's rim and, on its crown, its
 * trade's piece (a timber mast with a crossarm and a long banner, a brick chimney, a glass lantern, a
 * small dish). Smaller and lower than the claim's Core, and of other stuff altogether.
 */
export function drawCore(ctx: Ctx, top: CoreTop, c: DressColours, f = coreFrame()): void {
  const col = cloth(c), n = CORE.n, m = n / 2;
  const O = (u: number, v: number, z = 0): Pt => iso(f.ox, f.oy, u, v, z);
  const ring = (r: number, z: number, k = 24, a0 = 0, a1 = Math.PI * 2): Pt[] => Array.from({ length: k + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / k; return O(m + r * Math.cos(a), m + r * Math.sin(a), z); });
  const front = (r: number, z: number, k = 16): Pt[] => ring(r, z, k, -Math.PI / 4, Math.PI * 0.75);
  const stone = mix(C.rock2, C.peachD, 0.45), stoneD = mix(stone, C.ink, 0.3), plank = mix(C.peachD, C.steelD, 0.45), plankD = mix(plank, C.ink, 0.35);
  // Its shadow on the ground.
  flat(ctx, ellipsePts(...O(m + 0.45, m + 0.25), 1.45 * TW * 0.72 * DRESS_K, 1.45 * TH * 0.72 * DRESS_K, 5, 0.04), C.ink, 0.17);
  // A canvas-wrapped crate on a corner of the plinth (u, v: its centre).
  const crate = (u: number, v: number): void => {
    const s = 0.24, h = 0.5;
    const t = [O(u - s, v - s, h), O(u + s, v - s, h), O(u + s, v + s, h), O(u - s, v + s, h)];
    const l = [O(u - s, v + s, h), O(u + s, v + s, h), O(u + s, v + s, 0), O(u - s, v + s, 0)];
    const r = [O(u + s, v - s, h), O(u + s, v + s, h), O(u + s, v + s, 0), O(u + s, v - s, 0)];
    flat(ctx, l, col.dark); flat(ctx, r, mix(col.dark, C.ink, 0.25)); flat(ctx, t, col.a);
    ink(ctx, [O(u - s, v + s, h * 0.55), O(u + s, v + s, h * 0.55), O(u + s, v - s, h * 0.55)], { w: 1, alpha: 0.6, jitter: 0 }); // its rope
    for (const p of [t, l, r]) ink(ctx, p, { closed: true, w: 1.2, jitter: 0.2 });
  };
  crate(0.3, 0.3);
  // The plinth: an octagon of stone, its near faces in shade, patched.
  const oct = (z: number): Pt[] => Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + (i * Math.PI) / 4; return O(m + 1.42 * Math.cos(a), m + 1.42 * Math.sin(a), z); });
  const top0 = oct(CORE.plinth), bot0 = oct(0);
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4 + Math.PI / 8;
    if (Math.sin(a + Math.PI / 4) < -0.05) continue; // the far faces are hidden
    const j = (i + 1) % 8, face = [top0[i]!, top0[j]!, bot0[j]!, bot0[i]!];
    flat(ctx, face, Math.cos(a - Math.PI * 1.25) > 0 ? stone : stoneD);
    ink(ctx, face, { closed: true, w: 1.3, jitter: 0.3 });
  }
  flat(ctx, top0, mix(stone, C.paper, 0.15));
  ink(ctx, top0, { closed: true, w: 1.5, jitter: 0.3 });
  crate(0.3, 2.7); crate(2.7, 0.3);
  // The drum: weathered planks, a patch, a dark arched door towards the viewer.
  const rb = 1.0, z0 = CORE.plinth, z1 = CORE.drum;
  const fb = front(rb, z0), ft = front(rb, z1);
  const drum = [...ft, ...[...fb].reverse()];
  flat(ctx, drum, plank);
  flat(ctx, [...front(rb, z1, 16).slice(9), ...front(rb, z0, 16).slice(9).reverse()], C.ink, 0.16); // its right, in shade
  for (let k = 1; k < 16; k += 2) ink(ctx, [fb[k]!, ft[k]!], { w: 0.8, alpha: 0.45, jitter: 0.1, taper: 0 });
  const pa = Math.PI * 0.08;
  const patch = [O(m + rb * Math.cos(pa), m + rb * Math.sin(pa), 0.7), O(m + rb * Math.cos(pa + 0.42), m + rb * Math.sin(pa + 0.42), 0.68), O(m + rb * Math.cos(pa + 0.42), m + rb * Math.sin(pa + 0.42), 1.05), O(m + rb * Math.cos(pa), m + rb * Math.sin(pa), 1.08)];
  flat(ctx, patch, col.b);
  ink(ctx, patch, { closed: true, w: 1, alpha: 0.75, jitter: 0.2 });
  const da = Math.PI / 4, dw = 0.36;
  const door = [O(m + rb * Math.cos(da - dw), m + rb * Math.sin(da - dw), z0), O(m + rb * Math.cos(da - dw), m + rb * Math.sin(da - dw), 0.85), O(m + rb * Math.cos(da), m + rb * Math.sin(da), 1.08), O(m + rb * Math.cos(da + dw), m + rb * Math.sin(da + dw), 0.85), O(m + rb * Math.cos(da + dw), m + rb * Math.sin(da + dw), z0)];
  flat(ctx, door, mix(C.ink, plankD, 0.3));
  ink(ctx, door, { closed: true, w: 1.4, jitter: 0.2 });
  ink(ctx, fb, { w: 1.5, jitter: 0.2 });
  ink(ctx, [fb[0]!, ft[0]!], { w: 1.5, jitter: 0.1, taper: 0 });
  ink(ctx, [fb[fb.length - 1]!, ft[ft.length - 1]!], { w: 1.5, jitter: 0.1, taper: 0 });
  // The roof: a cone of canvas gores with a hem, overhanging the drum.
  const rr = 1.22, G = 12, apex = O(m, m, CORE.apex);
  const order = Array.from({ length: G }, (_, g) => g).sort((a, b) => Math.sin(((a + 0.5) / G) * Math.PI * 2 + Math.PI / 4) - Math.sin(((b + 0.5) / G) * Math.PI * 2 + Math.PI / 4));
  for (const g of order) {
    const a0 = (g / G) * Math.PI * 2, a1 = ((g + 1) / G) * Math.PI * 2;
    const pts = [apex, O(m + rr * Math.cos(a0), m + rr * Math.sin(a0), z1 - 0.05), O(m + rr * Math.cos(a1), m + rr * Math.sin(a1), z1 - 0.05)];
    flat(ctx, pts, g % 2 ? col.a : col.b);
    const facing = Math.cos((a0 + a1) / 2 - Math.PI * 1.25);
    if (facing < 0) flat(ctx, pts, C.ink, -facing * 0.24);
  }
  const hem = front(rr, z1 - 0.05, 18);
  ink(ctx, [O(m + rr * Math.cos(-Math.PI * 0.75), m + rr * Math.sin(-Math.PI * 0.75), z1 - 0.05), apex, O(m + rr * Math.cos(Math.PI * 0.25), m + rr * Math.sin(Math.PI * 0.25), z1 - 0.05)], { w: 1.8, jitter: 0.2 });
  ink(ctx, hem, { w: 1.8, jitter: 0.2 });
  // Scallops of its colour along the hem, and two pennants hanging from it.
  for (let k = 0; k < hem.length - 1; k += 2) {
    const a = hem[k]!, b = hem[k + 1]!;
    flat(ctx, [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 7]], c.field);
  }
  for (const k of [3, 14]) {
    const a = hem[k]!;
    const pen: Pt[] = [a, [a[0] + 9, a[1]], [a[0] + 9, a[1] + 30], [a[0] + 4.5, a[1] + 24], [a[0], a[1] + 30]];
    flat(ctx, pen, col.a);
    flat(ctx, [[a[0], a[1] + 6], [a[0] + 9, a[1] + 6], [a[0] + 9, a[1] + 10], [a[0], a[1] + 10]], c.mark, 0.9);
    ink(ctx, pen, { closed: true, w: 1, jitter: 0.1 });
  }
  crate(2.7, 2.7);
  // Its crown: a ring of timber, then its trade's piece.
  const crown = ellipsePts(apex[0], apex[1] + 2, 9, 4.5, 3, 0.02, 14);
  flat(ctx, crown, plankD);
  ink(ctx, crown, { closed: true, w: 1.3, jitter: 0 });
  if (top === 'mast') {
    const t = O(m, m, 4.6), arm = O(m, m, coreWireZ('mast'));
    flat(ctx, [[apex[0] - 2.2, apex[1]], [apex[0] + 2.2, apex[1]], [t[0] + 1.4, t[1]], [t[0] - 1.4, t[1]]], plankD);
    ink(ctx, [[apex[0] - 2.2, apex[1]], [t[0] - 1.4, t[1]]], { w: 1.1, jitter: 0, taper: 0 });
    ink(ctx, [[apex[0] + 2.2, apex[1]], [t[0] + 1.4, t[1]]], { w: 1.1, jitter: 0, taper: 0 });
    ink(ctx, [[arm[0] - 14, arm[1] + 4], [arm[0] + 14, arm[1] - 4]], { w: 2, jitter: 0 });
    for (const dx of [-12, 12]) flat(ctx, ellipsePts(arm[0] + dx, arm[1] - dx / 3.5 - 2, 2.2, 3, 2, 0, 8), C.ice);
    const ban: Pt[] = [[t[0] + 1.5, t[1] + 3], [t[0] + 30, t[1] + 9], [t[0] + 24, t[1] + 15], [t[0] + 30, t[1] + 21], [t[0] + 1.5, t[1] + 17]];
    flat(ctx, ban, col.a);
    ink(ctx, ban, { closed: true, w: 1.2, jitter: 0.1 });
    light(ctx, t[0], t[1] - 3, 2.2, C.ledWarm);
  } else if (top === 'chimney') {
    const b = O(m + 0.35, m - 0.35, CORE.apex - 0.35), t = O(m + 0.35, m - 0.35, 3.75), w = 7;
    const brick = mix(C.coralD, C.rock3, 0.5);
    flat(ctx, [[b[0] - w, b[1]], [b[0] + w, b[1]], [t[0] + w * 0.8, t[1]], [t[0] - w * 0.8, t[1]]], brick);
    flat(ctx, [[b[0] + 1, b[1]], [b[0] + w, b[1]], [t[0] + w * 0.8, t[1]], [t[0] + 1, t[1]]], C.ink, 0.2);
    for (let k = 1; k < 5; k++) { const y = b[1] + ((t[1] - b[1]) * k) / 5; ink(ctx, [[b[0] - w * 0.9, y], [b[0] + w * 0.9, y]], { w: 0.7, alpha: 0.45, jitter: 0, taper: 0 }); }
    ink(ctx, [[b[0] - w, b[1]], [t[0] - w * 0.8, t[1]]], { w: 1.3, jitter: 0.1, taper: 0 });
    ink(ctx, [[b[0] + w, b[1]], [t[0] + w * 0.8, t[1]]], { w: 1.3, jitter: 0.1, taper: 0 });
    const cap = ellipsePts(t[0], t[1], w * 1.15, w * 0.5, 2, 0, 12);
    flat(ctx, cap, mix(C.ink, brick, 0.3));
    flat(ctx, ellipsePts(t[0], t[1], w * 0.7, w * 0.3, 3, 0, 10), C.ledWarm, 0.85);
    ink(ctx, cap, { closed: true, w: 1.3, jitter: 0 });
  } else if (top === 'lantern') {
    const b = O(m, m, CORE.apex), h = (coreWireZ('lantern') - CORE.apex) * LH * DRESS_K, w = 9;
    const glass: Pt[] = [[b[0] - w, b[1] - 2], [b[0] + w, b[1] - 2], [b[0] + w, b[1] - h], [b[0] - w, b[1] - h]];
    flat(ctx, glass, mix(C.ledWarm, C.paper, 0.35));
    light(ctx, b[0], b[1] - h / 2, 3.2, C.ledWarm);
    ink(ctx, [[b[0], b[1] - 2], [b[0], b[1] - h]], { w: 1, jitter: 0, taper: 0 });
    ink(ctx, glass, { closed: true, w: 1.4, jitter: 0 });
    const roof: Pt[] = [[b[0] - w - 4, b[1] - h], [b[0] + w + 4, b[1] - h], [b[0], b[1] - h - 12]];
    flat(ctx, roof, col.dark);
    ink(ctx, roof, { closed: true, w: 1.3, jitter: 0.1 });
  } else {
    const b = O(m, m, CORE.apex), d = O(m - 0.1, m - 0.1, coreWireZ('dish'));
    for (const dx of [-6, 0, 6]) ink(ctx, [[b[0] + dx, b[1]], [d[0], d[1] + 4]], { w: 1.2, jitter: 0, taper: 0 });
    const dish = ellipsePts(d[0] - 2, d[1] - 2, 14, 8, 4, 0, 18, -0.5);
    flat(ctx, dish, mix(C.paper, c.field, 0.25));
    flat(ctx, ellipsePts(d[0] + 1, d[1], 9, 5, 5, 0, 14, -0.5), C.ink, 0.15);
    ink(ctx, dish, { closed: true, w: 1.4, jitter: 0 });
    ink(ctx, [[d[0] - 2, d[1] - 2], [d[0] - 9, d[1] - 12]], { w: 1.1, jitter: 0 });
    light(ctx, d[0] - 9, d[1] - 13, 2, C.ledRed);
  }
}

/** A neighbouring base's Core from above (plan, CORE.n tiles a side at PLAN_PX a tile). */
export function drawCorePlan(ctx: Ctx, top: CoreTop, c: DressColours): void {
  const col = cloth(c), N = CORE.n * PLAN_PX, m = N / 2, G = 12;
  const oct = Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + (i * Math.PI) / 4; return [m + 1.42 * PLAN_PX * Math.cos(a), m + 1.42 * PLAN_PX * Math.sin(a)] as Pt; });
  flat(ctx, oct, mix(C.rock2, C.peachD, 0.45));
  ink(ctx, oct, { closed: true, w: 2, jitter: 0.3 });
  for (const [u, v] of [[0.3, 0.3], [2.7, 0.3], [0.3, 2.7], [2.7, 2.7]] as const) {
    const s = 0.24 * PLAN_PX, x = u * PLAN_PX, y = v * PLAN_PX, sq: Pt[] = [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]];
    flat(ctx, sq, col.a); ink(ctx, sq, { closed: true, w: 1.4, jitter: 0.2 });
  }
  const R = 1.22 * PLAN_PX;
  for (let g = 0; g < G; g++) {
    const a0 = (g / G) * Math.PI * 2, a1 = ((g + 1) / G) * Math.PI * 2;
    flat(ctx, [[m, m], [m + R * Math.cos(a0), m + R * Math.sin(a0)], [m + R * Math.cos(a1), m + R * Math.sin(a1)]], g % 2 ? col.a : col.b);
  }
  ink(ctx, ellipsePts(m, m, R, R, 4, 0.02, 40), { closed: true, w: 2.4, jitter: 0.3 });
  const mark = top === 'chimney' ? mix(C.coralD, C.rock3, 0.5) : top === 'lantern' ? C.ledWarm : top === 'dish' ? C.paper : mix(C.peachD, C.steelD, 0.45);
  flat(ctx, ellipsePts(top === 'chimney' ? m + 0.5 * PLAN_PX : m, top === 'chimney' ? m - 0.0 * PLAN_PX : m, 9, 9, 6, 0, 12), mark);
  ink(ctx, ellipsePts(top === 'chimney' ? m + 0.5 * PLAN_PX : m, m, 9, 9, 6, 0, 12), { closed: true, w: 1.6, jitter: 0 });
}
