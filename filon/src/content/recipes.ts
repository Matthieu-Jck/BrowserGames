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

/** Iron plates, glass and copper plates (D123) on coal: the smelter and the compact smelter. */
const KILNS = ['kiln', 'kiln_compact'] as const;
/**
 * Plates, glass and copper plates (D123) from power, without coal: the electric smelter at the smelter's pace (Tier 1,
 * D106), the arc furnace twice as fast (Mechanics, D70).
 */
const ARC = ['electric_smelter', 'arc_furnace'] as const;
/** Copper wire, and cable twisted of it (D123): the wire mill and the twin wire mill. */
const WIRE = ['wire_mill', 'wire_mill_double'] as const;
/** Gears, and pipes from steel (D123): the press and its forging press. */
const PRESSES = ['press', 'forge_press'] as const;
/**
 * Circuits, servomotors and robot arms (D81): the electronics workshop (Tier 2's research since D129,
 * a plan before), the etcher, the chip fab.
 */
const ELECTRONICS = ['workshop', 'etcher', 'chip_fab'] as const;
/** Copper coils and motors (D129): the assembly bench, Tier 1's plain workbench. */
const BENCH = ['assembly_bench'] as const;
/** Batteries, thermal cores, resonators: the assembly workshop, compact and tower. */
const ASSEMBLY = ['great_workshop', 'great_workshop_compact', 'tower_workshop'] as const;
/** Lenses and nacre lattices. */
const OPTICS = ['optics_workshop'] as const;
/** Resin canvas (the atlases and codices it compiled went with the data, D122). */
const SCRIPTORIUM = ['scriptorium'] as const;

/**
 * The waste of smelting metal (D125): a slag every so many crafts, through the same output as the
 * plate. Glass melts clean. Iron is the tutorial's first smelter's, so the gentlest: one slag every
 * ten plates (a minute's at the smelter's pace, D97); copper's ore is dirtier, one every five.
 * Each `every` divides the crafts a minute of the machines that run it (10 at the smelter's pace,
 * 20 in the arc furnace) and the base's beat of ten a minute (what a smelter sends down a line), so
 * a steady line still repeats within a few minutes and the catch-up stays exact (validate.ts, D125).
 */
const SLAG_IRON = ['slag', 10] as const;
const SLAG_COPPER = ['slag', 5] as const;

export const RECIPES = {
  iron_plate: {
    // 6 s: 10 ore and 10 coal a minute, what one cirque iron drill (11–18/min) and its coal drill
    // (~10/min) give — one smelter fed by one drill pair (D97; owner, 2026-10-16: it drew too much iron).
    name: { fr: 'Plaque de fer', en: 'Iron Plate' }, machines: KILNS, seconds: 6,
    ins: [['iron_ore', 1], ['coal', 1]], outs: [['iron_plate', 1]], unlock: 'start', // as much coal as ore (owner, 2026-10-12)
    // D125: a slag every ten plates — a minute's, gentle for the first smelter of the tutorial.
    waste: SLAG_IRON,
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
    // D125: the offcuts of the stamping, a scrap every two gears (a scrap for six plates stamped).
    // Two, not more: it must divide both the press's 12 a minute and the 10 a minute of the smelters
    // that feed it (a press fed by k smelters makes 10k gears in three minutes), so the line still
    // repeats within three minutes and the catch-up stays exact (validate.ts).
    waste: ['scrap', 2],
  },
  circuit: {
    // D129: a copper plate for the board, two copper wires for its traces and a glass for its
    // laminate, at Tier 2's electronics works (three wires and a glass at a plan's workshop before).
    // 6 s: 10 copper plates a minute (one smelter on copper), 20 wires (half a wire mill), 10 glass.
    name: { fr: 'Circuit imprimé', en: 'Circuit Board' }, machines: ELECTRONICS, seconds: 6,
    ins: [['copper_plate', 1], ['copper_wire', 2], ['glass', 1]], outs: [['circuit', 1]], unlock: 'workshop',
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
    // D129: Tier 1's motor and two circuits to steer it (four circuits and two gears before).
    name: { fr: 'Servomoteur', en: 'Servomotor' }, machines: ELECTRONICS, seconds: 20,
    ins: [['motor', 1], ['circuit', 2]], outs: [['pace_bell', 1]], unlock: 'dn4',
  },
  robot_arm: {
    name: { fr: 'Bras robotisé', en: 'Robot Arm' }, machines: ELECTRONICS, seconds: 30,
    ins: [['pace_bell', 2], ['circuit', 2]], outs: [['robot_arm', 1]], unlock: 'dn7',
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
  resonator: {
    name: { fr: 'Résonateur', en: 'Resonator' }, machines: ASSEMBLY, seconds: 30,
    ins: [['singing_quartz', 2], ['thermal_core', 1], ['circuit', 2]], outs: [['resonator', 1]], unlock: 'tr8',
  },
  nacre_lattice: {
    name: { fr: 'Treillis de nacre', en: 'Nacre Lattice' }, machines: OPTICS, seconds: 20,
    ins: [['fossil_nacre', 3], ['lens', 1]], outs: [['nacre_lattice', 1]], unlock: 'tr8',
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
  // The electric smelter and the arc furnace melt with power where the smelter burns coal (D106).
  // The ids are the arc furnace's (saves carry them); the names say what differs from the coal
  // recipes. The coal smelter's pace, 6 s (D97): 10 a minute in the electric smelter, 20 in the
  // arc furnace (speed 2000); both unlocked with the electric smelter, the first of the two.
  arc_plate: {
    name: { fr: 'Plaque de fer (électrique)', en: 'Iron Plate (electric)' }, machines: ARC, seconds: 6,
    ins: [['iron_ore', 1]], outs: [['iron_plate', 1]], unlock: 'dn_esmelt',
    waste: SLAG_IRON,
  },
  arc_glass: {
    name: { fr: 'Verre (électrique)', en: 'Glass (electric)' }, machines: ARC, seconds: 6,
    ins: [['sand', 3]], outs: [['glass', 1]], unlock: 'dn_esmelt',
  },
  // ── appended (D87): the quartz workshop's one recipe ──────────────────────
  // A blade cut from the face cutter's quartz, mounted on two copper leads: what the servers and
  // some research need (D122). Its one machine has no other recipe: it starts on it (D83). Both are
  // the Quartz Workshop's own research node since D128 (`dn_quartzshop`; the Face Cutter's plan before).
  oscillator: {
    name: { fr: 'Oscillateur à quartz', en: 'Quartz Oscillator' }, machines: ['quartz_workshop'], seconds: 6,
    ins: [['quartz', 1], ['copper_wire', 2]], outs: [['oscillator', 1]], unlock: 'dn_quartzshop',
  },
  // ── appended (D123): more to make of the basic resources ─────────────────
  // Copper smelts like iron, a copper ore and a coal a plate, at the smelters' pace (their third
  // recipe) — or on power in the electric smelter and the arc furnace (theirs). Copper plates are
  // the metal of what runs on power; the wire mill's wire stays what circuits are etched from.
  copper_plate: {
    name: { fr: 'Plaque de cuivre', en: 'Copper Plate' }, machines: KILNS, seconds: 6,
    ins: [['copper_ore', 1], ['coal', 1]], outs: [['copper_plate', 1]], unlock: 'dn_copper',
    waste: SLAG_COPPER,
  },
  arc_copper: {
    name: { fr: 'Plaque de cuivre (électrique)', en: 'Copper Plate (electric)' }, machines: ARC, seconds: 6,
    ins: [['copper_ore', 1]], outs: [['copper_plate', 1]], unlock: 'dn_esmelt',
    waste: SLAG_COPPER,
  },
  // Steel: two iron plates and a coal, blown in the steel mill. 12 s: 10 plates a minute in, what one
  // smelter gives — one smelter feeds one mill (as one drill pair feeds one smelter, D97).
  steel: {
    name: { fr: 'Acier', en: 'Steel' }, machines: ['steel_mill'], seconds: 12,
    ins: [['iron_plate', 2], ['coal', 1]], outs: [['steel', 1]], unlock: 'dn_steel',
    // D125: the converter's slag, one every five steels (a minute's at the mill's pace).
    waste: ['slag', 5],
  },
  // Bricks: wet sand pressed and baked, a sand and two waters a brick. 4 s: 15 sand a minute, one
  // sand collector's, and 30 water, half a pump's — the second use of water in Tier 1 (D114).
  brick: {
    name: { fr: 'Brique', en: 'Brick' }, machines: ['brickworks'], seconds: 4,
    ins: [['sand', 1], ['water', 2]], outs: [['brick', 1]], unlock: 'ex_brick',
  },
  // Pipes: a steel bar rolled into two lengths of tube at the press, its second recipe. 12 s: one
  // steel mill's 5 steel a minute make 10 pipes.
  pipe: {
    name: { fr: 'Tuyau', en: 'Pipe' }, machines: PRESSES, seconds: 12,
    ins: [['steel', 1]], outs: [['pipe', 2]], unlock: 'dn_steel',
    // D125: a scrap every five crafts (ten pipes): one a minute at the press's pace.
    waste: ['scrap', 5],
  },
  // Cable: three copper wires twisted and sheathed at the wire mill, its second recipe. 6 s: 30
  // wires a minute, three quarters of a wire mill's 40.
  cable: {
    name: { fr: 'Câble', en: 'Cable' }, machines: WIRE, seconds: 6,
    ins: [['copper_wire', 3]], outs: [['cable', 1]], unlock: 'dn_wiremill',
  },
  // ── appended (D125): the waste recycled ──────────────────────────────────
  // Slag crushed and bound with water into bricks at the brickworks, its second recipe: two slag and
  // a water a brick, at the sand brick's pace — free waste saves the sand, and a sorted slag line
  // has somewhere useful to go.
  slag_brick: {
    name: { fr: 'Brique de scories', en: 'Slag Brick' }, machines: ['brickworks'], seconds: 4,
    ins: [['slag', 2], ['water', 1]], outs: [['brick', 1]], unlock: 'ex_brick',
  },
  // Scrap melted back into steel at the steel mill, its second recipe: three scraps and a coal a
  // steel, at the mill's pace; it is still smelting, so it still gives the converter's slag.
  steel_scrap: {
    name: { fr: 'Acier de récupération', en: 'Recycled Steel' }, machines: ['steel_mill'], seconds: 12,
    ins: [['scrap', 3], ['coal', 1]], outs: [['steel', 1]], unlock: 'dn_steel', waste: ['slag', 5],
  },
  // ── appended (D129): the assembly bench ───────────────────────────────────
  // Copper wire wound on an iron plate's core, at the bench from its plan: two wires and a plate a
  // coil, 6 s — 20 wires a minute (half a wire mill: more than the cirque's tired vein gives, so the
  // starter contract still matters) and one smelter's 10 plates.
  copper_coil: {
    name: { fr: 'Bobine de cuivre', en: 'Copper Coil' }, machines: BENCH, seconds: 6,
    ins: [['copper_wire', 2], ['iron_plate', 1]], outs: [['copper_coil', 1]], unlock: 'assembly_bench',
  },
  // Two coils and a gear in a housing, once Mechanics' press makes gears: 12 s, so one bench on coils
  // (10 a minute) feeds one on motors, with a press's gear every 12 s.
  motor: {
    name: { fr: 'Moteur électrique', en: 'Electric Motor' }, machines: BENCH, seconds: 12,
    ins: [['copper_coil', 2], ['gear', 1]], outs: [['motor', 1]], unlock: 'tr1',
  },
} as const satisfies Record<string, RecipeDef>;

/** Every item a recipe puts out: its products, then its waste (D125). */
export const recipeMakes = (r: RecipeDef): string[] => [...r.outs.map(([o]) => o), ...(r.waste ? [r.waste[0]] : [])];

export type RecipeId = keyof typeof RECIPES;
