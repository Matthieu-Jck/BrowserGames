// validate.ts — content invariants, checked at startup (dev) and in tests. Content mistakes
// must fail loudly: an unreachable item, a research loop, a recipe whose cycle does not
// divide the engine's 1 200-tick period (the offline catch-up needs it), a port off its
// building's edge. It also pins the design's intentional scarcities: the cirque's « tired
// vein » cannot feed one mechanics-journal workshop, an atlas needs two different unique
// resources and a codex five — so every colony must trade. The unlock tree (D33) is one DAG over
// plans and research: no loop, every node reachable from the start, every building with it. And
// a base can always rebuild its production (D36): the bootstrap and CrierBelt's restart reserve
// hold together (`reserveProblems`, content/reserve.ts). The plans' paths (D41) each read as one
// line from one entry, and the analytics plans each turn on their own flag (`pathProblems`).
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ITEMS } from './items';
import { questProblems } from './quests';
import { RECIPES } from './recipes';
import { reserveProblems } from './reserve';
import { PLANS, RESEARCH, buildingsUnlockedBy, isPlan, isResearch, isTreeNode, pathProblems, treePrereq } from './research';
import { CIRQUE, UNIQUE_BIOMES } from './world';
import type { BuildingDef, ItemDef, PlanDef, RecipeDef, ResearchDef } from './types';

const CYCLE_LCM = 1200;

/** Items mined straight from the land (deposits, unique biomes, digging, pumping). */
export const RAW: readonly string[] = ['iron_ore', 'sand', 'coal', 'copper_ore', 'salt', 'stone', 'water', ...Object.values(UNIQUE_BIOMES).map((u) => u.item)];

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

/** Copper wire per minute one great workshop on mechanics journals consumes. */
export function wirePerMechanicsWorkshop(): number {
  const j = RECIPES.journal_2, c = RECIPES.circuit;
  const circuitsPerMin = (j.ins.find(([it]) => it === 'circuit')![1] * 60) / j.seconds;
  return circuitsPerMin * c.ins.find(([it]) => it === 'copper_wire')![1];
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
  for (const [i, up] of BAL.hearthUpgrades.entries()) if (!learnt.has(up.unlock)) errs.push(`Heart level ${i + 2}: unknown unlock ${up.unlock}`);
  // The plans' paths (D41): one theme each, one entry each, the analytics flags.
  errs.push(...pathProblems());

  // Every item can be made; every science item research asks for, and every plan's cost, can be made.
  const reach = reachableItems();
  for (const it of items) if (!reach.has(it)) errs.push(`item ${it}: cannot be produced`);
  for (const [id, r] of research) for (const [it] of r.cost) if (!reach.has(it)) errs.push(`research ${id}: ${it} cannot be produced`);
  for (const [id, p] of plans) for (const [it] of p.cost) if (!reach.has(it)) errs.push(`plan ${id}: ${it} cannot be produced`);

  // Designed scarcity and the need to trade.
  if (tiredVeinPerMin() * 2 >= wirePerMechanicsWorkshop()) errs.push('the tired vein must not feed one mechanics workshop');
  if (uniquesNeeded('atlas').size < 2) errs.push('an atlas must need ≥ 2 distinct uniques');
  if (uniquesNeeded('codex').size !== 5) errs.push('a codex must need 5 distinct uniques');

  // No dead end (D36): the bootstrap rebuilds production from the land through plans alone, and
  // the starting stock covers CrierBelt's restart reserve (with the first ring of plans bought).
  errs.push(...reserveProblems());

  // The tutorial's quests: known items, buildings, recipes, research, rewards, guide targets.
  errs.push(...questProblems());
  return errs;
}
