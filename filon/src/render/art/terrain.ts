// terrain.ts — paints one 32×32-tile chunk in the BD-Moebius idiom, top-down; the renderer
// lays it flat under the view projection (iso or plan). Two textures per chunk:
// · the GROUND (both views): a soft pastel field, water and hardpan cut by marching squares
//   with inked shores, rock as a flat map (fills by hardness, contour lines, slope hachures,
//   a bold cliff edge), stippled grain, dune ripples, salt crackle, deposits, biome decor;
// · the RELIEF paint (iso only): rock columns painted obliquely (each level lifts a column by
//   a ground shift along −x −y) with their cast shadows, so that laid in iso the terraces
//   stand up exactly as the relief sprites draw them — the far-zoom stand-in for the sprites.
//   Water up on the rock (the Crown's tarn, D63) is a column too, topped by its pool
//   (`columnLook`): in iso it lies at its level, in plan the ground shows it within the rock.
// Every random choice is hashed from WORLD coordinates and every shape reads a border window,
// so chunks join seamlessly. Runs in a worker (OffscreenCanvas) — no DOM, no Pixi.
import { ITEMS } from '@/content/items';
import { ITEM_IDS } from '@/content/registry';
import { hash32, hashUnit } from '@/core/hash';
import { T } from '@/sim/types';
import { C, mix, rgba } from './tokens';
import { columnShadow, drawColumn, type Proj, type TopLook } from './rock';
import { isRockT, isWaterT, levelOf, maskAt, MAX_LEVEL, MAX_TERRACE, SHIFT, SMOOTH, STEP_LEVELS } from '../relief';

type Ctx2 = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Border of the paint window: relief columns up to MAX_LEVEL·SHIFT tiles in front of the chunk
 * lean back into it, and their levels need the smoothing ring plus one for the masks.
 */
export const BORDER = Math.ceil(MAX_LEVEL * SHIFT) + SMOOTH + 1;
export const WIN = 32 + 2 * BORDER;

export interface PaintData {
  cx: number;
  cy: number;
  terrain: Uint8Array; // WIN×WIN
  ore: Uint8Array;
  rich: Uint16Array;
  height: Uint8Array;
  biome: Uint8Array;
  /** The land's level (D45): the relief's terraces. */
  level: Uint8Array;
}

/** The chunk arrays a window is cut from (a Grid chunk, or test data). */
export interface ChunkArrays { terrain: Uint8Array; ore: Uint8Array; rich: Uint16Array; height: Uint8Array; biome: Uint8Array; level: Uint8Array }

/** Cut the paint window of chunk (cx, cy): the chunk plus BORDER tiles all round. */
export function buildWindow(chunkAt: (cx: number, cy: number) => ChunkArrays, cx: number, cy: number, worldTiles: number): PaintData {
  const n = WIN * WIN;
  const d: PaintData = {
    cx, cy,
    terrain: new Uint8Array(n).fill(T.DuneSea), ore: new Uint8Array(n), rich: new Uint16Array(n),
    height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n),
  };
  for (let j = 0; j < WIN; j++) {
    for (let i = 0; i < WIN; i++) {
      const x = cx * 32 - BORDER + i, y = cy * 32 - BORDER + j;
      if (x < 0 || y < 0 || x >= worldTiles || y >= worldTiles) continue;
      const c = chunkAt(x >> 5, y >> 5);
      const k = (y & 31) * 32 + (x & 31), o = j * WIN + i;
      d.terrain[o] = c.terrain[k]!;
      d.ore[o] = c.ore[k]!;
      d.rich[o] = c.rich[k]!;
      d.height[o] = c.height[k]!;
      d.biome[o] = c.biome[k]!;
      d.level[o] = c.level[k]!;
    }
  }
  return d;
}

const GROUND: Record<number, string> = {
  [T.Sand]: C.sand, [T.Hardpan]: C.hardpan, [T.Salt]: C.salt, [T.Vent]: C.hardpan, [T.DuneSea]: C.duneSea,
  [T.Dug]: C.dug, [T.Filled]: C.filled, [T.Shallow]: C.shallow, [T.Deep]: C.deep,
  [T.Rock1]: C.rock1, [T.Rock2]: C.rock2, [T.Rock3]: C.rock3, [T.Rock4]: C.rock4,
};
const ROCK_FILL = [C.rock1, C.rock2, C.rock3, C.rock4];
const BIOME_TINT: Record<number, string> = { 1: C.turqL, 2: C.warn, 3: C.coralL, 4: C.inkSoft, 5: C.lilacL, 6: C.lilac, 7: C.cirque };

const hex = (h: string): [number, number, number] => {
  const p = parseInt(h.slice(1), 16);
  return [(p >> 16) & 255, (p >> 8) & 255, p & 255];
};

/**
 * Marching squares with linear interpolation over a SMOOTHED membership field (3×3 mean of a
 * per-tile predicate), so shores are soft curves instead of tile staircases. The field reads
 * the border, so both sides of a chunk seam compute identical values. Samples sit at tile
 * centres; chunk px of sample i: (i - BORDER + 0.5) * ppt. Only cells near the chunk march.
 */
function march(inside: (i: number, j: number) => boolean, ppt: number): { polys: number[][]; segs: number[][] } {
  const polys: number[][] = [];
  const segs: number[][] = [];
  const raw = new Float32Array(WIN * WIN);
  for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) raw[j * WIN + i] = inside(i, j) ? 1 : 0;
  const v = new Float32Array(WIN * WIN);
  let any = false;
  for (let j = 1; j < WIN - 1; j++) {
    for (let i = 1; i < WIN - 1; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += raw[(j + dj) * WIN + i + di]! * (di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1);
      v[j * WIN + i] = s / 16;
      if (s > 0) any = true;
    }
  }
  if (!any) return { polys, segs };
  const X = (i: number): number => (i - BORDER + 0.5) * ppt;
  const lerp = (a: number, b: number): number => { const d = b - a; return d === 0 ? 0.5 : (0.5 - a) / d; };
  const lo = BORDER - 2, hi = BORDER + 33;
  for (let j = lo; j < hi; j++) {
    for (let i = lo; i < hi; i++) {
      const a = v[j * WIN + i]!, b = v[j * WIN + i + 1]!, c = v[(j + 1) * WIN + i + 1]!, d = v[(j + 1) * WIN + i]!;
      const code = (a >= 0.5 ? 8 : 0) | (b >= 0.5 ? 4 : 0) | (c >= 0.5 ? 2 : 0) | (d >= 0.5 ? 1 : 0);
      if (code === 0) continue;
      const x0 = X(i), x1 = X(i + 1), y0 = X(j), y1 = X(j + 1);
      const T_: [number, number] = [x0 + (x1 - x0) * lerp(a, b), y0];
      const R: [number, number] = [x1, y0 + (y1 - y0) * lerp(b, c)];
      const B: [number, number] = [x0 + (x1 - x0) * lerp(d, c), y1];
      const L: [number, number] = [x0, y0 + (y1 - y0) * lerp(a, d)];
      const A: [number, number] = [x0, y0], Bc: [number, number] = [x1, y0], Cc: [number, number] = [x1, y1], D: [number, number] = [x0, y1];
      const P = (...pts: Array<[number, number]>): void => { polys.push(pts.flat()); };
      const S = (p: [number, number], q: [number, number]): void => { segs.push([p[0], p[1], q[0], q[1]]); };
      switch (code) {
        case 15: P(A, Bc, Cc, D); break;
        case 8: P(A, T_, L); S(T_, L); break;
        case 4: P(T_, Bc, R); S(T_, R); break;
        case 2: P(R, Cc, B); S(R, B); break;
        case 1: P(L, B, D); S(L, B); break;
        case 12: P(A, Bc, R, L); S(L, R); break;
        case 6: P(T_, Bc, Cc, B); S(T_, B); break;
        case 3: P(L, R, Cc, D); S(L, R); break;
        case 9: P(A, T_, B, D); S(T_, B); break;
        case 14: P(A, Bc, Cc, B, L); S(L, B); break;
        case 13: P(A, Bc, R, B, D); S(R, B); break;
        case 11: P(A, T_, R, Cc, D); S(T_, R); break;
        case 7: P(T_, Bc, Cc, D, L); S(T_, L); break;
        case 10: P(A, T_, R, Cc, B, L); S(T_, R); S(B, L); break;
        case 5: P(T_, Bc, R, B, D, L); S(T_, L); S(R, B); break;
      }
    }
  }
  return { polys, segs };
}

function fillPolys(ctx: Ctx2, polys: number[][], color: string, dx = 0, dy = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const p of polys) {
    ctx.moveTo(p[0]! + dx, p[1]! + dy);
    for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k]! + dx, p[k + 1]! + dy);
    ctx.closePath();
  }
  ctx.fill();
}

function strokeSegs(ctx: Ctx2, segs: number[][], color: string, w: number, alpha = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of segs) { ctx.moveTo(s[0]!, s[1]!); ctx.lineTo(s[2]!, s[3]!); }
  ctx.stroke();
  ctx.restore();
}

export function paintChunk(ctx: Ctx2, d: PaintData, ppt: number, scratch: (w: number, h: number) => OffscreenCanvas): void {
  const at = (i: number, j: number): number => j * WIN + i; // window index
  const t = (i: number, j: number): number => d.terrain[at(i, j)]!;
  const B = BORDER;
  const wx0 = d.cx * 32 - B, wy0 = d.cy * 32 - B; // world coords of window (0,0)
  const k = ppt / 32;

  // ── 1. ground: soft pastel field (smoothed upscale of per-tile colours) ──
  const small = scratch(WIN, WIN);
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(WIN, WIN);
  for (let j = 0; j < WIN; j++) {
    for (let i = 0; i < WIN; i++) {
      const tt = t(i, j);
      let col = isRockT(tt) || isWaterT(tt) || tt === T.Hardpan || tt === T.Vent ? C.sand : (GROUND[tt] ?? C.sand);
      const b = d.biome[at(i, j)]!;
      if (b && BIOME_TINT[b] && !isRockT(tt) && !isWaterT(tt)) col = mix(col, BIOME_TINT[b], b === 7 ? 1 : 0.28);
      const h = d.height[at(i, j)]!;
      col = mix(col, '#ffffff', Math.max(0, (h - 120) / 900));
      const [r, g, bb] = hex(col);
      const o = at(i, j) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bb; img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, WIN, WIN, -B * ppt, -B * ppt, WIN * ppt, WIN * ppt);

  // ── 2. grain: world-space stipple, ripples, salt crackle ───────────────────
  const dots = Math.max(1, Math.round(3 * k * k));
  for (let j = B; j < B + 32; j++) {
    for (let i = B; i < B + 32; i++) {
      const tt = t(i, j);
      if (isRockT(tt) || isWaterT(tt)) continue;
      const wx = wx0 + i, wy = wy0 + j;
      const px = (i - B) * ppt, py = (j - B) * ppt;
      const n = tt === T.Salt ? 1 : tt === T.Hardpan ? 2 : dots;
      ctx.fillStyle = rgba(mix(GROUND[tt] ?? C.sand, C.ink, 0.4), 0.45);
      for (let q = 0; q < n; q++) {
        const h = hash32(wx, wy, q, 0x5e);
        const ox = (h & 1023) / 1024, oy = ((h >>> 10) & 1023) / 1024, rr = (0.55 + ((h >>> 20) & 7) / 10) * Math.max(0.6, k);
        ctx.beginPath();
        ctx.arc(px + ox * ppt, py + oy * ppt, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ppt >= 16 && (tt === T.Sand || tt === T.DuneSea) && hashUnit(wx, wy, 0x71) < (tt === T.DuneSea ? 0.6 : 0.22)) {
        // Dune ripple: a shallow arc across the tile.
        const ox = hashUnit(wx, wy, 0x72) * 0.5, oy = 0.2 + hashUnit(wx, wy, 0x73) * 0.6;
        ctx.save();
        ctx.strokeStyle = rgba(C.dune, 0.9);
        ctx.lineWidth = 1.4 * k;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px + ox * ppt, py + oy * ppt);
        ctx.quadraticCurveTo(px + (ox + 0.3) * ppt, py + (oy - 0.18) * ppt, px + (ox + 0.65) * ppt, py + oy * ppt);
        ctx.stroke();
        ctx.restore();
      }
      if (ppt >= 16 && tt === T.Salt) {
        ctx.save();
        ctx.strokeStyle = rgba(C.lilacL, 0.9);
        ctx.lineWidth = 0.9 * k;
        ctx.beginPath();
        let x = px + hashUnit(wx, wy, 1) * ppt, y = py;
        ctx.moveTo(x, y);
        for (let s = 0; s < 3; s++) { x += (hashUnit(wx, wy, 10 + s) - 0.5) * ppt * 0.7; y += ppt / 3; ctx.lineTo(x, y); }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ── 2b. hardpan plateaus & passes: a flat region with crackle and a light rim ──
  const pan = march((i, j) => { const tt = t(i, j); return tt === T.Hardpan || tt === T.Vent; }, ppt);
  if (pan.polys.length) {
    fillPolys(ctx, pan.polys, C.hardpan);
    if (ppt >= 16) {
      ctx.save();
      ctx.strokeStyle = rgba(C.mesa, 0.55);
      ctx.lineWidth = 0.9 * k;
      ctx.lineCap = 'round';
      for (let j = B; j < B + 32; j++) for (let i = B; i < B + 32; i++) {
        const tt = t(i, j);
        if (tt !== T.Hardpan) continue;
        const wx = wx0 + i, wy = wy0 + j;
        if (hashUnit(wx, wy, 0x131) > 0.55) continue;
        let x = (i - B + hashUnit(wx, wy, 0x132)) * ppt, y = (j - B + hashUnit(wx, wy, 0x133)) * ppt;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let q = 0; q < 3; q++) { x += (hashUnit(wx, wy, 0x140 + q) - 0.5) * ppt * 0.6; y += (hashUnit(wx, wy, 0x150 + q) - 0.5) * ppt * 0.6; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    }
    strokeSegs(ctx, pan.segs, C.ink, 1 * k, 0.35);
  }

  // ── 3. water: shallow ring, deep heart, inked shore, ripples ─────────────
  const water = march((i, j) => isWaterT(t(i, j)), ppt);
  if (water.polys.length) {
    fillPolys(ctx, water.polys, C.shallow);
    const deep = march((i, j) => t(i, j) === T.Deep, ppt);
    fillPolys(ctx, deep.polys, C.deep);
    strokeSegs(ctx, deep.segs, C.turqL, 1.6 * k, 0.8);
    strokeSegs(ctx, water.segs, C.paper, 3.6 * k, 0.75);
    strokeSegs(ctx, water.segs, C.ink, 2.2 * k, 1);
    if (ppt >= 16) {
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
  }

  // ── 4. rock, as a map: cast shadow, fills by hardness, contours, hachures ──
  const rock = march((i, j) => isRockT(t(i, j)), ppt);
  if (rock.polys.length) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    fillPolys(ctx, rock.polys, C.inkSoft, 4 * k, 6 * k);
    ctx.restore();
    for (let lvl = 0; lvl < 4; lvl++) {
      const m = march((i, j) => { const tt = t(i, j); return isRockT(tt) && tt - T.Rock1 >= lvl; }, ppt);
      if (!m.polys.length) continue;
      fillPolys(ctx, m.polys, ROCK_FILL[lvl]!);
      if (lvl > 0) strokeSegs(ctx, m.segs, C.ink, 1.1 * k, 0.45);
    }
    if (ppt >= 16) {
      // Contour lines on the height field.
      for (let level = 140; level <= 240; level += 14) {
        const c = march((i, j) => isRockT(t(i, j)) && d.height[at(i, j)]! >= level, ppt);
        strokeSegs(ctx, c.segs, C.ink, 1.1 * k, 0.5);
      }
      // Pen hatching on slopes that face away from the top-left light: diagonal strokes whose
      // density follows the slope — Moebius' relief.
      ctx.save();
      ctx.strokeStyle = C.ink;
      ctx.lineCap = 'round';
      for (let j = B; j < B + 32; j++) for (let i = B; i < B + 32; i++) {
        if (!isRockT(t(i, j))) continue;
        const gx = d.height[at(i + 1, j)]! - d.height[at(i - 1, j)]!;
        const gy = d.height[at(i, j + 1)]! - d.height[at(i, j - 1)]!;
        const shade = -(gx * -0.6 + gy * -0.8); // > 0: descends towards the lower right, in shadow
        const wx = wx0 + i, wy = wy0 + j;
        const n = shade > 18 ? 4 : shade > 9 ? 3 : shade > 3 ? 2 : hashUnit(wx, wy, 0xa9) < 0.25 ? 1 : 0;
        if (!n) continue;
        ctx.globalAlpha = 0.34 + Math.min(0.34, shade / 70);
        ctx.lineWidth = 0.95 * k;
        const px = (i - B) * ppt, py = (j - B) * ppt;
        for (let q = 0; q < n; q++) {
          const off = ((q + 0.5) / n) * ppt + (hashUnit(wx, wy, 0xb0 + q) - 0.5) * ppt * 0.15;
          const len = ppt * (0.35 + hashUnit(wx, wy, 0xc0 + q) * 0.4);
          const cx = px + off, cy = py + ppt * (0.2 + 0.6 * hashUnit(wx, wy, 0xd8 + q));
          ctx.beginPath();
          ctx.moveTo(cx - len * 0.5, cy - len * 0.5);
          ctx.lineTo(cx + len * 0.5, cy + len * 0.5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    // The cliff edge: a bold inked line.
    strokeSegs(ctx, rock.segs, C.ink, 2.7 * k, 1);
  }

  // ── 5. vents, deposits, biome decor ───────────────────────────────────────
  for (let j = B; j < B + 32; j++) {
    for (let i = B; i < B + 32; i++) {
      const tt = t(i, j);
      const wx = wx0 + i, wy = wy0 + j;
      const px = (i - B) * ppt, py = (j - B) * ppt;
      if (tt === T.Vent) {
        ctx.fillStyle = rgba(C.coral, 0.55);
        ctx.beginPath(); ctx.arc(px + ppt / 2, py + ppt / 2, ppt * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.vent;
        ctx.beginPath(); ctx.arc(px + ppt / 2, py + ppt / 2, ppt * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2 * k; ctx.stroke();
        continue;
      }
      const o = d.ore[at(i, j)]!;
      if (o > 0 && !isWaterT(tt)) {
        const id = ITEM_IDS[o - 1]!;
        const col = (ITEMS as Record<string, { color: string }>)[id]!.color;
        const rich = d.rich[at(i, j)]!;
        const hidden = isRockT(tt); // veins inside rock: only a hint
        const n = hidden ? 1 : ppt < 16 ? 1 : Math.max(1, Math.min(4, Math.round(rich / 140)));
        for (let q = 0; q < n; q++) {
          const cx = px + (0.2 + hashUnit(wx, wy, 0xd0 + q) * 0.6) * ppt, cy = py + (0.2 + hashUnit(wx, wy, 0xe0 + q) * 0.6) * ppt;
          const r = (hidden ? 0.08 : 0.11 + hashUnit(wx, wy, 0xf0 + q) * 0.07) * ppt;
          ctx.save();
          ctx.globalAlpha = hidden ? 0.5 : 1;
          ctx.fillStyle = rgba(C.inkSoft, 0.25);
          ctx.beginPath(); ctx.ellipse(cx + r * 0.3, cy + r * 0.45, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.8, hashUnit(wx, wy, q) * 3, 0, Math.PI * 2); ctx.fill();
          if (ppt >= 16) {
            ctx.strokeStyle = C.ink; ctx.lineWidth = 1 * k; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.3, r * 0.25, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
      }
      const b = d.biome[at(i, j)]!;
      if (b >= 1 && b <= 6 && ppt >= 16 && hashUnit(wx, wy, 0x101) < 0.18 && o === 0 && !isWaterT(tt)) decor(ctx, b, px + ppt / 2, py + ppt / 2, ppt, hashUnit(wx, wy, 0x102));
    }
  }
}

/** Levels and per-step masks of the window (0 outside the valid ring). */
export function windowLevels(d: PaintData): { lv: Uint8Array; masks: Uint8Array[] } {
  const lv = new Uint8Array(WIN * WIN);
  const masks = Array.from({ length: MAX_TERRACE }, () => new Uint8Array(WIN * WIN));
  for (let j = SMOOTH; j < WIN - SMOOTH; j++) for (let i = SMOOTH; i < WIN - SMOOTH; i++) lv[j * WIN + i] = levelOf(d.terrain[j * WIN + i]!, d.level[j * WIN + i]!);
  const L = (i: number, j: number): number => (i < 0 || j < 0 || i >= WIN || j >= WIN ? 0 : lv[j * WIN + i]!);
  for (let j = SMOOTH + 1; j < WIN - SMOOTH - 1; j++) {
    for (let i = SMOOTH + 1; i < WIN - SMOOTH - 1; i++) {
      const l = lv[j * WIN + i]!;
      for (let t = 0; t * STEP_LEVELS < l; t++) masks[t]![j * WIN + i] = maskAt(L, i, j, (t + 1) * STEP_LEVELS);
    }
  }
  return { lv, masks };
}

/**
 * How a raised window tile is drawn: its rock class (for a column of water or reclaimed ground up
 * on the rock, D63: the hardest rock round it, its basin) and its top when it is not plain rock —
 * water or reclaimed ground, or rock in whose corner three tiles of water at its height meet —
 * with which of its 3×3 hold water and deep water at its height (art/rock.ts `TopLook`).
 */
export function columnLook(d: PaintData, lv: Uint8Array, o: number): { cls: number; top: TopLook | null } {
  const t = d.terrain[o]!, L = lv[o]!;
  let wet = 0, deep = 0, cls = isRockT(t) ? t - T.Rock1 : 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const n = o + j * WIN + i, u = d.terrain[n] ?? T.Sand, bit = 1 << (3 * (j + 1) + i + 1);
      if (isWaterT(u) && lv[n] === L) { wet |= bit; if (u === T.Deep) deep |= bit; }
      if (!isRockT(t) && isRockT(u) && u - T.Rock1 > cls) cls = u - T.Rock1;
    }
  }
  if (isWaterT(t)) return { cls, top: { kind: 'water', wet, deep } };
  if (!isRockT(t)) return { cls, top: { kind: 'ground', wet, deep } };
  // Rock: a top of its own only where a corner of it is under water (its three other tiles wet).
  const corner = (a: number, b: number, c: number): boolean => (wet & (1 << a)) !== 0 && (wet & (1 << b)) !== 0 && (wet & (1 << c)) !== 0;
  return { cls, top: corner(0, 1, 3) || corner(1, 2, 5) || corner(5, 7, 8) || corner(3, 6, 7) ? { kind: 'rock', wet, deep } : null };
}

/** The per-step masks of one window tile. */
export const tileMasks = (lv: Uint8Array, masks: readonly Uint8Array[], o: number): number[] => {
  const out: number[] = [];
  for (let t = 0; t * STEP_LEVELS < lv[o]!; t++) out.push(masks[t]![o]!);
  return out;
};

/**
 * The RELIEF paint: rock columns painted obliquely (a level = SHIFT tiles towards −x −y) over
 * a transparent texture, with their cast shadows, in depth order (x + y ascending) so nearer
 * columns cover farther ones. Returns false when the window holds no rock (nothing to paint).
 */
export function paintRelief(ctx: Ctx2, d: PaintData, ppt: number, scratch: (w: number, h: number) => OffscreenCanvas): boolean {
  const B = BORDER;
  const { lv, masks } = windowLevels(d);
  const lo = SMOOTH + 1, hi = WIN - SMOOTH - 1;
  const size = 32 * ppt;
  const cols: Array<[number, number]> = [];
  for (let j = lo; j < hi; j++) {
    for (let i = lo; i < hi; i++) {
      const L = lv[j * WIN + i]!;
      if (!L) continue;
      // Oblique extent: from the footprint back by L·SHIFT tiles.
      const x1 = (i - B + 1) * ppt, y1 = (j - B + 1) * ppt;
      const x0 = (i - B - L * SHIFT) * ppt, y0 = (j - B - L * SHIFT) * ppt;
      if (x1 < 0 || y1 < 0 || x0 > size || y0 > size) continue;
      cols.push([i, j]);
    }
  }
  if (!cols.length) return false;
  cols.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[1] - b[1]);
  const proj = (i: number, j: number): Proj => (u, v, z) => [(i - B + u - z * SHIFT) * ppt, (j - B + v - z * SHIFT) * ppt];

  // The columns' shadows are a texture of their own, cast along the sun of the moment (`paintSunShadows`).
  void scratch;

  const detail = ppt >= 32 ? 1 : 0;
  const k = Math.max(0.35, ppt / 70);
  for (const [i, j] of cols) {
    const o = j * WIN + i, { cls, top } = columnLook(d, lv, o);
    const wx = d.cx * 32 - B + i, wy = d.cy * 32 - B + j;
    drawColumn(ctx, proj(i, j), cls, tileMasks(lv, masks, o), { detail, seed: hash32(wx, wy, 0x2c), k, top });
  }
  return true;
}

/** How far a column's shadow may reach on the ground (tiles): the casters a paint window holds lie this far round its chunk. */
export const SHADOW_REACH = BORDER - SMOOTH - 1;

/**
 * The SUN SHADOWS of the rock (owner, 2026-10-13: "high ground needs to be doing way bigger
 * shadows than it currently does, proportionate to the place of the sun"): every column's footprint
 * swept on the ground along the light, `sun` tiles per relief level (world/cast-shadows.ts: the
 * buildings' shadows' length and swing, so rock and machines agree), a level-10 cliff casting up to
 * `SHADOW_REACH` tiles. Painted opaque in ink (a union: no double darkening); the view lays it
 * under the relief, its opacity following the day. Returns false when the window holds no rock.
 */
export function paintSunShadows(ctx: Ctx2, d: PaintData, ppt: number, sun: readonly [number, number]): boolean {
  const B = BORDER;
  const { lv, masks } = windowLevels(d);
  const lo = SMOOTH + 1, hi = WIN - SMOOTH - 1;
  const size = 32 * ppt;
  ctx.fillStyle = C.ink;
  let any = false;
  for (let j = lo; j < hi; j++) {
    for (let i = lo; i < hi; i++) {
      const L = lv[j * WIN + i]!;
      if (!L) continue;
      const sx = sun[0] * L, sy = sun[1] * L;
      // Off this chunk whatever the sweep: skip.
      const x0 = (i - B + Math.min(0, sx)) * ppt, x1 = (i - B + 1 + Math.max(0, sx)) * ppt;
      const y0 = (j - B + Math.min(0, sy)) * ppt, y1 = (j - B + 1 + Math.max(0, sy)) * ppt;
      if (x1 < 0 || y1 < 0 || x0 > size || y0 > size) continue;
      any = true;
      const P: Proj = (u, v) => [(i - B + u) * ppt, (j - B + v) * ppt];
      columnShadow(ctx, P, L, masks[0]![j * WIN + i]!, sx, sy);
    }
  }
  return any;
}

/** Does the window hold any rock (columns that could lean into the chunk)? */
export function hasRock(d: PaintData): boolean {
  for (let o = 0; o < d.terrain.length; o++) if (isRockT(d.terrain[o]!)) return true;
  return false;
}

/** Small biome signatures: crystal spikes, resin drips, embers, ink pools, shells, pipes. */
function decor(ctx: Ctx2, b: number, x: number, y: number, ppt: number, r: number): void {
  const s = ppt / 32;
  ctx.save();
  ctx.lineWidth = 1.1 * s;
  ctx.strokeStyle = C.ink;
  switch (b) {
    case 1: // glassgrove: crystal spikes
      ctx.fillStyle = C.turqL;
      for (let q = 0; q < 3; q++) {
        const ox = (q - 1) * 6 * s, h = (8 + q * 3 + r * 6) * s;
        ctx.beginPath(); ctx.moveTo(x + ox - 2.5 * s, y + 6 * s); ctx.lineTo(x + ox, y + 6 * s - h); ctx.lineTo(x + ox + 2.5 * s, y + 6 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      break;
    case 2: // resin cliffs: amber drips
      ctx.fillStyle = C.warn;
      ctx.beginPath(); ctx.ellipse(x, y, 4 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 3: // ember fields: glowing coals
      ctx.fillStyle = rgba(C.coral, 0.5);
      ctx.beginPath(); ctx.arc(x, y, 6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.glowPeach;
      ctx.beginPath(); ctx.arc(x, y, 2.5 * s, 0, Math.PI * 2); ctx.fill();
      break;
    case 4: // inkmarsh: ink pools with lumen moss
      ctx.fillStyle = rgba(C.ink, 0.6);
      ctx.beginPath(); ctx.ellipse(x, y, 8 * s, 5 * s, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7cf5c8';
      ctx.beginPath(); ctx.arc(x + 4 * s, y - 2 * s, 1.8 * s, 0, Math.PI * 2); ctx.fill();
      break;
    case 5: // nacre seabed: shells
      ctx.fillStyle = '#ede4f5';
      ctx.beginPath(); ctx.arc(x, y, 5 * s, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 6: // organ peaks: pipes
      ctx.fillStyle = C.lilacL;
      for (let q = 0; q < 3; q++) { ctx.beginPath(); ctx.rect(x - 7 * s + q * 5 * s, y - (6 + q * 3) * s, 3.5 * s, (10 + q * 3) * s); ctx.fill(); ctx.stroke(); }
      break;
  }
  ctx.restore();
}
