// usable.ts — nothing unusable (D107; owner, 2026-10-17: « il faut s'assurer qu'un joueur ne
// puisse pas débloquer, dans le tech tree, quelque chose qu'il ne peut pas utiliser. S'il ne peut
// pas extraire la ressource qu'une machine utilise, il faut au moins qu'il puisse l'acheter, sinon
// c'est inutile »). For every node of the unlock tree — plan or research — what it unlocks must
// work with what the base can have by then, in the order the tree imposes:
//   · a building it unlocks can be paid for — every cost item usable, or in the Heart's starting
//     stock (a one-off payment: the stock pays the first plans, D36) — a crafting machine has at least
//     one recipe it can run, and a generator its fuel (and a steam boiler its water, D114);
//   · a recipe it unlocks has a machine the base can build and every input usable;
//   · a Heart level it gives can be paid for;
//   · a research node's resources (D122: paid from the Core at its launch) can be had before it —
//     extracted, made or bought with what its prerequisites and the plans give;
//   · a feature it turns on (a flag, an addition, a research slot) has what it acts on: the
//     excavator for digging bits, a server for the token plans (D105: no token is billed before),
//     the pylon for a longer reach (`FEATURE_NEEDS`, which names every feature the tree uses).
// An item is USABLE when it is extractable (a machine known that mines, collects or digs it — the
// land's common deposits, the bare ground's sand, water), made (a
// recipe known, on a machine the base can build, from usable inputs) or buyable (traded at the
// Crier — a depth, a colony that supplies it — with a trade post the base can build). What only
// some maps hold — the T3/T4 uniques, the quartz of a cliff face (map 3's vein; maps 1–2 have none)
// — counts as buyable only. « By then » is the node's own closure: a plan knows its prerequisites
// (and theirs); a research node knows every plan (the lab's gate needs them all, D71) and its
// prerequisites, the tier gates included. Pure content: run by validateContent, pinned by
// validate.test.ts.
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { COLONY_PROFILES } from './colonies';
import { ITEMS } from './items';
import { RECIPES, recipeMakes } from './recipes';
import { PLAN_IDS, RESEARCH, buildingsUnlockedBy, isPlan, planDef, researchNode, treePrereq } from './research';
import { CIRQUE, COMMON_DEPOSITS } from './world';
import type { BuildingDef, Effect, ItemDef, RecipeDef } from './types';

/**
 * What each feature of the tree acts on (an effect's flag, its `add` target, or `slots`): one of these
 * buildings must be buildable by the node that turns it on. `[]`: nothing to build (a readout, the
 * land, the Core's own outlet). A feature missing here fails validation — a new one says what it needs.
 */
export const FEATURE_NEEDS: Readonly<Record<string, readonly string[]>> = {
  // The analytics readouts (D41): they read the base.
  telemetry: [], statistics: [], power_log: [], diagnostics: [], anemometry: [],
  // The land (D60): parcels are bought and leased from the start.
  lease: [], neighbourCrossing: [], farClaims: [],
  // Digging deeper: the excavator's bits; filling deep water: the backfiller.
  digH3: ['excavator', 'heavy_excavator'], basaltBits: ['excavator', 'heavy_excavator'], digH4: ['excavator', 'heavy_excavator'],
  deepFill: ['backfiller'],
  // The Crier's features: a trade post to sell from and buy into.
  orders: ['trade_post'], floorPrices: ['trade_post'], post2: ['trade_post'], tradeL2: ['trade_post'], tradeL3: ['trade_post'],
  expressFreight: ['trade_post'], post3: ['trade_post'], forecast: ['trade_post'],
  // Auto-sell (D127): the Core sells its own surplus, no post needed.
  autoSell: [],
  // The token plans: no token is billed before the servers (D105), and rental sells what they leave.
  tokenPlan: ['server', 'cooled_server', 'supercomputer'], serverRental: ['server', 'cooled_server', 'supercomputer'],
  // Research itself: a lab.
  researchQueue: ['observatory'], slots: ['observatory'],
  // The Core's compute (D122: its level 2, the player's from the start, D101): it needs nothing built.
  coreCompute: [],
  // Reaches: the skybridge's span, the pylon's link.
  bridgeSpan: ['skybridge'], pylonLink: ['pylon'],
};

const items = ITEMS as Record<string, ItemDef>;
const buildings = Object.entries(BUILDINGS) as Array<[string, BuildingDef]>;
const recipes = Object.entries(RECIPES) as Array<[string, RecipeDef]>;
const B = BUILDINGS as Record<string, BuildingDef>;

/** An effect's feature key: its flag, its `add` target, `slots`; '' for a bare multiplier or an unlock. */
export const featureKey = (ef: Effect): string => (ef.k === 'flag' ? ef.flag : ef.k === 'add' ? ef.target : ef.k === 'slots' ? 'slots' : '');

/** Only on some maps: the uniques of the far biomes, the ores set in cliff faces (D87). Usable only when buyable. */
export const mapSpecific = (item: string): boolean => items[item]?.kind === 'unique' || !!items[item]?.face;

/** Items the land holds on every map: the cirque's deposits and the common ones past the Crown. */
const DEPOSIT_ITEMS: ReadonlySet<string> = new Set([...CIRQUE.deposits.map((d) => d.item), ...COMMON_DEPOSITS.map(([it]) => it)]);

/** What a building takes from the land, on every map (its kind and its `drill`): nothing for most. */
function extracts(b: BuildingDef): string[] {
  if (b.kind === 'pump') return ['water'];
  if (b.kind === 'excavator') return ['stone']; // its rubble
  const d = b.drill;
  if (!d) return [];
  if (d.ground) return [d.ground];
  if (d.face) return []; // a cliff face's ore: not on every map
  return [...DEPOSIT_ITEMS].filter((it) => !mapSpecific(it));
}

/** Tradable at the Crier (the market's own test: a depth, not a fluid) and supplied by a colony. */
export function buyable(item: string): boolean {
  const it = items[item];
  if (!it || !(it.depth > 0) || !((it.value ?? 0) > 0) || it.kind === 'fluid') return false;
  return Object.values(COLONY_PROFILES).some((p) => p.supplies.some(([s]) => s === item) || (p.uniques as readonly string[]).includes(item));
}

/** The tree nodes a base knows by the time it takes `id` (that node included): its closure; for research, every plan too. */
export function knownAt(id: string): Set<string> {
  const out = new Set<string>([id]);
  const walk = (n: string): void => { for (const p of treePrereq(n)) if (!out.has(p)) { out.add(p); walk(p); } };
  walk(id);
  if (!isPlan(id)) for (const p of PLAN_IDS) out.add(p);
  return out;
}

/** What a base knowing these nodes can use: its buildable buildings and its usable items (a fixpoint). */
export function usableWith(known: ReadonlySet<string>): { items: Set<string>; buildings: Set<string> } {
  const has = (unlock: string): boolean => unlock === 'start' || known.has(unlock);
  const stock = new Set(Object.keys(BAL.startStock));
  const U = new Set<string>(), Bs = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    const add = (it: string): void => { if (!U.has(it)) { U.add(it); grew = true; } };
    for (const [id, b] of buildings) {
      if (Bs.has(id) || !has(b.unlock) || !b.cost.every(([it]) => U.has(it) || stock.has(it))) continue;
      Bs.add(id);
      grew = true;
    }
    for (const id of Bs) for (const it of extracts(B[id]!)) add(it);
    if ([...Bs].some((id) => B[id]!.kind === 'trade')) for (const it of Object.keys(items)) if (buyable(it)) add(it);
    for (const [, r] of recipes) {
      if (!has(r.unlock) || !r.machines.some((m) => Bs.has(m)) || !r.ins.every(([it]) => U.has(it))) continue;
      for (const o of recipeMakes(r)) add(o); // its waste too (D125): what it puts out can be used
    }
  }
  return { items: U, buildings: Bs };
}

/** Why what node `id` unlocks could not be used by then (empty when it all can). */
export function nodeUnusable(id: string): string[] {
  const known = knownAt(id);
  const { items: U, buildings: Bs } = usableWith(known);
  const has = (unlock: string): boolean => unlock === 'start' || known.has(unlock);
  const errs: string[] = [];
  const name = `${isPlan(id) ? 'plan' : 'research'} ${id}`;
  const lacks = (need: ReadonlyArray<readonly [string, number]>): string[] => need.map(([it]) => it).filter((it) => !U.has(it));
  for (const b of buildingsUnlockedBy(id)) {
    const def = B[b]!;
    const stock = new Set(Object.keys(BAL.startStock));
    const unpaid = def.cost.map(([it]) => it).filter((it) => !U.has(it) && !stock.has(it));
    if (unpaid.length) errs.push(`${name}: ${b} cannot be paid for by then (${unpaid.join(', ')})`);
    const own = recipes.filter(([, r]) => r.machines.includes(b) && has(r.unlock));
    if (def.crafts && !own.some(([, r]) => r.ins.every(([it]) => U.has(it)))) errs.push(`${name}: ${b} has no recipe it can run by then (${own.map(([rid, r]) => `${rid}: ${lacks(r.ins).join(', ') || '—'}`).join('; ') || 'none known'})`);
    if (def.gen?.fuel && !U.has(def.gen.fuel)) errs.push(`${name}: ${b} burns ${def.gen.fuel}, not to be had by then`);
    if (def.gen?.water && !U.has('water')) errs.push(`${name}: ${b} drinks water, not to be had by then`);
  }
  for (const [rid, r] of recipes) {
    if (r.unlock !== id) continue;
    const missing = lacks(r.ins);
    if (missing.length) errs.push(`${name}: recipe ${rid} needs ${missing.join(', ')}, neither extracted, made nor bought by then`);
    if (!r.machines.some((m) => Bs.has(m))) errs.push(`${name}: recipe ${rid} has no machine to be built by then (${r.machines.join(', ')})`);
  }
  BAL.hearthUpgrades.forEach((up, i) => {
    const unpaid = up.unlock === id ? lacks(up.cost) : [];
    if (unpaid.length) errs.push(`${name}: the Core's level ${i + 2} cannot be paid for by then (${unpaid.join(', ')})`);
  });
  // Its resources (D122), paid when it is launched: what the base can have before it, the node itself not yet known.
  const r = researchNode(id);
  if (r?.cost.length) {
    const before = usableWith(new Set([...known].filter((n) => n !== id))).items;
    const short = r.cost.map(([it]) => it).filter((it) => !before.has(it));
    if (short.length) errs.push(`${name}: its resources cannot be had before it (${short.join(', ')})`);
  }
  for (const ef of planDef(id)?.effects ?? researchNode(id)?.effects ?? []) {
    const key = featureKey(ef);
    if (!key) continue;
    const need = FEATURE_NEEDS[key];
    if (!need) errs.push(`${name}: feature ${key} is not in FEATURE_NEEDS (say what it acts on)`);
    else if (need.length && !need.some((b) => Bs.has(b))) errs.push(`${name}: feature ${key} needs ${need.join(' or ')}, not to be built by then`);
  }
  return errs;
}

/** Every node of the tree checked (D107): what it unlocks can be used by then. */
export function usabilityProblems(): string[] {
  return [...PLAN_IDS, ...Object.keys(RESEARCH)].flatMap(nodeUnusable);
}
