// neighbour-chain.test.ts — a neighbouring base is a business that makes sense (D110, D134; owner,
// 2026-10-17: « Du charbon rentre dans des fileuses… rien n'est jamais envoyé par trade post… c'est
// tout petit », then 2026-10-18: « Elle commande de la pierre, la transforme en minerai de fer et la
// revend ? Ça n'a pas trop de sens »). Two levels:
// - the chain (world/neighbour-chain.ts): for every trade and every kind of land, `chainProblems`
//   finds nothing — each maker on a recipe its building runs, fed every input by the stage that makes
//   it, adding value, no raw good made (no sifter's stone → ore), every raw input mined on that land,
//   nothing bought;
// - the laid base, on many lands — lands 1–9 of map 4 (land 9 holds « Seven Horns », the owner's
//   case) and lands 1–2 of map 3 (scattered claims, a parcel each; maps 1 and 2 draw the same): no base imports its own raw material nor
//   anything else (nothing leaves its trade post by a ribbon); every chain starts at an extractor on
//   matching ground (a drill on its ore, a collector on bare sand, an excavator by its rock); every
//   step's goods worth more than what goes in, none a raw good; every line from an outlet to an
//   intake carrying what its source puts out; its goods reaching the store and the store's line its
//   trade post; each line its card tells (raw good first) a real step after step, from a good it
//   mines to one it sells; big enough to be a base, and the bases between them making many things.
import { describe, it, expect } from 'vitest';
import { WORLD_SEED } from '@/content/world';
import { COLONY_PROFILES, type ColonyProfileId } from '@/content/colonies';
import { ITEM_IDS, itemDef } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import type { RecipeDef } from '@/content/types';
import { Sim } from './state';
import { MapGen } from './world/mapgen';
import { PARCEL_COLS } from './world/land';
import { neighbourProblems, type NLayout } from './world/neighbours';
import type { Holding } from './world/neighbours';
import { addsValue, chainProblems, isRaw, planChain } from './world/neighbour-chain';

const PROFILES = Object.keys(COLONY_PROFILES) as ColonyProfileId[];
const LANDS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['sand']), new Set(['sand', 'iron_ore']), new Set(['sand', 'copper_ore', 'coal']), new Set(['iron_ore', 'copper_ore', 'coal']),
  new Set<string>(), new Set(['sand', 'iron_ore', 'copper_ore', 'coal']), new Set(['sand', 'stone']), new Set(['stone', 'iron_ore']),
  new Set(['copper_ore', 'iron_ore']), new Set(['sand', 'copper_ore']),
];

function bases(map: number, ps: number): Array<{ h: Holding; L: NLayout; sim: Sim }> {
  const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: ps, source: new MapGen(WORLD_SEED, ps, map), foundingEpoch: 29453760 });
  const out: Array<{ h: Holding; L: NLayout; sim: Sim }> = [], seen = new Set<number>();
  for (let p = 0; p < PARCEL_COLS * PARCEL_COLS; p++) {
    const h = sim.neighbours.holdingOf(p);
    if (!h || seen.has(h.hub)) continue;
    seen.add(h.hub);
    out.push({ h, L: sim.neighbours.layout(h), sim });
  }
  return out;
}

/** A problem with a machine itself (a maker off its recipe or unfed, an extractor off its ground or idle, a step that is no business, a post handing goods in): never, on any base. */
const machineProblem = (what: string): boolean => /#\d+/.test(what) && !/^a ribbon/.test(what);

/** What a laid base gets wrong as a business (the owner's rules, D134), besides `neighbourProblems`. */
function senseProblems(L: NLayout): string[] {
  const out: string[] = [];
  const role = (k: number): string => L.structs[k]?.role ?? '';
  const mined = new Set(L.structs.filter((s) => s.role === 'extract').flatMap((s) => s.items ?? []));
  // 1. Nothing comes in through its trade post: not its own raw material, nor anything else.
  for (const rb of L.ribbons) if (role(rb.from) === 'post') out.push(`its trade post hands out ${rb.items.map((i) => ITEM_IDS[i])}`);
  // Everything that rides out of the store into the post is something it makes or mines.
  for (const p of L.products) if (!L.structs.some((s) => (s.role === 'make' || s.role === 'extract') && s.items?.includes(p))) out.push(`sells ${ITEM_IDS[p]}, which it neither makes nor mines`);
  L.structs.forEach((s, k) => {
    if (s.role === 'extract' && !(s.items ?? []).every((i) => isRaw(ITEM_IDS[i]!))) out.push(`extracts ${s.items?.map((i) => ITEM_IDS[i])}, no raw good`);
    if (s.role !== 'make') return;
    const r = RECIPES[s.recipe as keyof typeof RECIPES] as RecipeDef;
    // 2. Every step adds value, and none makes a raw good (the owner's stone → iron ore).
    if (!addsValue(r)) out.push(`${s.recipe} adds no value`);
    if (r.outs.some(([o]) => isRaw(o))) out.push(`${s.recipe} makes a raw good (${r.outs.map(([o]) => o)})`);
    // 3. Its chain starts at an extractor: back through its lines, one is reached.
    const seen = new Set<number>(), q = [k];
    let found = false;
    while (q.length && !found) {
      const j = q.pop()!;
      for (const rb of L.ribbons) if (rb.to === j && !seen.has(rb.from)) {
        seen.add(rb.from);
        if (role(rb.from) === 'extract') found = true;
        else if (role(rb.from) === 'make') q.push(rb.from);
      }
    }
    if (!found) out.push(`${s.recipe} (#${k}) is fed from no extractor`);
  });
  // 4. What its card tells: a line per good sold, from a raw good it mines, each step a recipe taking
  // the one before and making the next, ending in that good.
  if (L.lines.length !== L.products.length) out.push(`${L.lines.length} lines for ${L.products.length} goods`);
  L.lines.forEach((line, j) => {
    const tell = line.map((i) => ITEM_IDS[i]).join(' → ');
    if (line[line.length - 1] !== L.products[j]) out.push(`its line ${tell} ends in nothing it sells`);
    if (!line.length || !mined.has(line[0]!)) out.push(`its line ${tell} starts at nothing it mines`);
    for (let i = 1; i < line.length; i++) {
      const a = ITEM_IDS[line[i - 1]!]!, b = ITEM_IDS[line[i]!]!;
      if (!L.structs.some((s) => s.role === 'make' && s.items?.includes(line[i]!) && (RECIPES[s.recipe as keyof typeof RECIPES] as RecipeDef).ins.some(([n]) => n === a))) out.push(`its line ${tell}: no machine makes ${b} of ${a}`);
    }
  });
  if (L.story !== L.lines[0] && (L.story.length || L.lines.length)) out.push('its story is not its first line');
  return out;
}
/** What the lands' bases make between them, gathered as each land is checked (the tests run in order). */
const made = new Set<number>(), told = new Set<string>();
const tally = { all: 0, machines: 0, map4: 0, fromOre: 0 };

/** One land's bases checked: the owner's rules, a working base; what they make tallied. */
function check(map: number, ps: number): { n: number; failing: number; machines: number } {
  let n = 0, failing = 0, machines = 0;
  for (const { h, L, sim } of bases(map, ps)) {
    n++;
    const at = `map ${map} land ${ps}: ${h.profile} at ${h.hub}`;
    const probs = neighbourProblems(sim.grid, L);
    expect(probs.filter((q) => machineProblem(q.what)), at).toEqual([]);
    expect(senseProblems(L), at).toEqual([]);
    if (probs.length) failing++;
    machines += L.structs.filter((s) => s.role === 'make' || s.role === 'extract').length;
    for (const p of L.products) made.add(p);
    if (L.story.length) told.add(L.story.map((i) => ITEM_IDS[i]).join('>'));
    tally.all++;
    if (map === 4) tally.map4++;
    if (map === 4 && L.story.length && itemDef(L.story[0]!).kind === 'ore' && ITEM_IDS[L.story[0]!] !== 'sand') tally.fromOre++;
    // What it sells rides into its store, and the store's line into its trade post.
    const post = L.structs.findIndex((s) => s.role === 'post'), store = L.structs.findIndex((s) => s.role === 'store');
    expect(post, `${at} has a trade post`).toBeGreaterThanOrEqual(0);
    if (L.products.length && !probs.length) {
      const line = L.ribbons.find((r) => r.from === store && r.to === post);
      expect(line, `${at}: its store ships to its post`).toBeTruthy();
      expect([...line!.items].sort()).toEqual([...L.products].sort());
    }
    for (const r of L.ribbons) {
      const a = L.structs[r.from]!;
      if (a.role === 'make' || a.role === 'extract') expect(r.items.every((it) => a.items?.includes(it)), `${ITEM_IDS[r.item]} out of ${a.recipe}`).toBe(true);
    }
  }
  tally.machines += machines;
  return { n, failing, machines };
}

describe('neighbouring bases: businesses that make sense (D110, D134)', () => {
  it('every trade on every kind of land plans a chain the content runs: value added at each step, no raw good made, its raw goods mined there, nothing bought', () => {
    for (const profile of PROFILES) for (const raws of LANDS) for (const plain of [false, true]) {
      const c = planChain(profile, raws, 2, plain);
      expect(chainProblems(c, raws), `${profile} on ${[...raws]}`).toEqual([]);
      // Each product is put out by a stage that feeds nothing else (it goes to the store); its story ends in its first.
      for (const p of c.products) expect(c.stages.some((s) => s.item === p && !c.stages.some((o) => o.ins.some((i) => i.from === s.id)))).toBe(true);
      if (c.products.length) expect(c.story[c.story.length - 1]).toBe(c.products[0]);
      // A chain starts where its land gives: its head an extractor of a raw good of that land, its story's first.
      for (const s of c.stages) expect(s.role === 'make' || (s.role === 'extract' && raws.has(s.item) && isRaw(s.item)), `${profile} on ${[...raws]}: stage ${s.item}`).toBe(true);
      if (c.story.length) expect(raws.has(c.story[0]!), `${profile} on ${[...raws]}: ${c.story}`).toBe(true);
    }
  });

  it('a land of stone alone: its quarry sells stone as it is, never sifts it into ore (the owner\'s case)', () => {
    for (const profile of PROFILES) {
      const c = planChain(profile, new Set(['stone']));
      expect(c.stages.filter((s) => s.role === 'make'), profile).toEqual([]);
      expect(c.products, profile).toEqual(['stone']);
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('map 4, land %i: every base mines its raw goods, buys nothing, adds value at each step, ships to its trade post', (ps) => {
    const { n, failing, machines } = check(4, ps);
    expect(n).toBeGreaterThan(4);
    expect(failing).toBeLessThanOrEqual(1); // a base the land squeezes may lose a line; never a machine
    expect(machines / n).toBeGreaterThanOrEqual(3.5); // a base, not a shed (owner: « c'est tout petit »)
  });

  it.each([1, 2])('map 3, land %i (scattered claims, a parcel each): machines on their recipes, businesses that make sense', (ps) => {
    expect(check(3, ps).n).toBeGreaterThan(20);
  });

  it('between them, the bases of all those lands make many things, by many lines, map 4\'s mostly from ore they mine', () => {
    expect(tally.all).toBeGreaterThan(150);
    expect(made.size).toBeGreaterThanOrEqual(9);
    expect(told.size).toBeGreaterThanOrEqual(9);
    expect(tally.fromOre * 2).toBeGreaterThanOrEqual(tally.map4); // half at least work the ore they were set on (the rest: glass from their sand, a quarry)
    expect(tally.machines / tally.all).toBeGreaterThanOrEqual(4.5);
  });
});
