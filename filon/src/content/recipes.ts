// recipes.ts — all recipes. Quantities in items (fractions allowed: the engine works in
// milli-items). Cycle seconds × 10 ticks must divide 1200 (checked by validate.ts).
import type { RecipeDef } from './types';

const KILNS = ['kiln', 'kiln_compact'] as const;
const WORKSHOPS = ['workshop', 'great_workshop', 'great_workshop_compact', 'tower_workshop'] as const;
const GREAT = ['great_workshop', 'great_workshop_compact', 'tower_workshop'] as const;

export const RECIPES = {
  iron_plate: {
    name: { fr: 'Plaque de fer', en: 'Iron Plate' }, machines: KILNS, seconds: 4,
    ins: [['iron_ore', 1], ['coal', 1]], outs: [['iron_plate', 1]], unlock: 'start', // as much coal as ore (owner, 2026-10-12)
  },
  glass: {
    name: { fr: 'Verre', en: 'Glass' }, machines: KILNS, seconds: 6,
    ins: [['sand', 3], ['coal', 1]], outs: [['glass', 1]], unlock: 'start', // one coal a glass (owner, 2026-10-12)
  },
  copper_wire: {
    name: { fr: 'Fil de cuivre', en: 'Copper Wire' }, machines: ['wire_mill'], seconds: 3,
    ins: [['copper_ore', 1]], outs: [['copper_wire', 2]], unlock: 'start',
  },
  journal_1: {
    name: { fr: 'Données d’arpentage', en: 'Survey Data' }, machines: WORKSHOPS, seconds: 10,
    ins: [['iron_plate', 2], ['glass', 1]], outs: [['journal_1', 1]], unlock: 'start',
  },
  gear: {
    name: { fr: 'Engrenage', en: 'Gear' }, machines: WORKSHOPS, seconds: 5,
    ins: [['iron_plate', 3]], outs: [['gear', 1]], unlock: 'tr1',
  },
  circuit: {
    name: { fr: 'Circuit imprimé', en: 'Circuit Board' }, machines: WORKSHOPS, seconds: 6,
    ins: [['copper_wire', 3], ['glass', 1]], outs: [['circuit', 1]], unlock: 'start',
  },
  ceramic: {
    name: { fr: 'Céramique', en: 'Ceramic' }, machines: ['ceramic_oven'], seconds: 5,
    ins: [['stone', 4], ['water', 10]], outs: [['ceramic', 1]], unlock: 'tr3',
  },
  empty_cell: {
    name: { fr: 'Batterie vide', en: 'Empty Battery' }, machines: GREAT, seconds: 8,
    ins: [['ceramic', 2], ['salt', 1], ['copper_wire', 2]], outs: [['empty_cell', 1]], unlock: 'tr3',
  },
  charged_cell: {
    name: { fr: 'Batterie chargée', en: 'Charged Battery' }, machines: ['cell_charger'], seconds: 120,
    ins: [['empty_cell', 1]], outs: [['charged_cell', 1]], energyKwMin: 600, unlock: 'en4',
  },
  journal_2: {
    name: { fr: 'Données mécaniques', en: 'Mechanics Data' }, machines: GREAT, seconds: 20,
    ins: [['gear', 2], ['circuit', 2], ['ceramic', 1]], outs: [['journal_2', 1]], unlock: 'tr1',
  },
  pace_bell: {
    name: { fr: 'Module de vitesse', en: 'Speed Module' }, machines: GREAT, seconds: 20,
    ins: [['circuit', 4], ['gear', 2]], outs: [['pace_bell', 1]], unlock: 'dn4',
  },
  lens_a: {
    name: { fr: 'Lentille (verre-spore)', en: 'Lens (sporeglass)' }, machines: WORKSHOPS, seconds: 8,
    ins: [['sporeglass', 2], ['glass', 1]], outs: [['lens', 1]], unlock: 'tr6',
  },
  lens_b: {
    name: { fr: 'Lentille (résine)', en: 'Lens (resin)' }, machines: GREAT, seconds: 12,
    ins: [['sky_resin', 3], ['glass', 1], ['salt', 1]], outs: [['lens', 1]], unlock: 'tr6',
  },
  resin_canvas: {
    name: { fr: 'Toile de résine', en: 'Resin Canvas' }, machines: WORKSHOPS, seconds: 8,
    ins: [['sky_resin', 3], ['copper_wire', 1]], outs: [['resin_canvas', 1]], unlock: 'tr6',
  },
  thermal_core: {
    name: { fr: 'Cœur thermique', en: 'Thermal Core' }, machines: GREAT, seconds: 15,
    ins: [['embersalt', 2], ['ceramic', 2], ['circuit', 1]], outs: [['thermal_core', 1]], unlock: 'tr6',
  },
  atlas: {
    name: { fr: 'Atlas', en: 'Atlas' }, machines: GREAT, seconds: 30,
    ins: [['lens', 1], ['thermal_core', 1], ['circuit', 2]], outs: [['atlas', 1]], unlock: 'tr6',
  },
  resonator: {
    name: { fr: 'Résonateur', en: 'Resonator' }, machines: GREAT, seconds: 30,
    ins: [['singing_quartz', 2], ['thermal_core', 1], ['circuit', 2]], outs: [['resonator', 1]], unlock: 'tr8',
  },
  nacre_lattice: {
    name: { fr: 'Treillis de nacre', en: 'Nacre Lattice' }, machines: GREAT, seconds: 20,
    ins: [['fossil_nacre', 3], ['lens', 1]], outs: [['nacre_lattice', 1]], unlock: 'tr8',
  },
  codex: {
    name: { fr: 'Codex', en: 'Codex' }, machines: GREAT, seconds: 60,
    ins: [['resonator', 1], ['nacre_lattice', 1], ['lumen_moss', 4]], outs: [['codex', 1]], unlock: 'tr8',
  },
} as const satisfies Record<string, RecipeDef>;

export type RecipeId = keyof typeof RECIPES;
