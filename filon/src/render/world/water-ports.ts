// water-ports.ts — where the water meets the buildings, read from the sim for the views (D142;
// the art: art/pipe-ports.ts). Two questions, both asked at each structural rebuild (they are part
// of an entity's drawing signature, buildings-view.ts `sigOf`):
//
// - **Which entrance of a water drinker wears the pipework** (`wetEntranceOf`): what joins each of
//   its entrances in the compiled graph — water (a conduit, or a pump's outlet set straight against
//   it), a dry line (a ribbon, another machine's outlet) or nothing — through `wetEntrance`. The
//   engine lets either entrance take water (D114), so a base that waters the other one wears the
//   variant the atlas bakes for it.
// - **Which edges of a conduit tile meet a port** (`couplingSides`): a building's port opening onto
//   the tile across that edge, that the conduit joins — it flows out through that edge into an
//   intake, or comes in from an outlet there (any way but back into it, as the compile joins them).
//   Each gets the coupling piece. Geometry only (the entities and their ports), so it holds for a
//   ribbon-looking hatch as well: wherever water meets a port, the joint is a pipe joint.
import { BUILDING_KIND, buildingDef } from '@/content/registry';
import { worldPorts } from '@/sim/entities';
import type { Chain } from '@/sim/flow/chain';
import type { Sim } from '@/sim/state';
import { DX, DY, opposite, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import { WORLD } from '@/sim/constants';
import { DRY, WET, homeEntrance, wetEntrance } from '../art/pipe-ports';

/** The entrance a water drinker's pipework is drawn on (a port index), −1 for its own or a building that drinks no water. */
export function wetEntranceOf(sim: Sim, e: Ent): number {
  const def = buildingDef(e.def);
  if (homeEntrance(def) < 0) return -1;
  const g = sim.graph, node = g?.nodeByEnt.get(e.id);
  if (!g || !node) return -1;
  const joined = new Int8Array(def.ports.length);
  for (const ed of node.inE) {
    const port = g.eDstPort[ed]!, src = g.nodes[g.eSrc[ed]!]!;
    const wet = src.kind === 'chain' ? (src as Chain).fluid : BUILDING_KIND[sim.ents.get(src.ent)?.def ?? -1] === 'pump';
    if (port >= 0 && port < joined.length) joined[port] = Math.max(joined[port]!, wet ? WET : DRY);
  }
  return wetEntrance(def, (i) => joined[i]!);
}

/** The edges of conduit `e`'s tile (a mask of sides, bit `1 << side`) where it couples to a building's port. */
export function couplingSides(sim: Sim, e: Ent): number {
  let mask = 0;
  for (let s = 0; s < 4; s++) {
    const nx = e.x + DX[s]!, ny = e.y + DY[s]!;
    if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) continue;
    const b = sim.ents.get(sim.grid.occ[tileIndex(nx, ny)]!);
    if (!b || b.id === e.id || !buildingDef(b.def).ports.length) continue;
    const kind = BUILDING_KIND[b.def];
    if (kind === 'belt' || kind === 'conduit' || kind === 'bridge') continue;
    for (const p of worldPorts(b)) {
      if (p.fx !== e.x || p.fy !== e.y || p.dir !== opposite(s as Rot)) continue;
      // An intake takes the conduit flowing out through this edge; an outlet feeds it unless it runs back into it.
      if (p.io === 'in' ? e.rot === s : e.rot !== s) mask |= 1 << s;
    }
  }
  return mask;
}
