// build.ts — placing and removing structures. The placement rules, in order: unlock, world
// edge, fog, occupancy, terrain (a chasm or a river refused by name, D94), deposit / water / vent needs, the claim's land (docs/land.md:
// production on its parcels, nothing on a sister claim's), the step a line piece faces (D77: only
// a traction ribbon changes level, one terrace at a time), cost. An occupied tile is no refusal
// when what stands there may be replaced (Mindustry-style): same replace group, wholly inside the
// new footprint, not the very same building. It comes down first, fully refunded, so its refund
// counts towards the new cost. Off the claim's land a kite flies the materials out: the building
// completes after a delay growing with the distance. Removal refunds everything (cost, buffers,
// modules, drifters) to the Hearth. Ribbon drags are planned as a whole in belt-plan.ts
// (`planBelts`, D73). Also: the Hearth's levels.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, CRECIPES, N_ITEMS, buildingDef, buildingIdx, costOf, itemIdx, recipesFor } from '@/content/registry';
import { filterOf, recipeOf, withFilter } from '../cfg';
import { footprint, forTiles, worldPorts } from '../entities';
import { faceRot, faceTiles, isFaceOre } from '../face';
import { refundNode } from '../graph/compile';
import { inWorld, tileIndex } from '../world/grid';
import { parcelAt } from '../world/land';
import { CENTER } from '../constants';
import { maxPosts } from '../trade';
import { DX, DY, isFloor, isRock, isWater, opposite, T, type Ent, type Rot } from '../types';
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
  | 'cliff'
  /** A junction next to another junction: a ribbon must run on each side of one (D73). */
  | 'junction_chain'
  /** A face cutter whose back meets no face ore: it stands at the foot of a quartz wall, its back to the rock (D87). */
  | 'needs_face'
  /** A chasm or a river under the footprint (D94): nothing stands there nor fills it; a skybridge pair leaps it (a ribbon drag plans one). */
  | 'chasm' | 'river';

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
        else return fail(t === T.Chasm ? 'chasm' : t === T.River ? 'river' : 'terrain');
      }
      if (t !== T.Vent) vent = false;
      const ore = sim.grid.ore(tx, ty);
      if (ore >= 0 && !isFaceOre(ore)) deposit = true; // a face ore is a wall's, never a drill's (D87)
      if (t !== T.Sand || ore >= 0) bare = false;
    }
  }
  // A drill wants a deposit; a ground collector bare sand under every tile (sand is the floor); a
  // face cutter a face ore in the wall behind it (D87: on the floor beside the wall, never on it).
  if (b.drill?.face) { if (!faceTiles(sim.grid, def, x, y, rot).length) return fail('needs_face'); }
  else if (b.kind === 'drill' && !b.drill?.anywhere && (b.drill?.ground ? !bare : !deposit)) return fail(b.drill?.ground ? 'needs_sand' : 'needs_deposit');
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
  if (b.kind === 'crossing' && junctionNear(sim, x, y)) return fail('junction_chain');
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
export function stepRefusal(sim: Sim, def: number, x: number, y: number, rot: Rot): PlaceReason | null {
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
export function stepAt(sim: Sim, def: number, x: number, y: number, rot: Rot): boolean {
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
 * Does a junction stand on a tile beside (x, y)? Junctions never chain (owner, 2026-10-15, D73:
 * « on ne devrait pas pouvoir mettre plusieurs jonctions à la chaîne, il faut un tapis de chaque
 * côté du pont »): a ribbon runs between two of them, or a bridge leaps both lines. Old chains
 * laid before the rule stay as they are.
 */
function junctionNear(sim: Sim, x: number, y: number): boolean {
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d]!, ny = y + DY[d]!;
    if (!inWorld(nx, ny)) continue;
    const o = sim.ents.get(sim.grid.occ[tileIndex(nx, ny)]!);
    if (o && BUILDING_KIND[o.def] === 'crossing') return true;
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
 * or crafted `place` must not smuggle in a locked recipe; the old speed-module bits never survive, D81).
 */
function validCfg(sim: Sim, def: number, cfg: number): number {
  const k = BUILDING_KIND[def];
  if (k === 'machine') {
    const r = recipeOf(cfg);
    const cr = r > 0 ? CRECIPES[r - 1] : undefined;
    return cr && cr.machines.has(def) && sim.unlocked(cr.unlock) ? r : 0; // the recipe alone: no module bits (D81)
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
 * The recipe a machine starts on (`index + 1`; 0 = none): its only recipe unlocked now, so a
 * one-recipe machine works as soon as it is fed and wired (D83, owner, 2026-10-15). A machine with
 * two or more to choose from (the smelter: plates or glass) waits for the player's pick.
 */
export function loneRecipe(sim: Sim, def: number): number {
  if (BUILDING_KIND[def] !== 'machine') return 0;
  let r = 0;
  for (const cr of recipesFor(def)) {
    if (!sim.unlocked(cr.unlock)) continue;
    if (r) return 0;
    r = cr.idx + 1;
  }
  return r;
}

/**
 * The rotation a placement really takes: a one-tile directional routing block (router, sorters,
 * gates) dropped onto a ribbon takes the way the items *enter* that tile (`entryRot`, D98): its
 * back to what feeds it, its front and sides then covering the ribbon's way out — straight on a
 * straight run, sideways on a curve (owner, 2026-10-16: on a curve the ribbon's own way, the way
 * out, turned the block's back away from its feed). `turned`: the player turned the block in hand
 * (R), and their rotation wins over the ribbon's (D98). A face cutter turns its back to the quartz
 * wall it is dropped against (D87, `faceRot`). Anything else keeps the rotation asked for. The
 * ghost shows the same.
 */
export function placementRot(sim: Sim, defId: string, x: number, y: number, rot: Rot, turned = false): Rot {
  const def = buildingIdx(defId), b = buildingDef(def);
  if (b.drill?.face) return inWorld(x, y) ? faceRot(sim.grid, def, x, y, rot) : rot;
  if (turned || b.kind !== 'fork' || b.w !== 1 || b.h !== 1) return rot;
  const logic = b.logic ?? 'router';
  if (logic === 'distributor' || logic === 'unloader') return rot;
  const e = sim.entityAt(x, y);
  return e && BUILDING_KIND[e.def] === 'belt' ? entryRot(sim, e) : rot;
}

/**
 * The way items travel as they enter ribbon `rb`'s tile, read as the flow compiler links it
 * (`compileGraph`, `routingPorts`): from the neighbour that feeds it — a ribbon pointing into the
 * tile (seen past junctions; a traction ribbon may climb in from one level off; a bridge that leaps
 * over the tile feeds nothing), a building's outlet facing it, or a routing block that may hand on
 * that way. Fed straight from behind, the ribbon's own way; else from a side (the first clockwise
 * from the back when both sides feed it: a block takes in at its back only, so one of two side
 * feeds must stay out); fed by nothing (a line's first tile), the ribbon's own way too. Planned
 * pieces (a kite still flying them out) count: it is the layout the player drew.
 */
export function entryRot(sim: Sim, rb: Ent): Rot {
  const d = rb.rot;
  for (const r of [d, (d + 1) & 3, (d + 3) & 3] as Rot[]) if (feedsFrom(sim, rb.x, rb.y, r)) return r;
  return d;
}

/** Does something on the side of (x, y) behind travel direction `r` hand items into it, moving `r`? */
function feedsFrom(sim: Sim, x: number, y: number, r: Rot): boolean {
  const s = opposite(r);
  let nx = x + DX[s]!, ny = y + DY[s]!;
  // A junction passes items straight across: what feeds through it stands past it.
  while (inWorld(nx, ny) && BUILDING_KIND[sim.entityAt(nx, ny)?.def ?? -1] === 'crossing') { nx += DX[s]!; ny += DY[s]!; }
  const o = inWorld(nx, ny) ? sim.entityAt(nx, ny) : undefined;
  if (!o) return false;
  const k = BUILDING_KIND[o.def], dl = Math.abs(sim.grid.level(nx, ny) - sim.grid.level(x, y));
  if (k === 'belt' || k === 'bridge') {
    if (o.rot !== r || dl > (buildingDef(o.def).lift ? 1 : 0)) return false;
    return k !== 'bridge' || !leapsFrom(sim, o, nx, ny);
  }
  if (dl !== 0) return false;
  if (k === 'fork') {
    const logic = buildingDef(o.def).logic ?? 'router';
    return logic === 'distributor' || logic === 'unloader' || r !== opposite(o.rot);
  }
  return worldPorts(o).some((p) => p.io === 'out' && p.dir === r && p.x === nx && p.y === ny);
}

/** A bridge at (x, y) that leaps to a bridge ahead within its span (`compileGraph`'s rule) hands nothing to the tile in front of it. */
function leapsFrom(sim: Sim, o: Ent, x: number, y: number): boolean {
  const span = 4 + sim.mods.bridgeSpan, lv = sim.grid.level(x, y);
  for (let k = 1; k <= span; k++) {
    const bx = x + DX[o.rot]! * k, by = y + DY[o.rot]! * k;
    if (!inWorld(bx, by)) return false;
    const b = sim.entityAt(bx, by);
    if (b && BUILDING_KIND[b.def] === 'bridge' && b.rot === o.rot && sim.grid.level(bx, by) === lv) return true;
  }
  return false;
}

/**
 * Place a building, replacing what `canPlace` says it replaces. `cfg0`: its settings; when
 * omitted, a building re-placed over the same building (a sorter turned) keeps that one's
 * settings (D24), and a new machine starts on its lone recipe (`loneRecipe`, D83). The settings
 * actually kept are logged, so a replay needs no such inference. `turned`: the player turned it in
 * hand (R), so a routing block keeps their rotation over a ribbon (D98); logged where it changed
 * the rotation, so a replay keeps it too.
 */
export function place(sim: Sim, defId: string, x: number, y: number, rot0: Rot, cfg0?: number, turned = false): PlaceCheck & { id?: number } {
  const auto = placementRot(sim, defId, x, y, rot0);
  const rot = turned ? placementRot(sim, defId, x, y, rot0, true) : auto;
  const chk = canPlace(sim, defId, x, y, rot);
  if (!chk.ok) return chk;
  const def = buildingIdx(defId);
  const prev = chk.replaces.length === 1 ? sim.ents.get(chk.replaces[0]!) : undefined;
  const cfg = validCfg(sim, def, cfg0 ?? (prev && prev.def === def ? prev.cfg : loneRecipe(sim, def)));
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
  // The player's turn is logged only where it overrode the ribbon's way: elsewhere the logged
  // rotation alone places it the same again.
  sim.log.push({ tick: sim.tick, cmd: rot !== auto ? { k: 'place', def: defId, x, y, rot, cfg, turned: true } : { k: 'place', def: defId, x, y, rot, cfg } });
  sim.dirty = true;
  sim.events.push({ k: 'structure' });
  return { ...chk, id: e.id };
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
