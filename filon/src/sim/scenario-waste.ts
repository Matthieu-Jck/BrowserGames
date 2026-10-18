// scenario-waste.ts — the debug bases' answer to the machines' waste (D125): on a laid line that
// carries a machine's product and its waste (slag, scrap) into a consumer that takes only the
// product, a sorter set to the product keeps it straight on and an incinerator on one of its sides
// takes the rest — what a player learns in « Les scories ». Laid through commands (logged and
// replayed like a player's build), tried from the line's start, each try taken back up whole when it
// does not work: the sorter stands on a straight tile (fed from behind, so its front is the line's
// way on), the pit on a free side, and the compiled graph must show one way in, one straight on and
// one aside — the other side dealing into nothing. Where a router branches a mixed line into such a
// consumer, its side toward it is filtered to the product instead (`filterFeed`): the waste goes on.
import { BUILDING_KIND } from '@/content/registry';
import { checkpoint, rollback } from './dev';
import { ForkNode } from './flow/nodes';
import type { Sim } from './state';
import { DX, DY, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';

/** The sorter and the pit laid on a line, by id. */
export interface WasteSort { readonly sorter: number; readonly pit: number }

/**
 * A sorter keeping `keep` straight on along `line` (its tiles in order, from the producer), its
 * other items aside into an incinerator: on the first tile from `from` where it works. The plans
 * must be learnt and the costs in the Core (the caller affords them). Null: no tile took it.
 */
export function sortWaste(sim: Sim, line: ReadonlyArray<readonly [number, number, Rot]>, keep: string, from = 0): WasteSort | null {
  for (let k = from; k < line.length; k++) {
    const [x, y, r] = line[k]!;
    const o = sim.entityAt(x, y);
    if (!o || BUILDING_KIND[o.def] !== 'belt' || o.rot !== r) continue;
    if (sim.placementRot('sorter', x, y, r) !== r) continue; // a bend: its side would take the way on
    for (const side of [((r + 3) & 3) as Rot, ((r + 1) & 3) as Rot]) {
      const sx = x + DX[side]!, sy = y + DY[side]!;
      if (!inWorld(sx, sy) || sim.grid.occ[tileIndex(sx, sy)] !== 0) continue;
      const cp = checkpoint(sim);
      const s = sim.place('sorter', x, y, r);
      if (s.ok && sim.setForkFilter(s.id!, 0, keep)) {
        const p = sim.place('incinerator', sx, sy, 0);
        if (p.ok) {
          sim.ensureCompiled();
          const n = sim.graph.nodeByEnt.get(s.id!);
          if (n instanceof ForkNode && n.inE.length === 1 && n.fronts.length === 1 && n.sides.length === 1) return { sorter: s.id!, pit: p.id! };
        }
      }
      rollback(sim, cp);
    }
  }
  return null;
}

/**
 * The routers that branch a line into building `consumer` (walking up its input lines, through plain
 * ribbon, to the first routing block): each one's side toward it filtered to `keep`, so the waste
 * the line carries goes on past it instead of jamming the branch at the consumer's door (D125).
 * `on`: only the routers standing on these lines' tiles (D129: the assembly bench's plate branch
 * filtered, its wire branch left alone). Whether any was set.
 */
export function filterFeed(sim: Sim, consumer: number, keep: string, on?: ReadonlyArray<ReadonlyArray<readonly [number, number, unknown]>>): boolean {
  sim.ensureCompiled();
  const g = sim.graph, dst = g.nodeByEnt.get(consumer);
  if (!dst) return false;
  const sides: Array<[number, Rot]> = [];
  for (const e0 of dst.inE) {
    let e = e0;
    for (let guard = 0; guard < 256; guard++) {
      const src = g.nodes[g.eSrc[e]!]!;
      if (src instanceof ForkNode) {
        if (src.mode === 'router' || src.mode === 'distributor') sides.push([src.ent, (g.eSrcPort[e]! % 4) as Rot]);
        break;
      }
      if (src.kind !== 'chain' || src.inE.length !== 1) break;
      e = src.inE[0]!;
    }
  }
  const at = on ? new Set(on.flatMap((l) => l.map(([x, y]) => tileIndex(x, y)))) : null;
  const kept = at ? sides.filter(([id]) => { const r = sim.ents.get(id); return !!r && at.has(tileIndex(r.x, r.y)); }) : sides;
  for (const [id, side] of kept) sim.setForkFilter(id, side, keep);
  return kept.length > 0;
}
