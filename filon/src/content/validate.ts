// validate.ts — content invariants, checked at startup (dev) and in tests. Content mistakes
// must fail loudly: an unreachable item, a research loop, a recipe whose cycle does not
// divide the engine's 1 200-tick period (the offline catch-up needs it), a port off its
// building's edge. It also pins the design's intentional scarcities: the cirque's « tired
// vein » cannot feed one electronics workshop, a resonator needs two different unique resources and
// a nacre lattice two more — so every colony must trade. Machines are specialised: none offers more than
// `MAX_RECIPES` recipes (D70); every research node unlocks a building, a recipe or a feature,
// never a bare multiplier (D70). The unlock tree (D33) is one DAG over
// plans and research: no loop, every node reachable from the start, every building with it. And
// a base can always rebuild its production (D36): the bootstrap and CrierBelt's restart reserve
// hold together (`reserveProblems`, content/reserve.ts). The plans' paths (D41) each read as one
// line from one entry, and the analytics plans each turn on their own flag (`pathProblems`). And
// nothing the tree unlocks is unusable when it does (D107, `usabilityProblems`, content/usable.ts):
// its buildings can be paid for and run, its recipes' inputs extracted, made or bought by then.
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ITEMS } from './items';
import { NEIGHBOUR_KITS, NEIGHBOUR_MAST, NEIGHBOUR_PAD } from './neighbours';
import { questProblems } from './quests';
import { MAX_RECIPES, RECIPES } from './recipes';
import { reserveProblems } from './reserve';
import { usabilityProblems } from './usable';
import { FAMILIES, FAMILY_IDS, PLANS, RESEARCH, TIER1_WHOLE, TIER_GATE, buildingsUnlockedBy, isPlan, isResearch, isTreeNode, pathProblems, treePrereq } from './research';
import { expertiseProblems } from './expertises';
import { CIRQUE, UNIQUE_BIOMES } from './world';
import type { BuildingDef, ItemDef, PlanDef, RecipeDef, ResearchDef, ResearchTier } from './types';

const CYCLE_LCM = 1200;

/** Items mined straight from the land (deposits, unique biomes, digging, pumping, the cliff faces' veins, D87). */
export const RAW: readonly string[] = [
  'iron_ore', 'sand', 'coal', 'copper_ore', 'salt', 'stone', 'water', ...Object.values(UNIQUE_BIOMES).map((u) => u.item),
  ...(Object.entries(ITEMS) as Array<[string, ItemDef]>).filter(([, it]) => it.face).map(([id]) => id),
];

const recipes = Object.entries(RECIPES) as Array<[string, RecipeDef]>;
const research = Object.entries(RESEARCH) as Array<[string, ResearchDef]>;
const plans = Object.entries(PLANS) as Array<[string, PlanDef]>;
/** Every node of the unlock tree: plans first, then research (D33). */
const treeIds: readonly string[] = [...plans.map(([id]) => id), ...research.map(([id]) => id)];
const buildings = Object.entries(BUILDINGS) as Array<[string, BuildingDef]>;
const isUnique = (id: string): boolean => (ITEMS as Record<string, ItemDef>)[id]?.kind === 'unique';

/** Items reachable from the raw set through recipes. */
export function reachableItems(): Set<string> {
  const have = new Set(RAW);
  for (let changed = true; changed;) {
    changed = false;
    for (const [, r] of recipes) {
      if (!r.ins.every(([it]) => have.has(it))) continue;
      for (const [o] of r.outs) if (!have.has(o)) { have.add(o); changed = true; }
    }
  }
  return have;
}

/**
 * The items a base can make knowing these tree nodes (and the starting kit): what comes from the
 * land and the outputs of the recipes known, run by a machine known, from inputs it can make.
 */
export function makeableWith(known: ReadonlySet<string>): Set<string> {
  const has = (unlock: string): boolean => unlock === 'start' || known.has(unlock);
  const have = new Set(RAW);
  for (let changed = true; changed;) {
    changed = false;
    for (const [, r] of recipes) {
      if (!has(r.unlock) || !r.machines.some((m) => has((BUILDINGS as Record<string, BuildingDef>)[m]!.unlock))) continue;
      if (!r.ins.every(([it]) => have.has(it))) continue;
      for (const [o] of r.outs) if (!have.has(o)) { have.add(o); changed = true; }
    }
  }
  return have;
}

/** Every tree node a node needs, its prerequisites' prerequisites included. */
export function ancestors(id: string, out = new Set<string>()): Set<string> {
  for (const p of treePrereq(id)) if (!out.has(p)) { out.add(p); ancestors(p, out); }
  return out;
}

/** Tree nodes (plans and research) reachable from the start: their prerequisites all reachable. */
export function reachableNodes(): Set<string> {
  const learnt = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const id of treeIds) if (!learnt.has(id) && treePrereq(id).every((p) => learnt.has(p))) { learnt.add(id); changed = true; }
  }
  return learnt;
}

/** The buildings the base has from the very start, before any plan (D33: drill, ribbon, pole). */
export const startBuildings = (): string[] => buildings.filter(([, b]) => b.unlock === 'start').map(([id]) => id);

/** The plans with no prerequisite: the tree's first ring, all affordable at once from the starting stock. */
export const rootPlans = (): string[] => plans.filter(([, p]) => p.prereq.length === 0).map(([id]) => id);

/**
 * The fewest distinct unique resources an item needs (over every recipe alternative).
 * Returns the smallest set found.
 */
export function uniquesNeeded(item: string, seen = new Set<string>()): Set<string> {
  if (isUnique(item)) return new Set([item]);
  if (RAW.includes(item) || seen.has(item)) return new Set();
  const next = new Set(seen).add(item);
  let best: Set<string> | null = null;
  for (const [, r] of recipes) {
    if (!r.outs.some(([o]) => o === item)) continue;
    const need = new Set<string>();
    for (const [it] of r.ins) for (const u of uniquesNeeded(it, next)) need.add(u);
    if (!best || need.size < best.size) best = need;
  }
  return best ?? new Set();
}

/** Ore per minute the cirque's copper deposit can give (tiles × per-tile cap). */
export function tiredVeinPerMin(): number {
  const d = CIRQUE.deposits.find((x) => x.item === 'copper_ore')!;
  let tiles = 0;
  const r = Math.ceil(d.radius);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= d.radius * d.radius) tiles++;
  return (tiles * d.rich) / 100;
}

/** Copper wire per minute one electronics workshop on circuit boards consumes. */
export function wirePerElectronicsWorkshop(): number {
  const c = RECIPES.circuit;
  return (c.ins.find(([it]) => it === 'copper_wire')![1] * 60) / c.seconds;
}

/** Each machine's recipes (D70: never more than `MAX_RECIPES`). */
export function recipesPerMachine(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [id, r] of recipes) for (const b of r.machines) m.set(b, [...(m.get(b) ?? []), id]);
  return m;
}

/**
 * What a research node gives (D70): the buildings and recipes it unlocks, a Heart level, its
 * features (flags), research slots, additions; empty when it would only multiply a number.
 */
export function nodeGives(id: string): string[] {
  const out: string[] = [...buildingsUnlockedBy(id)];
  for (const [rid, r] of recipes) if (r.unlock === id) out.push(`recipe:${rid}`);
  if (BAL.hearthUpgrades.some((u) => u.unlock === id)) out.push('heart');
  for (const e of (RESEARCH as Record<string, ResearchDef>)[id]?.effects ?? []) {
    if (e.k === 'flag') out.push(`flag:${e.flag}`);
    else if (e.k === 'slots') out.push('slot');
    else if (e.k === 'add') out.push(`add:${e.target}`);
  }
  return out;
}

export function validateContent(): string[] {
  const errs: string[] = [];
  const items = new Set(Object.keys(ITEMS));
  const unlocks = new Set(['start', 'never', ...treeIds]);

  // Recipes: known items, machines, unlocks; cycles divide the engine period.
  for (const [id, r] of recipes) {
    for (const [it] of [...r.ins, ...r.outs]) if (!items.has(it)) errs.push(`recipe ${id}: unknown item ${it}`);
    for (const m of r.machines) if (!(m in BUILDINGS)) errs.push(`recipe ${id}: unknown machine ${m}`);
    if (!unlocks.has(r.unlock)) errs.push(`recipe ${id}: unknown unlock ${r.unlock}`);
    const ticks = Math.round(r.seconds * 10);
    if (CYCLE_LCM % ticks !== 0) errs.push(`recipe ${id}: ${ticks} ticks do not divide ${CYCLE_LCM}`);
  }

  // The neighbouring bases' kits (D110): known buildings, power for each (their chains: sim/neighbour-chain.test.ts).
  for (const [pid, k] of Object.entries(NEIGHBOUR_KITS)) {
    for (const b of [NEIGHBOUR_PAD, NEIGHBOUR_MAST, ...k.power, ...k.extra]) if (!(b in BUILDINGS)) errs.push(`neighbour kit ${pid}: unknown building ${b}`);
    if (!k.power.length) errs.push(`neighbour kit ${pid}: has no power`);
    if (!(BUILDINGS[NEIGHBOUR_MAST] as BuildingDef).pole) errs.push(`neighbour kit: ${NEIGHBOUR_MAST} carries no wires`);
  }

  // Buildings: unlocks, costs, ports on the footprint's edge.
  for (const [id, b] of buildings) {
    if (!unlocks.has(b.unlock)) errs.push(`building ${id}: unknown unlock ${b.unlock}`);
    for (const [it] of b.cost) if (!items.has(it)) errs.push(`building ${id}: unknown cost item ${it}`);
    for (const p of b.ports) {
      const onEdge = (p.side === 'N' && p.y === 0) || (p.side === 'S' && p.y === b.h - 1) || (p.side === 'W' && p.x === 0) || (p.side === 'E' && p.x === b.w - 1);
      if (p.x < 0 || p.y < 0 || p.x >= b.w || p.y >= b.h || !onEdge) errs.push(`building ${id}: port ${p.x},${p.y},${p.side} is off its edge`);
    }
  }

  // The unlock tree (D33): plans and research form one DAG — known prerequisites and costs, no
  // loop, every node reachable from the roots; plan ids never shadow research ids; every plan
  // unlocks something; a plan with no building of its own says what it brings.
  for (const [id, r] of research) {
    for (const p of r.prereq) if (!isTreeNode(p)) errs.push(`research ${id}: unknown prereq ${p}`);
    for (const [it] of r.cost) if (!items.has(it)) errs.push(`research ${id}: unknown cost item ${it}`);
  }
  for (const [id, p] of plans) {
    if (isResearch(id) || id === 'start' || id === 'never') errs.push(`plan ${id}: its id is taken`);
    for (const q of p.prereq) if (!isTreeNode(q)) errs.push(`plan ${id}: unknown prereq ${q}`);
    for (const [it, n] of p.cost) {
      if (!items.has(it)) errs.push(`plan ${id}: unknown cost item ${it}`);
      if (!(Number.isInteger(n) && n > 0)) errs.push(`plan ${id}: cost ${it} must be a positive whole number`);
    }
    if (!p.cost.length) errs.push(`plan ${id}: free (a plan is paid from the Heart)`);
    const builds = buildingsUnlockedBy(id).length > 0;
    const crafts = recipes.some(([, r]) => r.unlock === id);
    if (!builds && !crafts && !p.effects?.length) errs.push(`plan ${id}: unlocks nothing`);
    if (!builds && (!p.name || !p.desc)) errs.push(`plan ${id}: unlocks no building, so it needs its own name and desc`);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) { errs.push(`tree loop: ${[...path, id].join(' → ')}`); return; }
    state.set(id, 1);
    for (const p of treePrereq(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of treeIds) visit(id, []);
  const learnt = reachableNodes();
  for (const id of treeIds) if (!learnt.has(id)) errs.push(`${isPlan(id) ? 'plan' : 'research'} ${id}: unreachable`);
  // Every building can be had: from the start, or through a node the tree reaches.
  for (const [id, b] of buildings) if (b.unlock !== 'start' && b.unlock !== 'never' && !learnt.has(b.unlock)) errs.push(`building ${id}: out of the tree's reach (${b.unlock})`);
  for (const [id, r] of recipes) if (r.unlock !== 'start' && !learnt.has(r.unlock)) errs.push(`recipe ${id}: out of the tree's reach (${r.unlock})`);
  // A level gated by a tree node, or the player's from the start (D101: level 2).
  for (const [i, up] of BAL.hearthUpgrades.entries()) if (up.unlock !== 'start' && !learnt.has(up.unlock)) errs.push(`Heart level ${i + 2}: unknown unlock ${up.unlock}`);
  // The plans' paths (D41): one theme each, one entry each, the analytics flags.
  errs.push(...pathProblems());

  // Every item can be made; every resource research asks for, and every plan's cost, can be made.
  const reach = reachableItems();
  for (const it of items) if (!reach.has(it)) errs.push(`item ${it}: cannot be produced`);
  for (const [id, r] of research) for (const [it] of r.cost) if (!reach.has(it)) errs.push(`research ${id}: ${it} cannot be produced`);
  for (const [id, p] of plans) for (const [it] of p.cost) if (!reach.has(it)) errs.push(`plan ${id}: ${it} cannot be produced`);
  // …and in time (D71, D122): a plan only costs what the plans alone let a base make — every plan
  // is taken before the research lab's, and nothing research brings can be in hand by then; a
  // research node's resources only what its prerequisites and the plans let a base make (gears
  // after Mechanics' press, ceramic after Ceramics, lenses after Optics) — made, not only bought.
  const planIds = new Set(plans.map(([id]) => id));
  const withPlans = makeableWith(planIds);
  for (const [id, p] of plans) for (const [it] of p.cost) if (reach.has(it) && !withPlans.has(it)) errs.push(`plan ${id}: ${it} cannot be made with the plans alone`);
  for (const [id, r] of research) {
    const known = makeableWith(new Set([...planIds, ...ancestors(id)]));
    for (const [it] of r.cost) if (reach.has(it) && !known.has(it)) errs.push(`research ${id}: ${it} cannot be made before it (its prerequisites and the plans)`);
  }

  // Machines are specialised (D70); research nodes unlock things (D70); the tree's shape (D69).
  for (const [b, rs] of recipesPerMachine()) if (rs.length > MAX_RECIPES) errs.push(`machine ${b}: ${rs.length} recipes (${rs.join(', ')}), at most ${MAX_RECIPES}`);
  for (const [id, r] of research) {
    if (!nodeGives(id).length) errs.push(`research ${id}: unlocks nothing (a node must give a building, a recipe or a feature)`);
    if (r.branch === 'trunk') continue;
    const fam = FAMILIES[r.branch];
    if (r.spec && !fam.specs?.[r.spec]) errs.push(`research ${id}: unknown speciality ${r.spec} of ${r.branch}`);
    if (r.spec && r.tier < 3) errs.push(`research ${id}: a speciality starts at Tier 3`);
    if (!r.spec && r.tier >= 3 && fam.specs) errs.push(`research ${id}: ${r.branch} splits at Tier 3, the node needs a speciality`);
    const gate = TIER_GATE[r.tier];
    if (gate && !r.prereq.includes(gate)) errs.push(`research ${id}: a Tier ${r.tier} node needs ${gate}`);
  }

  // Tier 1 is completed whole before the Core's level 3 and the expertises (D93): its closing node
  // needs every other Tier 1 node, and opens Tier 2.
  const t1 = research.filter(([id, r]) => r.tier === 1 && id !== TIER1_WHOLE).map(([id]) => id);
  const whole = (RESEARCH as Record<string, ResearchDef>)[TIER1_WHOLE];
  if (!whole || whole.tier !== 1) errs.push(`research ${TIER1_WHOLE}: the node closing Tier 1 is missing`);
  else for (const id of t1) if (!whole.prereq.includes(id)) errs.push(`research ${TIER1_WHOLE}: does not need ${id} (Tier 1 is completed whole)`);
  if (TIER_GATE[2] !== TIER1_WHOLE) errs.push(`Tier 2 must open with ${TIER1_WHOLE}`);
  errs.push(...expertiseProblems(FAMILY_IDS));
  // Every node takes tokens and has a pace, with no minimum time (D118, D122: tokens at every tier):
  // `minutes` is only the pace the launch dialog aims at. Its resources are whole and positive.
  for (const [id, r] of research) {
    if (r.tokens <= 0 || r.minutes <= 0) errs.push(`research ${id}: a node needs tokens and a pace (D122)`);
    for (const [it, n] of r.cost) if (!(Number.isInteger(n) && n > 0)) errs.push(`research ${id}: resource ${it} must be a positive whole number`);
  }
  // Each tier waits for the Core's level (D118): a level the player can raise, behind the trunk node
  // that opens the tier, never lower than the tier before's; Tier 2's is the Archive's (D93).
  const lv = BAL.tierCoreLevel;
  if (lv.length !== 4 || lv[0] !== 1) errs.push('BAL.tierCoreLevel: four tiers, Tier 1 at the Core\'s first level');
  for (let tier = 2; tier <= 4; tier++) {
    const need = lv[tier - 1]!, up = BAL.hearthUpgrades[need - 2];
    if (need < lv[tier - 2]!) errs.push(`Tier ${tier}: the Core's level ${need} is below Tier ${tier - 1}'s`);
    if (!up) errs.push(`Tier ${tier}: no Core level ${need}`);
    else if (up.unlock !== TIER_GATE[tier as ResearchTier]) errs.push(`Tier ${tier}: Core level ${need} must come with ${TIER_GATE[tier as ResearchTier]} (it comes with ${up.unlock})`);
  }
  if (lv[1] !== BAL.expertise.level) errs.push(`Tier 2 opens at the Archive's level (${BAL.expertise.level}), not ${lv[1]}`);

  // Designed scarcity and the need to trade.
  if (tiredVeinPerMin() * 2 >= wirePerElectronicsWorkshop()) errs.push('the tired vein must not feed one electronics workshop');
  if (uniquesNeeded('resonator').size < 2) errs.push('a resonator must need ≥ 2 distinct uniques');
  if (uniquesNeeded('nacre_lattice').size < 2) errs.push('a nacre lattice must need ≥ 2 distinct uniques');

  // Nothing unusable (D107): what a node unlocks — buildings, recipes, a Heart level, a feature —
  // works with what the base can extract, make or buy by then, in the order the tree imposes.
  errs.push(...usabilityProblems());

  // No dead end (D36): the bootstrap rebuilds production from the land through plans alone, and
  // the starting stock covers CrierBelt's restart reserve (with the first ring of plans bought).
  errs.push(...reserveProblems());

  // The tutorial's quests: known items, buildings, recipes, research, rewards, guide targets.
  errs.push(...questProblems());
  return errs;
}
