// scenario-cirque.ts — the cirque worked to the full, from the grown debug base on (owner,
// 2026-10-15: « les bases d'exemple en debug devraient être plus optimales et optimiser
// l'extraction des ressources dans le cirque et prendre la majorité de la place », D82). The
// tutorial levels keep the tutorial's few drills; past it a player covers every deposit of the
// cirque and smelts what the coal allows:
//   - every cirque deposit covered by drills, each joining a line already running from it (the
//     least loaded first), or a new one: the second iron field's ore sold through the trade post;
//   - more smelters on the iron and coal lines (the coal is the cirque's limit: as much coal as
//     ore a plate), their plates into the Heart;
//   - a sand field on the free floor feeding a glass smelter, its glass into the Heart;
//   - the lines that carry more than a plain ribbon's 60 a minute laid again as swift ribbons.
// Each piece goes through the builder's hands (scenarios.ts `Builder`: real commands, costs
// granted when short, what the map refuses skipped), so the level stays a player's base. Pure
// engine code: no DOM, no clock, integers only.
import { buildingIdx } from '@/content/registry';
import { CIRQUE } from '@/content/world';
import { checkpoint, join, rollback, type BeltTiles } from './dev';
import type { Builder } from './scenarios';
import { tileIndex } from './world/grid';

/** The most drills a deposit takes (its blob of about 37 tiles: some whole on the ore, some astride its rim). */
const DRILLS_PER_DEPOSIT = 12;
/** Tiles round a deposit's centre a new drill is sought within. */
const DEPOSIT_R = 6;
/** A drill astride a deposit's rim: at least this many of its four tiles on the ore (the second pass). */
const RIM_ORE = 2;
/** Smelters for the ore the extra drills bring: kilns (as much coal as ore a plate), or arc furnaces once researched (no coal). */
const EXTRA_SMELTERS = 2;
/** Sand collectors (15 a minute each) a glass smelter takes: a kiln's glass wants 30 a minute, an arc furnace's 60. */
const SAND_PER_KILN = 2, SAND_PER_ARC = 4;
/** Glass smelters in the sand field. */
const GLASS_SMELTERS = 2;

/**
 * The deposits covered and more smelters on their lines: at the end of the grown level, while the
 * base is still open — the late base's works laid after route round them, where laid last they
 * found every deposit boxed in by the works' lines.
 */
export function mineCirque(b: Builder): void {
  mineDeposits(b);
  b.optional(() => moreSmelters(b));
}

/** Last, on what the levels leave free: the sand field (arc furnaces), and the busy lines made swift. */
export function fillCirque(b: Builder): void {
  b.optional(() => sandField(b));
  b.optional(() => swiftLines(b));
}

/**
 * A placement step of the fill (`roles`: what it names), taken back up when it leaves a line that
 * ends nowhere: a line laid over another one's ribbon turns it, and two lines then face each other
 * across a junction (the scenario test checks every level for such dead ends).
 */
function guarded(b: Builder, roles: readonly string[], f: () => unknown): boolean {
  const sim = b.sim;
  const dead = (): number => { sim.ensureCompiled(); return sim.graph.chains.filter((c) => !c.outE.length).length; };
  const before = dead(), cp = checkpoint(sim);
  if (!f()) return false;
  if (dead() <= before) return true;
  rollback(sim, cp);
  for (const r of roles) { delete b.ids[r]; delete b.lines[r]; }
  return false;
}

/** Arc furnaces (Mechanics' Arc Furnace, D70) smelt with power alone: the cirque's coal no longer bounds its plates and glass. */
const arc = (b: Builder): boolean => b.sim.unlocked('dn_arc');

/** The drill roles of the base standing on a deposit (within `DEPOSIT_R` of its centre) whose lines were kept. */
function drillsOn(b: Builder, at: readonly [number, number]): string[] {
  const sim = b.sim, drill = buildingIdx('drill');
  return Object.entries(b.ids).filter(([role, id]) => {
    const e = sim.ents.get(id);
    if (!e || e.def !== drill || !b.lines[role]) return false;
    const dx = e.x + 1 - at[0], dy = e.y + 1 - at[1];
    return dx * dx + dy * dy <= DEPOSIT_R * DEPOSIT_R;
  }).map(([role]) => role).sort();
}

/**
 * Every cirque deposit covered: drills joining the lines already running off it, the one carrying
 * the fewest drills first; a deposit with none (the second iron field) gets a line of its own into
 * the trade post's entrance line (its ore sold) or, without one, into the Heart.
 */
function mineDeposits(b: Builder): void {
  const nth = new Map<string, number>();
  for (const d of CIRQUE.deposits) {
    const k = nth.get(d.item) ?? 0;
    nth.set(d.item, k + 1);
    const at = b.deposit(d.item, k), tag = `${d.item.split('_')[0]}${k ? k + 1 : ''}`;
    const lines = drillsOn(b, at);
    const load = new Map(lines.map((r) => [r, 1]));
    if (!lines.length) {
      // Its ore sold through the trade post's entrance line, else onto an iron line into the Heart, else into the Heart.
      const role = `${tag}.a`;
      const intos: Array<number | string> = [...['post.in', 'iron1', 'iron2'].filter((r) => b.lines[r]), b.H];
      if (!intos.some((into) => guarded(b, [role], () => b.optional(() => b.source(role, 'drill', at, into, { item: d.item, r: DEPOSIT_R }))))) continue;
      b.wireByPole(role);
      lines.push(role);
      load.set(role, 1);
    }
    // Whole on the ore first, then astride its rim (a drill mines the ore tiles under it).
    for (let n = 0, misses = 0, part: number | undefined; n < DRILLS_PER_DEPOSIT && misses < 4; n++) {
      if (misses === 2 && part === undefined) part = RIM_ORE;
      const into = [...load].sort((p, q) => p[1] - q[1] || (p[0] < q[0] ? -1 : 1))[0]![0];
      const role = `${tag}.f${n + 1}`;
      if (!guarded(b, [role], () => b.optional(() => b.source(role, 'drill', at, into, { item: d.item, orePart: part, r: DEPOSIT_R })))) { misses++; continue; }
      b.wireByPole(role);
      load.set(into, load.get(into)! + 1);
    }
  }
}

/** Smelters on the iron lines (a router on each): kilns fed coal too, or arc furnaces on power alone; their plates into the Heart. */
function moreSmelters(b: Builder): void {
  const iron = b.laid('iron1', 'iron2', 'iron2.a'), coal = b.laid('coal', 'coal2', 'coalGen');
  const byArc = arc(b);
  if (!iron.length || (!byArc && !coal.length)) { b.skip('smelters'); return; }
  for (let k = 0; k < EXTRA_SMELTERS; k++) {
    const role = `smelter${k + 1}`;
    const feeds = byArc ? [{ lines: iron }] : [{ lines: iron }, { lines: coal }];
    if (!guarded(b, [role, `plates.s${k + 1}`], () => b.fed(role, byArc ? 'arc_furnace' : 'kiln', b.mid(b.deposit('iron_ore'), b.deposit('iron_ore', 1)), feeds, b.H, `plates.s${k + 1}`))) continue;
    b.recipe(role, byArc ? 'arc_plate' : 'iron_plate');
    b.wireByPole(role);
  }
}

/**
 * Glass smelters on the free floor, each with its own sand collectors (the cirque's sand is
 * everywhere: the floor itself) — arc furnaces on power alone, or kilns sharing the coal line —
 * their glass joining the glass line already running into the Heart (and the trade post): a short
 * line, where one laid across the whole base to the Heart would cost the build seconds.
 */
function sandField(b: Builder): void {
  const sim = b.sim, byArc = arc(b), coal = b.laid('coal', 'coal2', 'coalGen');
  // Before the arc furnace the cirque's coal is all the smelters' already (about three dozen a
  // minute against their fifty-five): a glass kiln more would stand cold.
  if (!b.lines['glass'] || !byArc) return;
  for (let g = 1; g <= GLASS_SMELTERS; g++) {
    const role = `glassworks${g}`, near = b.middle('glass');
    if (byArc) { if (!guarded(b, [role], () => b.source(role, 'arc_furnace', near, 'glass', { r: 10 }))) break; }
    else {
      if (!b.fed(role, 'kiln', near, [{ lines: coal }], null)) break;
      const out = join(sim, b.ids[role]!, b.lines['glass']!);
      if (!out) { const e = sim.ents.get(b.ids[role]!)!; sim.remove(e.x, e.y); delete b.ids[role]; b.skip(role); break; }
      b.lines[`${role}.out`] = out;
    }
    b.recipe(role, byArc ? 'arc_glass' : 'glass');
    b.wireByPole(role);
    let into: number | string = b.ids[role]!;
    for (let k = 1; k <= (byArc ? SAND_PER_ARC : SAND_PER_KILN); k++) {
      const sand = `${role}.sand${k}`;
      if (!guarded(b, [sand], () => b.source(sand, 'sand_collector', b.centre(role), into))) continue;
      b.wireByPole(sand);
      into = sand;
    }
  }
}

/**
 * The lines that now carry more than a plain ribbon's 60 a minute (the deposits' collector lines,
 * the trade post's entrance) laid again as swift ribbons (D24: laid over, the routers kept).
 */
function swiftLines(b: Builder): void {
  const sim = b.sim;
  if (!sim.unlocked('xp_swift')) return;
  const ribbon = buildingIdx('ribbon');
  const roles = Object.keys(b.lines).filter((r) => /^(iron|coal|copper|post\.in)/.test(r) && !r.includes('.f') && !r.endsWith('.a'));
  for (const role of roles) {
    const plain: BeltTiles = (b.lines[role] ?? []).filter(([x, y, r]) => { const e = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!); return e?.def === ribbon && e.rot === r; });
    if (plain.length < 2) continue;
    b.afford([['iron_plate', plain.length], ['gear', plain.length]]);
    sim.placeBelts('swift_ribbon', plain);
  }
}
