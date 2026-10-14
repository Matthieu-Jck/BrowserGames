// retired.ts — what became of content ids a saved base may still hold (read by
// sim/save-remap.ts, D47). Saves name their content by id: renaming or removing an item, a
// building or a recipe must leave a line here, or a player's base loses what it held — the
// remap then drops it and tells the player.

/** Old id → today's id, per table (an id that exists today is never looked up here). */
export const RENAMED: {
  readonly items: Readonly<Record<string, string>>;
  readonly buildings: Readonly<Record<string, string>>;
  readonly recipes: Readonly<Record<string, string>>;
} = {
  // Survey Data and Mechanics Data became the one Data File (D68): a stock of either carries over item for item.
  items: { journal_1: 'data_file', journal_2: 'data_file' },
  buildings: {},
  recipes: {},
};

/**
 * Research nodes renamed or reshaped by the tiered tree (D69, D70): an old id a save still holds
 * → the node(s) that stand for it today (a node gone without a successor is dropped: it unlocked
 * no building). Plans gained in the same change: holding the old prerequisite grants them.
 */
export const RESEARCH_RENAMED: Readonly<Record<string, readonly string[]>> = {
  en1: ['en_pitch'], en3: ['en_heavyacc'], en6: ['en_solarfarm'], en7: ['en_bigwind'], en8: ['en_cellgen'],
  ex1: ['ex_fastdrill'], ex2: ['ex_sifter'], ex6: ['ex_hppump'], exK: ['ex_giant'],
  dn1: ['xp_swift'], dn2: ['xp_bridges'], dn3: ['dn3', 'dn_compact'], dn5: ['xp_distrib'], dn6: ['xp_express'], dnK: ['dn_chipfab'],
  cm1: ['cm_floor'], cm4: ['cm_plan'], cm5: ['cm_express'], cm6: ['cm_rent'],
  xp1: ['xp_resell'], xp2: ['xp_bigsilo'], xp3: ['xp_treaties'], xp5: ['xp_bigdock'], xp8: ['xp_far'],
  // The research lab's plan now hangs from the data collector's (D68).
  observatory: ['observatory', 'data_collector'],
};

/** Buildings taken out of the game: what each cost ([item id, items]), refunded to the Heart when a save still holds one. */
export const RETIRED_COSTS: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  // The waystation, retired when land became parcels bought and rented (D60, docs/land.md): its
  // base cost back (its growth was never refunded, D36), its store handed to the Heart.
  outpost: [['iron_plate', 150], ['circuit', 30], ['ceramic', 40]],
  // The 3×3 trade post with four inlets and two outlets, before its flame apron (D62): taken down
  // by save v4 (`postsToPads`), refunded, its container handed to the Heart; the claim builds the 5×5 pad.
  trade_post_3x3: [['iron_plate', 40], ['glass', 10], ['copper_wire', 10]],
};
