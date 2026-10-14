// items.ts — every item of Ysmère. V = reference value (◉), depth = NPC market depth Q
// (items/min, 0 = not tradable). Glyph + colour feed the procedural item art.
import type { ItemDef } from './types';

export const ITEMS = {
  // ── raw (tier 1): ordinary materials — the exotic ones come with the later tiers ──
  iron_ore: { name: { fr: 'Minerai de fer', en: 'Iron Ore' }, tier: 1, kind: 'ore', value: 1.0, depth: 800, glyph: 'pebble', color: '#9b5a3c' },
  sand: { name: { fr: 'Sable', en: 'Sand' }, tier: 1, kind: 'ore', value: 1.0, depth: 400, glyph: 'grain', color: '#eadcc4' },
  coal: { name: { fr: 'Charbon', en: 'Coal' }, tier: 1, kind: 'fuel', value: 1.2, depth: 300, glyph: 'coal', color: '#34303f' },
  copper_ore: { name: { fr: 'Minerai de cuivre', en: 'Copper Ore' }, tier: 1, kind: 'ore', value: 4.0, depth: 150, glyph: 'copper', color: '#c8743a' },
  stone: { name: { fr: 'Pierre', en: 'Stone' }, tier: 1, kind: 'rubble', value: 0.3, depth: 1000, glyph: 'rubble', color: '#b8afa3' },
  water: { name: { fr: 'Eau', en: 'Water' }, tier: 1, kind: 'fluid', value: 0, depth: 0, glyph: 'drop', color: '#8fd8cf' },
  salt: { name: { fr: 'Sel', en: 'Salt' }, tier: 2, kind: 'ore', value: 2.0, depth: 150, glyph: 'salt', color: '#f6ede2' },

  // ── tier 1 products ───────────────────────────────────────────────────────
  iron_plate: { name: { fr: 'Plaque de fer', en: 'Iron Plate' }, tier: 1, kind: 'material', value: 2.7, depth: 600, glyph: 'plate', color: '#a7b0bf' },
  glass: { name: { fr: 'Verre', en: 'Glass' }, tier: 1, kind: 'material', value: 4.1, depth: 200, glyph: 'pane', color: '#a9e3dc' },
  copper_wire: { name: { fr: 'Fil de cuivre', en: 'Copper Wire' }, tier: 1, kind: 'material', value: 2.2, depth: 300, glyph: 'coil', color: '#c8743a' },
  // Research's one data item (D68): made by data collectors out of power alone, or by the Heart
  // with the Analytics research; never traded (depth 0) — research is paid in data and tokens.
  journal_1: { name: { fr: 'Données d’arpentage', en: 'Survey Data' }, tier: 1, kind: 'science', value: 11, depth: 40, glyph: 'journal', color: '#f2c6a0' },
  journal_2: { name: { fr: 'Données mécaniques', en: 'Mechanics Data' }, tier: 2, kind: 'science', value: 59, depth: 15, glyph: 'journal2', color: '#9d8cc9' },

  // ── tier 2 ────────────────────────────────────────────────────────────────
  gear: { name: { fr: 'Engrenage', en: 'Gear' }, tier: 2, kind: 'part', value: 10, depth: 150, glyph: 'gear', color: '#8d97a8' },
  circuit: { name: { fr: 'Circuit imprimé', en: 'Circuit Board' }, tier: 2, kind: 'part', value: 13, depth: 120, glyph: 'chip', color: '#3fb8af' },
  ceramic: { name: { fr: 'Céramique', en: 'Ceramic' }, tier: 2, kind: 'material', value: 1.7, depth: 300, glyph: 'tile', color: '#f8dfc6' },
  empty_cell: { name: { fr: 'Batterie vide', en: 'Empty Battery' }, tier: 2, kind: 'part', value: 12, depth: 60, glyph: 'cell', color: '#c9bee6' },
  charged_cell: { name: { fr: 'Batterie chargée', en: 'Charged Battery' }, tier: 2, kind: 'energy', value: 29, depth: 60, glyph: 'cellCharged', color: '#6ff2e4' },
  pace_bell: { name: { fr: 'Module de vitesse', en: 'Speed Module' }, tier: 2, kind: 'module', value: 86, depth: 3, glyph: 'module', color: '#f0a04b' },

  // ── tier 3 (uniques + products) ───────────────────────────────────────────
  sporeglass: { name: { fr: 'Verre-spore', en: 'Sporeglass' }, tier: 3, kind: 'unique', value: 15, depth: 20, glyph: 'shard', color: '#b7e3d8' },
  sky_resin: { name: { fr: 'Résine céleste', en: 'Sky Resin' }, tier: 3, kind: 'unique', value: 15, depth: 20, glyph: 'resin', color: '#f0a04b' },
  embersalt: { name: { fr: 'Sel de braise', en: 'Embersalt' }, tier: 3, kind: 'unique', value: 15, depth: 20, glyph: 'ember', color: '#d9533c' },
  lens: { name: { fr: 'Lentille', en: 'Lens' }, tier: 3, kind: 'part', value: 47, depth: 8, glyph: 'lens', color: '#8fd8cf' },
  resin_canvas: { name: { fr: 'Toile de résine', en: 'Resin Canvas' }, tier: 3, kind: 'material', value: 64, depth: 6, glyph: 'canvas', color: '#f2c6a0' },
  thermal_core: { name: { fr: 'Cœur thermique', en: 'Thermal Core' }, tier: 3, kind: 'part', value: 64, depth: 6, glyph: 'core', color: '#c4533c' },
  atlas: { name: { fr: 'Atlas', en: 'Atlas' }, tier: 3, kind: 'science', value: 188, depth: 4, glyph: 'atlas', color: '#2a8c85' },

  // ── tier 4 ────────────────────────────────────────────────────────────────
  lumen_moss: { name: { fr: 'Mousse lumen', en: 'Lumen Moss' }, tier: 4, kind: 'unique', value: 40, depth: 6, glyph: 'moss', color: '#7cf5c8' },
  fossil_nacre: { name: { fr: 'Nacre fossile', en: 'Fossil Nacre' }, tier: 4, kind: 'unique', value: 40, depth: 6, glyph: 'nacre', color: '#ede4f5' },
  singing_quartz: { name: { fr: 'Quartz chantant', en: 'Singing Quartz' }, tier: 4, kind: 'unique', value: 40, depth: 6, glyph: 'quartz', color: '#c9bee6' },
  resonator: { name: { fr: 'Résonateur', en: 'Resonator' }, tier: 4, kind: 'part', value: 260, depth: 1.5, glyph: 'resonator', color: '#6f5fa0' },
  nacre_lattice: { name: { fr: 'Treillis de nacre', en: 'Nacre Lattice' }, tier: 4, kind: 'part', value: 252, depth: 1.5, glyph: 'lattice', color: '#e6dcf2' },
  codex: { name: { fr: 'Codex', en: 'Codex' }, tier: 4, kind: 'science', value: 1014, depth: 0.5, glyph: 'codex', color: '#3a3550' },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;
