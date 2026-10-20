// relief-view.ts — rock columns as sprites at near zooms, depth-sorted together with the
// buildings (one shared sortable layer), so a cliff in front of a machine hides it and a
// machine in front of a cliff covers it. The same columns are painted into the terrain
// texture for far zooms; below the LOD threshold the sprites go away and nothing changes on
// screen but the line work. Sprites are baked on demand (class × level × mask × variant)
// in a dynamic atlas under a per-frame time budget; blocks of 8×8 tiles stream with the view.
// A building standing on a column (D44) sorts after it and every column under its footprint
// (world/stand.ts), so the rock it stands on never covers it. Water up on the rock (the Crown's
// tarn, D63) is a column like the rock round it, topped by its pool (terrain.ts `columnLook`).
// Rock holding a face ore (D87: quartz in the cliff) wears its vein — a crystal seam on its walls,
// points on its lip — keyed apart (`:q`) and baked with a little headroom for the points. A stream
// up on a massif (D94) is a column too, its fall down its wall. A column whose lower step shows in
// front of the one above (a diagonal front's ledge, relief.ts `ledges`) is cut in parts, each tinted
// by the shade at its own height; each step wears the rock of its height where it shows (`:l`); the
// talus at the foot of a higher neighbour's wall is a decal of its own (`t:`), a few dozen looks
// for the whole land.
//
// The sun's shadows on the rock (owner, 2026-10-13: "high ground needs to be doing way bigger
// shadows… proportionate to the place of the sun"): the floor's are painted (terrain-chunks.ts,
// 's'); a column whose top lies in the shadow of higher rock is tinted towards ink (`setSun`):
// from nine points on its top, a walk back towards the sun — a level up for every level's step of
// the light along the ground — finds the rock that stands in the way. Re-tinted when the sun moves
// a step, and as blocks stream in. The walk reads the rock as drawn (`heightAt`: chamfers), and the
// shade is smoothed over the tops and ledges round it at its height.
import { Container, Sprite } from 'pixi.js';
import { hash32 } from '@/core/hash';
import { CHUNK, CHUNKS } from '@/sim/constants';
import type { Grid } from '@/sim/world/grid';
import { buildWindow, BORDER, columnLook, footOf, spireTile, tileMasks, WIN, windowLayers, windowLevels } from '../art/terrain';
import { drawSpire, spireHeightAt, spireSeed, spireVariant } from '../art/spire';
import { drawTopMark, isTopMark, TOP_HEAD } from '../art/tops';
import { columnSeed, columnVariant, drawColumn, drawFoot, footKey, hasWall, topKey, type Foot, type TopLook } from '../art/rock';
import { DynAtlas } from '../art/dyn-atlas';
import { IS, IH, ILH } from '../art/iso-shapes';
import { screenToWorld, type CamState } from '../camera-math';
import { LH, tileToIso } from '../iso';
import { reliefHead, tileBoxBounds, type Lin } from '../projection';
import { ledges, levelOf, MAX_LEVEL, MAX_TERRACE, PEAK_LEVEL, slabOutline, STEP_LEVELS, tileTop, type OutlinePt } from '../relief';
import { rockZ } from './stand';
import { C, mix, num } from '../art/tokens';

const BLOCK = 8;
const PER_ROW = (CHUNKS * CHUNK) / BLOCK;
const LOD_ON = 0.3, LOD_OFF = 0.26;
const BUDGET_MS = 8;
const M = 5; // sprite margin (atlas px)
/** Where a column's top is tested for shade (tile-local), and the shade's ink (the cast shadows' cool ink). */
const SAMPLES: ReadonlyArray<readonly [number, number]> = [0.17, 0.5, 0.83].flatMap((u) => [0.17, 0.5, 0.83].map((v) => [u, v] as const));
/** A ledge's samples: a finer grid, of which only the points on the ledge are kept. */
const LEDGE_SAMPLES: ReadonlyArray<readonly [number, number]> = [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((u) => [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => [u, v] as const));
/** Is (u, v) inside a convex outline (clockwise, y down)? */
const inside = (p: readonly OutlinePt[], u: number, v: number): boolean => {
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    if ((b.u - a.u) * (v - a.v) - (b.v - a.v) * (u - a.u) < -1e-9) return false;
  }
  return true;
};
const SHADE = mix(C.ink, C.lilacD, 0.3);
/** Headroom (levels) over a vein's column for the crystal points on its lip (rock.ts `veinLip`: up to half a level). */
const VEIN_HEAD = 0.6;
/** The least ledge (tiles² of a lower step's top left open by the step above) a column is cut at: a diagonal front's half tile, not a corner's chamfer. */
const LEDGE_MIN = 0.2;
/** Headroom (atlas px) over a talus decal for its stones. */
const FOOT_HEAD = 8;
/** Sorting key shared with the buildings (world/stand.ts holds them all): 4 × (2 × depth) + kind. */
export { rockZ };

/**
 * A chunk's columns: relief level, per-step masks, rock class, the top of a column that is not rock
 * (null: rock), its face-ore vein (D87), where higher neighbours' walls rise from its top (rock.ts
 * `Foot`: talus there); and its rock spires (D147: `peak`, a spire's relief height, 0 elsewhere — its
 * `lv` is 0, no terrace —, `pvar` its look).
 */
interface ChunkRelief { lv: Uint8Array; masks: Uint8Array[]; cls: Uint8Array; top: Array<TopLook | null>; vein: Uint8Array; foot: Array<Foot | null>; layers: Array<number[] | null>; peak: Uint8Array; pvar: Uint8Array; high: number; mark: Uint8Array }

export class ReliefView {
  readonly atlas = new DynAtlas();
  private readonly chunks = new Map<number, ChunkRelief>();
  /** Each block's sprites: a column's parts, each with the height its tint is worked out at (and, for a ledge, its column's masks). */
  private readonly blocks = new Map<number, Array<{ s: Sprite; x: number; y: number; lv: number; ms: number[] | null; spire?: boolean }>>();
  /** The sun (ground step per relief level, tiles; quantised), its shadows' strength, and the key they were tinted for. */
  private sun: [number, number] = [0.42, 0];
  private sunAlpha = 0;
  private tinted = '';
  /** Each tile's shade under the sun of the moment, worked out once: the smoothing reads it for every tile round. */
  private readonly shades = new Map<number, number>();
  /** The floor in the rock's shadows or not, by quarter tile, under the sun of the moment (`floorShadeAt`, D130). */
  private readonly floorShades = new Map<number, number>();
  private readonly outlines = new Map<string, OutlinePt[][]>();
  private readonly ledgeCache = new Map<string, number[]>();
  private on = true;
  /** Columns waiting for their sprite bake (they show painted meanwhile). */
  pending = 0;

  constructor(private readonly layer: Container, private readonly grid: Grid) {}

  /** A chunk's terrain changed: its relief and its neighbours' (masks, smoothing) are stale. */
  invalidate(ck: number): void {
    const cx = ck % CHUNKS, cy = Math.floor(ck / CHUNKS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= CHUNKS || ny >= CHUNKS) continue;
        const k = ny * CHUNKS + nx;
        this.chunks.delete(k);
        this.shades.clear();
        this.floorShades.clear();
        for (let by = 0; by < CHUNK / BLOCK; by++) {
          for (let bx = 0; bx < CHUNK / BLOCK; bx++) this.dropBlock((ny * CHUNK) / BLOCK + by, (nx * CHUNK) / BLOCK + bx);
        }
      }
    }
  }

  private dropBlock(by: number, bx: number): void {
    const key = by * PER_ROW + bx;
    const sp = this.blocks.get(key);
    if (!sp) return;
    for (const c of sp) c.s.destroy();
    this.blocks.delete(key);
  }

  private chunk(cx: number, cy: number): ChunkRelief {
    const ck = cy * CHUNKS + cx;
    let c = this.chunks.get(ck);
    if (!c) {
      const d = buildWindow((x, y) => this.grid.chunkAt(x, y), cx, cy, CHUNKS * CHUNK);
      const { lv, masks } = windowLevels(d);
      c = {
        lv: new Uint8Array(CHUNK * CHUNK), masks: Array.from({ length: MAX_TERRACE }, () => new Uint8Array(CHUNK * CHUNK)),
        cls: new Uint8Array(CHUNK * CHUNK), top: new Array<TopLook | null>(CHUNK * CHUNK).fill(null), vein: new Uint8Array(CHUNK * CHUNK),
        foot: new Array<Foot | null>(CHUNK * CHUNK).fill(null), layers: new Array<number[] | null>(CHUNK * CHUNK).fill(null),
        peak: new Uint8Array(CHUNK * CHUNK), pvar: new Uint8Array(CHUNK * CHUNK), high: 0, mark: new Uint8Array(CHUNK * CHUNK),
      };
      for (let j = 0; j < CHUNK; j++) {
        for (let i = 0; i < CHUNK; i++) {
          const o = (j + BORDER) * WIN + i + BORDER, k = j * CHUNK + i;
          if (spireTile(d, o)) { c.peak[k] = levelOf(d.terrain[o]!, d.level[o]!); c.pvar[k] = spireVariant(cx * CHUNK + i, cy * CHUNK + j); }
          c.lv[k] = lv[o]!;
          if (lv[o] && isTopMark(d.biome[o]!)) c.mark[k] = d.biome[o]!;
          c.high = Math.max(c.high, c.lv[k]!, c.peak[k]!);
          if (lv[o]) {
            const look = columnLook(d, lv, o);
            c.cls[k] = look.cls; c.top[k] = look.top; c.vein[k] = look.vein ? 1 : 0;
            // Rock the water only reaches (D135) keeps its talus and its layers as plain rock does.
            const water = look.top && look.top.kind !== 'rock';
            c.foot[k] = water ? null : footOf(lv, masks, o);
            // The rock of each step, when it is not the column's own all the way down (terrain.ts
            // `layersOf`) — only where it shows: a step with no wall and no top in sight (no drop, no
            // ledge) keeps the column's own, so looks that draw the same share one sprite.
            let layers = water ? null : windowLayers(d, lv, o, look.cls, lv[o]! / STEP_LEVELS);
            if (layers) {
              const ms = tileMasks(lv, masks, o), shows = ledges(ms);
              layers = layers.map((l, t) => (ms[t] || shows.includes(t) ? l : look.cls));
            }
            c.layers[k] = layers && layers.some((l) => l !== look.cls) ? layers : null;
          }
          for (let t = 0; t < MAX_TERRACE; t++) c.masks[t]![k] = masks[t]![o]!;
        }
      }
      this.chunks.set(ck, c);
    }
    return c;
  }

  /**
   * The baked frame for a column look's part (its slabs t0 … t1: the whole column unless a ledge
   * cuts it, `ledges`), or undefined when over this frame's budget. A part's frame spans its own
   * heights only.
   */
  private frame(cls: number, masks: readonly number[], variant: number, top: TopLook | null, vein: boolean, layers: readonly number[] | null, t0: number, t1: number): ReturnType<DynAtlas['get']> {
    const whole = t0 === 0 && t1 === masks.length - 1;
    const key = `${cls}:${masks.join('.')}:${variant}:${topKey(top)}${vein ? ':q' : ''}${layers ? `:l${layers.join('')}` : ''}${whole ? '' : `:p${t0}-${t1}`}`;
    const f = this.atlas.get(key);
    if (f || this.atlas.spent > BUDGET_MS) return f;
    // A vein's points poke up over the top's back lip: room for them above.
    const last = t1 === masks.length - 1;
    const head = vein && last ? Math.ceil(VEIN_HEAD * ILH) : 0;
    const zb = t0 * STEP_LEVELS, zt = (t1 + 1) * STEP_LEVELS;
    const w = 2 * IS + 2 * M, h = 2 * IH + (zt - zb) * ILH + 2 * M + head;
    const ox = M + IS, oy = M + zt * ILH + head;
    const seed = columnSeed(cls, masks, variant);
    return this.atlas.add(key, w, h, ox, oy, (ctx) => {
      drawColumn(ctx, (u, v, z) => [ox + (u - v) * IS, oy + (u + v) * IH - z * ILH], cls, masks, { detail: 2, seed, k: 1, top, vein: vein && last, layers, slabs: [t0, t1] });
    });
  }

  /**
   * The baked frame of a rock spire (D147, art/spire.ts `drawSpire`), `h` relief levels tall, of look
   * `variant`: its whole height in one sprite (no ledges to cut it at; its top is its only top), a
   * tile wide — it never leaves its tile.
   */
  private spireFrame(h: number, variant: number): ReturnType<DynAtlas['get']> {
    const key = `s:${h}:${variant}`;
    const f = this.atlas.get(key);
    if (f || this.atlas.spent > BUDGET_MS) return f;
    const w = 2 * IS + 2 * M, hh = 2 * IH + h * ILH + 2 * M;
    const ox = M + IS, oy = M + h * ILH;
    return this.atlas.add(key, w, hh, ox, oy, (ctx) => {
      drawSpire(ctx, (u, v, z) => [ox + (u - v) * IS, oy + (u + v) * IH - z * ILH], h, { detail: 2, seed: spireSeed(h, variant), k: 1 });
    });
  }

  /** The baked decal of what stands on a top (D149, art/tops.ts): drawn at height 0, lifted onto the top by its sprite; a look by tile. */
  private markFrame(kind: number, seed: number): ReturnType<DynAtlas['get']> {
    const key = `m:${kind}:${seed & 3}`;
    const f = this.atlas.get(key);
    if (f || this.atlas.spent > BUDGET_MS) return f;
    const head = Math.ceil(TOP_HEAD * ILH), w = 2 * IS + 2 * M, h = 2 * IH + 2 * M + head;
    const ox = M + IS, oy = M + head;
    return this.atlas.add(key, w, h, ox, oy, (ctx) => {
      drawTopMark(ctx, (u, v, z) => [ox + (u - v) * IS, oy + (u + v) * IH - z * ILH], kind, 0, (seed & 3) * 977 + kind, 1, 2);
    });
  }

  /**
   * The baked talus decal at the foot of higher neighbours' walls on a top (rock.ts `drawFoot`),
   * drawn at height 0 and lifted onto the top by its sprite: a few dozen looks (hardness × where
   * the walls stand × two variants) serve every foot of the land.
   */
  private footFrame(cls: number, foot: Foot, variant: number): ReturnType<DynAtlas['get']> {
    const key = `t:${cls}:${footKey(foot)}:${variant}`;
    const f = this.atlas.get(key);
    if (f || this.atlas.spent > BUDGET_MS) return f;
    const w = 2 * IS + 2 * M, h = 2 * IH + 2 * M + FOOT_HEAD;
    const ox = M + IS, oy = M + FOOT_HEAD;
    return this.atlas.add(key, w, h, ox, oy, (ctx) => {
      drawFoot(ctx, (u, v, z) => [ox + (u - v) * IS, oy + (u + v) * IH - z * ILH], 0, cls, foot, 0x7a1 + variant * 977 + cls, 1);
    });
  }

  /**
   * Per frame, with the view projection P and its plan-ness t: stream blocks of columns in
   * and out of view. Nothing moves while the volumes are faded out (the plan half).
   */
  update(cam: CamState, vw: number, vh: number, visible: ReadonlyArray<readonly [number, number]>, P: Lin, t: number): void {
    if (t >= 0.6) return;
    const was = this.on;
    this.on = this.on ? cam.zoom >= LOD_OFF : cam.zoom >= LOD_ON;
    if (!this.on) {
      if (was) for (const k of [...this.blocks.keys()]) this.dropBlock(Math.floor(k / PER_ROW), k % PER_ROW);
      // Sprites off: nothing waits for a bake (a count left from the frame before would read as work pending).
      this.pending = 0;
      return;
    }
    // View rect in world px; blocks whose box (with relief headroom) misses it are culled.
    const [vx0, vy0] = screenToWorld(cam, vw, vh, 0, 0);
    const [vx1, vy1] = screenToWorld(cam, vw, vh, vw, vh);
    const head = reliefHead(t, PEAK_LEVEL);
    const want = new Set<number>();
    this.pending = 0;
    for (const [cx, cy] of visible) {
      for (let by = 0; by < CHUNK / BLOCK; by++) {
        for (let bx = 0; bx < CHUNK / BLOCK; bx++) {
          const tx = cx * CHUNK + bx * BLOCK, ty = cy * CHUNK + by * BLOCK;
          const [x0, y0, x1, y1] = tileBoxBounds(P, tx, ty, BLOCK, head);
          if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) continue;
          const key = (ty / BLOCK) * PER_ROW + tx / BLOCK;
          want.add(key);
          if (!this.blocks.has(key)) this.build(key, cx, cy, tx, ty);
        }
      }
    }
    for (const k of [...this.blocks.keys()]) if (!want.has(k)) this.dropBlock(Math.floor(k / PER_ROW), k % PER_ROW);
    this.atlas.flush();
  }

  /**
   * A block's sprites. A column is cut at its ledges (relief.ts `ledges`: a lower step's top showing
   * in front of a chamfered upper step, the diagonal fronts' staircases) into parts, bottom first
   * at the same depth key (equal keys keep their order), each tinted by the shade at its own top: a
   * ledge is part of the terrace in front, and shaded with it, not lit with the high top behind it
   * (owner, 2026-10-16: the terraces under a cliff were a checkerboard of diamonds).
   */
  private build(key: number, cx: number, cy: number, tx: number, ty: number): void {
    const c = this.chunk(cx, cy);
    const out: Array<{ s: Sprite; x: number; y: number; lv: number; ms: number[] | null; spire?: boolean }> = [];
    let complete = true;
    for (let y = ty; y < ty + BLOCK; y++) {
      for (let x = tx; x < tx + BLOCK; x++) {
        const k = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
        if (c.peak[k]) {
          // A rock spire (D147): one sprite, untinted (its top stands over everything round it).
          const f = this.spireFrame(c.peak[k]!, c.pvar[k]!);
          if (!f) { complete = false; this.pending++; continue; }
          const s = new Sprite(f.tex);
          s.scale.set(0.5);
          const [wx, wy] = tileToIso(x, y);
          s.position.set(wx - f.ox * 0.5, wy - f.oy * 0.5);
          s.zIndex = rockZ(x, y);
          this.layer.addChild(s);
          out.push({ s, x, y, lv: c.peak[k]!, ms: null, spire: true });
          continue;
        }
        if (!c.lv[k]) continue;
        const ms = tileMasks(c.lv, c.masks, k), variant = columnVariant(x, y, hasWall(ms));
        let t0 = 0;
        for (const t1 of this.ledgesOf(ms)) {
          const f = this.frame(c.cls[k]!, ms, variant, c.top[k]!, c.vein[k] === 1, c.layers[k]!, t0, t1);
          const lv = (t1 + 1) * STEP_LEVELS;
          t0 = t1 + 1;
          if (!f) { complete = false; this.pending++; continue; }
          const s = new Sprite(f.tex);
          s.scale.set(0.5);
          const [wx, wy] = tileToIso(x, y);
          s.position.set(wx - f.ox * 0.5, wy - f.oy * 0.5);
          s.zIndex = rockZ(x, y);
          const ledge = t1 < ms.length - 1 ? ms : null;
          s.tint = this.tintAt(x, y, lv, ledge);
          this.layer.addChild(s);
          out.push({ s, x, y, lv, ms: ledge });
        }
        // The talus at the foot of the higher walls behind it, a decal lifted onto its top.
        const foot = c.foot[k];
        if (foot) {
          const f = this.footFrame(c.cls[k]!, foot, hash32(x, y, 0x7b) & 1);
          if (!f) { complete = false; this.pending++; continue; }
          const L = c.lv[k]!;
          const s = new Sprite(f.tex);
          s.scale.set(0.5);
          const [wx, wy] = tileToIso(x, y);
          s.position.set(wx - f.ox * 0.5, wy - f.oy * 0.5 - L * LH);
          s.zIndex = rockZ(x, y) + 0.01;
          s.tint = this.tintAt(x, y, L, null);
          this.layer.addChild(s);
          out.push({ s, x, y, lv: L, ms: null });
        }
        // What stands on its top (D149): a decal lifted onto it, over its talus.
        const mark = c.mark[k];
        if (mark) {
          const f = this.markFrame(mark, hash32(x, y, 0x70a));
          if (!f) { complete = false; this.pending++; continue; }
          const L = c.lv[k]!;
          const s = new Sprite(f.tex);
          s.scale.set(0.5);
          const [wx, wy] = tileToIso(x, y);
          s.position.set(wx - f.ox * 0.5, wy - f.oy * 0.5 - L * LH);
          s.zIndex = rockZ(x, y) + 0.02;
          s.tint = this.tintAt(x, y, L, null);
          this.layer.addChild(s);
          out.push({ s, x, y, lv: L, ms: null });
        }
      }
    }
    if (!complete) {
      // Over budget: retry the whole block next frame (the painted relief shows meanwhile).
      for (const o of out) o.s.destroy();
      return;
    }
    this.blocks.set(key, out);
  }

  /**
   * Relief level of a tile's top (0 = floor): relief.ts `tileTop`, the one height function every
   * lift reads (the overlays' marks on rock tops too); today the very level the columns are drawn at.
   */
  level(x: number, y: number): number {
    return tileTop(this.grid, x, y);
  }

  /** The sun the rock's shadows fall from: (dx, dy) tiles per relief level on the ground, their strength (none at night). */
  setSun(dx: number, dy: number, alpha: number): void {
    this.sun = [Math.round(dx * 32) / 32, Math.round(dy * 32) / 32];
    this.sunAlpha = Math.round(alpha * 50) / 50;
    const key = `${this.sun[0]},${this.sun[1]},${this.sunAlpha}`;
    if (key === this.tinted) return;
    this.tinted = key;
    this.shades.clear();
    this.floorShades.clear();
    for (const b of this.blocks.values()) for (const c of b) if (!c.spire) c.s.tint = this.tintAt(c.x, c.y, c.lv, c.ms);
  }

  /**
   * The highest relief in the chunks round a tile's (3 × 3; relief levels): how far up a walk to the
   * sun can meet rock there — the terraces' 12 at most, a spire's 28 only near the field (D147), so
   * the walks elsewhere stay as short as they were.
   */
  private highAround(x: number, y: number): number {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    let h = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const nx = cx + i, ny = cy + j;
      if (nx < 0 || ny < 0 || nx >= CHUNKS || ny >= CHUNKS) continue;
      h = Math.max(h, this.chunk(nx, ny).high);
    }
    return h;
  }

  /** A tile's spire (D147): its relief height and its look; null when it holds none. */
  private spireOf(x: number, y: number): [number, number] | null {
    if (x < 0 || y < 0 || x >= CHUNKS * CHUNK || y >= CHUNKS * CHUNK) return null;
    const c = this.chunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK)), k = (y % CHUNK) * CHUNK + (x % CHUNK);
    return c.peak[k] ? [c.peak[k]!, c.pvar[k]!] : null;
  }

  /** A tile's per-step masks (null off the world). */
  private masksOf(x: number, y: number): number[] | null {
    if (x < 0 || y < 0 || x >= CHUNKS * CHUNK || y >= CHUNKS * CHUNK) return null;
    const c = this.chunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    return tileMasks(c.lv, c.masks, (y % CHUNK) * CHUNK + (x % CHUNK));
  }

  /** A column look's ledges (relief.ts `ledges`), worked out once per look. */
  private ledgesOf(ms: readonly number[]): number[] {
    const key = ms.join('.');
    let l = this.ledgeCache.get(key);
    if (!l) { l = ledges(ms, LEDGE_MIN); this.ledgeCache.set(key, l); }
    return l;
  }

  /** A column look's slab outlines (relief.ts `slabOutline`), worked out once per look. */
  private outlinesOf(ms: readonly number[]): OutlinePt[][] {
    const key = ms.join('.');
    let o = this.outlines.get(key);
    if (!o) { o = ms.map((_, s) => slabOutline(ms, s)); this.outlines.set(key, o); }
    return o;
  }

  /**
   * The height of the rock drawn at a ground point (px, py) (tiles): the highest step of its tile
   * whose outline holds it — a chamfered column stands where the art draws it (a diagonal front is
   * one straight wall), not over its whole tile; a plain tile is its top.
   */
  private heightAt(px: number, py: number): number {
    const tx = Math.floor(px), ty = Math.floor(py);
    const top = tileTop(this.grid, tx, ty);
    if (!top) return top;
    // A spire (D147) stands where its solid does: tall over its middle, its skirt low at its edge.
    const sp = this.spireOf(tx, ty);
    if (sp) return spireHeightAt(sp[0], spireSeed(sp[0], sp[1]), px - tx, py - ty);
    const ms = this.masksOf(tx, ty);
    if (!ms || ms.every((m) => !m)) return top;
    const outs = this.outlinesOf(ms);
    let h = 0;
    for (let s = 0; s < outs.length; s++) if (inside(outs[s]!, px - tx, py - ty)) h = (s + 1) * STEP_LEVELS;
    return h;
  }

  /**
   * How much of a column's top (0–1) lies in the shadow of higher rock, the sun being where `sun`
   * says; or of its ledge at height `t` (`ms`, the column's masks: the ledge is the part of the
   * step's outline the step above leaves open). The rock in the way is the rock as drawn
   * (`heightAt`), so the tops along one straight wall take the same shade.
   */
  shadeAt(x: number, y: number, t = tileTop(this.grid, x, y), ms: readonly number[] | null = null): number {
    const [dx, dy] = this.sun;
    if (!t || (!dx && !dy)) return 0;
    const step = t / STEP_LEVELS;
    const outs = ms ? this.outlinesOf(ms) : null;
    const pts = outs ? LEDGE_SAMPLES.filter(([u, v]) => inside(outs[step - 1]!, u, v) && !inside(outs[step]!, u, v)) : SAMPLES;
    if (!pts.length) return 0;
    let n = 0;
    const reach = Math.min(PEAK_LEVEL, this.highAround(x, y)) - t;
    for (const [u, v] of pts) {
      for (let k = 0.5; k <= reach; k += 0.5) {
        const px = x + u - dx * k, py = y + v - dy * k;
        // The cheap test first: only a tile standing higher than the ray can hold rock in the way.
        if (tileTop(this.grid, Math.floor(px), Math.floor(py)) > t + k && this.heightAt(px, py) > t + k) { n++; break; }
      }
    }
    return n / pts.length;
  }

  /**
   * How dark the rock's sun shadows lie on the floor at ground point (x, y) (tiles; 0: lit … their
   * opacity; D130): rock as drawn (`heightAt`) standing above the ray towards the sun somewhere along
   * it, as art/terrain.ts `paintSunShadows` lays them on the ground (by quarter tile, worked out once
   * per sun). For the items sorted among the volumes on the floor (by a building's near face), drawn
   * over that paint: they take it as a tint (items-view.ts).
   */
  readonly floorShadeAt = (x: number, y: number): number => {
    const [dx, dy] = this.sun;
    if (this.sunAlpha <= 0 || (!dx && !dy)) return 0;
    const qx = Math.floor(x * 4), qy = Math.floor(y * 4), key = qy * 8192 + qx;
    let s = this.floorShades.get(key);
    if (s === undefined) {
      s = 0;
      const px = (qx + 0.5) / 4, py = (qy + 0.5) / 4, reach = Math.min(PEAK_LEVEL, this.highAround(Math.floor(px), Math.floor(py)));
      for (let k = 0.25; k <= reach; k += 0.25) {
        const rx = px - dx * k, ry = py - dy * k;
        // The cheap test first: only a tile standing higher than the ray can hold rock in the way.
        if (tileTop(this.grid, Math.floor(rx), Math.floor(ry)) > k && this.heightAt(rx, ry) > k) { s = 1; break; }
      }
      this.floorShades.set(key, s);
    }
    return s * this.sunAlpha;
  };

  /** `shadeAt` at height t, worked out once per tile and height for the sun of the moment. */
  private shadeCached(x: number, y: number, t: number, ms: readonly number[] | null = null): number {
    const key = (y * CHUNKS * CHUNK + x) * (MAX_LEVEL + 1) + t;
    let s = this.shades.get(key);
    if (s === undefined) { s = this.shadeAt(x, y, t, ms); this.shades.set(key, s); }
    return s;
  }

  /**
   * The shade, smoothed over the columns round it at its height (5 × 5, nearer ones weighing more):
   * the land steps tile by tile, but the art draws a diagonal front as one straight wall (relief.ts
   * `cutsOf`), and each sprite takes one tint, so an unsmoothed shade fell every other tile — a
   * checkerboard of diamonds on the terraces under a cliff (owner, 2026-10-16). Smoothed, it fades
   * across a terrace in small steps.
   */
  private smoothShade(x: number, y: number, t: number, ms: readonly number[] | null): number {
    let sum = 2 * this.shadeCached(x, y, t, ms), w = 2;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      if (!i && !j) continue;
      const top = tileTop(this.grid, x + i, y + j);
      if (top < t) continue;
      // A neighbour's top at this height, or its ledge there (part of the same terrace).
      let nms: number[] | null = null;
      if (top > t) {
        nms = this.masksOf(x + i, y + j);
        if (!nms || !this.ledgesOf(nms).includes(t / STEP_LEVELS - 1)) continue;
      }
      const wt = 1 / (1 + i * i + j * j);
      sum += wt * this.shadeCached(x + i, y + j, t, nms);
      w += wt;
    }
    return sum / w;
  }

  /** A part's tint: the shade at its top (`lv`; `ms`, its column's masks, for a ledge), smoothed with the tops round it at that height. */
  private tintAt(x: number, y: number, lv: number, ms: readonly number[] | null): number {
    const f = this.sunAlpha > 0 ? this.smoothShade(x, y, lv, ms) : 0;
    return f ? num(mix('#ffffff', SHADE, Math.min(0.5, f * this.sunAlpha * 1.2))) : 0xffffff;
  }

  stats(): { blocks: number; sprites: number; baked: number } {
    let n = 0;
    for (const b of this.blocks.values()) n += b.length;
    return { blocks: this.blocks.size, sprites: n, baked: this.atlas.size };
  }
}
