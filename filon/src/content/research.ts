// research.ts — the one unlock tree (D33): everything the base uses beyond its starting kit
// (drill, ribbon, pole and the Link tool) is unlocked here, in two kinds of node.
//   · PLANS: instant unlocks paid with materials from the Heart, Mindustry-style — no
//     observatory, no time. Cheap near the root (the starting stock affords every root plan),
//     dearer deeper; six paths of one theme each (D41: production, logistics, energy,
//     analytics, trade, survey — `PLAN_PATHS`), each growing from one entry. Unlocking one is
//     the `unlockPlan` command (src/sim/systems/research.ts).
//   · RESEARCH: the tree's advanced part, unchanged in its rules — a trunk and five branches
//     (Excavation, Expansion, Density, Energy, Commerce), 8 nodes + a keystone each, paid in data
//     by observatories over a minimum time. Its roots hang under the observatory's plan.
// What a node unlocks is derived from the `unlock` field of buildings and recipes (and BAL's
// Heart levels); plan and research ids share one namespace and one `sim.done` set.
import { BUILDINGS } from './buildings';
import type { BuildingDef, Effect, Loc, PlanDef, PlanLane, ResearchDef } from './types';

type Cost = ReadonlyArray<readonly [string, number]>;

/** Base science cost and minimum duration (minutes) by branch depth (9 = keystone). */
export const DEPTH_COST: Record<number, { cost: Cost; minutes: number }> = {
  1: { cost: [['journal_1', 25]], minutes: 3 },
  2: { cost: [['journal_1', 80]], minutes: 15 },
  3: { cost: [['journal_1', 60], ['journal_2', 40]], minutes: 45 },
  4: { cost: [['journal_2', 150]], minutes: 120 },
  5: { cost: [['journal_2', 100], ['atlas', 40]], minutes: 240 },
  6: { cost: [['atlas', 150]], minutes: 480 },
  7: { cost: [['atlas', 150], ['codex', 20]], minutes: 720 },
  8: { cost: [['codex', 80]], minutes: 1080 },
  9: { cost: [['atlas', 300], ['codex', 150]], minutes: 1440 },
};

/** Trunk gate required by a branch node of this depth. */
const gate = (depth: number): string | null => (depth >= 7 ? 'tr8' : depth >= 5 ? 'tr6' : depth >= 3 ? 'tr1' : null);

type Branch = 'ex' | 'xp' | 'dn' | 'en' | 'cm';

/** The plan research hangs from: no observatory, no research (D33). */
const OBSERVATORY = 'observatory';

function node(
  branch: Branch, depth: number,
  name: [string, string], desc: [string, string], effects: Effect[] = [],
): ResearchDef {
  const prereq: string[] = [];
  if (depth > 1) prereq.push(`${branch}${depth === 9 ? 8 : depth - 1}`);
  else prereq.push(OBSERVATORY); // a branch root: research starts with the observatory's plan
  const g = gate(depth);
  if (g) prereq.push(g);
  const base = DEPTH_COST[depth]!;
  return { name: { fr: name[0], en: name[1] }, desc: { fr: desc[0], en: desc[1] }, branch, depth, prereq, cost: base.cost, minutes: base.minutes, effects };
}

function trunk(depth: number, prereq: string[], cost: Cost, minutes: number, name: [string, string], desc: [string, string], effects: Effect[] = []): ResearchDef {
  return { name: { fr: name[0], en: name[1] }, desc: { fr: desc[0], en: desc[1] }, branch: 'trunk', depth, prereq, cost, minutes, effects };
}

const mul = (target: Extract<Effect, { k: 'mul' }>['target'], permille: number): Effect => ({ k: 'mul', target, permille });
const add = (target: Extract<Effect, { k: 'add' }>['target'], v: number): Effect => ({ k: 'add', target, v });
const flag = (f: string): Effect => ({ k: 'flag', flag: f });

export const RESEARCH = {
  // ── trunk ────────────────────────────────────────────────────────────────
  tr1: trunk(1, [OBSERVATORY], [['journal_1', 30]], 5, ['Mécanique', 'Mechanics'],
    ['Grand atelier, engrenages, données mécaniques ; Cœur niveau 2.', 'Great workshop, gears, mechanics data; Heart level 2.']),
  tr2: trunk(2, ['tr1'], [['journal_1', 40]], 10, ['Terrassement', 'Earthworks'],
    ['Excavatrice : creuser le grès et le basalte (H1–H2).', 'Excavator: dig sandstone and basalt (H1–H2).']),
  tr3: trunk(3, ['tr1'], [['journal_2', 30]], 30, ['Céramique', 'Ceramics'],
    ['Four à céramique, pompes et conduits, batteries vides, accumulateurs.', 'Ceramic oven, pumps and conduits, empty batteries, accumulators.']),
  tr4: trunk(4, ['tr3'], [['journal_2', 60]], 60, ['Cadastre', 'Land Registry'],
    ['Baux de parcelles, pylônes ; Cœur niveau 3.', 'Parcel leases, pylons; Heart level 3.'], [flag('lease')]),
  tr5: trunk(5, ['tr4'], [['journal_2', 100]], 120, ['Deuxième pupitre', 'Second Desk'],
    ['Un deuxième emplacement de recherche.', 'A second research slot.'], [{ k: 'slots', add: 1 }]),
  tr6: trunk(6, ['tr4'], [['journal_2', 150]], 240, ['Cartographie', 'Atlas Lore'],
    ['Atlas, lentilles, toiles, cœurs thermiques, Embarcadère ; Cœur niveau 4.', 'Atlases, lenses, canvas, thermal cores, Skydock; Heart level 4.']),
  tr7: trunk(7, ['tr6'], [['atlas', 80]], 720, ['Troisième pupitre', 'Third Desk'],
    ['Un troisième emplacement de recherche.', 'A third research slot.'], [{ k: 'slots', add: 1 }]),
  tr8: trunk(8, ['tr6'], [['atlas', 150]], 1440, ['Codex', 'Codex Lore'],
    ['Codex, résonateurs, treillis de nacre.', 'Codex, resonators, nacre lattices.']),

  // ── Excavation — Taille ──────────────────────────────────────────────────
  ex1: node('ex', 1, ['Pics trempés', 'Tempered Picks'], ['Creusage +25 %, pierre +20 %.', 'Digging +25%, stone +20%.'], [mul('digSpeed', 1250), mul('rubbleYield', 1200)]),
  ex2: node('ex', 2, ['Tamisage', 'Sifting'], ['Minerai enchâssé +50 %.', 'Embedded ore +50%.'], [mul('embeddedOre', 1500)]),
  ex3: node('ex', 3, ['Remblai', 'Backfill'], ['Débloque la Remblayeuse.', 'Unlocks the Backfiller.']),
  ex4: node('ex', 4, ['Forets à basalte', 'Basalt Bits'], ['Obsidienne (H3) creusable ; basalte +50 %.', 'Obsidian (H3) diggable; basalt +50%.'], [flag('digH3'), flag('basaltBits')]),
  ex5: node('ex', 5, ['Puits profond', 'Deep Bore'], ['Débloque la Foreuse profonde.', 'Unlocks the Deep Bore.']),
  ex6: node('ex', 6, ['Galeries', 'Tunnels'], ['Tunnels d’une tuile 4× plus rapides (rubans et conduits).', 'One-tile tunnels 4× faster (ribbons and conduits).'], [flag('tunnels')]),
  ex7: node('ex', 7, ['Taille-cœur', 'Heartrock Cutters'], ['Cœur-de-roche (H4) creusable ; creusage +50 %.', 'Heartrock (H4) diggable; digging +50%.'], [flag('digH4'), mul('digSpeed', 1500)]),
  ex8: node('ex', 8, ['Remblai profond', 'Deep Fill'], ['Remblai en eau profonde (120 pierres/tuile).', 'Backfill deep water (120 stone/tile).'], [flag('deepFill')]),
  exK: node('ex', 9, ['Le Grand Évidement', 'The Great Hollowing'], ['Creusage ×2 ; bâtiments sur sol creusé +20 % de vitesse.', 'Digging ×2; buildings on dug floor +20% speed.'], [mul('digSpeed', 2000), mul('excavatedSpeed', 1200)]),

  // ── Expansion — Arpentage ────────────────────────────────────────────────
  xp1: node('xp', 1, ['Bornage', 'Boundary Stones'], ['Terrain −15 %.', 'Land −15%.'], [mul('landPrice', 850)]),
  xp2: node('xp', 2, ['Relais de drones', 'Drone Relays'], ['Rubans hors de vos terres ×1,5 au lieu de ×3 ; chantiers lointains 2× plus rapides.', 'Ribbons off your land ×1.5 instead of ×3; remote building 2× faster.'], [mul('remoteBeltCost', 500), mul('remoteBuildDelay', 500)]),
  xp3: node('xp', 3, ['Charte foncière', 'Land Charter'], ['Chaque parcelle achetée renchérit la suivante de 6 % au lieu de 10 %.', 'Each parcel bought raises the next one’s price 6% instead of 10%.'], [add('landGrowth', -40)]),
  xp4: node('xp', 4, ['Pylônes renforcés', 'Reinforced Pylons'], ['Portée des pylônes 40.', 'Pylon reach 40.'], [add('pylonLink', 16)]),
  xp5: node('xp', 5, ['Embarcadères II', 'Docks II'], ['+2 Dérivants par embarcadère, capacité +50 %.', '+2 Drifters per dock, capacity +50%.'], [add('dockShips', 2), mul('shipCap', 1500)]),
  xp6: node('xp', 6, ['Pilotes du Souffle', 'Sough Pilots'], ['Vitesse des Dérivants +40 %.', 'Drifter speed +40%.'], [mul('shipSpeed', 1400)]),
  xp7: node('xp', 7, ['Fédération', 'Federation'], ['Loyers −30 % ; chaque parcelle achetée renchérit la suivante de 4 %.', 'Rent −30%; each parcel bought raises the next one’s price 4%.'], [mul('landRent', 700), add('landGrowth', -20)]),
  xp8: node('xp', 8, ['Concessions lointaines', 'Far Claims'], ['Plafonds au-delà de r 320 +30 % ; terrain lointain −30 %.', 'Caps beyond r 320 +30%; far land −30%.'], [mul('ring3Caps', 1300), mul('farLand', 700)]),
  xpK: node('xp', 9, ['La Ville-Caravane', 'Caravan City'], ['Routes de Dérivants comptées à mi-distance ; loyers −20 %.', 'Drifter routes count half distance; rent −20%.'], [mul('drifterDistance', 500), mul('landRent', 800)]),

  // ── Density — Densité ────────────────────────────────────────────────────
  dn1: node('dn', 1, ['Tissage', 'Ribbon Weave'], ['Débloque le Ruban vif (120/min).', 'Unlocks the Swift Ribbon (120/min).']),
  dn2: node('dn', 2, ['Passerelles longues', 'Long Bridges'], ['Passerelles : portée 8.', 'Bridges reach 8.'], [add('bridgeSpan', 4), flag('forkFilters')]),
  dn3: node('dn', 3, ['Machines compactes', 'Compact Machines'], ['Grand atelier 2×2, fonderie 1×2.', 'Great workshop 2×2, smelter 1×2.']),
  dn4: node('dn', 4, ['Allure', 'Pace'], ['1 emplacement de module : un module de vitesse donne +30 % de vitesse, +40 % d’énergie.', '1 module slot: a speed module gives +30% speed, +40% power.'], [flag('modules1')]),
  dn5: node('dn', 5, ['Distributeurs', 'Distributors'], ['Débloque le Distributeur (routeur 2×2).', 'Unlocks the Distributor (a 2×2 router).']),
  dn6: node('dn', 6, ['Ruban express', 'Express Ribbon'], ['Débloque le Ruban express (240/min).', 'Unlocks the Express Ribbon (240/min).']),
  dn7: node('dn', 7, ['Allure II', 'Pace II'], ['2 emplacements de module, +50 % chacun.', '2 module slots, +50% each.'], [flag('modules2')]),
  dn8: node('dn', 8, ['Atelier-tour', 'Tower Workshop'], ['Débloque l’Atelier-tour.', 'Unlocks the Tower Workshop.']),
  dnK: node('dn', 9, ['La Cité-Ruche', 'Hive City'], ['Fabrication +25 % ; +1 emplacement de recherche.', 'Crafting +25%; +1 research slot.'], [mul('craftSpeed', 1250), { k: 'slots', add: 1 }]),

  // ── Energy — Souffle ─────────────────────────────────────────────────────
  en1: node('en', 1, ['Pales orientables', 'Blade Pitch'], ['Éolien +30 %.', 'Wind +30%.'], [mul('windOut', 1300)]),
  en2: node('en', 2, ['Panneaux solaires', 'Solar Panels'], ['Débloque le Panneau solaire.', 'Unlocks the Solar Panel.']),
  en3: node('en', 3, ['Accumulateurs doubles', 'Double Accumulators'], ['Capacité des accumulateurs ×2, débit 500 kW.', 'Accumulator capacity ×2, 500 kW rate.'], [mul('accCap', 2000), mul('accRate', 1667)]),
  en4: node('en', 4, ['Chargeur', 'Battery Charging'], ['Débloque le Chargeur et la batterie chargée.', 'Unlocks the Battery Charger and charged batteries.']),
  en5: node('en', 5, ['Géothermie', 'Geothermal Power'], ['Débloque la Centrale géothermique, sur les évents.', 'Unlocks the Geothermal Plant, on vents.']),
  en6: node('en', 6, ['Réseaux de lentilles', 'Lens Arrays'], ['Solaire +60 %, 20 % de production la nuit.', 'Solar +60%, 20% output at night.'], [mul('solarOut', 1600), add('solarNight', 200)]),
  en7: node('en', 7, ['Moisson d’orage', 'Storm Harvest'], ['Éolien +50 % sur les plateaux ; rafales deux fois moins irrégulières.', 'Wind +50% on plateaus; gusts half as erratic.'], [flag('stormHarvest'), mul('gustVariance', 500)]),
  en8: node('en', 8, ['Chaleur profonde', 'Deep Heat'], ['Géothermie +50 % ; évents dormants utilisables.', 'Geothermal +50%; dormant vents usable.'], [mul('geoOut', 1500), flag('deepHeat')]),
  enK: node('en', 9, ['Le Cœur-Soleil', 'The Sunheart'], ['Débloque le Cœur-Soleil ; tous les générateurs +20 %.', 'Unlocks the Sunheart; all generators +20%.'], [mul('genOut', 1200)]),

  // ── Commerce — Criée ─────────────────────────────────────────────────────
  cm1: node('cm', 1, ['Ardoise de courtier', 'Broker’s Slate'], ['Prévision des cours à 6 h.', '6-hour price forecast.'], [flag('forecast')]),
  cm2: node('cm', 2, ['Ordres permanents', 'Standing Orders'], ['6 ordres d’import.', '6 import orders.'], [add('orders', 4)]),
  cm3: node('cm', 3, ['Second quai', 'Second Wharf'], ['Comptoir niveau 2 (240/min) ; un second comptoir autorisé.', 'Trade post level 2 (240/min); a second post allowed.'], [flag('tradeL2')]),
  cm4: node('cm', 4, ['Contrats à terme', 'Forward Contracts'], ['3 contrats à prix bloqué pendant 24 h.', '3 contracts at a locked price for 24 h.'], [flag('forwards')]),
  cm5: node('cm', 5, ['Coursiers express', 'Express Couriers'], ['Délais de livraison −40 %.', 'Delivery delays −40%.'], [mul('deliveryDelay', 600)]),
  cm6: node('cm', 6, ['Flair', 'Market Sense'], ['Glissement au comptant −30 %.', 'Spot slippage −30%.'], [mul('slippage', 700)]),
  cm7: node('cm', 7, ['Chartes de concession', 'Claim Charters'], ['Contrats de gros des concessions sœurs à +25 %.', 'Sister-claim bulk contracts at +25%.'], [flag('charters')]),
  cm8: node('cm', 8, ['Grand comptoir', 'Grand Post'], ['Comptoir niveau 3 (480/min).', 'Trade post level 3 (480/min).'], [flag('tradeL3')]),
  cmK: node('cm', 9, ['La Maison de Criée', 'The Crier House'], ['Tes propres ordres à cours limite, remplis par les concessions sœurs.', 'Your own limit orders, filled by sister claims.'], [flag('crierHouse')]),
} as const satisfies Record<string, ResearchDef>;

export type ResearchId = keyof typeof RESEARCH;

/** Each branch's "core stat" that mastery tiers boost. */
export const BRANCH_CORE: Record<Branch, Extract<Effect, { k: 'mul' }>['target']> = {
  ex: 'digSpeed', xp: 'shipSpeed', dn: 'craftSpeed', en: 'genOut', cm: 'slippage',
};

// ── plans (D33) ─────────────────────────────────────────────────────────────
// Instant unlocks paid from the Heart. Each id names the plan; by default a plan is named after
// the building it unlocks (`unlock: '<plan id>'` on that building). Root plans (no prerequisite)
// are cheap — the starting stock (120 plates, 40 glass, 60 copper wire) affords them all at once
// and still keeps CrierBelt's restart reserve (D36) — and costs grow with depth. Plans are
// declared path by path, in `PLAN_PATHS` order (the tree's bands, top to bottom), so the first
// plan ready to take is the topmost; effects apply in this order (they are flags: it never matters).
const plan = (lane: PlanDef['lane'], prereq: string[], cost: Array<[string, number]>, more: Partial<PlanDef> = {}): PlanDef =>
  ({ lane, prereq, cost, ...more });

export const PLANS = {
  // ── production: smelting, crafting, and the observatory that opens research ─
  kiln: plan('production', [], [['iron_plate', 10]]),
  sand_collector: plan('production', ['kiln'], [['iron_plate', 5]]), // sand off the bare ground, for glass (2026-10-12)
  workshop: plan('production', ['kiln'], [['iron_plate', 15], ['glass', 2]]),
  wire_mill: plan('production', ['kiln'], [['iron_plate', 15]]),
  observatory: plan('production', ['workshop'], [['iron_plate', 20], ['copper_wire', 4]]),

  // ── logistics: moving and sorting goods, the routing vocabulary (D20), from the router out.
  // Cheap (owner, 2026-10-12: "most of the logistics is too expensive"): a few plates, the
  // routing blocks two copper wires more.
  router: plan('logistics', [], [['iron_plate', 5]]),
  junction: plan('logistics', ['router'], [['iron_plate', 5]]),
  incinerator: plan('logistics', ['router'], [['iron_plate', 4]]), // a jammed line's way out (D51)
  traction: plan('logistics', ['router'], [['iron_plate', 4], ['copper_wire', 1]]),
  sorter: plan('logistics', ['router'], [['iron_plate', 6], ['copper_wire', 2]]),
  silo: plan('logistics', ['router'], [['iron_plate', 8], ['glass', 2]]),
  bridge: plan('logistics', ['junction'], [['iron_plate', 6], ['copper_wire', 2]]),
  inverted_sorter: plan('logistics', ['sorter'], [['iron_plate', 6], ['copper_wire', 2]]),
  overflow_gate: plan('logistics', ['sorter'], [['iron_plate', 6], ['copper_wire', 2]]),
  // Unloaders pull from stores (silos…), never from the Heart: they come after the silo.
  unloader: plan('logistics', ['silo'], [['iron_plate', 6], ['copper_wire', 2]]),
  underflow_gate: plan('logistics', ['overflow_gate'], [['iron_plate', 6], ['copper_wire', 2]]),

  // ── energy ────────────────────────────────────────────────────────────────
  wind_flower: plan('energy', [], [['iron_plate', 10]]),
  brazier: plan('energy', ['wind_flower'], [['iron_plate', 15], ['copper_wire', 2]]),

  // ── analytics (D41): what the base shows you, one readout per step. Each turns on its own
  // flag, named after it (`ANALYTICS` below); the UI reads them through src/ui/analytics.ts.
  // `telemetry` stays the first step (saves hold its id; the tutorial's quest 2 asks for it).
  telemetry: plan('analytics', [], [['iron_plate', 8], ['copper_wire', 2]], {
    name: { fr: 'Télémétrie', en: 'Telemetry' },
    desc: {
      fr: 'Les débits de ta base au HUD : ce que le Cœur gagne ou perd par minute, à côté de chaque stock.',
      en: 'Your base’s rates in the HUD: what the Heart gains or loses per minute, beside each stock.',
    },
    effects: [flag('telemetry')],
  }),
  statistics: plan('analytics', ['telemetry'], [['iron_plate', 10], ['copper_wire', 4]], {
    name: { fr: 'Registre de production', en: 'Production Ledger' },
    desc: {
      fr: 'L’écran Statistiques (G, ou sa puce au HUD) : ce que ta base fabrique et consomme, objet par objet, sur 1 min à 10 h.',
      en: 'The Statistics screen (G, or its chip in the HUD): what your base makes and uses, item by item, over 1 min to 10 h.',
    },
    effects: [flag('statistics')],
  }),
  power_log: plan('analytics', ['statistics'], [['iron_plate', 12], ['copper_wire', 4], ['glass', 2]], {
    name: { fr: 'Relevé d’énergie', en: 'Power Log' },
    desc: {
      fr: 'Dans les Statistiques, l’historique de l’énergie : la demande face à ce qui est disponible, jusqu’à 10 h en arrière.',
      en: 'In the Statistics, the power history: demand against what is available, up to 10 h back.',
    },
    effects: [flag('power_log')],
  }),
  diagnostics: plan('analytics', ['power_log'], [['iron_plate', 15], ['copper_wire', 6], ['glass', 2]], {
    name: { fr: 'Diagnostic', en: 'Diagnostics' },
    desc: {
      fr: 'Dans les Statistiques, l’état de tes machines : combien tournent, attendent leurs entrées, sont bloquées ou sans énergie, et lesquelles.',
      en: 'In the Statistics, your machines’ states: how many run, wait for their inputs, are blocked or unpowered, and which.',
    },
    effects: [flag('diagnostics')],
  }),

  // ── trade: the Crier's door. Its entry hangs from the telemetry (know your rates, then sell).
  trade_post: plan('trade', ['telemetry'], [['iron_plate', 20]]),

  // ── survey: the land around the base ───────────────────────────────────────
  beacon: plan('survey', [], [['iron_plate', 8], ['glass', 2]]),
} as const satisfies Record<string, PlanDef>;

export type PlanId = keyof typeof PLANS;
/** Plans in declaration order (their effects apply in this order, before research's). */
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
export const isPlan = (id: string): boolean => own(PLANS, id);
export const isResearch = (id: string): boolean => own(RESEARCH, id);
/** A node of the one tree: a plan or a research node (what `sim.done` and `unlock` fields hold). */
export const isTreeNode = (id: string): boolean => isPlan(id) || isResearch(id);
export const planDef = (id: string): PlanDef | undefined => (isPlan(id) ? (PLANS as Record<string, PlanDef>)[id] : undefined);
export const researchNode = (id: string): ResearchDef | undefined => (isResearch(id) ? (RESEARCH as Record<string, ResearchDef>)[id] : undefined);

/** A tree node's prerequisites (plan or research ids; none for an unknown id). */
export const treePrereq = (id: string): readonly string[] => planDef(id)?.prereq ?? researchNode(id)?.prereq ?? [];

/** The buildings a tree node unlocks (their `unlock` is its id), in content order. */
export function buildingsUnlockedBy(id: string): string[] {
  return (Object.entries(BUILDINGS) as Array<[string, BuildingDef]>).filter(([, b]) => b.unlock === id).map(([k]) => k);
}

/** A tree node's name: research's own, a plan's own or that of the building it unlocks; else the id. */
export function nodeName(id: string): Loc {
  const r = researchNode(id);
  if (r) return r.name;
  const p = planDef(id);
  const b = p && !p.name ? buildingsUnlockedBy(id)[0] : undefined;
  return p?.name ?? (b ? (BUILDINGS as Record<string, BuildingDef>)[b]!.name : { fr: id, en: id });
}

// ── paths (D41) ─────────────────────────────────────────────────────────────
// The plans are grouped in paths of one theme each, drawn as labelled bands on the tree. A
// path reads as one line: it grows from one entry (a root plan, or a plan hanging from another
// path's: the trade post from the telemetry) and every other plan of it hangs from a plan of
// the same path.

/** The plan paths, top to bottom on the tree: making things first, then knowing, selling, reaching. */
export const PLAN_PATHS: readonly PlanLane[] = ['production', 'logistics', 'energy', 'analytics', 'trade', 'survey'];

/**
 * Analytics (D41): the flag each analytics plan turns on — its own id —, by the readout it gates.
 * The HUD, the stats screen and the hotkeys read these (src/ui/analytics.ts), never a bare string.
 */
export const ANALYTICS = {
  /** The Heart's Δ/min beside each stock, in the HUD. */
  rates: 'telemetry',
  /** The Statistics screen (G) and its chip in the HUD. */
  ledger: 'statistics',
  /** The power history (demand against what is available) in the Statistics. */
  power: 'power_log',
  /** The machines' states in the Statistics. */
  machines: 'diagnostics',
} as const satisfies Record<string, PlanId>;
export type AnalyticsFeature = keyof typeof ANALYTICS;

/** A path's plans, in declaration order. */
export const pathPlans = (lane: PlanLane): PlanId[] => PLAN_IDS.filter((id) => PLANS[id].lane === lane);

/** Where a path starts: its plans with no prerequisite on the same path. */
export const pathEntries = (lane: PlanLane): PlanId[] =>
  pathPlans(lane).filter((id) => !PLANS[id].prereq.some((q) => planDef(q)?.lane === lane));

/**
 * The paths' invariants (D41; run by validateContent): every plan sits on a listed path and every
 * path holds plans; a path grows from exactly one entry, and its plans, followed through their
 * prerequisites on the same path, never loop; an analytics plan turns on exactly one flag, its
 * own id, and `ANALYTICS` names each analytics plan once.
 */
export function pathProblems(): string[] {
  const errs: string[] = [];
  for (const id of PLAN_IDS) if (!PLAN_PATHS.includes(PLANS[id].lane)) errs.push(`plan ${id}: path ${PLANS[id].lane} is not in PLAN_PATHS`);
  if (new Set(PLAN_PATHS).size !== PLAN_PATHS.length) errs.push('PLAN_PATHS lists a path twice');
  for (const lane of PLAN_PATHS) {
    const mine = pathPlans(lane);
    if (!mine.length) { errs.push(`path ${lane}: no plan`); continue; }
    const entries = pathEntries(lane);
    if (entries.length !== 1) errs.push(`path ${lane}: ${entries.length} entries (${entries.join(', ')}), one wanted`);
    // Within the path, every plan must be reached from its entry by in-path links, without a loop.
    const reached = new Set<string>(entries);
    for (let grew = true; grew;) {
      grew = false;
      for (const id of mine) {
        if (reached.has(id)) continue;
        const inPath = PLANS[id].prereq.filter((q) => planDef(q)?.lane === lane);
        if (inPath.length && inPath.every((q) => reached.has(q))) { reached.add(id); grew = true; }
      }
    }
    for (const id of mine) if (!reached.has(id)) errs.push(`path ${lane}: ${id} is not reached from its entry (a loop, or a plan hanging off the path)`);
  }
  const analytics = new Set<string>(pathPlans('analytics'));
  for (const id of analytics) {
    const fx = (PLANS as Record<string, PlanDef>)[id]!.effects ?? [];
    const f = fx[0];
    if (fx.length !== 1 || !f || f.k !== 'flag' || f.flag !== id) errs.push(`analytics plan ${id}: must turn on exactly its own flag (${id})`);
  }
  const named = Object.values(ANALYTICS) as string[];
  if (new Set(named).size !== named.length) errs.push('ANALYTICS names a plan twice');
  for (const id of named) if (!analytics.has(id)) errs.push(`ANALYTICS: ${id} is not an analytics plan`);
  for (const id of analytics) if (!named.includes(id)) errs.push(`analytics plan ${id}: missing from ANALYTICS (nothing reads it)`);
  return errs;
}
