// steady.ts — warm-ups for the offline catch-up. A group is stepped with the SAME tick code
// as online play, its boundary reservoirs in virtual mode (behaving per their state flags,
// recording flows instead of changing levels) and its power fixed. We hash the group's
// internal state every tick; the first repeat gives an exact period p after a transient t1.
// Flows over [0, t1] and over one period are recorded tick by tick, so the group's boundary
// flows after any elapsed time e are known exactly: transient + ⌊(e−t1)/p⌋ periods + prefix.
import { N_ITEMS as ITEM_COUNT } from '@/content/registry';
import { StateHasher } from '@/core/hash';
import { PERIOD_MAX } from '../constants';
import type { Graph } from '../graph/compile';
import type { Group } from '../graph/groups';
import { runPhases } from '../flow/step';
import type { FNode, TickCtx } from '../flow/node';
import { V_EMPTY as EMPTY, V_FULL as FULL, V_NORMAL as NORMAL, type ReservoirNode } from '../flow/nodes';
import { St } from '../types';

// Module copies of the constants the loops below read (D137): under vitest, where the tests and
// the bench run, an imported binding is a getter call at every read, and a week's warm-ups and
// keys read these millions of times. (A bundle reads them directly either way.)
const N_ITEMS = ITEM_COUNT, V_EMPTY = EMPTY, V_FULL = FULL, V_NORMAL = NORMAL;

export const WARM_MAX = 2 * PERIOD_MAX;
/** When no exact period shows up, settle this long, then average over the rest. */
const AVG_SETTLE = 1200;

/** Group state: its nodes, plus the virtual pools of its boundary reservoirs (aligned with grp.res). */
export interface GroupSnap { tick: number; states: unknown[]; pools: unknown[] | null }

export function snapGroup(grp: Group, tick: number, res: ReservoirNode[] | null = null): GroupSnap {
  return { tick, states: grp.nodes.map((n) => n.snapshot()), pools: res ? res.map((r) => r.snapshot()) : null };
}

export function restoreGroup(grp: Group, s: GroupSnap, tick: number): void {
  const shift = tick - s.tick;
  grp.nodes.forEach((n, i) => n.restore(s.states[i], shift));
}

/**
 * A reservoir's items that are not NORMAL for a group, ascending, each with its state (V_*) and
 * throttle rate (mu/epoch); every other item is NORMAL. Sparse (D137): a group watches an item or
 * two of a store, and a condition is built at every new power mode of its grid.
 */
export interface ResCond { items: number[]; state: number[]; rate: number[] }

/** Conditions a regime was computed under (part of its key). */
export interface Cond {
  /** Per touched reservoir index: its items not NORMAL (`ResCond`). */
  res: Map<number, ResCond>;
  /** Per net: satisfaction ‰ and dispatch ‰. */
  sat: Map<number, number>;
  disp: Map<number, number>;
  /** The Gleaners are out (D103: the dark hours) — only ever set for a group they take from (`Group.glean`). */
  night?: boolean;
}

/** Is it the Gleaners' night for this group under these conditions? */
const nightFor = (grp: Group, c: Cond): boolean => !!c.night && grp.glean;
/** The ticks over which the phase of `now` matters to this group: its rotations and beats, and the Gleaners' window at night (D103). */
export const rotOf = (grp: Group, c: Cond): number => (nightFor(grp, c) ? grp.rotNight : grp.rotL);

export function condKey(grp: Group, c: Cond, modsKey: string): string {
  const parts: string[] = [grp.sig, modsKey];
  if (nightFor(grp, c)) parts.push('night');
  for (const n of grp.nets) parts.push(`n${n}:${c.sat.get(n) ?? 1000}:${c.disp.get(n) ?? 0}`);
  for (const ri of grp.res) {
    const rc = c.res.get(ri);
    if (!rc) continue;
    let s = `r${ri}:`;
    for (let j = 0; j < rc.items.length; j++) s += `${rc.items[j]}.${rc.state[j]}.${Math.round(rc.rate[j]!)},`;
    parts.push(s);
  }
  return parts.join('|');
}

/** A computed regime: transient then exact period (or an averaged window when approx). */
export interface Regime {
  key: string;
  exact: boolean;
  t1: number;
  p: number;
  /** Reservoir keys (ri * N_ITEMS + item) with any flow. */
  keys: number[];
  /** Per key: cumulative net inflow at each tick of the transient (length t1+1) and period (p+1). */
  prefT: Float64Array[];
  prefP: Float64Array[];
  /** Per key per period: gross inflow and outflow (for throttles). */
  inP: Float64Array;
  outP: Float64Array;
  /** Per net (aligned with group.nets): average and max demand over the period (kW). */
  dAvg: number[];
  dMax: number[];
  /** Per generator (aligned with group.gens): ‰ of period ticks it had fuel. */
  fueled: number[];
  /** Items produced / consumed: over the transient and per period. */
  prodT: Float64Array;
  consT: Float64Array;
  prodP: Float64Array;
  consP: Float64Array;
  /**
   * Items with any production or consumption, and per item their cumulative production and
   * consumption at each tick of the transient (t1+1) and of the period (p+1): the statistics
   * follow the regime exactly, transient included, like the reservoir flows (`statAt`).
   */
  statItems: number[];
  prodSeries: Array<[Float64Array, Float64Array]>;
  consSeries: Array<[Float64Array, Float64Array]>;
  /** What the Gleaners took (D103), the same way: items taken, and per item over the transient and the period (`gleanAt`). */
  gleanItems: number[];
  gleanSeries: Array<[Float64Array, Float64Array]>;
  s0: GroupSnap;
  s1: GroupSnap;
  warmTicks: number;
}

/** Scratch shared across warm-ups (avoids reallocating big buffers). */
export class Scratch {
  cum = new Float64Array(0);
  private dem = new Float64Array(0);
  private fu = new Uint8Array(0);
  ensure(n: number): Float64Array {
    if (this.cum.length < n) this.cum = new Float64Array(n);
    return this.cum;
  }
  demandBuf(n: number): Float64Array {
    if (this.dem.length < n) this.dem = new Float64Array(n);
    return this.dem;
  }
  fuelBuf(n: number): Uint8Array {
    if (this.fu.length < n) this.fu = new Uint8Array(n);
    return this.fu;
  }
}

/** Puts the group's boundary reservoirs into virtual mode for the duration of a warm-up. */
class Virtualizer {
  private saved: Array<{ r: ReservoirNode; inE: number[]; outE: number[] }> = [];
  constructor(private readonly g: Graph, private readonly grp: Group) {}

  /**
   * Virtual pools start from the true remainder (stock for EMPTY items, room for FULL ones)
   * — so a warm-up drains / fills the last bit exactly like online play — or from a snapshot.
   */
  enter(c: Cond, pools: unknown[] | null = null): ReservoirNode[] {
    const out: ReservoirNode[] = [];
    this.grp.res.forEach((ri, k) => {
      const r = this.g.reservoirs[ri]!;
      this.saved.push({ r, inE: r.inE, outE: r.outE });
      const rc = c.res.get(ri);
      r.vState.fill(V_NORMAL);
      r.vRate.fill(0);
      r.vActive = [];
      if (rc) {
        for (let j = 0; j < rc.items.length; j++) {
          const i = rc.items[j]!;
          r.vState[i] = rc.state[j]!;
          r.vRate[i] = rc.rate[j]!;
          if (rc.state[j] !== V_NORMAL) r.vActive.push(i);
        }
      }
      r.vPool.fill(0); r.vCarry.fill(0); r.vIn.fill(0); r.vOut.fill(0);
      if (pools) r.restore(pools[k]);
      else {
        for (let i = 0; i < N_ITEMS; i++) {
          if (r.vState[i] === V_EMPTY) r.vPool[i] = Math.max(0, r.stock[i]!);
          else if (r.vState[i] === V_FULL) r.vPool[i] = Math.max(0, r.capOf(i) - r.stock[i]!);
        }
      }
      r.inE = this.grp.resIn.get(ri) ?? [];
      r.outE = this.grp.resOut.get(ri) ?? [];
      r.virtual = true;
      out.push(r);
    });
    return out;
  }

  exit(): void {
    for (const s of this.saved) { s.r.inE = s.inE; s.r.outE = s.outE; s.r.virtual = false; s.r.vActive = []; }
    this.saved = [];
  }
}

/** The warm-up's fixed conditions into the tick's context: each grid's power, and whether the Gleaners are out (D103). */
function setPower(ctx: TickCtx, grp: Group, c: Cond): void {
  for (const n of grp.nets) {
    ctx.sat[n] = c.sat.get(n) ?? 1000;
    ctx.dispatch[n] = c.disp.get(n) ?? 0;
  }
  ctx.glean = nightFor(grp, c) ? 1 : 0;
}

const hasher = new StateHasher();
function hashState(grp: Group, res: ReservoirNode[], now: number, L: number): number {
  const h = hasher.reset();
  h.int(L > 1 ? now % L : 0);
  for (const n of grp.nodes) n.hash(h, now);
  for (const r of res) r.hash(h);
  return h.key53();
}

/** Step a group `ticks` times from tick `now` under conditions `c` (state is mutated). */
export function stepGroup(g: Graph, grp: Group, ctx: TickCtx, c: Cond, now: number, ticks: number, pools: unknown[] | null = null): void {
  // Nothing to step, no virtual session (D137): a regime ending on its period's start — the
  // common case, segments being whole minutes — is its snapshot alone. The virtual fields are
  // set afresh by every session and read only inside one, so skipping it changes nothing.
  if (ticks <= 0) return;
  const v = new Virtualizer(g, grp);
  const res = v.enter(c, pools);
  const stepNodes: FNode[] = [...grp.nodes, ...res];
  const accNodes: FNode[] = [...res, ...grp.accOrder];
  setPower(ctx, grp, c);
  for (let t = 0; t < ticks; t++) {
    ctx.now = now + t;
    for (const r of res) r.vTick();
    runPhases(g, stepNodes, ctx, accNodes);
  }
  v.exit();
}

/**
 * Walk a group along from tick `now` under conditions `c`, `every` ticks at a time, asking `visit`
 * at each stop (before the first step too) whether to stop; at most `max` ticks. One virtual
 * session for the whole walk (the catch-up looks into a cached cycle this way).
 */
export function scanGroup(g: Graph, grp: Group, ctx: TickCtx, c: Cond, now: number, every: number, max: number, visit: (at: number) => boolean): void {
  // The first stop is asked before any virtual session (D137): a jump that finds its point
  // there — most do — sets none up. The same stops and steps as one loop over them.
  if (visit(0) || every > max) return;
  const v = new Virtualizer(g, grp);
  const res = v.enter(c);
  const stepNodes: FNode[] = [...grp.nodes, ...res];
  const accNodes: FNode[] = [...res, ...grp.accOrder];
  setPower(ctx, grp, c);
  for (let at = 0; ;) {
    for (let t = 0; t < every; t++) {
      ctx.now = now + at + t;
      for (const r of res) r.vTick();
      runPhases(g, stepNodes, ctx, accNodes);
    }
    at += every;
    if (visit(at) || at + every > max) break;
  }
  v.exit();
}

/**
 * Warm a group up from its current state at tick `now`. The group's node states are left as
 * they were (restored to S0) — the caller advances the timeline analytically.
 */
export function warmUp(g: Graph, grp: Group, ctx: TickCtx, c: Cond, now: number, key: string, scratch: Scratch): Regime {
  const v = new Virtualizer(g, grp);
  const res = v.enter(c);
  const s0 = snapGroup(grp, now, res);
  const stepNodes: FNode[] = [...grp.nodes, ...res];
  const accNodes: FNode[] = [...res, ...grp.accOrder];
  setPower(ctx, grp, c);
  ctx.produced.fill(0);
  ctx.consumed.fill(0);
  ctx.gleaned.fill(0);
  const L = rotOf(grp, c);

  const nRes = res.length;
  const width = nRes * N_ITEMS;
  // Cumulative per tick: gross inflow and outflow per (reservoir, item), production, consumption, the Gleaners' takings.
  const rows = WARM_MAX + 1;
  const buf = scratch.ensure(rows * (2 * width + 3 * N_ITEMS));
  const cIn = 0, cOut = rows * width, cProd = 2 * rows * width, cCons = cProd + rows * N_ITEMS, cGlean = cCons + rows * N_ITEMS;
  // Rows are written as they are simulated; only row 0 needs clearing.
  buf.fill(0, cIn, cIn + width); buf.fill(0, cOut, cOut + width);
  buf.fill(0, cProd, cProd + N_ITEMS); buf.fill(0, cCons, cCons + N_ITEMS); buf.fill(0, cGlean, cGlean + N_ITEMS);
  const seen = new Map<number, number>();
  seen.set(hashState(grp, res, now, L), 0);
  const nNets = grp.nets.length, nGens = grp.gens.length;
  const demand = scratch.demandBuf(rows * Math.max(1, nNets));
  const fuel = scratch.fuelBuf(rows * Math.max(1, nGens));
  let t1 = -1, p = 0, t = 0;

  for (t = 1; t <= WARM_MAX; t++) {
    ctx.now = now + t - 1;
    for (const r of res) r.vTick();
    runPhases(g, stepNodes, ctx, accNodes);
    for (let k = 0; k < nRes; k++) {
      const r = res[k]!;
      const o = t * width + k * N_ITEMS;
      for (let i = 0; i < N_ITEMS; i++) { buf[cIn + o + i] = r.vIn[i]!; buf[cOut + o + i] = r.vOut[i]!; }
    }
    buf.set(ctx.produced, cProd + t * N_ITEMS);
    buf.set(ctx.consumed, cCons + t * N_ITEMS);
    buf.set(ctx.gleaned, cGlean + t * N_ITEMS);
    for (let j = 0; j < nNets; j++) {
      const net = grp.nets[j]!;
      let d = 0;
      for (const node of grp.nodes) if (node.net === net) d += node.demand();
      demand[t * nNets + j] = d;
    }
    for (let j = 0; j < nGens; j++) fuel[t * nGens + j] = grp.gens[j]!.status === St.NoFuel ? 0 : 1;
    const h = hashState(grp, res, now + t, L);
    const prev = seen.get(h);
    if (prev !== undefined) { t1 = prev; p = t - prev; break; }
    seen.set(h, t);
  }
  let exact = true;
  if (t1 < 0) {
    // No exact repeat: settle, then treat the rest as one long averaged "period".
    exact = false;
    t1 = AVG_SETTLE;
    p = WARM_MAX - AVG_SETTLE;
  }
  // The state now (tick t1 + p) equals the state at t1: it is the period's start state.
  const s1 = snapGroup(grp, now + t1 + p, res);
  v.exit();
  restoreGroup(grp, s0, now);

  const t2 = t1 + p;
  const keys: number[] = [];
  const prefT: Float64Array[] = [];
  const prefP: Float64Array[] = [];
  const inP: number[] = [], outP: number[] = [];
  for (let k = 0; k < nRes; k++) {
    for (let i = 0; i < N_ITEMS; i++) {
      const col = k * N_ITEMS + i;
      const gin = buf[cIn + t2 * width + col]!, gout = buf[cOut + t2 * width + col]!;
      if (gin === 0 && gout === 0) continue;
      keys.push(grp.res[k]! * N_ITEMS + i);
      const net = (tt: number): number => buf[cIn + tt * width + col]! - buf[cOut + tt * width + col]!;
      const a = new Float64Array(t1 + 1);
      for (let tt = 0; tt <= t1; tt++) a[tt] = net(tt);
      const b = new Float64Array(p + 1);
      const base = net(t1);
      for (let tt = 0; tt <= p; tt++) b[tt] = net(t1 + tt) - base;
      prefT.push(a);
      prefP.push(b);
      inP.push(gin - buf[cIn + t1 * width + col]!);
      outP.push(gout - buf[cOut + t1 * width + col]!);
    }
  }
  const prodT = buf.slice(cProd + t1 * N_ITEMS, cProd + (t1 + 1) * N_ITEMS);
  const consT = buf.slice(cCons + t1 * N_ITEMS, cCons + (t1 + 1) * N_ITEMS);
  const prodP = new Float64Array(N_ITEMS), consP = new Float64Array(N_ITEMS);
  for (let i = 0; i < N_ITEMS; i++) {
    prodP[i] = buf[cProd + t2 * N_ITEMS + i]! - prodT[i]!;
    consP[i] = buf[cCons + t2 * N_ITEMS + i]! - consT[i]!;
  }
  const statItems: number[] = [];
  for (let i = 0; i < N_ITEMS; i++) if (buf[cProd + t2 * N_ITEMS + i] || buf[cCons + t2 * N_ITEMS + i]) statItems.push(i);
  const series = (col: number, i: number): [Float64Array, Float64Array] => {
    const T = new Float64Array(t1 + 1);
    for (let tt = 0; tt <= t1; tt++) T[tt] = buf[col + tt * N_ITEMS + i]!;
    const P = new Float64Array(p + 1);
    const base = T[t1]!;
    for (let tt = 0; tt <= p; tt++) P[tt] = buf[col + (t1 + tt) * N_ITEMS + i]! - base;
    return [T, P];
  };
  const prodSeries = statItems.map((i) => series(cProd, i)), consSeries = statItems.map((i) => series(cCons, i));
  const gleanItems: number[] = [];
  for (let i = 0; i < N_ITEMS; i++) if (buf[cGlean + t2 * N_ITEMS + i]) gleanItems.push(i);
  const gleanSeries = gleanItems.map((i) => series(cGlean, i));
  const dAvg: number[] = [], dMax: number[] = [];
  for (let j = 0; j < nNets; j++) {
    let sum = 0, mx = 0;
    for (let tt = t1 + 1; tt <= t2; tt++) { const d = demand[tt * nNets + j]!; sum += d; if (d > mx) mx = d; }
    dAvg.push(Math.ceil(sum / p));
    dMax.push(mx);
  }
  const fueled: number[] = [];
  for (let j = 0; j < nGens; j++) {
    let s = 0;
    for (let tt = t1 + 1; tt <= t2; tt++) s += fuel[tt * nGens + j]!;
    fueled.push(Math.floor((s * 1000) / p));
  }
  return {
    key, exact, t1, p, keys, prefT, prefP, inP: Float64Array.from(inP), outP: Float64Array.from(outP),
    dAvg, dMax, fueled, prodT, consT, prodP, consP, statItems, prodSeries, consSeries, gleanItems, gleanSeries, s0, s1, warmTicks: t2,
  };
}

/** What the Gleaners took of the regime's j-th taken item after `e` ticks (e ≥ 0), transient included (D103). */
export function gleanAt(r: Regime, j: number, e: number): number {
  if (e <= 0) return 0;
  const [T, P] = r.gleanSeries[j]!;
  if (e <= r.t1) return T[e]!;
  const k = e - r.t1;
  return T[r.t1]! + Math.floor(k / r.p) * P[r.p]! + P[k % r.p]!;
}

/** Cumulative production (or consumption) of the regime's j-th stat item after `e` ticks (e ≥ 0), transient included. */
export function statAt(r: Regime, j: number, e: number, cons: boolean): number {
  if (e <= 0) return 0;
  const [T, P] = (cons ? r.consSeries : r.prodSeries)[j]!;
  if (e <= r.t1) return T[e]!;
  const k = e - r.t1;
  return T[r.t1]! + Math.floor(k / r.p) * P[r.p]! + P[k % r.p]!;
}

/** Cumulative net inflow for key index j after `e` ticks in the regime (e ≥ 0). */
export function flowAt(r: Regime, j: number, e: number): number {
  if (e <= 0) return 0;
  const T = r.prefT[j]!;
  if (e <= r.t1) return T[e]!;
  const P = r.prefP[j]!;
  const k = e - r.t1;
  return T[r.t1]! + Math.floor(k / r.p) * P[r.p]! + P[k % r.p]!;
}

/** Bring a group's nodes to their state after `e` ticks of this regime (from tick `start`). */
export function materialize(g: Graph, grp: Group, ctx: TickCtx, c: Cond, r: Regime, start: number, e: number): void {
  if (e <= r.t1) {
    restoreGroup(grp, r.s0, start);
    stepGroup(g, grp, ctx, c, start, e, r.s0.pools);
  } else {
    const k = (e - r.t1) % r.p;
    const at = start + e - k;
    restoreGroup(grp, r.s1, at);
    stepGroup(g, grp, ctx, c, at, k, r.s1.pools);
  }
}
