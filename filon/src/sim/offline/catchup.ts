// catchup.ts — unlimited offline progression with the SAME engine. The timeline is cut into
// segments at events (an epoch boundary, a reservoir item reaching a bound, an accumulator filling
// or emptying, a construction or a research completing). Research takes no items (D122): the
// servers' tokens and each lab's power (`lit`) are counted per segment, exactly as online, and the
// tokens delivered at each boundary by the online call (`tokenEpoch`, D68, D118, D122: the Core's
// compute and the servers' minute, the bank, the bought flows), the projects they complete finished there; the
// expertises' feats and slots are read there too (`expertiseEpoch`, D93). Within a segment every group follows a regime —
// warmed up once from its true state, then extrapolated exactly (transient + whole periods
// + prefix). Groups only interact through reservoirs (state flags and throttle rates) and
// power grids (fixed satisfaction / dispatch per segment). Every per-segment pass is indexed
// (runs per grid, per reservoir key), so cost grows with events and distinct regimes — not
// with the length of the absence, nor quadratically with the base.
import { lapsing } from '../systems/land';
import { BAL } from '@/content/balance';
import { BUILDING_KIND, N_ITEMS, itemIdx } from '@/content/registry';
import { SAT_STEP, EPOCH } from '../constants';
import { addHeld, type Sim } from '../state';
import { buildGroups, type Group } from '../graph/groups';
import { makeCtx } from '../flow/step';
import type { TickCtx } from '../flow/node';
import { DrillNode, MachineNode, ReservoirNode, V_EMPTY, V_FULL, V_NORMAL } from '../flow/nodes';
import { projectDone } from '../research/runtime';
import { labTick, queuedReady, serverTick, startQueued } from '../systems/research';
import { jobDone, jobRate, type Job } from '../space';
import { renewableKw, weatherAt, weatherKey } from '../power/network';
import { modsKey } from '../research/modifiers';
import { condKey, flowAt, gleanAt, materialize, restoreGroup, rotOf, scanGroup, Scratch, statAt, warmUp, type Cond, type Regime } from './steady';
import { gleanNight, markTaken } from '../systems/gleaners';
import { newReport, type AwayReport } from './report';

/** Below this, simply tick the engine (exact, and cheap for short gaps). */
export const DIRECT_TICKS = 1200;
/** After this many warm-ups of one group, re-entering a known regime reuses the cache. */
const CACHE_AFTER = 6;
const MIN_STEP = 60;

interface Run {
  grp: Group;
  reg: Regime | null;
  key: string;
  cond: Cond | null;
  /** Sim tick at which the regime's elapsed time is 0. */
  start: number;
  warmCount: number;
  /** Items this group pulls from / pushes into each reservoir (state relevance). */
  pull: Map<number, Set<number>>;
  push: Map<number, Set<number>>;
  /** Gross per-tick flows per reservoir key while that key was NORMAL (throttle shares). */
  normalIn: Map<number, number>;
  normalOut: Map<number, number>;
  /** Items with non-zero production / consumption in the current regime. */
  statItems: number[];
  dirty: boolean;
}

interface NetMode { sat: number; disp: number; accRate: number }
/** A grid's load under the current regimes: average and peak demand (kW), fuel capacity and its fueled part. */
interface NetLoad { dAvg: number; dMax: number; F: number; Feff: number }

export interface CatchUpOptions {
  /** Force the regime path even for short gaps (tests). */
  noDirect?: boolean;
}

/** What a group's nodes hold, per item (milli-items): on its ribbons, in its machines' and blocks' buffers. */
function groupHeld(grp: Group): Float64Array {
  const out = new Float64Array(N_ITEMS);
  for (const n of grp.nodes) addHeld(n, out);
  return out;
}
/** How far apart two holdings are (milli-items, all items). */
const heldGap = (a: Float64Array, b: Float64Array): number => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!); return d; };
/** How far into a cached cycle a jump looks for a point holding the group's items (ticks). */
const SEARCH = 100;

const addTo = (m: Map<number, number>, k: number, v: number): void => {
  const nv = (m.get(k) ?? 0) + v;
  if (Math.abs(nv) < 1e-9) m.delete(k); else m.set(k, nv);
};

export function catchUp(sim: Sim, ticks: number, opts: CatchUpOptions = {}): AwayReport {
  const rep = newReport(sim.tick);
  rep.toTick = sim.tick + Math.max(0, ticks);
  if (ticks <= 0) return rep;
  sim.ensureCompiled();
  const hearthBefore = sim.stock.slice();
  const prod0 = sim.produced.slice(), cons0 = sim.consumed.slice(), glean0 = sim.gleaned.slice();
  const credits0 = sim.credits, earned0 = sim.trade.earned, spent0 = sim.trade.spent;
  const sold0 = sim.trade.soldTotal.slice(), bought0 = sim.trade.boughtTotal.slice();
  const finish = (): AwayReport => {
    for (let i = 0; i < N_ITEMS; i++) {
      rep.hearthDelta[i] = sim.stock[i]! - hearthBefore[i]!;
      rep.sold[i] = sim.trade.soldTotal[i]! - sold0[i]!;
      rep.bought[i] = sim.trade.boughtTotal[i]! - bought0[i]!;
    }
    rep.creditsDelta = sim.credits - credits0;
    rep.earned = sim.trade.earned - earned0;
    rep.spent = sim.trade.spent - spent0;
    return rep;
  };

  if (!opts.noDirect && ticks <= DIRECT_TICKS) {
    sim.run(ticks);
    rep.mode = 'direct';
    for (let i = 0; i < N_ITEMS; i++) {
      rep.produced[i] = sim.produced[i]! - prod0[i]!;
      rep.consumed[i] = sim.consumed[i]! - cons0[i]!;
      rep.gleaned[i] = sim.gleaned[i]! - glean0[i]!;
    }
    return finish();
  }

  const end = sim.tick + ticks;
  const margin = BAL.reservoirMargin * 1000;
  const scratch = new Scratch();
  const cache = new Map<string, Regime>();
  let now = sim.tick;

  // ── per-graph state (rebuilt when the graph changes) ─────────────────────
  let g = sim.graph;
  let wctx: TickCtx;
  let runs: Run[] = [];
  let netRuns: Run[][] = [];
  let keyRuns = new Map<number, Run[]>();     // reservoir key → runs it is relevant to
  let resState: Uint8Array[] = [];
  let netModes: NetMode[] = [];
  /** Per grid: what reservoir buildings draw (observatories, excavators, servers…; they belong to no group). */
  let resKw: number[] = [];
  /** Per grid: its load as last summed (`computeNetModes`; undefined: to sum). */
  let netLoad: Array<NetLoad | undefined> = [];
  /** Per weather key: each grid's renewables (kW; NaN: not yet asked). Producers change only with the graph. */
  const netR = new Map<string, Float64Array>();
  let mk = '';
  const curIn = new Map<number, number>();     // Σ current regimes' gross inflow per key (mu/tick)
  const curOut = new Map<number, number>();
  const sumNormIn = new Map<number, number>();  // Σ runs' NORMAL-state inflow per key (shares)
  const sumNormOut = new Map<number, number>();
  const throttle = new Map<number, number>();   // key → throttle total (mu/epoch)
  const labOut = new Map<number, number>();     // pseudo outflows: backfills (mu/tick)
  const pIn = new Map<number, number>();        // pseudo inflows: excavated rubble, a post's deliveries (mu/tick)
  const RUB = itemIdx('stone');
  /**
   * Reservoir keys whose level the epoch boundary moved outside the flows (trade: deliveries,
   * sales from a store or the Hearth). A key with no flow is not re-classified otherwise, so a
   * post's empty store filled by a delivery would never feed its outlet's line again.
   */
  const moved = new Set<number>();
  /** The reservoirs a boundary's trade can move (the Hearth, the trade posts' stores), by index in `g.reservoirs`. */
  let tradeRes: number[] = [];
  /**
   * A post's deliveries, spread over the epoch after they land (key → whole items, the tick they
   * landed, how many are in so far). Online they land in a lump at the boundary and its exit hands
   * them out at once; offline a lump in a store under the margin left the key EMPTY, whose throttle
   * is its inflow — none — so the exit waited for 40 items (the old known gap, docs/offline.md). As
   * an inflow over the epoch, item by item, the exit hands them out as they come; whole by the next
   * boundary (`flushDeliveries`), where the trade sees the same container as online.
   */
  const deliveries = new Map<number, { n: number; at: number; done: number }>();
  let lastWeather = '';
  let pendingBuilds: number[] = [];

  function setup(): void {
    g = sim.graph;
    wctx = makeCtx(g, g.nets.length, N_ITEMS);
    mk = modsKey(sim.mods);
    curIn.clear(); curOut.clear(); sumNormIn.clear(); sumNormOut.clear(); throttle.clear(); labOut.clear(); pIn.clear();
    tradeRes = [];
    g.reservoirs.forEach((r, ri) => { if (r === g.hearth || BUILDING_KIND[sim.ents.get(r.ent)?.def ?? -1] === 'trade') tradeRes.push(ri); });
    resState = g.reservoirs.map((r) => {
      const s = new Uint8Array(N_ITEMS);
      for (let i = 0; i < N_ITEMS; i++) s[i] = r.stock[i]! < margin ? V_EMPTY : r.stock[i]! > r.capOf(i) - margin ? V_FULL : V_NORMAL;
      return s;
    });
    runs = buildGroups(g).map(newRun);
    dirtyRuns.clear();
    for (const run of runs) dirtyRuns.add(run);
    throttleDirty.clear();
    netRuns = g.nets.map(() => []);
    for (const run of runs) for (const n of run.grp.nets) netRuns[n]!.push(run);
    keyRuns = new Map();
    for (const run of runs) indexRelevance(run);
    netModes = g.nets.map(() => ({ sat: 1000, disp: 0, accRate: 0 }));
    resKw = g.nets.map(() => 0);
    for (const r of g.reservoirs) if (r.net >= 0) resKw[r.net] = resKw[r.net]! + r.demand();
    netLoad = g.nets.map(() => undefined);
    netR.clear();
    lastWeather = '';
    pendingBuilds = [...sim.ents.map.values()].filter((e) => e.builtAt > now).map((e) => e.builtAt).sort((a, b) => a - b);
  }

  function newRun(grp: Group): Run {
    // What can this group deliver? Its own products, and anything it pulls (pass-through).
    const made = new Set<number>();
    const pulledAny = new Set<number>();
    for (const n of grp.nodes) {
      if (n instanceof DrillNode && n.item >= 0) made.add(n.item);
      if (n instanceof MachineNode && n.recipe) for (const o of n.recipe.outs) made.add(o.item);
    }
    const pull = new Map<number, Set<number>>(), push = new Map<number, Set<number>>();
    for (const ri of grp.res) {
      const r = g.reservoirs[ri]!;
      const set = new Set<number>();
      for (const e of grp.resOut.get(ri) ?? []) {
        for (const it of r.portPulls(g.eSrcPort[e]!)) { set.add(it); pulledAny.add(it); }
      }
      pull.set(ri, set);
    }
    for (const ri of grp.res) push.set(ri, (grp.resIn.get(ri)?.length ?? 0) > 0 ? new Set([...made, ...pulledAny]) : new Set());
    return {
      grp, reg: null, key: '', cond: null, start: now, warmCount: 0, pull, push,
      normalIn: new Map(), normalOut: new Map(), statItems: [], dirty: true,
    };
  }

  function indexRelevance(run: Run): void {
    for (const ri of run.grp.res) {
      const items = new Set([...(run.pull.get(ri) ?? []), ...(run.push.get(ri) ?? [])]);
      for (const i of items) {
        const k = ri * N_ITEMS + i;
        let arr = keyRuns.get(k);
        if (!arr) keyRuns.set(k, (arr = []));
        if (!arr.includes(run)) arr.push(run);
      }
    }
  }

  /** The state of item i at reservoir ri as it matters to this run. */
  function effState(run: Run, ri: number, i: number): number {
    const st = resState[ri]![i]!;
    if (st === V_EMPTY && run.pull.get(ri)?.has(i)) return V_EMPTY;
    if (st === V_FULL && run.push.get(ri)?.has(i)) return V_FULL;
    return V_NORMAL;
  }

  function condFor(run: Run): Cond {
    const grp = run.grp;
    const res = new Map<number, { state: Uint8Array; rate: Float64Array }>();
    for (const ri of grp.res) {
      const state = new Uint8Array(N_ITEMS);
      const rate = new Float64Array(N_ITEMS);
      const items = new Set([...(run.pull.get(ri) ?? []), ...(run.push.get(ri) ?? [])]);
      for (const i of items) {
        const st = effState(run, ri, i);
        if (st === V_NORMAL) continue;
        state[i] = st;
        const k = ri * N_ITEMS + i;
        const total = throttle.get(k) ?? 0;
        const mine = st === V_EMPTY ? (run.normalOut.get(k) ?? 0) : (run.normalIn.get(k) ?? 0);
        const sum = st === V_EMPTY ? (sumNormOut.get(k) ?? 0) : (sumNormIn.get(k) ?? 0);
        const runsOn = keyRuns.get(k)?.length ?? 1;
        rate[i] = Math.floor(sum > 0 ? (total * mine) / sum : total / runsOn);
      }
      res.set(ri, { state, rate });
    }
    const sat = new Map<number, number>(), disp = new Map<number, number>();
    for (const n of grp.nets) { sat.set(n, netModes[n]!.sat); disp.set(n, netModes[n]!.disp); }
    // The Gleaners (D103): out in the dark hours, a world-clock input of the segment's minute.
    return { res, sat, disp, night: grp.glean && gleanNight(sim.absEpoch(now)) };
  }

  const netDirty = new Set<number>();
  const dirtyRuns = new Set<Run>();
  const markDirty = (run: Run): void => { run.dirty = true; dirtyRuns.add(run); };
  /** Reservoir keys whose throttle may need recomputing (flows or state changed). */
  const throttleDirty = new Set<number>();

  function setRegime(run: Run, reg: Regime): void {
    const old = run.reg;
    if (old) old.keys.forEach((k, j) => { addTo(curIn, k, -old.inP[j]! / old.p); addTo(curOut, k, -old.outP[j]! / old.p); throttleDirty.add(k); });
    reg.keys.forEach((k, j) => { addTo(curIn, k, reg.inP[j]! / reg.p); addTo(curOut, k, reg.outP[j]! / reg.p); throttleDirty.add(k); });
    run.reg = reg;
    run.statItems = reg.statItems;
    for (const n of run.grp.nets) netDirty.add(n);
  }

  function ensureRegime(run: Run): void {
    const c = condFor(run);
    const key = condKey(run.grp, c, mk);
    run.dirty = false;
    dirtyRuns.delete(run);
    if (key === run.key && run.reg) return;
    // Bring the group to its true state now, then warm up (or reuse the cache).
    if (run.reg && run.cond) materialize(g, run.grp, wctx, run.cond, run.reg, run.start, now - run.start);
    const cached = cache.get(key);
    let reg: Regime | null = null;
    let lag = 0;
    if (cached && run.warmCount >= CACHE_AFTER) {
      // A known regime: no warm-up, the group jumps into its cycle (an approximation: `approx`).
      const L = rotOf(run.grp, c);
      const jump: Regime = { ...cached, t1: 0, prefT: cached.keys.map(() => Float64Array.of(0)), s0: cached.s1 };
      if (!cached.exact) {
        // An averaged regime (no exact period: an approximation already) jumps to where it ended.
        reg = jump;
        restoreGroup(run.grp, cached.s1, now);
        rep.mode = 'approx';
      } else {
        // An exact one jumps into its cycle — in phase with the world's clock (the ribbons step on
        // it, D57): `lag` ticks into the period, the regime having started that much before now —
        // at the point holding the items the group holds now, so the jump loses and makes none
        // (the items in transit vary along a cycle): from `lag` on, a phase's turn at a time, up to
        // SEARCH ticks; failing that, at the point closest to it.
        const want = groupHeld(run.grp);
        lag = L > 1 ? (((now - cached.s1.tick) % L) + L) % L : 0;
        if (lag) materialize(g, run.grp, wctx, c, jump, now - lag, lag);
        else restoreGroup(run.grp, cached.s1, now);
        // The phase repeats every L ticks, so each stop of the walk is a point in phase, as if at `now`.
        let bestGap = Infinity, bestAt = lag, last = lag;
        scanGroup(g, run.grp, wctx, c, now, L, Math.max(0, Math.min(cached.p, SEARCH) - lag), (at) => {
          last = lag + at;
          const gap = heldGap(groupHeld(run.grp), want);
          if (gap < bestGap) { bestGap = gap; bestAt = last; }
          return gap === 0;
        });
        // The walk went past the closest point: go back to it (from the cycle's start, in phase).
        if (bestAt !== last) materialize(g, run.grp, wctx, c, jump, now - bestAt, bestAt);
        lag = bestAt;
        reg = jump;
        rep.mode = 'approx';
      }
    }
    if (!reg) {
      reg = warmUp(g, run.grp, wctx, c, now, key, scratch);
      cache.set(key, reg);
      run.warmCount++;
      rep.warmups++;
      rep.warmTicks += reg.warmTicks;
      if (!reg.exact) rep.mode = 'approx';
    }
    setRegime(run, reg);
    run.key = key;
    run.cond = c;
    run.start = now - lag;
    // NORMAL-state gross flows feed throttle shares; seen items become relevant.
    reg.keys.forEach((k, j) => {
      const ri = Math.floor(k / N_ITEMS), it = k % N_ITEMS;
      let changed = false;
      if (reg.inP[j]! > 0 && !run.push.get(ri)?.has(it)) { run.push.get(ri)?.add(it); changed = true; }
      if (reg.outP[j]! > 0 && !run.pull.get(ri)?.has(it)) { run.pull.get(ri)?.add(it); changed = true; }
      if (changed) indexRelevance(run);
      if (c.res.get(ri)?.state[it] === V_NORMAL) {
        const nin = reg.inP[j]! / reg.p, nout = reg.outP[j]! / reg.p;
        addTo(sumNormIn, k, nin - (run.normalIn.get(k) ?? 0));
        addTo(sumNormOut, k, nout - (run.normalOut.get(k) ?? 0));
        run.normalIn.set(k, nin);
        run.normalOut.set(k, nout);
      }
    });
  }

  /**
   * Per-grid power modes from current regimes and this epoch's weather. A new sun step re-solves
   * every grid each epoch — 10 080 times 1 681 grids for a week of base20k — so the two inputs
   * that rarely move are kept: a grid's load (demand, fuel: `netLoad`, summed again only when a
   * regime on it changed, which marks it in `netDirty`) and its renewables per weather
   * (`netR`, by `weatherKey`: a few dozen distinct weathers a week). Same numbers, same modes.
   */
  function computeNetModes(force: boolean): boolean {
    // The same weather and generator functions as online (power/network.ts).
    const w = weatherAt(sim.absEpoch(now), sim.worldSeed, sim.mods);
    const weather = weatherKey(w);
    const all = force || weather !== lastWeather;
    lastWeather = weather;
    let Rs = netR.get(weather);
    if (!Rs) netR.set(weather, (Rs = new Float64Array(g.nets.length).fill(NaN)));
    let changed = false;
    for (let n = 0; n < g.nets.length; n++) {
      const dirty = netDirty.has(n);
      if (!all && !dirty) continue;
      const net = g.nets[n]!;
      let R = Rs[n]!;
      if (Number.isNaN(R)) Rs[n] = R = renewableKw(net, w); // not yet asked under this weather
      let load = netLoad[n];
      if (!load || dirty || force) netLoad[n] = load = loadOf(n);
      const { dAvg, dMax, F, Feff } = load;
      let E = 0, cap = 0, rate = 0;
      for (const a of net.accs) { E += sim.accEnergy.get(a.ent) ?? 0; cap += a.cap; rate += a.rate; }
      let sat: number, disp: number, accRate: number;
      if (R >= dMax) {
        sat = 1000; disp = 0; accRate = E < cap ? Math.min(rate, Math.max(0, R - dAvg)) : 0;
      } else if (R + Feff >= dMax && F > 0) {
        const need = Math.max(0, dAvg - R);
        // The generators' share as online (solvePower: the exact ceiling), not rounded up to 25 ‰:
        // a steam boiler (D114) half called on burnt and drank up to a tenth too much offline.
        sat = 1000; disp = Math.min(1000, Math.max(1, Math.ceil((need * 1000) / F))); accRate = 0;
      } else if (E > 0 && rate > 0) {
        const deficit = Math.max(0, dAvg - R - Feff);
        const dis = Math.min(rate, deficit);
        const served = R + Feff + dis;
        sat = served >= dAvg ? 1000 : Math.floor(((1000 * served) / Math.max(1, dAvg)) / SAT_STEP) * SAT_STEP;
        disp = F > 0 ? 1000 : 0; accRate = -dis;
      } else {
        const served = R + Feff;
        sat = dAvg <= 0 ? 1000 : Math.min(1000, Math.floor(((1000 * served) / dAvg) / SAT_STEP) * SAT_STEP);
        disp = F > 0 ? 1000 : 0; accRate = 0;
      }
      const old = netModes[n]!;
      if (old.sat !== sat || old.disp !== disp) {
        changed = true;
        for (const run of netRuns[n]!) markDirty(run);
        if (sat < 1000 && old.sat === 1000) rep.incidents.push({ tick: now, kind: 'brownout', ent: net.poles[0] });
      }
      old.sat = sat; old.disp = disp; old.accRate = accRate;
    }
    netDirty.clear();
    return changed;
  }

  /** What grid n's groups and reservoir buildings draw, and its fuel generators, under the current regimes. */
  function loadOf(n: number): NetLoad {
    let dAvg = resKw[n] ?? 0, dMax = resKw[n] ?? 0, F = 0, Feff = 0;
    for (const run of netRuns[n]!) {
      const reg = run.reg;
      if (!reg) continue;
      run.grp.nets.forEach((nn, j) => { if (nn === n) { dAvg += reg.dAvg[j]!; dMax += reg.dMax[j]!; } });
      run.grp.gens.forEach((gen, j) => {
        if (gen.net !== n) return;
        F += gen.outKw;
        Feff += Math.floor((gen.outKw * (reg.fueled[j] ?? 1000)) / 1000);
      });
    }
    return { dAvg, dMax, F, Feff };
  }

  function computeThrottles(): boolean {
    let changed = false;
    for (const k of throttleDirty) {
      const arr = keyRuns.get(k);
      if (!arr) continue;
      const ri = Math.floor(k / N_ITEMS), i = k % N_ITEMS;
      const st = resState[ri]![i]!;
      if (st === V_NORMAL) { throttle.delete(k); continue; }
      // EMPTY: consumers share the inflow; FULL: producers share the outflow (mu/epoch).
      const inflow = (curIn.get(k) ?? 0) + (pIn.get(k) ?? 0);
      const outflow = (curOut.get(k) ?? 0) + (labOut.get(k) ?? 0);
      const total = Math.floor((st === V_EMPTY ? inflow : outflow) * EPOCH);
      const old = throttle.get(k) ?? -1;
      if (Math.abs(total - old) > Math.max(10, old * 0.01)) {
        throttle.set(k, total);
        for (const run of arr) {
          if (effState(run, ri, i) !== V_NORMAL) { markDirty(run); changed = true; }
        }
      }
    }
    throttleDirty.clear();
    return changed;
  }

  function settle(): void {
    for (let pass = 0; pass < 4; pass++) {
      for (const run of [...dirtyRuns]) ensureRegime(run);
      const a = computeNetModes(pass === 0 && !lastWeather);
      const b = computeThrottles();
      if (!a && !b) break;
    }
    for (const run of [...dirtyRuns]) ensureRegime(run);
  }

  const rateOf = (k: number): number => (curIn.get(k) ?? 0) + (pIn.get(k) ?? 0) - (curOut.get(k) ?? 0) - (labOut.get(k) ?? 0);

  const resIndex = (ent: number): number => {
    const n = g.nodeByEnt.get(ent);
    return n instanceof ReservoirNode ? g.reservoirs.indexOf(n) : -1;
  };
  /** A job's power this segment; an excavator with a full store pauses. */
  const jobSatOff = (j: Job): number => {
    const sat = sim.jobSat(j, (n) => netModes[n]?.sat ?? 0);
    if (j.kind === 'dig') { const ri = resIndex(j.ent); if (ri >= 0 && resState[ri]![RUB] === V_FULL) return 0; }
    return sat;
  };

  /** Power satisfaction of a project's lab this segment (its grid's: it takes its tokens only in a minute it had power, D122). */
  const projSat = (p: (typeof sim.projects)[number]): number => sim.projectSat(p, (n) => netModes[n]?.sat ?? 0);

  /** The pseudo-flows: digs and fills, a post's spread deliveries (research takes no items since D122). */
  function labFlows(): void {
    const next = new Map<number, number>();
    const nextIn = new Map<number, number>();
    const add = (m: Map<number, number>, k: number, v: number): void => { m.set(k, (m.get(k) ?? 0) + v); };
    for (const j of sim.jobs) {
      const ri = resIndex(j.ent);
      const r = jobRate(j, jobSatOff(j));
      if (ri < 0 || r <= 0) continue;
      add(j.kind === 'dig' ? nextIn : next, ri * N_ITEMS + RUB, r);
    }
    for (const [k, d] of deliveries) if (d.n > d.done) add(nextIn, k, (d.n * 1000) / EPOCH);
    for (const [cur, nu] of [[labOut, next], [pIn, nextIn]] as const) {
      for (const k of new Set([...cur.keys(), ...nu.keys()])) {
        if (Math.abs((cur.get(k) ?? 0) - (nu.get(k) ?? 0)) > 1e-12) throttleDirty.add(k);
      }
      cur.clear();
      for (const [k, v] of nu) cur.set(k, v);
    }
  }

  function nextEvent(segEnd: number): number {
    let t = segEnd;
    for (const p of sim.projects) {
      const sat = projSat(p);
      // A reconversion's wait (its time: no lab); research ends only at a boundary (D118, D122).
      if (sat > 0 && p.el < p.dur * 1000) t = Math.min(t, now + Math.max(1, Math.ceil((p.dur * 1000 - p.el) / sat)));
    }
    for (const j of sim.jobs) {
      const sat = jobSatOff(j);
      if (sat > 0 && j.el < j.dur * 1000) t = Math.min(t, now + Math.max(1, Math.ceil((j.dur * 1000 - j.el) / sat)));
    }
    const keys = new Set<number>([...curIn.keys(), ...curOut.keys(), ...labOut.keys(), ...pIn.keys()]);
    for (const k of keys) {
      const r = rateOf(k);
      if (Math.abs(r) < 1e-9) continue;
      const ri = Math.floor(k / N_ITEMS), i = k % N_ITEMS;
      const res = g.reservoirs[ri]!;
      const lvl = res.stock[i]!, st = resState[ri]![i]!;
      let dt = Infinity;
      const cap = res.capOf(i);
      if (st === V_NORMAL) dt = r < 0 ? (lvl - margin + 1) / -r : (cap - margin - lvl + 1) / r;
      else if (st === V_EMPTY && r > 0) dt = (2 * margin - lvl + 1) / r;
      else if (st === V_FULL && r < 0) dt = (lvl - (cap - 2 * margin) + 1) / -r;
      if (dt < Infinity) t = Math.min(t, now + Math.max(MIN_STEP, Math.ceil(dt)));
    }
    g.nets.forEach((net, n) => {
      const m = netModes[n]!;
      if (!m.accRate) return;
      let E = 0, cap = 0;
      for (const a of net.accs) { E += sim.accEnergy.get(a.ent) ?? 0; cap += a.cap; }
      const dt = m.accRate > 0 ? (cap - E) / m.accRate : E / -m.accRate;
      t = Math.min(t, now + Math.max(MIN_STEP, Math.ceil(dt)));
    });
    if (pendingBuilds.length && pendingBuilds[0]! > now) t = Math.min(t, pendingBuilds[0]!);
    return Math.min(t, segEnd);
  }

  function advance(to: number): void {
    const dt = to - now;
    if (dt <= 0) return;
    /** Keys a regime drew below zero: settled once this step's pseudo inflows are in (below). */
    const short: number[] = [];
    for (const run of runs) {
      const reg = run.reg;
      if (!reg) continue;
      const ea = now - run.start, eb = to - run.start;
      for (let j = 0; j < reg.keys.length; j++) {
        const d = flowAt(reg, j, eb) - flowAt(reg, j, ea);
        if (d === 0) continue;
        const k = reg.keys[j]!;
        const ri = Math.floor(k / N_ITEMS), i = k % N_ITEMS;
        const res = g.reservoirs[ri]!;
        res.stock[i] = res.stock[i]! + d;
        // An EMPTY key's consumers draw its throttle — its inflow, which may be a pseudo inflow
        // (a dig's rubble, a post's deliveries) credited only below: the level may dip
        // under zero until then. Clamped right here, those items were lost AND credited again: the
        // consumers made them twice (a workshop fed by the drifters of D66 made half again its output offline).
        if (res.stock[i]! < 0) short.push(k);
        const cap = res.capOf(i);
        if (res.stock[i]! > cap && d > 0) {
          const over = res.stock[i]! - Math.max(cap, res.stock[i]! - d);
          rep.lostMu[i] = rep.lostMu[i]! + over;
          res.stock[i] = res.stock[i]! - over;
        }
      }
      // Statistics follow the regime exactly, transient included (as the flows above).
      for (let j = 0; j < reg.statItems.length; j++) {
        const i = reg.statItems[j]!;
        const pr = statAt(reg, j, eb, false) - statAt(reg, j, ea, false);
        const co = statAt(reg, j, eb, true) - statAt(reg, j, ea, true);
        if (pr) { rep.produced[i] = rep.produced[i]! + pr; sim.produced[i] = sim.produced[i]! + pr; }
        if (co) { rep.consumed[i] = rep.consumed[i]! + co; sim.consumed[i] = sim.consumed[i]! + co; }
      }
      // What the Gleaners took off its ribbons (D103), exactly as the regime ran it.
      for (let j = 0; j < reg.gleanItems.length; j++) {
        const d = gleanAt(reg, j, eb) - gleanAt(reg, j, ea);
        if (!d) continue;
        const i = reg.gleanItems[j]!;
        rep.gleaned[i] = rep.gleaned[i]! + d;
        markTaken(sim, run.grp.gleanTile, i, d);
      }
    }
    if (sim.jobs.length) {
      const sats = new Map(sim.jobs.map((j) => [j, jobSatOff(j)] as const));
      sim.advanceJobs(dt, () => 0, (j) => sats.get(j) ?? 0);
    }
    // The deliveries, whole items at an even pace over their epoch.
    for (const [k, d] of deliveries) {
      const due = Math.min(d.n, Math.floor((d.n * (to - d.at)) / EPOCH));
      if (due <= d.done) continue;
      const r = g.reservoirs[Math.floor(k / N_ITEMS)]!, i = k % N_ITEMS;
      r.stock[i] = r.stock[i]! + (due - d.done) * 1000;
      d.done = due;
    }
    // The servers' tokens and the labs' power (D122), exactly as online over these ticks.
    serverTick(sim, dt, (n) => netModes[n]?.sat ?? 0);
    if (sim.projects.length) labTick(sim, dt, projSat);
    // Throttling keeps levels within bounds; guard (and count) what is still short once every
    // inflow of the step is in: the averaging error at the edges.
    for (const k of short) {
      const res = g.reservoirs[Math.floor(k / N_ITEMS)]!, i = k % N_ITEMS;
      if (res.stock[i]! < 0) { rep.clampedMu[i] = rep.clampedMu[i]! - res.stock[i]!; res.stock[i] = 0; }
    }
    g.nets.forEach((net, n) => {
      const m = netModes[n]!;
      if (!m.accRate) return;
      let rem = m.accRate * dt;
      let E = 0, cap = 0;
      for (const a of net.accs) {
        const e = sim.accEnergy.get(a.ent) ?? 0;
        const d = rem === 0 ? 0 : rem > 0 ? Math.min(rem, a.cap - e) : Math.max(rem, -e);
        if (d) { sim.accEnergy.set(a.ent, e + d); rem -= d; }
        E += e + d; cap += a.cap;
      }
      // Accumulators full or dry: the grid's mode changes (stop charging / no more cover).
      if ((m.accRate > 0 && E >= cap) || (m.accRate < 0 && E <= 0)) netDirty.add(n);
    });
    now = to;
    sim.tick = now;
  }

  /** Re-classify the reservoir keys that can move (those with flow), and `moved`'s (levels changed outside the flows). */
  function classify(): void {
    const keys = new Set<number>([...curIn.keys(), ...curOut.keys(), ...labOut.keys(), ...pIn.keys(), ...moved]);
    moved.clear();
    for (const k of keys) {
      const ri = Math.floor(k / N_ITEMS), i = k % N_ITEMS;
      const r = g.reservoirs[ri]!;
      const st = resState[ri]!;
      const lvl = r.stock[i]!;
      const old = st[i]!;
      let nu = old;
      const cap = r.capOf(i);
      if (old === V_NORMAL) { if (lvl < margin) nu = V_EMPTY; else if (lvl > cap - margin) nu = V_FULL; }
      else if (old === V_EMPTY) { if (lvl > 2 * margin) nu = lvl > cap - margin ? V_FULL : V_NORMAL; }
      else if (lvl < cap - 2 * margin) nu = lvl < margin ? V_EMPTY : V_NORMAL;
      if (nu === old) continue;
      st[i] = nu;
      throttleDirty.add(k);
      for (const run of keyRuns.get(k) ?? []) markDirty(run);
      if (r === g.hearth) {
        if (nu === V_FULL) rep.incidents.push({ tick: now, kind: 'storageFull', item: i });
        else if (nu === V_EMPTY) rep.incidents.push({ tick: now, kind: 'storageEmpty', item: i });
      }
    }
  }

  function materializeAll(): void {
    flushDeliveries(); // the keys go with this graph
    for (const run of runs) if (run.reg && run.cond) materialize(g, run.grp, wctx, run.cond, run.reg, run.start, now - run.start);
  }

  /** Whatever of the deliveries is still to come lands now (a boundary, a new graph, the end). */
  function flushDeliveries(): void {
    for (const [k, d] of deliveries) {
      const r = g.reservoirs[Math.floor(k / N_ITEMS)]!, i = k % N_ITEMS;
      if (d.n > d.done) { r.stock[i] = r.stock[i]! + (d.n - d.done) * 1000; moved.add(k); }
      throttleDirty.add(k);
    }
    deliveries.clear();
  }

  /** The boundary's deliveries (its `delivered` events from `from` on) taken back out of their stores, to come in over the epoch. */
  function spreadDeliveries(from: number): void {
    for (let e = from; e < sim.events.length; e++) {
      const ev = sim.events[e]!;
      if (ev.k !== 'delivered') continue;
      const ri = resIndex(ev.post);
      if (ri < 0 || ev.mu % 1000 !== 0) continue; // a post gone: into the Hearth, at once
      const k = ri * N_ITEMS + ev.item, r = g.reservoirs[ri]!;
      // Only into a store that stays under the margin with it (an EMPTY key): above, the lump is
      // a level like any other, and the regimes take it as online.
      if (r.stock[ev.item]! >= 2 * margin) continue;
      r.stock[ev.item] = r.stock[ev.item]! - ev.mu;
      const d = deliveries.get(k) ?? { n: 0, at: now, done: 0 };
      d.n += ev.mu / 1000;
      deliveries.set(k, d);
      moved.add(k);
      throttleDirty.add(k);
    }
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  setup();
  let guard = 0;
  while (now < end && guard++ < 5_000_000) {
    // Idle excavators / backfillers look for work when marks change and once a minute (as
    // online); a machine going busy draws full power: recompile.
    const idleBefore = sim.jobs.map((j) => j.ent).join(',');
    sim.assignJobsIfNeeded(now % EPOCH === 0);
    if (sim.jobs.map((j) => j.ent).join(',') !== idleBefore) {
      materializeAll();
      sim.markDirty();
      sim.ensureCompiled();
      setup();
    }
    classify();
    settle();
    labFlows();
    if (throttleDirty.size) { computeThrottles(); for (const run of [...dirtyRuns]) ensureRegime(run); }
    const segEnd = Math.min(end, (Math.floor(now / EPOCH) + 1) * EPOCH);
    const t = Math.max(now + 1, nextEvent(segEnd));
    advance(Math.min(t, end));
    // What this instant changes, in the online order: the tick's completions (tiles, research),
    // then the epoch boundary, then the constructions due at the new tick. A change of graph
    // materializes the groups once, then recompiles and starts over.
    let regraph = false;
    const materializeOnce = (): void => { if (!regraph) { materializeAll(); regraph = true; } };
    // Tiles dug or filled: terrain only (no recompile) unless a pump's water changed or a
    // machine went idle (its power draw).
    if (sim.jobs.some(jobDone)) {
      const busyBefore = sim.jobs.map((j) => j.ent).join(',');
      const pumps = sim.completeJobs();
      sim.assignJobsIfNeeded(true);
      if (pumps || sim.jobs.map((j) => j.ent).join(',') !== busyBefore) materializeOnce();
    }
    // A research completing (a reconversion's time run, or one whose tokens were already in) changes unlocks.
    if (sim.projects.some(projectDone)) {
      materializeOnce();
      for (const id of sim.finishProjects()) rep.incidents.push({ tick: now, kind: 'researchDone', ref: id });
    }
    // The epoch boundary: trade posts trade and the Crier settles — the same call as online
    // (reservoir levels and ocelles only: no group needs materializing, unless a post's cargo
    // changed: its entrance and its exit change with it, D64, a new graph). Its per-minute
    // events are folded into the report rather than replayed to the shell.
    if (now % EPOCH === 0) {
      flushDeliveries();
      const before = tradeRes.map((ri) => g.reservoirs[ri]!.stock.slice());
      const ev0 = sim.events.length;
      if (sim.tradeEpoch()) materializeOnce();
      else spreadDeliveries(ev0);
      dropTradeEvents(sim);
      tradeRes.forEach((ri, j) => { const r = g.reservoirs[ri]!, b = before[j]!; for (let i = 0; i < N_ITEMS; i++) if (r.stock[i] !== b[i]) moved.add(ri * N_ITEMS + i); });
      // The leases' hour (systems/land.ts), right after, as online: the rent taken (ocelles
      // only), or a lease lapsing — what stood on it goes dormant: a new graph.
      if (sim.land.leases.size) {
        if (lapsing(sim)) materializeOnce();
        const held = [...sim.land.leases.keys()];
        if (sim.landEpoch()) for (const p of held) if (!sim.land.leases.has(p)) rep.incidents.push({ tick: now, kind: 'leaseLapsed', parcel: p });
      }
      // Research's tokens for the minute, as online, after the trade and the leases (D68, D118, D122):
      // the Core's compute and the servers' minute, the bank and the bought flows delivered to the
      // projects whose lab had power (a purse in the red holds the bought ones), then the projects
      // they complete, finished as online — unlocks, a new graph.
      const heldBefore = sim.researchHeld;
      sim.tokenEpoch();
      if (sim.researchHeld !== heldBefore) rep.incidents.push({ tick: now, kind: sim.researchHeld ? 'researchHeld' : 'researchResumed' });
      if (sim.projects.some(projectDone)) {
        materializeOnce();
        for (const id of sim.finishProjects()) rep.incidents.push({ tick: now, kind: 'researchDone', ref: id });
      }
      // A queued node whose resources came in starts here, as online (D122): its resources leave
      // the Core, its lab draws its full power — a new graph.
      if (queuedReady(sim)) { materializeOnce(); startQueued(sim); }
      dropTradeEvents(sim);
      // The expertises' minute (D93), as online, last: the Core's grid as the segment just ended
      // served it, the feats' ranks, a réorientation's 24 h ending. An expertise in place whose
      // rank rose, or one coming into place, changes the Mods: a new graph.
      if (sim.expertiseEpoch((n) => netModes[n]?.sat ?? 0)) materializeOnce();
      // The Gleaners' nightfall and dawn (D103), as online: the night's tally, the morning report.
      // When they come out or go home, their groups take another regime (the night is in its key).
      sim.gleanEpoch();
      if (gleanNight(sim.absEpoch(now)) !== gleanNight(sim.absEpoch(now) - 1)) for (const run of runs) if (run.grp.glean) markDirty(run);
    }
    // Constructions finishing change the graph.
    if (pendingBuilds.length && pendingBuilds[0]! <= now) {
      materializeOnce();
      for (const id of sim.completeConstructions(now)) rep.incidents.push({ tick: now, kind: 'built', ent: id });
    }
    if (regraph) {
      sim.markDirty();
      sim.ensureCompiled();
      setup();
      continue;
    }
    if (now % EPOCH === 0) computeNetModes(false);
  }
  materializeAll();
  sim.tick = end;
  return finish();
}

/** The catch-up's trade, deliveries and Gazette news belong in the report, not in a week of toasts. */
function dropTradeEvents(sim: Sim): void {
  const ev = sim.events;
  let w = 0;
  for (let r = 0; r < ev.length; r++) {
    const k = ev[r]!.k;
    if (k !== 'trade' && k !== 'delivered' && k !== 'gazette' && k !== 'land') ev[w++] = ev[r]!;
  }
  ev.length = w;
}
