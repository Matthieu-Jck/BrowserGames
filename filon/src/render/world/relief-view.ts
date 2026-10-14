// relief-view.ts — rock columns as sprites at near zooms, depth-sorted together with the
// buildings (one shared sortable layer), so a cliff in front of a machine hides it and a
// machine in front of a cliff covers it. The same columns are painted into the terrain
// texture for far zooms; below the LOD threshold the sprites go away and nothing changes on
// screen but the line work. Sprites are baked on demand (class × level × mask × variant)
// in a dynamic atlas under a per-frame time budget; blocks of 8×8 tiles stream with the view.
// A building standing on a column (D44) sorts after it and every column under its footprint
// (world/stand.ts), so the rock it stands on never covers it.
//
// The sun's shadows on the rock (owner, 2026-10-13: "high ground needs to be doing way bigger
// shadows… proportionate to the place of the sun"): the floor's are painted (terrain-chunks.ts,
// 's'); a column whose top lies in the shadow of higher rock is tinted towards ink (`setSun`):
// from nine points on its top, a walk back towards the sun — a level up for every level's step of
// the light along the ground — finds the rock that stands in the way. Re-tinted when the sun moves
// a step, and as blocks stream in.
import { Container, Sprite } from 'pixi.js';
import { CHUNK, CHUNKS } from '@/sim/constants';
import type { Grid } from '@/sim/world/grid';
import { T } from '@/sim/types';
import { hash32 } from '@/core/hash';
import { buildWindow, BORDER, tileMasks, WIN, windowLevels } from '../art/terrain';
import { drawColumn } from '../art/rock';
import { DynAtlas } from '../art/dyn-atlas';
import { IS, IH, ILH } from '../art/iso-shapes';
import { screenToWorld, type CamState } from '../camera-math';
import { tileToIso } from '../iso';
import { reliefHead, tileBoxBounds, type Lin } from '../projection';
import { MAX_LEVEL, MAX_TERRACE, tileTop } from '../relief';
import { rockZ } from './stand';
import { C, mix, num } from '../art/tokens';

const BLOCK = 8;
const PER_ROW = (CHUNKS * CHUNK) / BLOCK;
const LOD_ON = 0.3, LOD_OFF = 0.26;
const BUDGET_MS = 8;
const M = 5; // sprite margin (atlas px)
/** Where a column's top is tested for shade (tile-local), and the shade's ink (the cast shadows' cool ink). */
const SAMPLES: ReadonlyArray<readonly [number, number]> = [0.17, 0.5, 0.83].flatMap((u) => [0.17, 0.5, 0.83].map((v) => [u, v] as const));
const SHADE = mix(C.ink, C.lilacD, 0.3);
/** Sorting key shared with the buildings (world/stand.ts holds them all): 4 × (2 × depth) + kind. */
export { rockZ };

interface ChunkRelief { lv: Uint8Array; masks: Uint8Array[]; terr: Uint8Array }

export class ReliefView {
  readonly atlas = new DynAtlas();
  private readonly chunks = new Map<number, ChunkRelief>();
  private readonly blocks = new Map<number, Array<{ s: Sprite; x: number; y: number }>>();
  /** The sun (ground step per relief level, tiles; quantised), its shadows' strength, and the key they were tinted for. */
  private sun: [number, number] = [0.42, 0];
  private sunAlpha = 0;
  private tinted = '';
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
      c = { lv: new Uint8Array(CHUNK * CHUNK), masks: Array.from({ length: MAX_TERRACE }, () => new Uint8Array(CHUNK * CHUNK)), terr: new Uint8Array(CHUNK * CHUNK) };
      for (let j = 0; j < CHUNK; j++) {
        for (let i = 0; i < CHUNK; i++) {
          const o = (j + BORDER) * WIN + i + BORDER, k = j * CHUNK + i;
          c.lv[k] = lv[o]!; c.terr[k] = d.terrain[o]!;
          for (let t = 0; t < MAX_TERRACE; t++) c.masks[t]![k] = masks[t]![o]!;
        }
      }
      this.chunks.set(ck, c);
    }
    return c;
  }

  /** The baked frame for a column look, or undefined when over this frame's budget. */
  private frame(cls: number, L: number, masks: readonly number[], variant: number): ReturnType<DynAtlas['get']> {
    const key = `${cls}:${masks.join('.')}:${variant}`;
    const f = this.atlas.get(key);
    if (f || this.atlas.spent > BUDGET_MS) return f;
    const w = 2 * IS + 2 * M, h = 2 * IH + L * ILH + 2 * M;
    const ox = M + IS, oy = M + L * ILH;
    const seed = hash32(cls, L, masks[masks.length - 1]!, variant + 0x51);
    return this.atlas.add(key, w, h, ox, oy, (ctx) => {
      drawColumn(ctx, (u, v, z) => [ox + (u - v) * IS, oy + (u + v) * IH - z * ILH], cls, masks, { detail: 2, seed, k: 1 });
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
      return;
    }
    // View rect in world px; blocks whose box (with relief headroom) misses it are culled.
    const [vx0, vy0] = screenToWorld(cam, vw, vh, 0, 0);
    const [vx1, vy1] = screenToWorld(cam, vw, vh, vw, vh);
    const head = reliefHead(t, MAX_LEVEL);
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

  private build(key: number, cx: number, cy: number, tx: number, ty: number): void {
    const c = this.chunk(cx, cy);
    const out: Array<{ s: Sprite; x: number; y: number }> = [];
    let complete = true;
    for (let y = ty; y < ty + BLOCK; y++) {
      for (let x = tx; x < tx + BLOCK; x++) {
        const k = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
        const L = c.lv[k]!;
        if (!L) continue;
        const cls = c.terr[k]! - T.Rock1;
        const f = this.frame(cls, L, tileMasks(c.lv, c.masks, k), hash32(x, y, 0x77) & 1);
        if (!f) { complete = false; this.pending++; continue; }
        const s = new Sprite(f.tex);
        s.scale.set(0.5);
        const [wx, wy] = tileToIso(x, y);
        s.position.set(wx - f.ox * 0.5, wy - f.oy * 0.5);
        s.zIndex = rockZ(x, y);
        s.tint = this.tintAt(x, y);
        this.layer.addChild(s);
        out.push({ s, x, y });
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
    for (const b of this.blocks.values()) for (const c of b) c.s.tint = this.tintAt(c.x, c.y);
  }

  /** How much of a column's top (0–1) lies in the shadow of higher rock, the sun being where `sun` says. */
  shadeAt(x: number, y: number): number {
    const t = tileTop(this.grid, x, y);
    const [dx, dy] = this.sun;
    if (!t || (!dx && !dy)) return 0;
    let n = 0;
    for (const [u, v] of SAMPLES) {
      for (let k = 0.5; k <= MAX_LEVEL - t; k += 0.5) {
        if (tileTop(this.grid, Math.floor(x + u - dx * k), Math.floor(y + v - dy * k)) > t + k) { n++; break; }
      }
    }
    return n / SAMPLES.length;
  }

  /**
   * The shade, smoothed over the column's neighbours at its height: the land steps tile by tile,
   * but the art draws a diagonal front as one straight wall (relief.ts `cutsOf`), so the shade along
   * it is spread evenly instead of every other tile.
   */
  private smoothShade(x: number, y: number): number {
    const t = tileTop(this.grid, x, y);
    let sum = 2 * this.shadeAt(x, y), w = 2;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if ((!i && !j) || tileTop(this.grid, x + i, y + j) !== t) continue;
      sum += this.shadeAt(x + i, y + j);
      w++;
    }
    return sum / w;
  }

  private tintAt(x: number, y: number): number {
    const f = this.sunAlpha > 0 ? this.smoothShade(x, y) : 0;
    return f ? num(mix('#ffffff', SHADE, Math.min(0.6, f * this.sunAlpha * 1.5))) : 0xffffff;
  }

  stats(): { blocks: number; sprites: number; baked: number } {
    let n = 0;
    for (const b of this.blocks.values()) n += b.length;
    return { blocks: this.blocks.size, sprites: n, baked: this.atlas.size };
  }
}
