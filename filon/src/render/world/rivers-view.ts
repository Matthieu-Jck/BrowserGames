// rivers-view.ts — the rivers' running water (D94): at near zooms, a short paper-white dash drifts
// down each river tile in view along the way it flows (the chunk's biome code: `RIVER_BIOME` + the
// eighth of a turn, mapgen's `BIOME.river`), fading in and out over its run, so a river reads as
// moving water beside the still lakes. On the ground plane in tile units (the `decals` layer, under
// the relief and the buildings), so it lies flat in plan and in iso alike. Cheap: the
// river tiles in view are found again only when the view moves by a block of 8 tiles, at most
// `MAX_DASHES` of them, and the dashes are three strokes a frame (three bands of alpha).
import { Graphics, type Container } from 'pixi.js';
import { hashUnit } from '@/core/hash';
import { CHUNK, WORLD } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { T } from '@/sim/types';
import { RIVER_BIOME } from '../art/terrain';

/** From this zoom on the water moves (the painted ripples carry the far zooms). */
const NEAR = 0.8;
/** Dashes drawn at most (the nearest view of a river holds a few hundred tiles). */
const MAX_DASHES = 900;
/** Tiles a second a dash drifts; the length of its run and of the dash itself (tiles). */
const SPEED = 0.55, RUN = 0.6, DASH = 0.26;
/** The way of each eighth of a turn (0 = east, 2 = south). */
const DIR: ReadonlyArray<readonly [number, number]> = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)] as const);

export class RiversView {
  private readonly g = new Graphics();
  /** The river tiles in view: x, y, way, and a phase in [0, 1) each. */
  private tiles: number[] = [];
  private sig = '';
  private t = 0;

  constructor(layer: Container) {
    layer.addChild(this.g);
  }

  /** Per frame: `view` the visible tile rect, `dt` seconds of running time (0 when paused). */
  update(sim: Sim, view: readonly [number, number, number, number], zoom: number, dt: number): void {
    const on = zoom >= NEAR;
    this.g.visible = on;
    if (!on) return;
    this.t += dt;
    const B = 8;
    const x0 = Math.max(0, Math.floor(view[0] / B) * B - B), y0 = Math.max(0, Math.floor(view[1] / B) * B - B);
    const x1 = Math.min(WORLD, Math.ceil(view[2] / B) * B + B), y1 = Math.min(WORLD, Math.ceil(view[3] / B) * B + B);
    const sig = `${x0},${y0},${x1},${y1}:${sim.grid.terrainDiff.size}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.tiles = [];
      const g = sim.grid;
      for (let y = y0; y < y1 && this.tiles.length < 4 * MAX_DASHES; y++) {
        for (let x = x0; x < x1; x++) {
          // The floor's rivers (a stream up on a massif stands on its column: the relief draws it).
          if (!g.hasChunk(x >> 5, y >> 5) || g.terrain(x, y) !== T.River || g.level(x, y) !== 0) continue;
          const way = g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * CHUNK + (x & 31)]! - RIVER_BIOME;
          this.tiles.push(x, y, way >= 0 && way < 8 ? way : 0, hashUnit(x, y, 0x3a1));
          if (this.tiles.length >= 4 * MAX_DASHES) break;
        }
      }
    }
    const g = this.g;
    g.clear();
    if (!this.tiles.length) return;
    // Three bands of alpha: a dash rising, at full, fading.
    for (let band = 0; band < 3; band++) {
      let any = false;
      for (let k = 0; k < this.tiles.length; k += 4) {
        const p = (this.t * SPEED / RUN + this.tiles[k + 3]!) % 1;
        if (Math.min(2, Math.floor(p * 3)) !== band) continue;
        const [ux, uy] = DIR[this.tiles[k + 2]!]!;
        const s = (p - 0.5) * RUN, cx = this.tiles[k]! + 0.5 + ux * s, cy = this.tiles[k + 1]! + 0.5 + uy * s;
        g.moveTo(cx - ux * DASH * 0.5, cy - uy * DASH * 0.5).lineTo(cx + ux * DASH * 0.5, cy + uy * DASH * 0.5);
        any = true;
      }
      if (any) g.stroke({ width: 0.07, color: 0xffffff, alpha: band === 1 ? 0.8 : 0.35, cap: 'round' });
    }
  }
}
