// readouts/core-door.ts — what waits at a door that will not take it in. The Core first (D139: no
// waste, slag or scrap, from any intake): the head of a ribbon line, a routing block or a machine
// handing straight into the Core, holding an item its accept set leaves out. Then a machine on a
// recipe whose line's head is an item the recipe does not take (a slag at the wire mill's door: the
// tutorial's « Les scories »). Such a thing never moves on, so its line has stopped behind it — the
// guide points there, the world hangs the refusal's badge over it (render/world/views-view.ts), the
// inspector says it on the line and on the Core. Read from the sim, never changing it.
import { Chain } from '../flow/chain';
import { ForkNode, MachineNode } from '../flow/nodes';
import type { Sim } from '../state';
import { WORLD } from '../constants';
import { DX, DY, type Rot } from '../types';
import { tileIndex } from '../world/grid';

export interface Refusal {
  /** The entity holding it: the head's ribbon, the routing block, the machine. */
  ent: number;
  /** Its world tile (a ribbon's head, the block's, the machine's origin). */
  tile: number;
  /** The item refused. */
  item: number;
  /** The way in from there (a ribbon's head, a block: the side it faces the door by; a machine's bin: −1). */
  dir: Rot | -1;
  /** Who refuses it: the Core, or a machine (its entity). */
  by: 'core' | number;
}

/** Everything held at one of the Core's intakes that it refuses, in its intakes' order (a few edges: it has twelve). */
export function coreRefusals(sim: Sim): Refusal[] {
  const g = sim.graph, h = g?.hearth;
  if (!g || !h || !h.accepts) return [];
  const out: Refusal[] = [];
  const hx = sim.ents.get(h.ent);
  for (const e of h.inE) {
    const s = g.nodes[g.eSrc[e]!]!;
    let item = -1, ent = 0, tile = -1, dir: Rot | -1 = -1;
    if (s instanceof Chain) {
      if (s.fluid || !s.cells.length) continue;
      item = s.itemAt(s.cells.length - 1);
      tile = s.lastTile;
      ent = sim.grid.occ[tile] ?? 0;
      dir = (sim.ents.get(ent)?.rot ?? -1) as Rot | -1;
    } else if (s instanceof ForkNode) {
      item = s.mu > 0 ? s.item : -1;
      ent = s.ent;
      const f = sim.ents.get(ent);
      if (f) { tile = tileIndex(f.x, f.y); dir = hx ? towards(f.x, f.y, hx.x, hx.y) : -1; }
    } else if (s instanceof MachineNode) {
      item = s.wBuf > 0 ? s.wItem : -1;
      ent = s.ent;
      const m = sim.ents.get(ent);
      if (m) tile = tileIndex(m.x, m.y);
    }
    if (item >= 0 && tile >= 0 && !h.accepts.has(item)) out.push({ ent, tile, item, dir, by: 'core' });
  }
  return out;
}

/**
 * The lines stopped at a machine's door: a ribbon whose head hands into a machine on a recipe that
 * does not take its item (a machine still waiting for its recipe is D83's state, not this). Walks
 * every line: the guide's and the views' pace (4 Hz), not every frame's.
 */
export function machineRefusals(sim: Sim): Refusal[] {
  const g = sim.graph;
  if (!g) return [];
  const out: Refusal[] = [];
  for (const c of g.chains) {
    if (c.fluid || !c.cells.length || c.outE.length !== 1) continue;
    const it = c.itemAt(c.cells.length - 1);
    if (it < 0) continue;
    const d = g.nodes[g.eDst[c.outE[0]!]!];
    if (!(d instanceof MachineNode) || !d.recipe || d.recipe.ins.some((s) => s.item === it)) continue;
    const tile = c.lastTile, ent = sim.grid.occ[tile] ?? 0;
    out.push({ ent, tile, item: it, dir: (sim.ents.get(ent)?.rot ?? -1) as Rot | -1, by: d.ent });
  }
  return out;
}

/** The way from tile (x, y) toward the Core (its origin at hx, hy: 5×5): the larger of the two offsets to its middle. */
function towards(x: number, y: number, hx: number, hy: number): Rot {
  const dx = hx + 2 - x, dy = hy + 2 - y;
  return (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0) as Rot;
}

/**
 * Is this ribbon line held at a door — it, or the plain ribbon it runs on into (no routing block
 * between), ends in the Core, or in a machine on a recipe, with an item that one refuses at its
 * head? That item and who refuses it, or null.
 */
export function refusedAt(sim: Sim, c: Chain | undefined): { item: number; by: 'core' | number } | null {
  const g = sim.graph, h = g?.hearth;
  if (!g) return null;
  for (let k = 0; c && !c.fluid && k < 64; k++) {
    if (c.outE.length !== 1) return null;
    const d = g.nodes[g.eDst[c.outE[0]!]!];
    if (d instanceof Chain) { c = d; continue; }
    const it = c.cells.length ? c.itemAt(c.cells.length - 1) : -1;
    if (it < 0) return null;
    if (d === h && h.accepts && !h.accepts.has(it)) return { item: it, by: 'core' };
    if (d instanceof MachineNode && d.recipe && !d.recipe.ins.some((s) => s.item === it)) return { item: it, by: d.ent };
    return null;
  }
  return null;
}

/** The tile point just at the door: the head tile's centre, half a tile on toward what refuses it. */
export function doorPoint(r: Refusal): [number, number] {
  const x = r.tile % WORLD, y = (r.tile - x) / WORLD;
  return r.dir < 0 ? [x + 0.5, y + 0.5] : [x + 0.5 + DX[r.dir]! * 0.5, y + 0.5 + DY[r.dir]! * 0.5];
}
