// recyclers-d151.test.ts — a save from before D151 (owner, 2026-10-19: « don't use slag or scraps in
// machines, the point is that it's very useless »): D125's two recyclers are gone, the brickworks'
// slag bricks (`slag_brick`) and the steel mill's recycled steel (`steel_scrap`). No save version: the
// remap (D47) finds their ids gone from the save's recipe table and clears each machine set to one —
// no recipe, waiting for the player's pick (each machine has one again) — handing the Heart its
// buffers, its waste bin and the inputs of a craft under way (`RETIRED_RECIPES` says what one craft
// took: the table holds ids, not counts). The slag and scrap go home with the rest: a refund is no
// intake (D139), and the Core's waste sells at the Crier. Played on a forged save: a base holding a
// brickworks on slag bricks and a steel mill on recycled steel, both mid-craft, loaded through the
// chain and the remap; with the refunds taken back out of the Heart, it is the same base with both
// machines bare.
import { describe, it, expect } from 'vitest';
import { CRECIPES, ITEM_IDS, RECIPE_IDS, itemIdx, recipesFor, buildingIdx } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import { RETIRED_RECIPES } from '@/content/retired';
import { recipeOf, withRecipe } from '@/sim/cfg';
import { MachineNode, type MachineSnap } from '@/sim/flow/nodes';
import { remapSave } from '@/sim/save-remap';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { grantCost, steadyPower, testSim, wire } from '@/sim/testkit';
import { migrate } from './migrate';

/** Where D125 had appended its two recyclers: after the cable, before the assembly bench's coil (D129). */
const AT = RECIPE_IDS.indexOf('copper_coil');

/** A base with the brickworks' and the steel mill's research, a brickworks and a mill on their (one) recipes, wired. */
function base(): { sim: Sim; works: number; mill: number } {
  const sim = testSim();
  sim.done.add('ex_brick');
  sim.done.add('dn_steel');
  sim.rebuildDerived();
  steadyPower(sim);
  grantCost(sim, 'brickworks');
  const w = sim.place('brickworks', 516, 505, 0);
  if (!w.ok) throw new Error(`brickworks ${w.reason}`);
  grantCost(sim, 'steel_mill');
  const k = sim.place('steel_mill', 512, 503, 0);
  if (!k.ok) throw new Error(`mill ${k.reason}`);
  wire(sim, [w.id!, k.id!]);
  sim.run(10);
  return { sim, works: w.id!, mill: k.id! };
}

/** A machine's state as a save holds it. */
const snap = (inBuf: number[], outBuf: number[], extra: Partial<MachineSnap> = {}): MachineSnap =>
  ({ inBuf, outBuf, crafting: true, p: 17, carry: 0, status: 0, ...extra });

/**
 * The save of `sim` as a base of before D151 wrote it: the recipe table holding the two recyclers at
 * their place (every later recipe one further on, the machines' recipes re-pointed), the brickworks
 * on slag bricks and the mill on recycled steel, each holding buffers and crafting. Also the clean
 * save (both machines bare) and what the load must hand the Heart (milli-items by item index).
 */
function forge(sim: Sim, works: number, mill: number): { old: SaveData; clean: SaveData; owed: Map<number, number> } {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
  const clean = JSON.parse(JSON.stringify(d)) as SaveData;
  const content = d.content!;
  expect(content.recipes).not.toContain('slag_brick');
  content.recipes.splice(AT, 0, 'slag_brick', 'steel_scrap');
  content.recipeSigs.splice(AT, 0, 'slag,water>brick', 'scrap,coal>steel');
  for (let i = 0; i < d.ents.length; i += 7) {
    const r = recipeOf(d.ents[i + 5]!);
    if (r > AT) d.ents[i + 5] = withRecipe(d.ents[i + 5]!, r + 2);
    if (d.ents[i] === works) d.ents[i + 5] = withRecipe(d.ents[i + 5]!, AT + 1);
    if (d.ents[i] === mill) d.ents[i + 5] = withRecipe(d.ents[i + 5]!, AT + 2);
    // The clean base: both machines bare (no recipe, no node state).
    if (clean.ents[i] === works || clean.ents[i] === mill) clean.ents[i + 5] = withRecipe(clean.ents[i + 5]!, 0);
  }
  const slag = itemIdx('slag');
  const states = new Map<number, MachineSnap>([
    // Slag bricks: 3 slag and 1.5 water waiting, a brick made, a brick being pressed (2 slag, 1 water in).
    [works, snap([3000, 1500], [1000])],
    // Recycled steel: 4 scrap and 2 coal waiting, a steel made, one melting (3 scrap, 1 coal in), a slag in its bin.
    [mill, snap([4000, 2000], [1000], { wc: 3, wBuf: 1000, wItem: slag })],
  ]);
  d.nodes = [...d.nodes.filter(([ent]) => !states.has(ent)), ...states];
  clean.nodes = clean.nodes.filter(([ent]) => !states.has(ent));
  const owed = new Map<number, number>();
  const owe = (it: string, mu: number): void => { const i = itemIdx(it); owed.set(i, (owed.get(i) ?? 0) + mu); };
  owe('slag', 3000 + 2000 + 1000); owe('water', 1500 + 1000); owe('brick', 1000);
  owe('scrap', 4000 + 3000); owe('coal', 2000 + 1000); owe('steel', 1000);
  return { old: d, clean, owed };
}

/** A save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(data: SaveData, sim: Sim): { back: Sim; note: ReturnType<typeof remapSave>['note'] } {
  const m = migrate(data as unknown as { v: number });
  expect(m.from).toBe(SAVE_VERSION);
  const r = remapSave(m.data as SaveData);
  return { back: deserialize(r.data, sim.grid.source), note: r.note };
}

describe('a save from before D151: the recyclers gone', () => {
  it('the content: the brickworks and the steel mill have one recipe each again; the retired ones say what a craft took', () => {
    expect(recipesFor(buildingIdx('brickworks')).map((r) => r.id)).toEqual(['brick']);
    expect(recipesFor(buildingIdx('steel_mill')).map((r) => r.id)).toEqual(['steel']);
    expect(Object.keys(RETIRED_RECIPES).sort()).toEqual(['slag_brick', 'steel_scrap']);
    for (const id of Object.keys(RETIRED_RECIPES)) expect(id in RECIPES, id).toBe(false);
    expect(RETIRED_RECIPES.slag_brick!.ins).toEqual([['slag', 2], ['water', 1]]);
    expect(RETIRED_RECIPES.steel_scrap!.ins).toEqual([['scrap', 3], ['coal', 1]]);
  });

  it('each machine is cleared, its buffers, waste bin and craft under way handed to the Heart — slag and scrap too; the rest of the base as it was', () => {
    const { sim, works, mill } = base();
    expect(recipeOf(sim.ents.get(works)!.cfg)).toBe(CRECIPES.find((r) => r.id === 'brick')!.idx + 1); // its lone recipe at placement (D83)
    const { old, clean, owed } = forge(sim, works, mill);
    const { back, note } = open(old, sim);
    expect(note).toEqual({ removed: [], lost: [], reset: ['slag_brick', 'steel_scrap'] });
    for (const id of [works, mill]) expect(recipeOf(back.ents.get(id)!.cfg), `${id} bare`).toBe(0);
    const ref = deserialize(clean, sim.grid.source);
    for (let i = 0; i < ref.stock.length; i++) {
      expect(back.stock[i]! - ref.stock[i]!, `${ITEM_IDS[i]} handed to the Heart`).toBe(owed.get(i) ?? 0);
      back.stock[i] = ref.stock[i]!;
    }
    expect(back.ents.size).toBe(ref.ents.size);
    expect(back.hash(), 'the rest of the base as it was').toBe(ref.hash());
  });

  it('the player picks the one recipe left and the machines run on it; their old buffers stay in the Heart', () => {
    const { sim, works, mill } = base();
    const { old } = forge(sim, works, mill);
    const { back } = open(old, sim);
    const slag0 = back.stock[itemIdx('slag')]!, scrap0 = back.stock[itemIdx('scrap')]!;
    back.setRecipe(works, 'brick');
    back.setRecipe(mill, 'steel');
    back.ensureCompiled();
    for (const id of [works, mill]) {
      const n = back.graph.nodeByEnt.get(id) as MachineNode;
      expect(n.recipe?.id).toBe(id === works ? 'brick' : 'steel');
      expect([...n.inBuf].every((mu) => mu === 0)).toBe(true);
    }
    back.run(600);
    expect(back.stock[itemIdx('slag')]!).toBe(slag0);
    expect(back.stock[itemIdx('scrap')]!).toBe(scrap0);
  });
});
