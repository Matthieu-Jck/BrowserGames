// recipes.ts — all recipes. Quantities in items (fractions allowed: the engine works in
// milli-items). Cycle seconds × 10 ticks must divide 1200 (checked by validate.ts).
//
// Machines are specialised (owner, 2026-10-14, D70: "never more than 3 choices"): each family of
// machines makes one kind of thing, and no machine offers more than `MAX_RECIPES` recipes
// (validate.ts checks it). Upgraded machines of the research tree run a family's recipes faster
// (`BuildingDef.speed`), they add no recipe of their own.
import type { RecipeDef } from './types';

/** No machine offers more recipes than this (D70). */
export const MAX_RECIPES = 3;

const KILNS = ['kiln', 'kiln_compact'] as const;
/** The arc furnace: plates and glass from power, without coal (Mechanics, D70). */
const ARC = ['arc_furnace'] as const;
const WIRE = ['wire_mill', 'wire_mill_double'] as const;
/** Gears: the press and its forging press. */
const PRESSES = ['press', 'forge_press'] as const;
/** Circuits and speed modules: the electronics workshop, the etcher, the chip fab. */
const ELECTRONICS = ['workshop', 'etcher', 'chip_fab'] as const;
/** Batteries, thermal cores, resonators: the assembly workshop, compact and tower. */
const ASSEMBLY = ['great_workshop', 'great_workshop_compact', 'tower_workshop'] as const;
/** Lenses and nacre lattices. */
const OPTICS = ['optics_workshop'] as const;
/** Mechanics Data: the base load-tests its own parts and records the results (D71). */
const TEST = ['test_bench'] as const;
/** Resin canvas, atlases and codices: the works Verrière's scholars pay most for. */
const SCRIPTORIUM = ['scriptorium'] as const;

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
    name: { fr: 'Fil de cuivre', en: 'Copper Wire' }, machines: WIRE, seconds: 3,
    ins: [['copper_ore', 1]], outs: [['copper_wire', 2]], unlock: 'start',
  },
  gear: {
    name: { fr: 'Engrenage', en: 'Gear' }, machines: PRESSES, seconds: 5,
    ins: [['iron_plate', 3]], outs: [['gear', 1]], unlock: 'tr1',
  },
  journal_2: {
    // No ceramic (unlike before D68): Tier 2 research needs it, and ceramic is a Tier 2 unlock.
    name: { fr: 'Données mécaniques', en: 'Mechanics Data' }, machines: TEST, seconds: 20,
    ins: [['gear', 2], ['circuit', 2]], outs: [['journal_2', 1]], unlock: 'tr1',
  },
  circuit: {
    name: { fr: 'Circuit imprimé', en: 'Circuit Board' }, machines: ELECTRONICS, seconds: 6,
    ins: [['copper_wire', 3], ['glass', 1]], outs: [['circuit', 1]], unlock: 'start',
  },
  ceramic: {
    name: { fr: 'Céramique', en: 'Ceramic' }, machines: ['ceramic_oven'], seconds: 5,
    ins: [['stone', 4], ['water', 10]], outs: [['ceramic', 1]], unlock: 'tr3',
  },
  empty_cell: {
    name: { fr: 'Batterie vide', en: 'Empty Battery' }, machines: ASSEMBLY, seconds: 8,
    ins: [['ceramic', 2], ['salt', 1], ['copper_wire', 2]], outs: [['empty_cell', 1]], unlock: 'tr3',
  },
  charged_cell: {
    name: { fr: 'Batterie chargée', en: 'Charged Battery' }, machines: ['cell_charger'], seconds: 120,
    ins: [['empty_cell', 1]], outs: [['charged_cell', 1]], energyKwMin: 600, unlock: 'en4',
  },
  pace_bell: {
    name: { fr: 'Module de vitesse', en: 'Speed Module' }, machines: ELECTRONICS, seconds: 20,
    ins: [['circuit', 4], ['gear', 2]], outs: [['pace_bell', 1]], unlock: 'dn4',
  },
  lens_a: {
    name: { fr: 'Lentille (verre-spore)', en: 'Lens (sporeglass)' }, machines: OPTICS, seconds: 8,
    ins: [['sporeglass', 2], ['glass', 1]], outs: [['lens', 1]], unlock: 'tr6',
  },
  lens_b: {
    name: { fr: 'Lentille (résine)', en: 'Lens (resin)' }, machines: OPTICS, seconds: 12,
    ins: [['sky_resin', 3], ['glass', 1], ['salt', 1]], outs: [['lens', 1]], unlock: 'tr6',
  },
  resin_canvas: {
    name: { fr: 'Toile de résine', en: 'Resin Canvas' }, machines: SCRIPTORIUM, seconds: 8,
    ins: [['sky_resin', 3], ['copper_wire', 1]], outs: [['resin_canvas', 1]], unlock: 'tr6',
  },
  thermal_core: {
    name: { fr: 'Cœur thermique', en: 'Thermal Core' }, machines: ASSEMBLY, seconds: 15,
    ins: [['embersalt', 2], ['ceramic', 2], ['circuit', 1]], outs: [['thermal_core', 1]], unlock: 'tr6',
  },
  atlas: {
    name: { fr: 'Atlas', en: 'Atlas' }, machines: SCRIPTORIUM, seconds: 30,
    ins: [['lens', 1], ['thermal_core', 1], ['circuit', 2]], outs: [['atlas', 1]], unlock: 'tr6',
  },
  resonator: {
    name: { fr: 'Résonateur', en: 'Resonator' }, machines: ASSEMBLY, seconds: 30,
    ins: [['singing_quartz', 2], ['thermal_core', 1], ['circuit', 2]], outs: [['resonator', 1]], unlock: 'tr8',
  },
  nacre_lattice: {
    name: { fr: 'Treillis de nacre', en: 'Nacre Lattice' }, machines: OPTICS, seconds: 20,
    ins: [['fossil_nacre', 3], ['lens', 1]], outs: [['nacre_lattice', 1]], unlock: 'tr8',
  },
  codex: {
    name: { fr: 'Codex', en: 'Codex' }, machines: SCRIPTORIUM, seconds: 60,
    ins: [['resonator', 1], ['nacre_lattice', 1], ['lumen_moss', 4]], outs: [['codex', 1]], unlock: 'tr8',
  },
  // ── appended (D70): the sifter and the arc furnace ─────────────────────────
  // The sifter sorts the stone excavators bring up: sand, or the odd ore it hides.
  sift_sand: {
    name: { fr: 'Sable tamisé', en: 'Sifted Sand' }, machines: ['sifter'], seconds: 2,
    ins: [['stone', 1]], outs: [['sand', 1]], unlock: 'ex_sifter',
  },
  sift_iron: {
    name: { fr: 'Fer tamisé', en: 'Sifted Iron' }, machines: ['sifter'], seconds: 4,
    ins: [['stone', 4]], outs: [['iron_ore', 1]], unlock: 'ex_sifter',
  },
  sift_copper: {
    name: { fr: 'Cuivre tamisé', en: 'Sifted Copper' }, machines: ['sifter'], seconds: 6,
    ins: [['stone', 8]], outs: [['copper_ore', 1]], unlock: 'ex_sifter',
  },
  // The arc furnace melts with power where the smelter burns coal.
  arc_plate: {
    name: { fr: 'Plaque de fer (arc)', en: 'Iron Plate (arc)' }, machines: ARC, seconds: 4,
    ins: [['iron_ore', 1]], outs: [['iron_plate', 1]], unlock: 'dn_arc',
  },
  arc_glass: {
    name: { fr: 'Verre (arc)', en: 'Glass (arc)' }, machines: ARC, seconds: 6,
    ins: [['sand', 3]], outs: [['glass', 1]], unlock: 'dn_arc',
  },
} as const satisfies Record<string, RecipeDef>;

export type RecipeId = keyof typeof RECIPES;
