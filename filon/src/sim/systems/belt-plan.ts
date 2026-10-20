// belt-plan.ts — a ribbon drag planned as a whole (D73; owner, 2026-10-15: « quand le joueur place
// des tapis, attends qu'il relève la souris avant de réellement les installer, mets un placeholder
// transparent en attendant. De cette manière, l'algo peut "réfléchir" à ce que le joueur veut : un
// pont si le tapis doit passer un obstacle, un ascenseur s'il y a une montée »). The build tool
// draws the plan as a transparent placeholder while the drag runs and lays it on release
// (`placeBelts`); every piece laid is its own logged `place`, so a replay needs no planner.
//
// The plan, against the grid as it stands:
// 1. What each tile wants: this very ribbon already there (kept); a routing block, junction or
//    bridge end of the ribbon's replace group, in a drag of two tiles or more (kept: lines are
//    routinely dragged through routers; a one-tile drag replaces it); a junction where the drag
//    runs straight across a ribbon line (Mindustry's auto-junction, D24); a traction ribbon where
//    a plain ribbon would face a step (D77), once traction is learnt — one already there is kept,
//    as it takes its line's pace whatever the tier dragged (D141); the dragged ribbon otherwise.
// 2. Each wish checked (`canPlace`), and what the grid cannot see yet because nothing is laid:
//    two planned traction steps in a row (D65: the later one is refused) and a planned junction at
//    another's deck end (D158: a junction's deck comes down only onto a ribbon). A junction's deck
//    runs along the line it crosses, so the drag passes under it — or along the drag, when only
//    that way the deck comes down on ribbons. Along their tunnels junctions chain: a drag across
//    lines side by side lays a row of them, and its items pass under each in turn.
// 3. Each run of obstacles — a building, water or other ground a ribbon cannot take, a chasm or a
//    river (D94), a neighbouring base's land (D110), junctions stacked along their decks or one whose
//    deck end holds something else (D158) — is leapt by a bridge pair (`skybridge`) on the plain
//    ribbon tiles just before and after it: when bridges are learnt, the run is straight, the
//    start is fed from straight behind (D55), the pair is within the bridges' reach on one level
//    and pairs with no other bridge of that direction on the line (D160: ends go in pairs, in order;
//    none between its ends, a pair's far end or none just behind its start — pairs chain). The tiles between
//    are left as they are. A run no pair can leap stays refused: the drag is laid in part.
// 3b. What is still refused for its land — a neighbouring base's parcel (`neighbour_land`) — is laid camouflaged
//    (D109: `camo_ribbon`, buried, the one ribbon that runs there), once learnt, when the dragged
//    piece is a flat ribbon and the camouflaged piece fits there (or only lacks materials: the ghost
//    then shows why). After the bridges, so a run a pair can leap keeps the line's pace; a plain
//    ribbon off the claim's free land costs nothing even at the remote rate, so it stays plain.
// 4. One budget in path order: a long drag runs out of materials (`unaffordable`) exactly where
//    laying it tile by tile would.
// Conduits get 1, 2 and 4 only: no junction, lift or bridge carries fluids; a pressure gauge (D155) the
// drag runs through along its way is kept, as a routing block is (a click with a conduit takes it out). A conduit drag that starts
// on a conduit and leaves it by its side keeps that tile as it is — the new line draws water off it
// there, a tee (D152, compile.ts `tees`) — and one that ends on a conduit's side keeps it too, the two
// waters joining; only on a conduit with a way on (one that ends there turns, as before). Fences (D103) are laid the
// same way, a fence on each free tile of the drag (one already there is kept, whatever its way).
import { BUILDING_IDS, BUILDING_KIND, buildingDef, buildingIdx } from '@/content/registry';
import { DX, DY, type Rot } from '../types';
import { inWorld, tileIndex } from '../world/grid';
import { parcelAt } from '../world/land';
import { refundCost } from '../refund';
import type { Sim } from '../state';
import { affordable, deckSides, canPlace, place, stepAt, stepRefusal, tallAt, type PlaceCheck, type PlaceReason } from './build';

/** One tile of a ribbon drag as planned: what goes there (or why nothing does), and its check. */
export interface BeltStep extends PlaceCheck {
  x: number;
  y: number;
  rot: Rot;
  /**
   * What stands on the tile once the drag is laid: the dragged ribbon, a junction, a traction
   * ribbon, a bridge end — or, on a skipped tile, what is already there ('' on open ground a
   * bridge leaps).
   */
  def: string;
  /** Nothing to place: this very ribbon already runs here, the line runs through a block, or a bridge leaps the tile. */
  skip: boolean;
  /** Leapt by one of the drag's bridge pairs (D73): left as it is. */
  leapt?: boolean;
  /** A conduit the drag starts on and leaves by its side (`split`: the new line draws off it) or ends on from its side (`join`), kept as it is (D152). */
  tee?: 'split' | 'join';
}

export type BeltPath = ReadonlyArray<readonly [number, number, Rot]>;

/** The pieces the plan lays besides the dragged ribbon (-1 when the content has none). */
const JUNCTION = BUILDING_KIND.indexOf('crossing');
const BRIDGE = BUILDING_KIND.indexOf('bridge');
const LIFT = BUILDING_IDS.findIndex((_, i) => BUILDING_KIND[i] === 'belt' && !!buildingDef(i).lift);
const CAMO = BUILDING_IDS.findIndex((_, i) => BUILDING_KIND[i] === 'belt' && !!buildingDef(i).camo);

/** Refusals a bridge pair can leap: what stands or lies on the tile — not a step, nor the purse. */
const LEAPABLE: ReadonlySet<PlaceReason> = new Set<PlaceReason>(['occupied', 'terrain', 'neighbour_land', 'junction_deck', 'chasm', 'river']);
// (`bridge_over_tall`, D124, is set by `leap` itself on the tiles it refuses: it is not leapable.)

const learnt = (sim: Sim, def: number): boolean => def >= 0 && sim.unlocked(buildingDef(def).unlock);

const kept = (x: number, y: number, rot: Rot, def: string): BeltStep => ({ x, y, rot, def, skip: true, ok: true, reason: 'ok', cost: [], delay: 0, replaces: [] });

function refuse(st: BeltStep, reason: PlaceReason): void {
  st.ok = false;
  st.reason = reason;
  st.delay = 0;
}

/** Plan a ribbon drag as a whole (above): what `placeBelts` lays and the build tool's ghost shows. */
export function planBelts(sim: Sim, defId: string, path: BeltPath): BeltStep[] {
  const def = buildingIdx(defId);
  const b = buildingDef(def);
  const items = b.kind === 'belt';
  const n = path.length;
  // 1–2. What each tile wants, checked against the grid.
  const out: BeltStep[] = path.map(([x, y, rot], i) => {
    const o = inWorld(x, y) ? sim.ents.get(sim.grid.occ[tileIndex(x, y)]!) : undefined;
    let what = def;
    if (o) {
      const k = BUILDING_KIND[o.def];
      const keep = o.def === def
        ? o.rot === rot || b.kind === 'fence' // a fence has no way: one already there is kept (D103)
        : n > 1 && b.replaceGroup !== undefined && buildingDef(o.def).replaceGroup === b.replaceGroup && ((k !== 'belt' && k !== 'conduit') || (!!buildingDef(o.def).gauge && o.rot === rot)); // a pressure gauge on the line (D155) stays
      if (keep) return kept(x, y, rot, BUILDING_IDS[o.def]!);
      // Off a pipe's side, or into it (D152): the pipe stays as it runs, a tee or a join.
      if (b.kind === 'conduit' && k === 'conduit' && n > 1 && (i === 0 || i === n - 1) && ((o.rot - rot) & 1) === 1 && goesOn(sim, x, y)) {
        return { ...kept(x, y, o.rot, BUILDING_IDS[o.def]!), tee: i === 0 ? 'split' : 'join' };
      }
      if (items && k === 'belt' && ((o.rot - rot) & 1) === 1 && learnt(sim, JUNCTION) && throughAt(path, i)) what = JUNCTION;
    }
    // A step (D77): the traction ribbon takes it, once learnt. One already there, the same way, is
    // kept: it takes the line's pace by itself (D141), so a faster ribbon dragged over a line leaves
    // its lifts as they stand (it was refused as `occupied`, a tile left out at each step).
    if (what === def && items && !b.lift && learnt(sim, LIFT) && stepRefusal(sim, def, x, y, rot) === 'needs_lift') {
      if (o && o.def === LIFT && o.rot === rot) return kept(x, y, rot, BUILDING_IDS[LIFT]!);
      what = LIFT;
    }
    const id = BUILDING_IDS[what]!;
    if (what === JUNCTION && o) {
      // Its deck along the crossed line, so the drag runs under it and a row of them across lines
      // side by side chains (D158); along the drag when only that way the deck comes down on ribbons.
      const under = canPlace(sim, id, x, y, o.rot);
      if (under.ok || under.reason !== 'junction_deck') return { x, y, rot: o.rot, def: id, skip: false, ...under };
      const over = canPlace(sim, id, x, y, rot);
      return over.ok || over.reason !== 'junction_deck' ? { x, y, rot, def: id, skip: false, ...over } : { x, y, rot: o.rot, def: id, skip: false, ...under };
    }
    return { x, y, rot, def: id, skip: false, ...canPlace(sim, id, x, y, rot) };
  });
  // Two planned traction steps in a row: an elevator wants a flat ribbon in front of it (D65).
  for (let i = 1; i < n; i++) {
    const a = out[i - 1]!, c = out[i]!;
    if (a.skip || c.skip || !a.ok || !c.ok) continue;
    const da = buildingIdx(a.def), dc = buildingIdx(c.def);
    if (buildingDef(da).lift && buildingDef(dc).lift && stepAt(sim, da, a.x, a.y, a.rot) && stepAt(sim, dc, c.x, c.y, c.rot)) refuse(c, 'lift_room');
  }
  // A planned junction at another's deck end (D158): that deck may not come down on it — an obstacle
  // for a bridge to leap. Along their tunnels they chain: a line runs under the row.
  const planned = new Set<number>();
  for (const st of out) if (isJunction(st) && inWorld(st.x, st.y)) planned.add(tileIndex(st.x, st.y));
  for (const st of out) {
    if (!isJunction(st) || !inWorld(st.x, st.y)) continue;
    if (deckSides(st.rot).some((d) => inWorld(st.x + DX[d]!, st.y + DY[d]!) && planned.has(tileIndex(st.x + DX[d]!, st.y + DY[d]!)))) refuse(st, 'junction_deck');
  }
  // 3. Bridges over the obstacles.
  if (items && learnt(sim, BRIDGE)) {
    const span = 4 + sim.mods.bridgeSpan;
    for (let i = 0; i < n;) {
      if (!leapable(out[i]!)) { i++; continue; }
      let m = i;
      while (m + 1 < n && leapable(out[m + 1]!)) m++;
      // A bridge end never stands on a junction: the planned junctions right before or after the run
      // go under the leap with it (their lines run on underneath), so a row of them by a pond, or by
      // a line whose deck end is taken (D158), is leapt whole as a run of obstacles was before.
      let s = i - 1, e = m + 1;
      while (s >= 0 && isJunction(out[s]!) && out[s]!.ok) s--;
      while (e < n && isJunction(out[e]!) && out[e]!.ok) e++;
      leap(sim, path, out, def, s, e, span);
      i = m + 1;
    }
  }
  // 3b. Buried where the land refuses the dragged ribbon (D109).
  if (items && !b.lift && !b.camo && learnt(sim, CAMO)) {
    const id = BUILDING_IDS[CAMO]!;
    for (let i = 0; i < n; i++) {
      const st = out[i]!;
      if (st.skip || st.ok || st.reason !== 'neighbour_land' || buildingIdx(st.def) !== def) continue;
      const c = canPlace(sim, id, st.x, st.y, st.rot);
      if (c.ok || c.reason === 'unaffordable' || c.reason === 'reserve') out[i] = { x: st.x, y: st.y, rot: st.rot, def: id, skip: false, ...c };
    }
  }
  // 4. One budget, in path order.
  const spent = new Map<number, number>(); // net mu by item, taken by the steps before
  for (const st of out) {
    if (st.skip || !st.ok) continue;
    if (!affordable(sim, st.cost, st.replaces, spent)) { refuse(st, 'unaffordable'); continue; }
    for (const c of st.cost) spent.set(c.item, (spent.get(c.item) ?? 0) + c.mu);
    for (const r of st.replaces) for (const c of refundCost(sim, sim.ents.get(r)!)) spent.set(c.item, (spent.get(c.item) ?? 0) - c.mu);
  }
  return out;
}

/**
 * Why a tile is not the claim's land, for the build tool's tip over a buried piece (D109): a
 * neighbouring base's (`neighbour_land`), anyone else's (`outside_zone`), or null on the claim's own.
 */
export function landReason(sim: Sim, x: number, y: number): PlaceReason | null {
  if (!inWorld(x, y) || sim.land.covers(x, y)) return null;
  return sim.land.neighbour(parcelAt(x, y)) >= 0 ? 'neighbour_land' : 'outside_zone';
}

const isJunction = (st: BeltStep): boolean => !st.skip && buildingIdx(st.def) === JUNCTION;

/** Does the conduit on (x, y) hand its water on — to the tile ahead, a port, a branch — rather than end there (D152)? */
function goesOn(sim: Sim, x: number, y: number): boolean {
  sim.ensureCompiled();
  const t = tileIndex(x, y), c = sim.graph.chainByTile.get(t);
  return !!c && (c.lastTile !== t || c.outE.length > 0);
}
const leapable = (st: BeltStep): boolean => !st.skip && !st.ok && LEAPABLE.has(st.reason);

/** Does a drag run straight through path tile i: in line with the tiles before and after it? */
function throughAt(path: BeltPath, i: number): boolean {
  const prev = path[i - 1], next = path[i + 1];
  if (!prev || !next) return false; // an end of the drag
  const [x, y, r] = path[i]!;
  return prev[2] === r && prev[0] === x - DX[r]! && prev[1] === y - DY[r]! && next[0] === x + DX[r]! && next[1] === y + DY[r]!;
}

/**
 * A bridge pair on path tiles s and e, over the obstacles between them, when it can carry the
 * line (pass 3 above); else nothing changes and the obstacles stay refused.
 */
function leap(sim: Sim, path: BeltPath, out: BeltStep[], def: number, s: number, e: number, span: number): void {
  if (s < 0 || e >= path.length || e - s > span) return;
  const d = path[s]![2];
  // Straight from s to e, each tile facing on along d (so the tiles follow one another in line).
  for (let j = s; j <= e; j++) if (path[j]![2] !== d) return;
  // Entered from straight behind only (D55): a bridge start at the drag's corner would be fed from its side.
  if (s > 0 && path[s - 1]![2] !== d) return;
  // Its ends stand where the dragged ribbon would: not a junction, a step or a kept block.
  const plain = (st: BeltStep): boolean => (st.skip ? st.def === BUILDING_IDS[def] && !st.leapt : st.ok && buildingIdx(st.def) === def);
  if (!plain(out[s]!) || !plain(out[e]!)) return;
  const [sx, sy] = path[s]!, [ex, ey] = path[e]!;
  if (sim.grid.level(sx, sy) !== sim.grid.level(ex, ey)) return; // a bridge keeps to its level
  // The other bridges of this way on its line and level, laid or planned (D160: ends go in pairs, in
  // order along their line, compile.ts): none between the pair's ends (it would cut the leap), and
  // the nearest behind its start within reach the far end of a pair (a start there would take ours
  // as its far end). Past its far end the next end is a start: pairs chain, bridge after bridge.
  const lv = sim.grid.level(sx, sy);
  const at = new Set<number>(); // their places along the line, from the start (tiles)
  for (let k = -64; k <= e - s + span; k++) {
    if (k === 0 || k === e - s) continue;
    const tx = sx + DX[d]! * k, ty = sy + DY[d]! * k;
    if (!inWorld(tx, ty)) continue;
    const o = sim.ents.get(sim.grid.occ[tileIndex(tx, ty)]!);
    if (o && BUILDING_KIND[o.def] === 'bridge' && o.rot === d && sim.grid.level(tx, ty) === lv) at.add(k);
  }
  for (const st of out) {
    if (st.skip || buildingIdx(st.def) !== BRIDGE || st.rot !== d) continue;
    const k = (st.x - sx) * DX[d]! + (st.y - sy) * DY[d]!;
    if ((DX[d] === 0 ? st.x === sx : st.y === sy) && sim.grid.level(st.x, st.y) === lv) at.add(k);
  }
  for (let k = 1; k < e - s; k++) if (at.has(k)) return;
  const behind = (k: number): number | null => { for (let j = k - 1; j >= k - span; j--) if (at.has(j)) return j; return null; };
  const farEnd = (k: number): boolean => { const b = behind(k); return b !== null && !farEnd(b); };
  const back = behind(0);
  if (back !== null && !farEnd(back)) return;
  // Height rule (D124): a bridge never leaps a tall building. The tiles that hold one say so, and the drag stops there.
  let tall = false;
  for (let j = s + 1; j < e; j++) {
    const [x, y] = path[j]!;
    if (tallAt(sim, x, y)) { tall = true; if (!out[j]!.ok) refuse(out[j]!, 'bridge_over_tall'); }
  }
  if (tall) return;
  const id = BUILDING_IDS[BRIDGE]!;
  const cs = canPlace(sim, id, sx, sy, d), ce = canPlace(sim, id, ex, ey, d);
  if (!cs.ok || !ce.ok) return;
  out[s] = { x: sx, y: sy, rot: d, def: id, skip: false, ...cs };
  out[e] = { x: ex, y: ey, rot: d, def: id, skip: false, ...ce };
  for (let j = s + 1; j < e; j++) {
    const [x, y] = path[j]!;
    const o = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!);
    out[j] = { ...kept(x, y, d, o ? BUILDING_IDS[o.def]! : ''), leapt: true };
  }
}

/**
 * Lay a ribbon drag (each element [x, y, rot]) as `planBelts` plans it: exactly the steps the
 * plan (and so the ghost) accepts. Every placement is its own logged `place` (a junction as a
 * junction, a bridge end as a bridge), so a replay needs no planner. Returns how many were placed.
 */
export function placeBelts(sim: Sim, defId: string, path: BeltPath): number {
  let n = 0;
  for (const s of planBelts(sim, defId, path)) if (!s.skip && s.ok && place(sim, s.def, s.x, s.y, s.rot).ok) n++;
  return n;
}
