// scenario-plans.ts — drawn plans for the scripted debug bases (scenarios.ts): a factory drawn
// once as ASCII, laid as a whole where it fits, turned as the ground allows. The D61 lesson:
// machines placed one by one next to each other box each other's lines in, on a crowded cirque
// and even on open ground; a plan drawn and checked once (every port fed, every line ending in a
// building) works wherever it fits. Pure engine code (no DOM, no clock, integers only), and every
// change goes through the Sim's commands, so a laid plan is logged like a player's build.
//
// A plan is rows of characters, row 0 at the top; every building is drawn facing down the plan
// (inputs up, outputs down: rot 2) unless its key turns it. Characters:
//   ' '          nothing (anything may stand there)
//   '.'          kept free while the plan is laid (a routing block's side that must deal into nothing)
//   ^ > v <      a ribbon going that way
//   ↑ → ↓ ←      a ribbon of the sell line (kept as the plan's `ret`: others join it)
//   +            a junction
//   a key letter a building of the key (every cell of a multi-tile one bears its letter; one
//                letter, one building) or a one-tile part (each cell its own: routers, gates…)
// A directional routing block takes the rotation its feeder gives it: its back faces the arrow
// pointing into it (through junctions) or the building whose output faces it. An optional mask
// (same shape) puts cells in groups; a variant drops some groups whole (`drop`), the cells listed
// in `swaps` turning into other characters instead (a junction left with one line, a ribbon). The
// cells listed in `swift` are laid as swift ribbons. A key part `mark` is a tile kept free whose
// place is reported (`Laid.marks`): where a line from outside comes in.
import { buildingDef, buildingIdx } from '@/content/registry';
import { checkpoint, rollback, type BeltTiles } from './dev';
import { rotatePoint, worldPorts } from './entities';
import type { Sim } from './state';
import { DX, DY, isFloor, opposite, T, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';

/** One building or block of a plan's key. */
export interface PlanPart {
  /** Its role in the report's ids (`b.ids`); one-tile parts without one are not kept. */
  readonly role?: string;
  /** A building id, or 'mark': a tile kept free whose place (and the way `dir` into the plan) is reported. */
  readonly def: string;
  readonly recipe?: string;
  /** A sorter's or an inverted sorter's item. */
  readonly filter?: string;
  /** Quarter turns clockwise from facing down the plan (default 0). */
  readonly turn?: Rot;
  /** A mark's way into the plan (plan directions, 0 up … 3 left). */
  readonly dir?: Rot;
}

export interface PlanSpec {
  readonly rows: readonly string[];
  readonly key: Readonly<Record<string, PlanPart>>;
  /** Groups by cell (blank: always laid). */
  readonly mask?: readonly string[];
  /** Ribbon cells laid as swift ribbons (column, row): a line carrying more than a plain ribbon's 60 a minute. */
  readonly swift?: ReadonlyArray<readonly [number, number]>;
  /** Cells that change, rather than go, when a group is dropped: group → [column, row, character]. */
  readonly swaps?: Readonly<Record<string, ReadonlyArray<readonly [number, number, string]>>>;
}

/** A plan turned `q` quarter turns clockwise, a variant's groups dropped: its cells and size. */
export interface Plan {
  readonly spec: PlanSpec;
  readonly w: number;
  readonly h: number;
  readonly q: Rot;
  readonly cells: ReadonlyArray<readonly [number, number, string]>;
  /** The swift ribbon cells, turned with the plan. */
  readonly swift: ReadonlySet<string>;
}

const ARROW: Readonly<Record<string, Rot>> = { '^': 0, '>': 1, 'v': 2, '<': 3 };
const RETURN: Readonly<Record<string, Rot>> = { '↑': 0, '→': 1, '↓': 2, '←': 3 };
/** Directional routing blocks: their rotation comes from their feeder. */
const DIRECTIONAL = new Set(['router', 'sorter', 'inverted_sorter', 'overflow_gate', 'underflow_gate']);

export function planOf(spec: PlanSpec, q: Rot, drop: ReadonlySet<string> = new Set()): Plan {
  // Arrows like '↑' are one code point but count as one character: rows are read as code points.
  const rows = spec.rows, H = rows.length, W = Math.max(...rows.map((r) => [...r].length));
  const cells: Array<readonly [number, number, string]> = [];
  const swap = new Map<number, string>();
  for (const g of drop) for (const [i, j, c] of spec.swaps?.[g] ?? []) swap.set(j * W + i, c);
  for (let j = 0; j < H; j++) {
    const row = [...rows[j]!];
    for (let i = 0; i < row.length; i++) {
      const c = swap.get(j * W + i) ?? row[i]!, g = [...(spec.mask?.[j] ?? '')][i] ?? ' ';
      if (c !== ' ' && (g === ' ' || !drop.has(g))) cells.push([...rotatePoint(i, j, W, H, q), c] as const);
    }
  }
  const swift = new Set((spec.swift ?? []).map(([i, j]) => rotatePoint(i, j, W, H, q).join(',')));
  return { spec, w: q & 1 ? H : W, h: q & 1 ? W : H, q, cells, swift };
}

/** Is a part a building of more than one tile (one letter, one building)? */
const multi = (p: PlanPart): boolean => p.def !== 'mark' && buildingDef(buildingIdx(p.def)).w * buildingDef(buildingIdx(p.def)).h > 1;

/** Every tile of a plan laid at (ax, ay): free, level floor that `land` accepts; bare sand under a sand collector. */
export function planFits(sim: Sim, plan: Plan, ax: number, ay: number, land: (x: number, y: number) => boolean): boolean {
  if (!inWorld(ax, ay)) return false;
  const level = sim.grid.level(ax, ay);
  for (const [i, j, c] of plan.cells) {
    const x = ax + i, y = ay + j;
    if (!inWorld(x, y) || sim.grid.occ[tileIndex(x, y)] !== 0) return false;
    const t = sim.grid.terrain(x, y);
    if (!isFloor(t) || sim.grid.level(x, y) !== level || !land(x, y)) return false;
    const p = plan.spec.key[c];
    if (p && p.def === 'sand_collector' && (t !== T.Sand || sim.grid.ore(x, y) >= 0)) return false;
  }
  return true;
}

/** Where a plan fits (any of its four turns) round a point, within `r`: nearest first, at most `max` spots. */
export function planSpots(sim: Sim, spec: PlanSpec, at: readonly [number, number], r: number, land: (x: number, y: number) => boolean, drop: ReadonlySet<string> = new Set(), max = 6): Array<[Plan, number, number]> {
  const plans = ([0, 1, 2, 3] as const).map((q) => planOf(spec, q, drop));
  const offs: Array<[number, number, number]> = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) offs.push([dx, dy, dx * dx + dy * dy]);
  offs.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  const out: Array<[Plan, number, number]> = [];
  for (const [dx, dy] of offs) {
    for (const plan of plans) {
      const ax = at[0] + dx - (plan.w >> 1), ay = at[1] + dy - (plan.h >> 1);
      if (planFits(sim, plan, ax, ay, land)) { out.push([plan, ax, ay]); if (out.length >= max) return out; }
    }
  }
  return out;
}

/** What laying a plan gave: the buildings by role, the sell line's tiles, the marks (tile and the way in). */
export interface Laid {
  ids: Record<string, number>;
  ret: BeltTiles;
  marks: Record<string, [number, number, Rot]>;
  tiles: Array<[number, number]>;
}

/**
 * Lay a plan at (ax, ay): its buildings, then its routing blocks and junctions, then its ribbons;
 * recipes and filters set. `afford(def, n)` grants what the Heart lacks first. Null (and nothing
 * left of it) if any placement fails.
 */
export function layPlan(sim: Sim, plan: Plan, ax: number, ay: number, afford: (def: string, n: number) => void): Laid | null {
  const cp = checkpoint(sim);
  const key = plan.spec.key, q = plan.q;
  const builds = new Map<string, [number, number]>();
  const blocks: Array<[string, number, number]> = [];
  const belts: BeltTiles = [], ret: BeltTiles = [];
  const marks: Record<string, [number, number, Rot]> = {};
  const arrowAt = new Map<number, Rot>(), junction = new Set<number>();
  const fast: BeltTiles = [];
  for (const [i, j, c] of plan.cells) {
    const x = ax + i, y = ay + j, t = tileIndex(x, y);
    const p = key[c];
    if (p?.def === 'mark') { if (p.role) marks[p.role] = [x, y, (((p.dir ?? 2) + q) & 3) as Rot]; continue; }
    if (p && multi(p)) { const m = builds.get(c); builds.set(c, m ? [Math.min(m[0], x), Math.min(m[1], y)] : [x, y]); continue; }
    if (p || c === '+') { blocks.push([c, x, y]); if (c === '+') junction.add(t); continue; }
    const a = ARROW[c] ?? RETURN[c];
    if (a === undefined) continue; // '.': kept free
    const d = ((a + q) & 3) as Rot;
    arrowAt.set(t, d);
    (plan.swift.has(`${i},${j}`) ? fast : RETURN[c] !== undefined ? ret : belts).push([x, y, d]);
  }
  const ids: Record<string, number> = {};
  const fail = (): null => { rollback(sim, cp); return null; };
  for (const [c, [x, y]] of builds) {
    const p = key[c]!, rot = ((2 + (p.turn ?? 0) + q) & 3) as Rot;
    afford(p.def, 1);
    const r = sim.place(p.def, x, y, rot);
    if (!r.ok) return fail();
    if (p.role) ids[p.role] = r.id!;
  }
  // A directional block's back: the arrow pointing into it (seen through junctions), else the
  // building whose output port faces it.
  const backOf = (x: number, y: number): Rot | null => {
    for (let d = 0 as Rot; d < 4; d = (d + 1) as Rot) {
      let nx = x + DX[d]!, ny = y + DY[d]!;
      while (junction.has(tileIndex(nx, ny))) { nx += DX[d]!; ny += DY[d]!; }
      if (arrowAt.get(tileIndex(nx, ny)) === opposite(d)) return d;
      const e = sim.entityAt(x + DX[d]!, y + DY[d]!);
      if (e && worldPorts(e).some((p) => p.io === 'out' && p.fx === x && p.fy === y)) return d;
    }
    return null;
  };
  const filters: Array<[number, string]> = [];
  for (const [c, x, y] of blocks) {
    const p = c === '+' ? { def: 'crossing' } as PlanPart : key[c]!;
    let rot = 0 as Rot;
    if (DIRECTIONAL.has(p.def)) { const back = backOf(x, y); rot = back === null ? (((2 + q) & 3) as Rot) : opposite(back); }
    afford(p.def, 1);
    const r = sim.place(p.def, x, y, rot);
    if (!r.ok) return fail();
    if (p.role) ids[p.role] = r.id!;
    if (p.filter) filters.push([r.id!, p.filter]);
  }
  afford('ribbon', belts.length + ret.length);
  for (const t of [...belts, ...ret]) if (sim.placeBelts('ribbon', [t]) !== 1) return fail();
  afford('swift_ribbon', fast.length);
  for (const t of fast) if (sim.placeBelts('swift_ribbon', [t]) !== 1) return fail();
  for (const [c, [x, y]] of builds) {
    const p = key[c]!;
    if (p.recipe && !sim.setRecipe(sim.grid.occ[tileIndex(x, y)]!, p.recipe)) return fail();
  }
  for (const [id, item] of filters) if (!sim.setForkFilter(id, 0, item)) return fail();
  return { ids, ret, marks, tiles: plan.cells.map(([i, j]) => [ax + i, ay + j] as [number, number]) };
}
