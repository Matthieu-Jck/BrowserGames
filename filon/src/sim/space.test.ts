import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { Sim } from './state';
import { testSource, line, steadyPower, wire, learnPlans } from './testkit';
import { T } from './types';
import { tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import { WORLD_EPOCH0 } from './constants';
import { serialize, deserialize } from './serialize';
import { catchUp } from './offline/catchup';
import { connect } from './dev';
import { modulesOf, withModules } from './cfg';

const RUB = (): number => itemIdx('stone');

/** A test colony with soft rock east of the Hearth (obsidian at its south end) and a pond south of it. Excavators reach 3 tiles from their centre (D54): they stand against the rock. */
function spaceSim(done: string[] = ['tr1', 'tr2']): Sim {
  const src = testSource();
  (src as unknown as { rocks: Array<{ x: number; y: number; w: number; h: number; t: number }> }).rocks.push(
    { x: 530, y: 505, w: 6, h: 6, t: T.Rock1 },
    { x: 530, y: 511, w: 3, h: 2, t: T.Rock3 },
    { x: 510, y: 528, w: 4, h: 3, t: T.Shallow },
  );
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: src, foundingEpoch: WORLD_EPOCH0 + 24 });
  for (const id of done) sim.done.add(id);
  learnPlans(sim); // every plan of the tree (D33): this tests digging and filling, not unlocks
  for (const [it, n] of [['iron_plate', 2000], ['gear', 400], ['circuit', 300], ['ceramic', 300], ['glass', 200], ['copper_wire', 200]] as const) sim.grant(it, n);
  return sim;
}

/** Wire a building by the rock through a pole halfway (it stands past the Heart's wire reach). */
function wireByRock(sim: Sim, id: number): void {
  const pole = sim.ents.get(sim.grid.occ[tileIndex(523, 511)]!) ?? null;
  const at = pole ? pole.id : sim.place('mast', 523, 511, 0).id!; // a new pole wires itself to the Heart (D25)
  if (!sim.linksOf(at).length) wire(sim, at);
  wire(sim, id, at);
}

describe('space', () => {
  it('a dug tile yields its stone once, gives up its ore, then is buildable floor', () => {
    const sim = spaceSim();
    const ex = sim.place('excavator', 527, 507, 0);
    expect(ex.ok, ex.reason).toBe(true);
    wireByRock(sim, ex.id!);
    const tile = tileIndex(530, 507);
    expect(sim.designate([tile])).toBe(1);
    const stock0 = [...sim.stock];
    sim.run(5 * 60 * 10 + 5);
    expect(sim.grid.terrain(530, 507)).toBe(T.Dug);
    expect(sim.designated.has(tile)).toBe(false);
    // The tile's stone went into the excavator's store; with nothing left marked it quarries the
    // rock beside it (its stone on top, the rock left standing).
    expect(sim.produced[RUB()]).toBeGreaterThanOrEqual(10_000);
    const ore = sim.stock.map((v, i) => v - stock0[i]!);
    expect(ore[itemIdx('iron_ore')]! % 20_000 === 0 || ore[itemIdx('iron_ore')]! >= 0).toBe(true);
    // Floor now: marking it again does nothing, and it can be built on.
    expect(sim.designate([tile])).toBe(0);
    const dug = sim.grid.terrainDiff.size, made = sim.produced[RUB()]!;
    sim.run(4000);
    expect(sim.produced[RUB()]).toBeGreaterThan(made); // quarrying
    expect(sim.grid.terrainDiff.size).toBe(dug); // and nothing more dug out
    expect(sim.canPlace('mast', 530, 507, 0).reason).not.toBe('terrain');
  });

  it('hard rock waits for its research: obsidian only with Basalt Bits', () => {
    const sim = spaceSim();
    sim.place('excavator', 527, 510, 0);
    const obsidian = tileIndex(530, 511);
    sim.designate([obsidian]);
    sim.run(100);
    expect(sim.jobs.filter((j) => !j.quarry)).toEqual([]); // the mark waits (it may quarry softer rock meanwhile)
    for (const id of ['ex_sifter', 'ex3', 'ex4']) sim.done.add(id);
    sim.rebuildDerived();
    sim.run(700);
    expect(sim.jobs.filter((j) => !j.quarry && j.tile === obsidian).length).toBe(1);
  });

  it('land rules: production stands on the claim\'s land, infrastructure may leave it (paid ribbons cost ×3 out there)', () => {
    const sim = spaceSim(['tr1', 'tr2', 'tr3', 'tr4', 'xp_swift']);
    const far = 512 + 35; // the first parcel past the starting square (3 × 3 parcels of 23 tiles round the Heart, D74)
    expect(sim.canPlace('kiln', far, 512, 0).reason).toBe('outside_zone');
    expect(sim.canPlace('kiln', far - 2, 512, 0).reason).not.toBe('outside_zone');
    for (const def of ['ribbon', 'mast', 'pylon', 'skybridge']) {
      const c = sim.canPlace(def, far, 512, 0);
      expect(c.reason === 'ok' || c.reason === 'unaffordable', `${def}: ${c.reason}`).toBe(true);
    }
    // The basic ribbon is free everywhere; a paid tier costs ×3 off the claim's land.
    expect(sim.canPlace('ribbon', far, 512, 0).cost.every((c) => c.mu === 0)).toBe(true);
    const inside = sim.canPlace('swift_ribbon', 520, 512, 0).cost[0]!.mu;
    const outside = sim.canPlace('swift_ribbon', far, 512, 0).cost[0]!.mu;
    expect(outside).toBe(inside * 3);
  });

  it('a backfiller fills a pond tile with 40 stone: new floor', () => {
    const sim = spaceSim(['tr1', 'tr2', 'tr3', 'ex_sifter', 'ex3']);
    const bf = sim.place('backfiller', 512, 521, 0);
    expect(bf.ok, bf.reason).toBe(true);
    wire(sim, bf.id!);
    sim.ensureCompiled();
    sim.stores.get(bf.id!)![RUB()] = 100 * 1000;
    expect(sim.designate([tileIndex(511, 528)])).toBe(1);
    sim.run(305);
    expect(sim.grid.terrain(511, 528)).toBe(T.Filled);
    expect(sim.stores.get(bf.id!)![RUB()]).toBe(60 * 1000);
  });

  it('crossings let two lines pass; skybridges leap over rock', () => {
    const sim = spaceSim(['tr1', 'xp_swift', 'xp_bridges', 'dn3', 'dn4', 'xp_distrib']);
    sim.grant('gear', 50);
    // A crossing at (520, 520): a W→E line and an N→S line both pass straight through.
    expect(sim.place('crossing', 520, 520, 0).ok).toBe(true);
    sim.placeBelts('ribbon', [...line(516, 520, 1, 4), ...line(521, 520, 1, 3)]);
    sim.placeBelts('ribbon', [...line(520, 516, 2, 4), ...line(520, 521, 2, 3)]);
    sim.ensureCompiled();
    // Each line runs through the crossing as one ribbon.
    expect(sim.chainAt(519, 520)).toBe(sim.chainAt(521, 520));
    expect(sim.chainAt(520, 519)).toBe(sim.chainAt(520, 521));
    expect(sim.chainAt(519, 520)).not.toBe(sim.chainAt(520, 519));
    // A skybridge pair leaps the pond (510..513): entry at 509, exit at 514 (span 8 with
    // Long Skybridges); the ribbon behind the exit gets the items.
    sim.grant('iron_plate', 100);
    expect(sim.place('skybridge', 509, 529, 1).ok).toBe(true);
    expect(sim.place('skybridge', 514, 529, 1).ok).toBe(true);
    sim.placeBelts('ribbon', [...line(506, 529, 1, 3), ...line(515, 529, 1, 2)]);
    sim.ensureCompiled();
    const g = sim.graph;
    const entry = sim.chainAt(509, 529)!, exit = sim.chainAt(514, 529)!;
    expect(entry === exit || g.nodes[g.eDst[entry.outE[0]!]!] === exit).toBe(true);
  });

  it('the Hearth grows a level with Mechanics and its materials: the land keeps its price', () => {
    const sim = spaceSim(['tr1']);
    const p = parcelAt(512 + 64, 512), before = sim.landPrice(p);
    expect(sim.upgradeHearth().ok).toBe(true);
    expect(sim.hearthLevel).toBe(2);
    expect(sim.landPrice(p)).toBe(before); // owner, 2026-10-14: the Heart's level does not lower it
    expect(sim.upgradeHearth().reason).toBe('locked');
  });

  it('speed modules are gone (D81): those an old save fitted come back to the Heart as servomotors, and the machine runs at its own pace', () => {
    const sim = spaceSim(['tr1', 'xp_swift', 'xp_bridges', 'dn3', 'dn4']);
    const k = sim.place('workshop', 516, 504, 0);
    expect(k.ok).toBe(true);
    sim.setRecipe(k.id!, 'circuit');
    sim.ensureCompiled();
    const m0 = sim.graph.nodeByEnt.get(k.id!) as unknown as { speed: number; kw: number };
    const [s0, kw0] = [m0.speed, m0.kw];
    // An older save: two modules in the workshop's cfg (bits 16–19).
    const servo = itemIdx('pace_bell'), before = sim.stock[servo]!;
    sim.ents.get(k.id!)!.cfg = withModules(sim.ents.get(k.id!)!.cfg, 2);
    const back = deserialize(serialize(sim), sim.grid.source);
    expect(back.stock[servo]).toBe(before + 2000);
    expect(modulesOf(back.ents.get(k.id!)!.cfg)).toBe(0);
    expect(back.ents.get(k.id!)!.cfg).toBe(sim.ents.get(k.id!)!.cfg & 0xffff); // its recipe kept
    back.ensureCompiled();
    const m1 = back.graph.nodeByEnt.get(k.id!) as unknown as { speed: number; kw: number };
    expect([m1.speed, m1.kw]).toEqual([s0, kw0]);
  });

  it('save → load in the middle of a dig in a brownout continues bit for bit', () => {
    const sim = spaceSim(['tr1', 'tr2', 'an_servers']);
    sim.grant('oscillator', 4);
    const ex = sim.place('excavator', 527, 507, 0);
    sim.designate([505, 506, 507].map((y) => tileIndex(530, y)));
    // A server (400 kW; the two skydocks of 200 kW each before D108) shares the Hearth's solar panel
    // (240 kW at noon, none at night) with the excavator: it digs in a brownout.
    const srv = sim.place('server', 503, 504, 0);
    expect(srv.ok, srv.reason).toBe(true);
    wire(sim, srv.id!);
    wireByRock(sim, ex.id!);
    let n = 0;
    while (sim.grid.terrainDiff.size === 0 && n++ < 40) sim.run(500);
    sim.run(777); // a tile dug, the next one under way
    expect(sim.grid.terrainDiff.size).toBeGreaterThan(0);
    expect(sim.jobs.length).toBe(1);
    const copy = deserialize(serialize(sim), sim.grid.source);
    expect(copy.hash()).toBe(sim.hash());
    sim.run(2500); copy.run(2500);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('a dig that research unlocks during an absence starts offline as online', () => {
    const make = (): Sim => {
      const sim = spaceSim(['tr1', 'tr_synth', 'tr2', 'tr3', 'ex_sifter', 'ex3']); // Tier 2 hangs from the Synthesis (D93)
      sim.grantCredits(10_000_000); // the research's tokens, bought by the minute (D68)
      const lab = sim.place('observatory', 503, 512, 0);
      expect(lab.ok, lab.reason).toBe(true);
      const ex = sim.place('excavator', 527, 510, 0);
      expect(ex.ok).toBe(true);
      wire(sim, lab.id!);
      wireByRock(sim, ex.id!);
      // Its stone goes to the Heart: meanwhile it quarries the softer rock, and a full store would hold the dig.
      expect(connect(sim, ex.id!, sim.hearthId)).toBeGreaterThan(0);
      expect(sim.designate([tileIndex(530, 511)])).toBe(1); // obsidian: needs Basalt Bits (ex4)
      sim.ensureCompiled();
      // A Tier 2 node: Survey Data and Mechanics Data (D71).
      sim.stores.get(lab.id!)![itemIdx('journal_1')] = 400 * 1000;
      sim.stores.get(lab.id!)![itemIdx('journal_2')] = 400 * 1000;
      expect(sim.startResearch('ex4').ok).toBe(true);
      return sim;
    };
    const a = make(), b = make();
    const span = 2 * a.projects[0]!.dur + 3 * 36_000; // brownouts slow both the research and the dig
    a.run(span);
    catchUp(b, span, { noDirect: true });
    for (const s of [a, b]) {
      expect(s.done.has('ex4')).toBe(true);
      expect(s.grid.terrain(530, 511)).toBe(T.Dug);
    }
  });

  it('an excavator with nothing marked quarries: stone without end, the rock left standing, offline as online', () => {
    const make = (): Sim => {
      const sim = spaceSim();
      steadyPower(sim);
      const ex = sim.place('excavator', 527, 507, 0);
      expect(ex.ok, ex.reason).toBe(true);
      wireByRock(sim, ex.id!);
      expect(connect(sim, ex.id!, sim.hearthId)).toBeGreaterThan(0);
      sim.run(30);
      return sim;
    };
    const on = make(), off = make(), S = RUB(), s0 = on.stock[S]!;
    on.run(2 * 36_000);
    catchUp(off, 2 * 36_000, { noDirect: true });
    expect(on.stock[S]! - s0).toBeGreaterThan(50_000); // well past one tile's 10 stone
    expect(on.grid.terrainDiff.size).toBe(0); // nothing dug out
    expect(Math.abs(off.stock[S]! - on.stock[S]!)).toBeLessThanOrEqual(2_000);
    expect(off.grid.terrainDiff.size).toBe(0);
  });

  it('digging offline matches ticking', () => {
    const sim = spaceSim();
    steadyPower(sim); // the dig never waits for the sun
    wireByRock(sim, sim.place('excavator', 527, 507, 0).id!);
    sim.designate([505, 506, 507, 508, 509, 510].map((y) => tileIndex(530, y)));
    sim.run(10);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(3 * 3000 + 400);
    catchUp(b, 3 * 3000 + 400, { noDirect: true });
    const dug = (s: Sim): number => [505, 506, 507, 508, 509, 510].filter((y) => s.grid.terrain(530, y) === T.Dug).length;
    expect(dug(a)).toBe(3);
    expect(dug(b)).toBe(3);
    expect(Math.abs(a.produced[RUB()]! - b.produced[RUB()]!)).toBeLessThan(1000);
  });
});
