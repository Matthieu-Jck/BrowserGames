// value.ts — the claim's value, « la cote de la concession » (D50): what the player's company is
// worth at the Crier's prices, the investor's own score. It is the ocelles in hand, plus every item
// held in a store (the Heart, silos, trade posts' containers… all reservoirs) at the Crier's bid,
// plus every building at the bid value of what it cost (removal refunds it whole: a building is
// worth its materials). Research and plans are sunk; the Heart itself is CrierBelt's delivery.
// Items riding ribbons or sitting in machine buffers are left out: they are in flux, and small.
//
// Its history is sampled at epoch boundaries — every `BAL.value.everyMin` minutes, in the
// trade epoch, online and in the offline catch-up alike — so the curve covers absences too.
// It is a statistic, like `produced` / `consumed`: saved, not hashed. Mid-catch-up a store that
// feeds a line may still count the few items the line just took (offline.md, the small-store
// gap); the base's state itself stays exact. Integers only (centi-ocelles).
import { BAL } from '@/content/balance';
import { BUILDING_KIND, costOf, N_ITEMS } from '@/content/registry';
import type { Sim } from '../state';

export interface ValueState {
  /** Samples (centi-◉), oldest first, one every `BAL.value.everyMin` minutes; at most `BAL.value.points`. */
  history: number[];
  /** Absolute epoch of the newest sample (−1: none yet). */
  lastEpoch: number;
}

export const newValueState = (): ValueState => ({ history: [], lastEpoch: -1 });

/** Milli-items at a bid (centi-◉ per item), floored to whole centi-ocelles. */
const at = (mu: number, bid: number): number => Math.floor((Math.floor(mu) * bid) / 1000);

/** The claim's value now, in centi-ocelles, and its three parts. */
export function claimValue(sim: Sim): { total: number; credits: number; stock: number; plant: number } {
  const bid = sim.prices.bid;
  // Every store, item by item; an empty slot is worth nothing (D137: a silo holds one item of all
  // of them, and the catch-up samples a week of 1 680 silos), so only the held ones are priced.
  const nItems = N_ITEMS;
  const held = (st: Float64Array): number => {
    let v = 0;
    for (let i = 0, n = Math.min(st.length, nItems); i < n; i++) { const mu = st[i]!; if (mu !== 0) v += at(mu, bid[i] ?? 0); }
    return v;
  };
  let stock = held(sim.stock);
  for (const st of sim.stores.values()) stock += held(st);
  for (const st of sim.selling.values()) stock += held(st); // a post's entrance (D131)
  // Per building def, times how many stand: the same integer sum as building by building, without
  // walking a 25 k-entity base at every sample (the offline catch-up samples a week of them).
  let plant = 0;
  const counts = sim.ents.defCounts();
  for (let d = 0; d < counts.length; d++) {
    if (!counts[d] || BUILDING_KIND[d] === 'hearth') continue;
    let one = 0;
    for (const c of costOf(d)) one += at(c.mu, bid[c.item] ?? 0);
    plant += counts[d]! * one;
  }
  const credits = Math.floor(sim.credits);
  return { total: credits + stock + plant, credits, stock, plant };
}

/** At an epoch boundary (systems/trade.ts, once the new prices are in): sample when one is due. */
export function valueEpoch(sim: Sim): void {
  const v = sim.value;
  const epoch = sim.absEpoch();
  if (v.lastEpoch >= 0 && epoch - v.lastEpoch < BAL.value.everyMin) return;
  v.history.push(claimValue(sim).total);
  if (v.history.length > BAL.value.points) v.history.splice(0, v.history.length - BAL.value.points);
  v.lastEpoch = epoch;
}

export const saveValue = (v: ValueState): ValueState => ({ history: [...v.history], lastEpoch: v.lastEpoch });

export function loadValue(sim: Sim, d: ValueState | undefined): void {
  sim.value = d ? { history: d.history.map((x) => Math.floor(x)), lastEpoch: d.lastEpoch } : newValueState();
}

