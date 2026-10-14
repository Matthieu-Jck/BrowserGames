// space.ts — making room: digging rock, filling water, and flying freight. The rules, as
// pure functions over integers:
// · an excavator digs the designated rock tiles within its reach, one at a time; a tile takes
//   its hardness's time (research speeds it up), yields stone as it goes — under the same
//   path-independent allowance as research, so the offline catch-up matches ticking — and,
//   once through, turns to floor (reclaimed land when it touches a zone) and sometimes gives
//   up embedded ore (a deterministic draw per tile);
// · a backfiller fills designated water / salt flats within its reach with stone;
// · a drifter route carries one item between two skydocks at the average throughput of its
//   ships: C / (2d/v + 2t) items per minute each.
import { BAL } from '@/content/balance';
import { hash32 } from '@/core/hash';
import { isqrt, mulDiv } from '@/core/fixed';
import { itemIdx } from '@/content/registry';
import { EPOCH, TPS } from './constants';
import type { Mods } from './research/modifiers';
import { T } from './types';

export type JobKind = 'dig' | 'fill';

export interface Job {
  /** The excavator or backfiller doing it. */
  ent: number;
  kind: JobKind;
  tile: number;
  /** Duration (ticks) and elapsed powered time (milli-ticks). */
  dur: number;
  el: number;
  /** Stone the tile yields (dig) or needs (fill), and how much has moved so far (mu). */
  mu: number;
  moved: number;
}

export interface Route {
  id: number;
  from: number;
  to: number;
  item: number;
  ships: number;
  /** Sub-mu remainder of the continuous flow (online ticking). */
  carry: number;
}

const rockClass = (t: number): number => t - T.Rock1;

/** Can this rock be dug with the research owned? (H1–H2 with Earthworks; H3, H4 later.) */
export function canDig(t: number, mods: Mods): boolean {
  const c = rockClass(t);
  if (c < 0 || c > 3) return false;
  if (c === 2) return mods.flags.has('digH3');
  if (c === 3) return mods.flags.has('digH4');
  return true;
}

/** Ticks to dig one tile (basalt is faster with Basalt Bits; `machine`: the excavator's own speed ‰, D70). */
export function digTicks(t: number, mods: Mods, machine = 1000): number {
  const c = rockClass(t);
  let speed = Math.floor((mods.digSpeed * machine) / 1000);
  if (c === 1 && mods.flags.has('basaltBits')) speed = Math.floor((speed * 1500) / 1000);
  return Math.max(1, mulDiv(BAL.digMinutes[c]! * 60 * TPS, 1000, speed));
}

/** Stone (mu) one tile yields. */
export const digRubble = (t: number, mods: Mods): number => mulDiv(BAL.digRubble[rockClass(t)]! * 1000, mods.rubbleYield, 1000);

/** Embedded ore a dug tile gives up (deterministic per tile; the copper chance is the land's). */
export function embedded(x: number, y: number, mods: Mods, chimePermille: number = BAL.embedCopper): Array<{ item: number; mu: number }> {
  const out: Array<{ item: number; mu: number }> = [];
  if (hash32(x, y, 0x9b1) % 1000 < BAL.embedIron) out.push({ item: itemIdx('iron_ore'), mu: mulDiv(BAL.embedIronItems * 1000, mods.embeddedOre, 1000) });
  if (hash32(x, y, 0x9b2) % 1000 < chimePermille) out.push({ item: itemIdx('copper_ore'), mu: mulDiv(BAL.embedCopperItems * 1000, mods.embeddedOre, 1000) });
  return out;
}

/** Stone (mu) to fill a tile, or null when it cannot be filled (deep water before Deep Fill). */
export function fillCost(t: number, mods: Mods): number | null {
  if (t === T.Shallow) return BAL.fillRubble.shallow! * 1000;
  if (t === T.Salt) return BAL.fillRubble.salt! * 1000;
  if (t === T.Deep && mods.flags.has('deepFill')) return BAL.fillRubble.deep! * 1000;
  return null;
}

export const fillTicks = (): number => BAL.fillSeconds * TPS;

/**
 * Advance a job by `ticks` at `sat` ‰. Stone moves under the allowance (⌊mu·e/dur⌋ so far):
 * a dig adds it to `stock` (stopping at `cap`), a fill takes it from `stock`. Returns the mu
 * moved this step.
 */
export function advanceJob(j: Job, stock: Float64Array, rubble: number, cap: number, ticks: number, sat: number): number {
  if (sat <= 0) return 0;
  const end = j.dur * 1000;
  // Digging pauses while the store is full; filling waits for stone.
  if (j.kind === 'dig' && stock[rubble]! >= cap) return 0;
  j.el = Math.min(end, j.el + sat * ticks);
  const allowed = mulDiv(j.mu, j.el, end);
  let d = allowed - j.moved;
  if (d <= 0) return 0;
  // A dig adds all that is due (the pause above keeps the store near its cap); a fill can
  // only take what is there.
  if (j.kind === 'fill') d = Math.min(d, Math.floor(stock[rubble]!));
  if (d <= 0) return 0;
  stock[rubble] = stock[rubble]! + (j.kind === 'dig' ? d : -d);
  j.moved += d;
  return d;
}

export const jobDone = (j: Job): boolean => j.el >= j.dur * 1000 && j.moved >= j.mu;

/** Stone flow (mu per tick) of a running job at `sat` — for the offline reservoir maths. */
export const jobRate = (j: Job, sat: number): number => (j.el >= j.dur * 1000 ? 0 : (j.mu * sat) / (j.dur * 1000));

/** Drifter route: tiles between two docks' centres (Euclid, integer). */
export function routeDistance(ax: number, ay: number, bx: number, by: number, mods: Mods): number {
  const d = isqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
  return mulDiv(d, mods.drifterDistance, 1000);
}

/** Items per minute a route's ships carry: ships × C / (2d/v + 2t) (`capMult`: the source dock's ships' load ‰, D70). */
export function routePerMin(ships: number, dist: number, mods: Mods, capMult = 1000): number {
  const cap = (((BAL.drifterCap * mods.shipCap) / 1000) * capMult) / 1000;
  const v = (BAL.drifterTilesPerMin * mods.shipSpeed) / 1000;
  return (ships * cap) / ((2 * dist) / v + 2 * BAL.drifterLoadMin);
}

/** The same in mu per tick. */
export const routeRate = (ships: number, dist: number, mods: Mods, capMult = 1000): number => (routePerMin(ships, dist, mods, capMult) * 1000) / EPOCH;

/** Ships one dock can host: its own (the great skydock's 8, D70), plus research. */
export const dockShips = (mods: Mods, dock?: { readonly ships: number }): number => (dock?.ships ?? BAL.dockShips) + mods.dockShips;
