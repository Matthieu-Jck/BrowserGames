// lift-pace.test.ts — a line's lift keeps its line's pace (D141; owner, 2026-10-18: « la partie jaune
// des tapis ascenseur sont très lents et causent des bouchons »). A traction ribbon carried 30 a
// minute, so every line over a terrace was halved at its lift and backed up behind it. Now its chain
// goes at the pace of the fastest ribbon it meets on its line, never under a plain ribbon's: a plain
// line over a ridge carries 60 a minute end to end, a swift one 120, an express one 240 — what the
// same line carries on the flat — offline as online, and a save's lines load with their items.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, buildingIdx, itemIdx } from '@/content/registry';
import { stepPeriod } from './flow/chain';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import { WORLD_EPOCH0, CYCLE_LCM } from './constants';
import { Sim } from './state';
import { grantCost, learnPlans, line, stockedSilo } from './testkit';
import { T } from './types';
import { FlatSource } from './world/grid';
import { BUILDINGS } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import { buildingFacts, factCtx } from '@/ui/building-facts';

/** A ridge of rock one terrace up across x 496–504, y 511–514 (four tiles deep: a lift up its south wall, one down its north wall). */
const RIDGE = [{ x: 496, y: 511, w: 9, h: 4, t: T.Rock1, level: 1 }];
type Tier = 'ribbon' | 'swift_ribbon' | 'express_ribbon';
const RESEARCH: Record<Tier, string[]> = { ribbon: [], swift_ribbon: ['xp_swift'], express_ribbon: ['xp_express'] };

/**
 * A silo of sand handing out north into a `tier` line up x = 500, y 519 → 507, into an incinerator at
 * (500, 506): over the ridge (`flat`: the same base before the land rose, the same line on the flat).
 * The line is one drag: the plan lays the lifts itself (D73), at (500, 515) up and (500, 511) down.
 */
function lineOver(tier: Tier, flat = false): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24, source: new FlatSource([], flat ? [] : RIDGE) });
  learnPlans(sim);
  for (const r of RESEARCH[tier]) sim.done.add(r); // a research: granted outside the commands, as steadyPower's
  sim.rebuildDerived();
  grantCost(sim, tier, 13);
  grantCost(sim, 'traction_ribbon', 2);
  grantCost(sim, 'incinerator');
  stockedSilo(sim, 500, 520, 0, 'sand', 1000);
  expect(sim.placeBelts(tier, line(500, 519, 0, 13))).toBe(13);
  expect(sim.place('incinerator', 500, 506, 0).ok).toBe(true);
  return sim;
}

const burnt = (sim: Sim): number => sim.consumed[itemIdx('sand')]! / 1000;
const defAt = (sim: Sim, x: number, y: number): string => BUILDING_IDS[sim.entityAt(x, y)!.def]!;

/** Items burnt over five minutes, once the line has filled for one. */
function fiveMinutes(sim: Sim): number {
  sim.run(600);
  const b0 = burnt(sim);
  sim.run(3000);
  return burnt(sim) - b0;
}

describe('a line’s lift keeps its line’s pace (D141)', () => {
  it('the drag lays the lifts at the ridge’s two walls', () => {
    const sim = lineOver('ribbon');
    expect([516, 515, 514, 512, 511, 510].map((y) => defAt(sim, 500, y))).toEqual(['ribbon', 'traction_ribbon', 'ribbon', 'ribbon', 'traction_ribbon', 'ribbon']);
  });

  it('a plain line over the ridge carries 60 a minute end to end, as on the flat: no jam at the lifts', () => {
    const over = lineOver('ribbon'), flat = lineOver('ribbon', true);
    over.ensureCompiled();
    for (const y of [515, 511]) expect(over.chainAt(500, y)!.perMin).toBe(60);
    const a = fiveMinutes(over), b = fiveMinutes(flat);
    expect(b).toBeGreaterThanOrEqual(298); // 300 at 60/min
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
    // As full past the lifts as behind them: the line is not queued at a lift, it is full throughout.
    const full = (ys: number[]): number => ys.filter((y) => { const c = over.chainAt(500, y)!; return c.itemAt(c.tiles.indexOf(y * 1024 + 500)) >= 0; }).length;
    expect(full([510, 509, 508, 507])).toBe(full([519, 518, 517, 516]));
  });

  it('a swift line keeps the swift pace through its lifts: 120 a minute', () => {
    const over = lineOver('swift_ribbon'), flat = lineOver('swift_ribbon', true);
    over.ensureCompiled();
    expect(defAt(over, 500, 515)).toBe('traction_ribbon');
    for (const y of [515, 511]) expect(over.chainAt(500, y)!.perMin).toBe(120);
    const a = fiveMinutes(over), b = fiveMinutes(flat);
    expect(b).toBeGreaterThanOrEqual(590); // 600 at 120/min
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });

  it('an express line keeps the express pace through its lifts', () => {
    const over = lineOver('express_ribbon'), flat = lineOver('express_ribbon', true);
    over.ensureCompiled();
    for (const y of [515, 511]) expect(over.chainAt(500, y)!.perMin).toBe(240);
    const a = fiveMinutes(over), b = fiveMinutes(flat);
    // The silo's outlet, not the line, sets this one's pace (its parts of items staged at the tail):
    // more than a swift line can ever carry (600), and what the same line carries on the flat.
    expect(b).toBeGreaterThan(700);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });

  it('a lift goes at the fastest ribbon it meets on its line, never under a plain ribbon’s', () => {
    const sim = lineOver('ribbon');
    sim.done.add('xp_swift');
    sim.rebuildDerived();
    sim.grant('gear', 10);
    // Swift past the down lift only: the lift between a plain ribbon and a swift one goes swift.
    expect(sim.placeBelts('swift_ribbon', line(500, 510, 0, 4))).toBe(4);
    sim.ensureCompiled();
    expect(sim.chainAt(500, 511)!.perMin).toBe(120);
    expect(sim.chainAt(500, 515)!.perMin).toBe(60); // the up lift meets plain ribbons only
    // Fed by a building and handing on to one (no ribbon on its line): its own pace, a plain ribbon's.
    const alone = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24, source: new FlatSource([], RIDGE) });
    learnPlans(alone);
    grantCost(alone, 'traction_ribbon');
    grantCost(alone, 'incinerator');
    expect(alone.place('traction_ribbon', 500, 515, 0).ok).toBe(true);
    expect(alone.place('incinerator', 500, 514, 0).ok).toBe(true);
    alone.ensureCompiled();
    expect(alone.chainAt(500, 515)!.perMin).toBe(60);
  });

  it('dragging a faster ribbon over a line keeps its lifts, which take the new pace', () => {
    const sim = lineOver('ribbon');
    const lifts = [515, 511].map((y) => sim.entityAt(500, y)!.id);
    sim.done.add('xp_swift');
    sim.rebuildDerived();
    grantCost(sim, 'swift_ribbon', 13);
    const plan = sim.planBelts('swift_ribbon', line(500, 519, 0, 13));
    expect(plan.every((s) => s.ok)).toBe(true); // nothing left out at the steps
    expect(plan.filter((s) => s.skip).map((s) => s.y)).toEqual([515, 511]);
    expect(sim.placeBelts('swift_ribbon', line(500, 519, 0, 13))).toBe(11);
    expect([515, 511].map((y) => sim.entityAt(500, y)!.id)).toEqual(lifts);
    sim.ensureCompiled();
    for (const y of [515, 511]) expect(sim.chainAt(500, y)!.perMin).toBe(120);
  });

  it('offline as online on a line through its lifts', () => {
    for (const tier of ['ribbon', 'swift_ribbon'] as const) {
      const a = lineOver(tier), b = lineOver(tier);
      for (const sim of [a, b]) sim.run(600);
      a.run(6000);
      catchUp(b, 6000, { noDirect: true });
      expect(burnt(b)).toBe(burnt(a));
      expect(b.hash()).toBe(a.hash());
    }
  });

  it('a saved line loads with its items on its lifts, at the new pace: nothing goes to the Heart', () => {
    const sim = lineOver('ribbon');
    sim.run(900); // the line full, the lifts loaded
    sim.ensureCompiled();
    const cells = (s: Sim): number[][] => s.graph.chains.map((c) => Array.from(c.cells));
    const before = cells(sim), stock = Array.from(sim.stock);
    expect(sim.chainAt(500, 515)!.itemAt(0)).toBe(itemIdx('sand'));
    const back = deserialize(serialize(sim), new FlatSource([], RIDGE));
    back.ensureCompiled();
    expect(cells(back)).toEqual(before);
    expect(Array.from(back.stock)).toEqual(stock);
    expect(back.chainAt(500, 515)!.perMin).toBe(60);
  });

  it('every ribbon’s steps repeat within the engine period, so a line’s group keeps an exact period offline', () => {
    for (const [id, b] of Object.entries(BUILDINGS) as Array<[string, BuildingDef]>) {
      if (!b.belt || b.kind === 'conduit') continue;
      expect(CYCLE_LCM % stepPeriod(b.belt.perMin), id).toBe(0);
    }
    // The lift's own pace is a plain ribbon's: the floor under its line's.
    expect(BUILDINGS.traction_ribbon.belt!.perMin).toBeGreaterThanOrEqual(BUILDINGS.ribbon.belt!.perMin);
  });

  it('the card says a lift goes at its line’s pace, a plain ribbon’s at least', () => {
    const sim = lineOver('ribbon');
    const f = buildingFacts('traction_ribbon', factCtx(sim));
    const rate = f.rows.find((r) => r.k === 'rate')!;
    expect(rate.text).toMatch(/ligne|line/);
    expect(rate.text).toMatch(/60/);
    expect(buildingIdx('traction_ribbon')).toBeGreaterThanOrEqual(0);
  });
});
