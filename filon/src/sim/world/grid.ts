// grid.ts — the tile world: 1024×1024 tiles in 32×32 chunks generated lazily from a pure
// TerrainSource (mapgen.ts in the game, flat worlds in tests). Only diffs (dug / filled
// tiles, revealed veins) are saved; occupancy is derived from entities.
import { CHUNK, CHUNKS, WORLD } from '../constants';
import { T } from '../types';

export interface TerrainSource {
  /** Fill one chunk. Must be a pure function of the source's seeds and (cx, cy). */
  fill(cx: number, cy: number, terrain: Uint8Array, ore: Uint8Array, rich: Uint16Array, height?: Uint8Array, biome?: Uint8Array, level?: Uint8Array): void;
  /** Chance (‰) that a dug rock tile holds copper ore — the land's archetype (default BAL.embedCopper). */
  readonly embedCopper?: number;
  /** The farthest the Crown's terraces reach from the centre (the starting square holds them; default the cirque template's foot). */
  readonly crownReach?: number;
  /** The map version the land was made by (D63; content `MAPS`): saved with the base (`SaveData.mapV`), so it reopens on the same land. */
  readonly mapV?: number;
  /** The cirque template's own Crown foot, whatever the archetype (MapGen: r 34 on map 1, 29 on map 2). */
  readonly crownOuter?: number;
  /** The Crown's tarn, where there is one (map 2): its centre tile and the level of its water. */
  readonly tarn?: { readonly x: number; readonly y: number; readonly level: number } | null;
  /** The Crown's spring, where there is one (map 4, D115: in the tarn's place): its head tile and the level of its water there; its stream runs down to a pool on the floor. */
  readonly spring?: { readonly x: number; readonly y: number; readonly level: number } | null;
  /** The land's quartz vein, where there is one (map 3, D87): its face tiles and the way they look. */
  readonly quartzVein?: VeinSite | null;
  /** A point on the sea's coast straight out from the cirque (map 4, D94: the shared world's sea); null where there is none. */
  seaPoint?(): [number, number] | null;
  /** The land's deposits come in whole blocks this wide on the world's grid (map 4, D104: a drill's footprint); absent or 1: tile by tile. */
  readonly oreBlock?: number;
  /** The neighbouring bases come in holdings of a few parcels (map 4, D110); absent: one parcel each, scattered (maps 1–3, test worlds). */
  readonly holdings?: boolean;
  /** Is tile (x, y) open floor at level 0 as the source makes it (a building stands there)? Pure and cheap, no chunk made: the neighbouring bases' sampling (D110). Absent: everywhere. */
  floorAt?(x: number, y: number): boolean;
  /** Does the tile rect [x0, x1) × [y0, y1) hold something the land guarantees the claim — a unique site, the copper field, a vent, the quartz vein, a corridor (D94)? No neighbouring base takes it (D110). Absent: nothing. */
  keepsClear?(x0: number, y0: number, x1: number, y1: number): boolean;
}

/**
 * A vein set in a cliff face (D87): `n` face tiles from (x, y), a step (dx, dy) apart along the
 * wall, each rock one level above the floor at its foot; `look` is the side the face looks to (the
 * floor a face cutter stands on, its back to the wall: the cutter's own rotation); `item` the ore.
 */
export interface VeinSite {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly n: number;
  readonly look: 0 | 1 | 2 | 3;
  readonly item: number;
}

export interface Chunk {
  cx: number;
  cy: number;
  terrain: Uint8Array; // T class per tile
  ore: Uint8Array;     // item index + 1 of the deposit (0 = none)
  rich: Uint16Array;   // per-tile extraction cap, in 10 mu per epoch (5/min → 500)
  height: Uint8Array;  // shading height (renderer only, not saved)
  biome: Uint8Array;   // decor biome code (renderer only, not saved)
  /**
   * The land's level, 0 (the cirque's floor) … `MAX_LEVEL` (D45): a rule of the game, not a look —
   * a ribbon, a port or a wire meets only its own level (a traction ribbon climbs one), and a
   * building stands on level ground. Rock stands above 0, and water up on the rock (the Crown's
   * tarn, D63: a pump draws it on its own level; filled, it is ground at that level). Saved where
   * play changed it (`levelDiff`).
   */
  level: Uint8Array;
}

/** The highest level of the mountains, the massifs and the Crown (D45: height 5 at most). */
export const MOUNTAIN_LEVEL = 5;
/**
 * The highest level of the land: the mountains', or a level over them on map 4's spring summit
 * (D115; owner, 2026-10-17: « the bigger moutain needs to be a little plateau, and at least 6 in
 * height »).
 */
export const MAX_LEVEL = 6;

const N_CHUNK_TILES = CHUNK * CHUNK;

export const tileIndex = (x: number, y: number): number => y * WORLD + x;
export const inWorld = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < WORLD && y < WORLD;

export class Grid {
  private readonly chunks: Array<Chunk | undefined> = new Array(CHUNKS * CHUNKS);
  /** Entity id occupying each tile (0 = free). */
  readonly occ = new Int32Array(WORLD * WORLD);
  /** Saved overrides: tile index → terrain class, and tile → packed (ore+1) << 16 | rich. */
  readonly terrainDiff = new Map<number, number>();
  readonly oreDiff = new Map<number, number>();
  /** Saved overrides of the land's level (a dug tile comes down). */
  readonly levelDiff = new Map<number, number>();
  /** Chunks whose look changed (renderer re-bakes them). */
  readonly dirtyChunks = new Set<number>();
  /**
   * The land as its source made it, on the tiles play changed (dug, filled, ore taken): tile →
   * terrain | level << 8 | (ore + 1) << 16. The neighbouring bases (D110, world/neighbours.ts) are
   * laid out on it, so what the claim digs never moves them. Read when a chunk is made, never saved.
   */
  private readonly made = new Map<number, number>();

  constructor(readonly source: TerrainSource) {}

  chunkAt(cx: number, cy: number): Chunk {
    const k = cy * CHUNKS + cx;
    let c = this.chunks[k];
    if (!c) {
      c = {
        cx, cy,
        terrain: new Uint8Array(N_CHUNK_TILES),
        ore: new Uint8Array(N_CHUNK_TILES),
        rich: new Uint16Array(N_CHUNK_TILES),
        height: new Uint8Array(N_CHUNK_TILES),
        biome: new Uint8Array(N_CHUNK_TILES),
        level: new Uint8Array(N_CHUNK_TILES),
      };
      this.source.fill(cx, cy, c.terrain, c.ore, c.rich, c.height, c.biome, c.level);
      this.chunks[k] = c;
      // What the saved overrides cover, as the source made it (`made`), before they are applied.
      for (const m of [this.terrainDiff, this.levelDiff, this.oreDiff]) for (const t of m.keys()) {
        const x = t % WORLD, y = (t - x) / WORLD;
        if ((x >> 5) === cx && (y >> 5) === cy) this.keepMade(c, t);
      }
      // Re-apply saved overrides that fall in this chunk.
      for (const [t, v] of this.terrainDiff) {
        const x = t % WORLD, y = (t - x) / WORLD;
        if ((x >> 5) === cx && (y >> 5) === cy) c.terrain[(y & 31) * CHUNK + (x & 31)] = v;
      }
      for (const [t, v] of this.levelDiff) {
        const x = t % WORLD, y = (t - x) / WORLD;
        if ((x >> 5) === cx && (y >> 5) === cy) c.level[(y & 31) * CHUNK + (x & 31)] = v;
      }
      for (const [t, v] of this.oreDiff) {
        const x = t % WORLD, y = (t - x) / WORLD;
        if ((x >> 5) === cx && (y >> 5) === cy) {
          c.ore[(y & 31) * CHUNK + (x & 31)] = v >>> 16;
          c.rich[(y & 31) * CHUNK + (x & 31)] = v & 0xffff;
        }
      }
    }
    return c;
  }

  /** Note tile t as its source made it, before play first changes it (`made`). */
  private keepMade(c: Chunk, t: number): void {
    if (this.made.has(t)) return;
    const x = t % WORLD, i = (((t - x) / WORLD) & 31) * CHUNK + (x & 31);
    this.made.set(t, c.terrain[i]! | (c.level[i]! << 8) | (c.ore[i]! << 16));
  }

  /** A tile's terrain, level and ore (item index, −1: none) as the land's source made it, whatever play changed since (D110). */
  made0(x: number, y: number): { terrain: number; level: number; ore: number } {
    if (!inWorld(x, y)) return { terrain: T.DuneSea, level: 0, ore: -1 };
    const c = this.chunkAt(x >> 5, y >> 5), t = tileIndex(x, y), m = this.made.get(t);
    if (m !== undefined) return { terrain: m & 255, level: (m >>> 8) & 255, ore: (m >>> 16) - 1 };
    const i = (y & 31) * CHUNK + (x & 31);
    return { terrain: c.terrain[i]!, level: c.level[i]!, ore: c.ore[i]! - 1 };
  }

  /** Is this chunk already generated (renderer asks before painting)? */
  hasChunk(cx: number, cy: number): boolean {
    return !!this.chunks[cy * CHUNKS + cx];
  }

  terrain(x: number, y: number): number {
    if (!inWorld(x, y)) return T.DuneSea;
    const c = this.chunkAt(x >> 5, y >> 5);
    return c.terrain[(y & 31) * CHUNK + (x & 31)]!;
  }

  /** The land's level at a tile (D45); off the world, the floor's. */
  level(x: number, y: number): number {
    if (!inWorld(x, y)) return 0;
    const c = this.chunkAt(x >> 5, y >> 5);
    return c.level[(y & 31) * CHUNK + (x & 31)]!;
  }

  setLevel(x: number, y: number, v: number): void {
    const c = this.chunkAt(x >> 5, y >> 5);
    this.keepMade(c, tileIndex(x, y));
    c.level[(y & 31) * CHUNK + (x & 31)] = v;
    this.levelDiff.set(tileIndex(x, y), v);
    this.dirtyChunks.add((y >> 5) * CHUNKS + (x >> 5));
  }

  /** Deposit item index at a tile, or -1. */
  ore(x: number, y: number): number {
    if (!inWorld(x, y)) return -1;
    const c = this.chunkAt(x >> 5, y >> 5);
    return c.ore[(y & 31) * CHUNK + (x & 31)]! - 1;
  }

  /** Per-tile cap in mu per epoch (rich × 10). */
  capMuPerEpoch(x: number, y: number): number {
    if (!inWorld(x, y)) return 0;
    const c = this.chunkAt(x >> 5, y >> 5);
    return c.rich[(y & 31) * CHUNK + (x & 31)]! * 10;
  }

  setTerrain(x: number, y: number, t: number): void {
    const c = this.chunkAt(x >> 5, y >> 5);
    this.keepMade(c, tileIndex(x, y));
    c.terrain[(y & 31) * CHUNK + (x & 31)] = t;
    this.terrainDiff.set(tileIndex(x, y), t);
    this.dirtyChunks.add((y >> 5) * CHUNKS + (x >> 5));
  }

  setOre(x: number, y: number, item: number, rich: number): void {
    const c = this.chunkAt(x >> 5, y >> 5);
    this.keepMade(c, tileIndex(x, y));
    c.ore[(y & 31) * CHUNK + (x & 31)] = item + 1;
    c.rich[(y & 31) * CHUNK + (x & 31)] = rich;
    this.oreDiff.set(tileIndex(x, y), ((item + 1) << 16) | rich);
    this.dirtyChunks.add((y >> 5) * CHUNKS + (x >> 5));
  }

  occupant(x: number, y: number): number {
    return inWorld(x, y) ? this.occ[tileIndex(x, y)]! : -1;
  }
}

/** A flat test world: sand everywhere, with optional rectangular deposits and rock. */
export class FlatSource implements TerrainSource {
  constructor(
    readonly deposits: ReadonlyArray<{ x: number; y: number; w: number; h: number; item: number; rich: number }> = [],
    /** Rectangles of terrain `t`, at `level` (default: rock at its hardness, 1–4; anything else 0). */
    readonly rocks: ReadonlyArray<{ x: number; y: number; w: number; h: number; t: number; level?: number }> = [],
  ) {}

  fill(cx: number, cy: number, terrain: Uint8Array, ore: Uint8Array, rich: Uint16Array, _height?: Uint8Array, _biome?: Uint8Array, level?: Uint8Array): void {
    terrain.fill(T.Sand);
    level?.fill(0);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    for (const r of this.rocks) {
      const lv = r.level ?? (r.t >= T.Rock1 && r.t <= T.Rock4 ? r.t - T.Rock1 + 1 : 0);
      for (let y = Math.max(r.y, y0); y < Math.min(r.y + r.h, y0 + CHUNK); y++)
        for (let x = Math.max(r.x, x0); x < Math.min(r.x + r.w, x0 + CHUNK); x++) {
          terrain[(y - y0) * CHUNK + (x - x0)] = r.t;
          if (level) level[(y - y0) * CHUNK + (x - x0)] = lv;
        }
    }
    for (const d of this.deposits) {
      for (let y = Math.max(d.y, y0); y < Math.min(d.y + d.h, y0 + CHUNK); y++)
        for (let x = Math.max(d.x, x0); x < Math.min(d.x + d.w, x0 + CHUNK); x++) {
          ore[(y - y0) * CHUNK + (x - x0)] = d.item + 1;
          rich[(y - y0) * CHUNK + (x - x0)] = d.rich;
        }
    }
  }
}
