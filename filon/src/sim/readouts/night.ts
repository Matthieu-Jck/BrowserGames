// readouts/night.ts — how much of the Core's grid would hold without the sun (D101): « Tenir la
// nuit »'s objective (systems/quests.ts) and the night notice before the first sunset
// (ui/night-notice.ts) read the same numbers. The grid's producers in this epoch's weather with the
// sun at nothing (the Core's panel and the solar panels give 0 at night, D25; its isotope core, the
// wind, the ground's heat keep giving), its fuelled generators' capacity, and what its accumulators
// hold, spread over a whole night — against what the grid asks for now. Read from the sim, never
// changing it; integers only (kW, %).
import { EPOCH, SOLAR } from '../constants';
import { producerKw, weatherAt } from '../power/network';
import type { Sim } from '../state';

/** Epochs of full night in a day (the sun at 0): what an accumulator's charge must last. */
const NIGHT_EPOCHS = SOLAR.filter((s) => s === 0).length;

/** The Core's grid without the sun. */
export interface NightCover {
  /** What the grid asks for now (kW). */
  demand: number;
  /** What it would have at night (kW): producers without the sun, fuel, accumulators over a night. */
  supply: number;
  /** What the sun gives it now (kW): the share that goes at dusk. */
  solar: number;
  /** Its renewables now, the sun included (kW). */
  now: number;
  /** Its fuelled generators' capacity (kW). */
  fuel: number;
  /** supply / demand, %, at most 100 (0 when nothing draws). */
  pct: number;
}

/** The Core's grid without the sun (null before the first compile). */
export function nightCover(sim: Sim): NightCover | null {
  const g = sim.graph;
  const net = g?.netOfEnt.get(sim.hearthId);
  if (!g || net === undefined) return null;
  const n = g.nets[net], p = sim.netPower[net];
  if (!n || !p) return null;
  const w = weatherAt(sim.absEpoch(), sim.worldSeed, sim.mods);
  const dark = { ...w, sun: 0 };
  let now = 0, night = 0;
  for (const pr of n.producers) { now += producerKw(pr, w); night += producerKw(pr, dark); }
  let acc = 0;
  for (const a of n.accs) acc += Math.min(a.rate, Math.floor((sim.accEnergy.get(a.ent) ?? 0) / (NIGHT_EPOCHS * EPOCH)));
  const supply = night + p.fuel + acc, demand = p.demand;
  return { demand, supply, solar: now - night, now, fuel: p.fuel, pct: demand > 0 ? Math.min(100, Math.floor((supply * 100) / demand)) : 0 };
}
