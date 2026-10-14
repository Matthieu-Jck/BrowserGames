// buildings.ts — every building. Footprint w×h and ports are given for rot 0 (front = N);
// the engine rotates them. kw = draw while working, idleKw = draw while idle. replaceGroup =
// what it may be placed over (buildings of the same group wholly inside its footprint).
import type { BuildingDef, PortDef } from './types';

const P = (x: number, y: number, side: PortDef['side'], io: PortDef['io']): PortDef => ({ x, y, side, io });

export const BUILDINGS = {
  // ── colony ────────────────────────────────────────────────────────────────
  hearth: {
    name: { fr: 'Cœur', en: 'Heart' },
    desc: { fr: 'Le cœur de ta base : il reçoit sans jamais rendre, et son stock paie tes constructions (ou se vend par un Comptoir accolé). Son noyau isotopique donne 90 kW jour et nuit, son panneau solaire jusqu’à 240 kW de plus en plein jour ; il tend 6 fils jusqu’à 8 tuiles.', en: 'Your base’s core: it takes and never gives back, and its stock pays for your construction (or sells through a Trade Post set against it). Its isotope core gives 90 kW day and night, its solar panel up to 240 kW more in full sun; it holds 6 wires up to 8 tiles long.' },
    kind: 'hearth', category: 'colony', w: 5, h: 5, needsZone: false, cost: [], unlock: 'never',
    ports: [
      // Inputs only: the Heart takes, it never gives (owner, 2026-10-12) — machines are fed by
      // production lines, the Heart pays for construction and sells next to a trade post.
      P(1, 0, 'N', 'in'), P(2, 0, 'N', 'in'), P(3, 0, 'N', 'in'),
      P(1, 4, 'S', 'in'), P(2, 4, 'S', 'in'), P(3, 4, 'S', 'in'),
      P(4, 1, 'E', 'in'), P(4, 2, 'E', 'in'), P(4, 3, 'E', 'in'),
      P(0, 1, 'W', 'in'), P(0, 2, 'W', 'in'), P(0, 3, 'W', 'in'), // three a side, all round (owner, 2026-10-12)
    ],
    // gen.kw: the built-in solar panel's peak (BAL.hearthSolarKw wins; D25). A link point of 6 wires.
    gen: { kw: 240 }, pole: { range: 8, slots: 6 }, storageCap: 5000,
  },
  beacon: {
    name: { fr: "Balise d'arpentage", en: 'Survey Beacon' },
    desc: { fr: 'Dissipe le brouillard dans un rayon de 40 tuiles, pour repérer gisements et passages. Se pose aussi hors de vos terres, sans énergie.', en: 'Lifts the fog within 40 tiles, to scout deposits and passes. Can stand off your land and needs no power.' },
    kind: 'beacon', category: 'colony', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'beacon',
    cost: [['iron_plate', 5], ['glass', 2]], ports: [], reveal: 40,
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
    cost: [['ceramic', 30], ['thermal_core', 4], ['gear', 10]],
    ports: [P(0, 0, 'N', 'out'), P(2, 0, 'N', 'out')], drill: { perMin: 45, capMult: 1500 },
  },
  excavator: {
    name: { fr: 'Excavatrice', en: 'Excavator' },
    desc: { fr: 'Creuse la roche marquée avec Aménager, jusqu’à 18 tuiles d’elle : du terrain à bâtir. La pierre sort à l’arrière, le minerai enfoui file au Cœur.', en: 'Digs the rock you mark with Landscape, up to 18 tiles away: new land to build on. Stone leaves at the back; ore buried in the rock goes to the Heart.' },
    kind: 'excavator', category: 'extraction', w: 3, h: 3, needsZone: true, unlock: 'tr2', kw: 240, idleKw: 24,
    cost: [['iron_plate', 30], ['gear', 10], ['circuit', 4]], ports: [P(1, 2, 'S', 'out')],
  },
  pump: {
    name: { fr: 'Pompe à eau', en: 'Water Pump' },
    desc: { fr: 'Au bord de l’eau, pompe 60 eau/min dans un conduit. L’eau ne voyage pas sur les rubans.', en: 'At the water’s edge, pumps 60 water/min into a conduit. Water does not ride ribbons.' },
    kind: 'pump', category: 'extraction', w: 1, h: 1, needsZone: true, unlock: 'tr3', kw: 30, idleKw: 3,
    cost: [['iron_plate', 5], ['glass', 2]], ports: [P(0, 0, 'N', 'out')],
  },
  backfiller: {
    name: { fr: 'Remblayeuse', en: 'Backfiller' },
    desc: { fr: 'Comble l’eau et les salines marquées avec Aménager, jusqu’à 8 tuiles d’elle, avec la pierre qu’un ruban lui apporte : du terrain gagné.', en: 'Fills the water and salt flats you mark with Landscape, up to 8 tiles away, with stone brought in by ribbon: reclaimed land.' },
    kind: 'backfiller', category: 'extraction', w: 2, h: 2, needsZone: true, unlock: 'ex3', kw: 150, idleKw: 15,
    cost: [['iron_plate', 20], ['gear', 10], ['ceramic', 10]], ports: [P(0, 1, 'S', 'in')],
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
    desc: { fr: 'Monte ou descend les objets d’un gradin, vers la case qu’il regarde : le seul passage d’un niveau à l’autre, plus lent qu’un ruban (30/min). Il se pose aussi sur la roche.', en: 'Lifts items one terrace up or down, to the tile it faces: the only way from one level to another, slower than a ribbon (30/min). It stands on rock too.' },
    kind: 'belt', lift: true, replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'traction',
    cost: [['iron_plate', 2], ['copper_wire', 1]], ports: [], belt: { ticksPerTile: 12, perMin: 30 },
  },
  swift_ribbon: {
    name: { fr: 'Ruban vif', en: 'Swift Ribbon' },
    desc: { fr: 'Un ruban deux fois plus rapide : 120/min. Trace-le par-dessus un ruban pour l’améliorer.', en: 'A ribbon twice as fast: 120/min. Drag it over a ribbon to upgrade it.' },
    kind: 'belt', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'dn1',
    cost: [['iron_plate', 1], ['gear', 1]], ports: [], belt: { ticksPerTile: 4, perMin: 120 },
  },
  express_ribbon: {
    name: { fr: 'Ruban express', en: 'Express Ribbon' },
    desc: { fr: 'Le ruban le plus rapide : 240/min. Trace-le par-dessus un autre ruban pour l’améliorer.', en: 'The fastest ribbon: 240/min. Drag it over another ribbon to upgrade it.' },
    kind: 'belt', replaceGroup: 'transport', category: 'logistics', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'dn6',
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
  unloader: {
    name: { fr: 'Déchargeur', en: 'Unloader' },
    desc: { fr: 'Collé à une réserve (Cœur, silo…), en sort l’objet choisi vers les rubans et machines qui le touchent. Choisis l’objet dans l’inspecteur.', en: 'Set against a store (the Heart, a silo…), takes out the chosen item to the ribbons and machines touching it. Pick the item in the inspector.' },
    kind: 'fork', logic: 'unloader', replaceGroup: 'transport', category: 'distribution', w: 1, h: 1, needsZone: false, unlock: 'unloader',
    cost: [['iron_plate', 2], ['copper_wire', 1]], ports: [],
  },
  distributor: {
    name: { fr: 'Distributeur', en: 'Distributor' },
    desc: { fr: 'Un grand routeur 2×2 : prend de tous côtés et rend sur tous les autres, avec un plus grand tampon. Se pose par-dessus quatre routeurs ou des rubans, qu’il remplace.', en: 'A big 2×2 router: takes from every side and deals out to all the others, with a bigger buffer. Can be placed over four routers or ribbons, replacing them.' },
    kind: 'fork', logic: 'distributor', replaceGroup: 'transport', category: 'distribution', w: 2, h: 2, needsZone: false, unlock: 'dn5',
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
    desc: { fr: 'Le ruban de l’eau : 240/min, des pompes au four à céramique. Ne porte que des fluides ; se trace en glissant.', en: 'The water ribbon: 240/min, from pumps to the ceramic oven. Carries fluids only; lay it by dragging.' },
    kind: 'conduit', replaceGroup: 'fluid', category: 'logistics', w: 1, h: 1, needsZone: false, unlock: 'tr3',
    cost: [['ceramic', 1]], ports: [], belt: { ticksPerTile: 2, perMin: 240 },
  },
  silo: {
    name: { fr: 'Silo', en: 'Silo' },
    desc: { fr: 'Stocke jusqu’à 1 000 objets d’une seule sorte : entrées à l’arrière, sorties à l’avant. Un tampon entre deux chaînes, que ses sorties vident d’elles-mêmes.', en: 'Holds up to 1,000 items of a single kind: in at the back, out at the front. A buffer between two lines; its outputs empty it by themselves.' },
    kind: 'storage', category: 'logistics', w: 2, h: 2, needsZone: true, unlock: 'silo',
    cost: [['iron_plate', 8], ['glass', 2]],
    ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out'), P(1, 0, 'N', 'out')], storageCap: 1000,
  },
  skydock: {
    name: { fr: 'Embarcadère', en: 'Skydock' },
    desc: { fr: 'Mât d’amarrage des Dérivants, cargos volants sans équipage : achètes-en jusqu’à 4 et ouvre des routes de fret vers un autre embarcadère, pour transporter loin sans rubans.', en: 'Mooring mast for the Drifters, uncrewed freight airships: buy up to 4 and open freight routes to another skydock, to haul goods far without ribbons.' },
    kind: 'dock', category: 'logistics', w: 3, h: 3, needsZone: true, unlock: 'tr6', kw: 200, idleKw: 20,
    cost: [['ceramic', 40], ['gear', 20], ['lens', 10]],
    ports: [P(0, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(0, 0, 'N', 'out'), P(2, 0, 'N', 'out')],
  },

  // ── production ────────────────────────────────────────────────────────────
  kiln: {
    name: { fr: 'Fonderie', en: 'Smelter' },
    desc: { fr: 'Fond le minerai de fer en plaques et le sable en verre, en brûlant du charbon : pas besoin d’électricité. Amène minerai et charbon à ses deux entrées, à l’arrière.', en: 'Smelts iron ore into plates and sand into glass by burning coal: no power needed. Bring ore and coal to its two inputs at the back.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'kiln', crafts: true,
    cost: [['iron_plate', 15]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  kiln_compact: {
    name: { fr: 'Fonderie compacte', en: 'Compact Smelter' },
    desc: { fr: 'La fonderie sur 1×2, avec une entrée à l’arrière et une sur le côté. Mêmes recettes, sans électricité.', en: 'The smelter on 1×2, with one input at the back and one on the side. Same recipes, no power.' },
    kind: 'machine', category: 'production', w: 1, h: 2, needsZone: true, unlock: 'dn3', crafts: true,
    cost: [['iron_plate', 15], ['gear', 2]], ports: [P(0, 1, 'S', 'in'), P(0, 1, 'E', 'in'), P(0, 0, 'N', 'out')],
  },
  wire_mill: {
    name: { fr: 'Tréfileuse', en: 'Wire Mill' },
    desc: { fr: 'Tire deux fils de cuivre de chaque minerai de cuivre. Le cuivre du cirque est maigre : prévois d’en acheter.', en: 'Draws two copper wires from each copper ore. Copper is scarce in the cirque: plan to buy some.' },
    kind: 'machine', category: 'production', w: 1, h: 2, needsZone: true, unlock: 'wire_mill', crafts: true, kw: 60, idleKw: 6,
    cost: [['iron_plate', 15], ['glass', 4]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  workshop: {
    name: { fr: 'Atelier', en: 'Workshop' },
    desc: { fr: 'Fabrique avec deux entrées : données d’arpentage pour la recherche, circuits imprimés… Choisis la recette dans l’inspecteur.', en: 'Crafts from two inputs: survey data for research, circuit boards… Pick the recipe in the inspector.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'workshop', crafts: true, kw: 120, idleKw: 12,
    cost: [['iron_plate', 20], ['glass', 4], ['copper_wire', 6]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  great_workshop: {
    name: { fr: 'Grand atelier', en: 'Great Workshop' },
    desc: { fr: 'Fabrique avec trois entrées : tout ce que fait l’atelier, plus les données mécaniques et, avec la recherche, des pièces plus avancées.', en: 'Crafts from three inputs: everything the workshop makes, plus mechanics data and, with research, more advanced parts.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'tr1', crafts: true, kw: 240, idleKw: 24,
    cost: [['iron_plate', 40], ['gear', 10], ['circuit', 10]],
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  great_workshop_compact: {
    name: { fr: 'Grand atelier compact', en: 'Compact Great Workshop' },
    desc: { fr: 'Le grand atelier sur 2×2, avec deux entrées à l’arrière et une sur le côté. Mêmes recettes.', en: 'The great workshop on 2×2, with two inputs at the back and one on the side. Same recipes.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'dn3', crafts: true, kw: 240, idleKw: 24,
    cost: [['iron_plate', 40], ['gear', 12], ['circuit', 12]],
    ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 1, 'W', 'in'), P(1, 0, 'N', 'out')],
  },
  tower_workshop: {
    name: { fr: 'Atelier-tour', en: 'Tower Workshop' },
    desc: { fr: 'Les recettes du grand atelier, quatre fois plus vite. Très gourmand : 900 kW en marche.', en: 'The great workshop’s recipes, four times as fast. Very hungry: 900 kW while running.' },
    kind: 'machine', category: 'production', w: 3, h: 3, needsZone: true, unlock: 'dn8', crafts: true, kw: 900, idleKw: 90,
    cost: [['circuit', 40], ['resonator', 10]],
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(1, 0, 'N', 'out')],
  },
  ceramic_oven: {
    name: { fr: 'Four à céramique', en: 'Ceramic Oven' },
    desc: { fr: 'Cuit la pierre et l’eau en céramique. La pierre vient des excavatrices, l’eau des pompes par conduit.', en: 'Fires stone and water into ceramic. Stone comes from excavators, water from pumps by conduit.' },
    kind: 'machine', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'tr3', crafts: true, kw: 120, idleKw: 12,
    cost: [['iron_plate', 25], ['gear', 6]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  observatory: {
    name: { fr: 'Observatoire', en: 'Observatory' },
    desc: { fr: 'Station automatique : transmet aux laboratoires de Verrière les données d’un projet de recherche. Lance le projet dans l’arbre des techniques (T), puis apporte-lui par ruban les données qu’il demande.', en: 'An automated station: uplinks one research project’s data to the labs in Verrière. Start the project in the tech tree (T), then bring it the data it asks for by ribbon.' },
    kind: 'lab', category: 'production', w: 2, h: 2, needsZone: true, unlock: 'observatory', kw: 150, idleKw: 15,
    cost: [['iron_plate', 30], ['glass', 20], ['copper_wire', 10]], ports: [P(0, 1, 'S', 'in'), P(1, 1, 'S', 'in')],
  },

  // ── energy ────────────────────────────────────────────────────────────────
  mast: {
    name: { fr: 'Poteau', en: 'Pole' },
    desc: { fr: 'Porte le courant : 8 fils jusqu’à 6 tuiles. Relie-le (outil Relier, L) au Cœur, à d’autres poteaux et aux bâtiments à alimenter.', en: 'Carries power: 8 wires up to 6 tiles long. Link it (Link tool, L) to the Heart, other poles and the buildings to power.' },
    kind: 'pole', replaceGroup: 'power', category: 'energy', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'start',
    cost: [['iron_plate', 2], ['copper_wire', 1]], ports: [], pole: { range: 6, slots: 8 },
  },
  pylon: {
    name: { fr: 'Pylône', en: 'Pylon' },
    desc: { fr: 'Un poteau de longue portée : 4 fils jusqu’à 24 tuiles (40 avec Pylônes renforcés).', en: 'A long-reach pole: 4 wires up to 24 tiles long (40 with Reinforced Pylons).' },
    kind: 'pole', replaceGroup: 'power', category: 'energy', w: 1, h: 1, needsZone: false, onRock: true, unlock: 'tr4',
    cost: [['iron_plate', 8], ['copper_wire', 6], ['ceramic', 2]], ports: [], pole: { range: 24, slots: 4, tall: true },
  },
  brazier: {
    name: { fr: 'Générateur à charbon', en: 'Coal Generator' },
    desc: { fr: 'Brûle du charbon pour l’électricité : 300 kW à plein régime pour 10 charbon/min. Il ne brûle que ce que le réseau demande.', en: 'Burns coal for power: 300 kW at full output for 10 coal/min. It burns only what the grid asks for.' },
    kind: 'generator', category: 'energy', w: 1, h: 2, needsZone: true, unlock: 'brazier',
    cost: [['iron_plate', 20], ['copper_wire', 4]], ports: [P(0, 1, 'S', 'in')],
    gen: { kw: 300, fuel: 'coal', fuelPerMin: 10 },
  },
  wind_flower: {
    name: { fr: 'Éolienne', en: 'Wind Turbine' },
    desc: { fr: 'De l’électricité gratuite : 120 kW × le vent local, qui varie avec les rafales. Au fond du cirque, abrité, elle ne donne presque rien (×0,25) ; sur la Couronne, le Souffle porte (×1,4 à ×2, plus la roche est haute).', en: 'Free power: 120 kW × the local wind, which varies with the gusts. Down in the sheltered cirque it gives next to nothing (×0.25); on the Crown the Sough blows (×1.4 to ×2, the higher the rock the more).' },
    kind: 'wind', category: 'energy', w: 2, h: 2, needsZone: true, onRock: true, unlock: 'wind_flower',
    cost: [['iron_plate', 10], ['glass', 4], ['copper_wire', 6]], ports: [], gen: { kw: 120 },
  },
  sun_bulb: {
    name: { fr: 'Panneau solaire', en: 'Solar Panel' },
    desc: { fr: 'De l’électricité gratuite le jour : 150 kW en plein soleil, rien la nuit. À doubler d’accumulateurs pour la nuit.', en: 'Free power by day: 150 kW in full sun, nothing at night. Pair it with accumulators for the night.' },
    kind: 'solar', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'en2',
    cost: [['iron_plate', 6], ['glass', 12], ['copper_wire', 4]], ports: [], gen: { kw: 150 },
  },
  accumulator: {
    name: { fr: 'Accumulateur', en: 'Accumulator' },
    desc: { fr: 'La batterie du réseau : se remplit des surplus et les rend quand la demande dépasse la production. 1 200 kW·min, 300 kW au plus.', en: 'The grid’s battery: fills up with surplus power and gives it back when demand outruns supply. 1,200 kW·min, 300 kW at most.' },
    kind: 'accumulator', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'tr3',
    cost: [['ceramic', 10], ['empty_cell', 4], ['circuit', 6]], ports: [], accumulator: { kwMin: 1200, kw: 300 },
  },
  cell_charger: {
    name: { fr: 'Chargeur', en: 'Battery Charger' },
    desc: { fr: 'Charge une batterie vide en 2 minutes à 300 kW : de l’énergie en boîte, à vendre à la Criée.', en: 'Charges an empty battery in 2 minutes at 300 kW: boxed energy to sell at the Crier Ring.' },
    kind: 'machine', category: 'energy', w: 2, h: 2, needsZone: true, unlock: 'en4', crafts: true, kw: 300, idleKw: 10,
    cost: [['ceramic', 10], ['circuit', 6]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
  },
  fumarole_tap: {
    name: { fr: 'Centrale géothermique', en: 'Geothermal Plant' },
    desc: { fr: 'Géothermie : 1,5 MW jour et nuit, sans combustible. Se pose uniquement sur un évent.', en: 'Geothermal: 1.5 MW day and night, no fuel. Only stands on a vent.' },
    kind: 'geothermal', category: 'energy', w: 3, h: 3, needsZone: true, unlock: 'en5',
    cost: [['ceramic', 20], ['thermal_core', 4], ['circuit', 10]], ports: [], gen: { kw: 1500 },
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
    desc: { fr: 'L’aire de levage de CrierBelt : vend chaque minute ce que ses rubans apportent (tes flux d’export) et reçoit tes achats. Accolée au Cœur, elle commerce directement avec son stock.', en: 'CrierBelt’s cargo lift pad: sells each minute what its ribbons bring in (your export streams) and receives what you buy. Next to the Heart, it trades straight from its stock.' },
    kind: 'trade', category: 'commerce', w: 3, h: 3, needsZone: true, unlock: 'trade_post', kw: 100, idleKw: 10,
    cost: [['iron_plate', 40], ['glass', 10], ['copper_wire', 10]],
    ports: [P(0, 2, 'S', 'in'), P(1, 2, 'S', 'in'), P(2, 2, 'S', 'in'), P(0, 1, 'W', 'in'), P(0, 0, 'N', 'out'), P(2, 0, 'N', 'out')],
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
} as const satisfies Record<string, BuildingDef>;

export type BuildingId = keyof typeof BUILDINGS;
