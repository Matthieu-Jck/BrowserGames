// build.ts — placing and removing structures. The placement rules, in order: unlock, world
// edge, fog, occupancy, terrain, deposit / water / vent needs, the claim's land (docs/land.md:
// production on its parcels, nothing on a sister claim's), the step a line piece faces (D77: only
// a traction ribbon changes level, one terrace at a time), cost. An occupied tile is no refusal
// when what stands there may be replaced (Mindustry-style): same replace group, wholly inside the
// new footprint, not the very same building. It comes down first, fully refunded, so its refund
// counts towards the new cost. Off the claim's land a kite flies the materials out: the building
// completes after a delay growing with the distance. Removal refunds everything (cost, buffers,
// modules, drifters) to the Hearth. Ribbon drags are planned tile by tile (`planBelts`: kept,
// laid, replaced, or a junction where the drag cuts straight across a ribbon line); the build
// tool's preview shows the same plan. Also: the Hearth's levels.
import { BAL } from '@/content/balance';
import { BUILDING_IDS, BUILDING_KIND, CRECIPES, N_ITEMS, buildingDef, buildingIdx, costOf, itemIdx } from '@/content/registry';
import { filterOf, modulesOf, recipeOf, withFilter } from '../cfg';
import { footprint, forTiles } from '../entities';
import { refundNode } from '../graph/compile';
import { inWorld, tileIndex } from '../world/grid';
import { parcelAt } from '../world/land';
import { CENTER } from '../constants';
import { maxPosts } from '../trade';
import { DX, DY, isFloor, isRock, isWater, T, type Ent, type Rot } from '../types';
import type { Sim } from '../state';

export type PlaceReason =
  | 'ok' | 'outside_world' | 'occupied' | 'terrain' | 'needs_deposit' | 'needs_water' | 'needs_vent'
  | 'outside_zone' | 'sister_land' | 'locked' | 'unaffordable' | 'not_buildable' | 'fog' | 'limit' | 'reserve' | 'needs_sand' | 'uneven'
  /** A traction step next to another one: an elevator needs one flat ribbon tile in front of it. */
  | 'lift_room'
  /** A plain ribbon facing another level (a wall, or the edge of a drop): only a traction ribbon changes level (D77). */
  | 'needs_lift'
  /** A traction ribbon facing two levels or more: its elevator climbs one terrace at a time (D77). */
  | 'steep'
  /** A conduit facing another level: fluids keep to their level (D77). */
  | 'cliff';

export type Cost = Array<{ item: number; mu: number }>;

export interface PlaceCheck {
  ok: boolean;
  reason: PlaceReason;
  cost: Cost;
  /** Ticks until a remote construction completes (0 = instant). */
  delay: number;
  /**
   * Entities the placement takes the place of (ids, ascending; empty when the tiles are free).
   * Also given when only the cost refuses it (`unaffordable`), so a preview can net their refund.
   */
  replaces: number[];
}

/** Mark an entity's tiles as occupied by it. */
export function occupy(sim: Sim, e: Ent): void {
  forTiles(e, (x, y) => { sim.grid.occ[tileIndex(x, y)] = e.id; });
}

function vacate(sim: Sim, e: Ent): void {
  forTiles(e, (x, y) => { if (sim.grid.occ[tileIndex(x, y)] === e.id) sim.grid.occ[tileIndex(x, y)] = 0; });
}

/** Lift the fog for good around a survey beacon. */
function reveal(sim: Sim, e: Ent): void {
  const b = buildingDef(e.def);
  const [w, h] = footprint(e.def, e.rot);
  const cx = e.x + Math.floor(w / 2), cy = e.y + Math.floor(h / 2);
  if (b.reveal) sim.explored.push([cx, cy, b.reveal]);
}

const pay = (sim: Sim, cost: Cost): void => { for (const c of cost) sim.stock[c.item] = sim.stock[c.item]! - c.mu; };

/**
 * Can the Hearth pay `cost`, counting what the `replaced` entities give back? Their base
 * construction cost, which `removeEntity` always refunds (on top of their buffers and stores).
 * `spent`: what earlier steps of a plan already take from the stock (net mu by item).
 */
export const affordable = (sim: Sim, cost: Cost, replaced: readonly number[] = [], spent?: ReadonlyMap<number, number>): boolean =>
  cost.every((c) => sim.stock[c.item]! - (spent?.get(c.item) ?? 0) + refundOf(sim, replaced, c.item) >= c.mu);

/** Milli-items of `item` that taking these entities down refunds through their construction cost. */
function refundOf(sim: Sim, ids: readonly number[], item: number): number {
  let mu = 0;
  for (const id of ids) {
    const o = sim.ents.get(id);
    if (o) for (const c of costOf(o.def)) if (c.item === item) mu += c.mu;
  }
  return mu;
}

/**
 * Does turning this building change anything? Its ports move, a line runs another way, a
 * directional routing block (the router among them) faces elsewhere, a long footprint swings
 * round. Distributors, unloaders, junctions and masts work (and are drawn) the same in every
 * rotation: re-placing one turned would change nothing.
 */
function turns(def: number): boolean {
  const b = buildingDef(def);
  if (b.ports.length > 0 || b.w !== b.h) return true;
  if (b.kind === 'belt' || b.kind === 'conduit' || b.kind === 'bridge') return true;
  const logic = b.logic ?? 'router';
  return b.kind === 'fork' && logic !== 'distributor' && logic !== 'unloader';
}

/**
 * May a new `def` at (x, y, rot) take the place of entity `o`? Only within one replace group
 * (content `replaceGroup`), only when `o` lies wholly inside the new footprint (never a part of
 * a bigger building), and never the very same building — same def and origin, and the same
 * rotation where turning it matters: there would be nothing to do.
 */
function replaceable(def: number, x: number, y: number, rot: Rot, o: Ent): boolean {
  const g = buildingDef(def).replaceGroup;
  if (g === undefined || buildingDef(o.def).replaceGroup !== g) return false;
  const [w, h] = footprint(def, rot), [ow, oh] = footprint(o.def, o.rot);
  if (o.x < x || o.y < y || o.x + ow > x + w || o.y + oh > y + h) return false;
  return !(o.def === def && o.x === x && o.y === y && (o.rot === rot || !turns(def)));
}

export function canPlace(sim: Sim, defId: string, x: number, y: number, rot: Rot): PlaceCheck {
  const def = buildingIdx(defId);
  const b = buildingDef(def);
  const fail = (reason: PlaceReason): PlaceCheck => ({ ok: false, reason, cost: [], delay: 0, replaces: [] });
  if (b.kind === 'hearth') return fail('not_buildable');
  if (!sim.unlocked(b.unlock)) return fail('locked');
  const [w, h] = footprint(def, rot);
  const isBelt = b.kind === 'belt' || b.kind === 'conduit';
  let deposit = false, water = false, vent = true, bare = true, rock = 0;
  const level = inWorld(x, y) ? sim.grid.level(x, y) : 0;
  const replaces: number[] = [];
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!inWorld(tx, ty)) return fail('outside_world');
      if (!sim.revealed(tx, ty)) return fail('fog');
      const occ = sim.grid.occ[tileIndex(tx, ty)]!;
      if (occ !== 0 && !replaces.includes(occ)) {
        // Something stands here: the placement goes ahead only if it may take its place.
        const o = sim.ents.get(occ);
        if (!o || !replaceable(def, x, y, rot, o)) return fail('occupied');
        replaces.push(occ);
      }
      const t = sim.grid.terrain(tx, ty);
      if (sim.grid.level(tx, ty) !== level) return fail('uneven'); // level ground only (D45)
      if (b.onRock && isRock(t)) rock++; // on the mountains (D44)
      else if (!isFloor(t)) {
        if (b.kind === 'pump' && t === T.Shallow) water = true;
        else return fail('terrain');
      }
      if (t !== T.Vent) vent = false;
      if (sim.grid.ore(tx, ty) >= 0) deposit = true;
      if (t !== T.Sand || sim.grid.ore(tx, ty) >= 0) bare = false;
    }
  }
  // A drill wants a deposit; a ground collector bare sand under every tile (sand is the floor).
  if (b.kind === 'drill' && !b.drill?.anywhere && (b.drill?.ground ? !bare : !deposit)) return fail(b.drill?.ground ? 'needs_sand' : 'needs_deposit');
  if (b.kind === 'pump' && !water && !touchesWater(sim, x, y, w, h, level)) return fail('needs_water');
  if (b.kind === 'geothermal' && !vent) return fail('needs_vent');
  // On the mountains, the whole footprint or none of it (no building astride a cliff, D44).
  if (rock && rock !== w * h) return fail('terrain');
  // The claim's land (docs/land.md): a building that needs it stands wholly on held parcels;
  // infrastructure may cross other land, by kite and at the remote cost — never a sister claim's.
  const inZone = sim.land.coversFootprint(def, x, y, rot);
  if (b.needsZone && !inZone) return fail('outside_zone');
  if (!inZone && !sim.mods.flags.has('sisterCrossing') && onSisterLand(sim, def, x, y, rot)) return fail('sister_land');
  let cost = costOf(def);
  if (isBelt && !inZone) {
    const mult = Math.floor((BAL.remoteBeltCostMult * sim.mods.remoteBeltCost) / 1000) || 1;
    cost = cost.map((c) => ({ item: c.item, mu: c.mu * mult }));
  }
  if (b.kind === 'trade' && [...sim.ents.map.values()].filter((o) => BUILDING_KIND[o.def] === 'trade').length >= maxPosts(sim.mods)) return fail('limit');
  const step = stepRefusal(sim, def, x, y, rot);
  if (step) return fail(step);
  if (b.lift && liftCrowded(sim, def, x, y, rot)) return fail('lift_room');
  replaces.sort((a, c) => a - c);
  // What it replaces is refunded before the new building is paid: it counts towards the cost.
  if (!affordable(sim, cost, replaces)) return { ok: false, reason: 'unaffordable', cost, delay: 0, replaces };
  // What a removal never gives back (the remote surcharge) must leave the
  // restart reserve whole (D36); the base cost comes back in full, so it never counts.
  const base = costOf(def);
  const extra = cost.map((c) => ({ item: c.item, mu: c.mu - (base.find((k) => k.item === c.item)?.mu ?? 0) })).filter((c) => c.mu > 0);
  if (extra.length && sim.reserveShort(extra).length) return { ok: false, reason: 'reserve', cost, delay: 0, replaces };
  return { ok: true, reason: 'ok', cost, delay: remoteDelay(sim, x, y, inZone), replaces };
}

/**
 * A line piece that would face a step it cannot take (owner, 2026-10-14: "we must make sure that
 * we block the user from doing something that makes no sense… some ribbons are half floating,
 * pointing to a wall, or coming from a cliff, and nothing blocks the user or tells him he needs
 * to put an elevator"). A ribbon hands on only to its own level (D45; compile.ts gives it no
 * target past a step), so one facing a wall or the edge of a drop is a dead end: refused, and the
 * reason names the traction ribbon. A traction ribbon takes one terrace, never two; a conduit
 * none. Read against the tile right ahead, as the compile reads it. A skybridge is not checked:
 * it leaps to the next one on its level, whatever lies between. A ribbon whose back is to a cliff
 * stays allowed: it is fed from its sides.
 */
function stepRefusal(sim: Sim, def: number, x: number, y: number, rot: Rot): PlaceReason | null {
  const b = buildingDef(def);
  if (b.kind !== 'belt' && b.kind !== 'conduit') return null;
  const gx = x + DX[rot]!, gy = y + DY[rot]!;
  if (!inWorld(gx, gy)) return null;
  const dl = Math.abs(sim.grid.level(gx, gy) - sim.grid.level(x, y));
  if (dl === 0) return null;
  if (b.kind === 'conduit') return 'cliff';
  if (!b.lift) return 'needs_lift';
  return dl > 1 ? 'steep' : null;
}

/**
 * Does a ribbon of `def` at (x, y) pointing `rot` change level into the tile ahead: a traction step
 * (D45), its elevator standing on the step's low tile?
 */
function stepAt(sim: Sim, def: number, x: number, y: number, rot: Rot): boolean {
  if (!buildingDef(def).lift) return false;
  const gx = x + DX[rot]!, gy = y + DY[rot]!;
  return inWorld(gx, gy) && sim.grid.level(gx, gy) !== sim.grid.level(x, y);
}

/**
 * A traction step laid right after or right before another on its line (owner, 2026-10-14: "when
 * there are two elevators in front of each other, there are visual bugs with the items and the
 * up/down logic… let's make the elevator two blocs in length: one for the elevator, and one for a
 * ribbon in front"): each step needs a flat tile on both sides, the ribbon ahead not stepping
 * again, and no ribbon that steps feeding into it. Old lines laid so stay as they are.
 */
function liftCrowded(sim: Sim, def: number, x: number, y: number, rot: Rot): boolean {
  if (!stepAt(sim, def, x, y, rot)) return false;
  const beltAt = (tx: number, ty: number): Ent | undefined => {
    if (!inWorld(tx, ty)) return undefined;
    const o = sim.ents.get(sim.grid.occ[tileIndex(tx, ty)]!);
    return o && BUILDING_KIND[o.def] === 'belt' && o.x === tx && o.y === ty ? o : undefined;
  };
  const ahead = beltAt(x + DX[rot]!, y + DY[rot]!);
  if (ahead && stepAt(sim, ahead.def, ahead.x, ahead.y, ahead.rot)) return true;
  for (let d = 0; d < 4; d++) {
    const n = beltAt(x + DX[d]!, y + DY[d]!);
    if (n && n.x + DX[n.rot]! === x && n.y + DY[n.rot]! === y && stepAt(sim, n.def, n.x, n.y, n.rot)) return true;
  }
  return false;
}

/**
 * Is there water on `level` round the footprint (its 8-neighbourhood)? A pump draws water at its own
 * level: the floor's from the floor, the Crown's tarn (D63) from the rock at the tarn's level round
 * it — not from a tarn one terrace up, nor from a lake below a cliff.
 */
function touchesWater(sim: Sim, x: number, y: number, w: number, h: number, level: number): boolean {
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) if (isWater(sim.grid.terrain(tx, ty)) && sim.grid.level(tx, ty) === level) return true;
  }
  return false;
}

/** Does any footprint tile lie on a sister claim's parcel (one the claim does not hold)? */
function onSisterLand(sim: Sim, def: number, x: number, y: number, rot: Rot): boolean {
  const [w, h] = footprint(def, rot);
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    const p = parcelAt(tx, ty);
    if (!sim.land.holds(p) && sim.land.sister(p) >= 0) return true;
  }
  return false;
}

/** Remote construction: kites carry the materials from the Hearth (ticks; 0 on the claim's land). */
function remoteDelay(sim: Sim, x: number, y: number, inZone: boolean): number {
  if (inZone) return 0;
  const d2 = (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER);
  let d = 0;
  while ((d + 1) * (d + 1) <= d2) d++;
  const ticks = Math.floor((d * 10) / BAL.remoteBuildTilesPerSec);
  return Math.floor((ticks * sim.mods.remoteBuildDelay) / 1000);
}

/**
 * Only the settings a player could have made through commands survive a placement (a replayed
 * or crafted `place` must not smuggle in a locked recipe or free speed modules).
 */
function validCfg(sim: Sim, def: number, cfg: number): number {
  const k = BUILDING_KIND[def];
  if (k === 'machine') {
    const r = recipeOf(cfg);
    const cr = r > 0 ? CRECIPES[r - 1] : undefined;
    return cr && cr.machines.has(def) && sim.unlocked(cr.unlock) ? r : 0; // bells are fitted later (setModule)
  }
  if (k === 'fork') {
    // Sorters and unloaders: their chosen item (byte 0); routers and distributors: a filter per side.
    const logic = buildingDef(def).logic ?? 'router';
    const sides = logic === 'router' || logic === 'distributor' ? 4 : 1;
    let out = 0;
    for (let side = 0; side < sides; side++) { const it = filterOf(cfg, side); if (it >= 0 && it < N_ITEMS) out = withFilter(out, side, it); }
    return out;
  }
  return 0;
}

/**
 * Place a building, replacing what `canPlace` says it replaces. `cfg0`: its settings; when
 * omitted, a building re-placed over the same building (a sorter turned) keeps that one's
 * settings. The settings actually kept are logged, so a replay needs no such inference.
 */
/**
 * The rotation a placement really takes: a one-tile directional routing block (router, sorters,
 * gates) dropped onto a ribbon follows it — its back takes in what the ribbon brings (owner,
 * 2026-10-12). Anything else keeps the rotation asked for. The ghost shows the same.
 */
export function placementRot(sim: Sim, defId: string, x: number, y: number, rot: Rot): Rot {
  const b = buildingDef(buildingIdx(defId));
  if (b.kind !== 'fork' || b.w !== 1 || b.h !== 1) return rot;
  const logic = b.logic ?? 'router';
  if (logic === 'distributor' || logic === 'unloader') return rot;
  const e = sim.entityAt(x, y);
  return e && BUILDING_KIND[e.def] === 'belt' ? e.rot : rot;
}

export function place(sim: Sim, defId: string, x: number, y: number, rot0: Rot, cfg0?: number): PlaceCheck & { id?: number } {
  const rot = placementRot(sim, defId, x, y, rot0);
  const chk = canPlace(sim, defId, x, y, rot);
  if (!chk.ok) return chk;
  const def = buildingIdx(defId);
  const prev = chk.replaces.length === 1 ? sim.ents.get(chk.replaces[0]!) : undefined;
  const cfg = validCfg(sim, def, cfg0 ?? (prev && prev.def === def ? prev.cfg : 0));
  // What it replaces comes down first (ascending ids), fully refunded: cost, buffers, modules,
  // store. Silently: the placement pushes the one structure event.
  for (const id of chk.replaces) removeEntity(sim, id, true);
  pay(sim, chk.cost);
  const b = buildingDef(def);
  let portItems: number[] | undefined;
  if (b.kind === 'dock') portItems = b.ports.map(() => -1); // a trade post's exit hands out what it bought (D62)
  const e = sim.ents.add({ def, x, y, rot, cfg, builtAt: chk.delay > 0 ? sim.tick + chk.delay : 0, portItems });
  occupy(sim, e);
  reveal(sim, e);
  if (b.kind === 'excavator' || b.kind === 'backfiller') sim.jobsDirty = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'place', def: defId, x, y, rot, cfg } });
  sim.dirty = true;
  sim.events.push({ k: 'structure' });
  return { ...chk, id: e.id };
}

/** One tile of a ribbon drag as planned: what goes there (or why nothing does), and its check. */
export interface BeltStep extends PlaceCheck {
  x: number;
  y: number;
  rot: Rot;
  /**
   * What stands on the tile once the drag is laid: the dragged ribbon, a junction where the
   * drag cuts across a ribbon line, or — on a skipped tile — what is already there.
   */
  def: string;
  /** Nothing to place: this very ribbon already runs here, or the line runs through a block. */
  skip: boolean;
}

export type BeltPath = ReadonlyArray<readonly [number, number, Rot]>;

/** The junction (the building of kind `crossing`), -1 if the content has none. */
const JUNCTION = BUILDING_KIND.indexOf('crossing');

/**
 * Plan a ribbon drag tile by tile against the grid as it stands — what `placeBelts` lays and
 * what the build tool's ghost shows:
 * - this very ribbon, same direction: skipped, nothing to do;
 * - a routing block, junction or bridge end of the ribbon's replace group, in a drag of two
 *   tiles or more: kept (skipped) — lines are routinely dragged through routers. A one-tile
 *   drag (a click) replaces it;
 * - a ribbon of any tier running across the drag, where the drag goes straight through (not
 *   an end, not a bend): a junction instead, so both lines keep flowing (Mindustry's
 *   auto-junction), when the junction is unlocked;
 * - anything else: the dragged ribbon, as `canPlace` allows (another tier or another direction
 *   is replaced: an upgrade, a turn).
 * The steps share one budget, in path order: a long drag runs out of materials (`unaffordable`)
 * exactly where laying it tile by tile would.
 */
export function planBelts(sim: Sim, defId: string, path: BeltPath): BeltStep[] {
  const def = buildingIdx(defId);
  const b = buildingDef(def);
  const out: BeltStep[] = [];
  const spent = new Map<number, number>(); // net mu by item, taken by the steps before
  for (let i = 0; i < path.length; i++) {
    const [x, y, rot] = path[i]!;
    const id = inWorld(x, y) ? sim.grid.occ[tileIndex(x, y)]! : 0;
    const o = id ? sim.ents.get(id) : undefined;
    let what = defId;
    if (o) {
      const k = BUILDING_KIND[o.def];
      const kept = o.def === def
        ? o.rot === rot
        : path.length > 1 && b.replaceGroup !== undefined && buildingDef(o.def).replaceGroup === b.replaceGroup && k !== 'belt' && k !== 'conduit';
      if (kept) {
        out.push({ x, y, rot, def: BUILDING_IDS[o.def]!, skip: true, ok: true, reason: 'ok', cost: [], delay: 0, replaces: [] });
        continue;
      }
      if (b.kind === 'belt' && k === 'belt' && ((o.rot - rot) & 1) === 1 && JUNCTION >= 0 && throughAt(path, i) && sim.unlocked(buildingDef(JUNCTION).unlock)) {
        what = BUILDING_IDS[JUNCTION]!;
      }
    }
    const step: BeltStep = { x, y, rot, def: what, skip: false, ...canPlace(sim, what, x, y, rot) };
    if (step.ok && !affordable(sim, step.cost, step.replaces, spent)) {
      step.ok = false;
      step.reason = 'unaffordable';
      step.delay = 0;
    } else if (step.ok) {
      for (const c of step.cost) spent.set(c.item, (spent.get(c.item) ?? 0) + c.mu);
      for (const r of step.replaces) for (const c of costOf(sim.ents.get(r)!.def)) spent.set(c.item, (spent.get(c.item) ?? 0) - c.mu);
    }
    out.push(step);
  }
  return out;
}

/** Does a drag run straight through path tile i: in line with the tiles before and after it? */
function throughAt(path: BeltPath, i: number): boolean {
  const prev = path[i - 1], next = path[i + 1];
  if (!prev || !next) return false; // an end of the drag
  const [x, y, r] = path[i]!;
  return prev[2] === r && prev[0] === x - DX[r]! && prev[1] === y - DY[r]! && next[0] === x + DX[r]! && next[1] === y + DY[r]!;
}

/**
 * Lay a ribbon drag (each element [x, y, rot]) as `planBelts` plans it: exactly the steps the
 * plan (and so the ghost) accepts. Every placement is its own logged `place` (a junction as a
 * junction), so a replay needs no planner. Returns how many were placed.
 */
export function placeBelts(sim: Sim, defId: string, path: BeltPath): number {
  let n = 0;
  for (const s of planBelts(sim, defId, path)) if (!s.skip && s.ok && place(sim, s.def, s.x, s.y, s.rot).ok) n++;
  return n;
}

/** Remove whatever occupies (x, y) (never the Hearth); refunds its cost and buffered items. */
export function remove(sim: Sim, x: number, y: number): boolean {
  if (!inWorld(x, y)) return false;
  const id = sim.grid.occ[tileIndex(x, y)]!;
  if (!id || id === sim.hearthId) return false;
  removeEntity(sim, id, false);
  sim.log.push({ tick: sim.tick, cmd: { k: 'remove', x, y } });
  return true;
}

/**
 * Take an entity down: its research project is cancelled (paid science refunded), its job
 * dropped, its drifters scrapped back into materials and its routes closed, modules, node
 * buffers and store refunded, then its full construction cost. `silent`: no structure event
 * (a building being replaced: the placement pushes it).
 */
export function removeEntity(sim: Sim, id: number, silent: boolean): void {
  const e = sim.ents.get(id);
  if (!e) return;
  for (const p of sim.projects.filter((q) => q.lab === id)) sim.cancelResearch(p.id);
  sim.jobs = sim.jobs.filter((j) => j.ent !== id);
  if (sim.fleet.has(id)) {
    for (let k = 0; k < sim.fleet.get(id)!; k++) for (const [it, n] of Object.entries(BAL.drifterCost)) sim.refund(itemIdx(it), n * 1000);
    sim.fleet.delete(id);
  }
  sim.routes = sim.routes.filter((r) => r.from !== id && r.to !== id);
  // A trade post's cargo and orders go with it (goods in flight land in the Hearth).
  sim.trade.cargo.delete(id);
  sim.trade.orders = sim.trade.orders.filter((o) => o.post !== id);
  sim.trade.activity.delete(id);
  if (BUILDING_KIND[e.def] === 'machine') for (let k = 0; k < modulesOf(e.cfg); k++) sim.refund(itemIdx('pace_bell'), 1000);
  sim.jobsDirty = true;
  const node = sim.graph?.nodeByEnt.get(id);
  if (node) refundNode(node, (item, mu) => sim.refund(item, mu));
  const st = sim.stores.get(id);
  if (st) { for (let i = 0; i < N_ITEMS; i++) if (st[i]! > 0) sim.refund(i, st[i]!); sim.stores.delete(id); }
  sim.accEnergy.delete(id);
  // Full refund of the construction cost.
  for (const c of costOf(e.def)) sim.refund(c.item, c.mu);
  vacate(sim, e);
  sim.ents.remove(id);
  sim.dirty = true;
  if (!silent) sim.events.push({ k: 'structure' });
}

/**
 * Remote constructions whose kite has arrived become buildings (start of each tick; the
 * catch-up calls it at their event). Returns the ids finished.
 */
export function completeConstructions(sim: Sim, now = sim.tick): number[] {
  const done: number[] = [];
  for (const e of sim.ents.map.values()) {
    if (e.builtAt !== 0 && e.builtAt <= now) { e.builtAt = 0; done.push(e.id); }
  }
  if (done.length) {
    sim.dirty = true;
    sim.jobsDirty = true; // a new excavator / backfiller may take work
    sim.events.push({ k: 'structure' });
  }
  return done;
}

/** Raise the Hearth a level (a bigger store: `BAL.hearthCap`). */
export function upgradeHearth(sim: Sim): { ok: boolean; reason: 'max' | 'locked' | 'unaffordable' | 'reserve' | null } {
  const up = BAL.hearthUpgrades[sim.hearthLevel - 1];
  if (!up) return { ok: false, reason: 'max' };
  if (!sim.unlocked(up.unlock)) return { ok: false, reason: 'locked' };
  const cost = up.cost.map(([it, n]) => ({ item: itemIdx(it), mu: n * 1000 }));
  if (!affordable(sim, cost)) return { ok: false, reason: 'unaffordable' };
  // A level is never refunded: it must leave the restart reserve whole (D36).
  if (sim.reserveShort(cost).length) return { ok: false, reason: 'reserve' };
  pay(sim, cost);
  sim.hearthLevel++;
  sim.log.push({ tick: sim.tick, cmd: { k: 'hearthUp' } });
  sim.dirty = true;
  sim.events.push({ k: 'structure' });
  return { ok: true, reason: null };
}
