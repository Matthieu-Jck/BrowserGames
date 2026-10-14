// node.ts — the flow-node contract and the per-tick context. A tick runs in phases over a
// compiled graph: A1 offers (per edge, from start-of-tick state), A2 accepts (each node
// splits its free room among its incoming offers), A3 splits (each node splits what it has
// among its outgoing edges, knowing what they accept), B transfers, C internal updates.
// Every allocation reads only start-of-tick state, so results never depend on node order.
import type { StateHasher } from '@/core/hash';
import { St } from '../types';

export interface TickCtx {
  now: number;
  /** Per power network: satisfaction ‰ and fuel-generator dispatch ‰ this tick. */
  sat: Int32Array;
  dispatch: Int32Array;
  /** Per edge, filled by the phases. */
  offItem: Int32Array;
  offMu: Float64Array;
  acc: Float64Array;
  q: Float64Array;
  eSrcPort: Int32Array;
  eDstPort: Int32Array;
  /** Item counters for statistics (milli-items). */
  produced: Float64Array;
  consumed: Float64Array;
  /** The edge being transferred (phase B, for `give`: a ribbon notes where an item came from). */
  edge?: number;
}

export type NodeKind =
  | 'chain' | 'machine' | 'drill' | 'reservoir' | 'fork' | 'generator' | 'consumer' | 'sink';

export abstract class FNode {
  abstract readonly kind: NodeKind;
  /** Index in graph.nodes (assigned at compile). */
  idx = -1;
  /** Incoming edges in priority order; outgoing edges in port order. */
  inE: number[] = [];
  outE: number[] = [];
  /** Power network index (-1 = not connected). */
  net = -1;
  group = -1;
  status: number = St.Ok;
  /** Draws power at all? */
  kw = 0;
  idleKw = 0;

  constructor(readonly ent: number) {}

  /** A1 — what this node offers on edge e (out port `port`): sets ctx.offItem/offMu. */
  offer(e: number, _port: number, ctx: TickCtx): void {
    ctx.offItem[e] = -1;
    ctx.offMu[e] = 0;
  }

  /** A2 — split free room among incoming offers: sets ctx.acc for each e in inE. */
  accept(ctx: TickCtx): void {
    for (const e of this.inE) ctx.acc[e] = 0;
  }

  /** A3 — split what is available among outgoing edges: sets ctx.q for each e in outE. */
  split(ctx: TickCtx): void {
    for (const e of this.outE) ctx.q[e] = Math.min(ctx.offMu[e]!, ctx.acc[e]!);
  }

  take(_port: number, _item: number, _mu: number, _ctx: TickCtx): void {}
  give(_port: number, _item: number, _mu: number, _ctx: TickCtx): void {}
  update(_ctx: TickCtx): void {}

  /** Power drawn this tick (kW), from the last tick's status. */
  demand(): number {
    return 0;
  }

  /** Internal state hash (no absolute ticks: relative to `now`). */
  abstract hash(h: StateHasher, now: number): void;
  /** Deep copy of the internal state; restore shifts absolute ticks by `shift`. */
  abstract snapshot(): unknown;
  abstract restore(s: unknown, shift: number): void;
}

/**
 * Greedy allocation of `free` among edges `es` (rotated by `rot` for fairness over time),
 * each capped by caps[e]; writes into out[e]. Returns what was handed out.
 */
export function allocRotating(es: readonly number[], rot: number, free: number, caps: Float64Array, out: Float64Array): number {
  const n = es.length;
  let given = 0;
  for (let k = 0; k < n; k++) {
    const e = es[(k + rot) % n]!;
    const a = free - given <= 0 ? 0 : Math.min(caps[e]!, free - given);
    out[e] = a > 0 ? a : 0;
    given += out[e]!;
  }
  return given;
}
