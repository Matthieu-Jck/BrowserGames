// refund.ts — what taking a building down gives back of its construction: its cost when it was put
// up (D123). Removal refunds in full (ARCHITECTURE.md, invariant 4), and in full means what was
// paid: a building standing from before a change of price (its entity id under the colony's
// `costFloor`, sim/state.ts) refunds its old cost (content/past-costs.ts), never today's — the
// change neither robs a standing base nor turns its old buildings into a mint of the new materials.
// One function, read wherever a refund is counted: the removal itself and the previews and budgets
// that net a replaced building's refund (systems/build.ts, systems/belt-plan.ts, input/tools.ts).
import { COSTS_BEFORE_D123 } from '@/content/past-costs';
import { BUILDING_IDS, costOf, itemIdx, toMu } from '@/content/registry';

type Cost = Array<{ item: number; mu: number }>;

/** Per building index: its cost before D123, compiled; null when D123 left its price alone. */
const BEFORE_D123: ReadonlyArray<Cost | null> = BUILDING_IDS.map((id) => {
  const c = (COSTS_BEFORE_D123 as Readonly<Record<string, ReadonlyArray<readonly [string, number]> | undefined>>)[id];
  return c ? c.map(([it, q]) => ({ item: itemIdx(it), mu: toMu(q) })) : null;
});

/** The construction cost entity `e` refunds when it comes down: its building's price when it went up. */
export function refundCost(costFloor: number, e: { readonly id: number; readonly def: number }): Cost {
  return (e.id < costFloor ? BEFORE_D123[e.def] : null) ?? costOf(e.def);
}
