// readouts/water.ts — where the base can draw water (D114: water's first use, the steam boiler, in
// Tier 1). A pump stands on or beside water of its own level (systems/build.ts `touchesWater`): on the
// floor by a lake or a river, or up on the Crown by its tarn (D63). The guide's arrow for « La
// vapeur » (`GuideSpot` `water`, ui/guide.ts) and the debug bases' boiler (scenario-steam.ts) read the
// same spots: free tiles on the claim's land where a pump would draw, nearest the Core first. Read
// from the sim, never changing it; integers only.
import { buildingIdx } from '@/content/registry';
import { CENTER } from '../constants';
import type { Sim } from '../state';
import { isFloor, isRock, isWater, T } from '../types';
import { inWorld, tileIndex } from '../world/grid';

/** How far round the Core (tiles, square) the search looks: the starting square and a parcel past it. */
export const WATER_REACH = 64;

/** Does a pump on (x, y) draw water (water on its own level in its 8-neighbourhood)? */
export function drawsWater(sim: Sim, x: number, y: number): boolean {
  const lv = sim.grid.level(x, y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = x + dx, ty = y + dy;
      if (inWorld(tx, ty) && isWater(sim.grid.terrain(tx, ty)) && sim.grid.level(tx, ty) === lv) return true;
    }
  }
  return false;
}

/**
 * The tiles where a pump would draw water and may stand — free, seen, floor, rock or shallows, on
 * the claim's land — within `r` of (cx, cy), nearest first (squared distance, then y, then x: a
 * total order). At most `max`.
 */
export function waterSpots(sim: Sim, cx = CENTER, cy = CENTER, r = WATER_REACH, max = 64): Array<[number, number]> {
  const pump = buildingIdx('pump');
  const out: Array<[number, number, number]> = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inWorld(x, y) || sim.grid.occ[tileIndex(x, y)] !== 0 || !sim.revealed(x, y)) continue;
      const t = sim.grid.terrain(x, y);
      if (!(isFloor(t) || isRock(t) || t === T.Shallow) || !drawsWater(sim, x, y)) continue;
      if (!sim.land.coversFootprint(pump, x, y, 0)) continue;
      out.push([x, y, (x - cx) * (x - cx) + (y - cy) * (y - cy)]);
    }
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.slice(0, max).map(([x, y]) => [x, y]);
}

/** The nearest such spot to the Core (null: no water within reach on the claim's land). */
export function nearestWater(sim: Sim): [number, number] | null {
  return waterSpots(sim, CENTER, CENTER, WATER_REACH, 1)[0] ?? null;
}
