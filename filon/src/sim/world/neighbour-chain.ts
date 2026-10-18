// neighbour-chain.ts — what a neighbouring base makes, and with what (D110, D134; owner, 2026-10-17:
// « les bases de PNJ n'ont aucun sens. Du charbon rentre dans des fileuses… », then 2026-10-18: « Elle
// commande de la pierre, la transforme en minerai de fer et la revend ? Ça n'a pas trop de sens »).
// Pure, from the content alone. A base is a business that makes sense:
// - it mines its raw goods itself, on its own land — sand where its floor is bare sand (a sand
//   collector), each ore whose deposit lies on its floor (a drill on it), the stone of its rock if it
//   is a mining camp (an excavator by the cliff) — and buys nothing: its trade post only ships what
//   it makes, so every line runs from the mine to the post;
// - every step adds value (content values: ore → plate → gear or steel → pipe, copper → wire → cable,
//   sand → glass, wire and plate → coil → motor), and none makes a raw good: no sifter's stone → ore,
//   the owner's case (`runs`);
// - what it makes is what its trade leans to (content/neighbours.ts `NEIGHBOUR_LEANS`), then what its
//   colony supplies, then the longest chain its land allows, the ore it mines first; a mining camp
//   sells its ore as it is only from a deposit that holds a real mine (`MINE_DRILLS`), and smelts a
//   smaller one on site.
// The layout (world/neighbours.ts) lays the stages out as machines and the edges as ribbons, port to
// port; `chainProblems` checks a chain against the content; `story` is its main line, raw good first,
// for the base's card (« Fonderie : minerai de fer → plaque de fer → engrenage »).
import type { BuildingId } from '@/content/buildings';
import { BUILDINGS } from '@/content/buildings';
import { COLONY_PROFILES, type ColonyProfile, type ColonyProfileId } from '@/content/colonies';
import { ITEMS } from '@/content/items';
import { NEIGHBOUR_LEANS } from '@/content/neighbours';
import { RECIPES } from '@/content/recipes';
import type { RecipeDef } from '@/content/types';

/** One stage of a chain: what stands there, what it runs, what it puts out, where its inputs come from. */
export interface Stage {
  readonly id: number;
  /** extract: a drill, a collector or an excavator on its ground; make: a machine on a recipe. */
  readonly role: 'extract' | 'make';
  readonly building: BuildingId | null;
  /** The recipe a maker runs (content id). */
  readonly recipe: string | null;
  /** What it puts out (item id). */
  readonly item: string;
  /** Its inputs: an item each, from a stage. */
  readonly ins: ReadonlyArray<{ readonly item: string; readonly from: number }>;
}

/** A base's chain: the goods it sells (the last stages' items), every stage (inputs before what they feed), its main line (raw good first). */
export interface Chain { readonly products: readonly string[]; readonly stages: readonly Stage[]; readonly story: readonly string[] }

/** What extracts each raw good the land can give (sand from bare sand, stone from the rock beside; ores from their deposits). */
export const EXTRACTOR: Readonly<Record<string, BuildingId>> = { sand: 'sand_collector', stone: 'excavator' };
const DRILL: BuildingId = 'drill';
export const extractorOf = (item: string): BuildingId => EXTRACTOR[item] ?? DRILL;
/** How many extractors a step's main raw input gets when its deposit has room (a recipe drinking three of it a craft gets one more); a lesser one gets one. */
const EXTRACT_N = 2;
/** The most machines (makers) a chain lays, the most products it sells; the buildings a base aims at, the most copies of its chain. */
const MAX_MAKERS = 6, MAX_PRODUCTS = 2, MACHINES = 8, MAX_COPIES = 4;
/** Steps back from a good sold to the land; the drills a deposit holds at least for a mine selling its ore as it is (a smaller one is worked up on site). */
const DEPTH = 4, MINE_DRILLS = 3;

const recipes = Object.entries(RECIPES) as Array<[string, RecipeDef]>;
/** A recipe's machine: the first of its machines the content knows (the base model of its family). */
const machineOf = (r: RecipeDef): BuildingId | null => (r.machines.find((m) => m in BUILDINGS) as BuildingId | undefined) ?? null;
/** Fluids ride conduits, which no base lays. */
const FLUIDS = new Set(['water']);

const kindOf = (item: string): string => (ITEMS as Record<string, { kind?: string }>)[item]?.kind ?? '';
/** The kinds of what a land gives (an extractor's goods: ores and sand, coal, stone): mined, never made. */
const RAW_KINDS = new Set(['ore', 'fuel', 'rubble']);
export const isRaw = (item: string): boolean => RAW_KINDS.has(kindOf(item));
/** An item's worth in thousandths of its content value (integers in the sim). */
export const worth = (item: string): number => Math.round(((ITEMS as Record<string, { value?: number }>)[item]?.value ?? 0) * 1000);
const worthOf = (xs: ReadonlyArray<readonly [string, number]>): number => xs.reduce((s, [i, n]) => s + n * worth(i), 0);
/** Does a recipe add value: its goods worth more than what goes in? */
export const addsValue = (r: RecipeDef): boolean => worthOf(r.outs) > worthOf(r.ins);

/**
 * A recipe a base runs: a machine the content knows, no fluid, value added, and no raw good made
 * (owner, 2026-10-18: « Elle commande de la pierre, la transforme en minerai de fer et la revend ? »:
 * a sifter's stone → ore is no business; ore comes from a drill).
 */
export const runs = (r: RecipeDef): boolean => !!machineOf(r) && !r.ins.some(([i]) => FLUIDS.has(i)) && !r.outs.some(([o]) => isRaw(o)) && addsValue(r);

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A recipe's main input among those `has` keeps: no fuel (a furnace's coal is no part of the story),
 * then the one worth the most a craft, then by id. What a line follows back from a good to its mine.
 */
export function mainInput(r: RecipeDef, has: (item: string) => boolean = () => true): string | undefined {
  const fuel = (i: string): number => Number(kindOf(i) === 'fuel');
  return r.ins.filter(([i]) => has(i)).sort((a, b) => fuel(a[0]) - fuel(b[0]) || b[1] * worth(b[0]) - a[1] * worth(a[0]) || byId(a[0], b[0]))[0]?.[0];
}

interface Node { item: string; recipe: string | null; kids: Node[] }

/**
 * The tree that makes `item` from `raws` within `depth` recipe steps (the recipes whose inputs are all
 * at hand first, then the fewer inputs, then by id), or null: every input mined or made here.
 */
function tree(item: string, raws: ReadonlySet<string>, depth: number): Node | null {
  if (raws.has(item)) return { item, recipe: null, kids: [] };
  if (depth <= 0) return null;
  const options = recipes
    .filter(([, r]) => r.outs.some(([o]) => o === item) && runs(r))
    .sort((a, b) => Number(!a[1].ins.every(([i]) => raws.has(i))) - Number(!b[1].ins.every(([i]) => raws.has(i))) || a[1].ins.length - b[1].ins.length || byId(a[0], b[0]));
  for (const [id, r] of options) {
    const kids = r.ins.map(([i]) => tree(i, raws, depth - 1));
    if (kids.every((k) => k)) return { item, recipe: id, kids: kids as Node[] };
  }
  return null;
}

const makers = (n: Node): number => (n.recipe ? 1 : 0) + n.kids.reduce((s, k) => s + makers(k), 0);
/** How many times tree `n` mines `raw` (a leaf each: an extractor at least). */
const leaves = (n: Node, raw: string): number => (n.recipe ? n.kids.reduce((s, k) => s + leaves(k, raw), 0) : Number(n.item === raw));
/** Does tree `n` make (or mine) `item` on its way? */
const within = (n: Node, item: string): boolean => n.kids.some((k) => k.item === item || within(k, item));
/** Does a tree start at an ore its base mines (the deposit it was set on)? */
const minesOre = (n: Node): boolean => (!n.recipe && kindOf(n.item) === 'ore' && n.item !== 'sand') || n.kids.some(minesOre);

/** A tree's main line, raw good first: down through each step's main input (`mainInput`). */
function mainLine(n: Node): string[] {
  if (!n.recipe) return [n.item];
  const main = mainInput(RECIPES[n.recipe as keyof typeof RECIPES] as RecipeDef);
  const k = n.kids.find((q) => q.item === main);
  return k ? [...mainLine(k), n.item] : [n.item];
}

/**
 * A base's chain from its trade and its land: of every good its land lets it make (or, a mining
 * camp's, mine and sell as it is), the best by its trade's leanings, what its colony supplies, the
 * longer chain, the ore it mines (the deposit it was set on) and the dearer good, up to `maxProducts`
 * within `MAX_MAKERS`; none, or `plain` (its trade's chain could not be laid): glass from its sand,
 * else a raw good of its land as it is. `room`: how many extractors each raw good's ground holds
 * (a small copper deposit, two drills; not given: no bound) — a chain never wants more of them than
 * that, its copies and its extractors a step cut to fit.
 */
export function planChain(profile: ColonyProfileId, raws: ReadonlySet<string>, maxProducts = MAX_PRODUCTS, plain = false, maxCopies = MAX_COPIES, room: ReadonlyMap<string, number> = new Map()): Chain {
  // Pure: the same trade, land and bounds give the same chain (a base's tries ask again and again).
  const key = `${profile}|${[...raws].sort(byId).map((r) => `${r}:${room.get(r) ?? ''}`).join(',')}|${maxProducts}|${plain ? 1 : 0}|${maxCopies}`;
  let c = planned.get(key);
  if (!c) planned.set(key, (c = plan(profile, raws, maxProducts, plain, maxCopies, room)));
  return c;
}
const planned = new Map<string, Chain>();

function plan(profile: ColonyProfileId, raws: ReadonlySet<string>, maxProducts: number, plain: boolean, maxCopies: number, room: ReadonlyMap<string, number>): Chain {
  const leans = NEIGHBOUR_LEANS[profile] ?? [], supplies = new Map((COLONY_PROFILES[profile] as ColonyProfile).supplies);
  const roomOf = (r: string): number => room.get(r) ?? Number.MAX_SAFE_INTEGER;
  /** Does a set of trees fit the ground: an extractor a leaf at least, of each raw good? */
  const fits = (ns: readonly Node[]): boolean => [...raws].every((r) => ns.reduce((s, n) => s + leaves(n, r), 0) <= roomOf(r));
  const cands: Array<{ n: Node; score: number }> = [];
  if (!plain) {
    const goods = new Set<string>(raws);
    for (const [, r] of recipes) for (const [o] of r.outs) goods.add(o);
    for (const item of [...goods].sort(byId)) {
      // A raw good sells as it is only from a mine, and a real one: a deposit of three drills at least.
      if (raws.has(item) && (!leans.includes(item) || roomOf(item) < MINE_DRILLS)) continue;
      const n = tree(item, raws, DEPTH);
      if (!n || makers(n) > MAX_MAKERS || (!raws.has(item) && !n.recipe) || !fits([n])) continue;
      const li = leans.indexOf(item);
      cands.push({ n, score: (li >= 0 ? (leans.length - li) * 250 : 0) + (supplies.get(item) ?? 0) * 100 + makers(n) * 150 + (minesOre(n) ? 800 : 0) + Math.floor(worth(item) / 1000) });
    }
    cands.sort((a, b) => b.score - a.score || byId(a.n.item, b.n.item));
  }
  const roots: Node[] = [];
  let budget = MAX_MAKERS;
  for (const { n } of cands) {
    if (roots.length >= maxProducts) break;
    // A second good of its own, never one the first already makes on its way (pipes, then their steel again).
    if (makers(n) > budget || !fits([...roots, n]) || roots.some((o) => o.item === n.item || (o.recipe && within(o, n.item)) || (o.recipe && within(n, o.item)))) continue;
    roots.push(n);
    budget -= makers(n);
  }
  if (!roots.length && raws.has('sand')) { const g = tree('glass', new Set(['sand']), DEPTH); if (g) roots.push(g); }
  if (!roots.length) { const raw = [...raws].sort(byId)[0]; if (raw) roots.push({ item: raw, recipe: null, kids: [] }); }
  // A real base runs several of each (owner: « c'est tout petit »): the chains laid side by side, as
  // many times as bring it near `MACHINES` buildings, `maxCopies` at most, as many as its ground holds.
  const machines = (n: Node): number => (n.recipe ? 1 : EXTRACT_N) + n.kids.reduce((s, k) => s + machines(k), 0);
  const one = roots.reduce((s, n) => s + machines(n), 0);
  let copies = Math.max(1, Math.min(maxCopies, Math.round(MACHINES / Math.max(1, one))));
  for (const r of raws) { const per = roots.reduce((s, n) => s + leaves(n, r), 0); if (per) copies = Math.max(1, Math.min(copies, Math.floor(roomOf(r) / per))); }
  // A raw input's extractors, a copy: one a leaf, then what the ground has left (its share of the
  // copies) to each step's main input, up to `EXTRACT_N` (one more for a thirsty recipe), in the order
  // the leaves are laid.
  const wants: Array<{ raw: string; want: number }> = [];
  const walk = (n: Node, thirst: number, main: boolean): void => {
    if (!n.recipe) { wants.push({ raw: n.item, want: main ? EXTRACT_N + (thirst >= 3 ? 1 : 0) : 1 }); return; }
    const r = RECIPES[n.recipe as keyof typeof RECIPES] as RecipeDef, most = Math.max(...r.ins.map(([, q]) => q));
    n.kids.forEach((k, i) => walk(k, r.ins[i]![1], r.ins[i]![1] === most));
  };
  for (const n of roots) walk(n, 1, true);
  const left = new Map<string, number>();
  for (const w of wants) left.set(w.raw, (left.get(w.raw) ?? Math.floor(Math.min(roomOf(w.raw), Number.MAX_SAFE_INTEGER) / copies)) - 1);
  const alloc = wants.map((w) => { const more = Math.max(0, Math.min(w.want - 1, left.get(w.raw)!)); left.set(w.raw, left.get(w.raw)! - more); return 1 + more; });
  // Flatten, inputs before what they feed, each raw leaf with its extractors (`alloc`, in order).
  const stages: Stage[] = [];
  let leaf = 0;
  const add = (n: Node): number[] => {
    if (!n.recipe) {
      const ids: number[] = [];
      for (let k = alloc[leaf++ % alloc.length]!; k > 0; k--) {
        stages.push({ id: stages.length, role: 'extract', building: extractorOf(n.item), recipe: null, item: n.item, ins: [] });
        ids.push(stages.length - 1);
      }
      return ids;
    }
    const r = RECIPES[n.recipe as keyof typeof RECIPES] as RecipeDef;
    const ins: Array<{ item: string; from: number }> = [];
    n.kids.forEach((k) => { for (const from of add(k)) ins.push({ item: k.item, from }); });
    stages.push({ id: stages.length, role: 'make', building: machineOf(r), recipe: n.recipe, item: n.item, ins });
    return [stages.length - 1];
  };
  for (let c = 0; c < copies; c++) for (const n of roots) add(n);
  return { products: roots.map((n) => n.item), stages, story: roots.length ? mainLine(roots[0]!) : [] };
}

/**
 * What a chain gets wrong against the content (empty: nothing): a maker whose building cannot run its
 * recipe, or whose recipe does not put out its item, adds no value, makes a raw good or drinks a
 * fluid; an input its recipe does not take, a recipe input no stage brings; an extractor of a good
 * its land does not give, or the wrong one; a stage fed by one that puts out another item.
 */
export function chainProblems(c: Chain, raws: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const s of c.stages) {
    if (s.role === 'extract') {
      if (!raws.has(s.item)) out.push(`stage ${s.id}: extracts ${s.item}, not at hand`);
      if (s.building !== extractorOf(s.item)) out.push(`stage ${s.id}: ${s.building} cannot extract ${s.item}`);
      continue;
    }
    const r = RECIPES[s.recipe as keyof typeof RECIPES] as RecipeDef | undefined;
    if (!r) { out.push(`stage ${s.id}: no recipe ${s.recipe}`); continue; }
    if (!s.building || !r.machines.includes(s.building)) out.push(`stage ${s.id}: ${s.building} cannot run ${s.recipe}`);
    if (!r.outs.some(([o]) => o === s.item)) out.push(`stage ${s.id}: ${s.recipe} does not make ${s.item}`);
    if (!runs(r)) out.push(`stage ${s.id}: ${s.recipe} is no business (no value added, a raw good made, or a fluid)`);
    for (const i of s.ins) {
      if (!r.ins.some(([n]) => n === i.item)) out.push(`stage ${s.id}: ${s.recipe} takes no ${i.item}`);
      const f = c.stages[i.from];
      if (!f || f.item !== i.item) out.push(`stage ${s.id}: fed ${i.item} by stage ${i.from}, which puts out ${f?.item}`);
    }
    for (const [n] of r.ins) if (!s.ins.some((i) => i.item === n)) out.push(`stage ${s.id}: ${s.recipe} lacks its ${n}`);
  }
  return out;
}
