import { describe, it, expect } from 'vitest';
import { reachableItems, reachableNodes, rootPlans, startBuildings, tiredVeinPerMin, uniquesNeeded, validateContent, wirePerMechanicsWorkshop } from './validate';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ANALYTICS, PLAN_IDS, PLAN_PATHS, PLANS, RESEARCH, pathEntries, pathPlans, pathProblems, planDef, treePrereq } from './research';
import { BOOTSTRAP, ESSENTIAL, RESERVED, reserveNeed, reserveProblems, stagePlans } from './reserve';
import type { BuildingDef, PlanDef, RecipeDef } from './types';

describe('content invariants', () => {
  it('the content tables hold together (items, recipes, buildings, research)', () => {
    expect(validateContent()).toEqual([]);
  });

  it('every item can be produced from the land', () => {
    const r = reachableItems();
    for (const id of Object.keys(ITEMS)) expect(r.has(id), id).toBe(true);
  });

  it('the tired vein cannot feed a single mechanics workshop: copper must be imported', () => {
    expect(tiredVeinPerMin()).toBeCloseTo(6.75, 6);
    expect(tiredVeinPerMin() * 2).toBeCloseTo(13.5, 6);
    expect(wirePerMechanicsWorkshop()).toBe(18);
  });

  it('an atlas needs two different uniques, a codex five', () => {
    expect(uniquesNeeded('atlas').size).toBe(2);
    expect(uniquesNeeded('codex').size).toBe(5);
    expect(uniquesNeeded('journal_2').size).toBe(0);
  });

  it('one unlock tree (D33): the starting kit is the drill, the ribbon and the pole; everything else is in the tree', () => {
    expect(startBuildings()).toEqual(['drill', 'ribbon', 'mast']);
    const nodes = reachableNodes();
    expect(nodes.size).toBe(PLAN_IDS.length + Object.keys(RESEARCH).length);
    for (const [id, b] of Object.entries(BUILDINGS) as Array<[string, BuildingDef]>) {
      if (b.unlock === 'start' || b.unlock === 'never') continue;
      expect(nodes.has(b.unlock), `${id} → ${b.unlock}`).toBe(true);
    }
    // Research hangs from the observatory's plan: every research root needs it.
    for (const [id, r] of Object.entries(RESEARCH)) if (r.depth === 1) expect(treePrereq(id), id).toContain('observatory');
  });

  it('the plans grow in paths of one theme (D41): each plan on one path, each path one line from one entry, no loop', () => {
    expect(pathProblems()).toEqual([]);
    expect(PLAN_PATHS).toEqual(['production', 'logistics', 'energy', 'analytics', 'trade', 'survey']);
    // Every plan on exactly one listed path, and plans declared path by path in the tree's order.
    expect(PLAN_PATHS.flatMap((p) => pathPlans(p))).toEqual(PLAN_IDS);
    expect(PLAN_PATHS.map((p) => pathEntries(p))).toEqual([['kiln'], ['router'], ['wind_flower'], ['telemetry'], ['trade_post'], ['beacon']]);
    // A path is a DAG: walking a plan's prerequisites on its own path never comes back to it,
    // and always ends at the path's entry.
    for (const lane of PLAN_PATHS) {
      const entry = pathEntries(lane)[0]!;
      for (const id of pathPlans(lane)) {
        const seen = new Set<string>();
        const up = (q: string, trail: string[]): void => {
          expect(trail, `${lane}: loop through ${q}`).not.toContain(q);
          seen.add(q);
          for (const r of treePrereq(q)) if (planDef(r)?.lane === lane) up(r, [...trail, q]);
        };
        up(id, []);
        expect(seen.has(entry), `${lane}: ${id} does not lead back to ${entry}`).toBe(true);
      }
    }
  });

  it('the analytics path (D41): telemetry first (saves and quest 2 know its id), then the ledger, the power log, the diagnostics — each turning on its own flag, and only that', () => {
    expect(pathPlans('analytics')).toEqual(['telemetry', 'statistics', 'power_log', 'diagnostics']);
    expect(pathEntries('analytics')).toEqual(['telemetry']);
    expect(PLANS.telemetry.prereq).toEqual([]); // a root plan: the tutorial's first plan never waits
    expect(ANALYTICS).toEqual({ rates: 'telemetry', ledger: 'statistics', power: 'power_log', machines: 'diagnostics' });
    for (const id of pathPlans('analytics')) {
      const p = PLANS[id] as PlanDef;
      expect(p.effects, id).toEqual([{ k: 'flag', flag: id }]);
      expect(p.name && p.desc, `${id}: a feature plan says what it brings`).toBeTruthy();
    }
    // Analytics is information, not production: no building, no recipe behind those plans.
    for (const id of pathPlans('analytics')) {
      expect(Object.values(BUILDINGS).some((b) => (b as BuildingDef).unlock === id), id).toBe(false);
      expect(Object.values(RECIPES).some((r) => (r as RecipeDef).unlock === id), id).toBe(false);
    }
  });

  it('the first ring of plans is cheap: the starting stock pays for all of it at once', () => {
    const roots = rootPlans();
    expect(roots.length).toBeGreaterThanOrEqual(4);
    const need = new Map<string, number>();
    for (const id of roots) for (const [it, n] of (PLANS as Record<string, PlanDef>)[id]!.cost) need.set(it, (need.get(it) ?? 0) + n);
    for (const [it, n] of need) expect(n, it).toBeLessThanOrEqual(BAL.startStock[it] ?? 0);
  });

  it('no dead end (D36): the bootstrap rebuilds plates, glass and copper wire through plans alone, and a new base holds its reserve', () => {
    expect(reserveProblems()).toEqual([]);
    expect(ESSENTIAL).toEqual(['iron_plate', 'glass', 'copper_wire']);
    expect(BOOTSTRAP.map((_, s) => stagePlans(s))).toEqual([['kiln', 'sand_collector'], ['wire_mill']]);
    // Stage 1 from the stock (2 drills, a sand collector, the smelter, 2 poles, the smelter's and the
    // collector's plans); stage 2 waits for stage 1's plates and glass, so only its 2 poles' copper
    // wire is kept.
    expect(reserveNeed(() => false)).toEqual([['iron_plate', 59], ['glass', 4], ['copper_wire', 6]]);
    expect(reserveNeed((p) => p === 'kiln')).toEqual([['iron_plate', 49], ['glass', 4], ['copper_wire', 6]]);
    expect(RESERVED).toEqual(['iron_plate', 'glass', 'copper_wire']);
    // The first ring of plans, all bought at once, leaves the reserve whole: a new player never meets a refusal there.
    const left = new Map(Object.entries(BAL.startStock));
    for (const id of rootPlans()) for (const [it, n] of (PLANS as Record<string, PlanDef>)[id]!.cost) left.set(it, left.get(it)! - n);
    for (const [it, n] of reserveNeed((p) => rootPlans().includes(p))) expect(left.get(it)!, it).toBeGreaterThanOrEqual(n);
  });
});
