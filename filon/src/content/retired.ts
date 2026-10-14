// retired.ts — what became of content ids a saved base may still hold (read by
// sim/save-remap.ts, D47). Saves name their content by id: renaming or removing an item, a
// building or a recipe must leave a line here, or a player's base loses what it held — the
// remap then drops it and tells the player.

/** Old id → today's id, per table (an id that exists today is never looked up here). */
export const RENAMED: {
  readonly items: Readonly<Record<string, string>>;
  readonly buildings: Readonly<Record<string, string>>;
  readonly recipes: Readonly<Record<string, string>>;
} = { items: {}, buildings: {}, recipes: {} };

/** Buildings taken out of the game: what each cost ([item id, items]), refunded to the Heart when a save still holds one. */
export const RETIRED_COSTS: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  // The waystation, retired when land became parcels bought and rented (D60, docs/land.md): its
  // base cost back (its growth was never refunded, D36), its store handed to the Heart.
  outpost: [['iron_plate', 150], ['circuit', 30], ['ceramic', 40]],
  // The 3×3 trade post with four inlets and two outlets, before its flame apron (D62): taken down
  // by save v4 (`postsToPads`), refunded, its container handed to the Heart; the claim builds the 5×5 pad.
  trade_post_3x3: [['iron_plate', 40], ['glass', 10], ['copper_wire', 10]],
  pylon_1x1: [['iron_plate', 8], ['copper_wire', 6], ['ceramic', 2]], // the 1×1 pylon before D75 (save v6: refunded, its wires dropped)
};
