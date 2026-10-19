// items.ts — every item of Ysmère. V = reference value (◉), depth = NPC market depth Q
// (items/min, 0 = not tradable). Glyph + colour feed the procedural item art.
import type { ItemDef } from './types';

export const ITEMS = {
  // ── raw (tier 1): ordinary materials — the exotic ones come with the later tiers ──
  iron_ore: { name: { fr: 'Minerai de fer', en: 'Iron Ore' }, tier: 1, kind: 'ore', value: 1.0, depth: 800, glyph: 'pebble', color: '#8f4632' },
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
  // The data items (Survey Data `journal_1`, Mechanics Data `journal_2`, atlases, codices) are gone
  // (D122; owner, 2026-10-17: « on va enlever le principe de la data »): research is paid in AI
  // tokens and resources. A save holding some has them turned into tokens for research
  // (`RETIRED_ITEM_TOKENS`, content/retired.ts).

  // ── tier 2 ────────────────────────────────────────────────────────────────
  gear: { name: { fr: 'Engrenage', en: 'Gear' }, tier: 2, kind: 'part', value: 10, depth: 150, glyph: 'gear', color: '#8d97a8' },
  // A copper plate etched with copper wire and glass at Tier 2's electronics works (D129: 13 ◉ when it
  // was three wires and a glass, a plan's machine).
  circuit: { name: { fr: 'Circuit imprimé', en: 'Circuit Board' }, tier: 2, kind: 'part', value: 17, depth: 120, glyph: 'chip', color: '#3fb8af' },
  ceramic: { name: { fr: 'Céramique', en: 'Ceramic' }, tier: 2, kind: 'material', value: 1.7, depth: 300, glyph: 'tile', color: '#f8dfc6' },
  empty_cell: { name: { fr: 'Batterie vide', en: 'Empty Battery' }, tier: 2, kind: 'part', value: 12, depth: 60, glyph: 'cell', color: '#c9bee6' },
  charged_cell: { name: { fr: 'Batterie chargée', en: 'Charged Battery' }, tier: 2, kind: 'energy', value: 29, depth: 60, glyph: 'cellCharged', color: '#6ff2e4' },
  // The servomotor (D81): the part the advanced machines are built from. Its id is the old speed
  // module's (`pace_bell`), kept so saves and the Crier's history carry over; modules are gone.
  pace_bell: { name: { fr: 'Servomoteur', en: 'Servomotor' }, tier: 2, kind: 'part', value: 86, depth: 8, glyph: 'servo', color: '#f0a04b' },

  // ── tier 3 (uniques + products) ───────────────────────────────────────────
  sporeglass: { name: { fr: 'Verre-spore', en: 'Sporeglass' }, tier: 3, kind: 'unique', value: 15, depth: 20, glyph: 'shard', color: '#b7e3d8' },
  sky_resin: { name: { fr: 'Résine céleste', en: 'Sky Resin' }, tier: 3, kind: 'unique', value: 15, depth: 20, glyph: 'resin', color: '#f0a04b' },
  embersalt: { name: { fr: 'Sel de braise', en: 'Embersalt' }, tier: 3, kind: 'unique', value: 15, depth: 20, glyph: 'ember', color: '#d9533c' },
  lens: { name: { fr: 'Lentille', en: 'Lens' }, tier: 3, kind: 'part', value: 47, depth: 8, glyph: 'lens', color: '#8fd8cf' },
  resin_canvas: { name: { fr: 'Toile de résine', en: 'Resin Canvas' }, tier: 3, kind: 'material', value: 64, depth: 6, glyph: 'canvas', color: '#f2c6a0' },
  thermal_core: { name: { fr: 'Cœur thermique', en: 'Thermal Core' }, tier: 3, kind: 'part', value: 64, depth: 6, glyph: 'core', color: '#c4533c' },
  // Robotics (D81): two servomotors and two circuits make an arm; the Chip Fab is built of them.
  robot_arm: { name: { fr: 'Bras robotisé', en: 'Robot Arm' }, tier: 3, kind: 'part', value: 230, depth: 4, glyph: 'arm', color: '#e0b04a' },

  // ── tier 4 ────────────────────────────────────────────────────────────────
  lumen_moss: { name: { fr: 'Mousse lumen', en: 'Lumen Moss' }, tier: 4, kind: 'unique', value: 40, depth: 6, glyph: 'moss', color: '#7cf5c8' },
  fossil_nacre: { name: { fr: 'Nacre fossile', en: 'Fossil Nacre' }, tier: 4, kind: 'unique', value: 40, depth: 6, glyph: 'nacre', color: '#ede4f5' },
  singing_quartz: { name: { fr: 'Quartz chantant', en: 'Singing Quartz' }, tier: 4, kind: 'unique', value: 40, depth: 6, glyph: 'quartz', color: '#c9bee6' },
  resonator: { name: { fr: 'Résonateur', en: 'Resonator' }, tier: 4, kind: 'part', value: 260, depth: 1.5, glyph: 'resonator', color: '#6f5fa0' },
  nacre_lattice: { name: { fr: 'Treillis de nacre', en: 'Nacre Lattice' }, tier: 4, kind: 'part', value: 252, depth: 1.5, glyph: 'lattice', color: '#e6dcf2' },

  // ── appended (D87): the quartz of the cliff faces, and its oscillator ──────
  // Rock crystal set in a cliff face past the Crown (map 3: a guaranteed vein in the nearest
  // mountain, a parcel away): only the face cutter works it, from the floor beside the wall
  // (`face`). Not the T4 unique « Quartz chantant » (`singing_quartz`): a plain ore, milky white.
  quartz: { name: { fr: 'Quartz', en: 'Quartz' }, tier: 1, kind: 'ore', value: 4.5, depth: 150, glyph: 'crystal', color: '#e6eef0', face: true },
  // A quartz blade on copper leads (the quartz workshop): the clock of the servers, and of the
  // research that asks for it (D122).
  oscillator: { name: { fr: 'Oscillateur à quartz', en: 'Quartz Oscillator' }, tier: 1, kind: 'part', value: 11, depth: 100, glyph: 'oscillator', color: '#b9c3cc' },

  // ── appended (D123): more to make of the basic resources ─────────────────
  // (owner, 2026-10-17: « Il faut rajouter des trucs à faire avec les ressources de base. De
  // l'intérêt à faire fondre le cuivre en plaque de cuivre peut-être… on a vite fait le tour des
  // ressources de base »). Five products of Tier 1's research, each a step past plates, glass and
  // wire, each wanted by the buildings, the Core's levels and the research that come after it:
  //   copper plate — copper ore and coal at the smelter: the metal of what runs on power;
  //   steel        — iron plates and coal at the steel mill: the frame of the heavy machines;
  //   brick        — sand and water at the brickworks: the furnaces' lining, the Core's walls;
  //   pipe         — steel at the press: what carries water and steam;
  //   cable        — copper wire twisted at the wire mill: what carries power far.
  // Values sit a little over their inputs' (V of what goes in, and the machine's time).
  copper_plate: { name: { fr: 'Plaque de cuivre', en: 'Copper Plate' }, tier: 1, kind: 'material', value: 6.0, depth: 200, glyph: 'plate', color: '#d9844a' },
  steel: { name: { fr: 'Acier', en: 'Steel' }, tier: 1, kind: 'material', value: 8.5, depth: 200, glyph: 'ingot', color: '#7f8b9e' },
  brick: { name: { fr: 'Brique', en: 'Brick' }, tier: 1, kind: 'material', value: 1.6, depth: 400, glyph: 'brick', color: '#b9583c' },
  pipe: { name: { fr: 'Tuyau', en: 'Pipe' }, tier: 2, kind: 'part', value: 5.0, depth: 150, glyph: 'pipe', color: '#93a0b2' },
  cable: { name: { fr: 'Câble', en: 'Cable' }, tier: 2, kind: 'part', value: 8.0, depth: 120, glyph: 'cable', color: '#3d3852' },

  // ── appended (D125): the machines' waste ─────────────────────────────────
  // (owner, 2026-10-18: « il faudrait que certaines machines produisent des déchets en alternance
  // avec leur vraie production, qu'il faille traiter »). A smelter's metal recipes, the steel mill's
  // put out a slag every few crafts, the press a scrap, through the same output as their product
  // (`RecipeDef.waste`): the line carries both and the player sorts them. Worth little at the Crier
  // (sold cheap is one way out), or burnt in an incinerator. No machine takes them in (D151; owner,
  // 2026-10-19: « don't use slag or scraps in machines, the point is that it's very useless »): D125's
  // recyclers are gone, and waste is only ever a nuisance to get rid of.
  slag: { name: { fr: 'Scories', en: 'Slag' }, tier: 1, kind: 'waste', value: 0.2, depth: 300, glyph: 'slag', color: '#6b5a4e' },
  scrap: { name: { fr: 'Chutes', en: 'Scrap' }, tier: 1, kind: 'waste', value: 0.6, depth: 200, glyph: 'scrap', color: '#8a8f98' },

  // ── appended (D129): the assembly bench's parts ───────────────────────────
  // (owner, 2026-10-18: « le electronics workshop devrait probablement avoir un style plus avancé…
  // faire autre chose de plus basique au Tier 1 »). Circuits wait for Tier 2's electronics works; the
  // early base winds coils and builds motors on a plain bench instead:
  //   copper coil — two copper wires wound on an iron plate's core: what turns power into motion
  //                 (turbines' windings, the electric smelter's induction, the Core's level 3);
  //   motor       — two coils and a gear in a housing: what drives the drills, the twin mills, the
  //                 excavators, and the servomotor of Tier 2 (a motor and two circuits).
  copper_coil: { name: { fr: 'Bobine de cuivre', en: 'Copper Coil' }, tier: 1, kind: 'part', value: 8.0, depth: 150, glyph: 'bobbin', color: '#c46a34' },
  motor: { name: { fr: 'Moteur électrique', en: 'Electric Motor' }, tier: 1, kind: 'part', value: 30, depth: 60, glyph: 'motor', color: '#5d7286' },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;
