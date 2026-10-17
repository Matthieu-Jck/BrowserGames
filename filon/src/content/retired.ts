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
  items: {},
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

/**
 * The research nodes of Tier 2 and beyond in saves 1–10, frozen: the tree may change, these may
 * not. The 10 → 11 step (`expertiseArc`, persist/migrate.ts) grants the Synthesis to a claim holding
 * one, and `tierTwoOpen` (sim/systems/expertise.ts) keeps Tier 2 open for it — a node moved into
 * Tier 2 later (the Sifter and the Standing Orders, D107) opens nothing.
 */
export const TIER2_UP_V10: ReadonlySet<string> = new Set([
  'tr2', 'tr3', 'tr4', 'tr5', 'tr6', 'tr7', 'tr8', 'en_heavyacc', 'en4', 'en_solarfarm', 'en_bigwind', 'en_tower', 'en5', 'en_cellgen', 'enK',
  'ex3', 'ex4', 'ex_fastdrill', 'ex5', 'ex_hppump', 'ex_giant', 'ex7', 'ex_heavyexc', 'ex8', 'dn4', 'dn_compact', 'dn_etcher', 'dn7', 'dn_chipfab',
  'dn_forge', 'dn_arc', 'dn8', 'cm3', 'cm_plan', 'cm8', 'cm_express', 'cm_rent', 'cmK', 'an_servers', 'an_queue', 'an_cooled', 'an_slot', 'an_super',
  'an_mining', 'an_forecast', 'an_autolab', 'xp_bridges', 'xp4', 'xp_distrib', 'xp_express', 'xp_bigdock', 'xp_resell', 'xp_treaties', 'xp_far',
]);

/** Buildings taken out of the game: what each cost ([item id, items]), refunded to the Heart when a save still holds one. */
export const RETIRED_COSTS: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  // The waystation, retired when land became parcels bought and rented (D60, docs/land.md): its
  // base cost back (its growth was never refunded, D36), its store handed to the Heart.
  outpost: [['iron_plate', 150], ['circuit', 30], ['ceramic', 40]],
  // The 3×3 trade post with four inlets and two outlets, before its flame apron (D62): taken down
  // by save v4 (`postsToPads`), refunded, its container handed to the Heart; the claim builds the 5×5 pad.
  trade_post_3x3: [['iron_plate', 40], ['glass', 10], ['copper_wire', 10]],
  pylon_1x1: [['iron_plate', 8], ['copper_wire', 6], ['ceramic', 2]], // the 1×1 pylon before D75 (save v6: refunded, its wires dropped)
  // The 2×2 research lab before D84 (save v10): refunded, its files and its project's paid data handed to the Heart, its wires dropped.
  observatory_2x2: [['iron_plate', 30], ['glass', 20], ['copper_wire', 10]],
};
