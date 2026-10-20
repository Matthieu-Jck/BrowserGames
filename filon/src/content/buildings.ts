// buildings.ts — every building. Footprint w×h and ports are given for rot 0 (front = N);
// the engine rotates them. kw = draw while working, idleKw = draw while idle. replaceGroup =
// what it may be placed over (buildings of the same group wholly inside its footprint).
import type { BuildingDef, BuildingKind, PortDef } from './types';

const P = (x: number, y: number, side: PortDef['side'], io: PortDef['io']): PortDef => ({ x, y, side, io });
/** A water port (D142): a pump's outlet, a water drinker's water entrance — pipework where a conduit couples on. */
const PW = (x: number, y: number, side: PortDef['side'], io: PortDef['io']): PortDef => ({ x, y, side, io, fluid: true });

export const BUILDINGS = {
  // ── colony ────────────────────────────────────────────────────────────────
  hearth: {
    name: { fr: 'Cœur', en: 'Core' },
    desc: { fr: 'Le cœur de ta base : il reçoit sans jamais rendre son stock, qui paie tes constructions. Son noyau isotopique donne l’essentiel de son électricité, jour et nuit, son panneau solaire un peu plus en plein soleil, et les deux grandissent à chaque niveau ; il tend 6 fils jusqu’à 8 tuiles et, dès son niveau 2, sa baie de calcul donne des tokens d’IA à tes recherches.', en: 'The heart of your base: it takes and never gives back its stock, which pays for your construction. Its isotope reactor gives most of its power, day and night, its solar panel a little more in full sun, and both grow with each level; it holds 6 wires up to 8 tiles long and, from its level 2, its compute bay gives AI tokens to your research.' },
    kind: 'hearth', category: 'colony', w: 5, h: 5, needsZone: false, cost: [], unlock: 'never',
    ports: [
      // Inputs only: the Heart takes, it never gives (owner, 2026-10-12) — machines are fed by
      // production lines, the Heart pays for construction and sells next to a trade post.
      P(1, 0, 'N', 'in'), P(2, 0, 'N', 'in'), P(3, 0, 'N', 'in'),
      P(1, 4, 'S', 'in'), P(2, 4, 'S', 'in'), P(3, 4, 'S', 'in'),
      P(4, 1, 'E', 'in'), P(4, 2, 'E', 'in'), P(4, 3, 'E', 'in'),
      P(0, 1, 'W', 'in'), P(0, 2, 'W', 'in'), P(0, 3, 'W', 'in'), // three a side, all round (owner, 2026-10-12)
      // Its data outlet (D68, D86) went with the data (D122): the Core gives nothing at all now. Its
      // south-east corner mounts the compute bay at level 2 instead, whose tokens reach research
      // without a ribbon (`BAL.coreCompute`).
    ],
    // gen.kw: the built-in solar panel's peak (BAL.hearthSolarKw and hearthCoreKw win, by level: D25, D101). A link point of 6 wires.
    gen: { kw: 240 }, pole: { range: 8, slots: 6, climb: 1 }, storageCap: 5000,
  },

  // ── extraction ────────────────────────────────────────────────────────────
  drill: {
    name: { fr: 'Foreuse', en: 'Drill' },
    desc: { fr: 'Extrait le gisement sous elle (fer, charbon, cuivre, sel) : jusqu’à 20/min selon la richesse des tuiles couvertes. La production sort à l’avant, sur un ruban.', en: 'Mines the deposit beneath it (iron, coal, copper, salt): up to 20/min, depending on how rich the covered tiles are. Its output leaves at the front, onto a ribbon.' },
    kind: 'drill', replaceGroup: 'drill', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'start', kw: 90, idleKw: 9,
    cost: [['iron_plate', 10], ['glass', 2]], ports: [P(0, 0, 'N', 'out')], drill: { perMin: 20 },
  },
  deep_bore: {
    name: { fr: 'Foreuse profonde', en: 'Deep Bore' },
    desc: { fr: 'Une foreuse 3×3 : jusqu’à 45/min, et chaque tuile de gisement rend 1,5× son plafond. Se pose par-dessus une foreuse, qu’elle remplace.', en: 'A 3×3 drill: up to 45/min, and each deposit tile yields 1.5× its cap. Can be placed over a drill, replacing it.' },
    kind: 'drill', replaceGroup: 'drill', category: 'extraction', w: 3, h: 3, needsZone: true, unlock: 'ex5', kw: 400, idleKw: 40,
    cost: [['steel', 30], ['pipe', 10], ['thermal_core', 4], ['gear', 10]],
    ports: [P(0, 0, 'N', 'out'), P(2, 0, 'N', 'out')], drill: { perMin: 45, capMult: 1500 },
  },
  excavator: {
    name: { fr: 'Excavatrice', en: 'Excavator' },
    desc: { fr: 'Creuse la roche marquée avec Aménager à 3 tuiles d’elle au plus, et sans marque à portée exploite la roche voisine en carrière, sans l’entamer. La pierre sort à l’arrière, le minerai enfoui file au Cœur.', en: 'Digs the rock you mark with Landscape up to 3 tiles from it, and with no mark in reach quarries the rock beside it without wearing it away. Stone leaves at the back; ore buried in the rock goes to the Core.' },
    kind: 'excavator', category: 'extraction', w: 3, h: 3, needsZone: true, unlock: 'tr2', kw: 240, idleKw: 24,
    cost: [['steel', 12], ['iron_plate', 10], ['gear', 10], ['motor', 4]], ports: [P(1, 2, 'S', 'out')], excavator: { reach: 3, speed: 1000 }, // D129: motors, not circuits
  },
  pump: {
    name: { fr: 'Pompe à eau', en: 'Water Pump' },
    desc: { fr: 'Au bord de l’eau, pompe 60 eau/min dans un conduit, pour les chaudières et les fours à céramique. L’eau ne voyage pas sur les rubans.', en: 'At the water’s edge, pumps 60 water/min into a conduit, for boilers and ceramic ovens. Water does not ride ribbons.' },
    // Tier 1 since D114 (the Steam plan: water's first use is the steam boiler); onRock: by the tarn up on the Crown (D63)
    kind: 'pump', category: 'extraction', w: 1, h: 1, needsZone: true, onRock: true, unlock: 'steam', kw: 30, idleKw: 3,
    cost: [['iron_plate', 5], ['glass', 2]], ports: [PW(0, 0, 'N', 'out')], drill: { perMin: 60 },
  },
  backfiller: {
    name: { fr: 'Remblayeuse', en: 'Backfiller' },
    desc: { fr: 'Comble l’eau et les salines marquées avec Aménager, jusqu’à 8 tuiles d’elle, avec la pierre qu’un ruban lui apporte : du terrain gagné.', en: 'Fills the water and salt flats you mark with Landscape, up to 8 tiles away, with stone brought in by ribbon: reclaimed land.' },
    kind: 'backfiller', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'ex3', kw: 150, idleKw: 15,
    cost: [['steel', 10], ['gear', 10], ['ceramic', 10]], ports: [P(0, 1, 'S', 'in')],
  },

  // ── logistics ─────────────────────────────────────────────────────────────
  ribbon: {
    name: { fr: 'Ruban', en: 'Ribbon' },
    desc: { fr: 'Porte les objets d’un bâtiment à l’autre : 60/min, un objet par tuile. Se trace en glissant, et ne coûte rien.', en: 'Carries items from building to building: 60/min, one item per tile. Lay it by dragging; it costs nothing.' },
    kind: 'belt', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'start',
    cost: [], ports: [], belt: { ticksPerTile: 6, perMin: 60 }, // free (owner, 2026-10-12): a line is never out of reach
  },
  traction_ribbon: {
    name: { fr: 'Ruban à traction', en: 'Traction Ribbon' },
    desc: { fr: 'Monte ou descend les objets d’un gradin, vers la case qu’il regarde : le seul passage d’un niveau à l’autre, et il se pose aussi sur la roche. Il va à l’allure de sa ligne, vif sur un ruban vif, express sur un ruban express, et jamais moins vite qu’un ruban (60/min).', en: 'Lifts items one terrace up or down, to the tile it faces: the only way from one level to another, and it stands on rock too. It goes at its line’s pace, swift on a swift ribbon, express on an express one, and never slower than a ribbon (60/min).' },
    kind: 'belt', lift: true, replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'traction',
    // Its own pace is a plain ribbon's, the floor under its line's: the compile gives it the fastest
    // ribbon it meets on its line (D141, graph/compile.ts `linePace`). It was 30/min until then, and
    // halved every line at every terrace.
    cost: [['iron_plate', 2], ['copper_wire', 1]], ports: [], belt: { ticksPerTile: 6, perMin: 60 },
  },
  swift_ribbon: {
    name: { fr: 'Ruban vif', en: 'Swift Ribbon' },
    desc: { fr: 'Un ruban deux fois plus rapide : 120/min. Trace-le par-dessus un ruban pour l’améliorer.', en: 'A ribbon twice as fast: 120/min. Drag it over a ribbon to upgrade it.' },
    kind: 'belt', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'xp_swift',
    cost: [['iron_plate', 1], ['gear', 1]], ports: [], belt: { ticksPerTile: 4, perMin: 120 },
  },
  express_ribbon: {
    name: { fr: 'Ruban express', en: 'Express Ribbon' },
    desc: { fr: 'Le ruban le plus rapide : 240/min. Trace-le par-dessus un autre ruban pour l’améliorer.', en: 'The fastest ribbon: 240/min. Drag it over another ribbon to upgrade it.' },
    kind: 'belt', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'xp_express',
    cost: [['iron_plate', 1], ['gear', 1], ['circuit', 1]], ports: [], belt: { ticksPerTile: 2, perMin: 240 },
  },
  // ── routing blocks (kind `fork`, after Mindustry's distribution blocks) ─────
  router: {
    name: { fr: 'Routeur', en: 'Router' },
    desc: { fr: 'Prend les objets par l’arrière et les distribue à tour de rôle devant et sur les côtés. Posé sur un ruban, il en prend le sens ; dans l’inspecteur, choisis quel objet part de quel côté.', en: 'Takes items in at its back and deals them out in turn to its front and sides. Dropped on a ribbon, it follows the ribbon’s way; in the inspector, choose which item leaves by which side.' },
    kind: 'fork', logic: 'router', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'router',
    cost: [['iron_plate', 1]], ports: [],
  },
  sorter: {
    name: { fr: 'Trieur', en: 'Sorter' },
    desc: { fr: 'Entrée par l’arrière : l’objet choisi passe tout droit, tous les autres partent sur les côtés. Choisis l’objet dans l’inspecteur.', en: 'In from the back: the chosen item goes straight on, everything else to the sides. Pick the item in the inspector.' },
    kind: 'fork', logic: 'sorter', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, unlock: 'sorter',
    cost: [['iron_plate', 1], ['copper_wire', 1]], ports: [],
  },
  inverted_sorter: {
    name: { fr: 'Trieur inversé', en: 'Inverted Sorter' },
    desc: { fr: 'Entrée par l’arrière : l’objet choisi part sur les côtés, tous les autres passent tout droit. Pour tirer un objet d’une ligne mêlée.', en: 'In from the back: the chosen item goes to the sides, everything else straight on. To pull one item off a mixed line.' },
    kind: 'fork', logic: 'inverted', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, unlock: 'inverted_sorter',
    cost: [['iron_plate', 1], ['copper_wire', 1]], ports: [],
  },
  overflow_gate: {
    name: { fr: 'Vanne de trop-plein', en: 'Overflow Gate' },
    desc: { fr: 'Entrée par l’arrière : tout passe tout droit, et déborde sur les côtés quand l’avant est plein. Pour servir une machine d’abord et envoyer le surplus ailleurs.', en: 'In from the back: everything goes straight on, spilling to the sides when the front is full. To serve one machine first and send the surplus elsewhere.' },
    kind: 'fork', logic: 'overflow', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, unlock: 'overflow_gate',
    cost: [['iron_plate', 1], ['copper_wire', 1]], ports: [],
  },
  underflow_gate: {
    name: { fr: 'Vanne de sous-débit', en: 'Underflow Gate' },
    desc: { fr: 'Entrée par l’arrière : les côtés d’abord, tout droit seulement quand ils sont pleins. L’inverse de la vanne de trop-plein.', en: 'In from the back: the sides first, straight on only when they are full. The reverse of the overflow gate.' },
    kind: 'fork', logic: 'underflow', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, unlock: 'underflow_gate',
    cost: [['iron_plate', 1], ['copper_wire', 1]], ports: [],
  },
  distributor: {
    name: { fr: 'Distributeur', en: 'Distributor' },
    desc: { fr: 'Un grand routeur 2×2 : prend de tous côtés et rend sur tous les autres, avec un plus grand tampon. Se pose par-dessus quatre routeurs ou des rubans, qu’il remplace.', en: 'A big 2×2 router: takes from every side and deals out to all the others, with a bigger buffer. Can be placed over four routers or ribbons, replacing them.' },
    kind: 'fork', logic: 'distributor', replaceGroup: 'transport', category: 'distribution', w: 2, h: 2, needsZone: false, unlock: 'xp_distrib',
    cost: [['iron_plate', 4], ['copper_wire', 2]], ports: [],
  },
  crossing: {
    name: { fr: 'Croisement', en: 'Junction' },
    desc: { fr: 'Deux lignes de rubans s’y croisent sans se mêler : chaque objet ressort tout droit en face, vers un ruban, un routeur ou une machine. Un tracé qui coupe une ligne en pose un de lui-même.', en: 'Two ribbon lines cross here without mixing: each item comes out straight across, onto a ribbon or into a router or a machine. A ribbon drag cutting across a line lays one by itself.' },
    kind: 'crossing', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'junction',
    cost: [['iron_plate', 1]], ports: [],
  },
  skybridge: {
    name: { fr: 'Passerelle', en: 'Bridge' },
    desc: { fr: 'Fait sauter les objets jusqu’à la passerelle suivante, à 4 tuiles au plus (8 avec Passerelles longues), par-dessus rubans, roche ou eau. Pose les deux dans le même sens.', en: 'Makes items leap to the next bridge, at most 4 tiles ahead (8 with Long Bridges), over ribbons, rock or water. Place both facing the same way.' },
    kind: 'bridge', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'bridge',
    cost: [['iron_plate', 1]], ports: [], belt: { ticksPerTile: 6, perMin: 60 },
  },
  conduit: {
    name: { fr: 'Conduit', en: 'Conduit' },
    desc: { fr: 'Le ruban de l’eau : 240/min, des pompes aux chaudières et aux fours à céramique. Ne porte que des fluides et se trace en glissant ; tiré du flanc d’un autre conduit, il en partage l’eau.', en: 'The water ribbon: 240/min, from pumps to boilers and ceramic ovens. Carries fluids only and is laid by dragging; drawn off another conduit’s side, it shares its water.' },
    // Tier 1 since D114, a plate a tile (it was a ceramic, which only Tier 2 makes).
    kind: 'conduit', replaceGroup: 'fluid', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'steam',
    cost: [['iron_plate', 1]], ports: [], belt: { ticksPerTile: 2, perMin: 240 },
  },
  silo: {
    name: { fr: 'Silo', en: 'Silo' },
    desc: { fr: 'Stocke jusqu’à 1 000 objets d’une seule sorte : entrées à l’arrière, sorties à l’avant. Un tampon entre deux chaînes, que ses sorties vident d’elles-mêmes.', en: 'Holds up to 1,000 items of a single kind: in at the back, out at the front. A buffer between two lines; its outputs empty it by themselves.' },
    kind: 'storage', category: 'logistics', w: 2, h: 2, needsZone: true, unlock: 'silo',
    cost: [['iron_plate', 8], ['glass', 2]],
    ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out'), P(1, 0, 'N', 'out')], storageCap: 1000,
  },

  // ── production ────────────────────────────────────────────────────────────
  kiln: {
    name: { fr: 'Fonderie', en: 'Smelter' },
    desc: { fr: 'Fond le minerai de fer en plaques et le sable en verre, en brûlant du charbon : pas besoin d’électricité. Minerai et charbon à ses deux entrées, à l’arrière.', en: 'Smelts iron ore into plates and sand into glass by burning coal: no power needed. Ore and coal to its two inputs at the back.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'kiln', crafts: true,
    cost: [['iron_plate', 15]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  kiln_compact: {
    name: { fr: 'Fonderie compacte', en: 'Compact Smelter' },
    desc: { fr: 'La fonderie sur 1×2, avec une entrée à l’arrière et une sur le côté. Mêmes recettes, sans électricité.', en: 'The smelter on 1×2, with one input at the back and one on the side. Same recipes, no power.' },
    kind: 'machine', category: 'production', w: 1, h: 2, needsZone: true, unlock: 'dn3', crafts: true,
    cost: [['iron_plate', 15], ['gear', 2]], ports: [P(0, 1, 'S', 'in'), P(0, 1, 'E', 'in'), P(0, 0, 'N', 'out')],
  },
  // The smelter's work on power instead of coal (D106; owner, 2026-10-17: « un electric smelter, qui
  // consomme beaucoup mais qui permet de faire ce que fait le smelter sans charbon »): the smelter's
  // pace, a heavy draw — coal stays the cheap way early, power the clean one — and the arc furnace's
  // two recipes (plates or glass: it waits for the player's choice, D83). Built of Tier 1 materials.
  electric_smelter: {
    name: { fr: 'Fonderie électrique', en: 'Electric Smelter' },
    desc: { fr: 'Fond le minerai de fer en plaques et le sable en verre à l’électricité, sans charbon, au rythme de la fonderie. Elle tire beaucoup sur le réseau : prévois l’énergie avant de l’allumer.', en: 'Smelts iron ore into plates and sand into glass with power, no coal, at the smelter’s pace. It draws heavily on the grid: plan the power before you switch it on.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn_esmelt', crafts: true, kw: 300, idleKw: 15,
    cost: [['iron_plate', 15], ['copper_plate', 10], ['brick', 10], ['copper_coil', 6]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')], // D129: its induction coils
  },
  wire_mill: {
    name: { fr: 'Tréfileuse', en: 'Wire Mill' },
    desc: { fr: 'Tire deux fils de cuivre de chaque minerai de cuivre. Le cuivre du cirque est maigre : prévois d’en acheter.', en: 'Draws two copper wires from each copper ore. Copper is scarce in the cirque: plan to buy some.' },
    kind: 'machine', category: 'production', w: 1, h: 2, needsZone: true, unlock: 'wire_mill', crafts: true, kw: 60, idleKw: 6,
    cost: [['iron_plate', 15], ['glass', 4]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  // The electronics workshop: Tier 2's research since D129 (owner, 2026-10-18: « devrait probablement
  // avoir un style plus avancé, et demander plus en ressources que du verre et du cuivre »), a plan of
  // the Production path before. Its id and its 2×2 are kept (saves hold both); a third intake on its
  // side takes the circuit's third input, as the compact assembly workshop's does.
  workshop: {
    name: { fr: 'Atelier d’électronique', en: 'Electronics Workshop' },
    desc: { fr: 'Une ligne d’électronique sous verre : grave des circuits imprimés (une plaque de cuivre, deux fils de cuivre, un verre) et, avec la recherche, monte des servomoteurs et des bras robotisés. Deux entrées à l’arrière, une sur le côté.', en: 'An electronics line under glass: etches circuit boards (a copper plate, two copper wires, a glass) and, with research, assembles servomotors and robot arms. Two inputs at the back, one on the side.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'workshop', crafts: true, kw: 120, idleKw: 12,
    cost: [['steel', 10], ['copper_plate', 10], ['cable', 6], ['glass', 6], ['oscillator', 4]],
    ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 1, 'W', 'in'), P(0, 0, 'N', 'out')],
  },
  great_workshop: {
    name: { fr: 'Atelier d’assemblage', en: 'Assembly Workshop' },
    desc: { fr: 'Assemble les pièces lourdes avec trois entrées : batteries vides, cœurs thermiques et, plus tard, résonateurs.', en: 'Assembles heavy parts from three inputs: empty batteries, thermal cores and, later, resonators.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'tr3', crafts: true, kw: 240, idleKw: 24,
    cost: [['steel', 20], ['brick', 20], ['gear', 10], ['motor', 4]], // D129: motors, not circuits (Ceramics may come before the electronics workshop)
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  great_workshop_compact: {
    name: { fr: 'Atelier d’assemblage compact', en: 'Compact Assembly Workshop' },
    desc: { fr: 'L’atelier d’assemblage sur 2×2, avec deux entrées à l’arrière et une sur le côté. Mêmes recettes.', en: 'The assembly workshop on 2×2, with two inputs at the back and one on the side. Same recipes.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn_compact', crafts: true, kw: 240, idleKw: 24,
    cost: [['steel', 20], ['gear', 12], ['circuit', 8], ['pace_bell', 2]],
    ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 1, 'W', 'in'), P(1, 0, 'N', 'out')],
  },
  tower_workshop: {
    name: { fr: 'Tour d’assemblage', en: 'Assembly Tower' },
    desc: { fr: 'Les recettes de l’atelier d’assemblage, quatre fois plus vite. Très gourmande : 900 kW en marche.', en: 'The assembly workshop’s recipes, four times as fast. Very hungry: 900 kW while running.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'dn8', crafts: true, kw: 900, idleKw: 90, speed: 4000,
    cost: [['circuit', 40], ['resonator', 10], ['pace_bell', 8]],
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  ceramic_oven: {
    name: { fr: 'Four à céramique', en: 'Ceramic Oven' },
    desc: { fr: 'Cuit la pierre et l’eau en céramique. La pierre vient des excavatrices, l’eau des pompes par conduit.', en: 'Fires stone and water into ceramic. Stone comes from excavators, water from pumps by conduit.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, onRock: true, unlock: 'tr3', crafts: true, kw: 120, idleKw: 12, // onRock: a mountain-top ceramic works by the tarn (D63)
    cost: [['brick', 20], ['pipe', 6], ['gear', 4]], ports: [P(0, 1, 'S', 'in'), PW(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  observatory: {
    // The Research Lab (D68); its id stays `observatory` (saves, the plan, the unlock tree).
    name: { fr: 'Laboratoire de recherche', en: 'Research Lab' },
    desc: { fr: 'Mène une recherche à la fois, lancée dans l’arbre des techniques (T) : ses ressources se paient au Cœur au lancement, et elle se termine dès que ses tokens d’IA sont arrivés — ceux du calcul du Cœur et de tes serveurs, puis le flux que tu achètes à CrierBelt. Il lui faut de l’électricité ; aucun ruban.', en: 'Runs one research project at a time, started in the tech tree (T): its resources are paid from the Core at launch, and it is done as soon as its AI tokens have arrived — the Core’s compute and your servers’, then the flow you buy from CrierBelt. It needs power; no ribbon.' },
    // 3×3 since D84 (owner, 2026-10-15: "the research lab should be 3x3"). No input since D122
    // (owner, 2026-10-17: « le laboratoire n'a plus besoin d'entrée »): research takes no data.
    kind: 'lab', category: 'research', w: 3, h: 3, needsZone: true, unlock: 'observatory', kw: 150, idleKw: 15,
    cost: [['iron_plate', 30], ['glass', 20], ['copper_wire', 10]], ports: [],
  },

  // ── energy ────────────────────────────────────────────────────────────────
  mast: {
    name: { fr: 'Poteau', en: 'Pole' },
    desc: { fr: 'Porte le courant : 8 fils jusqu’à 6 tuiles, qui montent ou descendent d’un gradin et passent un gradin de relief. Relie-le (outil Relier, L) au Cœur, à d’autres poteaux et aux bâtiments à alimenter.', en: 'Carries power: 8 wires up to 6 tiles long, climbing or coming down one terrace and clearing a one-terrace rise. Link it (Link tool, L) to the Core, other poles and the buildings to power.' },
    kind: 'pole', replaceGroup: 'power', category: 'energy', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'start',
    cost: [['iron_plate', 2], ['copper_wire', 1]], ports: [], pole: { range: 6, slots: 8, climb: 1 }, // one terrace up or down, one above the land (D78)
  },
  pylon: {
    name: { fr: 'Pylône', en: 'Pylon' },
    desc: { fr: 'Un grand pylône de 2×2 qui porte loin : 4 fils jusqu’à 40 tuiles (60 avec Pylônes renforcés), qui montent ou descendent de 3 gradins et passent 3 gradins de relief, jamais une montagne.', en: 'A big 2×2 pylon that carries far: 4 wires up to 40 tiles long (60 with Reinforced Pylons), climbing or coming down 3 terraces and clearing a 3-terrace rise, never a mountain.' },
    kind: 'pole', replaceGroup: 'power', category: 'energy', w: 2, h: 2, needsZone: false, onRock: true, unlock: 'tr4', // 2×2 and twice as tall since D75 (owner, 2026-10-14)
    cost: [['steel', 10], ['cable', 8], ['ceramic', 4]], ports: [], pole: { range: 40, slots: 4, climb: 3, tall: true }, // three terraces up or down, three above the land: never over a mountain (D78)
  },
  // The steam boiler (D114; owner, 2026-10-17: « Il faudrait que l'eau serve assez tôt dans le jeu,
  // dès le Tier 1 »): water's first use. Coal under a boiler, its steam through an engine: 700 kW for
  // 8 coal a minute (D143; owner, 2026-10-19: « coal + water is 700kW »), the one coal-fired plant
  // since the coal generator left the game with that same decision — at the price of a pump by
  // water, a conduit and a bigger build. Fuel still: it burns, by night and day alike, only what the
  // grid asks for; the wind and the sun stay free. 3×2: the firebox and the coal intake on the left,
  // the drum across, the engine and the water intake on the right; onRock, like the pump, to stand by
  // the Crown's tarn (D63).
  steam_boiler: {
    name: { fr: 'Chaudière à vapeur', en: 'Steam Boiler' },
    desc: { fr: 'Change le charbon et l’eau en vapeur, et la vapeur en électricité : 700 kW pour 8 charbon et 30 eau par minute, de jour comme de nuit. Elle ne brûle que ce que le réseau demande.', en: 'Turns coal and water into steam, and steam into power: 700 kW for 8 coal and 30 water a minute, by day and by night. It burns only what the grid asks for.' },
    kind: 'generator', category: 'energy', w: 3, h: 2, needsZone: true, onRock: true, unlock: 'steam',
    cost: [['iron_plate', 30], ['glass', 6], ['copper_wire', 6]], ports: [P(0, 1, 'S', 'in'), PW(2, 1, 'S', 'in')], // the water intake on the right (D142)
    gen: { kw: 700, fuel: 'coal', fuelPerMin: 8, water: 30 }, // 600 → 700 kW (D143)
  },
  wind_flower: {
    name: { fr: 'Éolienne', en: 'Wind Turbine' },
    desc: { fr: 'De l’électricité au gré du vent : jusqu’à 100 kW. Le vent change d’un lieu à l’autre — fort sur les crêtes et les grands espaces dégagés, faible au creux du cirque et à l’abri des reliefs — et d’une heure à l’autre ; par grande tempête, elle s’arrête.', en: 'Power as the wind blows: up to 100 kW. The wind changes from place to place — strong on the ridges and wide open ground, weak down in the cirque and in the lee of the relief — and from hour to hour; in a great storm it stops.' },
    kind: 'wind', replaceGroup: 'wind', category: 'energy', w: 2, h: 2, needsZone: true, onRock: true, unlock: 'wind_flower',
    cost: [['iron_plate', 10], ['glass', 4], ['copper_wire', 6]], ports: [], gen: { kw: 100, wind: { cutIn: 400, rated: 1400, cutOut: 3600 } }, // D95: its rating, reached at 1.4× the reference wind; 360 → 160 kW (D116) → 130 (D132) → 100 (D143)
  },
  sun_bulb: {
    name: { fr: 'Panneau solaire', en: 'Solar Panel' },
    desc: { fr: 'De l’électricité gratuite le jour : 200 kW en plein soleil, rien la nuit. À doubler d’accumulateurs pour la nuit.', en: 'Free power by day: 200 kW in full sun, nothing at night. Pair it with accumulators for the night.' },
    kind: 'solar', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'en2',
    cost: [['iron_plate', 6], ['glass', 12], ['copper_wire', 4]], ports: [], gen: { kw: 200 }, // 150 → 200 kW (D143)
  },
  accumulator: {
    name: { fr: 'Accumulateur', en: 'Accumulator' },
    desc: { fr: 'La batterie du réseau : se remplit des surplus et les rend quand la demande dépasse la production. 1 200 kW·min, 300 kW au plus.', en: 'The grid’s battery: fills up with surplus power and gives it back when demand outruns supply. 1,200 kW·min, 300 kW at most.' },
    kind: 'accumulator', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'tr3',
    cost: [['ceramic', 10], ['empty_cell', 4], ['copper_coil', 6], ['cable', 4]], ports: [], accumulator: { kwMin: 1200, kw: 300 },
  },
  cell_charger: {
    name: { fr: 'Chargeur', en: 'Battery Charger' },
    desc: { fr: 'Charge une batterie vide en 2 minutes à 300 kW : de l’énergie en boîte, à vendre à la Criée.', en: 'Charges an empty battery in 2 minutes at 300 kW: boxed energy to sell at the Crier Ring.' },
    kind: 'machine', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'en4', crafts: true, kw: 300, idleKw: 10,
    cost: [['ceramic', 10], ['copper_coil', 8], ['copper_plate', 8]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  fumarole_tap: {
    name: { fr: 'Centrale géothermique', en: 'Geothermal Plant' },
    desc: { fr: 'Géothermie : 1,5 MW jour et nuit, sans combustible. Se pose uniquement sur un évent.', en: 'Geothermal: 1.5 MW day and night, no fuel. Only stands on a vent.' },
    kind: 'geothermal', category: 'energy', w: 3, h: 3, needsZone: true, unlock: 'en5',
    cost: [['ceramic', 20], ['thermal_core', 4], ['circuit', 10], ['pipe', 16]], ports: [], gen: { kw: 1500 },
  },
  sunheart: {
    name: { fr: 'Cœur-Soleil', en: 'Sunheart' },
    desc: { fr: 'Une centrale de 20 MW qui ne brûle qu’un résonateur toutes les 30 minutes.', en: 'A 20 MW plant that burns just one resonator every 30 minutes.' },
    kind: 'generator', category: 'energy', w: 5, h: 5, needsZone: true, unlock: 'enK',
    cost: [['thermal_core', 200], ['resonator', 40]], ports: [P(2, 4, 'S', 'in')],
    gen: { kw: 20000, fuel: 'resonator', fuelPerMin: 1 / 30 },
  },

  // ── commerce ──────────────────────────────────────────────────────────────
  trade_post: {
    name: { fr: 'Comptoir', en: 'Trade Post' },
    desc: { fr: 'L’aire de levage de CrierBelt, dans un anneau que brûlent les flammes de ses drones : une seule entrée, une seule sortie, sur des rubans ignifugés. Elle vend chaque minute ce que son entrée apporte (tes flux d’export) et rend tes achats par sa sortie, à tour de rôle ; accolée au Cœur, elle commerce directement avec son stock.', en: 'CrierBelt’s cargo lift pad, in a ring its drones’ flames scorch: one entrance, one exit, on flame-proof ribbons. It sells each minute what its entrance brings (your export streams) and hands what you buy out of its exit, in turn; next to the Core, it trades straight from its stock.' },
    // The pad is the middle 3×3; the outer ring is the scorched apron the drones' flames keep clear
    // (owner, 2026-10-14: "should block any construction in a 1 case radius around it because of
    // the flames of the drones"), crossed by its two built-in flame-proof ribbons: the entrance in
    // the middle of one side, the exit in the middle of the other (D62).
    kind: 'trade', category: 'commerce', w: 5, h: 5, needsZone: true, unlock: 'trade_post', kw: 100, idleKw: 10,
    cost: [['iron_plate', 40], ['glass', 10], ['copper_wire', 10]],
    ports: [P(2, 4, 'S', 'in'), P(2, 0, 'N', 'out')],
  },
  // ── appended (saves store building indices: new entries go last) ─────────
  sand_collector: {
    name: { fr: 'Collecteur de sable', en: 'Sand Collector' },
    desc: { fr: 'Ramasse et tamise le sable du sol : 15/min, partout où le sol est du sable nu, sans gisement. La production sort à l’avant, sur un ruban.', en: 'Scoops and sifts the sand off the ground: 15/min, anywhere the ground is bare sand, no deposit needed. Its output leaves at the front, onto a ribbon.' },
    kind: 'drill', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'sand_collector', kw: 30, idleKw: 3,
    cost: [['iron_plate', 5], ['copper_wire', 2]], ports: [P(0, 0, 'N', 'out')], drill: { perMin: 15, ground: 'sand' },
  },
  // The way out for a line that cannot go on (owner, 2026-10-13: "what happens if the user sends
  // the wrong resource to a machine? … we need a block that destroys anything that enters"): a
  // machine takes only its recipe's inputs, so one wrong item at a ribbon's head jams the line.
  // The one block where items do vanish — the player's explicit choice (D51), never the game's.
  incinerator: {
    name: { fr: 'Incinérateur', en: 'Incinerator' },
    desc: { fr: 'Détruit tout ce qui y entre, par n’importe quel côté : la sortie d’une ligne bouchée par un mauvais objet. Posé sur un ruban, il le remplace ; rien n’en ressort, rien n’est remboursé.', en: 'Destroys whatever enters it, from any side: the way out for a line jammed by the wrong item. Dropped on a ribbon, it replaces it; nothing comes out, nothing is refunded.' },
    kind: 'sink', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'incinerator',
    cost: [['iron_plate', 3]], ports: [P(0, 0, 'N', 'in'), P(0, 0, 'E', 'in'), P(0, 0, 'S', 'in'), P(0, 0, 'W', 'in')],
  },
  // ── appended: research (D68) and the tree's machines (D70) ──────────────
  // Research runs on AI tokens and, at launch, resources from the Core (D122: the data collector,
  // the test bench and the data relay are retired, content/retired.ts). Servers supply tokens.
  // Every research node unlocks a machine or a feature (owner, 2026-10-14: not just a boost): the
  // upgraded machines below are those unlocks.
  server: {
    name: { fr: 'Serveur', en: 'Server' },
    desc: { fr: 'Calcule pour tes recherches : 2 000 tokens d’IA par minute pour 400 kW, aux recherches dans l’ordre où elles ont été lancées. Ce qu’aucune n’utilise dans la minute est perdu.', en: 'Computes for your research: 2,000 AI tokens a minute for 400 kW, to the research projects in the order they started. What none uses within the minute is lost.' },
    kind: 'server', category: 'research', w: 2, h: 2, needsZone: true, unlock: 'an_servers', kw: 400, idleKw: 40,
    // Its clocks are quartz oscillators since D87 (a server built before gives them back too when taken down: nothing vanishes).
    cost: [['circuit', 10], ['steel', 8], ['cable', 6], ['oscillator', 4]], ports: [], server: { tokensPerMin: 2000 },
  },
  press: {
    name: { fr: 'Presse', en: 'Press' },
    desc: { fr: 'Frappe les engrenages, trois plaques de fer pour un, et roule l’acier en tuyaux, qui laissent des chutes par la même sortie : une tous les dix tuyaux.', en: 'Stamps gears, three iron plates each, and rolls steel into pipes, which leave scrap through the same output: one every ten pipes.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'tr1', crafts: true, kw: 60, idleKw: 6,
    cost: [['iron_plate', 20]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  optics_workshop: {
    name: { fr: 'Atelier d’optique', en: 'Optics Workshop' },
    desc: { fr: 'Taille les lentilles, de verre-spore ou de résine, et tisse les treillis de nacre. Trois entrées.', en: 'Grinds lenses, from sporeglass or resin, and weaves nacre lattices. Three inputs.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'tr6', crafts: true, kw: 150, idleKw: 15,
    cost: [['iron_plate', 30], ['glass', 20], ['circuit', 6]],
    ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 1, 'W', 'in'), P(1, 0, 'N', 'out')],
  },
  scriptorium: {
    name: { fr: 'Scriptorium', en: 'Scriptorium' },
    desc: { fr: 'Tisse la toile de résine, de la résine céleste sur une trame de fil de cuivre : la Guilde des dirigeables la paie cher.', en: 'Weaves resin canvas, sky resin on a weft of copper wire: the Drifter Guild pays well for it.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'tr6', crafts: true, kw: 200, idleKw: 20,
    cost: [['steel', 16], ['circuit', 10], ['gear', 10]],
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  pitch_turbine: {
    name: { fr: 'Éolienne à pas variable', en: 'Pitch-Control Turbine' },
    desc: { fr: 'Ses pales s’orientent au vent : jusqu’à 140 kW, dès le moindre souffle et jusque dans la tempête. Posée sur une éolienne, elle la remplace.', en: 'Its blades turn to the wind: up to 140 kW, from the lightest breeze and on through a storm. Placed over a wind turbine, it replaces it.' },
    kind: 'wind', replaceGroup: 'wind', category: 'energy', w: 2, h: 2, needsZone: true, onRock: true, unlock: 'en_pitch',
    cost: [['iron_plate', 15], ['glass', 6], ['copper_coil', 4], ['gear', 4]], ports: [], gen: { kw: 140, wind: { cutIn: 300, rated: 1250 } }, // D95: feathered blades, no storm stop; 480 → 220 kW (D116) → 180 (D132) → 140 (D143)
  },
  heavy_accumulator: {
    name: { fr: 'Accumulateur lourd', en: 'Heavy Accumulator' },
    desc: { fr: 'Une batterie de réseau plus grosse : 4 000 kW·min, 800 kW au plus.', en: 'A bigger grid battery: 4,000 kW·min, 800 kW at most.' },
    kind: 'accumulator', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'en_heavyacc',
    cost: [['ceramic', 20], ['empty_cell', 10], ['copper_coil', 12], ['cable', 10]], ports: [], accumulator: { kwMin: 4000, kw: 800 },
  },
  solar_farm: {
    name: { fr: 'Ferme solaire', en: 'Solar Farm' },
    desc: { fr: 'Un champ de panneaux sur 3×3 : 600 kW en plein soleil, rien la nuit.', en: 'A 3×3 field of panels: 600 kW in full sun, nothing at night.' },
    kind: 'solar', category: 'energy', w: 3, h: 3, needsZone: true, unlock: 'en_solarfarm',
    cost: [['steel', 10], ['glass', 40], ['cable', 8], ['circuit', 4]], ports: [], gen: { kw: 600 },
  },
  big_turbine: {
    name: { fr: 'Grande éolienne', en: 'Great Turbine' },
    desc: { fr: 'Une éolienne de 3×3 : jusqu’à 1 200 kW. Plus haute, elle prend le vent plus tôt ; sur une crête dégagée, elle donne le plus.', en: 'A 3×3 wind turbine: up to 1,200 kW. Taller, it catches the wind sooner; on an open ridge it gives most.' },
    kind: 'wind', replaceGroup: 'wind', category: 'energy', w: 3, h: 3, needsZone: true, onRock: true, unlock: 'en_bigwind',
    cost: [['steel', 30], ['gear', 12], ['cable', 16], ['ceramic', 10]], ports: [], gen: { kw: 1200, wind: { cutIn: 350, rated: 1300, cutOut: 4200 } }, // D95
  },
  cell_generator: {
    name: { fr: 'Générateur à batteries', en: 'Battery Generator' },
    desc: { fr: 'Brûle les batteries chargées : 600 kW, une batterie par minute à plein régime. Il ne brûle que ce que le réseau demande.', en: 'Burns charged batteries: 600 kW, one battery a minute at full output. It burns only what the grid asks for.' },
    kind: 'generator', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'en_cellgen',
    cost: [['steel', 10], ['ceramic', 10], ['circuit', 6], ['cable', 6]], ports: [P(0, 1, 'S', 'in')],
    gen: { kw: 600, fuel: 'charged_cell', fuelPerMin: 1 },
  },
  solar_tower: {
    name: { fr: 'Tour solaire', en: 'Solar Tower' },
    desc: { fr: 'Un champ de miroirs autour d’une tour : 3 MW en plein soleil, rien la nuit.', en: 'A field of mirrors round a tower: 3 MW in full sun, nothing at night.' },
    kind: 'solar', category: 'energy', w: 4, h: 4, needsZone: true, unlock: 'en_tower',
    cost: [['lens', 20], ['ceramic', 40], ['circuit', 20], ['iron_plate', 60]], ports: [], gen: { kw: 3000 },
  },
  sifter: {
    name: { fr: 'Tamiseur', en: 'Sifter' },
    desc: { fr: 'Tamise la pierre des excavatrices : du sable, ou le minerai de fer ou de cuivre qu’elle cache. Choisis la recette dans l’inspecteur.', en: 'Sifts the excavators’ stone: sand, or the iron or copper ore it hides. Pick the recipe in the inspector.' },
    kind: 'machine', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'ex_sifter', crafts: true, kw: 90, idleKw: 9,
    cost: [['steel', 6], ['iron_plate', 10], ['glass', 4]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  fast_drill: {
    name: { fr: 'Foreuse rapide', en: 'Fast Drill' },
    desc: { fr: 'Une foreuse 2×2 plus puissante : jusqu’à 35/min, et moitié plus qu’une foreuse sur les mêmes tuiles d’un gisement pauvre. Posée sur une foreuse, elle la remplace.', en: 'A stronger 2×2 drill: up to 35/min, and half as much again as a drill on the same tiles of a poor deposit. Placed over a drill, it replaces it.' },
    kind: 'drill', replaceGroup: 'drill', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'ex_fastdrill', kw: 180, idleKw: 18,
    cost: [['iron_plate', 20], ['gear', 6], ['copper_coil', 4]], ports: [P(0, 0, 'N', 'out')], drill: { perMin: 35, capMult: 1500 }, // D129: coils, not circuits; D150: half as much again from the same tiles
  },
  hp_pump: {
    name: { fr: 'Pompe haute pression', en: 'High-Pressure Pump' },
    desc: { fr: 'Au bord de l’eau, pompe 240 eau/min dans un conduit.', en: 'At the water’s edge, pumps 240 water/min into a conduit.' },
    kind: 'pump', category: 'extraction', w: 2, h: 2, needsZone: true, onRock: true, unlock: 'ex_hppump', kw: 120, idleKw: 12,
    cost: [['pipe', 12], ['steel', 6], ['gear', 6]], ports: [PW(0, 0, 'N', 'out')], drill: { perMin: 240 },
  },
  heavy_excavator: {
    name: { fr: 'Excavatrice lourde', en: 'Heavy Excavator' },
    desc: { fr: 'Creuse deux fois plus vite que l’excavatrice, jusqu’à 6 tuiles d’elle. La pierre sort à l’arrière.', en: 'Digs twice as fast as the excavator, up to 6 tiles away. Stone leaves at the back.' },
    kind: 'excavator', category: 'extraction', w: 3, h: 3, needsZone: true, unlock: 'ex_heavyexc', kw: 480, idleKw: 48,
    cost: [['steel', 30], ['gear', 16], ['circuit', 8], ['ceramic', 10]], ports: [P(1, 2, 'S', 'out')], excavator: { reach: 6, speed: 2000 },
  },
  giant_drill: {
    name: { fr: 'Foreuse géante', en: 'Giant Drill' },
    desc: { fr: 'Une foreuse 4×4 : jusqu’à 90/min, et chaque tuile de gisement rend deux fois son plafond. Posée sur des foreuses, elle les remplace.', en: 'A 4×4 drill: up to 90/min, and each deposit tile yields twice its cap. Placed over drills, it replaces them.' },
    kind: 'drill', replaceGroup: 'drill', category: 'extraction', w: 4, h: 4, needsZone: true, unlock: 'ex_giant', kw: 900, idleKw: 90,
    cost: [['steel', 60], ['thermal_core', 8], ['gear', 30], ['ceramic', 20]], ports: [P(1, 0, 'N', 'out'), P(2, 0, 'N', 'out')], drill: { perMin: 90, capMult: 2000 },
  },
  wire_mill_double: {
    name: { fr: 'Tréfileuse double', en: 'Twin Wire Mill' },
    desc: { fr: 'Deux filières : le fil de cuivre deux fois plus vite que la tréfileuse.', en: 'Two dies: copper wire twice as fast as the wire mill.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn_wiremill', crafts: true, kw: 120, idleKw: 12, speed: 2000,
    cost: [['steel', 6], ['copper_plate', 6], ['motor', 2]], ports: [P(0, 1, 'S', 'in'), P(1, 0, 'N', 'out')], // D129: its dies' motors
  },
  etcher: {
    name: { fr: 'Graveuse', en: 'Etcher' },
    desc: { fr: 'Les recettes de l’atelier d’électronique, trois fois plus vite. Construite avec des servomoteurs.', en: 'The electronics workshop’s recipes, three times as fast. Built with servomotors.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'dn_etcher', crafts: true, kw: 500, idleKw: 50, speed: 3000,
    cost: [['circuit', 20], ['pace_bell', 4], ['iron_plate', 40]], ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  chip_fab: {
    name: { fr: 'Usine de puces', en: 'Chip Fab' },
    desc: { fr: 'Les recettes de l’atelier d’électronique, six fois plus vite, pour 1 500 kW. Construite avec des bras robotisés.', en: 'The electronics workshop’s recipes, six times as fast, for 1,500 kW. Built with robot arms.' },
    kind: 'machine', category: 'production', w: 4, h: 4, needsZone: true, unlock: 'dn_chipfab', crafts: true, kw: 1500, idleKw: 150, speed: 6000,
    cost: [['circuit', 60], ['robot_arm', 6], ['lens', 10], ['thermal_core', 10]],
    // D140: a third entrance for the circuit's three inputs, at the back like the etcher's (its 4×4
    // has the room the 2×2 workshop's back lacked); listed last so the ports before it keep their index.
    ports: [P(1, 3, 'S', 'in'), P(2, 3, 'S', 'in'), P(1, 0, 'N', 'out'), P(0, 3, 'S', 'in')],
  },
  forge_press: {
    name: { fr: 'Presse à forger', en: 'Forging Press' },
    desc: { fr: 'Les engrenages trois fois plus vite que la presse.', en: 'Gears three times as fast as the press.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'dn_forge', crafts: true, kw: 300, idleKw: 30, speed: 3000,
    cost: [['steel', 40], ['gear', 20], ['pace_bell', 4]], ports: [P(1, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  arc_furnace: {
    name: { fr: 'Fonderie à arc', en: 'Arc Furnace' },
    desc: { fr: 'Fond le minerai de fer en plaques et le sable en verre à l’électricité, sans charbon, deux fois plus vite que la fonderie.', en: 'Smelts iron ore into plates and sand into glass with power, no coal, twice as fast as the smelter.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn_arc', crafts: true, kw: 400, idleKw: 40, speed: 2000,
    cost: [['brick', 20], ['copper_plate', 20], ['circuit', 6], ['pace_bell', 2]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  cooled_server: {
    name: { fr: 'Serveur refroidi', en: 'Cooled Server' },
    desc: { fr: 'Des baies de serveurs dans leur bain de refroidissement : 6 000 tokens d’IA par minute pour 800 kW.', en: 'Server racks in their cooling bath: 6,000 AI tokens a minute for 800 kW.' },
    kind: 'server', category: 'research', w: 3, h: 3, needsZone: true, unlock: 'an_cooled', kw: 800, idleKw: 80,
    cost: [['circuit', 30], ['pipe', 16], ['cable', 10], ['ceramic', 10]], ports: [], server: { tokensPerMin: 6000 },
  },
  supercomputer: {
    name: { fr: 'Supercalculateur', en: 'Supercomputer' },
    desc: { fr: '20 000 tokens d’IA par minute pour 3 000 kW.', en: '20,000 AI tokens a minute for 3,000 kW.' },
    kind: 'server', category: 'research', w: 4, h: 4, needsZone: true, unlock: 'an_super', kw: 3000, idleKw: 300,
    cost: [['circuit', 100], ['lens', 20], ['thermal_core', 10]], ports: [], server: { tokensPerMin: 20000 },
  },
  auto_lab: {
    name: { fr: 'Laboratoire autonome', en: 'Autonomous Lab' },
    desc: { fr: 'Un laboratoire de recherche qui calcule aussi : 5 000 tokens d’IA par minute, aux recherches dans l’ordre où elles ont été lancées, comme un serveur.', en: 'A research lab that also computes: 5,000 AI tokens a minute, to the research projects in the order they started, like a server.' },
    // D122: it made its own Survey Data (3 a minute) and took more by two inputs; now its cabinets
    // compute, into the claim's pool like a server's — while it is powered, a project or not.
    kind: 'lab', category: 'research', w: 3, h: 3, needsZone: true, unlock: 'an_autolab', kw: 400, idleKw: 40,
    cost: [['circuit', 40], ['lens', 10], ['ceramic', 30]], ports: [], server: { tokensPerMin: 5000 },
  },
  big_silo: {
    name: { fr: 'Grand silo', en: 'Great Silo' },
    desc: { fr: 'Stocke jusqu’à 5 000 objets d’une seule sorte : trois entrées à l’arrière, trois sorties à l’avant.', en: 'Holds up to 5,000 items of a single kind: three inputs at the back, three outputs at the front.' },
    kind: 'storage', category: 'logistics', w: 3, h: 3, needsZone: true, unlock: 'xp_bigsilo',
    cost: [['iron_plate', 30], ['glass', 6], ['gear', 6]],
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(0, 0, 'N', 'out'), P(1, 0, 'N', 'out'), P(2, 0, 'N', 'out')], storageCap: 5000,
  },
  // ── appended (D87): quartz, from the cliff face to the oscillator ─────────
  // The face cutter stands on the floor beside a wall, never on it (owner, 2026-10-15: « une
  // machine particulière qui le récupère et qui se pose à côté et pas au-dessus, car c'est dans une
  // paroi »): its back against the face, its cutting head in the rock, its output at its front. The
  // quartz workshop is its own research node since D128 (`dn_quartzshop`), the cutter a plan (D101).
  face_cutter: {
    name: { fr: 'Haveuse', en: 'Face Cutter' },
    desc: { fr: 'Se pose au pied d’une paroi de quartz, dos contre la roche : sa tête taille le quartz des tuiles de paroi qu’elle touche, jusqu’à 10/min. La production sort à l’avant, sur un ruban.', en: 'Stands at the foot of a quartz face, its back to the rock: its head cuts the quartz out of the face tiles it touches, up to 10/min. Its output leaves at the front, onto a ribbon.' },
    kind: 'drill', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'ex_quartz', kw: 90, idleKw: 9,
    cost: [['iron_plate', 12], ['glass', 2], ['copper_wire', 4]], ports: [P(0, 0, 'N', 'out')], drill: { perMin: 10, face: true },
  },
  quartz_workshop: {
    name: { fr: 'Atelier de quartz', en: 'Quartz Workshop' },
    desc: { fr: 'Taille le quartz en lames et les monte sur deux fils de cuivre : des oscillateurs à quartz, pour les serveurs et la recherche. Deux entrées à l’arrière.', en: 'Cuts quartz into blades and mounts each on two copper wires: quartz oscillators, for the servers and research. Two inputs at the back.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn_quartzshop', crafts: true, kw: 60, idleKw: 6,
    cost: [['iron_plate', 15], ['glass', 4], ['copper_wire', 4]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  // ── appended (D103): what keeps the Gleaners off the ribbons ─────────────
  // The Gleaners walk the open desert floor at night and take shiny things off the ribbons they
  // reach (sim/world/reach.ts). A fence stands in their way (a pocket of floor fenced in is out of
  // their reach); a glazed ribbon is a ribbon under glass, as fast as the plain one. The fence sits in
  // the Base tray (the base's perimeter), the glazed ribbon with the ribbons.
  fence: {
    name: { fr: 'Grille', en: 'Fence' },
    desc: { fr: 'Une grille basse que les Glaneurs ne franchissent pas\u00a0: clos un avant-poste du désert, et ses rubans sont hors de leur portée la nuit. Se trace en glissant.', en: 'A low fence the Gleaners do not cross: close in a desert outpost and its ribbons are out of their reach at night. Lay it by dragging.' },
    kind: 'fence', category: 'colony', w: 1, h: 1, needsZone: false, unlock: 'xp_guard',
    cost: [['iron_plate', 1]], ports: [],
  },
  glazed_ribbon: {
    name: { fr: 'Ruban vitré', en: 'Glazed Ribbon' },
    desc: { fr: 'Un ruban sous verre, aussi rapide que le ruban (60/min)\u00a0: les Glaneurs ne prennent rien de ce qu’il porte. Trace-le par-dessus un ruban pour le couvrir.', en: 'A ribbon under glass, as fast as the ribbon (60/min): the Gleaners take nothing it carries. Drag it over a ribbon to cover it.' },
    kind: 'belt', glazed: true, replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'xp_guard',
    cost: [['glass', 1]], ports: [], belt: { ticksPerTile: 6, perMin: 60 },
  },
  // ── appended (D109): the camouflaged ribbon ───────────────────────────────
  // Buried under the sand (owner, 2026-10-17: « un type de tapis camouflé qui permet de construire
  // des tapis même dans les zones qui ne t'appartiennent pas »): it may run over a neighbouring
  // base's open parcels (a sister claim's before D110; never through its buildings), costs the same anywhere (no remote ×3, `BAL.camoRemoteCostMult`), and the Gleaners walk
  // over it unseeing. Its price: slower than the plain ribbon (40/min), paid in plates and sand, and
  // flat (a traction ribbon still takes the steps). A drag lays it by itself where its land refuses
  // the dragged ribbon (systems/belt-plan.ts).
  camo_ribbon: {
    name: { fr: 'Ruban camouflé', en: 'Camouflaged Ribbon' },
    desc: { fr: 'Un ruban enfoui sous le sable, plus lent (40/min) : il passe aussi sur les terres libres d’une base voisine, sans surcoût hors de tes terres, et les Glaneurs marchent dessus sans le voir. Il ne monte pas les marches.', en: 'A ribbon buried under the sand, slower (40/min): it also runs across a neighbouring base’s open land, with no surcharge off your land, and the Gleaners walk over it unseeing. It does not climb steps.' },
    kind: 'belt', camo: true, replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'xp_camo',
    cost: [['iron_plate', 1], ['sand', 2]], ports: [], belt: { ticksPerTile: 9, perMin: 40 },
  },
  // ── appended (D123): the steel mill and the brickworks ────────────────────
  // Two Tier 1 works that take the basic resources one step further (owner, 2026-10-17: « on a vite
  // fait le tour des ressources de base »). The brickworks first: sand off the ground and water from
  // a pump (water's second use in Tier 1, D114), pressed and baked on power. Then the steel mill,
  // lined with its bricks: iron plates and coal blown into steel, on power — the frame of the
  // heavy machines, and the press's pipes. Each its one recipe (it starts on it, D83).
  brickworks: {
    name: { fr: 'Briqueterie', en: 'Brickworks' },
    desc: { fr: 'Moule le sable mouillé en briques et les cuit : un sable et deux eaux par brique. Le sable arrive par ruban, l’eau des pompes par conduit.', en: 'Moulds wet sand into bricks and bakes them: a sand and two waters a brick. Sand comes by ribbon, water from pumps by conduit.' },
    // onRock: by the Crown's tarn too, like the ceramic oven (D63), where the water is.
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, onRock: true, unlock: 'ex_brick', crafts: true, kw: 90, idleKw: 9,
    cost: [['iron_plate', 20], ['glass', 4], ['copper_wire', 4]], ports: [P(0, 1, 'S', 'in'), PW(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  steel_mill: {
    name: { fr: 'Aciérie', en: 'Steel Mill' },
    desc: { fr: 'Souffle deux plaques de fer et un charbon en un acier, dans un convertisseur garni de briques ; ses scories, bonnes à rien, sortent par la même sortie. Une fonderie suffit à la nourrir.', en: 'Blows two iron plates and a coal into one steel, in a brick-lined converter; its slag, good for nothing, leaves through the same output. One smelter is enough to feed it.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn_steel', crafts: true, kw: 150, idleKw: 15,
    cost: [['iron_plate', 20], ['brick', 20], ['copper_plate', 4]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  // ── appended (D129): the assembly bench ───────────────────────────────────
  // Tier 1's plain workbench, in the electronics workshop's place on the Production path (the
  // workshop went to Tier 2's research): it winds copper coils from its plan and, once Mechanics'
  // press makes gears, builds motors. « Établi », not « Atelier »: not to be taken for the assembly
  // workshop (`great_workshop`, « Atelier d'assemblage ») of Ceramics.
  assembly_bench: {
    name: { fr: 'Établi de montage', en: 'Assembly Bench' },
    desc: { fr: 'Un établi d’atelier : bobine le fil de cuivre sur un noyau de fer (deux fils et une plaque par bobine) et, avec la Mécanique, monte des moteurs électriques (deux bobines et un engrenage). Deux entrées à l’arrière.', en: 'A workshop bench: winds copper wire on an iron core (two wires and a plate a coil) and, with Mechanics, builds electric motors (two coils and a gear). Two inputs at the back.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'assembly_bench', crafts: true, kw: 60, idleKw: 6,
    cost: [['iron_plate', 20], ['copper_wire', 4]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  // ── appended (D155): the pressure gauge ───────────────────────────────────
  // A fitting set into a conduit (owner, 2026-10-19: « a special thing to attach to a conduit that will
  // tell the player the pressure in it »): a dial on the pipe whose needle reads its water network's
  // pumps against its drinkers (sim/readouts/pressure.ts). It carries the water as the conduit did; a
  // conduit laid back over it by a click takes it out. With the conduit's plan (Steam).
  pressure_gauge: {
    name: { fr: 'Manomètre', en: 'Pressure Gauge' },
    desc: { fr: 'Se pose sur un conduit et lit la pression de son réseau d’eau : ce que les pompes donnent contre ce que les machines boivent. Vert : assez ; ambre : juste ; rouge : trop peu, il faut plus de pompes ou une pompe haute pression.', en: 'Fits onto a conduit and reads its water network’s pressure: what the pumps give against what the machines drink. Green: enough; amber: tight; red: too little, add pumps or a high-pressure pump.' },
    kind: 'conduit', replaceGroup: 'fluid', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'steam', gauge: true,
    cost: [['iron_plate', 2], ['glass', 1], ['copper_wire', 1]], ports: [],
  },
} as const satisfies Record<string, BuildingDef>;

export type BuildingId = keyof typeof BUILDINGS;

/**
 * Height class (D124): the kinds drawn low enough for a skybridge to pass over without cutting
 * through them in the isometric view — line pieces and fences. Everything else is tall (a machine,
 * drill, store, generator, turbine, lab, server, post, mast or the Core), and so is any new kind
 * until it is listed here; a def may override its kind with `flat`.
 */
export const FLAT_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['belt', 'fork', 'crossing', 'bridge', 'conduit', 'fence']);
