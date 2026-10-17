// readouts/wind.ts — what the Vent view shows (D95), read from the sim and never changing it: the
// wind now and its bearing today, its next 24 hours (a pure function of the world clock, so
// exact), each turbine's exposure, local wind and output — now and over the next day —, and what
// a turbine would give at a spot before it is placed (`windOutlook`: the placing ghost's figure).
// `windiest` ranks the spots round a point by exposure (the guide's arrow, the debug bases).
// Integers (kW, ‰), like the engine.
import { buildingDef, buildingIdx, BUILDING_KIND } from '@/content/registry';
import type { WindCurve } from '@/content/types';
import { DAY_EPOCHS } from '../constants';
import { footprint } from '../entities';
import { weatherAt, windKw, windSite, turbineWind, type Weather } from '../power/network';
import type { Sim } from '../state';
import type { Rot } from '../types';
import { bearingOf, meanExposure, prevailing } from '../world/wind';

/** A turbine as the view reads it. */
export interface TurbineLook {
  ent: number;
  /** Its grid (−1: unwired: it would give, and gives nothing). */
  net: number;
  /** Its rating (kW, with the research), what it gives now, its mean over the next 24 h (kW). */
  full: number;
  kw: number;
  mean: number;
  /** Its exposure today and over the days (‰), the local wind now (‰ of the reference wind). */
  exposure: number;
  overall: number;
  wind: number;
}

export interface WindReport {
  /** Where the wind comes from today and usually (bearings of 64, 0 east, 16 south). */
  bearing: number;
  prevailing: number;
  /** The wind over open flat ground now (‰). */
  wind: number;
  /** The next 24 hours, an epoch a step: the absolute epoch and the wind (‰). */
  day: Array<{ ep: number; wind: number }>;
  turbines: TurbineLook[];
}

/** A wind building's rating with the research (kW) and its curve. */
function ratingOf(sim: Sim, def: number): { kw: number; curve: WindCurve } {
  const g = buildingDef(def).gen!;
  return { kw: Math.floor((g.kw * sim.mods.windOut * sim.mods.genOut) / 1e6), curve: g.wind ?? { cutIn: 400, rated: 1600 } };
}

/** The next `n` epochs' weather from now. */
function nextWeathers(sim: Sim, n = DAY_EPOCHS): Weather[] {
  const now = sim.absEpoch(), out: Weather[] = [];
  for (let k = 0; k < n; k++) out.push(weatherAt(now + k, sim.worldSeed, sim.mods));
  return out;
}

/** A turbine's mean output over these weathers (kW). */
const meanKw = (kw: number, c: WindCurve, local: readonly [number, number, number], ws: readonly Weather[]): number =>
  ws.length ? Math.floor(ws.reduce((a, w) => a + windKw(kw, c, local, w), 0) / ws.length) : 0;

/** The wind now, today's bearing, the next day and every turbine. */
export function windReport(sim: Sim): WindReport {
  const ws = nextWeathers(sim), w = ws[0]!;
  const turbines: TurbineLook[] = [];
  for (const e of sim.ents.sorted()) {
    if (BUILDING_KIND[e.def] !== 'wind' || e.builtAt !== 0) continue;
    const { kw, curve } = ratingOf(sim, e.def);
    const local = windSite(sim.grid, sim.worldSeed, e);
    const net = sim.graph?.netOfEnt.get(e.id) ?? -1;
    turbines.push({
      ent: e.id, net, full: kw, kw: net >= 0 ? windKw(kw, curve, local, w) : 0, mean: meanKw(kw, curve, local, ws),
      exposure: local[w.veer]!, overall: meanExposure(local), wind: turbineWind(local, w),
    });
  }
  return { bearing: bearingOf(sim.worldSeed, w.veer), prevailing: prevailing(sim.worldSeed), wind: w.wind, day: ws.map((x, k) => ({ ep: sim.absEpoch() + k, wind: x.wind })), turbines };
}

/** What a turbine of `def` would catch and give at (x, y, rot): its exposure today and over the days, now and over the next 24 h (kW). */
export function windOutlook(sim: Sim, def: string, x: number, y: number, rot: Rot): { exposure: number; overall: number; now: number; mean: number; full: number } {
  const di = buildingIdx(def);
  const { kw, curve } = ratingOf(sim, di);
  const local = windSite(sim.grid, sim.worldSeed, { def: di, x, y, rot });
  const ws = nextWeathers(sim), w = ws[0]!;
  return { exposure: local[w.veer]!, overall: meanExposure(local), now: windKw(kw, curve, local, w), mean: meanKw(kw, curve, local, ws), full: kw };
}

/**
 * The free spots within `r` tiles of (x, y) where a turbine of `def` may stand now (`sim.canPlace`, replacing nothing), the
 * windiest first (exposure over the days; then nearer; then by row): at most `n`. `unpaid`: a spot
 * the purse or the reserve alone refuses counts (the guide points before the player can pay).
 */
export function windiest(sim: Sim, def: string, x: number, y: number, r: number, n = 1, unpaid = false): Array<[number, number, number]> {
  const di = buildingIdx(def);
  const [w, h] = footprint(di, 0);
  const scored: Array<[number, number, number, number]> = [];
  for (let ty = y - r; ty <= y + r; ty++) for (let tx = x - r; tx <= x + r; tx++) {
    const dx = 2 * tx + w - 2 * x, dy = 2 * ty + h - 2 * y;
    if (dx * dx + dy * dy > 4 * r * r) continue; // within the circle
    scored.push([tx, ty, meanExposure(windSite(sim.grid, sim.worldSeed, { def: di, x: tx, y: ty, rot: 0 })), dx * dx + dy * dy]);
  }
  scored.sort((a, b) => b[2] - a[2] || a[3] - b[3] || a[1] - b[1] || a[0] - b[0]);
  const out: Array<[number, number, number]> = [];
  for (const [tx, ty, e] of scored) {
    if (out.length >= n) break;
    const c = sim.canPlace(def, tx, ty, 0);
    if ((c.ok || (unpaid && (c.reason === 'unaffordable' || c.reason === 'reserve'))) && !c.replaces.length) out.push([tx, ty, e]);
  }
  return out;
}
