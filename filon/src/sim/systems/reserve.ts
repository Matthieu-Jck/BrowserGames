// reserve.ts (system) — CrierBelt's restart reserve (D36), the engine side. The content side
// (src/content/reserve.ts) says what rebuilding production from the bare land costs (the
// bootstrap) and so what the base must always be able to pay (the reserve). Here, the one
// invariant the engine keeps for every reserved item i:
//
//   assets(i) = the Heart's stock of i + the cost of i in every building standing ≥ reserve(i)
//
// `assets` is what the Heart would hold after taking every building down: removal refunds a
// building's cost in full, plus its buffers and stores (not counted: they only add). So placing
// and removing never change it (a replacement refunds what it replaces before paying), and
// production, quest rewards and deliveries only raise it. What lowers it for good is spending
// from the Heart that no removal gives back. A plan is that kind of spending: `planBlock`
// (systems/research.ts) refuses one that `reserveShort` says would break the invariant. A plan
// whose whole cost is in the reserve (the smelter's) is never refused: its share leaves the
// reserve with the stock. Over time the assets only grow, except through a trade post's export
// streams from the Heart's stock, which content keeps above the reserve (content/reserve.ts).
//
// This holds no state and changes none: no command, nothing saved or hashed, nothing for the
// offline catch-up (the guard is asked only when a plan is bought). A refused plan logs nothing,
// so a replay meets the same refusals. Other permanent spending from the Heart (a spot sale, a
// Heart level, a remote ribbon's surcharge) can call `reserveShort` / `reserveFloor` the same
// way (docs/engine.md, D36).
import { RESERVE_PARTS, RESERVED } from '@/content/reserve';
import { BUILDING_IDS, N_ITEMS, costOf, itemIdx, toMu } from '@/content/registry';
import type { Ent } from '../types';
import type { Sim } from '../state';
import type { Cost } from './build';

/** The reserve's shares as the engine reads them: item index, milli-items, the plan that drops it (null: kept for good). */
const PARTS = RESERVE_PARTS.map((p) => ({ item: itemIdx(p.item), mu: toMu(p.n), plan: p.plan }));

/** The items the reserve keeps (indices, in item order). */
export const RESERVED_ITEMS: readonly number[] = RESERVED.map(itemIdx);

/** Each building's cost, by building index (what its removal refunds at least). */
const COSTS = BUILDING_IDS.map((_, i) => costOf(i));

/** What every building standing would refund, by entity table (`sorted()` is the same array until an add or a remove). */
const refundsOf = new WeakMap<readonly Ent[], Float64Array>();

/** What taking every building down would refund through their costs (milli-items by item). Do not mutate. */
export function buildingRefunds(sim: Sim): Float64Array {
  const order = sim.ents.sorted();
  let r = refundsOf.get(order);
  if (!r) {
    r = new Float64Array(N_ITEMS);
    for (const e of order) for (const c of COSTS[e.def]!) r[c.item] = r[c.item]! + c.mu;
    refundsOf.set(order, r);
  }
  return r;
}

/** The base's assets of an item (mu): the Heart's stock plus what its buildings would refund. */
export const assets = (sim: Sim, item: number): number => sim.stock[item]! + buildingRefunds(sim)[item]!;

/**
 * The reserve now (milli-items by item; 0 for the items it does not keep): the bootstrap's cost
 * less the plans already done, and less `unlocking` (a plan being bought: its share goes with it).
 */
export function reserveNeed(sim: Sim, unlocking?: string): Float64Array {
  const need = new Float64Array(N_ITEMS);
  for (const p of PARTS) if (p.plan === null || (p.plan !== unlocking && !sim.done.has(p.plan))) need[p.item] = need[p.item]! + p.mu;
  return need;
}

/** What the Heart's stock itself must keep of an item (mu, ≥ 0): the reserve, less what the buildings would refund. */
export function reserveFloor(sim: Sim, item: number): number {
  return Math.max(0, reserveNeed(sim)[item]! - buildingRefunds(sim)[item]!);
}

/**
 * What paying `cost` from the Heart for good would leave the base short of its reserve: the items
 * and milli-items missing (empty: it can still rebuild its production). `unlocking`: the plan
 * that `cost` buys, whose own share of the reserve goes with it.
 */
export function reserveShort(sim: Sim, cost: Cost, unlocking?: string): Cost {
  const need = reserveNeed(sim, unlocking);
  const refunds = buildingRefunds(sim);
  const out: Cost = [];
  for (const i of RESERVED_ITEMS) {
    let pay = 0;
    for (const c of cost) if (c.item === i) pay += c.mu;
    const left = sim.stock[i]! - pay + refunds[i]!;
    if (left < need[i]!) out.push({ item: i, mu: need[i]! - left });
  }
  return out;
}

/** Does the base hold its reserve (the invariant)? */
export const reserveHolds = (sim: Sim): boolean => reserveShort(sim, []).length === 0;
