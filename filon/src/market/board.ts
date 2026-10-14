// board.ts — « Ce qui rapporte », the What-pays board (design §6). For each recipe asked for,
// at the current prices:
//   margin/min/machine = c·[Σ outs·bid − Σ ins·(bid if made at home, else ask)] − kW·c_E
// (c = crafts per minute; a home-made input is valued at what selling it would bring), and
// ◉ per raw tile-minute: what one machine's whole home-made chain earns per deposit tile it
// occupies — outputs at the bid, minus what the chain buys at the ask and the energy every
// machine of the chain draws, over the tiles its mined ores need (the tile caps are the real
// constraint: §1, « world time »). Home-made inputs are expanded through their primary recipe
// (the first that makes them) down to raw items; raw items are mined, at the deposit caps of
// content/world.ts `tileCapsPerMin` (BAL.depositRich: the drills' own numbers; stone and water come
// from digging and pumps, not from tiles).
// Each row also says what the player's own export flow does to the output's price:
// r(x)/r(0) − 1, the « at your 120/min the price is −14 % » line. Floats in ◉: display only.
import { ITEMS } from '@/content/items';
import { tileCapsPerMin } from '@/content/world';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import { itemIdx } from '@/content/registry';
import type { BuildingDef, RecipeDef } from '@/content/types';
import type { MarketEngine } from './engine';
import { lnEquilibrium } from './pricing';
import type { BoardOptions, BoardRow } from './types';

const recipeDefs = RECIPES as Record<string, RecipeDef>;

/** The first recipe making each item: how a home-made input is assumed to be produced. */
const PRIMARY = new Map<string, RecipeDef>();
/** Mined from the land: an ore the sifter also gets out of stone (D70) still counts as mined. */
const MINED = new Set(['ore', 'fuel', 'rubble', 'fluid', 'unique']);
for (const r of Object.values(recipeDefs)) {
  for (const [o] of r.outs) if (!PRIMARY.has(o) && !MINED.has((ITEMS as Record<string, { kind: string }>)[o]?.kind ?? '')) PRIMARY.set(o, r);
}

/** Energy one machine running the recipe draws (kW): its building's draw, or the recipe's own energy per craft. */
function recipeKw(r: RecipeDef, cyclesPerMin: number): number {
  const kw = (BUILDINGS as Record<string, BuildingDef>)[r.machines[0]!]?.kw ?? 0;
  return Math.max(kw, (r.energyKwMin ?? 0) * cyclesPerMin);
}

/** What one unit of an item made at home costs upstream: mined raw items, bought inputs (◉ at the ask), energy (kW·min). */
interface Chain { readonly raw: ReadonlyMap<string, number>; readonly bought: number; readonly kwMin: number }

export function board(eng: MarketEngine, recipes: readonly string[], energyCost: number, opts: BoardOptions = {}): BoardRow[] {
  const h = opts.home;
  const home = h === undefined ? (): boolean => true : typeof h === 'function' ? h : (it: string): boolean => h.has(it);
  const caps = { ...tileCapsPerMin(), ...opts.tileCaps };
  const speed = (opts.craftSpeed ?? 1000) / 1000;
  const bid = (it: string): number => eng.bid[itemIdx(it)]! / 100;
  const ask = (it: string): number => eng.ask[itemIdx(it)]! / 100;

  const memo = new Map<string, Chain>();
  const chain = (item: string, depth = 0): Chain => {
    const known = memo.get(item);
    if (known) return known;
    const r = PRIMARY.get(item);
    let out: Chain;
    if (!r || depth > 16) out = { raw: new Map([[item, 1]]), bought: 0, kwMin: 0 };
    else {
      const per = 1 / (r.outs.find(([o]) => o === item)![1]);
      const raw = new Map<string, number>();
      let bought = 0;
      let kwMin = (recipeKw(r, 60 / r.seconds) * r.seconds) / 60 * per;
      for (const [it, q] of r.ins) {
        if (!home(it)) { bought += q * per * ask(it); continue; }
        const c = chain(it, depth + 1);
        for (const [rawIt, n] of c.raw) raw.set(rawIt, (raw.get(rawIt) ?? 0) + n * q * per);
        bought += c.bought * q * per;
        kwMin += c.kwMin * q * per;
      }
      out = { raw, bought, kwMin };
    }
    memo.set(item, out);
    return out;
  };

  const rows = recipes.map((id): BoardRow => {
    const r = recipeDefs[id];
    if (!r) throw new Error(`board: unknown recipe ${id}`);
    const c = (60 / r.seconds) * speed;
    const out = r.outs[0]![0];
    const kw = recipeKw(r, c);
    let revenue = 0, inputs = 0, buys = 0, chainKw = kw;
    const raw = new Map<string, number>();
    for (const [it, q] of r.outs) revenue += c * q * bid(it);
    for (const [it, q] of r.ins) {
      if (!home(it)) { inputs += c * q * ask(it); buys += c * q * ask(it); continue; }
      inputs += c * q * bid(it);
      const ch = chain(it);
      for (const [rawIt, n] of ch.raw) raw.set(rawIt, (raw.get(rawIt) ?? 0) + n * c * q);
      buys += ch.bought * c * q;
      chainKw += ch.kwMin * c * q;
    }
    let tiles = 0;
    for (const [rawIt, perMin] of raw) {
      const cap = caps[rawIt] ?? 0;
      if (cap > 0) tiles += perMin / cap;
    }
    const energy = kw * energyCost;
    // The output's price with and without the player's own flow, at today's depths and events.
    const oi = itemIdx(out);
    const flow = opts.flows?.[out] ?? eng.lastX[oi]!;
    let impact = 0;
    if (eng.tradable[oi] && flow > 0) {
      const S = eng.S0[oi]! * eng.eS[oi]!, D = eng.D0[oi]! * eng.eD[oi]!, m = eng.lastM[oi]!;
      impact = Math.exp(lnEquilibrium(S, D, flow, m) - lnEquilibrium(S, D, 0, m)) - 1;
    }
    return {
      recipe: id, item: out, machine: r.machines[0]!, cycles: c,
      revenue, inputs, energy, margin: revenue - inputs - energy,
      tiles, perTile: tiles > 0 ? (revenue - buys - chainKw * energyCost) / tiles : null,
      flow, impact,
    };
  });
  // Best ◉ per raw tile-minute first; rows that use no tile (all inputs bought) after, by margin.
  const order = new Map(recipes.map((id, k) => [id, k]));
  return rows.sort((a, b) => {
    if (a.perTile !== null && b.perTile !== null) return b.perTile - a.perTile || order.get(a.recipe)! - order.get(b.recipe)!;
    if (a.perTile !== null) return -1;
    if (b.perTile !== null) return 1;
    return b.margin - a.margin || order.get(a.recipe)! - order.get(b.recipe)!;
  });
}
