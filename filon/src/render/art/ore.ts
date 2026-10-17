// ore.ts — the ore deposits on the ground (D99; owner, 2026-10-16: « i cannot distinguish copper
// resources from iron on the ground. both should be reworked to look better and more
// recognizable »). Painted into the ground texture of a terrain chunk (terrain.ts `paintChunk`
// calls `paintDeposits` once, before its vents and decor), so it costs nothing per frame and shows
// in both views (the ground lies flat under the iso projection too). Each ore wears its own
// material, told apart first by colour (it carries at the far zoom), then by shape:
// · iron: heavy angular nodules, rust-red and grey-black (magnetite), blocky facets lit from the
//   top-left, steel flecks, rust stains bleeding into the sand round them;
// · copper: bright copper-orange crusts in grape-like lobes, malachite-green blotches and
//   verdigris on the ground between, a native-copper glint;
// · coal: black glossy slabs along one grain, a cool sheen on their lit edge, soot round them;
// · salt: white crystalline crusts on its flats, lilac-shadowed, a few cubes and glints;
// · anything else (the uniques' sites): a rounded pebble in its item's colour.
// Two layers: a STAIN, the deposit's ground tinted in its ore's colour (marching squares over the
// deposit tiles, `keep`: a lone tile keeps its stain), darker again over its richer tiles — what
// reads at a glance from afar; then the NODULES, tile by tile, more and bigger where the tile is
// richer (its `rich` against its ore's base, `BAL.depositRich`), each extruded a little towards
// +x +y (straight down in iso: a lump with a side) over its cast shadow. Detail by texels per
// tile: 8 a coloured blob a tile; 16 a few outlined nodules; 32 and 64 facets, grit, glints.
// The nodules may hang a little over their tile's edge, so the painter walks one tile past the
// chunk all round, in world order: both sides of a chunk seam draw the same strokes in the same
// order. Every choice is hashed from world coordinates. Runs in the terrain worker: no DOM.
import { BAL } from '@/content/balance';
import { ITEMS } from '@/content/items';
import { ITEM_IDS } from '@/content/registry';
import { hashUnit } from '@/core/hash';
import { T } from '@/sim/types';
import { isRockT, isWaterT } from '../relief';
import { BORDER, WIN, fillPolys, march, strokeSegs, type Ctx2, type PaintData } from './paint-kit';
import { C, mix, rgba } from './tokens';

/** How an ore looks on the ground (and in its item glyph: recipes/items.ts reads the same tones). */
export interface OreLook {
  readonly kind: 'iron' | 'copper' | 'coal' | 'salt' | 'pebble';
  /** The tint of its ground, and that tint's opacity. */
  readonly stain: string;
  readonly stainA: number;
  /** The nodule's body (its item's colour), its lit facet, its shaded facet, its side. */
  readonly body: string;
  readonly lit: string;
  readonly shade: string;
  readonly side: string;
  /** The second material: iron's magnetite, copper's malachite, coal's sheen, salt's lilac edge. */
  readonly accent: string;
  readonly accentL: string;
  /** Specks of light: steel flecks, native copper, coal's gloss, salt's sparkle. */
  readonly glint: string;
}

const col = (id: keyof typeof ITEMS): string => ITEMS[id].color;

/** The ground ores' looks, by item id. */
export const ORE_LOOK = {
  iron_ore: {
    kind: 'iron', stain: '#a2452c', stainA: 0.4,
    body: col('iron_ore'), lit: '#b8634a', shade: '#5a281f', side: '#36191a',
    accent: '#443c3a', accentL: '#7a706b', glint: '#dfe5ee',
  },
  copper_ore: {
    kind: 'copper', stain: '#46a682', stainA: 0.34,
    body: col('copper_ore'), lit: '#f1aa68', shade: '#94501f', side: '#6a3417',
    accent: '#2c9670', accentL: '#8fdcb4', glint: '#fff0c4',
  },
  coal: {
    kind: 'coal', stain: '#38323f', stainA: 0.36,
    body: '#2a2631', lit: '#615f7a', shade: '#1b1820', side: '#0f0d14',
    accent: '#8f9bc0', accentL: '#e3ecff', glint: '#f2f8ff',
  },
  salt: {
    kind: 'salt', stain: '#ffffff', stainA: 0.62,
    body: '#fdf9f2', lit: '#ffffff', shade: '#dfd4ea', side: '#c3b4da',
    accent: '#a896cc', accentL: '#efe9f8', glint: '#ffffff',
  },
} as const satisfies Record<string, OreLook>;

/** Any other item on the ground (a unique's site): a rounded pebble of its colour. */
const pebbleLook = (c: string): OreLook => ({
  kind: 'pebble', stain: c, stainA: 0.28, body: c, lit: mix(c, '#ffffff', 0.45), shade: mix(c, C.ink, 0.3),
  side: mix(c, C.ink, 0.5), accent: c, accentL: mix(c, '#ffffff', 0.7), glint: '#ffffff',
});

/** The look of an item index on the ground. */
export const LOOKS: readonly OreLook[] = ITEM_IDS.map((id) => (ORE_LOOK as Record<string, OreLook>)[id] ?? pebbleLook(ITEMS[id].color));

/** A tile's richness against its ore's base (‰): a near deposit's heart 1000, its rim 700, the far ring's heart 1600. */
export function richness(item: number, rich: number): number {
  const base = BAL.depositRich[ITEM_IDS[item]!] ?? BAL.uniqueRich;
  return Math.round((rich * 1000) / Math.max(1, base));
}

/** How many nodules a tile wears at `ppt` texels per tile, by its richness (‰). */
export function nodulesOf(rich: number, ppt: number): number {
  if (ppt < 16) return 1;
  if (ppt < 32) return Math.max(1, Math.min(3, Math.round((rich * 2) / 1000)));
  return Math.max(1, Math.min(6, Math.round((rich * 3) / 1000)));
}

type Pt = [number, number];
const TAU = Math.PI * 2;

/**
 * The ore deposits of a paint window's chunk, on the ground: the stains, then the nodules. `skip`:
 * tiles another painter draws (terrain.ts: a face ore bared by a drop, D87, drawn as its seam).
 * Ores under rock (hidden veins, minable once dug out) are only a faint mark.
 */
export function paintDeposits(ctx: Ctx2, d: PaintData, ppt: number, skip: (i: number, j: number) => boolean = () => false): void {
  const B = BORDER, k = ppt / 32;
  const wx0 = d.cx * 32 - B, wy0 = d.cy * 32 - B;
  // Deposit tiles on open ground (item index + 1), by window index.
  const shown = new Uint8Array(WIN * WIN);
  const items: number[] = [];
  for (let o = 0; o < WIN * WIN; o++) {
    const ore = d.ore[o]!, t = d.terrain[o]!;
    if (!ore || isRockT(t) || isWaterT(t) || t === T.River || t === T.Chasm) continue;
    shown[o] = ore;
    if (!items.includes(ore)) items.push(ore);
  }
  items.sort((a, b) => a - b);
  const lvl = ppt < 16 ? 0 : ppt < 32 ? 1 : 2;

  // ── 1. the stains: the deposit's ground in its ore's tint, the richer tiles again ──
  for (const ore of items) {
    const L = LOOKS[ore - 1]!;
    const all = wobble(march((i, j) => shown[j * WIN + i] === ore, ppt, true), d, ppt);
    if (!all.polys.length) continue;
    ctx.save();
    ctx.globalAlpha = L.stainA;
    fillPolys(ctx, all.polys, L.stain);
    const rich = wobble(march((i, j) => shown[j * WIN + i] === ore && richness(ore - 1, d.rich[j * WIN + i]!) >= 950, ppt, true), d, ppt);
    ctx.globalAlpha = L.stainA * 0.55;
    if (rich.polys.length) fillPolys(ctx, rich.polys, L.kind === 'salt' ? L.lit : L.stain);
    ctx.restore();
    if (lvl) strokeSegs(ctx, all.segs, L.kind === 'salt' ? L.accent : L.shade, (lvl === 2 ? 1.1 : 0.8) * k, L.kind === 'salt' ? 0.5 : 0.3);
  }

  // ── 2. tile by tile, one past the chunk, in world order: grit, then the nodules ──
  for (let j = B - 1; j <= B + 32; j++) {
    for (let i = B - 1; i <= B + 32; i++) {
      const o = j * WIN + i;
      const ore = d.ore[o]!;
      if (!ore || skip(i, j)) continue;
      const wx = wx0 + i, wy = wy0 + j;
      const px = (i - B) * ppt, py = (j - B) * ppt;
      const L = LOOKS[ore - 1]!;
      if (!shown[o]) {
        // A hidden vein (under rock): a faint mark of its ore's colour, inside its tile.
        if (!isRockT(d.terrain[o]!) || i < B || j < B || i >= B + 32 || j >= B + 32) continue;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = L.kind === 'copper' ? L.accent : L.body;
        ctx.beginPath();
        ctx.ellipse(px + (0.3 + hashUnit(wx, wy, 0xd0) * 0.4) * ppt, py + (0.3 + hashUnit(wx, wy, 0xe0) * 0.4) * ppt, 0.08 * ppt, 0.065 * ppt, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        continue;
      }
      const r = richness(ore - 1, d.rich[o]!);
      if (lvl) grit(ctx, L, px, py, ppt, wx, wy, lvl);
      // Copper: malachite on the ground between the crusts; coal: its seam along the grain.
      if (lvl && L.kind === 'copper') blotch(ctx, L, px + (0.25 + hashUnit(wx, wy, 0x5a1) * 0.5) * ppt, py + (0.25 + hashUnit(wx, wy, 0x5a2) * 0.5) * ppt, (0.1 + hashUnit(wx, wy, 0x5a3) * 0.05) * ppt * (lvl === 2 ? 1 : 1.2), hashUnit(wx, wy, 0x5a4) * TAU, lvl, k, wx * 13, wy);
      if (lvl && L.kind === 'coal' && r >= 900) seam(ctx, L, px, py, ppt, wx, wy, k);
      const n = nodulesOf(r, ppt);
      // Places on a 3 × 3 grid of the tile, shuffled per tile, jittered: spread, never stacked.
      const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (let s = 8; s > 0; s--) {
        const q = Math.floor(hashUnit(wx, wy, 0x600 + s) * (s + 1));
        const tmp = slots[s]!; slots[s] = slots[q]!; slots[q] = tmp;
      }
      // A rich tile's first nodule is a boulder in its middle.
      const boulder = r >= 950 && lvl > 0;
      if (boulder) { const c4 = slots.indexOf(4); slots[c4] = slots[0]!; slots[0] = 4; }
      const grow = 0.85 + 0.25 * Math.min(1.6, r / 1000);
      for (let q = 0; q < n; q++) {
        const sl = slots[q]!;
        const u = hashUnit(wx, wy, 0x700 + q);
        const cx = px + (0.2 + 0.3 * (sl % 3) + (hashUnit(wx, wy, 0x710 + q) - 0.5) * 0.14) * ppt;
        const cy = py + (0.2 + 0.3 * Math.floor(sl / 3) + (hashUnit(wx, wy, 0x720 + q) - 0.5) * 0.14) * ppt;
        let rad = lvl === 0 ? 0.24 * ppt : lvl === 1 ? (0.14 + 0.05 * u) * ppt : (0.11 + 0.05 * u) * ppt;
        rad *= grow * (boulder && q === 0 ? 1.45 : 1);
        const rot = L.kind === 'coal' ? grain(wx, wy) + (u - 0.5) * 0.5 : hashUnit(wx, wy, 0x730 + q) * TAU;
        nodule(ctx, L, cx, cy, rad, rot, u, lvl, k, wx * 7 + q, wy);
      }
    }
  }
}

/**
 * A stain's outline made organic: every corner the marching squares give moved by up to a third of
 * a tile, hashed from its WORLD position (in 1/64 tile), so a corner two cells (or two chunks) share
 * moves the same way and the shape stays whole.
 */
function wobble(m: { polys: number[][]; segs: number[][] }, d: PaintData, ppt: number): { polys: number[][]; segs: number[][] } {
  const ox = d.cx * 32 * 64, oy = d.cy * 32 * 64, amp = 0.34 * ppt;
  const move = (a: number[]): number[] => {
    const out = a.slice();
    for (let n = 0; n < a.length; n += 2) {
      const qx = ox + Math.round((a[n]! * 64) / ppt), qy = oy + Math.round((a[n + 1]! * 64) / ppt);
      out[n] = a[n]! + (hashUnit(qx, qy, 0x5f1) - 0.5) * amp;
      out[n + 1] = a[n + 1]! + (hashUnit(qx, qy, 0x5f2) - 0.5) * amp;
    }
    return out;
  };
  return { polys: m.polys.map(move), segs: m.segs.map(move) };
}

/** Coal's grain: the angle its slabs and seams lie along, the same over a stretch of ground. */
const grain = (wx: number, wy: number): number => 0.35 + hashUnit(wx >> 3, wy >> 3, 0x5c0) * 0.5;

/** Fine specks of the ore's materials on its tile (≥ 16 texels). */
function grit(ctx: Ctx2, L: OreLook, px: number, py: number, ppt: number, wx: number, wy: number, lvl: number): void {
  const k = ppt / 32;
  const tones = L.kind === 'iron' ? [L.shade, L.accent] : L.kind === 'copper' ? [L.accent, L.body] : L.kind === 'coal' ? [L.body, L.side] : L.kind === 'salt' ? [L.lit, L.accentL] : [L.shade, L.body];
  const n = lvl === 2 ? 5 : 3;
  for (let q = 0; q < n; q++) {
    ctx.fillStyle = tones[q & 1]!;
    ctx.beginPath();
    ctx.arc(px + hashUnit(wx, wy, 0x580 + q) * ppt, py + hashUnit(wx, wy, 0x590 + q) * ppt, (0.7 + hashUnit(wx, wy, 0x5a0 + q) * 0.6) * Math.max(0.7, k), 0, TAU);
    ctx.fill();
  }
}

/**
 * A malachite blotch: an irregular green patch (seven corners, world-hashed), its edge inked in a
 * deeper green and, at ≥ 32 texels, a lighter band inside it — the stone's banding.
 */
function blotch(ctx: Ctx2, L: OreLook, x: number, y: number, r: number, rot: number, lvl: number, k: number, h1: number, h2: number): void {
  const pts = stone(x, y, r, rot, 7, 1.35, h1, h2);
  ctx.save();
  ctx.fillStyle = L.accent;
  path(ctx, pts); ctx.fill();
  if (lvl === 2) {
    ctx.strokeStyle = L.accentL; ctx.lineWidth = 0.75 * k; ctx.globalAlpha = 0.8;
    path(ctx, stone(x - r * 0.12, y - r * 0.1, r * 0.5, rot, 7, 1.35, h1, h2)); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (lvl) {
    ctx.strokeStyle = mix(L.accent, C.ink, 0.45); ctx.lineWidth = 0.7 * k;
    path(ctx, pts); ctx.stroke();
  }
  ctx.restore();
}

/** A coal seam: a black band across the tile along the grain, its edge glossy. */
function seam(ctx: Ctx2, L: OreLook, px: number, py: number, ppt: number, wx: number, wy: number, k: number): void {
  const a = grain(wx, wy), c = Math.cos(a), s = Math.sin(a);
  const x = px + (0.3 + hashUnit(wx, wy, 0x5d0) * 0.4) * ppt, y = py + (0.3 + hashUnit(wx, wy, 0x5d1) * 0.4) * ppt;
  const h = 0.36 * ppt, w = 0.05 * ppt;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = L.side;
  ctx.lineWidth = w * 2;
  ctx.beginPath();
  ctx.moveTo(x - c * h, y - s * h);
  ctx.lineTo(x + c * h, y + s * h);
  ctx.stroke();
  ctx.strokeStyle = L.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 0.8 * k;
  ctx.beginPath();
  ctx.moveTo(x - c * h * 0.8 + s * w * 0.6, y - s * h * 0.8 - c * w * 0.6);
  ctx.lineTo(x + c * h * 0.5 + s * w * 0.6, y + s * h * 0.5 - c * w * 0.6);
  ctx.stroke();
  ctx.restore();
}

/** A closed path through points, shifted. */
function path(ctx: Ctx2, pts: readonly Pt[], dx = 0, dy = 0): void {
  ctx.beginPath();
  pts.forEach(([x, y], n) => (n ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
  ctx.closePath();
}

/** Circles as one path, shifted (a copper crust's lobes). */
function lobesPath(ctx: Ctx2, lobes: ReadonlyArray<readonly [number, number, number]>, dx = 0, dy = 0): void {
  ctx.beginPath();
  for (const [x, y, r] of lobes) { ctx.moveTo(x + dx + r, y + dy); ctx.arc(x + dx, y + dy, r, 0, TAU); }
}

/** A stone's outline: `n` corners round (x, y), stretched `e` along `rot`, each at `r` × 0.72–1.05. */
function stone(x: number, y: number, r: number, rot: number, n: number, e: number, h1: number, h2: number): Pt[] {
  const pts: Pt[] = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let q = 0; q < n; q++) {
    const a = (q * TAU) / n + (hashUnit(h1, h2, 0x740 + q) - 0.5) * (TAU / n) * 0.5;
    const m = r * (0.72 + hashUnit(h1, h2, 0x750 + q) * 0.33);
    const u = Math.cos(a) * m * e, v = Math.sin(a) * m;
    pts.push([x + u * c - v * s, y + u * s + v * c]);
  }
  return pts;
}

/** The part of a stone's outline facing the light (top-left, `lit`) or away from it, closed on a point inside. */
function facet(pts: readonly Pt[], x: number, y: number, r: number, lit: boolean): Pt[] {
  const sgn = lit ? 1 : -1;
  const face = (p: Pt): number => sgn * (-(p[0] - x) - (p[1] - y));
  // The longest run (cyclic) of corners facing that way.
  const n = pts.length;
  let start = -1;
  for (let q = 0; q < n; q++) if (face(pts[q]!) > 0 && face(pts[(q + n - 1) % n]!) <= 0) { start = q; break; }
  if (start < 0) return [];
  const out: Pt[] = [];
  for (let q = 0; q < n && face(pts[(start + q) % n]!) > 0; q++) out.push(pts[(start + q) % n]!);
  const m = r * 0.12 * sgn;
  out.push([x + m, y + m]);
  return out;
}

/**
 * One nodule of an ore at (x, y), `r` texels, by detail level (0: a blob; 1: outlined; 2: facets
 * and glints). Every lump is a top and a side: the same outline drawn at offsets 0 … `h` towards
 * +x +y (straight down in iso), the ink stroked first twice as wide and the fills laid over it, so
 * only the silhouette stays inked — no outline inside a crust of lobes.
 */
function nodule(ctx: Ctx2, L: OreLook, x: number, y: number, r: number, rot: number, u: number, lvl: number, k: number, h1: number, h2: number): void {
  const lw = (lvl === 2 ? 1.05 : 0.8) * Math.max(0.6, k);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // A lump of outline `shape` (a path builder taking a shift): halo, cast shadow, ink, side, top.
  const lump = (shape: (dx: number, dy: number) => void, h: number, top: string, side: string, halo: string | null, haloR: number): void => {
    if (lvl && halo) {
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.3, haloR, haloR * 0.8, rot, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = rgba(C.ink, 0.26);
    shape(h * 1.25, h * 1.55); ctx.fill();
    if (lvl) {
      ctx.strokeStyle = C.ink; ctx.lineWidth = lw * 2;
      for (const f of [0, 0.5, 1]) { shape(h * f, h * f); ctx.stroke(); }
    }
    ctx.fillStyle = side;
    shape(h, h); ctx.fill();
    shape(h / 2, h / 2); ctx.fill();
    ctx.fillStyle = top;
    shape(0, 0); ctx.fill();
  };
  switch (L.kind) {
    case 'iron': {
      // Heavy and angular: six corners, a rust stain, a deep side, a lit facet and a dark one.
      const dark = u < 0.36; // magnetite, grey-black
      const body = dark ? L.accent : L.body, lit = dark ? L.accentL : L.lit, shade = dark ? mix(L.accent, C.ink, 0.35) : L.shade;
      const pts = stone(x, y, r, rot, 6, 1.18, h1, h2);
      lump((dx, dy) => path(ctx, pts, dx, dy), r * (lvl ? 0.42 : 0.3), body, dark ? mix(L.accent, C.ink, 0.55) : L.side, rgba(L.stain, 0.32), r * 1.6);
      if (lvl) {
        const a = facet(pts, x, y, r, true), b = facet(pts, x, y, r, false);
        if (a.length > 2) { ctx.fillStyle = lit; path(ctx, a); ctx.fill(); }
        if (b.length > 2) { ctx.fillStyle = shade; path(ctx, b); ctx.fill(); }
        ctx.strokeStyle = rgba(C.ink, 0.7); ctx.lineWidth = lw * 0.7; path(ctx, pts); ctx.stroke();
      }
      if (lvl === 2) {
        // Steel flecks on the lit side.
        ctx.fillStyle = L.glint;
        for (let q = 0; q < 2; q++) {
          const fx = x - r * (0.15 + hashUnit(h1, h2, 0x760 + q) * 0.35), fy = y - r * (0.05 + hashUnit(h1, h2, 0x770 + q) * 0.35), f = r * 0.17;
          path(ctx, [[fx - f, fy], [fx, fy - f * 0.7], [fx + f, fy], [fx, fy + f * 0.7]]); ctx.fill();
        }
      }
      break;
    }
    case 'copper': {
      // A crust of grape-like lobes, bright copper, a malachite blotch on its flank, a native-copper glint.
      const c = Math.cos(rot), s = Math.sin(rot);
      const lobes: Array<[number, number, number]> = [
        [x + c * r * 0.3, y + s * r * 0.3, r * 0.66],
        [x - s * r * 0.45, y + c * r * 0.45, r * 0.55],
        [x - c * r * 0.42 + s * r * 0.22, y - s * r * 0.42 - c * r * 0.22, r * 0.5],
      ];
      lump((dx, dy) => lobesPath(ctx, lobes, dx, dy), r * (lvl ? 0.26 : 0.2), L.body, L.side, rgba(L.stain, 0.34), r * 1.55);
      if (lvl) {
        // Each lobe lit on its top-left, the light it catches.
        ctx.fillStyle = L.lit;
        lobesPath(ctx, lobes.map(([a, b, rr]) => [a - rr * 0.2, b - rr * 0.22, rr * 0.58] as const)); ctx.fill();
        // Malachite over one lobe's flank, banded.
        const [mx, my, mr] = lobes[u < 0.5 ? 1 : 2]!;
        blotch(ctx, L, mx + mr * 0.25, my + mr * 0.3, mr * 0.62, rot, lvl, k, h1 + 1, h2);
      } else {
        // Far: the green beside the orange, so the mix reads in one blob.
        ctx.fillStyle = L.accent;
        ctx.beginPath(); ctx.arc(lobes[1]![0], lobes[1]![1], lobes[1]![2] * 0.8, 0, TAU); ctx.fill();
      }
      if (lvl === 2 && u > 0.3) {
        const [gx, gy, gr] = lobes[0]!;
        star(ctx, gx - gr * 0.3, gy - gr * 0.35, gr * 0.45, L.glint);
      }
      break;
    }
    case 'coal': {
      // A slab: a long parallelogram along the grain, black and glossy, its lit edge sheened.
      const c = Math.cos(rot), s = Math.sin(rot);
      const a = r * 1.35, b = r * 0.62, sk = r * 0.3;
      // A point `al` along the grain and `ac` across it.
      const P = (al: number, ac: number): Pt => [x + al * c - ac * s, y + al * s + ac * c];
      const pts: Pt[] = [P(-a + sk, -b), P(a + sk, -b), P(a - sk, b), P(-a - sk, b)];
      lump((dx, dy) => path(ctx, pts, dx, dy), r * (lvl ? 0.34 : 0.25), L.body, L.side, rgba(L.stain, 0.3), a * 1.15);
      if (lvl) {
        // The edge towards the light glossed.
        const e0 = pts[0]!, e1 = pts[1]!;
        ctx.strokeStyle = L.lit; ctx.lineWidth = 1.6 * lw;
        ctx.beginPath(); ctx.moveTo(e0[0] + (e1[0] - e0[0]) * 0.08, e0[1] + (e1[1] - e0[1]) * 0.08 + lw); ctx.lineTo(e0[0] + (e1[0] - e0[0]) * 0.9, e0[1] + (e1[1] - e0[1]) * 0.9 + lw); ctx.stroke();
      }
      if (lvl === 2) {
        ctx.strokeStyle = L.accentL; ctx.globalAlpha = 0.85; ctx.lineWidth = 0.9 * k;
        const g0 = P(-a * 0.5, -b * 0.2), g1 = P(-a * 0.05, -b * 0.2);
        ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.stroke();
        ctx.globalAlpha = 1;
        if (u > 0.5) { const g = P(-a * 0.55, -b * 0.55); star(ctx, g[0], g[1], r * 0.32, L.glint); }
      }
      break;
    }
    case 'salt': {
      // A crust: a flat white plate with a lilac rim, a cube or two on it, sparkle.
      const pts = stone(x, y, r * 1.25, rot, 7, 1.3, h1, h2);
      const h = r * 0.14;
      ctx.fillStyle = L.side;
      path(ctx, pts, h, h); ctx.fill();
      ctx.fillStyle = L.body;
      path(ctx, pts); ctx.fill();
      if (lvl) { ctx.strokeStyle = L.accent; ctx.lineWidth = lw; path(ctx, pts); ctx.stroke(); }
      if (lvl === 2) {
        for (let q = 0; q < 2; q++) {
          const cx = x + (hashUnit(h1, h2, 0x780 + q) - 0.5) * r, cy = y + (hashUnit(h1, h2, 0x790 + q) - 0.5) * r, cs = r * (0.28 + 0.12 * q);
          cube(ctx, L, cx, cy, cs, lw);
        }
        if (u > 0.4) star(ctx, x - r * 0.4, y - r * 0.5, r * 0.4, L.glint);
      }
      break;
    }
    default: {
      // A pebble of its item's colour (a unique's site).
      const shape = (dx: number, dy: number): void => { ctx.beginPath(); ctx.ellipse(x + dx, y + dy, r, r * 0.8, rot, 0, TAU); };
      lump(shape, r * 0.25, L.body, L.side, null, 0);
      if (lvl) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.3, r * 0.25, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** A salt cube seen from above at a slant: its top lit, its two sides lilac. */
function cube(ctx: Ctx2, L: OreLook, x: number, y: number, s: number, lw: number): void {
  const top: Pt[] = [[x - s, y - s * 0.4], [x, y - s * 0.9], [x + s, y - s * 0.4], [x, y + s * 0.1]];
  ctx.fillStyle = L.shade;
  path(ctx, [[x - s, y - s * 0.4], [x, y + s * 0.1], [x, y + s * 0.9], [x - s, y + s * 0.4]]); ctx.fill();
  ctx.fillStyle = L.side;
  path(ctx, [[x, y + s * 0.1], [x + s, y - s * 0.4], [x + s, y + s * 0.4], [x, y + s * 0.9]]); ctx.fill();
  ctx.fillStyle = L.lit;
  path(ctx, top); ctx.fill();
  ctx.strokeStyle = L.accent; ctx.lineWidth = lw * 0.8;
  path(ctx, [[x - s, y - s * 0.4], [x, y - s * 0.9], [x + s, y - s * 0.4], [x + s, y + s * 0.4], [x, y + s * 0.9], [x - s, y + s * 0.4]]); ctx.stroke();
}

/** A four-point glint. */
function star(ctx: Ctx2, x: number, y: number, r: number, color: string): void {
  const w = r * 0.28;
  ctx.fillStyle = color;
  path(ctx, [[x, y - r], [x + w, y - w], [x + r, y], [x + w, y + w], [x, y + r], [x - w, y + w], [x - r, y], [x - w, y - w]]);
  ctx.fill();
}
