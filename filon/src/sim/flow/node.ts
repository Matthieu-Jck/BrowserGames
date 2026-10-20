// node.ts — the flow-node contract and the per-tick context. A tick runs in phases over a
// compiled graph: A1 offers (per edge, from start-of-tick state), A2 accepts (each node
// splits its free room among its incoming offers), A3 splits (each node splits what it has
// among its outgoing edges, knowing what they accept), B transfers, C internal updates.
// Every allocation reads only start-of-tick state, so results never depend on node order.
// Splits: `allocRotating` (greedy, the first way in turn first), `shareFluid` (even, for a tee's water, D152).
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
  /** What the Hearth took in through its ports (milli-items): the HUD's rates (`Sim.hearthIn`). */
  hearthIn: Float64Array;
  /**
   * The Gleaners (D103): 1 while they are out (the dark hours: online from the world clock, in a
   * warm-up from its conditions), 0 by day. A ribbon's exposed cells lose a little to them then.
   */
  glean: number;
  /** What they took off the ribbons (milli-items, cumulative: `Sim.gleaned` online, a warm-up's own). */
  gleaned: Float64Array;
  /** Online only: each theft as it happens (tile, item, tick), for the views' figures and the lines' marks. */
  gleanLog?: number[];
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

/**
 * Water shared among the ways out of a tee (D152): `free` milli-items split evenly among edges `es`,
 * each capped by caps[e] (what that way takes this tick); a way that takes less than its share hands
 * the rest to the others, round after round, until the water is out or every way is full (max-min
 * fair). What does not divide evenly goes one milli-item a way in turn from `rot` (`now % n` online:
 * fair over n ticks, a short period for the catch-up). Integers in, integers out; writes out[e];
 * returns what was handed out. Every way gets some every tick it can take any, so each branch's
 * water stays one steady stream (a conduit's runs merge).
 */
export function shareFluid(es: readonly number[], rot: number, free: number, caps: Float64Array, out: Float64Array): number {
  const n = es.length;
  for (const e of es) out[e] = 0;
  let left = free;
  for (let round = 0; round <= n && left > 0; round++) {
    let open = 0;
    for (const e of es) if (out[e]! < caps[e]!) open++;
    if (!open) break;
    const share = Math.floor(left / open);
    if (share === 0) {
      // Less than a milli-item a way: one each, in turn from `rot`, while it lasts.
      for (let k = 0; k < n && left > 0; k++) {
        const e = es[(k + rot) % n]!;
        if (out[e]! < caps[e]!) { out[e] = out[e]! + 1; left--; }
      }
      break;
    }
    for (const e of es) {
      const a = Math.min(share, caps[e]! - out[e]!);
      if (a <= 0) continue;
      out[e] = out[e]! + a;
      left -= a;
    }
  }
  return free - left;
}
