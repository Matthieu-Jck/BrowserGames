import { describe, it, expect } from 'vitest';
import { categoryProblems, entranceProblems, fluidPortProblems, reachableItems, reachableNodes, rootPlans, startBuildings, tiredVeinPerMin, uniquesNeeded, validateContent, wasteInputProblems, wirePerElectronicsWorkshop } from './validate';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ANALYTICS, PLAN_IDS, PLAN_PATHS, PLANS, RESEARCH, pathEntries, pathPlans, pathProblems, planDef, treePrereq } from './research';
import { BOOTSTRAP, ESSENTIAL, RESERVED, reserveNeed, reserveProblems, stagePlans } from './reserve';
import { FEATURE_NEEDS, buyable, knownAt, mapSpecific, nodeUnusable, usabilityProblems, usableWith } from './usable';
import { CATEGORIES, CATEGORY_IDS, DEPTH_COST, THEMES, TIER_GATE, categoryNodes, researchNeeds, tierCategories, tierOfDepth } from './research';
import type { BuildingDef, PlanDef, RecipeDef } from './types';

describe('content invariants', () => {
  it('the content tables hold together (items, recipes, buildings, research)', () => {
    expect(validateContent()).toEqual([]);
  });

  it('every item can be produced from the land', () => {
    const r = reachableItems();
    for (const id of Object.keys(ITEMS)) expect(r.has(id), id).toBe(true);
  });

  it('one entrance a kind of input (D140): no machine has fewer entrances than a recipe of its takes kinds', () => {
    expect(entranceProblems()).toEqual([]);
    // The chip fab, short until D140: the circuit's copper plate, copper wire and glass, each on its own entrance.
    const ins = (id: keyof typeof BUILDINGS): number => (BUILDINGS[id] as BuildingDef).ports.filter((p) => p.io === 'in').length;
    expect(ins('chip_fab')).toBe(3);
    for (const id of ['workshop', 'etcher', 'chip_fab'] as const) expect(ins(id), id).toBeGreaterThanOrEqual(new Set(RECIPES.circuit.ins.map(([it]) => it)).size);
    // A machine one entrance short fails, named with the recipe that wants more; kinds count, not quantities.
    const fab = BUILDINGS.chip_fab as BuildingDef;
    const short: BuildingDef = { ...fab, ports: fab.ports.filter((p) => !(p.io === 'in' && p.x === 0)) };
    expect(entranceProblems([['chip_fab', short]], [['circuit', RECIPES.circuit as RecipeDef]])).toEqual([
      'building chip_fab: 2 entrances, but recipe circuit takes 3 kinds of input (one entrance a kind, D140)',
    ]);
    const twoWires: RecipeDef = { ...(RECIPES.circuit as RecipeDef), ins: [['copper_wire', 1], ['copper_wire', 1], ['glass', 1]] };
    expect(entranceProblems([['chip_fab', short]], [['circuit', twoWires]])).toEqual([]);
    // A building no recipe names is not a machine: no entrance asked of it.
    expect(entranceProblems([['silo', BUILDINGS.silo as BuildingDef]], [['circuit', RECIPES.circuit as RecipeDef]])).toEqual([]);
  });

  it('water ports (D142): a pump gives by a fluid outlet, each water drinker has one water entrance and a dry one a kind besides', () => {
    expect(fluidPortProblems()).toEqual([]);
    const wet = (id: keyof typeof BUILDINGS): string[] => (BUILDINGS[id] as BuildingDef).ports.filter((p) => p.fluid).map((p) => `${p.x},${p.y},${p.side},${p.io}`);
    expect(wet('pump')).toEqual(['0,0,N,out']);
    expect(wet('hp_pump')).toEqual(['0,0,N,out']);
    expect(wet('steam_boiler')).toEqual(['2,1,S,in']); // the water intake on the right; the coal on the left
    expect(wet('brickworks')).toEqual(['1,1,S,in']);
    expect(wet('ceramic_oven')).toEqual(['1,1,S,in']);
    // No other building has one: a ribbon-fed machine's ports are all dry.
    for (const [id, b] of Object.entries(BUILDINGS) as Array<[string, BuildingDef]>) {
      if (['pump', 'hp_pump', 'steam_boiler', 'brickworks', 'ceramic_oven'].includes(id)) continue;
      expect(b.ports.some((p) => p.fluid), id).toBe(false);
    }
    // Marked wrong, each fails by name.
    const of = (id: keyof typeof BUILDINGS): BuildingDef => BUILDINGS[id] as BuildingDef;
    const dry = (b: BuildingDef): BuildingDef => ({ ...b, ports: b.ports.map(({ fluid: _f, ...p }) => p) });
    const brick = RECIPES.brick as RecipeDef;
    expect(fluidPortProblems([['pump', dry(of('pump'))]], [])).toEqual(['building pump: gives a fluid through an outlet not marked fluid (D142)']);
    expect(fluidPortProblems([['brickworks', dry(of('brickworks'))]], [['brick', brick]])).toEqual(['building brickworks: drinks water through 0 water entrances (one, D142)']);
    expect(fluidPortProblems([['steam_boiler', dry(of('steam_boiler'))]], [])).toEqual(['building steam_boiler: drinks water through 0 water entrances (one, D142)']);
    const allWet: BuildingDef = { ...of('brickworks'), ports: of('brickworks').ports.map((p) => ({ ...p, fluid: true as const })) };
    expect(fluidPortProblems([['brickworks', allWet]], [['brick', brick]])).toEqual([
      'building brickworks: a fluid outlet, but it gives no fluid (D142)',
      'building brickworks: drinks water through 2 water entrances (one, D142)',
      'building brickworks: 0 dry entrances for 1 other kinds of input (D140, D142)',
    ]);
    // A water entrance on a machine no fluid goes into: the smelter's (the kiln).
    const kiln: BuildingDef = { ...of('kiln'), ports: of('kiln').ports.map((p, i) => (i === 0 ? { ...p, fluid: true as const } : p)) };
    expect(fluidPortProblems([['kiln', kiln]], [])).toEqual(['building kiln: a water entrance, but it drinks no fluid (D142)']);
  });

  it('waste has no use (D151): no recipe takes slag or scrap in; D125’s recyclers fail by name', () => {
    expect(wasteInputProblems()).toEqual([]);
    for (const [id, r] of Object.entries(RECIPES) as Array<[string, RecipeDef]>) {
      for (const [it] of r.ins) expect(ITEMS[it as keyof typeof ITEMS].kind, `${id} takes ${it}`).not.toBe('waste');
    }
    expect('slag_brick' in RECIPES).toBe(false);
    expect('steel_scrap' in RECIPES).toBe(false);
    // The recipes D151 took out, as D125 had them: each caught, its waste named.
    const slagBrick: RecipeDef = { name: { fr: 'Brique de scories', en: 'Slag Brick' }, machines: ['brickworks'], seconds: 4, ins: [['slag', 2], ['water', 1]], outs: [['brick', 1]], unlock: 'ex_brick' };
    const steelScrap: RecipeDef = { name: { fr: 'Acier de récupération', en: 'Recycled Steel' }, machines: ['steel_mill'], seconds: 12, ins: [['scrap', 3], ['coal', 1]], outs: [['steel', 1]], unlock: 'dn_steel', waste: ['slag', 5] };
    expect(wasteInputProblems([['brick', RECIPES.brick as RecipeDef], ['slag_brick', slagBrick], ['steel_scrap', steelScrap]])).toEqual([
      'recipe slag_brick: takes the waste slag in (waste has no use, D151)',
      'recipe steel_scrap: takes the waste scrap in (waste has no use, D151)',
    ]);
  });

  it('the tired vein cannot feed a single mechanics workshop: copper must be imported', () => {
    expect(tiredVeinPerMin()).toBeCloseTo(6.75, 6);
    expect(tiredVeinPerMin() * 2).toBeCloseTo(13.5, 6);
    expect(wirePerElectronicsWorkshop()).toBe(20); // D129: two wires a circuit (three until then), on a copper plate
  });

  it('a resonator and a nacre lattice each need two different uniques (the atlas and codex went with the data, D122)', () => {
    expect(uniquesNeeded('resonator').size).toBe(2);
    expect(uniquesNeeded('nacre_lattice').size).toBe(2);
    expect(uniquesNeeded('oscillator').size).toBe(0);
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
    expect(PLAN_PATHS).toEqual(['production', 'logistics', 'energy', 'analytics', 'trade']); // the survey path went with the survey beacon (D117)
    // Every plan on exactly one listed path, and plans declared path by path in the tree's order;
    // the research lab's plan apart, the gate after them all (D71).
    expect(PLAN_PATHS.flatMap((p) => pathPlans(p))).toEqual(PLAN_IDS.filter((id) => id !== 'observatory'));
    expect(PLANS.observatory.lane).toBe('gate');
    expect([...PLANS.observatory.prereq].sort()).toEqual(PLAN_IDS.filter((id) => id !== 'observatory').sort());
    expect(PLAN_PATHS.map((p) => pathEntries(p))).toEqual([['kiln'], ['router'], ['wind_flower'], ['telemetry'], ['trade_post']]);
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

  it('the analytics path (D41): telemetry first (saves and quest 2 know its id), then the ledger, the power log, the diagnostics and the wind survey (D95) — each turning on its own flag, and only that', () => {
    expect(pathPlans('analytics')).toEqual(['telemetry', 'statistics', 'power_log', 'diagnostics', 'anemometry']);
    expect(pathEntries('analytics')).toEqual(['telemetry']);
    expect(PLANS.telemetry.prereq).toEqual([]); // a root plan: the tutorial's first plan never waits
    expect(ANALYTICS).toEqual({ rates: 'telemetry', ledger: 'statistics', power: 'power_log', machines: 'diagnostics', wind: 'anemometry' });
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

describe('nothing unusable (D107)', () => {
  it('every node of the tree unlocks only what the base can use by then: buildings paid and run, recipes fed, features with what they act on', () => {
    expect(usabilityProblems()).toEqual([]);
  });

  it('usable means extracted, made or bought: a cliff face’s quartz only through a trade post, water never bought, the uniques only bought', () => {
    expect(mapSpecific('quartz')).toBe(true);
    expect(mapSpecific('sporeglass')).toBe(true);
    expect(mapSpecific('iron_ore')).toBe(false);
    expect(buyable('quartz')).toBe(true);
    expect(buyable('water')).toBe(false);
    expect(usableWith(new Set(['kiln', 'wire_mill', 'ex_quartz'])).items.has('quartz')).toBe(false);
    expect(usableWith(new Set(['kiln', 'wire_mill', 'telemetry', 'trade_post', 'ex_quartz'])).items.has('quartz')).toBe(true);
    // Before the sand collector and the wire mill, a kiln makes plates but no glass, and no wire is drawn.
    const kiln = usableWith(knownAt('kiln')).items;
    expect(kiln.has('iron_plate')).toBe(true);
    expect(kiln.has('glass') || kiln.has('copper_wire')).toBe(false);
    // A research node knows every plan (the lab's gate needs them all, D71).
    expect(knownAt('tr1').has('trade_post')).toBe(true);
  });

  it('the rule catches what the tree used to unlock too early (the violations D107 fixed)', () => {
    // Each fix is pinned: the prerequisite that makes it usable.
    expect(PLANS.assembly_bench.prereq).toContain('wire_mill'); // D129: its coils are copper wire (the electronics workshop's plan stood here)
    expect(PLANS.ex_quartz.prereq).toContain('trade_post');
    expect(RESEARCH.ex_sifter.prereq).toContain('tr2'); // Basalt Bits after it: the excavator's bits
    expect(RESEARCH.dn_compact.prereq).toContain('tr3'); // the assembly recipes are Ceramics'
    expect(RESEARCH.cm_plan.prereq).toContain('an_servers'); // no token billed before the servers (D105)
    expect(RESEARCH.xp4.prereq).toContain('tr4'); // the pylons are Land Registry's
    // Every feature the tree uses says what it acts on.
    for (const id of [...PLAN_IDS, ...Object.keys(RESEARCH)]) expect(nodeUnusable(id), id).toEqual([]);
    expect(FEATURE_NEEDS.tokenPlan).toContain('server');
  });

  it('the tree’s shape (D107): Logistics, Commerce’s beginner Tier 1, the Fast Drill at Tier 1, Finance at Tier 2', () => {
    expect(THEMES.xp.name).toEqual({ fr: 'Logistique', en: 'Logistics' });
    expect(RESEARCH.cm_post2.tier).toBe(1);
    expect(RESEARCH.cm2.tier).toBe(2);
    expect(RESEARCH.ex_fastdrill.tier).toBe(1);
    expect(RESEARCH.ex_sifter.tier).toBe(2);
  });

  it('the categories (D128): each tier its own, a category opening once those of the tier before it names are finished', () => {
    expect(categoryProblems()).toEqual([]);
    // Every tier has its own, and every node stands in one of its tier.
    for (const tier of [1, 2, 3, 4] as const) expect(tierCategories(tier).length, `Tier ${tier}`).toBeGreaterThanOrEqual(5);
    for (const [id, r] of Object.entries(RESEARCH)) expect(CATEGORIES[r.cat as keyof typeof CATEGORIES].tier, id).toBe(r.tier);
    // The trunk and Machines merged, then re-split: Mechanics and the quartz workshop in the
    // Workshop, the smelters in the Foundry, Ceramics with Optics, Land Registry in the Territory.
    expect(RESEARCH.tr1.cat).toBe('t1_workshop');
    expect(RESEARCH.dn_quartzshop.cat).toBe('t1_workshop');
    expect(RESEARCH.dn_esmelt.cat).toBe('t1_foundry');
    expect([RESEARCH.tr3.cat, RESEARCH.tr6.cat]).toEqual(['t2_ceramics', 't2_ceramics']);
    expect(RESEARCH.tr4.cat).toBe('t2_land');
    // Gates: usually one (Commerce → Finance), sometimes two (Foundry and Workshop → Automation).
    expect(CATEGORIES.t2_finance.gates).toEqual(['t1_commerce']);
    expect(CATEGORIES.t2_automation.gates).toEqual(['t1_foundry', 't1_workshop']);
    for (const c of tierCategories(1)) expect(CATEGORIES[c].gates, c).toEqual([]);
    // A node needs its category's gates whole, and its tier's gate: Standing Orders, Commerce and the Synthesis.
    expect(researchNeeds('cm2')).toEqual(expect.arrayContaining(['cm_post2', 'cm_floor', 'tr_synth']));
    expect(researchNeeds('cm2')).not.toContain('xp_swift');
    // No node needs one of another tier by name: the gates carry the tiers' links.
    for (const [id, r] of Object.entries(RESEARCH)) for (const p of r.prereq) {
      const q = RESEARCH[p as keyof typeof RESEARCH];
      if (q) expect(q.tier, `${id} → ${p}`).toBe(r.tier);
    }
    // Each tier's gate stands in a category of the tier before, and every category can be finished.
    for (const tier of [2, 3, 4] as const) expect(RESEARCH[TIER_GATE[tier] as keyof typeof RESEARCH].tier).toBe(tier - 1);
    const learnt = reachableNodes();
    for (const c of CATEGORY_IDS) for (const id of categoryNodes(c)) expect(learnt.has(id), `${c}: ${id}`).toBe(true);
  });

  it('the Synthesis needs what the Core’s level 3 is paid in, no longer Tier 1 whole (D128)', () => {
    const needs = new Set<string>();
    const walk = (id: string): void => { for (const p of researchNeeds(id)) if (!needs.has(p)) { needs.add(p); walk(p); } };
    walk('tr_synth');
    for (const id of ['tr1', 'dn_quartzshop', 'dn_wiremill', 'an_data', 'dn_steel', 'ex_brick', 'dn_copper']) expect(needs.has(id), id).toBe(true);
    for (const id of ['cm_post2', 'en_pitch', 'xp_swift', 'dn_esmelt']) expect(needs.has(id), id).toBe(false);
  });

  it('research is short early and long late (D107): the pace by tier; tokens at every tier, few at Tier 1 (D122)', () => {
    const band: Record<number, [number, number]> = { 1: [1, 10], 2: [8, 30], 3: [60, 360], 4: [480, 1440] };
    for (const r of Object.values(RESEARCH)) expect(r.tokens > 0 && (r.tier > 1 || r.tokens <= 10_000), r.name.en).toBe(true);
    // Tier 1 on the Core's compute alone (D122): a node in minutes from its level 2.
    for (const r of Object.values(RESEARCH)) if (r.tier === 1) expect(r.tokens / BAL.coreCompute[1]!, r.name.en).toBeLessThanOrEqual(10);
    // Its resources (D122): one to three kinds, whole, never a data item (gone), made before it.
    for (const [id, r] of Object.entries(RESEARCH)) {
      expect(r.cost.length, id).toBeGreaterThanOrEqual(1);
      expect(r.cost.length, id).toBeLessThanOrEqual(3);
      for (const [it] of r.cost) expect(it in ITEMS, `${id}: ${it}`).toBe(true);
    }
    for (const [d, c] of Object.entries(DEPTH_COST)) {
      const [lo, hi] = band[tierOfDepth(Number(d))]!;
      expect(c.minutes, `depth ${d}`).toBeGreaterThanOrEqual(lo);
      expect(c.minutes, `depth ${d}`).toBeLessThanOrEqual(hi);
    }
    for (const [id, r] of Object.entries(RESEARCH)) {
      const [lo, hi] = band[r.tier]!;
      expect(r.minutes, id).toBeGreaterThanOrEqual(lo);
      expect(r.minutes, id).toBeLessThanOrEqual(hi);
    }
  });
});
