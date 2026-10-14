// reserve.ts — CrierBelt's restart reserve (D36): a base can always rebuild its production.
//
// The Heart only takes (D34): materials enter it from production lines, quest rewards and the
// Crier, and a plan spends them for good (D33). Without a guard a new base could spend the very
// materials its production is made of — plates, glass, copper wire — on plans, and be left with
// no way to build a smelter line again and nothing that makes them: a dead end.
//
// The bootstrap (`BOOTSTRAP`) is what rebuilds production from the bare land, in stages built in
// order: the smelter line first (plates and glass), then the copper line (copper wire). Each stage
// is paid from the Heart's stock, except for what an earlier stage makes: the base can wait for
// that. The reserve (`reserveNeed`) is what the whole bootstrap costs from the stock: every
// stage's buildings and the plans it still needs, less the items an earlier stage makes.
//
// The engine keeps one invariant (src/sim/systems/reserve.ts): for every reserved item, the
// Heart's stock plus what taking every building down would refund covers the reserve. A plan
// that would break it is refused (`reserve`). Placing and removing never change that sum
// (removal refunds a building's cost in full), and production, rewards and deliveries only add
// to it. So a base can always take everything down and rebuild the bootstrap, stage by stage,
// and with plates, glass and wire flowing, everything else: every plan is paid in them.
//
// `reserveProblems()` (run by validate.ts) checks from content alone that the bootstrap is
// real. Each stage makes what it says with its own machines, on recipes that the start or plans
// unlock (never research), from the cirque's deposits under its own drills. Its materials are
// things it makes. Every plan and the starting kit are paid in those. The starting stock covers
// the reserve, even with the whole first ring of plans bought. A trade post's export streams
// cannot eat into it (what they leave in the Heart, plus the post's own cost). The poles are
// counted on the real cirque by src/sim/systems/reserve.test.ts, which also rebuilds a base from
// exactly the reserve and fuzzes the guard.
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { PLAN_IDS, PLANS, isPlan, planDef, treePrereq } from './research';
import { CIRQUE } from './world';
import type { BuildingDef, PlanDef, RecipeDef } from './types';

/** One stage of the bootstrap: what it makes, and the buildings it rebuilds. */
export interface BootStage {
  /** What its machines make: what later stages may wait for instead of keeping it in reserve. */
  readonly makes: readonly string[];
  /**
   * The buildings it rebuilds, and how many. Poles: what reaches the cirque's deposits beyond the
   * Heart's own wires (8 tiles), counted on the real cirque by reserve.test.ts.
   */
  readonly builds: ReadonlyArray<readonly [string, number]>;
}

/**
 * The bootstrap, in build order. 1: the smelter line, which makes plates, then glass (one smelter
 * switches recipe), from drills on iron and coal and a sand collector on the bare ground (sand is
 * the floor: it goes anywhere, by the Heart); a pole reaches the coal, another an iron drill set far.
 * 2: the copper line, which makes copper wire. Its plates and glass come from stage 1, so only
 * the copper wire of its poles is kept: nothing else makes copper wire.
 */
export const BOOTSTRAP: readonly BootStage[] = [
  { makes: ['iron_plate', 'glass'], builds: [['drill', 2], ['sand_collector', 1], ['kiln', 1], ['mast', 2]] },
  { makes: ['copper_wire'], builds: [['drill', 1], ['wire_mill', 1], ['mast', 2]] },
];

const has = (table: object, id: string): boolean => Object.prototype.hasOwnProperty.call(table, id);
const building = (id: string): BuildingDef | undefined => (has(BUILDINGS, id) ? (BUILDINGS as Record<string, BuildingDef>)[id] : undefined);
const plans = Object.entries(PLANS) as Array<[string, PlanDef]>;
const recipes = Object.entries(RECIPES) as Array<[string, RecipeDef]>;

/** The plans a set of buildings needs: their unlocks and every prerequisite (only plans are followed). */
function plansFor(ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  const add = (id: string): void => {
    if (!isPlan(id) || out.has(id)) return;
    out.add(id);
    for (const q of treePrereq(id)) add(q);
  };
  for (const id of ids) { const b = building(id); if (b) add(b.unlock); }
  return out;
}

/** The plans stage `s` needs that no earlier stage needs, in `PLAN_IDS` order. */
export function stagePlans(s: number): string[] {
  const before = plansFor(BOOTSTRAP.slice(0, s).flatMap((st) => st.builds.map(([id]) => id)));
  const mine = plansFor(BOOTSTRAP[s]?.builds.map(([id]) => id) ?? []);
  return PLAN_IDS.filter((id) => mine.has(id) && !before.has(id));
}

/** Every item the bootstrap makes: the base's essential materials, the ones it can always make again. */
export const ESSENTIAL: readonly string[] = [...new Set(BOOTSTRAP.flatMap((st) => st.makes))];

/** One share of the reserve: `n` of `item`, for a building of a stage (`plan` null: always kept) or for a plan (kept until it is done). */
export interface ReservePart { readonly item: string; readonly n: number; readonly plan: string | null }

/** The reserve, share by share, in stage order. */
export const RESERVE_PARTS: readonly ReservePart[] = (() => {
  const out: ReservePart[] = [];
  const made = new Set<string>();
  BOOTSTRAP.forEach((st, s) => {
    const keep = (item: string, n: number, plan: string | null): void => { if (!made.has(item) && n > 0) out.push({ item, n, plan }); };
    for (const [id, k] of st.builds) for (const [it, n] of building(id)?.cost ?? []) keep(it, n * k, null);
    for (const p of stagePlans(s)) for (const [it, n] of planDef(p)!.cost) keep(it, n, p);
    for (const it of st.makes) made.add(it);
  });
  return out;
})();

/** The reserve (whole items, in `ITEMS` order) once the plans `done` says are done: what the Heart and its buildings must cover. */
export function reserveNeed(done: (plan: string) => boolean): Array<[string, number]> {
  const need = new Map<string, number>();
  for (const p of RESERVE_PARTS) if (!p.plan || !done(p.plan)) need.set(p.item, (need.get(p.item) ?? 0) + p.n);
  return Object.keys(ITEMS).filter((it) => need.has(it)).map((it) => [it, need.get(it)!]);
}

/** The items the reserve keeps (at founding, nothing done), in `ITEMS` order. */
export const RESERVED: readonly string[] = reserveNeed(() => false).map(([it]) => it);

/** Problems with the bootstrap and the reserve (empty when it holds together); run by `validateContent`. */
export function reserveProblems(): string[] {
  const out: string[] = [];
  const ores = new Set(CIRQUE.deposits.map((d) => d.item));
  const made = new Set<string>();
  const opened = new Set<string>(); // plans of this stage and the earlier ones
  BOOTSTRAP.forEach((st, s) => {
    const where = `bootstrap stage ${s + 1}`;
    let drills = 0;
    const grounds = new Set<string>(); // what its collectors take off the bare ground
    for (const [id, n] of st.builds) {
      const b = building(id);
      if (!b) { out.push(`${where}: unknown building ${id}`); continue; }
      if (!(Number.isInteger(n) && n > 0)) out.push(`${where}: ${id} × ${n} must be a positive whole number`);
      if (b.unlock !== 'start' && !isPlan(b.unlock)) out.push(`${where}: ${id} is unlocked by ${b.unlock}, not by a plan (the bootstrap never waits on research)`);
      if (b.kind === 'drill') { if (b.drill?.ground) grounds.add(b.drill.ground); else drills += n; }
    }
    for (const p of stagePlans(s)) {
      opened.add(p);
      for (const q of treePrereq(p)) if (!isPlan(q)) out.push(`${where}: plan ${p} needs ${q}, which is not a plan`);
    }
    // What it makes: a recipe on one of its machines, unlocked from the start or by a plan it has,
    // whose inputs are the cirque's deposits (its drills mine them) or what its collectors take off
    // the ground (the Heart feeds no machine, D34).
    const deposits = new Set<string>();
    for (const it of st.makes) {
      if (!has(ITEMS, it)) { out.push(`${where}: unknown item ${it}`); continue; }
      const r = recipes.find(([, rc]) =>
        rc.outs.some(([o]) => o === it)
        && rc.machines.some((m) => st.builds.some(([id]) => id === m))
        && (rc.unlock === 'start' || opened.has(rc.unlock))
        && rc.ins.every(([i]) => ores.has(i) || grounds.has(i)));
      if (!r) { out.push(`${where}: none of its machines makes ${it} from the cirque's deposits or the ground its collectors take`); continue; }
      for (const [i] of r[1].ins) if (!grounds.has(i)) deposits.add(i);
    }
    if (deposits.size > drills) out.push(`${where}: ${deposits.size} deposits to mine (${[...deposits].join(', ')}) for ${drills} drills`);
    for (const it of st.makes) made.add(it);
  });
  // The reserve keeps only what the bootstrap makes (a base can grow it back), and every plan and
  // the starting kit are paid in those materials: with the bootstrap running, the tree stays open.
  for (const it of RESERVED) if (!made.has(it)) out.push(`the reserve keeps ${it}, which the bootstrap never makes`);
  for (const [id, p] of plans) for (const [it] of p.cost) if (!made.has(it)) out.push(`plan ${id}: costs ${it}, which the bootstrap does not make`);
  for (const [id, b] of Object.entries(BUILDINGS) as Array<[string, BuildingDef]>) {
    if (b.unlock === 'start') for (const [it] of b.cost) if (!made.has(it)) out.push(`starting kit ${id}: costs ${it}, which the bootstrap does not make`);
  }
  // A new base holds the reserve, and keeps it with the whole first ring of plans bought (no
  // refusal before the first smelter: those plans are the tree's first offer).
  const start = (it: string): number => BAL.startStock[it] ?? 0;
  for (const [it, n] of reserveNeed(() => false)) if (start(it) < n) out.push(`the starting stock holds ${start(it)} ${it}, the reserve ${n}`);
  const roots = plans.filter(([, p]) => p.prereq.length === 0).map(([id]) => id);
  const spent = new Map<string, number>();
  for (const id of roots) for (const [it, n] of planDef(id)!.cost) spent.set(it, (spent.get(it) ?? 0) + n);
  for (const [it, n] of reserveNeed((p) => roots.includes(p))) {
    const left = start(it) - (spent.get(it) ?? 0);
    if (left < n) out.push(`the first ring of plans leaves ${left} ${it}, the reserve ${n}`);
  }
  // Power: drills and the wire mill run on the Heart's steady core, even through the night.
  if (!(BAL.hearthCoreKw > 0)) out.push('the Heart needs a steady core (BAL.hearthCoreKw > 0): a bootstrap built at night must run');
  return out;
}
