// land.ts — the land's rules (docs/land.md, D60): what a parcel costs — what it holds today, how
// much land the claim already bought, the Heart's standing and research, a sister claim's markup
// (owner, 2026-10-14: "the price should vary depending on what's on it, when no other player owns
// it") — buying it, leasing it by the hour, and the hour's rent taken at the minute boundary it falls
// on (`landEpoch`: online and in the catch-up, the same call). A lease the purse cannot pay lapses:
// the parcel goes back to its owner and what stands on it goes dormant (`isDormant`), nothing lost.
import { book } from '../purse';
import { BAL } from '@/content/balance';
import { ITEMS } from '@/content/items';
import { ITEM_IDS } from '@/content/registry';
import { CENTER, EPOCH } from '../constants';
import { isFaceOre } from '../face';
import type { Sim } from '../state';
import { T } from '../types';
import { parcelFloor } from '../world/floor';
import { PARCEL_COLS, parcelCentre, parcelRect } from '../world/land';

/** A lease's hour, in ticks. */
export const LEASE_TICKS = 60 * EPOCH;

/**
 * Why the land would not change hands (null: it did). `far`: the parcel does not touch the
 * claim's land (Far Claim lifts it, D70); `not_bought`: only a bought parcel sells back.
 */
export type LandRefusal = 'none' | 'held' | 'credits' | 'locked' | 'not_leased' | 'far' | 'not_bought';

/** May the claim take this parcel: next to its land, or anywhere with the Far Claim research (D70)? */
const reachable = (sim: Sim, p: number): boolean => sim.mods.flags.has('farClaims') || sim.land.touches(p);

/** An item's value in centi-ocelles (items.ts: ocelles, to two places). */
const VALUE = ITEM_IDS.map((id) => Math.round(ITEMS[id].value * 100));

const valid = (p: number): boolean => Number.isInteger(p) && p >= 0 && p < PARCEL_COLS * PARCEL_COLS;

/**
 * What a parcel holds, priced (centi-ocelles): its ground tile by tile and its deposits by ore and
 * richness. A face ore (D87: the quartz in a wall) is priced as the rock it is set in: no drill
 * takes it, and the vein's parcel is the tutorial's first purchase, within its purse. Floor pays in
 * full only where it is usable (D94, world/floor.ts), so land cut up by cliffs, chasms and rivers
 * costs less: its price follows the room it gives.
 */
export function landContent(sim: Sim, p: number): number {
  const L = BAL.land, { x0, y0, x1, y1 } = parcelRect(p), usable = parcelFloor(sim.grid, p).mask, w = x1 - x0;
  let cents = L.base;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = sim.grid.terrain(x, y);
      cents += t >= T.Rock1 && t <= T.Rock4 ? L.tile.rock!
        : t === T.Shallow || t === T.Deep ? L.tile.water!
          : t === T.Salt ? L.tile.salt!
            : t === T.Vent ? L.tile.vent!
              : t === T.DuneSea ? L.tile.dunes!
                : t === T.River ? L.tile.river!
                  : t === T.Chasm ? L.tile.chasm!
                    : usable[(y - y0) * w + x - x0] ? L.tile.floor! : L.tile.sliver!;
      const ore = sim.grid.ore(x, y);
      if (ore >= 0 && !isFaceOre(ore)) cents += Math.floor((L.depositPerValue * VALUE[ore]! * (sim.grid.capMuPerEpoch(x, y) / 10)) / (100 * 500));
    }
  }
  return cents;
}

/** What buying a parcel costs now (centi-ocelles). */
export function landPrice(sim: Sim, p: number): number {
  const L = BAL.land, m = sim.mods;
  let cents = landContent(sim, p);
  // Each parcel bought makes the next dearer.
  for (let i = 0; i < sim.land.bought.size; i++) cents = Math.floor((cents * m.landGrowth) / 1000);
  cents = Math.floor((cents * m.landPrice) / 1000);
  const [cx, cy] = parcelCentre(p), dx = cx - CENTER, dy = cy - CENTER;
  if (dx * dx + dy * dy > L.farRadius * L.farRadius) cents = Math.floor((cents * m.farLand) / 1000);
  const owner = sim.land.sister(p);
  if (owner >= 0) cents = Math.floor((cents * L.sisterMarkup[owner % L.sisterMarkup.length]!) / 1000);
  return cents;
}

/** A parcel's rent for an hour's lease, as a lease would fix it now (centi-ocelles). */
export function landRent(sim: Sim, p: number): number {
  return Math.max(1, Math.floor((Math.floor((landPrice(sim, p) * BAL.land.rentPermille) / 1000) * sim.mods.landRent) / 1000));
}

/** Can the claim lease land yet (Land Registry)? */
export const canLease = (sim: Sim): boolean => sim.mods.flags.has('lease');

// The refusals, apart from the deeds: the land panel greys a button out with its reason before the
// click, and the deed checks the same thing.

/** Why buying parcel `p` would be refused now (null: it would go through). */
export function buyBlock(sim: Sim, p: number): LandRefusal | null {
  if (!valid(p)) return 'none';
  if (sim.land.inStart(p) || sim.land.bought.has(p) || sim.land.granted.has(p)) return 'held';
  if (!sim.land.leases.has(p) && !reachable(sim, p)) return 'far';
  return sim.credits < landPrice(sim, p) ? 'credits' : null;
}

/** Why leasing parcel `p` would be refused now (null: it would go through). */
export function leaseBlock(sim: Sim, p: number): LandRefusal | null {
  if (!valid(p)) return 'none';
  if (!canLease(sim)) return 'locked';
  if (sim.land.holds(p)) return 'held';
  if (!reachable(sim, p)) return 'far';
  return sim.credits < landRent(sim, p) ? 'credits' : null;
}

/** Why selling parcel `p` back would be refused now (null: it would go through). */
export function sellBlock(sim: Sim, p: number): LandRefusal | null {
  if (!sim.mods.flags.has('landResale')) return 'locked';
  return sim.land.bought.has(p) ? null : 'not_bought';
}

/** Buy a parcel outright (a leased one too: its lease ends). */
export function buyLand(sim: Sim, p: number): LandRefusal | null {
  const r = buyBlock(sim, p);
  if (r) return r;
  const cents = landPrice(sim, p);
  sim.credits -= cents;
  book(sim, 'land', -cents);
  sim.land.leases.delete(p);
  sim.land.bought.add(p);
  sim.land.paid.set(p, cents);
  held(sim, p);
  sim.log.push({ tick: sim.tick, cmd: { k: 'buyLand', p } });
  sim.events.push({ k: 'land', p, what: 'bought', cents });
  return null;
}

/** Lease a parcel: the first hour paid now, the rent fixed for the lease's life. */
export function rentLand(sim: Sim, p: number): LandRefusal | null {
  const r = leaseBlock(sim, p);
  if (r) return r;
  const cents = landRent(sim, p);
  sim.credits -= cents;
  book(sim, 'rent', -cents); // the first hour's rent
  sim.land.leases.set(p, { next: sim.tick + LEASE_TICKS, cents });
  held(sim, p);
  sim.log.push({ tick: sim.tick, cmd: { k: 'rentLand', p } });
  sim.events.push({ k: 'land', p, what: 'leased', cents });
  return null;
}

/** Give a lease up: the parcel goes back to its owner, what stands on it dormant. */
export function endLease(sim: Sim, p: number): LandRefusal | null {
  if (!sim.land.leases.delete(p)) return 'not_leased';
  sim.dirty = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'endLease', p } });
  sim.events.push({ k: 'land', p, what: 'ended', cents: 0 });
  return null;
}

/**
 * Parcel Resale (xp_resell): a bought parcel goes back to CrierBelt for a share of what it cost
 * (of what it holds today, for one bought before prices were kept); what stands on it goes
 * dormant, nothing lost; the next purchase is cheaper by one parcel's growth.
 */
export function sellLand(sim: Sim, p: number): LandRefusal | null {
  const r = sellBlock(sim, p);
  if (r) return r;
  const cents = resalePrice(sim, p);
  sim.land.bought.delete(p);
  sim.land.paid.delete(p);
  sim.credits += cents;
  book(sim, 'land', cents);
  sim.dirty = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'sellLand', p } });
  sim.events.push({ k: 'land', p, what: 'sold', cents });
  return null;
}

/** What selling a bought parcel back would give now (centi-ocelles). */
export function resalePrice(sim: Sim, p: number): number {
  return Math.floor(((sim.land.paid.get(p) ?? landContent(sim, p)) * BAL.landResale) / 1000);
}

/** Land newly held: its fog lifts, and what stands on it wakes (the graph is rebuilt). */
function held(sim: Sim, p: number): void {
  const [cx, cy] = parcelCentre(p);
  sim.explored.push([cx, cy, BAL.landReveal]);
  sim.dirty = true;
}

/** Leases whose hour falls due at this tick and that the purse could not pay: they would lapse. */
export function lapsing(sim: Sim): boolean {
  let credits = sim.credits;
  for (const p of [...sim.land.leases.keys()].sort((a, b) => a - b)) {
    const l = sim.land.leases.get(p)!;
    if (l.next > sim.tick) continue;
    if (credits < l.cents) return true;
    credits -= l.cents;
  }
  return false;
}

/**
 * The leases' hour at a minute boundary, in parcel order: each one due takes its rent, or lapses
 * when the purse cannot pay. Returns whether a lease lapsed (what stood on it is dormant now: the
 * graph changes).
 */
export function landEpoch(sim: Sim): boolean {
  let lapsed = false;
  for (const p of [...sim.land.leases.keys()].sort((a, b) => a - b)) {
    const l = sim.land.leases.get(p)!;
    if (l.next > sim.tick) continue;
    if (sim.credits >= l.cents) {
      sim.credits -= l.cents;
      book(sim, 'rent', -l.cents);
      l.next += LEASE_TICKS;
      sim.events.push({ k: 'land', p, what: 'rent', cents: l.cents });
    } else {
      sim.land.leases.delete(p);
      lapsed = true;
      sim.events.push({ k: 'land', p, what: 'lapsed', cents: 0 });
    }
  }
  if (lapsed) sim.dirty = true;
  return lapsed;
}
