// ore-blocks.ts — the deposits' grid (map 4, D104; owner, 2026-10-17: « dans le cirque, c'est un
// peu frustrant comme les ressources disponibles ne sont pas des multiples de la taille des
// machines qui les extraient »). On a land whose deposits come in whole blocks (`TerrainSource.
// oreBlock`: 2, a drill's footprint; mapgen.ts `blocksOf`), a drill whose footprint is whole blocks
// — the 2×2 drills, the 4×4 giant, not the 3×3 deep bore — fits a deposit with none of its tiles
// left over when it stands on the blocks' grid. Held over ore, it snaps there (the ghost, tools.ts
// `snapOrigin`), and the debug bases' drill search tries those spots first (dev.ts `spotsNear`).
// Pure helpers over the grid, integers only.
import { buildingDef } from '@/content/registry';
import { footprint } from './entities';
import { isFaceOre } from './face';
import type { Rot } from './types';
import type { Grid } from './world/grid';

/** The land's block (1: tile by tile, maps 1–3). */
export const oreBlockOf = (g: Grid): number => g.source.oreBlock ?? 1;

/** Does building `def` turned `rot` mine deposits with a footprint of whole `B` × `B` blocks? */
export function blockDrill(def: number, rot: Rot, B: number): boolean {
  const d = buildingDef(def).drill;
  if (B <= 1 || !d || d.ground || d.face) return false;
  const [w, h] = footprint(def, rot);
  return w % B === 0 && h % B === 0;
}

/** Is (x, y) a corner of the blocks' grid? */
export const onBlockGrid = (x: number, y: number, B: number): boolean => x % B === 0 && y % B === 0;

/**
 * Where building `def` (corner x, y, turned `rot`) snaps held over a deposit: a block drill on a
 * land of blocks moves its corner down to the grid (which keeps the tile under the cursor beneath
 * it: a footprint is at least a block wide) when its footprint there covers ore; anything else,
 * or off the ore, stays where it is.
 */
export function oreSnap(g: Grid, def: number, x: number, y: number, rot: Rot): [number, number] {
  const B = oreBlockOf(g);
  if (!blockDrill(def, rot, B)) return [x, y];
  const sx = x - (((x % B) + B) % B), sy = y - (((y % B) + B) % B);
  const [w, h] = footprint(def, rot);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = g.ore(sx + i, sy + j);
    if (o >= 0 && !isFaceOre(o)) return [sx, sy];
  }
  return [x, y];
}
