// neighbour-chain.test.ts — a neighbouring base makes sense against the content (D110, fifth pass;
// owner, 2026-10-17: « Du charbon rentre dans des fileuses, puis le trou de sortie d'une batterie
// génère des composés électriques, et rien n'est jamais envoyé par trade post. En plus c'est tout
// petit »). Two levels:
// - the chain (world/neighbour-chain.ts): for every trade and every kind of land, each maker runs a
//   recipe its building can make and is fed every input of it by the stage that makes that input;
//   what it sells is of its trade (or the plain fallback: glass, an ore);
// - the laid base (world/neighbours.ts `neighbourProblems`), on many lands of map 4 and on a map of
//   scattered claims: every machine on its recipe, every extractor on its ground, every line from an
//   outlet to an intake (or onto another line's side) carrying what its source puts out, the goods
//   reaching the store and the store's line reaching the trade post; and big enough to be a base.
import { describe, it, expect } from 'vitest';
import { WORLD_SEED } from '@/content/world';
import { COLONY_PROFILES, type ColonyProfileId } from '@/content/colonies';
import { ITEM_IDS } from '@/content/registry';
import { Sim } from './state';
import { MapGen } from './world/mapgen';
import { PARCEL_COLS } from './world/land';
import { neighbourProblems, type NLayout } from './world/neighbours';
import type { Holding } from './world/neighbours';
import { chainProblems, planChain } from './world/neighbour-chain';

const PROFILES = Object.keys(COLONY_PROFILES) as ColonyProfileId[];
const LANDS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['sand']), new Set(['sand', 'iron_ore']), new Set(['sand', 'copper_ore', 'coal']),
  new Set(['iron_ore', 'copper_ore', 'coal']), new Set<string>(), new Set(['sand', 'iron_ore', 'copper_ore', 'coal']),
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

/** A problem with a machine itself (a maker off its recipe or unfed, an extractor off its ground or idle): never, on any base. */
const machineProblem = (what: string): boolean => /#\d+/.test(what) && !/^a ribbon/.test(what);

describe('neighbouring bases: chains from the content (D110)', () => {
  it('every trade on every kind of land plans a chain the content runs, selling goods of its trade', () => {
    for (const profile of PROFILES) for (const raws of LANDS) for (const plain of [false, true]) {
      const c = planChain(profile, raws, 2, plain);
      expect(chainProblems(c, raws), `${profile} on ${[...raws]}`).toEqual([]);
      const trade = new Set<string>(COLONY_PROFILES[profile].supplies.map(([it]) => it));
      for (const p of c.products) expect(trade.has(p) || p === 'glass' || raws.has(p), `${profile} sells ${p}`).toBe(true);
      // Each product is put out by a stage that feeds nothing else (it goes to the store).
      for (const p of c.products) expect(c.stages.some((s) => s.item === p && !c.stages.some((o) => o.ins.some((i) => i.from === s.id)))).toBe(true);
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('map 4, land %i: every machine runs its recipe, fed by real lines; the goods reach the trade post', (ps) => {
    let n = 0, failing = 0, machines = 0;
    for (const { h, L, sim } of bases(4, ps)) {
      n++;
      const probs = neighbourProblems(sim.grid, L);
      expect(probs.filter((q) => machineProblem(q.what)), `${h.profile} at ${h.hub}`).toEqual([]);
      if (probs.length) failing++;
      machines += L.structs.filter((s) => s.role === 'make' || s.role === 'extract').length;
      // What it sells rides into its store, and the store's line into its trade post.
      const post = L.structs.findIndex((s) => s.role === 'post'), store = L.structs.findIndex((s) => s.role === 'store');
      expect(post, `${h.profile} at ${h.hub} has a trade post`).toBeGreaterThanOrEqual(0);
      if (L.products.length && !probs.length) {
        const line = L.ribbons.find((r) => r.from === store && r.to === post);
        expect(line, `${h.profile} at ${h.hub}: its store ships to its post`).toBeTruthy();
        expect([...line!.items].sort()).toEqual([...L.products].sort());
      }
      // A maker's goods are what its recipe puts out; a line's goods are its source's.
      for (const r of L.ribbons) {
        const a = L.structs[r.from]!;
        if (a.role === 'make' || a.role === 'extract') expect(r.items.every((it) => a.items?.includes(it)), `${ITEM_IDS[r.item]} out of ${a.recipe}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(4);
    expect(failing).toBeLessThanOrEqual(1); // a base the land squeezes may lose a line; never a machine
    expect(machines / n).toBeGreaterThanOrEqual(3.5); // a base, not a shed (owner: « c'est tout petit »)
  });

  it('map 3 (scattered claims, a parcel each): machines on their recipes too', () => {
    for (const { h, L, sim } of bases(3, 1)) expect(neighbourProblems(sim.grid, L).filter((q) => machineProblem(q.what)), `${h.profile} at ${h.hub}`).toEqual([]);
  });
});
