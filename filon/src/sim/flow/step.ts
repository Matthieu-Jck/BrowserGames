// step.ts — one engine tick over a set of nodes (the whole graph online, one group during an
// offline warm-up). Phases: A1 offers → A2 accepts → A3 splits → B transfers → C updates.
// Accepts run in `accOrder` (compile's `acceptOrder`): every node but the ribbons first, then the
// ribbons downstream first, so a full ribbon knows whether its head is taken this step before it
// says whether its first tile is free (chain.ts: a line moves as one block across its joins).
import type { Graph } from '../graph/compile';
import type { FNode, TickCtx } from './node';

export function runPhases(g: Graph, nodes: readonly FNode[], ctx: TickCtx, accOrder: readonly FNode[] = nodes): void {
  const { eSrc, eSrcPort, eDstPort } = g;
  const all = g.nodes;
  // A1 — offers on every out-edge of the nodes being stepped.
  for (const n of nodes) {
    for (const e of n.outE) n.offer(e, eSrcPort[e]!, ctx);
  }
  // A2 — accepts (ribbons downstream first).
  for (const n of accOrder) if (n.inE.length) n.accept(ctx);
  // A3 — splits.
  for (const n of nodes) if (n.outE.length) n.split(ctx);
  // B — transfers, destination by destination in priority order (deterministic FIFO order).
  for (const d of nodes) {
    for (const e of d.inE) {
      const q = ctx.q[e]!;
      if (q <= 0) continue;
      const item = ctx.offItem[e]!;
      ctx.edge = e;
      all[eSrc[e]!]!.take(eSrcPort[e]!, item, q, ctx);
      d.give(eDstPort[e]!, item, q, ctx);
    }
  }
  // C — internal updates.
  for (const n of nodes) n.update(ctx);
}

/** Allocate per-edge scratch arrays for a graph. */
export function makeCtx(g: Graph, nNets: number, nItems: number): TickCtx {
  const n = Math.max(1, g.nE);
  return {
    now: 0,
    sat: new Int32Array(Math.max(1, nNets)),
    dispatch: new Int32Array(Math.max(1, nNets)),
    offItem: new Int32Array(n).fill(-1),
    offMu: new Float64Array(n),
    acc: new Float64Array(n),
    q: new Float64Array(n),
    eSrcPort: g.eSrcPort,
    eDstPort: g.eDstPort,
    produced: new Float64Array(nItems),
    consumed: new Float64Array(nItems),
    hearthIn: new Float64Array(nItems),
  };
}
