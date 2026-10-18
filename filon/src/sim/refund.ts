// refund.ts — what taking a building down gives back of its construction: its cost when it was put
// up (D123). Removal refunds in full (ARCHITECTURE.md, invariant 4), and in full means what was
// paid: a building standing from before a change of price (its entity id under the colony's
// `costFloor` for D123's, `costFloorD129` for D129's, sim/state.ts) refunds its old cost
// (content/past-costs.ts), never today's — the change neither robs a standing base nor turns its old
// buildings into a mint of the new materials.
// One function, read wherever a refund is counted: the removal itself and the previews and budgets
// that net a replaced building's refund (systems/build.ts, systems/belt-plan.ts, input/tools.ts).
import { COSTS_BEFORE_D123, COSTS_BEFORE_D129 } from '@/content/past-costs';
import { BUILDING_IDS, costOf, itemIdx, toMu } from '@/content/registry';

type Cost = Array<{ item: number; mu: number }>;

type Table = Readonly<Partial<Record<string, ReadonlyArray<readonly [string, number]>>>>;
/** Per building index: its cost in a past table, compiled; null when that change left its price alone. */
const compile = (t: Table): ReadonlyArray<Cost | null> => BUILDING_IDS.map((id) => {
  const c = t[id];
  return c ? c.map(([it, q]) => ({ item: itemIdx(it), mu: toMu(q) })) : null;
});
const BEFORE_D123 = compile(COSTS_BEFORE_D123);
const BEFORE_D129 = compile(COSTS_BEFORE_D129);

/** A colony's price floors: the first entity ids placed under D123's prices and under D129's (sim/state.ts). */
export interface CostFloors { readonly costFloor: number; readonly costFloorD129: number }

/**
 * The construction cost entity `e` refunds when it comes down: its building's price when it went up —
 * the oldest change it stands from before that changed its building's price, else today's.
 */
export function refundCost(floors: CostFloors, e: { readonly id: number; readonly def: number }): Cost {
  return (e.id < floors.costFloor ? BEFORE_D123[e.def] : null) ?? (e.id < floors.costFloorD129 ? BEFORE_D129[e.def] : null) ?? costOf(e.def);
}
