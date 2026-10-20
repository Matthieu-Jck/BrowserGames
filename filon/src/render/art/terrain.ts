// terrain.ts — paints one 32×32-tile chunk in the BD-Moebius idiom, top-down; the renderer
// lays it flat under the view projection (iso or plan). Two textures per chunk:
// · the GROUND (both views): a soft pastel field, water and hardpan cut by marching squares
//   with inked shores, rock as a relief map of its levels (`paintRockMap`: each step's fill in
//   the rock of its height, hillshaded lips, strata lines along its edges like contours, textured
//   tops, talus at the cliffs' foot, its silhouette inked), stippled grain, dune ripples, salt
//   crackle, deposits (ore.ts, D99), biome decor;
// · the RELIEF paint (iso only): rock columns painted obliquely (each level lifts a column by
//   a ground shift along −x −y), so that laid in iso the terraces stand up exactly as the relief
//   sprites draw them — the far-zoom stand-in for the sprites, from the same seed (rock.ts
//   `columnSeed`: the very same rim). Water up on the rock (the Crown's tarn, D63) and a stream up
//   on a massif (D94) are columns too, topped by their water (`columnLook`): in iso they lie at
//   their level, a stream's fall down its wall; in plan the ground shows them within the rock.
// Map 4's gaps (D94), at the floor's level: a river as running water a little bluer than the
// lakes, its shores inked, short strokes along the way it flows (the chunk's biome code holds it);
// a chasm as a cut in the ground, its far wall lit and streaked (the side the iso camera looks
// into: the cut's −x −y edges), the rest a dark that deepens away from it, its lips inked.
// A face ore (D87: quartz set in the cliff, `isFaceOre`) is no hidden vein: in iso its columns wear
// a crystal seam on their walls (rock.ts `drawColumn`'s `vein`), in plan its tiles a sparkling
// seam of crystals along every edge that drops to lower ground (`faceSeam`), where a face cutter
// stands to work it.
// Every random choice is hashed from WORLD coordinates and every shape reads a border window,
// so chunks join seamlessly. Runs in a worker (OffscreenCanvas) — no DOM, no Pixi.
import { hash32, hashUnit } from '@/core/hash';
import { isFaceOre } from '@/sim/face';
import { T } from '@/sim/types';
import { C, mix, rgba } from './tokens';
import { BORDER, WIN, fillPolys, march, strokeSegs, type ChunkArrays, type Ctx2, type PaintData } from './paint-kit';
import { exitOf, FLOW_DX, FLOW_DY, paintChasms, paintWater, wayOf, wayTo } from './gaps';
import { paintDeposits } from './ore';
import { reaches } from './water-top';
import { columnSeed, columnShadow, columnVariant, crystal, drawColumn, hasWall, QZ, ROCK, SAND_POCKET, topColor, type Foot, type Proj, type TopLook } from './rock';
import { drawSpire, SPIRE_BIOME, spirePlan, spireSeed, spireShadow, spireVariant } from './spire';
import { isRiverT, isRockT, isWaterT, levelOf, maskAt, masksAt, MAX_TERRACE, PEAK_LEVEL, SHIFT, slabOutline, SMOOTH, STEP_LEVELS, type OutlinePt } from '../relief';

export { BORDER, WIN } from './paint-kit';
export type { ChunkArrays, PaintData } from './paint-kit';
export { RIVER_BIOME } from './gaps';

/**
 * How far past a chunk a rock spire (map 6, D147) may stand and still reach into it (tiles): its top
 * leans back `PEAK_LEVEL · SHIFT` tiles in the oblique paint, and its shadow falls as far (the
 * sun's step a level is at most `SHADOW_REACH / MAX_LEVEL`, half a tile).
 */
export const SPIRE_REACH = Math.ceil(PEAK_LEVEL * SHIFT) + 1;

/** Is window tile o a rock spire (D147: its biome's mark, on rock — dug, it is floor)? */
export const spireTile = (d: PaintData, o: number): boolean => d.biome[o] === SPIRE_BIOME && isRockT(d.terrain[o]!);

/**
 * Cut the paint window of chunk (cx, cy): the chunk plus BORDER tiles all round, and the spires
 * (D147) in it and `SPIRE_REACH` tiles round the chunk (`PaintData.spires`).
 */
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
  // The spires whose top or shadow may reach the chunk (D147).
  const sp: number[] = [], R = SPIRE_REACH, ox = cx * 32 - BORDER, oy = cy * 32 - BORDER;
  for (let y = Math.max(0, cy * 32 - R); y < Math.min(worldTiles, cy * 32 + 32 + R); y++) {
    for (let x = Math.max(0, cx * 32 - R); x < Math.min(worldTiles, cx * 32 + 32 + R); x++) {
      const c = chunkAt(x >> 5, y >> 5), k = (y & 31) * 32 + (x & 31);
      if (c.biome[k] !== SPIRE_BIOME || !isRockT(c.terrain[k]!)) continue;
      sp.push(x - ox, y - oy, levelOf(c.terrain[k]!, c.level[k]!), spireVariant(x, y));
    }
  }
  if (sp.length) d.spires = sp;
  return d;
}

const GROUND: Record<number, string> = {
  [T.Sand]: C.sand, [T.Hardpan]: C.hardpan, [T.Salt]: C.salt, [T.Vent]: C.hardpan, [T.DuneSea]: C.duneSea,
  [T.Dug]: C.dug, [T.Filled]: C.filled, [T.Shallow]: C.shallow, [T.Deep]: C.deep,
  [T.Rock1]: C.rock1, [T.Rock2]: C.rock2, [T.Rock3]: C.rock3, [T.Rock4]: C.rock4,
};
/** The floor of the spires' field (map 6, D147: mapgen's `BIOME.spireGround`): badlands, rubble fallen from the needles. */
export const SPIRE_GROUND = 33;
const BIOME_TINT: Record<number, string> = { 1: C.turqL, 2: C.warn, 3: C.coralL, 4: C.inkSoft, 5: C.lilacL, 6: C.lilac, 7: C.cirque, [SPIRE_GROUND]: '#d7aa88' };

const hex = (h: string): [number, number, number] => {
  const p = parseInt(h.slice(1), 16);
  return [(p >> 16) & 255, (p >> 8) & 255, p & 255];
};

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
      if (b && BIOME_TINT[b] && !isRockT(tt) && !isWaterT(tt)) col = mix(col, BIOME_TINT[b], b === 7 ? 1 : b === SPIRE_GROUND ? 0.42 : 0.28);
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
      if (isRockT(tt) || isWaterT(tt) || tt === T.Chasm || tt === T.River) continue;
      const wx = wx0 + i, wy = wy0 + j;
      const px = (i - B) * ppt, py = (j - B) * ppt;
      // The spires' badlands (D147): twice the grit, darker, and now and then a fallen stone.
      const bad = d.biome[at(i, j)] === SPIRE_GROUND;
      const n = tt === T.Salt ? 1 : tt === T.Hardpan ? 2 : bad ? dots * 2 : dots;
      ctx.fillStyle = rgba(mix(GROUND[tt] ?? C.sand, C.ink, bad ? 0.5 : 0.4), bad ? 0.55 : 0.45);
      for (let q = 0; q < n; q++) {
        const h = hash32(wx, wy, q, 0x5e);
        const ox = (h & 1023) / 1024, oy = ((h >>> 10) & 1023) / 1024, rr = (0.55 + ((h >>> 20) & 7) / 10) * Math.max(0.6, k);
        ctx.beginPath();
        ctx.arc(px + ox * ppt, py + oy * ppt, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (bad && ppt >= 16 && hashUnit(wx, wy, 0x7a) < 0.35) {
        const cx = px + (0.2 + hashUnit(wx, wy, 0x7b) * 0.6) * ppt, cy = py + (0.2 + hashUnit(wx, wy, 0x7c) * 0.6) * ppt, r = (0.05 + hashUnit(wx, wy, 0x7d) * 0.05) * ppt;
        ctx.save();
        ctx.fillStyle = rgba(C.ink, 0.2);
        ctx.beginPath(); ctx.ellipse(cx + r * 0.5, cy + r * 0.6, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c98f70';
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(C.ink, 0.6); ctx.lineWidth = 0.8 * k; ctx.stroke();
        ctx.restore();
        continue;
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

  // ── 3. water, still and running, on the floor, and the chasms (D94): gaps.ts — with the streams
  //    falling into it from up on the rock, so it reaches the foot of their falls (D135: the water
  //    they land in; their columns cover the rest of them) ──
  paintWater(ctx, d, ppt, (i, j) => !raised(d, i, j) || fallsToFloor(d, i, j));
  paintChasms(ctx, d, ppt);

  // ── 4. rock, as a map of its LEVELS (owner, 2026-10-14: « les montagnes sont différentes en 2d
  //    et en 2d isométriques… difficile de construire dessus correctement »): the very terraces the
  //    iso columns stand on, drawn as a relief map (owner, 2026-10-16: the mountains must read in
  //    plan too): `paintRockMap`. The water up on the rock stands in it at its level (D135: its banks
  //    flush beside it, as in iso, not a canyon down to the floor), its own water over it after. ──
  paintRockMap(ctx, d, ppt);
  paintWater(ctx, d, ppt, (i, j) => raised(d, i, j));
  // The spires (D147) seen from above: contour rings tightening to a peak, hachures, a soft shadow.
  const sp = d.spires ?? [];
  for (let n = 0; n < sp.length; n += 4) {
    const i = sp[n]!, j = sp[n + 1]!;
    if (i < B - 1 || j < B - 1 || i > B + 32 || j > B + 32) continue;
    spirePlan(ctx, (i - B) * ppt, (j - B) * ppt, ppt, sp[n + 2]!, spireSeed(sp[n + 2]!, sp[n + 3]!));
  }

  // ── 5. deposits (ore.ts, D99: each ore its own material, denser where richer), then vents,
  //    face seams and biome decor ─────────────────────────────────────────────
  paintDeposits(ctx, d, ppt, (i, j) => bared(d, i, j));
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
      // A face ore on rock bared by a drop beside it: its seam along the face (else a hidden vein: ore.ts).
      if (o > 0 && bared(d, i, j)) { faceSeam(ctx, d, i, j, ppt); continue; }
      const b = d.biome[at(i, j)]!;
      if (b >= 1 && b <= 6 && ppt >= 16 && hashUnit(wx, wy, 0x101) < 0.18 && o === 0 && !isWaterT(tt)) decor(ctx, b, px + ppt / 2, py + ppt / 2, ppt, hashUnit(wx, wy, 0x102));
    }
  }
}

/** Water, a stream or reclaimed ground up on the rock (relief.ts `levelOf`: it stands at its level, a column like the rock round it). */
const raised = (d: PaintData, i: number, j: number): boolean => {
  const o = j * WIN + i, t = d.terrain[o]!;
  return (isWaterT(t) || isRiverT(t) || t === T.Filled) && d.level[o]! > 0;
};

/** A stream up on the rock that runs on into the floor's water (gaps.ts `exitOf`): it falls into it. */
const fallsToFloor = (d: PaintData, i: number, j: number): boolean => {
  const o = j * WIN + i;
  if (d.terrain[o] !== T.River || !d.level[o]) return false;
  const e = exitOf(d, o), t = d.terrain[e]!;
  return (isWaterT(t) || isRiverT(t)) && d.level[e] === 0;
};

/** Light in plan: from the top-left of the screen (−x −y), as everywhere (ink.ts `LIGHT`). */
const PLAN_LIGHT = [-Math.SQRT1_2, -Math.SQRT1_2] as const;

/** Consecutive silhouette segments of an outline as polylines (`closed`: the whole outline is one). */
function silChains(pts: readonly OutlinePt[]): Array<{ pts: OutlinePt[]; closed: boolean }> {
  if (pts.every((p) => p.sil)) return [{ pts: [...pts], closed: true }];
  const n = pts.length, out: Array<{ pts: OutlinePt[]; closed: boolean }> = [];
  const start = pts.findIndex((p) => !p.sil);
  let cur: OutlinePt[] | null = null;
  for (let s = 1; s <= n; s++) {
    const i = (start + s) % n, p = pts[i]!;
    if (p.sil) {
      if (!cur) { cur = [p]; out.push({ pts: cur, closed: false }); }
      cur.push(pts[(i + 1) % n]!);
    } else cur = null;
  }
  return out;
}

/**
 * A chain moved `d` tiles inwards (the outline runs clockwise: inwards is (−dv, du)), its corners
 * mitred, an open chain's ends run on `d` along the edge (into the next tile's chain, which meets
 * it there: a diagonal front's insets join across its staircase).
 */
function insetChain(c: { pts: readonly OutlinePt[]; closed: boolean }, d: number): Array<[number, number]> {
  const p = c.pts, m = c.closed ? p.length : p.length - 1;
  const seg = (i: number): { tu: number; tv: number; nu: number; nv: number } => {
    const a = p[i % p.length]!, b = p[(i + 1) % p.length]!, l = Math.hypot(b.u - a.u, b.v - a.v) || 1;
    const tu = (b.u - a.u) / l, tv = (b.v - a.v) / l;
    return { tu, tv, nu: -tv, nv: tu };
  };
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= (c.closed ? m - 1 : m); i++) {
    const a = p[i % p.length]!;
    if (!c.closed && i === 0) { const s = seg(0); out.push([a.u + (s.nu - s.tu) * d, a.v + (s.nv - s.tv) * d]); continue; }
    if (!c.closed && i === m) { const s = seg(m - 1); out.push([a.u + (s.nu + s.tu) * d, a.v + (s.nv + s.tv) * d]); continue; }
    const s0 = seg((i - 1 + m) % m), s1 = seg(i);
    const dot = s0.nu * s1.nu + s0.nv * s1.nv, f = d / (1 + dot);
    out.push([a.u + (s0.nu + s1.nu) * f, a.v + (s0.nv + s1.nv) * f]);
  }
  if (c.closed && out.length) out.push(out[0]!);
  return out;
}

/**
 * The rock in plan, a relief map of its levels (both views show it: in iso it is the ground under
 * the columns, and the foot of every cliff). Each rock tile's terrace slabs are outlined exactly as
 * the iso columns are (relief.ts `slabOutline`: the tile, its corners chamfered by its neighbours),
 * step by step from the foot up, so what is drawn is what the rules read; per step:
 * · the step's shadow on the terrace below and the occlusion at its foot (soft strokes along its
 *   edge, half covered by its fill); at the floor, talus (≥ 32 px a tile): blocks and gravel
 *   fallen at the foot of the cliffs;
 * · its fill, its hardness's top colour, paler and cooler a step higher (`topColor`: the plan,
 *   which sees only tops, tells the levels apart);
 * · inside its edges (≥ 16 px a tile): a lit lip where the edge faces the light, a shaded one where
 *   it faces away (hillshading), and one or two fine lines following the edge, the strata seen from
 *   above, like contours;
 * · its tops' surface (≥ 16 px a tile): sand pockets, slabs, cracks, boulders by hardness, hashed
 *   from world coordinates;
 * · its silhouette inked, boldest at the floor.
 */
function paintRockMap(ctx: Ctx2, d: PaintData, ppt: number): void {
  const B = BORDER, k = ppt / 32;
  const tt = (i: number, j: number): number => d.terrain[j * WIN + i]!;
  // A column: rock, or water (or reclaimed ground) up on the rock, at its level as in iso (D135); a
  // spire is no terrace (D147: its own mark, `spirePlan`).
  const col = (i: number, j: number): boolean => (isRockT(tt(i, j)) && !spireTile(d, j * WIN + i)) || raised(d, i, j);
  // The relief level of a window tile as the iso columns read it (0 off them and off the window).
  const rl = (i: number, j: number): number => (i < 0 || j < 0 || i >= WIN || j >= WIN || !col(i, j) ? 0 : levelOf(tt(i, j), d.level[j * WIN + i]!));
  const rock = march(col, ppt);
  if (!rock.polys.length) return;
  // The rock's own shadow on the floor (soft, under everything).
  ctx.save();
  ctx.globalAlpha = 0.3;
  fillPolys(ctx, rock.polys, C.inkSoft, 4 * k, 6 * k);
  ctx.restore();
  const tiles: Array<{ i: number; j: number; cls: number; layers: number[]; masks: number[]; outs: OutlinePt[][]; wx: number; wy: number }> = [];
  const rockAt = (i: number, j: number): number => (i < 0 || j < 0 || i >= WIN || j >= WIN || !isRockT(tt(i, j)) ? -1 : tt(i, j) - T.Rock1);
  let steps = 0;
  for (let j = B - 1; j <= B + 32; j++) for (let i = B - 1; i <= B + 32; i++) {
    if (!col(i, j)) continue;
    // Water's column: the hardest rock round it (`columnLook`), its top drawn over by its water.
    let cls = isRockT(tt(i, j)) ? tt(i, j) - T.Rock1 : 0;
    if (!isRockT(tt(i, j))) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const u = tt(i + di, j + dj); if (isRockT(u) && u - T.Rock1 > cls) cls = u - T.Rock1; }
    const masks = masksAt(rl, i, j);
    if (masks.length > steps) steps = masks.length;
    // Each step in the rock of its height (`layersOf`), as the iso columns draw it.
    tiles.push({ i, j, cls, layers: layersOf(rockAt, rl, i, j, cls, masks.length), masks, outs: masks.map((_, s) => slabOutline(masks, s)), wx: d.cx * 32 - B + i, wy: d.cy * 32 - B + j });
  }
  const X = (i: number, u: number): number => (i - B + u) * ppt, Y = (j: number, v: number): number => (j - B + v) * ppt;
  const path = (pts: ReadonlyArray<{ u: number; v: number }>, i: number, j: number, dx = 0, dy = 0): void => {
    pts.forEach((p, n) => { const x = X(i, p.u) + dx, y = Y(j, p.v) + dy; if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
  };
  const sils = (q: (typeof tiles)[number], s: number): void => {
    const pts = q.outs[s]!;
    pts.forEach((p, n) => {
      if (!p.sil) return;
      const r = pts[(n + 1) % pts.length]!;
      ctx.moveTo(X(q.i, p.u), Y(q.j, p.v));
      ctx.lineTo(X(q.i, r.u), Y(q.j, r.v));
    });
  };
  const stroke = (color: string, w: number, alpha: number, cap: CanvasLineCap = 'round'): void => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = w;
    ctx.lineCap = cap;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  };
  for (let s = 0; s < steps; s++) {
    const here = tiles.filter((q) => q.masks.length > s);
    if (s > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.inkSoft;
      ctx.beginPath();
      for (const q of here) path(q.outs[s]!, q.i, q.j, 3 * k, 4.5 * k);
      ctx.fill();
      ctx.restore();
    }
    // Occlusion at the foot of the step: its fill covers the inner half.
    ctx.beginPath();
    for (const q of here) sils(q, s);
    stroke(C.inkSoft, 0.36 * ppt, 0.07);
    stroke(C.inkSoft, 0.14 * ppt, 0.09);
    if (s === 0 && ppt >= 32) for (const q of here) floorTalus(ctx, d, q, ppt);
    for (const q of here) {
      ctx.fillStyle = topColor(q.layers[s]!, (s + 1) * STEP_LEVELS);
      ctx.beginPath();
      path(q.outs[s]!, q.i, q.j);
      ctx.fill();
    }
    if (ppt >= 16) {
      ctx.save();
      ctx.beginPath();
      for (const q of here) path(q.outs[s]!, q.i, q.j);
      ctx.clip();
      for (const q of here) {
        const look = ROCK[q.layers[s]!]!, pts = q.outs[s]!;
        // Hillshading: the lip lit where the edge faces the light, shaded where it faces away.
        pts.forEach((p, n) => {
          if (!p.sil) return;
          const r = pts[(n + 1) % pts.length]!, du = r.u - p.u, dv = r.v - p.v, l = Math.hypot(du, dv) || 1;
          const facing = (dv / l) * PLAN_LIGHT[0] + (-du / l) * PLAN_LIGHT[1];
          if (Math.abs(facing) < 0.3) return;
          ctx.beginPath();
          ctx.moveTo(X(q.i, p.u), Y(q.j, p.v));
          ctx.lineTo(X(q.i, r.u), Y(q.j, r.v));
          if (facing > 0) stroke(look.rim, 0.17 * ppt, 0.6, 'butt');
          else stroke(look.dark, 0.24 * ppt, 0.22, 'butt');
        });
        // The strata seen from above: fine lines following the edge.
        for (const c of silChains(pts)) {
          for (const [dd, a] of ppt >= 32 ? [[0.17, 0.26], [0.32, 0.15]] : [[0.2, 0.22]]) {
            const line = insetChain(c, dd!);
            ctx.beginPath();
            line.forEach(([u, v], n) => (n ? ctx.lineTo(X(q.i, u), Y(q.j, v)) : ctx.moveTo(X(q.i, u), Y(q.j, v))));
            stroke(look.line, 0.85 * k, a!);
          }
        }
      }
      ctx.restore();
      for (const q of here) if (q.masks.length === s + 1) topMarksPlan(ctx, q, ppt);
    }
    ctx.beginPath();
    for (const q of here) sils(q, s);
    stroke(C.ink, (s === 0 ? 2.7 : 1.9) * k, s === 0 ? 1 : 0.85);
  }
}

/** A stone seen from above, (cx, cy) px, radius r px: its shadow down-right, its lit body, inked. */
function planStone(ctx: Ctx2, cx: number, cy: number, r: number, lit: string, k: number, h: (m: number) => number): void {
  const ring: Array<[number, number]> = [];
  for (let n = 0; n < 6; n++) {
    const a = (n / 6) * Math.PI * 2 + h(n) * 0.5, rr = r * (0.7 + h(10 + n) * 0.5);
    ring.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const shape = (dx: number, dy: number): void => { ctx.beginPath(); ring.forEach(([x, y], n) => (n ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy))); ctx.closePath(); };
  ctx.fillStyle = rgba(C.ink, 0.28);
  shape(r * 0.45, r * 0.55);
  ctx.fill();
  ctx.fillStyle = lit;
  shape(0, 0);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = C.ink;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 0.8 * k;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * Talus on the floor at the foot of a rock tile's cliffs (plan and iso ground, ≥ 32 px a tile):
 * along every side of its first step that drops to the floor (its very foot: a chamfer's diagonal
 * too), blocks fallen off the face, the biggest against it, and gravel; none into water or a
 * chasm. Hashed from world coordinates and kept off a side's ends, so tiles join.
 */
function floorTalus(ctx: Ctx2, d: PaintData, q: { i: number; j: number; layers: number[]; outs: OutlinePt[][]; wx: number; wy: number }, ppt: number): void {
  const B = BORDER, k = ppt / 32, look = ROCK[q.layers[0]!]!, pts = q.outs[0]!;
  const lit = mix(look.lit, '#ffffff', 0.18);
  pts.forEach((p, n) => {
    if (!p.sil) return;
    const r = pts[(n + 1) % pts.length]!, du = r.u - p.u, dv = r.v - p.v, len = Math.hypot(du, dv);
    if (len < 0.1) return;
    const ou = dv / len, ov = -du / len;
    // What lies beyond the foot: the floor, not water nor a gap.
    const bi = q.i + Math.floor((p.u + r.u) / 2 + ou * 0.15), bj = q.j + Math.floor((p.v + r.v) / 2 + ov * 0.15);
    if (bi < 0 || bj < 0 || bi >= WIN || bj >= WIN) return;
    const bt = d.terrain[bj * WIN + bi]!;
    if (isWaterT(bt) || isRockT(bt) || bt === T.Chasm || bt === T.River) return;
    const h = (m: number): number => hashUnit(q.wx, q.wy, 0x7a1 + n * 97 + m);
    const margin = Math.min(0.45, 0.08 / len);
    const at = (f: number, dd: number): [number, number] => [(q.i - B + p.u + du * f + ou * dd) * ppt, (q.j - B + p.v + dv * f + ov * dd) * ppt];
    ctx.fillStyle = rgba(look.line, 0.45);
    for (let g = 0; g < Math.round(len * 7); g++) {
      const [x, y] = at(margin + h(200 + g) * (1 - 2 * margin), 0.03 + h(230 + g) ** 1.5 * 0.34);
      ctx.beginPath(); ctx.arc(x, y, (0.5 + h(260 + g) * 0.7) * k, 0, Math.PI * 2); ctx.fill();
    }
    const nb = Math.round(len * (2 + h(0) * 3));
    for (let b = 0; b < nb; b++) {
      const dd = 0.05 + h(10 + b) ** 1.7 * 0.24, rr = (0.06 - dd * 0.12) * (0.6 + h(30 + b) * 0.6);
      const [x, y] = at(margin + h(50 + b) * (1 - 2 * margin), dd);
      planStone(ctx, x, y, rr * ppt, lit, k, (m) => h(100 + b * 17 + m));
    }
  });
}

/**
 * A top's surface in plan, by hardness (≥ 16 px a tile), clipped to its outline and kept inside the
 * tile: sand pockets in the soft rock, raised slabs and cracks in the harder, boulders on the hard
 * crests, facets and a glint on the heartrock; a few grains everywhere. Hashed from world coordinates.
 */
function topMarksPlan(ctx: Ctx2, q: { i: number; j: number; cls: number; masks: number[]; outs: OutlinePt[][]; wx: number; wy: number }, ppt: number): void {
  const B = BORDER, k = ppt / 32, look = ROCK[q.cls]!, base = topColor(q.cls, q.masks.length * STEP_LEVELS);
  const h = (m: number): number => hashUnit(q.wx, q.wy, 0x5c3 + m);
  const at = (u: number, v: number): [number, number] => [(q.i - B + u) * ppt, (q.j - B + v) * ppt];
  const pos = (m: number): [number, number] => [0.18 + h(m) * 0.64, 0.18 + h(m + 1) * 0.64];
  const blobAt = (u: number, v: number, r: number, n: number, m: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let e = 0; e < n; e++) {
      const a = (e / n) * Math.PI * 2 + h(m + e) * 0.4, rr = r * (0.72 + h(m + 20 + e) * 0.5);
      out.push(at(u + Math.cos(a) * rr, v + Math.sin(a) * rr));
    }
    return out;
  };
  const shape = (pts: ReadonlyArray<readonly [number, number]>): void => { ctx.beginPath(); pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  const pen = (pts: ReadonlyArray<readonly [number, number]>, color: string, w: number, alpha: number): void => {
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.restore();
  };
  ctx.save();
  ctx.beginPath();
  q.outs[q.outs.length - 1]!.forEach((p, n) => { const [x, y] = at(p.u, p.v); if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.clip();
  if (h(0) < [0.35, 0.16, 0.08, 0][q.cls]!) {
    const [u, v] = pos(1), r = 0.1 + h(3) * 0.1, ring = blobAt(u, v, r, 9, 10);
    ctx.fillStyle = mix(base, SAND_POCKET, 0.55);
    shape(ring);
    ctx.fill();
    if (ppt >= 32) {
      pen(ring.slice(0, 5), look.line, 0.7 * k, 0.25);
      for (let e = 0; e < 2; e++) pen([at(u - r * 0.45, v - r * 0.2 + e * r * 0.45), at(u, v - r * 0.32 + e * r * 0.45), at(u + r * 0.45, v - r * 0.2 + e * r * 0.45)], C.dune, 0.9 * k, 0.8);
    }
  }
  const slabs = [0, h(40) < 0.5 ? 1 : 0, h(40) < 0.3 ? 1 : 0, 1 + (h(40) < 0.4 ? 1 : 0)][q.cls]!;
  for (let e = 0; e < slabs; e++) {
    const [u, v] = pos(41 + e * 3), ring = blobAt(u, v, 0.08 + h(43 + e * 3) * 0.08, 6, 50 + e * 40);
    ctx.fillStyle = q.cls === 3 ? mix(base, look.rim, 0.25) : mix(base, '#ffffff', 0.12);
    shape(ring);
    ctx.fill();
    pen([ring[1]!, ring[2]!, ring[3]!, ring[4]!], look.line, 0.75 * k, 0.32);
    pen([ring[4]!, ring[5]!, ring[0]!, ring[1]!], look.rim, 0.75 * k, 0.55);
  }
  const cracks = [h(130) < 0.4 ? 1 : 0, 1, 2, 1][q.cls]!;
  for (let e = 0; e < cracks; e++) {
    let [u, v] = pos(131 + e * 2), a = h(135 + e) * 6.283;
    const pts: Array<[number, number]> = [at(u, v)];
    for (let n = 0; n < 3; n++) {
      a += (h(140 + e * 9 + n) - 0.5) * 1.4;
      const dd = 0.06 + h(150 + e * 9 + n) * 0.06;
      u = Math.min(0.9, Math.max(0.1, u + Math.cos(a) * dd)); v = Math.min(0.9, Math.max(0.1, v + Math.sin(a) * dd));
      pts.push(at(u, v));
    }
    pen(pts, look.line, 0.8 * k, 0.38);
  }
  if (ppt >= 32 && h(170) < [0.05, 0.1, 0.45, 0.12][q.cls]!) {
    const [u, v] = pos(171), [x, y] = at(u, v);
    planStone(ctx, x, y, (0.05 + h(173) * 0.035) * ppt, mix(look.lit, '#ffffff', 0.22), k, (m) => h(180 + m));
  }
  ctx.fillStyle = rgba(look.line, 0.25);
  for (let e = 0; e < 4; e++) {
    const [x, y] = at(0.1 + h(200 + e) * 0.8, 0.1 + h(210 + e) * 0.8);
    ctx.beginPath(); ctx.arc(x, y, (0.5 + h(220 + e) * 0.6) * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** The sides of a tile (N, E, S, W): the neighbour's offset, the edge's ends and its inward normal (tile-local). */
const SIDES: ReadonlyArray<{ di: number; dj: number; a: readonly [number, number]; b: readonly [number, number]; n: readonly [number, number] }> = [
  { di: 0, dj: -1, a: [0, 0], b: [1, 0], n: [0, 1] },
  { di: 1, dj: 0, a: [1, 0], b: [1, 1], n: [-1, 0] },
  { di: 0, dj: 1, a: [1, 1], b: [0, 1], n: [0, -1] },
  { di: -1, dj: 0, a: [0, 1], b: [0, 0], n: [1, 0] },
];

/** The sides of window tile (i, j) that drop to lower ground (its land's level, `levelOf`): where a face lies. */
function dropSides(d: PaintData, i: number, j: number): typeof SIDES {
  const lv = (a: number, b: number): number => (a < 0 || b < 0 || a >= WIN || b >= WIN ? 0 : levelOf(d.terrain[b * WIN + a]!, d.level[b * WIN + a]!));
  const here = lv(i, j);
  return SIDES.filter((s) => lv(i + s.di, j + s.dj) < here);
}

/** Is window tile (i, j) rock holding a face ore (D87) that a drop beside it bares? */
const bared = (d: PaintData, i: number, j: number): boolean => {
  const o = j * WIN + i;
  return isRockT(d.terrain[o]!) && isFaceOre(d.ore[o]! - 1) && dropSides(d, i, j).length > 0;
};

/**
 * A face ore on a rock tile, in plan (D87): along every edge that drops to lower ground — the face
 * a cutter stands at — a milky seam inked on its inner side, and at ≥ 16 px/tile clusters of rock
 * crystal rooted in the face and pointing in over the top, white with ink outlines (rock.ts `crystal`),
 * so a vein reads at a glance where a hidden ore is a faint dot. Everything is hashed from world
 * coordinates and kept inside the tile's ground footprint (its first slab, relief.ts
 * `slabOutline`: the tile cut by its chamfers): the ground texture shows in iso too, where the
 * column covers exactly that footprint, so none of it shows on the floor in front of the face.
 */
function faceSeam(ctx: Ctx2, d: PaintData, i: number, j: number, ppt: number): void {
  const B = BORDER, k = ppt / 32;
  const wx = d.cx * 32 - B + i, wy = d.cy * 32 - B + j;
  const px = (i - B) * ppt, py = (j - B) * ppt;
  const at = (u: number, v: number): [number, number] => [px + u * ppt, py + v * ppt];
  const rl = (a: number, b: number): number => (a < 0 || b < 0 || a >= WIN || b >= WIN || !isRockT(d.terrain[b * WIN + a]!) ? 0 : levelOf(d.terrain[b * WIN + a]!, d.level[b * WIN + a]!));
  ctx.save();
  ctx.beginPath();
  slabOutline(masksAt(rl, i, j), 0).forEach((p, n) => { const [x, y] = at(p.u, p.v); if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.clip();
  for (const s of dropSides(d, i, j)) {
    const side = SIDES.indexOf(s);
    // A point t along the edge, m in from it (tiles; negative: out over the face).
    const on = (t: number, m: number): [number, number] => at(s.a[0] + (s.b[0] - s.a[0]) * t + s.n[0] * m, s.a[1] + (s.b[1] - s.a[1]) * t + s.n[1] * m);
    // The seam: a band along the edge, its inner line wandering.
    const outer: Array<[number, number]> = [], inner: Array<[number, number]> = [];
    const ph = hashUnit(wx, wy, 0x3a0 + side) * 6;
    for (let q = 0; q <= 10; q++) {
      const t = 0.08 + (0.84 * q) / 10, taper = Math.min(1, Math.sin((q / 10) * Math.PI) * 1.6);
      outer.push(on(t, 0.03));
      inner.push(on(t, 0.03 + (0.16 + 0.06 * Math.sin(t * 9 + ph)) * taper));
    }
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = QZ.body;
    ctx.beginPath();
    [...outer, ...inner.slice().reverse()].forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = QZ.deep;
    ctx.lineWidth = 1.1 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    inner.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    if (ppt < 16) continue;
    // Sparkle on the seam: a few white four-point glints.
    ctx.fillStyle = '#ffffff';
    for (let g = 0; g < 3; g++) {
      const [gx, gy] = on(0.15 + hashUnit(wx, wy, 0x3f0 + side * 3 + g) * 0.7, 0.1);
      const r = (0.03 + hashUnit(wx, wy, 0x400 + side * 3 + g) * 0.025) * ppt, w = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(gx, gy - r); ctx.lineTo(gx + w, gy - w); ctx.lineTo(gx + r, gy); ctx.lineTo(gx + w, gy + w);
      ctx.lineTo(gx, gy + r); ctx.lineTo(gx - w, gy + w); ctx.lineTo(gx - r, gy); ctx.lineTo(gx - w, gy - w);
      ctx.closePath();
      ctx.fill();
    }
    // Clusters: three along the edge, each a long point and a short one fanned.
    for (let c = 0; c < 3; c++) {
      const t = ((c + 0.5) / 3) * 0.66 + 0.17 + (hashUnit(wx, wy, 0x3c0 + side * 4 + c) - 0.5) * 0.08;
      for (let q = 0; q < 2; q++) {
        const h = hashUnit(wx, wy, 0x3d0 + side * 8 + c * 2 + q);
        const fan = (q ? 1 : -0.45) * (0.3 + h * 0.35);
        const len = (q ? 0.24 : 0.34) * (0.85 + hashUnit(wx, wy, 0x3e0 + side * 8 + c * 2 + q) * 0.3);
        // Rooted in the face, the point inward over the top: a geode's rim seen from above.
        crystal(ctx, on(t, 0.01), on(t + fan * len * 0.55, 0.01 + len), (q ? 0.06 : 0.085) * ppt, Math.max(0.8, 0.6 * k), ppt >= 32);
      }
    }
  }
  ctx.restore();
}

/** Levels and per-step masks of the window (0 outside the valid ring, and on a spire: D147, `spireTile`). */
export function windowLevels(d: PaintData): { lv: Uint8Array; masks: Uint8Array[] } {
  const lv = new Uint8Array(WIN * WIN);
  const masks = Array.from({ length: MAX_TERRACE }, () => new Uint8Array(WIN * WIN));
  // A spire (D147) is no terrace: its painter draws it whole, the terraces round it see the floor.
  for (let j = SMOOTH; j < WIN - SMOOTH; j++) for (let i = SMOOTH; i < WIN - SMOOTH; i++) { const o = j * WIN + i; lv[o] = spireTile(d, o) ? 0 : levelOf(d.terrain[o]!, d.level[o]!); }
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
 * water or reclaimed ground, or rock the water at its height reaches (water-top.ts `reaches`) —
 * with what the 7 × 7 round it hold at its height (`waterCells`, art/rock.ts `TopLook`: the body
 * of water its part is cut from, D135); `vein`: its rock holds a face ore (D87), worn as a crystal
 * seam on its walls. A stream up on a massif (D94) is water that runs: its top a `river` with the
 * way it runs on (`flow`: towards the tile it runs into, gaps.ts `exitOf` — the chunk's biome code,
 * `RIVER_BIOME` + the eighth of a turn, unless the river turns there), how far it falls to that tile
 * (`fall`, relief levels: the waterfall down its wall, landing in the water it runs on into, D135)
 * and the streams pouring into it from higher up (`from`, D115: their falls land on it). A stream's
 * or a lake's `mark` is hashed from the world tile (`waterMark`).
 */
export function columnLook(d: PaintData, lv: Uint8Array, o: number): { cls: number; top: TopLook | null; vein: boolean } {
  const t = d.terrain[o]!, L = lv[o]!;
  let cls = isRockT(t) ? t - T.Rock1 : 0;
  if (!isRockT(t)) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const u = d.terrain[o + j * WIN + i] ?? T.Sand;
        if (isRockT(u) && u - T.Rock1 > cls) cls = u - T.Rock1;
      }
    }
  }
  const cells = waterCells(d, lv, o);
  const i0 = o % WIN, j0 = (o - i0) / WIN, wx = d.cx * 32 - BORDER + i0, wy = d.cy * 32 - BORDER + j0;
  if (isRiverT(t)) {
    // Where it runs on (where its river turns, the tile beside its way that holds the water: a fall
    // lands in it, D135), and how far down.
    const exit = exitOf(d, o), flow = wayTo(o, exit), fall = Math.max(0, L - (lv[exit] ?? 0));
    // The streams pouring into it from higher up (D115): their falls land on it.
    let from = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const n = o + j * WIN + i;
        if ((i || j) && isRiverT(d.terrain[n] ?? T.Sand) && (lv[n] ?? 0) > L && exitOf(d, n) === o) from |= 1 << (3 * (j + 1) + i + 1);
      }
    }
    const mark = fall || from ? 0 : waterMark(wx, wy, flow);
    return { cls, top: { kind: 'river', cells, flow, fall, ...(from ? { from } : {}), ...(mark ? { mark } : {}) }, vein: false };
  }
  if (isWaterT(t)) { const mark = waterMark(wx, wy, -1); return { cls, top: { kind: 'water', cells, ...(mark ? { mark } : {}) }, vein: false }; }
  if (!isRockT(t)) return { cls, top: { kind: 'ground', cells }, vein: false };
  // Rock: a top of its own only where the water at its height reaches it (a wedge of a stream
  // stepping past its corner, a lake's rounded shore, a bank's ink on its edge); a crystal seam on
  // its walls where it holds a face ore (D87).
  const vein = isFaceOre(d.ore[o]! - 1);
  return { cls, top: reaches(cells) ? { kind: 'rock', cells } : null, vein };
}


/**
 * What the 7 × 7 round a raised window tile hold at its height (water-top.ts `CELL`, D135): still
 * water (`w`, deep `d`), a stream (its way, `0`…`7`), a tile at another height a fall joins to
 * the water at its height (`x`: the foot of a stream's fall, the next tile along it below, or a
 * stream pouring into it from above), or nothing (`.`). Every tile of a body reads the same world, so their parts of it meet.
 */
export function waterCells(d: PaintData, lv: Uint8Array, o: number): string {
  const L = lv[o]!, i0 = o % WIN, j0 = (o - i0) / WIN;
  const wetT = (u: number): boolean => isWaterT(u) || isRiverT(u);
  const inWin = (i: number, j: number): boolean => i >= SMOOTH && j >= SMOOTH && i < WIN - SMOOTH && j < WIN - SMOOTH;
  let s = '';
  for (let j = j0 - 3; j <= j0 + 3; j++) {
    for (let i = i0 - 3; i <= i0 + 3; i++) {
      const n = j * WIN + i, u = d.terrain[n] ?? T.Sand;
      if (!inWin(i, j)) { s += '.'; continue; }
      if (lv[n] === L && wetT(u)) { s += isRiverT(u) ? String(wayOf(d, n)) : u === T.Deep ? 'd' : 'w'; continue; }
      // A fall joins it on: a stream at L beside it runs on into it, lower (the foot of its fall,
      // gaps.ts `exitOf`: the water it lands in, or where it runs out: the channel runs straight to
      // its lip), or it, a stream, runs on into water at L from higher up (the channel runs on from
      // where it lands).
      let joined = false;
      for (let dj = -1; dj <= 1 && !joined; dj++) {
        for (let di = -1; di <= 1 && !joined; di++) {
          if ((!di && !dj) || !inWin(i + di, j + dj)) continue;
          const m = n + dj * WIN + di, um = d.terrain[m]!;
          if (lv[m] !== L || !wetT(um)) continue;
          if (isRiverT(um) && lv[n]! < L && exitOf(d, m) === n) joined = true;
          else if (isRiverT(u) && lv[n]! > L && exitOf(d, n) === m) joined = true;
        }
      }
      s += joined ? 'x' : '.';
    }
  }
  return s;
}

/**
 * The mark on a tile of water (water-top.ts `marks`; 0 none, 1 … 3 its look), hashed from the world
 * tile (D135: not one mark on every tile): a stream's (`flow` its way) every third tile along it,
 * its lanes out of step with each other; still water's (`flow` −1) a ripple on a tile in three.
 */
export function waterMark(wx: number, wy: number, flow: number): number {
  if (flow < 0) return hashUnit(wx, wy, 0x3a9) < 0.33 ? 1 + (hash32(wx, wy, 0x3aa) % 3) : 0;
  const fx = FLOW_DX[flow]!, fy = FLOW_DY[flow]!;
  const along = Math.floor((wx * fx + wy * fy) / (fx && fy ? 2 : 1)), across = wx * -fy + wy * fx;
  if ((((along + (hash32(across, flow, 0x3a7) % 3)) % 3) + 3) % 3 !== 0) return 0;
  return 1 + (hash32(wx, wy, 0x3a8) % 3);
}

/** The tiles round a tile, nearest first (5 × 5 less itself). */
const ROUND5: ReadonlyArray<readonly [number, number]> = [-2, -1, 0, 1, 2]
  .flatMap((j) => [-2, -1, 0, 1, 2].map((i) => [i, j] as const))
  .filter(([i, j]) => i || j)
  .sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);

/**
 * The rock of each step of a raised tile (`n` steps, its own class `cls` on top): the hardness of
 * the rock round it whose top stands at that step's height — the land's hardness follows its
 * level, so a tall column's lower steps are the softer layers its lower neighbours are made of, and
 * its ledges and walls carry on theirs (owner, 2026-10-16: a ledge wore the high top's colour in
 * the middle of a terrace of another, a zigzag of tiles). A step with no neighbour at its height
 * takes the rock of the step above. `rockAt`: a tile's class (−1 off rock), `levelAt` its relief level.
 */
export function layersOf(rockAt: (i: number, j: number) => number, levelAt: (i: number, j: number) => number, i: number, j: number, cls: number, n: number): number[] {
  const out = new Array<number>(n).fill(-1);
  out[n - 1] = cls;
  for (let t = 0; t + 1 < n; t++) {
    const want = (t + 1) * STEP_LEVELS;
    for (const [di, dj] of ROUND5) {
      const c = rockAt(i + di, j + dj);
      if (c >= 0 && levelAt(i + di, j + dj) === want) { out[t] = c; break; }
    }
  }
  for (let t = n - 2; t >= 0; t--) if (out[t]! < 0) out[t] = out[t + 1]!;
  return out;
}

/**
 * Where the walls of the higher neighbours behind a raised window tile (north and west: the ones
 * facing the camera) rise from its top (rock.ts `Foot`): the stretch of the neighbour's own side
 * there, at the step standing on this top — its chamfers take the wall off the edge (a diagonal
 * front stands on the neighbour's own lower step, which gets its talus from its own sprite).
 */
export function footOf(lv: Uint8Array, masks: readonly Uint8Array[], o: number): Foot | null {
  const L = lv[o]!;
  const side = (n: number, east: boolean): [number, number] | null => {
    if (lv[n]! <= L) return null;
    const ms = tileMasks(lv, masks, n), t = L / STEP_LEVELS;
    if (t >= ms.length) return null;
    const pts = slabOutline(ms, t);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      if (!a.sil) continue;
      if (!east && a.v > 1 - 1e-6 && b.v > 1 - 1e-6) return [Math.min(a.u, b.u), Math.max(a.u, b.u)];
      if (east && a.u > 1 - 1e-6 && b.u > 1 - 1e-6) return [Math.min(a.v, b.v), Math.max(a.v, b.v)];
    }
    return null;
  };
  const n = side(o - WIN, false), w = side(o - 1, true);
  return n || w ? { n, w } : null;
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
  // Each column, and each spire (D147: from the ring past the window too, `PaintData.spires`; its
  // index there), whose oblique extent reaches the chunk: from the footprint back by L·SHIFT tiles.
  const cols: Array<[number, number, number]> = [];
  const reaches = (i: number, j: number, L: number): boolean => {
    const x1 = (i - B + 1) * ppt, y1 = (j - B + 1) * ppt;
    const x0 = (i - B - L * SHIFT) * ppt, y0 = (j - B - L * SHIFT) * ppt;
    return !(x1 < 0 || y1 < 0 || x0 > size || y0 > size);
  };
  for (let j = lo; j < hi; j++) {
    for (let i = lo; i < hi; i++) {
      const L = lv[j * WIN + i]!;
      if (L && reaches(i, j, L)) cols.push([i, j, -1]);
    }
  }
  const sp = d.spires ?? [];
  for (let n = 0; n < sp.length; n += 4) if (reaches(sp[n]!, sp[n + 1]!, sp[n + 2]!)) cols.push([sp[n]!, sp[n + 1]!, n]);
  if (!cols.length) return false;
  cols.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[1] - b[1]);
  const proj = (i: number, j: number): Proj => (u, v, z) => [(i - B + u - z * SHIFT) * ppt, (j - B + v - z * SHIFT) * ppt];

  // The columns' shadows are a texture of their own, cast along the sun of the moment (`paintSunShadows`).
  void scratch;

  const detail = ppt >= 32 ? 1 : 0;
  const k = Math.max(0.35, ppt / 70);
  for (const [i, j, n] of cols) {
    if (n >= 0) { drawSpire(ctx, proj(i, j), sp[n + 2]!, { detail, seed: spireSeed(sp[n + 2]!, sp[n + 3]!), k }); continue; }
    const o = j * WIN + i, { cls, top, vein } = columnLook(d, lv, o);
    const wx = d.cx * 32 - B + i, wy = d.cy * 32 - B + j;
    // The sprite's own seed (its look's): the paint draws the very rim the sprite does, so nothing
    // of it shows round a sprite's bitten edge where both are drawn.
    const ms = tileMasks(lv, masks, o);
    const layers = top && top.kind !== 'rock' ? null : windowLayers(d, lv, o, cls, ms.length);
    drawColumn(ctx, proj(i, j), cls, ms, { detail, seed: columnSeed(cls, ms, columnVariant(wx, wy, hasWall(ms))), k, top, vein, layers });
  }
  return true;
}

/** A window column's layers (`layersOf`) from the window's terrain and relief levels. */
export function windowLayers(d: PaintData, lv: Uint8Array, o: number, cls: number, n: number): number[] {
  const i0 = o % WIN, j0 = Math.floor(o / WIN);
  const rockAt = (i: number, j: number): number => {
    if (i < 0 || j < 0 || i >= WIN || j >= WIN) return -1;
    const t = d.terrain[j * WIN + i]!;
    return isRockT(t) ? t - T.Rock1 : -1;
  };
  return layersOf(rockAt, (i, j) => (i < 0 || j < 0 || i >= WIN || j >= WIN ? 0 : lv[j * WIN + i]!), i0, j0, cls, n);
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
  // The spires' long shadows (D147), from the ring past the window too.
  const sp = d.spires ?? [];
  for (let n = 0; n < sp.length; n += 4) {
    const i = sp[n]!, j = sp[n + 1]!, L = sp[n + 2]!, sx = sun[0] * L, sy = sun[1] * L;
    const x0 = (i - B + Math.min(0, sx) - 0.5) * ppt, x1 = (i - B + 1.5 + Math.max(0, sx)) * ppt;
    const y0 = (j - B + Math.min(0, sy) - 0.5) * ppt, y1 = (j - B + 1.5 + Math.max(0, sy)) * ppt;
    if (x1 < 0 || y1 < 0 || x0 > size || y0 > size) continue;
    any = true;
    spireShadow(ctx, (u, v) => [(i - B + u) * ppt, (j - B + v) * ppt], L, spireSeed(L, sp[n + 3]!), sun[0], sun[1]);
  }
  return any;
}

/** Does the window hold any rock (columns that could lean into the chunk), or a spire round it (D147)? */
export function hasRock(d: PaintData): boolean {
  if (d.spires?.length) return true;
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
