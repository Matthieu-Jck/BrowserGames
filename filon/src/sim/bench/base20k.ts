// base20k.ts — a seeded large benchmark colony (~20k entities): a lattice of cells, each a
// copper drill → ribbon → wire mill → ribbon → silo, with a pole wired (D25) to the
// cell's drill, mill and two wind turbines — one grid per cell. Built by direct insertion (no
// land/cost/range checks, wires included; every plan learnt; the land it covers granted) to
// measure the engine, not the rules.
import { buildingIdx, itemIdx, recipeIdx } from '@/content/registry';
import { FlatSource, tileIndex } from '../world/grid';
import { Sim } from '../state';
import { parcelAt } from '../world/land';
import { forTiles } from '../entities';
import { WORLD_EPOCH0 } from '../constants';
import { learnPlans } from '../testkit';
import type { Rot } from '../types';

export function benchSource(): FlatSource {
  return new FlatSource([{ x: 300, y: 300, w: 420, h: 420, item: itemIdx('copper_ore'), rich: 500 }]);
}

export function buildBench(cellsPerSide = 41): Sim {
  const sim = new Sim({ worldSeed: 3, playerSeed: 5, source: benchSource(), foundingEpoch: WORLD_EPOCH0 + 20 });
  const put = (def: string, x: number, y: number, rot: Rot, cfg = 0): number => {
    const e = sim.ents.add({ def: buildingIdx(def), x, y, rot, cfg, builtAt: 0 });
    forTiles(e, (tx, ty) => { sim.grid.occ[tileIndex(tx, ty)] = e.id; });
    return e.id;
  };
  const wire = recipeIdx('copper_wire') + 1;
  const x0 = 512 - (cellsPerSide * 8) / 2, y0 = 512 - (cellsPerSide * 8) / 2;
  for (let cy = 0; cy < cellsPerSide; cy++) {
    for (let cx = 0; cx < cellsPerSide; cx++) {
      const x = x0 + cx * 8, y = y0 + cy * 8;
      if (Math.abs(x + 4 - 512) < 8 && Math.abs(y + 4 - 512) < 8) continue; // keep the Hearth clear
      // Drill rot 1 (E): output at (x+1, y) facing (x+2, y).
      const drill = put('drill', x, y, 1);
      for (let i = 0; i < 2; i++) put('ribbon', x + 2 + i, y, 1);       // (x+2..x+3, y) → E
      const mill = put('wire_mill', x + 4, y, 1, wire);                  // 1×2 rotated E: occupies (x+4..x+5, y)
      for (let i = 0; i < 1; i++) put('ribbon', x + 6, y, 2);           // mill output E at (x+6,y) → S
      put('silo', x + 6, y + 1, 2);                                      // rot 2: an input port faces (x+6, y)
      const mast = put('mast', x + 3, y + 2, 0);
      const windA = put('wind_flower', x, y + 4, 0);
      const windB = put('wind_flower', x + 2, y + 4, 0);
      for (const id of [drill, mill, windA, windB]) sim.links.add(mast, id); // each within 1 tile of the mast
      for (let i = 0; i < 6; i++) put('ribbon', x + i, y + 6, 1);       // idle ribbons (background load)
    }
  }
  learnPlans(sim); // mills, silos and wind turbines are plans (D33): learnt, or they would stand dormant
  // The land it covers, granted (docs/land.md): off the claim's land, it would stand dormant too.
  for (const e of sim.ents.map.values()) forTiles(e, (tx, ty) => { const p = parcelAt(tx, ty); if (!sim.land.holds(p)) sim.land.granted.add(p); });
  return sim;
}
