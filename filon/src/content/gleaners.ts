// gleaners.ts — the Gleaners' taste (D103; owner, 2026-10-17: « pendant la nuit, un petit peuple
// alien du désert peut parcourir le désert et venir prendre certains items qui sont sur les tapis »).
// A small people of Ysmère's open desert, curious and harmless: at night they come up to the ribbons
// they can reach and take the shiny, made things — wire, glass, plates, quartz, the parts — and leave
// what the desert already has (ore, stone, sand, coal, water). The numbers of their nights are in
// `BAL.gleaners`; where they walk, sim/world/reach.ts; how they take, sim/flow/chain.ts.
import type { ItemId } from './items';

/**
 * ‰: how likely they take an item of this kind when they look at it on a ribbon (1000: always).
 * Anything not listed they leave. Data files mean nothing to them (they do not read).
 */
export const GLEANER_TASTE: Partial<Record<ItemId, number>> = {
  // What shines: they always take it.
  copper_wire: 1000,
  glass: 1000,
  quartz: 1000,
  oscillator: 1000,
  circuit: 1000,
  lens: 1000,
  charged_cell: 1000,
  singing_quartz: 1000,
  resonator: 1000,
  nacre_lattice: 1000,
  copper_plate: 1000, // D123: bright copper
  // Made things, a little duller (D123: steel, pipes, cables; bricks they leave, heavy and dull).
  iron_plate: 600,
  gear: 700,
  empty_cell: 800,
  pace_bell: 800,
  thermal_core: 800,
  robot_arm: 600,
  ceramic: 300,
  resin_canvas: 400,
  steel: 500,
  pipe: 600,
  cable: 700,
  // The far tiers' strange goods.
  sporeglass: 900,
  fossil_nacre: 900,
  lumen_moss: 900,
  embersalt: 600,
  sky_resin: 500,
};
