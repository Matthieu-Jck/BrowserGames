// scenario-basics.ts — D123's works in the late debug base (owner, 2026-10-17: « Il faut rajouter des
// trucs à faire avec les ressources de base »): what a player of that size has made of the basic
// resources' second step, laid through commands like the base's other works, each whole or not at
// all, early in the late build (before its works take the floor and the shores):
//   - the brickworks: a pump at the water nearest the Core (readouts/water.ts, as « La vapeur »'s), a
//     conduit to the brickworks past it or toward the Core, a sand collector on the bare sand beside
//     it, its bricks along a ribbon into the Core;
//   - the steel line: the cirque's deposits are mined out by then (D82), so it takes what flows past —
//     where an iron line and a coal line pass closest, an electric smelter on a branch of the iron
//     (plates on power, no coal) and the steel mill on a branch of the coal (the steam boiler's line
//     first: that boiler burns only what the grid asks, its coal backs up most of the day), its steel
//     into the Core, a press rolling pipes off it. Their waste (D125: the mill's slag, the press's
//     scrap) is sorted off before the Core, which takes none in (D139); the smelter melts clean.
// What goes into the Core goes straight in where an intake can be reached, else joins a line that
// runs into it with nothing on the way to turn it aside, else a trade post's line (the Crier buys it),
// else a silo of its own (`intoCore`). A work that cannot be laid is taken back up (`rollback`) and
// reported by name (`steel`, `bricks`): a half-built line would stand idle, which the scenario test
// refuses (D85); the test lets these two go where the land leaves no room. Their power is the late
// base's turbines', sized after the build (`powerUp`).
import { BUILDING_KIND, buildingIdx } from '@/content/registry';
import { checkpoint, join, lay, placeFeeding, rollback, routeLevel, spotsNear, type BeltTiles } from './dev';
import { worldPorts, type WorldPort } from './entities';
import { waterSpots } from './readouts/water';
import { toward } from './scenario-late';
import { filterFeed, sortWaste } from './scenario-waste';
import type { Builder } from './scenarios';
import { DX, DY, opposite, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';

/** Water spots tried, nearest the Core first; brickworks spots tried by each. */
const WATER_TRIES = 8, WORKS_TRIES = 6;
/** Brickworks spots tried in all (a land where none takes must not cost the build seconds). */
const WORKS_BUDGET = 10;
/** How far the conduit's search may spread (tiles), as « La vapeur »'s. */
const CONDUIT_SEARCH = 6000;
/**
 * Where the brickworks is looked for, in tiles from the water: past it, away from the Core (its
 * conduit cannot cross the lines that ring the Core by then; its bricks' ribbon can, on junctions),
 * then toward the Core.
 */
const PAST = 3, TOWARD = 6;

/** The roles each work lays (forgotten when it is taken back up). */
const STEEL_ROLES = ['steelPlates', 'steel', 'pipes', 'steelSilo', 'pipesSilo'] as const;
const BRICK_ROLES = ['bricks', 'bricksPump', 'bricksSand'] as const;

/** D123's two works, early in the late base's build: the brickworks, then the steel line. */
export function basicsWorks(b: Builder): void {
  brickWorks(b);
  steelWorks(b);
}

/**
 * The steel line, whole or reported `steel`. Every cirque deposit is mined out by then (D82: no
 * drill spot left), so it takes what flows past: the mill on a branch of the steam boiler's coal
 * line — that boiler burns only what the grid asks, its drill's coal backs up most of the day —
 * or the coal lines the smelters share; an electric smelter beside it (its plates on power, no
 * coal) on a branch of an iron ore line, its plates into the mill's other intake; the steel into
 * the Core (`intoCore`), a press rolling pipes off it into the Core too. Tried by the boiler's coal
 * line, then by the plate smelter, then on the open floor nearest the Core, each spot taken back up
 * whole when a part fails.
 */
export function steelWorks(b: Builder): void {
  const sim = b.sim;
  const ore = b.laid(...Object.keys(b.lines).filter((r) => r.startsWith('iron')));
  const coal = b.laid('coalB', 'coal2', 'coal.f1', 'coal');
  const skips = b.report.skipped.length;
  const spots = meetings(ore, coal, MEETINGS);
  for (const at of ore.length && coal.length ? spots : []) {
    b.affordAll(['electric_smelter', 1], ['steel_mill', 1], ['press', 1], ['router', 3], b.spare);
    const cp = checkpoint(sim);
    if (steelAt(b, at, ore, coal)) {
      b.report.skipped.length = skips;
      b.wire('steelPlates', 'steel', 'pipes');
      return;
    }
    rollback(sim, cp);
    for (const r of STEEL_ROLES) { delete b.ids[r]; delete b.lines[r]; }
    for (const r of ['steelPlates.out', 'steelPlates.in0', 'steel.in0', 'steel.in1', 'steel.out', 'pipes.in0', 'pipes.out', 'steelSilo.in0', 'pipesSilo.in0']) delete b.lines[r];
  }
  b.report.skipped.length = skips;
  b.skip('steel');
}

/**
 * The steel line round `at`, in one order or the other (the smelter on its iron first, the mill
 * then laying both its feeds; or the mill on its coal first, the smelter then feeding it): whether
 * all of it stands. A failed order is taken back up before the next. No piece looks far (`Builder.fed`'s
 * wider search): each stays near the meeting or the piece before it — a smelter feeding a mill from
 * 20 tiles off is no steel line, and on the lands where it does not fit those wide searches, a line
 * in and a line out at each of 160 spots, were a second of the late build. The first piece's went
 * with D143: an extra the level can do without (`far` false, as `Builder.fed` asks of one), it found
 * nothing on lands 1–3 and cost the late build 0.4 s on lands 1 and 2.
 */
function steelAt(b: Builder, at: readonly [number, number], ore: BeltTiles[], coal: BeltTiles[]): boolean {
  const sim = b.sim;
  const orders: Array<() => boolean> = [
    () => !!b.fed('steelPlates', 'electric_smelter', at, [{ lines: ore }], null, undefined, false)
      && !!b.fed('steel', 'steel_mill', b.centre('steelPlates'), [b.ids.steelPlates!, { lines: coal }], null, undefined, false),
    () => !!b.fed('steel', 'steel_mill', at, [{ lines: coal }], null, undefined, false)
      && !!b.fed('steelPlates', 'electric_smelter', b.centre('steel'), [{ lines: ore }], b.ids.steel!, 'steelPlates.out', false),
  ];
  for (const lay2 of orders) {
    const cp = checkpoint(sim);
    const a1 = lay2(), a2 = a1 && steelOn(b);
    if (a2) return true;
    rollback(sim, cp);
    for (const r of STEEL_ROLES) delete b.ids[r];
  }
  return false;
}

/**
 * The mill's steel into the Core, the press off it, its pipes back onto the steel's line past its
 * router (or into the Core). Where no line reaches the Core nor a trade post, each into a silo of its
 * own beside it (a stockpile: a thousand steel is over five game days of the mill's).
 */
function steelOn(b: Builder): boolean {
  const sim = b.sim;
  b.recipe('steelPlates', 'arc_plate');
  // Its one recipe since D151 (recycled steel gone: waste has no use), so it starts on it (D83); set
  // anyway, as the base was laid when it had two.
  b.recipe('steel', 'steel');
  const out = intoCore(b, b.ids.steel!) ?? (b.fed('steelSilo', 'silo', b.centre('steel'), [b.ids.steel!], null) ? b.lines['steelSilo.in0'] ?? null : null);
  if (!out) return false;
  b.lines['steel.out'] = out;
  if (!b.fed('pipes', 'press', b.centre('steel'), [{ lines: [out] }], null)) return false;
  b.recipe('pipes', 'pipe');
  // The mill's slag rides the steel's line (D125): the router's side toward the press takes steel only.
  filterFeed(sim, b.ids.pipes!, 'steel');
  // Past the router that feeds the press, the steel's line runs on: into the Core, the pipes join it
  // there (not into a silo: a silo holds one kind).
  const k = b.ids.steelSilo ? -1 : out.findIndex(([x, y]) => { const o = sim.entityAt(x, y); return !!o && BUILDING_KIND[o.def] === 'fork'; });
  const pipes = (k >= 0 && k + 1 < out.length ? join(sim, b.ids.pipes!, out.slice(k + 1)) : null) ?? intoCore(b, b.ids.pipes!)
    ?? (b.fed('pipesSilo', 'silo', b.centre('pipes'), [b.ids.pipes!], null) ? b.lines['pipesSilo.in0'] ?? null : null);
  if (!pipes) return false;
  b.lines['pipes.out'] = pipes;
  // The Core takes no waste in (D139): on the steel's line there the mill's slag is sorted off before
  // the pipes join it (a sorter set to the steel past that point would send the pipes aside too),
  // and the press's scrap off the pipes' own line.
  if (!b.ids.steelSilo) {
    const [jx, jy, jr] = pipes[pipes.length - 1]!;
    const j = out.findIndex(([x, y]) => x === jx + DX[jr]! && y === jy + DY[jr]!);
    b.affordAll(['sorter', 1], ['incinerator', 1]);
    if (!sortWaste(sim, j > 0 ? out.slice(0, j) : out, 'steel')) return false;
  }
  if (!b.ids.pipesSilo) {
    b.affordAll(['sorter', 1], ['incinerator', 1]);
    if (!sortWaste(sim, pipes, 'pipe')) return false;
  }
  // A silo holds one kind: the mill's slag or the press's scrap would stop at its door (D125).
  for (const [silo, keep] of [['steelSilo', 'steel'], ['pipesSilo', 'pipe']] as const) {
    const l = b.ids[silo] ? b.lines[`${silo}.in0`] : undefined;
    if (!l) continue;
    b.affordAll(['sorter', 1], ['incinerator', 1]);
    if (!sortWaste(sim, l, keep)) return false;
  }
  return true;
}

/** Spots tried for the steel line. */
const MEETINGS = 3;

/**
 * Where an iron line and a coal line pass closest (the midpoint of each such pair of tiles, the
 * nearest pairs first, the spots at least `STEEL_BLOCK` apart): both the line's branches stay short.
 */
function meetings(ore: readonly BeltTiles[], coal: readonly BeltTiles[], n: number): Array<[number, number]> {
  const pairs: Array<[number, number, number]> = [];
  for (const l of ore) for (const [ox, oy] of l) for (const m of coal) for (const [cx, cy] of m) pairs.push([(ox - cx) ** 2 + (oy - cy) ** 2, (ox + cx) >> 1, (oy + cy) >> 1]);
  pairs.sort((p, q) => p[0] - q[0] || p[2] - q[2] || p[1] - q[1]);
  const out: Array<[number, number]> = [];
  for (const [, x, y] of pairs) {
    if (out.length >= n) break;
    if (out.every(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) >= STEEL_BLOCK)) out.push([x, y]);
  }
  return out;
}

/** Lines joined at most when a building's goods cannot go straight into the Core. */
const JOIN_TRIES = 6;

/**
 * A ribbon from building `id`'s output into the Core: straight into one of its intakes where one
 * can be reached, else joining from the side a laid line that runs into the Core with nothing on
 * the way to turn its goods aside (no router, sorter or gate on it: the Core takes anything), the
 * nearest first; the late base's Core is ringed by lines by then. Where none can be joined, a line
 * into a trade post the same way: the Crier buys what the Core cannot take (D64: an entrance sells
 * whatever comes in). Null: nothing laid.
 */
export function intoCore(b: Builder, id: number): BeltTiles | null {
  const sim = b.sim, e = sim.ents.get(id);
  if (!e) return null;
  const direct = lay(sim, id, b.H);
  if (direct) return direct;
  const near = (l: BeltTiles): number => Math.min(...l.map(([x, y]) => (x - e.x) ** 2 + (y - e.y) ** 2));
  const posts = new Set(sim.tradePosts().map((p) => p.id));
  for (const into of [new Set([b.H]), posts]) {
    const lines = Object.values(b.lines).filter((l) => l.length && endsIn(b, l, into) && straightOn(b, l)).sort((p, q) => near(p) - near(q));
    for (const l of lines.slice(0, JOIN_TRIES)) {
      const j = join(sim, id, l);
      if (j) return j;
    }
  }
  return null;
}

/** Does a laid line's last tile hand on into one of these buildings? */
function endsIn(b: Builder, l: BeltTiles, into: ReadonlySet<number>): boolean {
  const [x, y, r] = l[l.length - 1]!;
  return into.has(b.sim.grid.occ[tileIndex(x + DX[r]!, y + DY[r]!)]!);
}

/** Is every tile of a laid line still a plain run of ribbon (no routing block laid on it since)? */
function straightOn(b: Builder, l: BeltTiles): boolean {
  const sim = b.sim;
  return l.every(([x, y]) => { const o = sim.entityAt(x, y); return !!o && LINE_KINDS.has(BUILDING_KIND[o.def]!); });
}
const LINE_KINDS: ReadonlySet<string> = new Set(['belt', 'bridge', 'crossing']);

/** The steel line's spots stand at least this far apart (tiles): its machines and their lines. */
const STEEL_BLOCK = 7;

/** The way into an input port: its front tile, and the way a line there must point. */
const into = (p: WorldPort): Map<number, Rot> => new Map([[tileIndex(p.fx, p.fy), opposite(p.dir)]]);

/**
 * A pump at the water, the brickworks by it fed by a conduit and a sand collector, its bricks into
 * the Core; whole, or reported `bricks`. Early in the late base's build: by its end the water's
 * shores are taken and a conduit crosses no line.
 */
export function brickWorks(b: Builder): void {
  const sim = b.sim;
  b.affordAll(['brickworks', 1], ['pump', 1], ['conduit', 40], ['sand_collector', 1], b.spare);
  const skips = b.report.skipped.length, budget = { works: WORKS_BUDGET };
  for (const [px, py] of waterSpots(sim).slice(0, WATER_TRIES)) {
    if (budget.works <= 0) break;
    const cp = checkpoint(sim);
    if (bricksAt(b, px, py, budget)) {
      b.report.skipped.length = skips;
      b.wire('bricks', 'bricksPump', 'bricksSand');
      return;
    }
    rollback(sim, cp);
    for (const r of BRICK_ROLES) { delete b.ids[r]; delete b.lines[r]; }
  }
  b.report.skipped.length = skips;
  b.skip('bricks');
}

/** A pump on (px, py), its outlet on free ground of its level, and the brickworks it waters: whether all of it stands. */
function bricksAt(b: Builder, px: number, py: number, budget: { works: number }): boolean {
  const sim = b.sim, lv = sim.grid.level(px, py), pumpDef = buildingIdx('pump');
  for (const rot of [0, 1, 2, 3] as const) {
    const out = worldPorts({ def: pumpDef, x: px, y: py, rot })[0]!;
    if (!inWorld(out.fx, out.fy) || sim.grid.occ[tileIndex(out.fx, out.fy)] !== 0 || sim.grid.level(out.fx, out.fy) !== lv) continue;
    const c = sim.canPlace('pump', px, py, rot);
    if (!c.ok || c.replaces.length) continue;
    const pump = sim.place('pump', px, py, rot);
    if (!pump.ok) continue;
    if (worksBy(b, out, [px, py], budget)) { b.ids.bricksPump = pump.id!; return true; }
    sim.remove(px, py);
  }
  return false;
}

/**
 * The brickworks toward the Core from the water: its water down a conduit from the pump's outlet
 * `out` into its water intake (its second), its bricks by ribbon into the Core, its sand from a
 * collector on the bare ground beside it into its first intake.
 */
function worksBy(b: Builder, out: WorldPort, water: readonly [number, number], budget: { works: number }): boolean {
  const sim = b.sim;
  const spots = [toward(water, b.heart, -PAST), toward(water, b.heart, TOWARD)].flatMap((near) => spotsNear(sim, 'brickworks', near, { r: 6, toward: water }).slice(0, WORKS_TRIES));
  for (const [x, y, rot] of spots) {
    if (budget.works-- <= 0) return false;
    const cp = checkpoint(sim);
    const w = sim.place('brickworks', x, y, rot);
    if (!w.ok) continue;
    sim.setRecipe(w.id!, 'brick'); // its one recipe again since D151 (slag bricks gone), set anyway (D83 starts it on it)
    const ins = worldPorts(sim.ents.get(w.id!)!).filter((p) => p.io === 'in');
    const pipe = routeLevel(sim, [out.fx, out.fy], into(ins[1]!), CONDUIT_SEARCH, true);
    if (pipe && sim.placeBelts('conduit', pipe) === pipe.length) {
      const home = intoCore(b, w.id!);
      const sand = home && placeFeeding(sim, 'sand_collector', [x, y], w.id!, { r: 10, tries: 20 });
      if (home && sand) {
        b.ids.bricks = w.id!;
        b.ids.bricksSand = sand.id;
        b.lines.bricks = home;
        b.lines.bricksSand = sand.line;
        return true;
      }
    }
    rollback(sim, cp);
  }
  return false;
}
