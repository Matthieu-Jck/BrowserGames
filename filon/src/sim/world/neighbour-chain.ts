// neighbour-chain.ts — what a neighbouring base makes, and with what (D110; owner, 2026-10-17: « les
// bases de PNJ n'ont aucun sens. Du charbon rentre dans des fileuses, puis le trou de sortie d'une
// batterie génère des composés électriques, et rien n'est jamais envoyé par trade post »). Pure,
// from the content alone: the colony's trade (content/colonies.ts: what its profile supplies, the
// staples first) and the recipes (content/recipes.ts), back-chained from the goods it sells, two or
// three steps, down to what its land gives it — sand anywhere (a sand collector), the ores whose
// deposits lie on its parcels (a drill on them) — and, only when nothing else can be made, a good it
// buys at the Crier through its trade post. The layout (world/neighbours.ts) lays the stages out as
// machines and the edges as ribbons, port to port; `chainProblems` checks it against the content.
import type { BuildingId } from '@/content/buildings';
import { COLONY_PROFILES, type ColonyProfile, type ColonyProfileId } from '@/content/colonies';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import type { RecipeDef } from '@/content/types';

/** One stage of a chain: what stands there, what it runs, what it puts out, where its inputs come from. */
export interface Stage {
  readonly id: number;
  /** extract: a drill or a collector on its ground; make: a machine on a recipe; import: the trade post hands it out (bought at the Crier). */
  readonly role: 'extract' | 'make' | 'import';
  readonly building: BuildingId | null;
  /** The recipe a maker runs (content id). */
  readonly recipe: string | null;
  /** What it puts out (item id). */
  readonly item: string;
  /** Its inputs: an item each, from a stage. */
  readonly ins: ReadonlyArray<{ readonly item: string; readonly from: number }>;
}

/** A base's chain: the goods it sells (the last stages' items) and every stage, inputs before what they feed. */
export interface Chain { readonly products: readonly string[]; readonly stages: readonly Stage[] }

/** What extracts each raw good the land can give (sand from bare sand; ores from their deposits). */
export const EXTRACTOR: Readonly<Record<string, BuildingId>> = { sand: 'sand_collector' };
const DRILL: BuildingId = 'drill';
/** How many extractors a raw input gets (a recipe drinking three of it a craft gets one more). */
const EXTRACT_N = 2;
/** The most machines (makers) a chain lays, the most products it sells; the buildings a base aims at, the most copies of its chain. */
const MAX_MAKERS = 6, MAX_PRODUCTS = 2, MACHINES = 8, MAX_COPIES = 4;
/** Steps back from a good sold to the land; the goods a chain buys at most; the machines a base's bought goods feed at most (its depots' outlets, world/neighbours.ts: a great silo's three, one to a second silo). */
const DEPTH = 4, BUY = 1, OUTLETS = 5;

const recipes = Object.entries(RECIPES) as Array<[string, RecipeDef]>;
/** A recipe's machine: the first of its machines the content knows (the base model of its family). */
const machineOf = (r: RecipeDef): BuildingId | null => (r.machines.find((m) => m in BUILDINGS) as BuildingId | undefined) ?? null;
/** Recipes with a unique resource (a site's) or water among their inputs: no base of the plain makes them. */
const FLUIDS = new Set(['water']);

interface Node { item: string; recipe: string | null; kids: Node[]; imported: boolean }

/**
 * The tree that makes `item` from `raws` within `depth` recipe steps (the recipes whose inputs are
 * all at hand first, then the fewer inputs, then by id), or null. With `buy`, a good no recipe at hand
 * makes may come from the Crier (at most `buy.left` of them): what a base buys is what its land lacks
 * (stone for its sifters, coal for its steel), the chain made from there.
 */
function tree(item: string, raws: ReadonlySet<string>, depth: number, buy: { left: number } | null, shallow = false): Node | null {
  if (raws.has(item)) return { item, recipe: null, kids: [], imported: false };
  // `shallow`: an input is bought as it is (the fewest machines: a base whose land lays no longer chain).
  if (shallow && buy && buy.left > 0 && depth < DEPTH) { buy.left--; return { item, recipe: null, kids: [], imported: true }; }
  if (depth > 0) {
    const options = recipes
      .filter(([, r]) => r.outs.some(([o]) => o === item) && !r.ins.some(([i]) => FLUIDS.has(i)) && machineOf(r))
      .sort((a, b) => Number(!a[1].ins.every(([i]) => raws.has(i))) - Number(!b[1].ins.every(([i]) => raws.has(i))) || a[1].ins.length - b[1].ins.length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [id, r] of options) {
      const left = buy ? buy.left : 0;
      const kids: Node[] = [];
      for (const [i] of r.ins) {
        const k = tree(i, raws, depth - 1, buy, shallow);
        if (!k) break;
        kids.push(k);
      }
      if (kids.length === r.ins.length) return { item, recipe: id, kids, imported: false };
      if (buy) buy.left = left; // what that attempt bought is given back
    }
  }
  if (buy && buy.left > 0 && !raws.has(item)) { buy.left--; return { item, recipe: null, kids: [], imported: true }; }
  return null;
}

const makers = (n: Node): number => (n.recipe ? 1 : 0) + n.kids.reduce((s, k) => s + makers(k), 0);
const buys = (n: Node): number => (n.imported ? 1 : 0) + n.kids.reduce((s, k) => s + buys(k), 0);

/**
 * A base's chain from its trade and its land: of the goods its profile supplies — its staples (weight
 * 3) from `raws`, then with one input bought at the Crier, then its lesser goods likewise; among them
 * the richest chains within `MAX_MAKERS` — up to `maxProducts` (a raw good sells as it is: a mining
 * camp's ore); none, or `plain`: glass from sand, else an ore as it is.
 */
export function planChain(profile: ColonyProfileId, raws: ReadonlySet<string>, maxProducts = MAX_PRODUCTS, plain = false, maxCopies = MAX_COPIES): Chain {
  const supplies = [...(COLONY_PROFILES[profile] as ColonyProfile).supplies].sort((a, b) => b[1] - a[1]);
  // Its staples first, made from its land, then with one input bought at the Crier (stone for a
  // sifter…); then its lesser goods likewise; among them the richest chain within `MAX_MAKERS`.
  const pick = (weight: number, buy: boolean, buyN = BUY, shallow = false): Node[] => {
    const out: Node[] = [];
    let budget = MAX_MAKERS;
    const opts = supplies.filter(([, w]) => w === weight)
      .map(([it]) => tree(it, raws, DEPTH, buy ? { left: buyN } : null, shallow))
      // What it sells it makes or mines: a good it buys is only ever an input.
      .filter((n): n is Node => !!n && !n.imported && makers(n) <= budget)
      .sort((a, b) => makers(b) - makers(a));
    let left = OUTLETS;
    for (const n of opts) {
      if (out.length >= maxProducts || makers(n) > budget || buys(n) > left || out.some((o) => o.item === n.item)) continue;
      out.push(n);
      budget -= makers(n);
      left -= buys(n);
    }
    return out;
  };
  let roots: Node[] = [];
  const ways = [[3, false], [3, true], [1, false], [1, true]] as const;
  if (!plain) for (const [w, buy] of ways) if ((roots = pick(w, buy)).length) break;
  // Nothing of its trade at hand (or `plain`, its trade's chain could not be laid): glass from its sand,
  // else the first ore its land gives, sold as it is; a base on bare rock its trade with what it buys
  if (!roots.length && raws.has('sand')) roots = [tree('glass', new Set(['sand']), DEPTH, null)!];
  if (!roots.length) { const ore = [...raws].sort()[0]; if (ore) roots = [{ item: ore, recipe: null, kids: [], imported: false }]; }
  // (its inputs bought as they are, two of them at most: a scholars' camp on bare rock buys its wire and its glass).
  if (!roots.length && plain) for (const [w, buy] of ways) if (buy && (roots = pick(w, buy, BUY + 1, true).slice(0, 1)).length) break;
  // Flatten, inputs before what they feed; a raw input gets its extractors (one more for a thirsty recipe).
  const stages: Stage[] = [];
  const add = (n: Node, thirst: number): number[] => {
    if (n.imported) { stages.push({ id: stages.length, role: 'import', building: null, recipe: null, item: n.item, ins: [] }); return [stages.length - 1]; }
    if (!n.recipe) {
      const ids: number[] = [];
      for (let k = 0; k < EXTRACT_N + (thirst >= 3 ? 1 : 0); k++) {
        stages.push({ id: stages.length, role: 'extract', building: EXTRACTOR[n.item] ?? DRILL, recipe: null, item: n.item, ins: [] });
        ids.push(stages.length - 1);
      }
      return ids;
    }
    const r = RECIPES[n.recipe as keyof typeof RECIPES] as RecipeDef;
    const ins: Array<{ item: string; from: number }> = [];
    n.kids.forEach((k, i) => { for (const from of add(k, r.ins[i]![1])) ins.push({ item: k.item, from }); });
    stages.push({ id: stages.length, role: 'make', building: machineOf(r), recipe: n.recipe, item: n.item, ins });
    return [stages.length - 1];
  };
  // A real base runs several of each (owner: « c'est tout petit »): the chains laid side by side,
  // as many times as bring it near `MACHINES` buildings, `maxCopies` at most.
  const machines = (n: Node): number => (n.recipe ? 1 : n.imported ? 0 : EXTRACT_N) + n.kids.reduce((s, k) => s + machines(k), 0);
  const one = roots.reduce((s, n) => s + machines(n), 0);
  // What it buys comes out of the trade post's one outlet into its depots (`OUTLETS` outlets in all,
  // world/neighbours.ts), one a bought input: as many copies as they feed.
  const bought = roots.reduce((s, n) => s + buys(n), 0);
  const copies = Math.max(1, Math.min(maxCopies, bought ? Math.floor(OUTLETS / bought) : maxCopies, Math.round(MACHINES / Math.max(1, one))));
  for (let c = 0; c < copies; c++) for (const n of roots) add(n, 1);
  return { products: roots.map((n) => n.item), stages };
}

/**
 * What a chain gets wrong against the content (empty: nothing): a maker whose building cannot run its
 * recipe or whose recipe does not put out its item, an input its recipe does not take, a recipe input
 * no stage brings, an extractor of a good that is not raw, a stage fed by one that puts out another item.
 */
export function chainProblems(c: Chain, raws: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const s of c.stages) {
    if (s.role === 'extract') {
      if (!raws.has(s.item)) out.push(`stage ${s.id}: extracts ${s.item}, not at hand`);
      if (s.building !== (EXTRACTOR[s.item] ?? DRILL)) out.push(`stage ${s.id}: ${s.building} cannot extract ${s.item}`);
      continue;
    }
    if (s.role === 'import') continue;
    const r = RECIPES[s.recipe as keyof typeof RECIPES] as RecipeDef | undefined;
    if (!r) { out.push(`stage ${s.id}: no recipe ${s.recipe}`); continue; }
    if (!s.building || !r.machines.includes(s.building)) out.push(`stage ${s.id}: ${s.building} cannot run ${s.recipe}`);
    if (!r.outs.some(([o]) => o === s.item)) out.push(`stage ${s.id}: ${s.recipe} does not make ${s.item}`);
    for (const i of s.ins) {
      if (!r.ins.some(([n]) => n === i.item)) out.push(`stage ${s.id}: ${s.recipe} takes no ${i.item}`);
      const f = c.stages[i.from];
      if (!f || f.item !== i.item) out.push(`stage ${s.id}: fed ${i.item} by stage ${i.from}, which puts out ${f?.item}`);
    }
    for (const [n] of r.ins) if (!s.ins.some((i) => i.item === n)) out.push(`stage ${s.id}: ${s.recipe} lacks its ${n}`);
  }
  return out;
}
