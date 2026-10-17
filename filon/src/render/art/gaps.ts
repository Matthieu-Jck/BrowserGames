// gaps.ts — the chunk painter's water and gaps (D94), apart from the ground and the rock
// (terrain.ts): still water (the lakes, the tarn on its rock) with a shallow ring, a deep heart, an
// inked shore and ripples; a river as running water a little bluer than the lakes, its shores inked
// with the lakes', short strokes along the way it flows (the chunk's biome code holds it); a chasm
// as a cut in the ground. Painted into the ground texture (both views), cached with the chunks.
import { hashUnit } from '@/core/hash';
import { T } from '@/sim/types';
import { isWaterT } from '../relief';
import { C, mix, rgba } from './tokens';
import { BORDER, WIN, fillPolys, march, strokeSegs, type Ctx2, type PaintData } from './paint-kit';

/** A river tile's biome code base (mapgen's `BIOME.river`, D94: + the way it flows); the painter keeps off the generator's module. */
export const RIVER_BIOME = 16;
/** The sea's biome code (mapgen's `BIOME.sea`, D94): its coast gets surf. */
export const SEA_BIOME = 24;
/** The open sea's deep water: a little bluer and darker than a lake's. */
export const SEA_DEEP = mix(C.deep, '#2a6b98', 0.4);
/** The eight ways a river flows (0 = +x, 2 = +y, clockwise): the step to the next tile along it. */
const FLOW_DX = [1, 1, 0, -1, -1, -1, 0, 1], FLOW_DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** Still water and rivers (`paintChunk`'s pass 3): the beds, the deep heart, one shore round both, the ripples. */
export function paintWater(ctx: Ctx2, d: PaintData, ppt: number): void {
  const t = (i: number, j: number): number => d.terrain[j * WIN + i]!;
  const B = BORDER, k = ppt / 32, wx0 = d.cx * 32 - B, wy0 = d.cy * 32 - B;
  const water = march((i, j) => isWaterT(t(i, j)), ppt);
  const isRiver = (i: number, j: number): boolean => t(i, j) === T.River;
  const river = march(isRiver, ppt, true);
  if (river.polys.length) paintRiver(ctx, d, river.polys, ppt);
  if (!water.polys.length && !river.polys.length) return;
  fillPolys(ctx, water.polys, C.shallow);
  const deep = march((i, j) => t(i, j) === T.Deep, ppt);
  fillPolys(ctx, deep.polys, C.deep);
  // The open sea's deep water a little bluer than a lake's (its biome code).
  const isSea = (i: number, j: number): boolean => d.biome[j * WIN + i] === SEA_BIOME;
  const seaDeep = march((i, j) => t(i, j) === T.Deep && isSea(i, j), ppt);
  if (seaDeep.polys.length) fillPolys(ctx, seaDeep.polys, SEA_DEEP);
  strokeSegs(ctx, deep.segs, C.turqL, 1.6 * k, 0.8);
  // One shore round still and running water together, so a river's mouth opens into its lake.
  const shore = river.polys.length ? march((i, j) => isWaterT(t(i, j)) || isRiver(i, j), ppt, true).segs : water.segs;
  strokeSegs(ctx, shore, C.paper, 3.6 * k, 0.75);
  strokeSegs(ctx, shore, C.ink, 2.2 * k, 1);
  paintSurf(ctx, d, ppt, isSea);
  if (ppt < 16) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.2 * k;
  ctx.lineCap = 'round';
  for (let j = B; j < B + 32; j++) for (let i = B; i < B + 32; i++) {
    if (!isWaterT(t(i, j))) continue;
    const wx = wx0 + i, wy = wy0 + j;
    if (hashUnit(wx, wy, 0x91) > 0.3) continue;
    const px = (i - B + hashUnit(wx, wy, 0x92) * 0.5) * ppt, py = (j - B + 0.3 + hashUnit(wx, wy, 0x93) * 0.4) * ppt;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + 0.2 * ppt, py - 0.1 * ppt, px + 0.4 * ppt, py);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The sea's surf (D94): three broken lines of white foam following the coast out at sea, from a
 * third of a tile to a tile and a fifth out, fainter further out (the coast's outline moved towards the sea, side by side with its own
 * normal; dashed by a hash of their world position), so the sea's edge reads as breaking water.
 */
function paintSurf(ctx: Ctx2, d: PaintData, ppt: number, isSea: (i: number, j: number) => boolean): void {
  const coast = march(isSea, ppt);
  if (!coast.segs.length) return;
  const k = ppt / 32, B = BORDER, ox = d.cx * 32, oy = d.cy * 32;
  const sea = (px: number, py: number): boolean => {
    const i = Math.floor(px / ppt) + B, j = Math.floor(py / ppt) + B;
    return i >= 0 && j >= 0 && i < WIN && j < WIN && isSea(i, j);
  };
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
 * A river's water (D94): its bed a little bluer than the still lakes, then on every river tile
 * (near zooms) a stroke or two along the way it flows — the chunk's biome code, `RIVER_BIOME` + the
 * eighth of a turn (0 = east, 2 = south) — paper-white, hooked like a ripple, hashed off the tile's
 * world coordinates so chunks join. Where a stream steps down (the next tile along its way stands
 * lower: up on a massif, D94), a band of foam across it at the step and spray below — the plan
 * view's fall (in iso the relief draws the fall down its wall).
 */
function paintRiver(ctx: Ctx2, d: PaintData, polys: number[][], ppt: number): void {
  const k = ppt / 32, B = BORDER;
  fillPolys(ctx, polys, C.river);
  if (ppt < 16) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (let j = B; j < B + 32; j++) {
    for (let i = B; i < B + 32; i++) {
      const o = j * WIN + i;
      if (d.terrain[o] !== T.River) continue;
      const wx = d.cx * 32 - B + i, wy = d.cy * 32 - B + j;
      const flow = d.biome[o]! - RIVER_BIOME, a = ((flow >= 0 && flow < 8 ? flow : 0) * Math.PI) / 4;
      const ux = Math.cos(a), uy = Math.sin(a);
      for (let q = 0; q < 2; q++) {
        if (hashUnit(wx, wy, 0x2a0 + q) > 0.55) continue;
        const cx = (i - B + 0.2 + hashUnit(wx, wy, 0x2b0 + q) * 0.6) * ppt, cy = (j - B + 0.2 + hashUnit(wx, wy, 0x2c0 + q) * 0.6) * ppt;
        const L = (0.22 + hashUnit(wx, wy, 0x2d0 + q) * 0.18) * ppt, bend = 0.12 * ppt;
        ctx.strokeStyle = q ? rgba(C.riverD, 0.55) : 'rgba(255,255,255,0.75)';
        ctx.lineWidth = (q ? 1.1 : 1.4) * k;
        ctx.beginPath();
        ctx.moveTo(cx - ux * L, cy - uy * L);
        ctx.quadraticCurveTo(cx - uy * bend, cy + ux * bend, cx + ux * L, cy + uy * L);
        ctx.stroke();
      }
      // A fall: the next tile along the stream's way stands lower.
      const f = flow >= 0 && flow < 8 ? flow : 0, ni = i + FLOW_DX[f]!, nj = j + FLOW_DY[f]!, no = nj * WIN + ni;
      if (d.level[no]! < d.level[o]!) {
        const ex = (i - B + 0.5 + FLOW_DX[f]! * 0.5) * ppt, ey = (j - B + 0.5 + FLOW_DY[f]! * 0.5) * ppt;
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
    }
  }
  ctx.restore();
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
