// retired.ts — what became of content ids a saved base may still hold (read by
// sim/save-remap.ts, D47). Saves name their content by id: renaming or removing an item, a
// building or a recipe must leave a line here, or a player's base loses what it held — the
// remap then drops it and tells the player.
import type { Loc } from './types';

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
  // The skydock and the Great Skydock, retired with the player's drifters and freight routes (D108,
  // owner 2026-10-17: « retire le skydock du jeu, je n'aime pas ce bâtiment »): refunded, what they
  // held docked handed to the Heart, their outlets' items and wires dropped. Their ids were not
  // reused, so no save step renames them: the remap finds them gone. Their drifters are refunded by
  // the save step (v15 `docksRetired`, persist/migrate.ts) at `RETIRED_DRIFTER`.
  skydock: [['ceramic', 40], ['gear', 20], ['lens', 10]],
  big_dock: [['ceramic', 60], ['gear', 30], ['lens', 15]],
  // The survey beacon (owner, 2026-10-17: « On va supprimer le survey beacon, je n'aime pas ») and the
  // unloader (« le "Unloader" n'est plus nécessaire »), retired by D117: refunded, an unloader's held
  // item handed to the Heart (the remap's rule for a routing block). The fog a beacon lifted stays
  // lifted (`explored` is the save's); their plans are dropped and refunded by save v17 (`PLANS_RETIRED`).
  beacon: [['iron_plate', 5], ['glass', 2]],
  unloader: [['iron_plate', 2], ['copper_wire', 1]],
  // The data's makers (D122; owner, 2026-10-17: « on va enlever le principe de la data… on n'a plus
  // besoin de générer de la data »): refunded at cost; a test bench's buffers go to the Heart (its
  // gears, circuits and oscillators) and the data any of them held turns into tokens for research
  // (`RETIRED_ITEM_TOKENS`); their wires and outlets' items are dropped. Their ids were not reused.
  data_collector: [['iron_plate', 10], ['glass', 4], ['copper_wire', 6]],
  test_bench: [['iron_plate', 20], ['glass', 6], ['copper_wire', 8]],
  data_relay: [['circuit', 10], ['glass', 10], ['iron_plate', 30]],
};

/**
 * What a retired building was called, for the absence report that tells the player it came down
 * (save-remap.ts `RemapNote.removed` holds ids). One not listed shows its id.
 */
export const RETIRED_NAMES: Readonly<Record<string, Loc>> = {
  skydock: { fr: 'Embarcadère', en: 'Skydock' },
  big_dock: { fr: 'Grand embarcadère', en: 'Great Skydock' },
  beacon: { fr: "Balise d'arpentage", en: 'Survey Beacon' },
  unloader: { fr: 'Déchargeur', en: 'Unloader' },
  data_collector: { fr: 'Collecteur de données', en: 'Data Collector' },
  test_bench: { fr: 'Banc d’essai', en: 'Test Bench' },
  data_relay: { fr: 'Relais de données', en: 'Data Relay' },
};

/**
 * The items retired with research's data (D122), and the AI tokens each one held is worth when a
 * save still holds some — in the Core, a store, a lab, on a ribbon, in a buffer or on its way from
 * the Crier: the remap (sim/save-remap.ts) banks them for research (`tokens.bank`, delivered to the
 * projects at each minute's end before any bought flow) instead of losing them, and the absence
 * report says so. Generous on purpose: each at its value at the Crier, in CrierBelt's tokens (10 ◉
 * the thousand) — Survey Data 11 ◉, Mechanics Data 59, an atlas 188, a codex 1 014. Frozen.
 */
export const RETIRED_ITEM_TOKENS: Readonly<Record<string, number>> = { journal_1: 1_100, journal_2: 5_900, atlas: 18_800, codex: 101_400 };

/** What a retired data item was called, for the absence report (the item table no longer names it). */
export const RETIRED_ITEM_NAMES: Readonly<Record<string, Loc>> = {
  journal_1: { fr: 'Données d’arpentage', en: 'Survey Data' },
  journal_2: { fr: 'Données mécaniques', en: 'Mechanics Data' },
  atlas: { fr: 'Atlas', en: 'Atlas' },
  codex: { fr: 'Codex', en: 'Codex' },
};

/** What one drifter cost a skydock (`BAL.drifterCost` until D108), refunded to the Heart for every drifter a save held. */
export const RETIRED_DRIFTER: ReadonlyArray<readonly [string, number]> = [['resin_canvas', 20], ['gear', 10], ['circuit', 5]];

/**
 * Research nodes taken out of the tree with no successor, by the save version whose step drops them
 * (a node learnt is forgotten, a project of it cancelled with its paid data back to the Heart, its
 * queue entry gone). Frozen per version: a later removal adds its own version. 15: the Great Skydock
 * (`xp_bigdock`), whose one unlock, the Great Skydock, went with the skydocks (D108).
 */
/**
 * Research gone with no successor and no save step (D119): Parcel Resale (`xp_resell`), since selling
 * a parcel back needs no research any more. Read at load (sim/serialize.ts): a node learnt is
 * forgotten, a project of it dropped with its paid data back to the Heart. Nothing is lost.
 */
export const RESEARCH_GONE: ReadonlySet<string> = new Set(['xp_resell']);

/**
 * … 19 (D122): the Data Relay (`an_relay`), whose one unlock, the data relay, went with the data.
 */
export const RESEARCH_RETIRED: Readonly<Record<number, readonly string[]>> = { 15: ['xp_bigdock'], 19: ['an_relay'] };

/**
 * The Tier 1 nodes' tokens at D122, frozen for its save step (`dataRetired`): a Tier 1 project under
 * way in a save 18 took no tokens; it now needs these, its paid data counted as delivered.
 */
export const TIER1_TOKENS_V19: Readonly<Record<string, number>> = {
  tr1: 2_000, en_pitch: 2_000, ex_fastdrill: 2_000, dn3: 2_000, cm_post2: 2_000, an_data: 2_000, xp_swift: 2_000,
  en2: 5_000, dn_esmelt: 5_000, dn_wiremill: 5_000, cm_floor: 5_000, xp_bigsilo: 5_000, xp_guard: 5_000, tr_synth: 10_000,
};

/**
 * Plans taken out of the tree, by the save version whose step drops them, with what each cost: a
 * plan held is forgotten and its cost handed back to the Heart (nothing vanishes: it was paid in
 * materials, D33). Frozen per version. 17: the survey beacon's and the unloader's (D117), the survey
 * path with the first (the Face Cutter moved to Production, its id unchanged).
 */
export const PLANS_RETIRED: Readonly<Record<number, Readonly<Record<string, ReadonlyArray<readonly [string, number]>>>>> = {
  17: { beacon: [['iron_plate', 8], ['glass', 2]], unloader: [['iron_plate', 6], ['copper_wire', 2]] },
};

/**
 * The Tier 1 research nodes in saves 1–17, frozen (D118's step: a project of one of them under way
 * drops its tokens and its time — Tier 1 is data alone now — and finishes once its data is paid).
 */
export const TIER1_V17: readonly string[] = ['tr1', 'tr_synth', 'en_pitch', 'en2', 'ex_fastdrill', 'dn3', 'dn_esmelt', 'dn_wiremill', 'cm_post2', 'cm_floor', 'an_data', 'an_relay', 'xp_swift', 'xp_bigsilo', 'xp_guard'];

/** The fog round the Core by its level 1..4 in saves 1–16, frozen (`BAL.coreReveal` since D117; before, the founding's 44 at every level). */
export const CORE_REVEAL_V17: readonly number[] = [44, 56, 68, 80];
