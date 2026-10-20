// build.ts — placing and removing structures. The placement rules, in order: unlock, world
// edge, occupancy, terrain (a chasm or a river refused by name, D94), deposit / water / vent needs, the claim's land (docs/land.md:
// production on its parcels; a neighbouring base's land only with Neighbour Treaties or for the camouflaged ribbon, D109–D110; its buildings never), the step a line piece faces (D77: only
// a traction ribbon changes level, one terrace at a time), a junction's deck ends (D158: only a ribbon
// or a skybridge end at either end of its deck, which runs along its rotation's axis; its tunnel's
// sides take anything), cost. An occupied tile is no refusal
// when what stands there may be replaced (Mindustry-style): same replace group, wholly inside the
// new footprint, not the very same building. It comes down first, fully refunded, so its refund
// counts towards the new cost. Off the claim's land a kite flies the materials out: the building
// completes after a delay growing with the distance. Removal refunds everything (cost, buffers,
// modules) to the Hearth. Ribbon drags are planned as a whole in belt-plan.ts
// (`planBelts`, D73). Also: the Hearth's levels.
import { BAL } from '@/content/balance';
import { BUILDING_FLAT, BUILDING_KIND, CRECIPES, N_ITEMS, buildingDef, buildingIdx, costOf, itemIdx, recipesFor } from '@/content/registry';
import { filterOf, recipeOf, withFilter } from '../cfg';
import { footprint, forTiles, worldPorts } from '../entities';
import { faceRot, faceTiles, isFaceOre } from '../face';
import { refundNode } from '../graph/compile';
import { refundCost } from '../refund';
import { inWorld, tileIndex } from '../world/grid';
import { parcelAt } from '../world/land';
import { CENTER } from '../constants';
import { maxPosts } from '../trade';
import { DX, DY, isFloor, isRock, isWater, opposite, T, type Ent, type Rot } from '../types';
import type { Sim } from '../state';

export type PlaceReason =
  | 'ok' | 'outside_world' | 'occupied' | 'terrain' | 'needs_deposit' | 'needs_water' | 'needs_vent'
  | 'outside_zone' | 'neighbour_land' | 'locked' | 'unaffordable' | 'not_buildable' | 'limit' | 'reserve' | 'needs_sand' | 'uneven'
  /** A traction step next to another one: an elevator needs one flat ribbon tile in front of it. */
  | 'lift_room'
  /** A plain ribbon facing another level (a wall, or the edge of a drop): only a traction ribbon changes level (D77). */
  | 'needs_lift'
  /** A traction ribbon facing two levels or more: its elevator climbs one terrace at a time (D77). */
  | 'steep'
  /** A conduit facing a step up, or a drop of two levels or more: water never climbs, and pours down one terrace at a time (D77, D114). */
  | 'cliff'
  /**
   * Something other than a line piece at either end of a junction's deck, or a junction whose deck
   * would come down onto one (D158): only a ribbon or a skybridge end stands there.
   */
  | 'junction_deck'
  /** A face cutter whose back meets no face ore: it stands at the foot of a quartz wall, its back to the rock (D87). */
  | 'needs_face'
  /** A chasm or a river under the footprint (D94): nothing stands there nor fills it; a skybridge pair leaps it (a ribbon drag plans one). */
  | 'chasm' | 'river'
  /** A skybridge's span would cross a tall building, or a tall building would stand under a bridge's span: the bridge is low, so in the isometric view it cuts through it (D124). */
  | 'bridge_over_tall'
  /** A wind turbine closer to another than `BAL.wind.spacing` tiles, middle to middle: each stands in its own wind (D132). */
  | 'wind_spacing'
  /** A pressure gauge off a conduit: it is set into a conduit line, onto one of its tiles (D155). */
  | 'needs_conduit';

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
    if (o) for (const c of refundCost(sim, o)) if (c.item === item) mu += c.mu;
  }
  return mu;
}

/**
 * Does turning this building change anything? Its ports move, a line runs another way, a
 * directional routing block (the router among them) faces elsewhere, a long footprint swings
 * round, a junction's deck runs along the other axis (D158). Distributors and masts work (and are
 * drawn) the same in every rotation: re-placing one turned would change nothing.
 */
export function turns(def: number): boolean {
  const b = buildingDef(def);
  if (b.ports.length > 0 || b.w !== b.h) return true;
  if (b.kind === 'belt' || b.kind === 'conduit' || b.kind === 'bridge' || b.kind === 'crossing') return true;
  const logic = b.logic ?? 'router';
  return b.kind === 'fork' && logic !== 'distributor';
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
  // A junction turned half round is the same junction: its deck runs along the same axis (D158).
  const same = o.rot === rot || !turns(def) || (BUILDING_KIND[def] === 'crossing' && ((o.rot ^ rot) & 1) === 0);
  return !(o.def === def && o.x === x && o.y === y && same);
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
  else if (b.kind === 'drill' && (b.drill?.ground ? !bare : !deposit)) return fail(b.drill?.ground ? 'needs_sand' : 'needs_deposit');
  if (b.kind === 'pump' && !water && !touchesWater(sim, x, y, w, h, level)) return fail('needs_water');
  if (b.kind === 'geothermal' && !vent) return fail('needs_vent');
  // A pressure gauge (D155) is set into a conduit line: onto a conduit's tile, which it takes the place of.
  if (b.gauge) {
    const o = replaces.length === 1 ? sim.ents.get(replaces[0]!) : undefined;
    if (!o || BUILDING_KIND[o.def] !== 'conduit' || buildingDef(o.def).gauge) return fail('needs_conduit');
  }
  // On the mountains, the whole footprint or none of it (no building astride a cliff, D44).
  if (rock && rock !== w * h) return fail('terrain');
  // The claim's land (docs/land.md): a building that needs it stands wholly on held parcels;
  // infrastructure may cross other land, by kite and at the remote cost — a neighbouring base's only
  // with Neighbour Treaties (D110: between its buildings, never on them, above), or for the
  // camouflaged ribbon (D109): buried, it runs there too, at its own cost anywhere.
  const inZone = sim.land.coversFootprint(def, x, y, rot);
  if (b.needsZone && !inZone) return fail('outside_zone');
  if (!inZone && onNeighbourLand(sim, def, x, y, rot)) {
    if (!b.camo && !sim.mods.flags.has('neighbourCrossing')) return fail('neighbour_land');
    // Where the treaties (or the buried ribbon) let it in: between the base's buildings, never on
    // them (D110). Asked only here, so a base is laid out only when something may go on its land.
    if (onNeighbourBase(sim, def, x, y, rot)) return fail('occupied');
  }
  let cost = costOf(def);
  if (isBelt && !inZone) {
    const mult = b.camo ? BAL.camoRemoteCostMult : Math.floor((BAL.remoteBeltCostMult * sim.mods.remoteBeltCost) / 1000) || 1;
    if (mult !== 1) cost = cost.map((c) => ({ item: c.item, mu: c.mu * mult }));
  }
  if (b.kind === 'trade' && [...sim.ents.map.values()].filter((o) => BUILDING_KIND[o.def] === 'trade').length >= maxPosts(sim.mods)) return fail('limit');
  const step = stepRefusal(sim, def, x, y, rot);
  if (step) return fail(step);
  if (b.lift && liftCrowded(sim, def, x, y, rot)) return fail('lift_room');
  if (deckBlocks(sim, def, x, y, rot).length) return fail('junction_deck');
  if (b.kind === 'wind' && windNear(sim, x, y, w, h, replaces)) return fail('wind_spacing');
  if (bridgeOverTall(sim, def, x, y, rot, w, h)) return fail('bridge_over_tall');
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
 * none up, and one down: water pours over a terrace's edge (D114). Read against the tile right ahead, as the compile reads it. A skybridge is not checked:
 * it leaps to the next one on its level, whatever lies between. A ribbon whose back is to a cliff
 * stays allowed: it is fed from its sides.
 */
export function stepRefusal(sim: Sim, def: number, x: number, y: number, rot: Rot): PlaceReason | null {
  const b = buildingDef(def);
  if (b.kind !== 'belt' && b.kind !== 'conduit') return null;
  const gx = x + DX[rot]!, gy = y + DY[rot]!;
  if (!inWorld(gx, gy)) return null;
  const down = sim.grid.level(x, y) - sim.grid.level(gx, gy), dl = Math.abs(down);
  if (dl === 0) return null;
  // Water runs down (D114): a conduit pours over the edge of one terrace into the tile below, and never climbs.
  if (b.kind === 'conduit') return down === 1 ? null : 'cliff';
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

/** Does a tall building (D124) stand on tile (x, y)? */
export function tallAt(sim: Sim, x: number, y: number): boolean {
  if (!inWorld(x, y)) return false;
  const o = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!);
  return !!o && !BUILDING_FLAT[o.def];
}

/** The skybridge of way `d` on (x, y)'s level nearest it `dir`-ward (1 ahead, −1 behind) within reach, as the distance in tiles (0: none). */
function bridgeNear(sim: Sim, x: number, y: number, d: Rot, dir: number): number {
  const span = 4 + sim.mods.bridgeSpan, lv = sim.grid.level(x, y);
  for (let k = 1; k <= span; k++) {
    const bx = x + DX[d]! * k * dir, by = y + DY[d]! * k * dir;
    if (!inWorld(bx, by)) return 0;
    const o = sim.ents.get(sim.grid.occ[tileIndex(bx, by)]!);
    if (o && BUILDING_KIND[o.def] === 'bridge' && o.rot === d && sim.grid.level(bx, by) === lv) return k;
  }
  return 0;
}

/** Would a bridge of way `d` on (x, y) be the far end of the pair behind it (D160: ends pair in order along their line, compile.ts)? */
function farEnd(sim: Sim, x: number, y: number, d: Rot): boolean {
  const k = bridgeNear(sim, x, y, d, -1);
  return k > 0 && !farEnd(sim, x - DX[d]! * k, y - DY[d]! * k, d);
}

/**
 * The far end a bridge at (x, y) facing `d` leaps to (compile.ts: ends go in pairs, in order along
 * their line, D160 — a start leaps to the nearest end ahead within `4 + mods.bridgeSpan`), as the
 * distance in tiles, or 0 when there is none (it is a far end itself, or alone).
 */
function partnerAhead(sim: Sim, x: number, y: number, d: Rot): number {
  return farEnd(sim, x, y, d) ? 0 : bridgeNear(sim, x, y, d, 1);
}

/**
 * Height rule (owner, 2026-10-17, D124: « empêcher de placer un bridge par-dessus une machine, à
 * moins que cette machine soit vraiment plate »): a skybridge pair never leaps a tall building,
 * and a tall building never goes under a pair's span. A bridge placed at (x, y) pairs with the
 * bridge ahead of it and with the one behind it, so both spans are read; a tall footprint is
 * refused when any of its tiles lies strictly between two paired bridges, on any of the four ways.
 * Placements only: a pair standing over a machine from before the rule stays (saves are sacred).
 */
function bridgeOverTall(sim: Sim, def: number, x: number, y: number, rot: Rot, w: number, h: number): boolean {
  if (BUILDING_KIND[def] === 'bridge') {
    const span = 4 + sim.mods.bridgeSpan, lv = sim.grid.level(x, y);
    const k = partnerAhead(sim, x, y, rot);
    for (let i = 1; i < k; i++) if (tallAt(sim, x + DX[rot]! * i, y + DY[rot]! * i)) return true;
    for (let back = 1; back <= span; back++) {
      const bx = x - DX[rot]! * back, by = y - DY[rot]! * back;
      if (!inWorld(bx, by)) break;
      const o = sim.ents.get(sim.grid.occ[tileIndex(bx, by)]!);
      if (!o || BUILDING_KIND[o.def] !== 'bridge' || o.rot !== rot || sim.grid.level(bx, by) !== lv) continue;
      // The nearest one behind pairs with this bridge when it is a start (D160), not a pair's far end.
      if (!farEnd(sim, bx, by, rot)) for (let i = 1; i < back; i++) if (tallAt(sim, bx + DX[rot]! * i, by + DY[rot]! * i)) return true;
      break;
    }
    return false;
  }
  if (BUILDING_FLAT[def]) return false;
  const span = 4 + sim.mods.bridgeSpan;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      for (let d = 0; d < 4; d++) {
        for (let back = 1; back <= span; back++) {
          const bx = tx - DX[d]! * back, by = ty - DY[d]! * back;
          if (!inWorld(bx, by)) break;
          const o = sim.ents.get(sim.grid.occ[tileIndex(bx, by)]!);
          if (!o || BUILDING_KIND[o.def] !== 'bridge' || o.rot !== d) continue;
          const k = partnerAhead(sim, bx, by, d);
          if (k > back) return true; // its partner lies beyond the tile: the tile is under the leap
        }
      }
    }
  }
  return false;
}

/**
 * The sides a junction's deck comes down on (D158): along its rotation's axis — north and south for
 * rot 0 and 2 (the look every junction had before, and the one a save from then keeps, persist/
 * migrate.ts `junctionsUpright`), east and west for rot 1 and 3. The line along that axis rides over
 * the hump; the other runs under it, through the tunnel.
 */
export const deckSides = (rot: Rot): readonly [Rot, Rot] => ((rot & 1) === 0 ? [0, 2] : [1, 3]);

/** Does a line running way `d` ride over the deck of a junction turned `rot` (else it runs under it, D158)? */
export const overDeck = (rot: Rot, d: Rot): boolean => ((rot ^ d) & 1) === 0;

/**
 * May a building of `def` stand at a junction's deck end (D158)? A line piece the deck can come down
 * onto: a ribbon of any tier (a traction ribbon, a buried one) or a skybridge end.
 */
export function deckEndOk(def: number): boolean {
  const k = BUILDING_KIND[def];
  return k === 'belt' || k === 'bridge';
}

/**
 * The junction deck ends a placement of `def` at (x, y, rot) would break (owner, 2026-10-19, D158:
 * « the junction should prevent putting something other than a ribbon on the two sides where the
 * junction brings the items, but not on the other two sides. You can have items going below
 * multiple junctions in a row »), as [junction x, y, deck end x, y]: a junction with something else
 * at either end of its deck (`deckSides`: a building, a routing block, a conduit, a mast, another
 * junction), or such a thing at a junction's deck end. Its tunnel's sides take anything, another
 * junction too: a line runs under a row of them (D73's « no chained junctions » holds now only
 * along the deck). Read against the grid as it stands: the drag planner checks its
 * own planned junctions (belt-plan.ts). What stands there from before the rule stays and works as
 * it did: asked for a junction already standing (its own def and tile), it lists what its deck ends
 * hold that the rule would refuse now, and its inspector shows it (ui/inspector/junction.ts).
 */
export function deckBlocks(sim: Sim, def: number, x: number, y: number, rot: Rot): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const at = (tx: number, ty: number): Ent | undefined => (inWorld(tx, ty) ? sim.ents.get(sim.grid.occ[tileIndex(tx, ty)]!) : undefined);
  if (BUILDING_KIND[def] === 'crossing') {
    for (const d of deckSides(rot)) {
      const ex = x + DX[d]!, ey = y + DY[d]!, o = at(ex, ey);
      if (o && !deckEndOk(o.def)) out.push([x, y, ex, ey]);
    }
  } else if (deckEndOk(def)) return out;
  // Round the footprint: a junction whose deck runs at it — one just north or south of it turned
  // north–south, one just east or west of it turned east–west — has an end on it (a junction too).
  const [w, h] = footprint(def, rot);
  const meets = (jx: number, jy: number, ex: number, ey: number, ns: boolean): void => {
    const o = at(jx, jy);
    if (o && BUILDING_KIND[o.def] === 'crossing' && ((o.rot & 1) === 0) === ns) out.push([jx, jy, ex, ey]);
  };
  for (let tx = x; tx < x + w; tx++) { meets(tx, y - 1, tx, y, true); meets(tx, y + h, tx, y + h - 1, true); }
  for (let ty = y; ty < y + h; ty++) { meets(x - 1, ty, x, ty, false); meets(x + w, ty, x + w - 1, ty, false); }
  return out;
}

/**
 * Does another wind turbine stand closer than `BAL.wind.spacing` tiles, middle to middle, to a
 * turbine's footprint at (x, y) (D132; owner, 2026-10-18: « on ne devrait pas pouvoir placer autant
 * d'éoliennes aussi proches les unes des autres »)? Those it replaces (a pitch-control turbine laid
 * over a wind turbine) do not count. Read off the occupancy round it (no scan of every building);
 * doubled coordinates keep the middles of even footprints whole.
 */
function windNear(sim: Sim, x: number, y: number, w: number, h: number, replaces: readonly number[]): boolean {
  const S = BAL.wind.spacing, cx = 2 * x + w, cy = 2 * y + h;
  const seen = new Set<number>();
  for (let ty = y - S; ty < y + h + S; ty++) {
    for (let tx = x - S; tx < x + w + S; tx++) {
      if (!inWorld(tx, ty)) continue;
      const id = sim.grid.occ[tileIndex(tx, ty)]!;
      if (!id || seen.has(id) || replaces.includes(id)) continue;
      seen.add(id);
      const o = sim.ents.get(id);
      if (!o || buildingDef(o.def).kind !== 'wind') continue;
      const [ow, oh] = footprint(o.def, o.rot), dx = 2 * o.x + ow - cx, dy = 2 * o.y + oh - cy;
      if (dx * dx + dy * dy < 4 * S * S) return true;
    }
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

/** Does a neighbouring base's building, ribbon or flag stand on any footprint tile (D110)? */
function onNeighbourBase(sim: Sim, def: number, x: number, y: number, rot: Rot): boolean {
  const [w, h] = footprint(def, rot);
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (sim.neighbours.at(tx, ty)) return true;
  return false;
}

/** Does any footprint tile lie on a neighbouring base's parcel (D110: one the claim does not hold)? */
function onNeighbourLand(sim: Sim, def: number, x: number, y: number, rot: Rot): boolean {
  const [w, h] = footprint(def, rot);
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    if (sim.land.neighbour(parcelAt(tx, ty)) >= 0) return true;
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
    // Sorters: their chosen item (byte 0); routers and distributors: a filter per side.
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
 * wall it is dropped against (D87, `faceRot`). A junction whose deck would come down on something
 * else than a ribbon turns its deck to the other axis when that one fits (D158), unless turned.
 * Anything else keeps the rotation asked for. The ghost shows the same.
 */
export function placementRot(sim: Sim, defId: string, x: number, y: number, rot: Rot, turned = false): Rot {
  const def = buildingIdx(defId), b = buildingDef(def);
  if (b.drill?.face) return inWorld(x, y) ? faceRot(sim.grid, def, x, y, rot) : rot;
  // A junction (D158): its deck along the axis in hand, or the other when only that one comes down
  // on ribbons — unless the player turned it (R), then it is theirs.
  if (b.kind === 'crossing') {
    if (turned || !inWorld(x, y) || !deckBlocks(sim, def, x, y, rot).length) return rot;
    const other = ((rot + 1) & 3) as Rot;
    return deckBlocks(sim, def, x, y, other).length ? rot : other;
  }
  // A pressure gauge (D155) runs as the conduit it is set into, whatever the turn in hand.
  if (b.gauge) {
    const e = inWorld(x, y) ? sim.entityAt(x, y) : undefined;
    return e && BUILDING_KIND[e.def] === 'conduit' ? e.rot : rot;
  }
  if (turned || b.kind !== 'fork' || b.w !== 1 || b.h !== 1) return rot;
  const logic = b.logic ?? 'router';
  if (logic === 'distributor') return rot;
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
    return logic === 'distributor' || r !== opposite(o.rot);
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
  const e = sim.ents.add({ def, x, y, rot, cfg, builtAt: chk.delay > 0 ? sim.tick + chk.delay : 0 });
  occupy(sim, e);
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
 * dropped, modules, node buffers and store refunded, then its full construction cost. `silent`: no structure event
 * (a building being replaced: the placement pushes it).
 */
export function removeEntity(sim: Sim, id: number, silent: boolean): void {
  const e = sim.ents.get(id);
  if (!e) return;
  for (const p of sim.projects.filter((q) => q.lab === id)) sim.cancelResearch(p.id);
  sim.jobs = sim.jobs.filter((j) => j.ent !== id);
  // A trade post's cargo and orders go with it (goods in flight land in the Hearth).
  sim.trade.cargo.delete(id);
  sim.trade.orders = sim.trade.orders.filter((o) => o.post !== id);
  sim.trade.activity.delete(id);
  sim.jobsDirty = true;
  const node = sim.graph?.nodeByEnt.get(id);
  if (node) refundNode(node, (item, mu) => sim.refund(item, mu));
  const st = sim.stores.get(id);
  if (st) { for (let i = 0; i < N_ITEMS; i++) if (st[i]! > 0) sim.refund(i, st[i]!); sim.stores.delete(id); }
  // A trade post's entrance, what it brought to sell (D131): to the Heart too.
  const sell = sim.selling.get(id);
  if (sell) { for (let i = 0; i < N_ITEMS; i++) if (sell[i]! > 0) sim.refund(i, sell[i]!); sim.selling.delete(id); }
  sim.accEnergy.delete(id);
  // Full refund of the construction cost: what it was paid (its price before D123 if it stood then).
  for (const c of refundCost(sim, e)) sim.refund(c.item, c.mu);
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
