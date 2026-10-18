// past-costs.ts — what buildings cost before their price changed, so a building put up then is
// refunded what it was paid (D123). Removal refunds a building in full (ARCHITECTURE.md, invariant
// 4) — what the claim paid for it, not today's price: an excavator built for 30 plates gives back 30
// plates, not today's steel, so a change of price neither robs a standing base nor turns its old
// buildings into a mint of the new materials. A colony records the first entity id placed under
// today's prices (`Sim.costFloor`, saved as `costFloor`; entity ids are never reused, sim/entities.ts):
// an entity below it whose building is listed here refunds the cost listed (sim/refund.ts). A base
// founded after D123 has a floor of 0, and nothing of it refunds a past cost.
import type { BuildingId } from './buildings';

/**
 * The costs D123 changed (owner, 2026-10-17: the buildings of Tiers 1–3 built of copper plates,
 * steel, bricks, pipes and cables), as they were before it. A later change of price adds its own
 * table and floor beside this one; it never edits this one.
 */
export const COSTS_BEFORE_D123: Readonly<Partial<Record<BuildingId, ReadonlyArray<readonly [string, number]>>>> = {
  electric_smelter: [['iron_plate', 25], ['copper_wire', 10], ['glass', 4]],
  wire_mill_double: [['iron_plate', 25], ['glass', 6], ['copper_wire', 6]],
  excavator: [['iron_plate', 30], ['gear', 10], ['circuit', 4]],
  ceramic_oven: [['iron_plate', 25], ['gear', 6]],
  great_workshop: [['iron_plate', 40], ['gear', 10], ['circuit', 10]],
  accumulator: [['ceramic', 10], ['empty_cell', 4], ['circuit', 6]],
  pylon: [['iron_plate', 20], ['copper_wire', 10], ['ceramic', 4]],
  backfiller: [['iron_plate', 20], ['gear', 10], ['ceramic', 10]],
  sifter: [['iron_plate', 20], ['glass', 4]],
  heavy_accumulator: [['ceramic', 20], ['empty_cell', 10], ['circuit', 10]],
  cell_charger: [['ceramic', 10], ['circuit', 6]],
  great_workshop_compact: [['iron_plate', 40], ['gear', 12], ['circuit', 8], ['pace_bell', 2]],
  server: [['circuit', 10], ['iron_plate', 20], ['copper_wire', 10], ['oscillator', 4]],
  deep_bore: [['ceramic', 30], ['thermal_core', 4], ['gear', 10]],
  hp_pump: [['ceramic', 10], ['gear', 6], ['iron_plate', 15]],
  big_turbine: [['iron_plate', 40], ['gear', 12], ['copper_wire', 20], ['ceramic', 10]],
  solar_farm: [['iron_plate', 20], ['glass', 40], ['copper_wire', 12], ['circuit', 4]],
  fumarole_tap: [['ceramic', 20], ['thermal_core', 4], ['circuit', 10]],
  cooled_server: [['circuit', 30], ['ceramic', 20], ['gear', 10]],
  heavy_excavator: [['iron_plate', 40], ['gear', 16], ['circuit', 8], ['ceramic', 10]],
  forge_press: [['iron_plate', 60], ['gear', 20], ['pace_bell', 4]],
  arc_furnace: [['ceramic', 20], ['gear', 10], ['circuit', 6], ['pace_bell', 2]],
  cell_generator: [['iron_plate', 20], ['ceramic', 10], ['circuit', 6]],
  scriptorium: [['iron_plate', 40], ['circuit', 10], ['gear', 10]],
  giant_drill: [['thermal_core', 8], ['gear', 30], ['ceramic', 40]],
};

/**
 * The costs D129 changed (owner, 2026-10-18: the electronics workshop moved to Tier 2 and built like
 * an electronics works, the early buildings' circuits turned into Tier 1's coils and motors), as they
 * were between D123 and D129. A building standing from before D129 (its entity id under the colony's
 * `costFloorD129`) refunds these; one from before D123 whose price D123 changed too refunds the older
 * table above (sim/refund.ts reads them oldest first).
 */
export const COSTS_BEFORE_D129: Readonly<Partial<Record<BuildingId, ReadonlyArray<readonly [string, number]>>>> = {
  workshop: [['iron_plate', 20], ['glass', 4], ['copper_wire', 6]],
  excavator: [['steel', 12], ['iron_plate', 10], ['gear', 10], ['circuit', 4]],
  fast_drill: [['iron_plate', 20], ['gear', 6], ['circuit', 2]],
  pitch_turbine: [['iron_plate', 15], ['glass', 6], ['copper_wire', 8], ['gear', 4]],
  electric_smelter: [['iron_plate', 15], ['copper_plate', 10], ['brick', 10], ['glass', 4]],
  wire_mill_double: [['steel', 6], ['copper_plate', 6], ['glass', 4]],
  great_workshop: [['steel', 20], ['brick', 20], ['gear', 10], ['circuit', 10]],
  accumulator: [['ceramic', 10], ['empty_cell', 4], ['circuit', 4], ['cable', 4]],
  heavy_accumulator: [['ceramic', 20], ['empty_cell', 10], ['circuit', 8], ['cable', 10]],
  cell_charger: [['ceramic', 10], ['circuit', 6], ['copper_plate', 8]],
};
