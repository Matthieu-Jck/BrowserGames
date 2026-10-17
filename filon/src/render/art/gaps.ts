// gaps.ts — the chunk painter's water and gaps (D94, D115), apart from the ground and the rock
// (terrain.ts): all water from one outline — still water (the lakes, the sea, the tarn on its rock)
// with a shallow ring and a deep heart, a river as running water a little bluer, deeper in a broad
// river's middle, their colours feathered into each other where they meet (no line, no ground
// between them); the sand through the shallows along a bank, wet sand past it, one inked shore;
// the marks in the mesas' manner (`WATER`): ink current lines along the way a river flows (the
// chunk's biome code holds it), highlights and glints, foam against its banks, where streams meet,
// at a fall's lip and where it lands, ripple lines on still water; a chasm as a cut in the ground.
// Painted into the ground texture (both views), cached with the chunks.
import { hashUnit } from '@/core/hash';
import { T } from '@/sim/types';
import { isWaterT } from '../relief';
import { C, mix, rgba } from './tokens';
import { BORDER, WIN, clipPolys, fillPolys, march, strokeSegs, type Ctx2, type PaintData } from './paint-kit';

/** A river tile's biome code base (mapgen's `BIOME.river`, D94: + the way it flows); the painter keeps off the generator's module. */
export const RIVER_BIOME = 16;
/** The sea's biome code (mapgen's `BIOME.sea`, D94): its coast gets surf. */
export const SEA_BIOME = 24;
/** The open sea's deep water: a little bluer and darker than a lake's. */
export const SEA_DEEP = mix(C.deep, '#2a6b98', 0.4);
/** The eight ways a river flows (0 = +x, 2 = +y, clockwise): the step to the next tile along it. */
const FLOW_DX = [1, 1, 0, -1, -1, -1, 0, 1], FLOW_DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Where one water meets another — a river into its lake or the sea, the deep heart in its shallows
 * — the colours run into each other over about a tile (owner, 2026-10-17: « les rivières sont un peu
 * cassées des fois, à la frontière entre eau bleue claire et foncée »): the nearer water laid in
 * seven bands further and further out of its own tiles (`march`'s `iso`, 0.06 … 0.5), laid one over
 * the other at 1/7, 1/6 … 1/2 and whole, so its cover rises evenly, a seventh a band, to whole at
 * its tiles' edge: steps too fine to read as stripes. Clipped to the water's outline: along a bank the bands fall outside it, so
 * a bank keeps its crisp edge and its ink.
 */
const FEATHER: ReadonlyArray<readonly [iso: number, alpha: number]> = Array.from({ length: 7 }, (_, k) => [0.06 + (0.44 * k) / 6, 1 / (7 - k)] as const);

/**
 * The water's palette (D115; owner, 2026-10-17, of a mesa canyon and its falls: « the style here is
 * great. The water texture can be improved to reach the level of the mountains texture »): the
 * mesas' family — the sand warming the shallows along a bank, the deep going towards the ink's
 * violet as the cliffs' shade does, the ink's own current lines, paper-white foam.
 */
export const WATER = {
  /** A river's middle two and three tiles from its banks. */
  riverMid: mix(C.river, C.riverD, 0.5),
  riverDeep: mix(C.riverD, C.ink, 0.2),
  /** Still water two tiles or more from its shore, short of the deep heart. */
  lakeMid: mix(C.shallow, C.deep, 0.45),
  /** The current lines: the river's dark drawn towards the ink. */
  current: mix(C.riverD, C.ink, 0.35),
  /** The sand seen through the shallows along a bank, and the wet sand just past it. */
  bank: C.sand,
  wetSand: mix(C.sand, '#8a6a52', 0.45),
} as const;

/** Tiles from a bank (8-neighbour steps to ground) counted at most: within the paint window's margin both sides of a chunk seam read the same (`BORDER` 8: march reads 3 tiles past the chunk). */
const DEPTH_MAX = 3;

/**
 * Still water and rivers (`paintChunk`'s pass 3), all from one outline: the water's whole extent
 * (lakes, the sea, the tarn, the rivers — a river's own tiles kept in however thin, tile by tile, so
 * the outline is the same both sides of a chunk seam) filled with the shallows; then, clipped to it
 * and feathered (`FEATHER`), the depths — the deep heart, the open sea's deeper blue, the rivers'
 * blue and, two and three tiles from their banks, their deeper middle (D115), the lakes' middle —;
 * the sand through the shallows along every bank; then the marks (`paintMarks`: currents, foam,
 * glints, ripples), the wet sand round it, one inked shore, the surf. No line inside: where a river
 * meets its lake there is no bank (D94's river art: before, two outlines, a hard seam and slivers
 * of ground between them).
 */
export function paintWater(ctx: Ctx2, d: PaintData, ppt: number): void {
  const t = (i: number, j: number): number => d.terrain[j * WIN + i]!;
  const k = ppt / 32;
  const isRiver = (i: number, j: number): boolean => t(i, j) === T.River;
  const wet = (i: number, j: number): boolean => isWaterT(t(i, j)) || isRiver(i, j);
  const all = march(wet, ppt, isRiver);
  if (!all.polys.length) return;
  const depth = depths(wet);
  const deeper = (n: number) => (i: number, j: number): boolean => depth[j * WIN + i]! >= n;
  // The open sea's deep water a little bluer than a lake's (its biome code).
  const isSea = (i: number, j: number): boolean => d.biome[j * WIN + i] === SEA_BIOME;
  const still = (i: number, j: number): boolean => isWaterT(t(i, j));
  ctx.save();
  clipPolys(ctx, all.polys);
  fillPolys(ctx, all.polys, C.shallow);
  feather(ctx, (i, j) => still(i, j) && deeper(2)(i, j), ppt, WATER.lakeMid);
  feather(ctx, (i, j) => t(i, j) === T.Deep, ppt, C.deep);
  feather(ctx, (i, j) => t(i, j) === T.Deep && isSea(i, j), ppt, SEA_DEEP);
  feather(ctx, isRiver, ppt, C.river, isRiver);
  feather(ctx, (i, j) => isRiver(i, j) && deeper(2)(i, j), ppt, WATER.riverMid);
  feather(ctx, (i, j) => isRiver(i, j) && deeper(3)(i, j), ppt, WATER.riverDeep);
  // The sand through the shallows along every bank (the half of the stroke inside the clip).
  strokeSegs(ctx, all.segs, WATER.bank, 14 * k, 0.32);
  ctx.restore();
  // The wet sand just past the bank (its inner half falls on the shallows' sand).
  strokeSegs(ctx, all.segs, WATER.wetSand, 9 * k, 0.3);
  paintMarks(ctx, d, ppt, all.segs, depth, wet);
  strokeSegs(ctx, all.segs, C.paper, 3.6 * k, 0.75);
  strokeSegs(ctx, all.segs, C.ink, 2.2 * k, 1);
  paintSurf(ctx, d, ppt, isSea, wet);
}

/** Each window tile's steps to ground (8-neighbour), 0 on ground, at most `DEPTH_MAX`. */
function depths(wet: (i: number, j: number) => boolean): Uint8Array {
  const out = new Uint8Array(WIN * WIN);
  for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) out[j * WIN + i] = wet(i, j) ? DEPTH_MAX : 0;
  for (let n = 1; n < DEPTH_MAX; n++) {
    for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) {
      const o = j * WIN + i;
      if (out[o]! <= n) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) {
        const u = i + di, v = j + dj;
        if (u >= 0 && v >= 0 && u < WIN && v < WIN && out[v * WIN + u]! === n - 1) near = true;
      }
      if (near) out[o] = n;
    }
  }
  return out;
}

/** One water's colour over the others, feathered out of its tiles (`FEATHER`); `keep` as `march`'s. */
function feather(ctx: Ctx2, inside: (i: number, j: number) => boolean, ppt: number, color: string, keep: boolean | ((i: number, j: number) => boolean) = false): void {
  ctx.save();
  for (const [iso, alpha] of FEATHER) {
    const m = march(inside, ppt, keep, iso);
    if (!m.polys.length) break; // nothing of it in reach: no nearer band either
    ctx.globalAlpha = alpha;
    fillPolys(ctx, m.polys, color);
  }
  ctx.restore();
}

/**
 * The sea's surf (D94): three broken lines of white foam following the coast out at sea, from a
 * third of a tile to a tile and a fifth out, fainter further out (the coast's outline moved towards the sea, side by side with its own
 * normal; dashed by a hash of their world position), so the sea's edge reads as breaking water.
 */
function paintSurf(ctx: Ctx2, d: PaintData, ppt: number, isSea: (i: number, j: number) => boolean, wet: (i: number, j: number) => boolean): void {
  const coast = march(isSea, ppt);
  if (!coast.segs.length) return;
  const k = ppt / 32, B = BORDER, ox = d.cx * 32, oy = d.cy * 32;
  const at = (px: number, py: number, f: (i: number, j: number) => boolean): boolean => {
    const i = Math.floor(px / ppt) + B, j = Math.floor(py / ppt) + B;
    return i >= 0 && j >= 0 && i < WIN && j < WIN && f(i, j);
  };
  const sea = (px: number, py: number): boolean => at(px, py, isSea);
  ctx.save();
  ctx.lineCap = 'round';
  for (const [off, a, w] of [[0.3, 0.95, 2.4], [0.72, 0.75, 1.8], [1.2, 0.45, 1.4]] as const) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = w * k;
    ctx.beginPath();
    for (const sg of coast.segs) {
      const [ax, ay, bx, by] = sg as [number, number, number, number];
      const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, sgn = sea(mx + nx * 0.4 * ppt, my + ny * 0.4 * ppt) ? 1 : -1;
      // No surf where the sea meets other water (a river's mouth): no bank, no breakers.
      if (at(mx - nx * sgn * 0.6 * ppt, my - ny * sgn * 0.6 * ppt, wet)) continue;
      if (hashUnit(Math.round((mx / ppt + ox) * 4), Math.round((my / ppt + oy) * 4), 0x600 + Math.round(off * 10)) < 0.25) continue;
      const dx = nx * sgn * off * ppt, dy = ny * sgn * off * ppt;
      ctx.moveTo(ax + dx, ay + dy);
      ctx.lineTo(bx + dx, by + dy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The water's marks (D94, D115), at the near zooms, tile by tile one past the chunk and in world
 * order (both sides of a seam draw the same strokes over it; every choice hashed from world
 * coordinates):
 * · on a river, its current: an ink line along the way it flows (the chunk's biome code,
 *   `RIVER_BIOME` + the eighth of a turn, 0 = east, 2 = south), gently bent, a paper-white
 *   highlight shorter beside it; in a broad river's middle a glint now and then;
 * · against a river's banks, broken foam a little way in; where two streams meet, foam across the
 *   meeting; where a stream steps down (the next tile along its way lower: up on a massif, down the
 *   Crown), a band of foam at the lip and spray below (the plan view's fall: in iso the relief draws
 *   it down its wall), and where it lands — on a lower stream or a pool — foam boiling in a ring;
 * · on still water, broken ripple lines along its depth (two tiles from the shore) and short ripples,
 *   a glint on the deep now and then.
 */
function paintMarks(ctx: Ctx2, d: PaintData, ppt: number, shore: readonly number[][], depth: Uint8Array, wet: (i: number, j: number) => boolean): void {
  if (ppt < 16) return;
  const k = ppt / 32, B = BORDER, wx0 = d.cx * 32 - B, wy0 = d.cy * 32 - B;
  const t = (i: number, j: number): number => d.terrain[j * WIN + i]!;
  const flowOf = (i: number, j: number): number => { const f = d.biome[j * WIN + i]! - RIVER_BIOME; return f >= 0 && f < 8 ? f : 0; };
  const isRiver = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < WIN && j < WIN && t(i, j) === T.River;
  ctx.save();
  ctx.lineCap = 'round';
  // Foam against a running river's banks: the shore moved a tenth of a tile into the water, broken.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  for (const sg of shore) {
    const [ax, ay, bx, by] = sg as [number, number, number, number];
    const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len, mx = (ax + bx) / 2, my = (ay + by) / 2;
    const ti = (px: number, py: number): [number, number] => [Math.floor(px / ppt) + B, Math.floor(py / ppt) + B];
    const [ia, ja] = ti(mx + nx * 0.3 * ppt, my + ny * 0.3 * ppt), [ib, jb] = ti(mx - nx * 0.3 * ppt, my - ny * 0.3 * ppt);
    const sgn = isRiver(ia, ja) ? 1 : isRiver(ib, jb) ? -1 : 0;
    if (!sgn || hashUnit(Math.round((mx / ppt + wx0 + B) * 4), Math.round((my / ppt + wy0 + B) * 4), 0x7a1) < 0.35) continue;
    const ox = nx * sgn * 0.13 * ppt, oy = ny * sgn * 0.13 * ppt;
    ctx.moveTo(ax + ox, ay + oy);
    ctx.lineTo(bx + ox, by + oy);
  }
  ctx.stroke();
  for (let j = B - 1; j <= B + 32; j++) {
    for (let i = B - 1; i <= B + 32; i++) {
      const o = j * WIN + i;
      if (!wet(i, j)) continue;
      const wx = wx0 + i, wy = wy0 + j, px = (i - B) * ppt, py = (j - B) * ppt, dep = depth[o]!;
      if (t(i, j) === T.River) {
        const f = flowOf(i, j), a = (f * Math.PI) / 4, ux = Math.cos(a), uy = Math.sin(a);
        // The current: an ink line along the way, gently bent, across the tile at a hashed place.
        if (hashUnit(wx, wy, 0x2a0) < 0.7) {
          const c = (hashUnit(wx, wy, 0x2b0) - 0.5) * 0.7, s = (hashUnit(wx, wy, 0x2c0) - 0.5) * 0.4;
          const cx = px + (0.5 - uy * c + ux * s) * ppt, cy = py + (0.5 + ux * c + uy * s) * ppt;
          const L = (0.38 + hashUnit(wx, wy, 0x2d0) * 0.3) * ppt, bend = (hashUnit(wx, wy, 0x2e0) - 0.5) * 0.24 * ppt;
          ctx.strokeStyle = rgba(WATER.current, dep >= 2 ? 0.5 : 0.38);
          ctx.lineWidth = 1 * k;
          ctx.beginPath();
          ctx.moveTo(cx - ux * L, cy - uy * L);
          ctx.quadraticCurveTo(cx - uy * bend, cy + ux * bend, cx + ux * L, cy + uy * L);
          ctx.stroke();
        }
        // The highlight: shorter, paper-white, beside it.
        if (hashUnit(wx, wy, 0x2a1) < 0.5) {
          const c = (hashUnit(wx, wy, 0x2b1) - 0.5) * 0.6, s = (hashUnit(wx, wy, 0x2c1) - 0.5) * 0.5;
          const cx = px + (0.5 - uy * c + ux * s) * ppt, cy = py + (0.5 + ux * c + uy * s) * ppt, L = (0.12 + hashUnit(wx, wy, 0x2d1) * 0.14) * ppt;
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.4 * k;
          ctx.beginPath();
          ctx.moveTo(cx - ux * L, cy - uy * L);
          ctx.quadraticCurveTo(cx - uy * 0.06 * ppt, cy + ux * 0.06 * ppt, cx + ux * L, cy + uy * L);
          ctx.stroke();
        }
        if (dep >= 2 && hashUnit(wx, wy, 0x2f0) < 0.12) glint(ctx, px + (0.2 + hashUnit(wx, wy, 0x2f1) * 0.6) * ppt, py + (0.2 + hashUnit(wx, wy, 0x2f2) * 0.6) * ppt, 0.13 * ppt);
        // Where two streams meet: a neighbour flowing in from another way.
        let meets = 0;
        for (let q = 0; q < 8; q++) {
          const ni = i - FLOW_DX[q]!, nj = j - FLOW_DY[q]!;
          if (isRiver(ni, nj) && flowOf(ni, nj) === q && ((q - f + 8) % 8 >= 2 && (q - f + 8) % 8 <= 6)) meets++;
        }
        if (meets && hashUnit(wx, wy, 0x640) < 0.8) foamArcs(ctx, px, py, ppt, ux, uy, wx, wy, 0x650);
        // A fall: the next tile along the stream's way stands lower.
        const ni = i + FLOW_DX[f]!, nj = j + FLOW_DY[f]!, no = nj * WIN + ni;
        if (ni >= 0 && nj >= 0 && ni < WIN && nj < WIN && d.level[no]! < d.level[o]!) {
          const ex = px + (0.5 + FLOW_DX[f]! * 0.5) * ppt, ey = py + (0.5 + FLOW_DY[f]! * 0.5) * ppt;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 3 * k;
          ctx.beginPath();
          ctx.moveTo(ex - uy * 0.42 * ppt, ey + ux * 0.42 * ppt);
          ctx.lineTo(ex + uy * 0.42 * ppt, ey - ux * 0.42 * ppt);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          for (let q = 0; q < 4; q++) {
            const s = 0.15 + hashUnit(wx, wy, 0x610 + q) * 0.35, c = (hashUnit(wx, wy, 0x620 + q) - 0.5) * 0.7;
            ctx.beginPath();
            ctx.arc(ex + ux * s * ppt - uy * c * ppt, ey + uy * s * ppt + ux * c * ppt, (0.035 + hashUnit(wx, wy, 0x630 + q) * 0.03) * ppt, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        // Still water: short ripples, a glint on the deep.
        if (hashUnit(wx, wy, 0x91) < 0.3) {
          const rx = px + hashUnit(wx, wy, 0x92) * 0.5 * ppt, ry = py + (0.3 + hashUnit(wx, wy, 0x93) * 0.4) * ppt;
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 1.2 * k;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.quadraticCurveTo(rx + 0.2 * ppt, ry - 0.1 * ppt, rx + 0.4 * ppt, ry);
          ctx.stroke();
        }
        if (dep >= 2 && hashUnit(wx, wy, 0x2f3) < 0.06) glint(ctx, px + (0.2 + hashUnit(wx, wy, 0x2f4) * 0.6) * ppt, py + (0.2 + hashUnit(wx, wy, 0x2f5) * 0.6) * ppt, 0.12 * ppt);
      }
      // Where a fall lands: a stream up-tile pouring in from a level higher.
      for (let q = 0; q < 8; q++) {
        const ui = i - FLOW_DX[q]!, uj = j - FLOW_DY[q]!;
        if (!isRiver(ui, uj) || flowOf(ui, uj) !== q || d.level[uj * WIN + ui]! <= d.level[o]!) continue;
        plunge(ctx, px, py, ppt, wx, wy);
        break;
      }
    }
  }
  ctx.restore();
  // Still water's depth: broken ripple lines along it two tiles from the shore.
  const ring = march((i, j) => isWaterT(t(i, j)) && depth[j * WIN + i]! >= 2, ppt).segs.filter(([ax, ay]) => hashUnit(Math.round((ax! / ppt + wx0 + B) * 4), Math.round((ay! / ppt + wy0 + B) * 4), 0x7b1) >= 0.45);
  strokeSegs(ctx, ring, C.paper, 1.1 * k, 0.4);
}

/** A glint on the water: a small four-pointed star, paper-white. */
function glint(ctx: Ctx2, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.22, y - r * 0.22); ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.22, y + r * 0.22);
  ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.22, y + r * 0.22); ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.22, y - r * 0.22);
  ctx.closePath();
  ctx.fill();
}

/** Foam across a tile where streams meet: two or three white arcs across the way, broken. */
function foamArcs(ctx: Ctx2, px: number, py: number, ppt: number, ux: number, uy: number, wx: number, wy: number, salt: number): void {
  const k = ppt / 32, n = 2 + Math.floor(hashUnit(wx, wy, salt) * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.6 * k;
  for (let q = 0; q < n; q++) {
    const s = (hashUnit(wx, wy, salt + 1 + q) - 0.5) * 0.6, half = (0.18 + hashUnit(wx, wy, salt + 5 + q) * 0.16) * ppt;
    const cx = px + (0.5 + ux * s) * ppt, cy = py + (0.5 + uy * s) * ppt;
    ctx.beginPath();
    ctx.moveTo(cx - uy * half, cy + ux * half);
    ctx.quadraticCurveTo(cx + ux * 0.12 * ppt, cy + uy * 0.12 * ppt, cx + uy * half, cy - ux * half);
    ctx.stroke();
  }
}

/** Where a fall lands (D115): the water boiling — a pale disc, a ring of foam broken, spray. */
function plunge(ctx: Ctx2, px: number, py: number, ppt: number, wx: number, wy: number): void {
  const k = ppt / 32, cx = px + 0.5 * ppt, cy = py + 0.5 * ppt;
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, cy, 0.42 * ppt, 0.34 * ppt, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5 * k;
  for (let q = 0; q < 3; q++) {
    const a0 = hashUnit(wx, wy, 0x660 + q) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.36 * ppt, 0.28 * ppt, 0, a0, a0 + 1.2 + hashUnit(wx, wy, 0x664 + q)); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let q = 0; q < 6; q++) {
    const a = hashUnit(wx, wy, 0x670 + q) * Math.PI * 2, r = (0.1 + hashUnit(wx, wy, 0x678 + q) * 0.35) * ppt;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, (0.03 + hashUnit(wx, wy, 0x680 + q) * 0.035) * ppt, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * A crevasse's colours (D94; owner, 2026-10-16: « Le précipice a plus l'air d'une marée de pétrole
 * que d'un trou… Il faut que ça ressemble à une crevasse »): the far wall from its lit lip down
 * through the Crown's ochres to a violet dusk, a cool haze in the depth, the near-black strip at the
 * very bottom, the stones on the lip.
 */
export const CREVASSE = {
  lip: mix(C.rock1, C.paper, 0.2),
  wall: [mix(C.rock1, '#8a4f3c', 0.35), mix(C.rock1, '#5e3538', 0.55), '#6a4040', '#4d3239'] as readonly string[],
  haze: 'rgba(176, 168, 204, 0.22)',
  bottom: '#15101c',
  stone: mix(C.sand, '#8a6a52', 0.45),
} as const;

/** The chasms (`paintChunk`'s pass 3b): each drawn as a crevasse. */
export function paintChasms(ctx: Ctx2, d: PaintData, ppt: number): void {
  const m = march((i, j) => d.terrain[j * WIN + i] === T.Chasm, ppt, true);
  if (m.polys.length) paintCrevasse(ctx, d, m, ppt);
}

/**
 * A crevasse (D94), drawn into the ground texture — one picture for the iso view and the plan —
 * as the iso camera sees a crack in the ground: from the near lip (+x +y, the bottom of the screen)
 * it looks across at the far wall (−x −y), lit, in the Crown's ochres; the near wall faces away,
 * hidden behind its lip.
 *
 * - Its rims broken: every outline point moved by a hash of its world position (so chunks join), the
 *   lips' ink cut at its midpoints too, heavier on the near lip.
 * - The far wall in bands that follow its lip and darken with depth (the shape moved down the slope,
 *   +x +y, by a little more each band: the walls converge as they go down), strata lines along them,
 *   cracks running down the face, a pebble on a ledge here and there; hatching in the dark below.
 * - A cool haze over the deep bands, and only along the near lip the near-black strip of the bottom.
 * - On the floor beside it, loose stones on the lip and small side cracks branching off into the ground.
 *
 * The details from 16 px a tile; far zooms keep the bands, the strip and the inked rim.
 */
function paintCrevasse(ctx: Ctx2, d: PaintData, m: { polys: number[][]; segs: number[][] }, ppt: number): void {
  const k = ppt / 32, B = BORDER, near = ppt >= 16;
  const ox = d.cx * 32, oy = d.cy * 32;
  const isChasm = (wx: number, wy: number): boolean => {
    const i = wx - ox + B, j = wy - oy + B;
    return i >= 0 && j >= 0 && i < WIN && j < WIN && d.terrain[j * WIN + i] === T.Chasm;
  };
  // A rim point moved by a hash of its world position (quarter tiles): the same on both sides of a chunk seam.
  const amp = 0.3 * ppt;
  const jit = (px: number, py: number, salt = 0): [number, number] => {
    const X = Math.round((px / ppt + ox) * 4), Y = Math.round((py / ppt + oy) * 4);
    return [px + (hashUnit(X, Y, 0x410 + salt) - 0.5) * amp, py + (hashUnit(X, Y, 0x420 + salt) - 0.5) * amp];
  };
  const polys = m.polys.map((p) => { const q: number[] = []; for (let n = 0; n < p.length; n += 2) q.push(...jit(p[n]!, p[n + 1]!)); return q; });
  // The lips: each segment cut at its midpoint, the midpoint moved further (a notch, a jut).
  const lips: number[][] = [];
  for (const sg of m.segs) {
    const [ax, ay] = jit(sg[0]!, sg[1]!), [bx, by] = jit(sg[2]!, sg[3]!);
    const [mx, my] = jit((sg[0]! + sg[2]!) / 2, (sg[1]! + sg[3]!) / 2, 7);
    lips.push([ax, ay, mx, my], [mx, my, bx, by]);
  }
  const shape = (dx: number, dy: number): void => {
    for (const p of polys) {
      for (let n = 0; n < p.length; n += 2) { if (n) ctx.lineTo(p[n]! + dx, p[n + 1]! + dy); else ctx.moveTo(p[n]! + dx, p[n + 1]! + dy); }
      ctx.closePath();
    }
  };
  const fillShape = (s: number, color: string): void => { ctx.beginPath(); shape(s * ppt, s * ppt); ctx.fillStyle = color; ctx.fill(); };

  ctx.save();
  ctx.beginPath();
  shape(0, 0);
  ctx.clip();
  // The far wall: lit at its lip, darker band by band down the slope.
  ctx.fillStyle = CREVASSE.lip;
  ctx.fillRect(-B * ppt, -B * ppt, WIN * ppt, WIN * ppt);
  [0.16, 0.34, 0.55, 0.8].forEach((s, n) => fillShape(s, CREVASSE.wall[n]!));
  if (near) {
    ctx.lineCap = 'round';
    // Strata along the lip, fainter as they go down.
    [0.07, 0.2, 0.36, 0.52].forEach((s, n) => {
      ctx.strokeStyle = rgba(C.ink, 0.5 - n * 0.09);
      ctx.lineWidth = (n === 0 ? 1.5 : 1) * k;
      ctx.beginPath();
      for (const l of lips) { ctx.moveTo(l[0]! + s * ppt, l[1]! + s * ppt); ctx.lineTo(l[2]! + s * ppt, l[3]! + s * ppt); }
      ctx.stroke();
    });
    // Cracks down the face (+x +y: straight down in iso) and a pebble on a ledge, by the far lip.
    ctx.strokeStyle = rgba(C.ink, 0.42);
    ctx.lineWidth = 1 * k;
    ctx.beginPath();
    const pebbles: Array<[number, number, number]> = [];
    for (let j = B - 1; j < B + 33; j++) for (let i = B - 1; i < B + 33; i++) {
      if (d.terrain[j * WIN + i] !== T.Chasm) continue;
      const wx = ox - B + i, wy = oy - B + j;
      if (isChasm(wx - 1, wy) && isChasm(wx, wy - 1)) continue; // the far lip's tiles only
      for (let q = 0; q < 2; q++) {
        if (hashUnit(wx, wy, 0x430 + q) > 0.6) continue;
        const x = (i - B + hashUnit(wx, wy, 0x440 + q)) * ppt, y = (j - B + hashUnit(wx, wy, 0x450 + q)) * ppt;
        const l = (0.18 + hashUnit(wx, wy, 0x460 + q) * 0.4) * ppt, b = (hashUnit(wx, wy, 0x470 + q) - 0.5) * 0.12 * ppt;
        ctx.moveTo(x, y);
        ctx.lineTo(x + l * 0.5 + b, y + l * 0.5 - b);
        ctx.lineTo(x + l, y + l);
      }
      if (hashUnit(wx, wy, 0x480) < 0.3) pebbles.push([(i - B + 0.3 + hashUnit(wx, wy, 0x481) * 0.4) * ppt, (j - B + 0.3 + hashUnit(wx, wy, 0x482) * 0.4) * ppt, (0.05 + hashUnit(wx, wy, 0x483) * 0.04) * ppt]);
    }
    ctx.stroke();
    for (const [x, y, r] of pebbles) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r, 0.4, 0, Math.PI * 2);
      ctx.fillStyle = CREVASSE.lip;
      ctx.fill();
      ctx.strokeStyle = rgba(C.ink, 0.7);
      ctx.lineWidth = 0.8 * k;
      ctx.stroke();
    }
    // Hatching in the shade below, down the slope (+x +y: grooves straight down the wall in iso, a
    // shading of the drop in plan), its spacing uneven by a hash of its world line; denser deeper down.
    for (const [s, a, per] of [[0.42, 0.42, 5], [0.7, 0.5, 8]] as const) {
      ctx.save();
      ctx.beginPath();
      shape(s * ppt, s * ppt);
      ctx.clip();
      ctx.strokeStyle = rgba(C.ink, a);
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      // Lines x − y = c (world tiles), `per` a tile from a whole c (so chunks' lattices meet), each moved by a hash of its own.
      const c0 = Math.floor(ox - oy - WIN), n1 = 2 * WIN * per;
      for (let n = 0; n < n1; n++) {
        const c = c0 + n / per, cj = c + (hashUnit(c0 * per + n, per, 0x530) - 0.5) * (0.8 / per);
        const x0 = (cj - ox + oy) * ppt - B * ppt, y0 = -B * ppt; // at y = −B (window's top), x − y = cj
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + WIN * ppt, y0 + WIN * ppt);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  // A haze in the depth, then along the near lip the near-black strip of the bottom.
  fillShape(0.62, CREVASSE.haze);
  ctx.beginPath();
  ctx.rect(-B * ppt, -B * ppt, WIN * ppt, WIN * ppt);
  shape(-0.22 * ppt, -0.22 * ppt);
  ctx.fillStyle = CREVASSE.bottom;
  ctx.fill('evenodd');
  ctx.restore();

  // The lips: a paper halo, the ink heavier on the near lip (the chasm up and to the left of it).
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.paper;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 3.4 * k;
  ctx.beginPath();
  for (const l of lips) { ctx.moveTo(l[0]!, l[1]!); ctx.lineTo(l[2]!, l[3]!); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.ink;
  for (const nearLip of [false, true]) {
    ctx.lineWidth = (nearLip ? 2.9 : 1.8) * k;
    ctx.beginPath();
    for (const l of lips) {
      const mx = (l[0]! + l[2]!) / 2 / ppt + ox, my = (l[1]! + l[3]!) / 2 / ppt + oy;
      if (isChasm(Math.floor(mx - 0.45), Math.floor(my - 0.45)) !== nearLip) continue;
      ctx.moveTo(l[0]!, l[1]!);
      ctx.lineTo(l[2]!, l[3]!);
    }
    ctx.stroke();
  }
  if (!near) { ctx.restore(); return; }
  // On the floor beside it: loose stones on the lip, a side crack branching off here and there.
  for (let j = B; j < B + 32; j++) for (let i = B; i < B + 32; i++) {
    const wx = ox - B + i, wy = oy - B + j;
    if (isChasm(wx, wy) || d.level[j * WIN + i] !== 0) continue;
    const sides: Array<[number, number]> = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (isChasm(wx + dx, wy + dy)) sides.push([dx, dy]);
    if (!sides.length) continue;
    const [dx, dy] = sides[Math.floor(hashUnit(wx, wy, 0x490) * sides.length)]!;
    const cx = (i - B + 0.5 + dx * 0.32) * ppt, cy = (j - B + 0.5 + dy * 0.32) * ppt;
    if (hashUnit(wx, wy, 0x4a0) < 0.34) {
      for (let q = 0; q < 1 + Math.floor(hashUnit(wx, wy, 0x4a1) * 2); q++) {
        const sx = cx + (hashUnit(wx, wy, 0x4b0 + q) - 0.5) * 0.5 * ppt * (dy ? 1 : 0.4), sy = cy + (hashUnit(wx, wy, 0x4c0 + q) - 0.5) * 0.5 * ppt * (dx ? 1 : 0.4);
        const r = (0.07 + hashUnit(wx, wy, 0x4d0 + q) * 0.08) * ppt;
        ctx.beginPath();
        for (let v = 0; v < 6; v++) {
          const a = (v / 6) * Math.PI * 2 + hashUnit(wx, wy, 0x4e0 + q), rr = r * (0.7 + hashUnit(wx, wy, 0x4f0 + v + q * 8) * 0.5);
          if (v) ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.8); else ctx.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.8);
        }
        ctx.closePath();
        ctx.fillStyle = CREVASSE.stone;
        ctx.fill();
        ctx.strokeStyle = rgba(C.ink, 0.85);
        ctx.lineWidth = 1 * k;
        ctx.stroke();
      }
    } else if (hashUnit(wx, wy, 0x4a0) < 0.56) {
      // A side crack: from the lip back into the floor, kinked, with a short fork.
      let x = (i - B + 0.5 + dx * 0.48) * ppt, y = (j - B + 0.5 + dy * 0.48) * ppt;
      ctx.strokeStyle = rgba(C.ink, 0.6);
      ctx.lineWidth = 1.1 * k;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let q = 0; q < 3; q++) {
        x -= (dx * 0.26 + (hashUnit(wx, wy, 0x500 + q) - 0.5) * 0.3 * Math.abs(dy)) * ppt;
        y -= (dy * 0.26 + (hashUnit(wx, wy, 0x510 + q) - 0.5) * 0.3 * Math.abs(dx)) * ppt;
        ctx.lineTo(x, y);
        if (q === 1) { ctx.moveTo(x, y); ctx.lineTo(x - (dy * 0.18 + dx * 0.12) * ppt, y - (dx * 0.18 + dy * 0.12) * ppt); ctx.moveTo(x, y); }
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
