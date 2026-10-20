// orders.ts — CrierBelt's delivery orders (D153, « Commandes de la Criée »), as content: the goods
// CrierBelt asks a claim for, and the building kits it may pay on top. The rules that draw, fill and
// pay an order are in sim/systems/orders.ts; every number that sizes them is in `BAL.orders`.
//
// An order asks only for what the base can make or extract now (D153: never something impossible):
// a made good, when a recipe that makes it and a machine that runs it are both unlocked; a raw good,
// when what extracts it is (`needs`). From `level` on — the Core's level — CrierBelt asks for it at
// all, so the first orders stay on what the tutorial's base has in quantity. `cls` sets its delivery
// window (`BAL.orders.window`, D146's « how long the base can wait »): raw goods and plates 20–40
// minutes, glass 30–60, wire and parts 60–120 — every window outlasts a night.

/** The window's class of a good (D146): how fast a base of that stage can spare it. */
export type OrderClass = 'raw' | 'plate' | 'glass' | 'part';

export interface OrderGood {
  readonly cls: OrderClass;
  /** Draw weight among the goods the base can make (integer). */
  readonly w: number;
  /** The Core's level from which CrierBelt asks for it. */
  readonly level: number;
  /**
   * Tree nodes the base must hold to extract it (a raw good: its extractor's unlock; 'start' for the
   * kit's drill). A made good has none: a recipe making it and a machine running it unlocked suffice.
   */
  readonly needs?: readonly string[];
}

/**
 * What CrierBelt orders, by item id. Copper ore is never asked for (the cirque's vein is tired, D101:
 * a base buys it), nor waste, water or the uniques (no recipe makes them; a far claim's vein).
 */
export const ORDER_GOODS: Readonly<Record<string, OrderGood>> = {
  // ── raw goods (D146: the Core piles quartz, ore and sand up with no use for them) ──
  quartz: { cls: 'raw', w: 4, level: 2, needs: ['ex_quartz'] },
  iron_ore: { cls: 'raw', w: 2, level: 1, needs: ['start'] },
  sand: { cls: 'raw', w: 2, level: 1, needs: ['sand_collector'] },
  coal: { cls: 'raw', w: 1, level: 1, needs: ['start'] },
  // ── plates and Tier 1's materials ──
  iron_plate: { cls: 'plate', w: 4, level: 1 },
  brick: { cls: 'plate', w: 2, level: 2 },
  copper_plate: { cls: 'plate', w: 1, level: 2 },
  ceramic: { cls: 'plate', w: 1, level: 3 },
  glass: { cls: 'glass', w: 4, level: 1 },
  // ── wire and parts ──
  copper_wire: { cls: 'part', w: 1, level: 2 },
  gear: { cls: 'part', w: 2, level: 2 },
  oscillator: { cls: 'part', w: 2, level: 2 },
  copper_coil: { cls: 'part', w: 1, level: 2 },
  steel: { cls: 'part', w: 2, level: 2 },
  motor: { cls: 'part', w: 1, level: 3 },
  pipe: { cls: 'part', w: 1, level: 3 },
  cable: { cls: 'part', w: 1, level: 3 },
  circuit: { cls: 'part', w: 2, level: 3 },
  empty_cell: { cls: 'part', w: 1, level: 3 },
  charged_cell: { cls: 'part', w: 1, level: 4 },
  thermal_core: { cls: 'part', w: 1, level: 4 },
  lens: { cls: 'part', w: 1, level: 4 },
  pace_bell: { cls: 'part', w: 1, level: 4 },
  robot_arm: { cls: 'part', w: 1, level: 5 },
  resonator: { cls: 'part', w: 1, level: 5 },
  nacre_lattice: { cls: 'part', w: 1, level: 5 },
};

/**
 * The building kits an order may pay on top (D153's special rewards): `n` of a building's
 * materials, delivered to the Core with the payment — the kit, not a building placed for the
 * player. The table runs from the first buildings to the late ones; an order draws among the last
 * three whose building the base has unlocked.
 */
export const ORDER_KITS: ReadonlyArray<{ readonly def: string; readonly n: number }> = [
  { def: 'wind_flower', n: 2 },
  { def: 'silo', n: 2 },
  { def: 'pitch_turbine', n: 2 },
  { def: 'fast_drill', n: 2 },
  { def: 'electric_smelter', n: 1 },
  { def: 'solar_farm', n: 1 },
  { def: 'big_silo', n: 1 },
  { def: 'heavy_accumulator', n: 1 },
  { def: 'big_turbine', n: 1 },
];
