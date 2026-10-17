import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { BOOTSTRAP, ESSENTIAL, RESERVED, reserveNeed, stagePlans } from '@/content/reserve';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS, buildingDef, buildingIdx, itemIdx, recipesFor } from '@/content/registry';
import { PLAN_IDS, planDef } from '@/content/research';
import type { BuildingDef } from '@/content/types';
import { WORLD_SEED } from '@/content/world';
import { hash32 } from '@/core/hash';
import { replay } from '../commands';
import { CENTER, EPOCH, WORLD_EPOCH0 } from '../constants';
import { connect, powerLine } from '../dev';
import { worldPorts } from '../entities';
import { isLinkPoint, linkable } from '../power/links';
import { deserialize, serialize } from '../serialize';
import { Sim } from '../state';
import { line, testSim, testSource } from '../testkit';
import { isFloor, type Rot } from '../types';
import { inWorld, tileIndex } from '../world/grid';
import { MapGen } from '../world/mapgen';
import { planCost } from './research';
import { assets, reserveHolds, reserveNeed as needNow, RESERVED_ITEMS } from './reserve';

const mu = (n: number): number => n * 1000;
const PLATE = (): number => itemIdx('iron_plate');

// ── rebuilding production, as a player would after the worst ────────────────

/** Free floor for `def` at (x, y, rot), every port opening onto free floor (a ribbon can start or end there). */
function fits(sim: Sim, def: string, x: number, y: number, rot: Rot): boolean {
  const c = sim.canPlace(def, x, y, rot);
  if (!c.ok || c.replaces.length) return false;
  return worldPorts({ def: buildingIdx(def), x, y, rot }).every((p) =>
    inWorld(p.fx, p.fy) && sim.grid.occ[tileIndex(p.fx, p.fy)] === 0 && isFloor(sim.grid.terrain(p.fx, p.fy)));
}

/** Placements of `def` within `r` of the Heart, nearest first (then y, x, rot); on `item` ore only (its whole 2×2), if given. */
function spots(sim: Sim, def: string, item: string | null, r = 24): Array<[number, number, Rot]> {
  const it = item ? itemIdx(item) : -1;
  const out: Array<[number, number, Rot, number]> = [];
  for (let y = CENTER - r; y <= CENTER + r; y++) {
    for (let x = CENTER - r; x <= CENTER + r; x++) {
      if (it >= 0 && !(sim.grid.ore(x, y) === it && sim.grid.ore(x + 1, y) === it && sim.grid.ore(x, y + 1) === it && sim.grid.ore(x + 1, y + 1) === it)) continue;
      for (const rot of [0, 1, 2, 3] as Rot[]) if (fits(sim, def, x, y, rot)) out.push([x, y, rot, (x - CENTER) ** 2 + (y - CENTER) ** 2]);
    }
  }
  out.sort((a, b) => a[3] - b[3] || a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  return out.map(([x, y, rot]) => [x, y, rot]);
}

function place(sim: Sim, def: string, at: [number, number, Rot]): number {
  const r = sim.place(def, ...at);
  if (!r.ok) throw new Error(`${def} at ${at.join(',')}: ${r.reason}`);
  return r.id!;
}

/** Entities added since id `from` (ids are never reused), newest first. */
const since = (sim: Sim, from: number): number[] => sim.ents.sorted().filter((e) => e.id >= from).map((e) => e.id).reverse();
const removeAll = (sim: Sim, ids: readonly number[]): void => { for (const id of ids) { const e = sim.ents.get(id); if (e) sim.remove(e.x, e.y); } };

/** A machine near the Heart with its lines: from each of `feeds` into its inputs (in port order), and from it into the Heart (the nearest `tries` spots). */
function machineWithLines(sim: Sim, def: string, feeds: readonly number[], tries = Infinity, r = 12): { id: number; lines: number[][] } {
  for (const at of spots(sim, def, null, r).slice(0, tries)) {
    const from = sim.ents.nextId;
    const id = place(sim, def, at);
    const lines: number[][] = [];
    for (const [k, src] of feeds.entries()) {
      const mark = sim.ents.nextId;
      if (!connect(sim, src, id, -1, k)) break;
      lines.push(since(sim, mark));
    }
    if (lines.length === feeds.length && connect(sim, id, sim.hearthId)) return { id, lines };
    removeAll(sim, since(sim, from));
  }
  throw new Error(`no spot for a ${def} with its lines`);
}

/** A drill on `item`, the nearest whole-deposit spot to the Heart. */
function drillOn(sim: Sim, item: string): number {
  const at = spots(sim, 'drill', item)[0];
  if (!at) throw new Error(`no drill spot on ${item}`);
  return place(sim, 'drill', at);
}

/** Run until `ok()` holds, a few seconds at a time, for at most `minutes` game minutes. */
function runUntil(sim: Sim, ok: () => boolean, minutes: number, what: string): void {
  for (let t = 0; !ok(); t += 50) {
    if (t > minutes * EPOCH) throw new Error(`${what}: not within ${minutes} min`);
    sim.run(50);
  }
}

/** What stage `s` costs (milli-items by item index): its buildings and the plans it still needs. */
function stageCost(sim: Sim, s: number): Map<number, number> {
  const out = new Map<number, number>();
  const add = (it: string, n: number): void => { out.set(itemIdx(it), (out.get(itemIdx(it)) ?? 0) + mu(n)); };
  for (const [id, k] of BOOTSTRAP[s]!.builds) for (const [it, n] of (BUILDINGS as Record<string, BuildingDef>)[id]!.cost) add(it, n * k);
  for (const p of stagePlans(s)) if (!sim.done.has(p)) for (const [it, n] of planDef(p)!.cost) add(it, n);
  return out;
}

/**
 * Rebuild production with nothing but what the base holds, as a player would after the worst:
 * take every building down (full refunds: the reserve is now all in the Heart), then build the
 * bootstrap's stages in order. Stage 1: a smelter fed by drills on iron and coal makes plates
 * until stage 2's are in, then a sand line and the glass recipe make its glass. Stage 2: the copper
 * line makes copper wire. Poles are laid as the wiring needs them (`powerLine`). Throws at the first
 * thing that cannot be done; returns the poles each stage took and what it made of each essential item.
 */
function rebuild(sim: Sim): { masts: number[]; made: Record<string, number> } {
  removeAll(sim, sim.ents.sorted().filter((e) => e.id !== sim.hearthId).map((e) => e.id));
  sim.ensureCompiled(); // what rode the ribbons is back in the Heart (not on ribbons laid on the same tiles)
  const need = needNow(sim);
  for (const i of RESERVED_ITEMS) if (sim.stock[i]! < need[i]!) throw new Error(`taken down, the base holds ${sim.stock[i]! / 1000} of item ${i}: the reserve is ${need[i]! / 1000}`);
  const masts = [0, 0];
  const made0 = Float64Array.from(sim.produced);
  const unlock = (s: number): void => {
    for (const p of stagePlans(s)) {
      if (sim.done.has(p)) continue;
      const r = sim.unlockPlan(p);
      if (!r.ok) throw new Error(`stage ${s + 1}: plan ${p}: ${r.reason}`);
    }
  };
  const wire = (s: number, id: number): void => {
    masts[s] = masts[s]! + powerLine(sim, id);
    if (!sim.linksOf(id).length) throw new Error(`stage ${s + 1}: ${BUILDING_KIND[sim.ents.get(id)!.def]} ${id} could not be wired`);
  };
  const enough = (cost: Map<number, number>, items: readonly string[]): boolean => items.every((it) => sim.stock[itemIdx(it)]! >= (cost.get(itemIdx(it)) ?? 0));
  /** It makes some (a few crafts' worth since `from`), and the Heart holds what the next stage needs of it. */
  const flowing = (it: string, from: Float64Array, cost: Map<number, number>): boolean =>
    sim.produced[itemIdx(it)]! >= from[itemIdx(it)]! + mu(4) && enough(cost, [it]);

  // Stage 1: plates, then glass, from one smelter (the sand from a collector on bare sand, by the Heart).
  unlock(0);
  const iron = drillOn(sim, 'iron_ore'), coal = drillOn(sim, 'coal');
  for (const d of [iron, coal]) wire(0, d);
  const kiln = machineWithLines(sim, 'kiln', [iron, coal]);
  if (!sim.setRecipe(kiln.id, 'iron_plate')) throw new Error('stage 1: no plate recipe');
  // The sand collector, paid now like the rest of the stage: on bare sand by the smelter, never
  // against the Heart (its inputs stay free for the copper's line); wired once it has its line.
  const kc = sim.ents.get(kiln.id)!;
  const sandSpots = (): Array<[number, number, Rot]> => spots(sim, 'sand_collector', null, 14)
    .filter(([x, y]) => x + 1 < CENTER - 4 || x > CENTER + 4 || y + 1 < CENTER - 4 || y > CENTER + 4)
    .sort((a, b) => ((a[0] - kc.x) ** 2 + (a[1] - kc.y) ** 2) - ((b[0] - kc.x) ** 2 + (b[1] - kc.y) ** 2) || a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  const first = sandSpots()[0];
  if (!first) throw new Error('stage 1: no bare sand for a sand collector');
  let sand = place(sim, 'sand_collector', first);
  const next = stageCost(sim, 1);
  runUntil(sim, () => flowing('iron_plate', made0, next), 60, 'stage 1: plates');
  removeAll(sim, kiln.lines[0]!);
  sim.ensureCompiled(); // the ore on that line goes back to the Heart, not onto the sand line
  // The sand line; if none fits from where the collector stands, move it (a removal refunds it all)
  // to the first spot by the Heart whose line reaches the smelter's free input. Then wire it.
  if (!connect(sim, sand, kiln.id, -1, 0)) {
    removeAll(sim, [sand]);
    sand = 0;
    for (const at of sandSpots()) {
      const from = sim.ents.nextId;
      const id = place(sim, 'sand_collector', at);
      if (connect(sim, id, kiln.id, -1, 0)) { sand = id; break; }
      removeAll(sim, since(sim, from));
    }
  }
  if (!sand) throw new Error('stage 1: no sand line to the smelter');
  wire(0, sand);
  if (!sim.setRecipe(kiln.id, 'glass')) throw new Error('stage 1: no glass recipe');
  runUntil(sim, () => flowing('glass', made0, next), 60, 'stage 1: glass');

  // Stage 2: the copper line (its copper wire was kept by the reserve).
  if (!enough(next, ['copper_wire'])) throw new Error('stage 2: its copper wire is not in the Heart');
  unlock(1);
  const copper = drillOn(sim, 'copper_ore');
  wire(1, copper);
  const mill = machineWithLines(sim, 'wire_mill', [copper], Infinity, 18); // past what stage 1 laid by the Heart
  wire(1, mill.id);
  if (!sim.setRecipe(mill.id, 'copper_wire')) throw new Error('stage 2: no wire recipe');
  const w0 = sim.produced[itemIdx('copper_wire')]!;
  runUntil(sim, () => sim.produced[itemIdx('copper_wire')]! >= w0 + mu(4), 30, 'stage 2: copper wire');

  const made: Record<string, number> = {};
  for (const it of ESSENTIAL) made[it] = (sim.produced[itemIdx(it)]! - made0[itemIdx(it)]!) / 1000;
  return { masts, made };
}

/** A new base on the real map (Ysmère, the shared cirque, this player's jitter), holding exactly the reserve and nothing else (a test shortcut). */
function holdingTheReserve(playerSeed: number, foundingEpoch: number): Sim {
  const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed, source: new MapGen(WORLD_SEED, playerSeed), foundingEpoch });
  sim.stock.fill(0);
  for (const [it, n] of reserveNeed(() => false)) sim.stock[itemIdx(it)] = mu(n);
  return sim;
}

const clone = (sim: Sim): Sim => deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());

// ── the fuzz ────────────────────────────────────────────────────────────────

/** A deterministic stream of choices: hash32 of the seed and a counter. */
const chooser = (seed: number): ((n: number) => number) => {
  let k = 0;
  return (n) => (n <= 1 ? 0 : hash32(seed, k++) % n);
};

const DRILLED = ['iron_ore', 'coal', 'copper_ore']; // sand is the ground: collectors go anywhere

/**
 * A smelter line, as a player who knows the game lays it: its plan, drills on iron and coal, the
 * smelter, its lines, its wires. Undone if any part fails; `budget.tries` caps the attempts of a
 * walk (a crowded base makes every attempt a long search).
 */
function smelterLine(sim: Sim, budget: { tries: number }): string {
  if (budget.tries <= 0) return 'line: no more tries';
  if (sim.ents.sorted().some((e) => BUILDING_KIND[e.def] === 'machine')) return 'line: one stands';
  if (!sim.unlocked('kiln') && !sim.unlockPlan('kiln').ok) return 'line: no smelter plan';
  budget.tries--;
  const from = sim.ents.nextId;
  try {
    const iron = drillOn(sim, 'iron_ore'), coal = drillOn(sim, 'coal');
    for (const d of [iron, coal]) { powerLine(sim, d); if (!sim.linksOf(d).length) throw new Error('unwired'); }
    const k = machineWithLines(sim, 'kiln', [iron, coal], 6);
    sim.setRecipe(k.id, 'iron_plate');
    return 'line: built';
  } catch (e) {
    removeAll(sim, since(sim, from));
    return `line: ${(e as Error).message}`;
  }
}

/** A trade post against the Heart's south side (its plans first), then spot sales of the reserved items out of the Heart's stock (D64: a post sells only what its entrance brings). */
function tradeStream(sim: Sim, pick: (n: number) => number): string {
  const post = sim.ents.sorted().find((e) => BUILDING_KIND[e.def] === 'trade');
  if (!post) {
    for (const id of ['telemetry', 'trade_post']) if (!sim.unlocked(id) && !sim.unlockPlan(id).ok) return `trade: no ${id}`;
    const x = CENTER - 4 + pick(5), y = CENTER + 3;
    return `trade post ${x},${y}: ${sim.place('trade_post', x, y, 0).reason}`;
  }
  const it = RESERVED[pick(RESERVED.length)]!;
  const r = sim.spotTrade(it, 'sell', 1 + pick(40));
  return `sale ${post.id} ${it}: ${'refused' in r ? r.refused : 'ok'}`;
}

/**
 * How often each action comes (percent, in `act`'s order: plan, place, ribbons, remove, link,
 * recipe, smelter line, trade, time). A spender takes plans and builds at random; a builder lays
 * smelter lines, trades from the Heart and lets time run, so production, rewards and stream sales
 * are part of the walk.
 */
const SPENDER = [30, 25, 8, 10, 7, 6, 0, 3, 11];
const BUILDER = [20, 10, 4, 8, 4, 4, 12, 10, 28];

/** One random player action (or some time passing); returns what it was, for the failure message. */
function act(sim: Sim, pick: (n: number) => number, weights: readonly number[], budget: { tries: number }): string {
  let r = pick(100), kind = 0;
  while (kind < weights.length - 1 && r >= weights[kind]!) r -= weights[kind++]!;
  const ents = sim.ents.sorted().filter((e) => e.id !== sim.hearthId);
  if (kind === 0) {
    const id = PLAN_IDS[pick(PLAN_IDS.length)]!;
    return `plan ${id}: ${sim.unlockPlan(id).reason ?? 'ok'}`;
  }
  if (kind === 1) {
    const defs = BUILDING_IDS.filter((b) => b !== 'hearth' && sim.unlocked(buildingDef(buildingIdx(b)).unlock));
    const def = defs[pick(defs.length)]!;
    let x = CENTER - 14 + pick(29), y = CENTER - 14 + pick(29);
    if (BUILDING_KIND[buildingIdx(def)] === 'drill' && !buildingDef(buildingIdx(def)).drill?.ground) {
      const it = itemIdx(DRILLED[pick(DRILLED.length)]!);
      for (let k = 0; k < 60 && sim.grid.ore(x, y) !== it; k++) { x = CENTER - 14 + pick(29); y = CENTER - 14 + pick(29); }
    }
    return `place ${def} ${x},${y}: ${sim.place(def, x, y, pick(4) as Rot).reason}`;
  }
  if (kind === 2) {
    const x = CENTER - 14 + pick(29), y = CENTER - 14 + pick(29);
    return `ribbons ${x},${y}: ${sim.placeBelts('ribbon', line(x, y, pick(4) as Rot, 2 + pick(7)))}`;
  }
  if (kind === 3) {
    const e = ents[pick(ents.length)];
    return e ? `remove ${BUILDING_IDS[e.def]} ${e.id}: ${sim.remove(e.x, e.y)}` : 'remove: nothing';
  }
  if (kind === 4) {
    const points = sim.ents.sorted().filter((e) => isLinkPoint(e.def)), targets = ents.filter((e) => linkable(e.def));
    const a = points[pick(points.length)], b = targets[pick(targets.length)];
    return a && b ? `link ${a.id}-${b.id}: ${sim.link(a.id, b.id).reason}` : 'link: nothing';
  }
  if (kind === 5) {
    const machines = ents.filter((e) => BUILDING_KIND[e.def] === 'machine');
    const m = machines[pick(machines.length)];
    if (!m) return 'recipe: nothing';
    const rs = recipesFor(m.def).filter((c) => sim.unlocked(c.unlock));
    const c = rs[pick(rs.length + 1)];
    return `recipe ${m.id} ${c?.id ?? 'none'}: ${sim.setRecipe(m.id, c?.id ?? null)}`;
  }
  if (kind === 6) return smelterLine(sim, budget);
  if (kind === 7) return tradeStream(sim, pick);
  const n = 1 + pick(1800);
  sim.run(n);
  return `run ${n}`;
}

/** How far above the reserve the base stands: the least of assets − reserve over the reserved items (whole items). */
const margin = (sim: Sim): number => {
  const need = needNow(sim);
  return Math.min(...RESERVED_ITEMS.map((i) => (assets(sim, i) - need[i]!) / 1000));
};

describe('CrierBelt’s restart reserve (D36): a base can always rebuild its production', () => {
  it('a new base holds the bootstrap’s cost from its stock: 59 plates, 4 glass, 6 copper wire; the smelter’s plan takes its share with it', () => {
    const sim = testSim(undefined, { plans: false });
    const need = needNow(sim);
    expect(RESERVED_ITEMS.map((i) => need[i]! / 1000)).toEqual([59, 4, 6]);
    expect(RESERVED_ITEMS.map((i) => sim.reserveFloor(i) / 1000)).toEqual([59, 4, 6]); // nothing built: all of it in the stock
    expect(reserveHolds(sim)).toBe(true);
    expect(sim.unlockPlan('kiln').ok).toBe(true);
    expect(needNow(sim)[PLATE()]! / 1000).toBe(49);
  });

  it('a plan that would eat into it is refused — nothing paid, nothing logged — while the smelter’s plan, wholly in the reserve, never is', () => {
    const sim = testSim(undefined, { plans: false });
    for (const id of ['router', 'wind_flower', 'telemetry', 'beacon', 'junction', 'sorter', 'bridge', 'inverted_sorter']) expect(sim.unlockPlan(id).ok, id).toBe(true);
    expect(sim.stockOf('iron_plate')).toBe(66); // 120 − 54: seven plates above the reserve's 59
    const stock = Float64Array.from(sim.stock), log = sim.log.length;
    expect(sim.planBlock('silo')).toBe('reserve'); // 8 plates: affordable, but 58 would be left for 59
    expect(sim.unlockPlan('silo')).toEqual({ ok: false, reason: 'reserve' });
    expect(sim.reserveShort(planCost('silo'), 'silo')).toEqual([{ item: PLATE(), mu: mu(1) }]);
    expect(Array.from(sim.stock)).toEqual(Array.from(stock));
    expect(sim.log.length).toBe(log);
    // The smelter's plan is part of the bootstrap: it never meets the reserve.
    expect(sim.unlockPlan('kiln').ok).toBe(true);
    // Short of the cost itself still reads « unaffordable » first.
    sim.stock[PLATE()] = mu(5);
    expect(sim.planBlock('wire_mill')).toBe('unaffordable'); // 15 plates, its prerequisite (the smelter) taken
  });

  it('buildings count, so placing and removing never move the verdict; production and rewards lift it', () => {
    const sim = testSim(undefined, { plans: false });
    for (const id of ['router', 'kiln', 'wind_flower', 'telemetry', 'beacon', 'junction', 'trade_post']) expect(sim.unlockPlan(id).ok, id).toBe(true);
    expect(sim.planBlock('silo')).toBe('reserve'); // 54 plates, 8 for the silo: 46 left for 49
    const drill = sim.place('drill', 511, 502, 2);
    const kiln = sim.place('kiln', 506, 505, 1);
    expect(drill.ok && kiln.ok).toBe(true);
    expect(sim.reserveFloor(PLATE()) / 1000).toBe(49 - 25); // the buildings cover what they would refund
    expect(sim.planBlock('silo')).toBe('reserve'); // what may be spent did not move
    expect(sim.remove(511, 502)).toBe(true);
    expect(sim.planBlock('silo')).toBe('reserve');
    sim.grant('iron_plate', 3); // a quest reward, a delivery, a line into the Heart: more to spend
    expect(sim.planBlock('silo')).toBeNull();
  });

  it('a base holding exactly the reserve rebuilds plates, glass and copper wire on the real cirque — every player’s deposits, day or night — within the bootstrap’s poles', () => {
    const counts = BOOTSTRAP.map((st) => st.builds.filter(([id]) => id === 'mast').reduce((n, [, k]) => n + k, 0));
    for (let p = 1; p <= 24; p++) {
      for (const at of [24, 6]) { // noon, and midnight: the Heart's core alone powers the drills
        const sim = holdingTheReserve(p, WORLD_EPOCH0 + at);
        const r = rebuild(sim);
        r.masts.forEach((n, s) => expect(n, `player ${p}, stage ${s + 1}`).toBeLessThanOrEqual(counts[s]!));
        for (const it of ESSENTIAL) expect(r.made[it], `player ${p}: ${it}`).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it('fuzz: no sequence of plans, placements, ribbons, removals, wires, recipes, export streams and time leaves a base unable to rebuild — and every one replays', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const pick = chooser(seed);
      const sim = testSim(undefined, { plans: false });
      if (seed % 2) sim.nameColony('Concession du fuzz'); // the tutorial runs: its rewards come in too
      const trail: string[] = [];
      const budget = { tries: 3 };
      let tight = margin(sim), tightSave = JSON.stringify(serialize(sim));
      for (let step = 0; step < 150; step++) {
        trail.push(act(sim, pick, seed % 4 < 2 ? SPENDER : BUILDER, budget));
        if (!reserveHolds(sim)) {
          const short = sim.reserveShort([]).map((c) => `${ITEM_IDS[c.item]} −${c.mu / 1000}`).join(', ');
          throw new Error(`seed ${seed}, step ${step}: the reserve broke (${short})\n${trail.slice(-10).join('\n')}`);
        }
        const m = margin(sim);
        if (m < tight) { tight = m; tightSave = JSON.stringify(serialize(sim)); }
      }
      // Recoverable means rebuilt: from the tightest moment and from the end, production comes back.
      for (const [when, base] of [['tightest', deserialize(JSON.parse(tightSave), testSource())], ['end', clone(sim)]] as const) {
        try {
          const r = rebuild(base);
          for (const it of ESSENTIAL) expect(r.made[it], `seed ${seed} (${when}): ${it}`).toBeGreaterThan(0);
        } catch (e) {
          throw new Error(`seed ${seed} (${when}, margin ${tight}): ${(e as Error).message}\n${trail.slice(-10).join('\n')}`);
        }
      }
      const b = testSim(undefined, { plans: false });
      replay(b, sim.log, sim.tick);
      expect(b.hash(), `seed ${seed}: replay`).toBe(sim.hash());
    }
  }, 120_000);
});
