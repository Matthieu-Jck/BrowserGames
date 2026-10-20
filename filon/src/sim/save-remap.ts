// save-remap.ts — saves that survive content changes (D47). A save holds dense content indices
// (an entity's `def`, a machine's recipe and a router's filters in `cfg`, items in stocks,
// stores, ribbons, buffers, orders…), which only mean something against the registry order they
// were written with. So every save carries that table (`SaveData.content`: item, building and
// recipe ids in registry order, plus each recipe's inputs and outputs by item id), and loading
// rewrites every index through id → index maps when the table differs from today's. Inserting or
// reordering content is then free; renaming follows `RENAMED` (content/retired.ts).
//
// What no longer exists does not vanish silently (ARCHITECTURE invariant 4): a building whose id is
// gone comes down, refunded at its recorded cost (`RETIRED_COSTS`), its store and buffers handed to
// the Heart, and a fuel generator's box too (`RETIRED_FUEL`: the coal generator, D143); a machine
// whose recipe changed or is gone is cleared, its buffers handed to the Heart (and a craft under way's
// inputs, as in play: a retired recipe's counts from `RETIRED_RECIPES`, D151); what is held of an
// item whose id is gone is counted in the note the player is shown — or, for research's retired
// data (D122, `RETIRED_ITEM_TOKENS`), banked as tokens for research.
//
// `FIELDS` declares every SaveData field, typed against SaveData: a new field does not compile
// until it says whether it holds indices — the guard that keeps this file complete.
import { BUILDINGS } from '@/content/buildings';
import { BUILDING_IDS, CRECIPES, ITEM_IDS, RECIPE_IDS, recipesFor, type CRecipe } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import { RENAMED, RETIRED_COSTS, RETIRED_FUEL, RETIRED_ITEM_TOKENS, RETIRED_RECIPES } from '@/content/retired';
import type { BuildingDef, RecipeDef } from '@/content/types';
import { filterOf, recipeOf, withFilter, withRecipe } from './cfg';
import type { SaveData } from './serialize';

/** The registry as a save was written against it (ids in index order). */
export interface ContentTable {
  items: string[];
  buildings: string[];
  recipes: string[];
  /** Per recipe: « in,in>out » by item id (a machine's buffers follow its recipe's slots). */
  recipeSigs: string[];
}

/** What a load had to change, for the player (null: nothing). */
export interface RemapNote {
  /** Buildings whose id is gone: how many came down, and whether their cost was refunded. */
  removed: Array<{ id: string; n: number; refunded: boolean }>;
  /** Items whose id is gone, and the milli-items of them the base still held. */
  lost: Array<{ id: string; mu: number }>;
  /** Recipes changed or gone: their machines were cleared, buffers to the Heart. */
  reset: string[];
  /** Retired items turned into tokens banked for research (D122: the data), the milli-items held and the tokens they made. Absent: none. */
  converted?: Array<{ id: string; mu: number; tokens: number }>;
}

export interface Retired {
  renamed: { items: Readonly<Record<string, string>>; buildings: Readonly<Record<string, string>>; recipes: Readonly<Record<string, string>> };
  costs: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>>;
  /** Items gone whose holdings become research tokens (D122): tokens per item. */
  tokens?: Readonly<Record<string, number>>;
  /** Fuel generators gone: the item their box held (D143), handed to the Heart. */
  fuel?: Readonly<Record<string, string>>;
  /** Recipes gone: what one craft took in (D151), handed back for a craft under way. */
  recipes?: Readonly<Record<string, { readonly ins: ReadonlyArray<readonly [string, number]> }>>;
}

/** 'index': holds content indices (re-pointed); 'refs': entity ids only (filtered when a building comes down); 'plain': neither. */
type Kind = 'plain' | 'index' | 'refs';

/** Every field of a save, and what the remap does with it. */
export const FIELDS: { readonly [K in keyof Required<SaveData>]: Kind } = {
  v: 'plain', worldSeed: 'plain', playerSeed: 'plain', mapV: 'plain', foundingEpoch: 'plain', colonyName: 'plain', emblem: 'plain', tick: 'plain',
  credits: 'plain', hearthLevel: 'plain', hearthId: 'plain', nextId: 'plain', content: 'plain',
  ents: 'index', portItems: 'index', stock: 'index', stores: 'index', selling: 'index', acc: 'refs', links: 'refs',
  done: 'plain', terrainDiff: 'plain', levelDiff: 'plain', oreDiff: 'index', land: 'plain',
  nodes: 'index', chains: 'index', produced: 'index', consumed: 'index', projects: 'index', tokens: 'plain', labQueue: 'refs',
  costFloor: 'plain', costFloorD129: 'plain', notes: 'plain', respecs: 'plain', lastRespec: 'plain', designated: 'plain', jobs: 'refs',
  market: 'plain', trade: 'index', quests: 'plain', value: 'plain', expertise: 'plain',
  deliveries: 'plain', ranking: 'plain', // D153: items by id, never by index
  gleaners: 'index',
  blueprints: 'plain', // by content ids (D154): nothing to re-point
};

/** The same for the trade section. */
export const TRADE_FIELDS: { readonly [K in keyof Required<NonNullable<SaveData['trade']>>]: Kind } = {
  cargo: 'index', orders: 'index', nextOrderId: 'plain', inflight: 'index', sold: 'index', bought: 'index',
  ledger: 'index', activity: 'refs', earned: 'plain', spent: 'plain', soldTotal: 'index', boughtTotal: 'index', floors: 'index',
  autoSell: 'index', starterTaken: 'plain',
};

const sigOf = (r: CRecipe): string =>
  `${r.ins.map((i) => ITEM_IDS[i.item]).join(',')}>${r.outs.map((o) => ITEM_IDS[o.item]).join(',')}`;

let today: ContentTable | null = null;

/** Today's table (the registry's order). */
export function contentTable(): ContentTable {
  return (today ??= {
    items: [...ITEM_IDS], buildings: [...BUILDING_IDS], recipes: [...RECIPE_IDS], recipeSigs: CRECIPES.map(sigOf),
  });
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function sameTable(a: ContentTable, b: ContentTable): boolean {
  return sameList(a.items, b.items) && sameList(a.buildings, b.buildings) && sameList(a.recipes, b.recipes) && sameList(a.recipeSigs, b.recipeSigs);
}

/** from index → to index (−1: gone), an exact id first, then its new name. */
function indexMap(from: readonly string[], to: readonly string[], renamed: Readonly<Record<string, string>>): Int32Array {
  const at = new Map(to.map((id, i) => [id, i]));
  return Int32Array.from(from, (id) => at.get(id) ?? at.get(renamed[id] ?? '') ?? -1);
}

const kindOf = (id: string | undefined): BuildingDef | undefined =>
  id === undefined ? undefined : (BUILDINGS as Readonly<Record<string, BuildingDef>>)[id];

/**
 * The save rewritten against `to` (today's table by default) and what had to change. A save
 * written against `to` (or without a table: written before D47 by this very content) comes back
 * as it is.
 */
export function remapSave(d: SaveData, to: ContentTable = contentTable(), retired: Retired = { renamed: RENAMED, costs: RETIRED_COSTS, tokens: RETIRED_ITEM_TOKENS, fuel: RETIRED_FUEL, recipes: RETIRED_RECIPES }): { data: SaveData; note: RemapNote | null } {
  const from = d.content;
  if (!from) return { data: { ...d, content: to }, note: null };
  if (sameTable(from, to)) return { data: d, note: null };

  const IM = indexMap(from.items, to.items, retired.renamed.items);
  const BM = indexMap(from.buildings, to.buildings, retired.renamed.buildings);
  // A recipe survives only if it still takes and makes the same items in the same slots.
  const RM = indexMap(from.recipes, to.recipes, retired.renamed.recipes);
  const normSig = (s: string): string => s.replace(/[^,>]+/g, (id) => (to.items.includes(id) ? id : retired.renamed.items[id] ?? id));
  for (let r = 0; r < RM.length; r++) if (RM[r]! >= 0 && normSig(from.recipeSigs[r] ?? '') !== to.recipeSigs[RM[r]!]) RM[r] = -1;

  const NT = to.items.length;
  const item = (i: number): number => (i < 0 ? -1 : IM[i] ?? -1);
  const lost = new Map<string, number>();
  // Research's retired data (D122): what is held of it anywhere is banked as tokens, not lost.
  const converted = new Map<string, number>();
  const lose = (i: number, mu: number): void => {
    if (mu <= 0) return;
    const id = from.items[i] ?? `#${i}`;
    const into = retired.tokens?.[id] ? converted : lost;
    into.set(id, (into.get(id) ?? 0) + mu);
  };
  /** Milli-items handed to the Heart (to-indices): stores and buffers of what came down, refunds. */
  const refund = new Array<number>(NT).fill(0);
  const give = (fromItem: number, mu: number): void => {
    if (mu <= 0) return;
    const j = item(fromItem);
    if (j >= 0) refund[j]! += mu; else lose(fromItem, mu);
  };
  const dense = (arr: readonly number[], keepLoss: boolean): number[] => {
    const out = new Array<number>(NT).fill(0);
    arr.forEach((v, i) => {
      if (!v) return;
      const j = item(i);
      if (j >= 0) out[j]! += v; else if (keepLoss) lose(i, v);
    });
    return out;
  };
  const recipeItems = (r: number): number[][] => {
    const [ins = '', outs = ''] = (from.recipeSigs[r] ?? '>').split('>');
    const idx = (s: string): number[] => (s ? s.split(',').map((id) => from.items.indexOf(id)) : []);
    return [idx(ins), idx(outs)];
  };

  /**
   * What one craft of recipe r (the save's index) took in, by the save's item index: the table holds
   * ids, not counts, so a retired recipe's come from `retired.recipes` (D151), else today's recipe of
   * that id (or its new name) for the inputs it still shares with the old one. Unknown: none.
   */
  const craftIns = (r: number): Array<[number, number]> => {
    const id = from.recipes[r] ?? '';
    const gone = retired.recipes?.[id];
    if (gone) return gone.ins.map(([it, q]) => [from.items.indexOf(it), Math.round(q * 1000)]);
    const now = (RECIPES as Readonly<Record<string, RecipeDef>>)[retired.renamed.recipes[id] ?? id];
    const [ins = ''] = (from.recipeSigs[r] ?? '>').split('>');
    const old = ins ? ins.split(',') : [];
    return (now?.ins ?? []).filter(([it]) => old.includes(it)).map(([it, q]) => [from.items.indexOf(it), Math.round(q * 1000)]);
  };
  // Entities: today's def, cfg re-pointed; what is gone comes down, refunded.
  const gone = new Set<number>();
  /** What each fallen entity was (its building id in the save's table). */
  const goneDef = new Map<number, string>();
  const oldCfg = new Map<number, number>();
  const reset = new Set<string>();
  const resetEnts = new Set<number>();
  const removed = new Map<string, { n: number; refunded: boolean }>();
  const ents: number[] = [];
  for (let i = 0; i < d.ents.length; i += 7) {
    const id = d.ents[i]!, def = d.ents[i + 1]!;
    let cfg = d.ents[i + 5]!;
    oldCfg.set(id, cfg);
    const nd = BM[def] ?? -1;
    if (nd < 0) {
      gone.add(id);
      const bid = from.buildings[def] ?? `#${def}`;
      goneDef.set(id, bid);
      const cost = retired.costs[bid];
      const r = removed.get(bid) ?? { n: 0, refunded: !!cost };
      r.n++;
      removed.set(bid, r);
      for (const [it, q] of cost ?? []) give(from.items.indexOf(it), Math.round(q * 1000));
      continue;
    }
    const b = kindOf(to.buildings[nd]);
    if (b?.kind === 'machine') {
      const r = recipeOf(cfg);
      if (r > 0) {
        let nr = RM[r - 1] ?? -1;
        // A recipe the machine no longer offers (machines specialised, D70) clears it too.
        if (nr >= 0 && to === today && !recipesFor(nd).some((c) => CRECIPES.indexOf(c) === nr)) nr = -1;
        if (nr < 0) { reset.add(from.recipes[r - 1] ?? `#${r - 1}`); resetEnts.add(id); cfg = withRecipe(cfg, 0); }
        else cfg = withRecipe(cfg, nr + 1);
      }
    } else if (b?.kind === 'fork') {
      const logic = b.logic ?? 'router';
      const sides = logic === 'router' || logic === 'distributor' ? 4 : 1;
      for (let s = 0; s < sides; s++) { const it = filterOf(cfg, s); if (it >= 0) cfg = withFilter(cfg, s, item(it)); }
    }
    ents.push(id, nd, d.ents[i + 2]!, d.ents[i + 3]!, d.ents[i + 4]!, cfg, d.ents[i + 6]!);
  }
  const alive = (id: number): boolean => !gone.has(id);

  // Node states: a cleared or fallen machine hands its buffers (old slots) to the Heart; a routing
  // block's held item follows its id.
  const nodes: Array<[number, unknown]> = [];
  for (const [ent, s] of d.nodes) {
    const o = s as Record<string, unknown> | null;
    if (o && Array.isArray(o.inBuf) && Array.isArray(o.outBuf)) {
      // Its waste bin (D125) holds an item by index: re-pointed, or handed to the Heart with the rest.
      const wMu = typeof o.wBuf === 'number' && typeof o.wItem === 'number' ? o.wBuf : 0;
      if (alive(ent) && !resetEnts.has(ent)) {
        if (wMu <= 0) { nodes.push([ent, s]); continue; }
        const j = item(o.wItem as number);
        if (j < 0) { lose(o.wItem as number, wMu); nodes.push([ent, { ...o, wBuf: 0, wItem: -1 }]); }
        else nodes.push([ent, { ...o, wItem: j }]);
        continue;
      }
      if (wMu > 0) give(o.wItem as number, wMu);
      const r = recipeOf(oldCfg.get(ent) ?? 0);
      if (r > 0) {
        const [ins, outs] = recipeItems(r - 1);
        (o.inBuf as number[]).forEach((mu, k) => give(ins![k] ?? -1, mu));
        (o.outBuf as number[]).forEach((mu, k) => give(outs![k] ?? -1, mu));
      }
        // A craft under way had taken its inputs in: back to the Heart, as `refundNode` does in play.
        if (o.crafting === true) for (const [it, mu] of craftIns(r - 1)) give(it, mu);
      continue;
    }
    if (o && typeof o.item === 'number' && typeof o.mu === 'number' && 'turn' in o) {
      if (!alive(ent)) { give(o.item, o.mu); continue; }
      const j = item(o.item);
      if (o.item >= 0 && j < 0) { lose(o.item, o.mu); nodes.push([ent, { ...o, item: -1, mu: 0 }]); }
      else nodes.push([ent, { ...o, item: j }]);
      continue;
    }
    // A fallen fuel generator's box (D143: the coal generator's coal) goes to the Heart: the content
    // no longer says what it burnt, `RETIRED_FUEL` does.
    if (!alive(ent)) {
      const fuel = retired.fuel?.[goneDef.get(ent) ?? ''];
      if (fuel && o && typeof o.fuel === 'number') give(from.items.indexOf(fuel), o.fuel);
      continue;
    }
    nodes.push([ent, s]);
  }

  // Stores: items re-pointed; a fallen building's store goes to the Heart.
  const stores: Array<[number, number[]]> = [];
  for (const [id, st] of d.stores) {
    if (alive(id)) stores.push([id, dense(st, true)]);
    else st.forEach((mu, i) => give(i, mu));
  }
  // A trade post's entrance, what it brought to sell (D131): the same.
  const selling: Array<[number, number[]]> | undefined = d.selling && [];
  for (const [id, st] of d.selling ?? []) {
    if (alive(id)) selling!.push([id, dense(st, true)]);
    else st.forEach((mu, i) => give(i, mu));
  }

  const links: number[] = [];
  const wires = d.links ?? [];
  for (let i = 0; i + 1 < wires.length; i += 2) if (alive(wires[i]!) && alive(wires[i + 1]!)) links.push(wires[i]!, wires[i + 1]!);

  const chains = d.chains.map((c) => {
    // A line is keyed by its tier, a building index too (a ribbon's def): re-pointed with the buildings.
    const tier = BM[c.tier] ?? -1;
    const out: SaveData['chains'][number] = { ...c, tier: tier >= 0 ? tier : c.tier };
    if (c.runs) {
      const runs: number[] = [];
      for (let i = 0; i < c.runs.length; i += 4) {
        const j = item(c.runs[i]!);
        if (j < 0) { lose(c.runs[i]!, c.runs[i + 1]!); continue; }
        runs.push(j, c.runs[i + 1]!, c.runs[i + 2]!, c.runs[i + 3]!);
      }
      out.runs = runs;
    }
    // A ribbon's cells hold item + 1 (0: empty); an item gone from the content leaves its cell empty.
    if (c.cells) out.cells = c.cells.map((v) => { if (v <= 0) return 0; const j = item(v - 1); if (j < 0) { lose(v - 1, 1000); return 0; } return j + 1; });
    if (c.stage) { const j = item(c.stage[0]); if (j < 0) { lose(c.stage[0], c.stage[1]); delete out.stage; } else out.stage = [j, c.stage[1]]; }
    return out;
  });

  // A project whose lab came down (a retired lab: the 2×2 one, D84) is cancelled as taking the lab
  // down in play cancels it: the data it had paid go back to the Heart (nothing vanishes).
  for (const p of d.projects ?? []) {
    if (alive(p.lab)) continue;
    for (let k = 0; 2 * k < p.cost.length; k++) give(p.cost[2 * k]!, p.paid[k] ?? 0);
  }
  const projects = (d.projects ?? []).filter((p) => alive(p.lab)).map((p) => {
    const cost: number[] = [], paid: number[] = [];
    for (let k = 0; 2 * k < p.cost.length; k++) {
      const j = item(p.cost[2 * k]!);
      if (j < 0) { lose(p.cost[2 * k]!, p.paid[k] ?? 0); continue; }
      cost.push(j, p.cost[2 * k + 1]!);
      paid.push(p.paid[k] ?? 0);
    }
    return { ...p, cost, paid };
  });

  const stock = dense(d.stock, true);
  const t = d.trade;
  const trade: SaveData['trade'] = t && {
    ...t,
    // A post's cargo; a gone item leaves it (its goods were refunded with the store's).
    cargo: (t.cargo ?? []).filter(([post]) => alive(post)).map(([post, items]) => [post, items.map(item).filter((i) => i >= 0).sort((a, b) => a - b)] as [number, number[]]),
    orders: t.orders.filter((o) => alive(o.post) && item(o.item) >= 0).map((o) => ({ ...o, item: item(o.item) })),
    inflight: t.inflight.filter((x) => {
      if (item(x.item) >= 0 && alive(x.post)) return true;
      if (item(x.item) < 0) lose(x.item, x.mu); else give(x.item, x.mu); // a fallen post's delivery lands in the Heart
      return false;
    }).map((x) => ({ ...x, item: item(x.item) })),
    sold: dense(t.sold, false),
    bought: dense(t.bought, false),
    ledger: t.ledger.filter((l) => item(l.item) >= 0).map((l) => ({ ...l, item: item(l.item) })),
    activity: t.activity.filter(([post]) => alive(post)),
    ...(t.soldTotal ? { soldTotal: dense(t.soldTotal, false) } : {}),
    ...(t.boughtTotal ? { boughtTotal: dense(t.boughtTotal, false) } : {}),
    ...(t.floors ? { floors: t.floors.filter(([it]) => item(it) >= 0).map(([it, c]) => [item(it), c] as [number, number]) } : {}),
    // Auto-sell (D127): a gone item's setting goes with it.
    ...(t.autoSell ? { autoSell: t.autoSell.filter(([it]) => item(it) >= 0).map(([it, at]) => [item(it), at] as [number, number]) } : {}),
  };

  for (let j = 0; j < NT; j++) stock[j]! += refund[j]!;
  // Whole tokens for the data banked (D122), at the frozen rate per item (a part of an item counts its part).
  const conv = [...converted].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, mu]) => ({ id, mu, tokens: Math.floor((mu * (retired.tokens?.[id] ?? 0)) / 1000) }));
  const banked = conv.reduce((s, c) => s + c.tokens, 0);
  const data: SaveData = {
    ...d,
    content: to,
    ents,
    portItems: d.portItems.filter(([id]) => alive(id)).map(([id, its]) => [id, its.map(item)] as [number, number[]]),
    stock,
    stores,
    ...(selling ? { selling } : {}),
    acc: d.acc.filter(([id]) => alive(id)),
    links,
    oreDiff: d.oreDiff.map(([tile, v]) => {
      const ore = (v >>> 16) - 1, j = item(ore);
      return [tile, ore < 0 ? v : j < 0 ? 0 : ((j + 1) << 16) | (v & 0xffff)] as [number, number];
    }),
    nodes,
    chains,
    produced: dense(d.produced, false),
    consumed: dense(d.consumed, false),
    projects,
    jobs: (d.jobs ?? []).filter((j) => alive(j.ent)),
    ...(banked > 0 ? { tokens: { serverAcc: 0, held: false, plan: false, ...d.tokens, bank: (d.tokens?.bank ?? 0) + banked } } : {}),
    ...(d.labQueue ? { labQueue: d.labQueue.filter(([id]) => alive(id)) } : {}),
    ...(trade ? { trade } : {}),
    // The Gleaners' counts (D103): per item, re-pointed like the statistics.
    ...(d.gleaners ? { gleaners: { ...d.gleaners, gleaned: dense(d.gleaners.gleaned, false), ...(d.gleaners.dusk ? { dusk: dense(d.gleaners.dusk, false) } : {}), ...(d.gleaners.dawn ? { dawn: dense(d.gleaners.dawn, false) } : {}) } } : {}),
  };
  const note: RemapNote = {
    removed: [...removed].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, r]) => ({ id, ...r })),
    lost: [...lost].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, mu]) => ({ id, mu })),
    reset: [...reset].sort(),
    ...(conv.length ? { converted: conv } : {}),
  };
  const empty = !note.removed.length && !note.lost.length && !note.reset.length && !conv.length;
  return { data, note: empty ? null : note };
}
