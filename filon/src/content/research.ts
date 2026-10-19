// research.ts — the one unlock tree (D33): everything the base uses beyond its starting kit
// (drill, ribbon, pole and the Link tool) is unlocked here, in two kinds of node.
//   · PLANS: instant unlocks paid with materials from the Heart, Mindustry-style — no lab, no
//     time. Cheap near the root (the starting stock affords every root plan), dearer deeper; five
//     paths of one theme each (D41: production, logistics, energy, analytics, trade — `PLAN_PATHS`;
//     the survey path went with the survey beacon, D117), each growing from one entry. Unlocking one is the `unlockPlan` command
//     (src/sim/systems/research.ts).
//   · RESEARCH (D69): the tree's advanced part, run by research labs on AI tokens (D68, D118, D122:
//     a flow — the Core's compute, the claim's servers', one bought from CrierBelt) and resources
//     paid from the Core when a node is launched, as a plan is (D122; owner, 2026-10-17: « la
//     monnaie pour débloquer les recherches sera uniquement les tokens, et des fois on aura besoin
//     de certaines ressources qui font sens, type engrenages, cuivre etc. »): no data any more. No
//     minimum time (D118): a node is done once its tokens are delivered. It reads in four tiers,
//     each opened by the Core's level (`BAL.tierCoreLevel`, D118), each of its own CATEGORIES
//     (D128: the trunk and the families until then), named after what a base focused on them does
//     (Tier 1's Foundry and Workshop, Tier 2's Finance…): a category opens once the categories of
//     the tier before it names (its gates) are finished. Each carries a theme, the families' six,
//     which the expertises improve (D93). A node costs its table's price whatever else the claim
//     owns: the spread penalty of D69 is gone (owner, 2026-10-15, D72).
//   · Every node unlocks something: a building (its `unlock` field names the node) or a feature
//     (a flag the engine reads, a research slot, a Heart output); never a bare boost (owner,
//     2026-10-14, D70).
// What a node unlocks is derived from the `unlock` field of buildings and recipes (and BAL's
// Heart levels); plan and research ids share one namespace and one `sim.done` set.
import { BUILDINGS } from './buildings';
import type { BuildingDef, CategoryDef, Effect, Loc, PlanDef, PlanLane, ResearchDef, ResearchTier, ThemeId } from './types';

/**
 * The AI tokens a node of each depth takes, and the pace its tier runs at (minutes). Depths 1–2 are
 * Tier 1, 3–4 Tier 2, 5–6 Tier 3, 7 and the keystones (9) Tier 4. Every node takes tokens (D122),
 * a flow from the Core's compute (`BAL.coreCompute`: 1 000 a minute from its level 2, enough for
 * Tier 1 alone), the claim's servers and CrierBelt (`BAL.tokenCentsPerK`, 10 ◉ the thousand): small
 * at Tier 1 — a node in two to five minutes on the Core alone, faster with a bought flow — and
 * growing with the tiers. No minimum time (D118): `minutes` is the pace the launch dialog aims its
 * default flow at (`tokenBuyDefault`) — short early, long late (D107: « c'est au T3-4 qu'on commence
 * à avoir de la recherche vraiment longue »): the Core's own pace at Tier 1, 8 and 20 at Tier 2, an
 * hour and three at Tier 3, 8 hours and a day at Tier 4. A node's resources are its own (`res`).
 */
export const DEPTH_COST: Record<number, { tokens: number; minutes: number }> = {
  1: { tokens: 2_000, minutes: 2 },
  2: { tokens: 5_000, minutes: 5 },
  3: { tokens: 100_000, minutes: 8 },
  4: { tokens: 300_000, minutes: 20 },
  5: { tokens: 600_000, minutes: 60 },
  6: { tokens: 1_200_000, minutes: 180 },
  7: { tokens: 2_000_000, minutes: 480 },
  9: { tokens: 6_000_000, minutes: 1440 },
};

/** A node's resources (D122), whole items paid from the Core at launch: [item id, items]. */
type Res = ReadonlyArray<readonly [string, number]>;

/** A depth's tier. */
export const tierOfDepth = (depth: number): ResearchTier => (depth <= 2 ? 1 : depth <= 4 ? 2 : depth <= 6 ? 3 : 4);

/**
 * The node that makes the Core's level a tier waits for possible (D118: `BAL.tierCoreLevel`;
 * `BAL.hearthUpgrades` names it): the Synthesis for Tier 2's level 3, Optics for Tier 3's 4,
 * Resonance for Tier 4's 5 — each in a category of the tier before (D128). Tier 1 needs none: the
 * lab's plan. A node needs its tier's (`researchNeeds`); Tier 2 also waits for two expertises chosen
 * at the Archive level 3 mounts (D93: `researchBlock`'s `expertise`).
 */
export const TIER_GATE: Record<ResearchTier, string | null> = { 1: null, 2: 'tr_synth', 3: 'tr6', 4: 'tr8' };

/** The plan research hangs from: no lab, no research (D33). */
const LAB_PLAN = 'observatory';

const L = (fr: string, en: string): Loc => ({ fr, en });

/** The themes, in the tree's order (top to bottom in each tier). */
export const THEME_IDS: readonly ThemeId[] = ['en', 'ex', 'dn', 'cm', 'an', 'xp'];

/**
 * A theme's name (D128): what its categories share across the tiers, and what an expertise of it
 * improves (D93). The families' ids since D69; Logistics was Expansion until D107 (`xp`, kept: saves
 * carried it in a reconversion's id).
 */
export const THEMES: Readonly<Record<ThemeId, { readonly name: Loc }>> = {
  en: { name: L('Énergie', 'Energy') },
  ex: { name: L('Extraction', 'Extraction') },
  dn: { name: L('Machines', 'Machines') },
  cm: { name: L('Commerce', 'Commerce') },
  an: { name: L('Analytique', 'Analytics') },
  xp: { name: L('Logistique', 'Logistics') },
};

const cat = (tier: ResearchTier, theme: ThemeId, gates: string[], name: [string, string], desc: [string, string]): CategoryDef =>
  ({ name: L(...name), desc: L(...desc), tier, theme, gates });

/**
 * The tree's categories (D128; owner, 2026-10-18: « "fondations" et "machines" devraient être merge
 * puis re-splittés en différentes catégories de machines, en fonction de l'objectif global de ce que
 * serait une usine focalisée sur tel ou tel type de machine… chaque tier aura ses propres catégories.
 * Et simplement, il faut potentiellement finir la catégorie Commerce du Tier 1 pour pouvoir se lancer
 * dans la catégorie Finance du Tier 2, etc. Pas forcément, et des fois il peut falloir en avoir fini
 * plusieurs »). Each tier has its own, named after what a base focused on it does; the trunk and the
 * families are gone, their nodes shared out (Mechanics to the Workshop, Ceramics and Optics together,
 * Land Registry to the Territory…). A category opens once the categories it names in `gates` (of the
 * tier before) are finished, every node of them learnt — usually one (Commerce → Finance), sometimes
 * two (Foundry and Workshop → Automation), never more than the tier's Core level for Tier 1. Declared
 * tier by tier, each tier in the themes' order: the tree's bands, top to bottom, so a gate mostly
 * stands level with what it opens.
 */
export const CATEGORIES = {
  // ── Tier 1: the lab's plan opens them all ──
  t1_energy: cat(1, 'en', [], ['Énergie', 'Energy'], ['Les éoliennes à pas variable et les panneaux solaires.', 'Pitch-control turbines and solar panels.']),
  t1_extraction: cat(1, 'ex', [], ['Extraction', 'Extraction'], ['Plus de minerai du même gisement, et les briques du sable.', 'More ore off the same deposit, and bricks from the sand.']),
  t1_foundry: cat(1, 'dn', [], ['Fonderie', 'Foundry'], ['Le cuivre en plaques, l’acier, la fonte à l’électricité.', 'Copper into plates, steel, smelting on power.']),
  t1_workshop: cat(1, 'dn', [], ['Atelier', 'Workshop'], ['Les pièces : engrenages, oscillateurs à quartz, fil et câble.', 'Parts: gears, quartz oscillators, wire and cable.']),
  t1_commerce: cat(1, 'cm', [], ['Commerce', 'Commerce'], ['Un second comptoir, des prix plancher.', 'A second trade post, floor prices.']),
  t1_core: cat(1, 'an', [], ['Calcul du Cœur', 'Core Compute'], ['Le calcul du Cœur, et la Synthèse qui ouvre son niveau 3.', 'The Core’s compute, and the Synthesis that opens its level 3.']),
  t1_logistics: cat(1, 'xp', [], ['Logistique', 'Logistics'], ['Rubans plus vifs, grands silos, grilles contre les Glaneurs.', 'Swifter ribbons, great silos, fences against the Gleaners.']),
  // ── Tier 2: the Core's level 3 and two expertises (D93, D118) ──
  t2_grid: cat(2, 'en', ['t1_energy'], ['Réseau électrique', 'Power Grid'], ['Garder l’électricité : accumulateurs lourds, batteries chargées.', 'Keeping power: heavy accumulators, charged batteries.']),
  t2_quarry: cat(2, 'ex', ['t1_extraction'], ['Carrière', 'Quarry'], ['Creuser la roche, tamiser la pierre, combler l’eau.', 'Digging rock, sifting stone, filling water.']),
  t2_ceramics: cat(2, 'dn', ['t1_foundry'], ['Céramique et optique', 'Ceramics and Optics'], ['Fours à céramique, lentilles, cœurs thermiques : le niveau 4 du Cœur.', 'Ceramic ovens, lenses, thermal cores: the Core’s level 4.']),
  t2_automation: cat(2, 'dn', ['t1_foundry', 't1_workshop'], ['Automatisation', 'Automation'], ['L’atelier d’électronique, les servomoteurs, l’assemblage compact.', 'The electronics workshop, servomotors, compact assembly.']),
  t2_finance: cat(2, 'cm', ['t1_commerce'], ['Finance', 'Finance'], ['Ordres permanents, vente automatique, forfaits de tokens.', 'Standing orders, auto-sell, token plans.']),
  t2_servers: cat(2, 'an', ['t1_core'], ['Serveurs', 'Servers'], ['Les serveurs, la file de recherche, un deuxième pupitre.', 'Servers, the research queue, a second desk.']),
  t2_land: cat(2, 'xp', ['t1_logistics'], ['Territoire', 'Territory'], ['Baux, pylônes, longues passerelles, terres lointaines.', 'Leases, pylons, long bridges, far land.']),
  // ── Tier 3: the Core's level 4 (Optics) ──
  t3_plants: cat(3, 'en', ['t2_grid'], ['Centrales', 'Power Plants'], ['Fermes solaires, grandes éoliennes, géothermie, générateurs à batteries.', 'Solar farms, great turbines, geothermal plants, battery generators.']),
  t3_deep: cat(3, 'ex', ['t2_quarry'], ['Mine profonde', 'Deep Mining'], ['Forer profond, pomper fort, tailler le cœur-de-roche.', 'Boring deep, pumping hard, cutting heartrock.']),
  t3_electronics: cat(3, 'dn', ['t2_automation'], ['Électronique', 'Electronics'], ['Graveuses, bras robotisés, résonateurs : le niveau 5 du Cœur.', 'Etchers, robot arms, resonators: the Core’s level 5.']),
  t3_heavy: cat(3, 'dn', ['t2_automation', 't2_ceramics'], ['Mécanique lourde', 'Heavy Engineering'], ['Presses à forger et fonderies à arc.', 'Forging presses and arc furnaces.']),
  t3_market: cat(3, 'cm', ['t2_finance'], ['Économie de marché', 'Market Economy'], ['Quais plus larges, fret express.', 'Wider wharves, express freight.']),
  t3_computing: cat(3, 'an', ['t2_servers'], ['Calcul', 'Computing'], ['Serveurs refroidis, fouille de données, un troisième pupitre.', 'Cooled servers, data mining, a third desk.']),
  t3_transport: cat(3, 'xp', ['t2_land'], ['Transport', 'Transport'], ['Distributeurs, rubans express, traités de voisinage.', 'Distributors, express ribbons, neighbour treaties.']),
  // ── Tier 4: the Core's level 5 (Resonance) — its keystones ──
  t4_plants: cat(4, 'en', ['t3_plants'], ['Grandes centrales', 'Great Power Plants'], ['La Tour solaire et le Cœur-Soleil.', 'The Solar Tower and the Sunheart.']),
  t4_works: cat(4, 'ex', ['t3_deep'], ['Grands travaux', 'Great Works'], ['La Foreuse géante et le remblai profond.', 'The Giant Drill and deep fill.']),
  t4_chips: cat(4, 'dn', ['t3_electronics'], ['Puces', 'Chips'], ['L’Usine de puces.', 'The Chip Fab.']),
  t4_assembly: cat(4, 'dn', ['t3_heavy'], ['Grand assemblage', 'Great Assembly'], ['La Tour d’assemblage.', 'The Assembly Tower.']),
  t4_trade: cat(4, 'cm', ['t3_market'], ['Grand négoce', 'Great Trade'], ['Le grand comptoir et la Maison de Criée.', 'The Grand Post and the Crier House.']),
  t4_super: cat(4, 'an', ['t3_computing'], ['Supercalcul', 'Supercomputing'], ['Le Supercalculateur et le laboratoire autonome.', 'The Supercomputer and the autonomous lab.']),
} as const satisfies Record<string, CategoryDef>;

export type CategoryId = keyof typeof CATEGORIES;
/** The categories in the table's order: tier by tier, each in the themes' order. */
export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];
export const isCategory = (id: string): id is CategoryId => Object.prototype.hasOwnProperty.call(CATEGORIES, id);
export const categoryDef = (id: string): CategoryDef | undefined => (isCategory(id) ? (CATEGORIES as Record<string, CategoryDef>)[id] : undefined);
/** A tier's categories, top to bottom. */
export const tierCategories = (tier: ResearchTier): CategoryId[] => CATEGORY_IDS.filter((c) => CATEGORIES[c].tier === tier);

const mul = (target: Extract<Effect, { k: 'mul' }>['target'], permille: number): Effect => ({ k: 'mul', target, permille });
const add = (target: Extract<Effect, { k: 'add' }>['target'], v: number): Effect => ({ k: 'add', target, v });
const flag = (f: string): Effect => ({ k: 'flag', flag: f });
void mul;

/**
 * A node of its own pace (the trunk's until D128: Mechanics, the Core's gates, the desks…): its
 * tokens and the pace the launch dialog aims at are its own, its prerequisites as given.
 */
function paced(c: CategoryId, depth: number, prereq: string[], res: Res, tokens: number, minutes: number, name: [string, string], desc: [string, string], effects: Effect[] = []): ResearchDef {
  const k: CategoryDef = CATEGORIES[c];
  return { name: L(...name), desc: L(...desc), cat: c, theme: k.theme, tier: k.tier, depth, prereq, cost: res, tokens, minutes, effects };
}

/**
 * A node: its category (its tier and theme), its tokens from its depth, its resources (`res`, D122),
 * its prerequisites — the node before it in its category (`after`; none for a category's first
 * node, which needs the lab's plan) and what it acts on from another category of its tier (`also`,
 * D107: the Compute Plan needs the Server Room, the Steelworks the press and the bricks…; validated
 * by content/usable.ts). Its category's gates and its tier's gate come on top (`researchNeeds`). Its
 * resources hint at what it unlocks, and the base can make them before it (validate.ts: its needs
 * and the plans make them; usable.ts: they can be had).
 */
function node(c: CategoryId, depth: number, after: string | null, name: [string, string], desc: [string, string], res: Res, effects: Effect[] = [], also: string[] = []): ResearchDef {
  const k: CategoryDef = CATEGORIES[c];
  const d = DEPTH_COST[depth]!;
  return { name: L(...name), desc: L(...desc), cat: c, theme: k.theme, tier: k.tier, depth, prereq: [after ?? LAB_PLAN, ...also], cost: res, tokens: d.tokens, minutes: d.minutes, effects };
}

export const RESEARCH = {
  // ── the nodes of their own pace: the trunk's (« Fondations ») until D128, shared out among the
  // categories — Mechanics to the Workshop, the Synthesis to the Core's compute, Earthworks to the
  // Quarry, Ceramics and Optics together, Land Registry to the Territory, the desks to the Servers and
  // Computing, Resonance to Electronics. Mechanics brings the press and its gears (and the test bench
  // until D122). The Core's level 2 is no research's any more (D101: the player raises it, paid in
  // plates, glass and wire). Their paces follow the tiers' (D107): the Core's own pace in Tier 1,
  // 8–30 minutes in Tier 2 (the node opening Tier 3 the longest), 3 and 6 hours in Tier 3.
  tr1: paced('t1_workshop', 1, ['observatory'], [['iron_plate', 30], ['copper_wire', 10]], 2_000, 2, ['Mécanique', 'Mechanics'], ['La presse et ses engrenages ; le moteur électrique à l’établi de montage.', 'The press and its gears; the electric motor at the assembly bench.']),
  // The Core's level 3, its Archive, where two expertises open Tier 2 (D93). Since D128 it needs what
  // that level is paid in — the Workshop's gears and oscillators (Overclocking's quartz workshop, the
  // twin wire mill and its press), the Foundry's steel, bricks and copper plates (the Steelworks') —,
  // no longer Tier 1 whole: the categories of Tier 2 wait for those of Tier 1 they build on.
  tr_synth: paced('t1_core', 2, ['an_data', 'dn_wiremill'], [['gear', 20], ['motor', 10], ['oscillator', 10]], 10_000, 10, ['Synthèse', 'Synthesis'], ['Cœur niveau 3 et son Archive des expertises. Le Cœur niveau 3 et deux expertises choisies ouvrent le Tier 2.', 'Core level 3 and its Expertise Archive. Core level 3 and two expertises chosen open Tier 2.']),
  tr2: paced('t2_quarry', 2, ['observatory'], [['steel', 30], ['gear', 40]], 15_000, 8, ['Terrassement', 'Earthworks'], ['Excavatrice : creuser le grès et le basalte (H1–H2).', 'Excavator: dig sandstone and basalt (H1–H2).']),
  tr3: paced('t2_ceramics', 3, ['observatory'], [['brick', 60], ['pipe', 20]], 60_000, 8, ['Céramique', 'Ceramics'], ['Four à céramique (l’eau de la Vapeur et la pierre de l’excavatrice) ; atelier d’assemblage, batteries vides, accumulateurs.', 'Ceramic oven (Steam Power’s water and the excavator’s stone); assembly workshop, empty batteries, accumulators.']),
  tr4: paced('t2_land', 4, ['tr3'], [['ceramic', 40], ['cable', 30]], 120_000, 20, ['Cadastre', 'Land Registry'], ['Baux de parcelles, pylônes.', 'Parcel leases, pylons.'], [flag('lease')]),
  tr5: paced('t2_servers', 5, ['an_servers'], [['circuit', 60], ['oscillator', 20]], 200_000, 20, ['Deuxième pupitre', 'Second Desk'], ['Un deuxième emplacement de recherche.', 'A second research slot.'], [{ k: 'slots', add: 1 }]),
  // « Cartographie » / Atlas Lore until D122 (its atlases went with the data): the optics it brings.
  // It needs the electronics workshop (D129): its thermal cores and the Core's level 4 take circuits,
  // Tier 2's since then — so every Tier 3 node, behind it, can make them.
  tr6: paced('t2_ceramics', 6, ['tr3', 'workshop'], [['ceramic', 60], ['circuit', 60]], 400_000, 30, ['Optique', 'Optics'], ['Atelier d’optique, Scriptorium ; lentilles, toiles, cœurs thermiques ; Cœur niveau 4, qui ouvre le Tier 3.', 'Optics workshop, Scriptorium; lenses, canvas, thermal cores; Core level 4, which opens Tier 3.']),
  tr7: paced('t3_computing', 7, ['observatory'], [['lens', 30], ['thermal_core', 15]], 800_000, 180, ['Troisième pupitre', 'Third Desk'], ['Un troisième emplacement de recherche.', 'A third research slot.'], [{ k: 'slots', add: 1 }]),
  // « Codex » / Codex Lore until D122 (its codices went with the data): the resonators it brings.
  tr8: paced('t3_electronics', 8, ['observatory'], [['lens', 40], ['thermal_core', 30]], 1_500_000, 360, ['Résonance', 'Resonance'], ['Résonateurs, treillis de nacre ; Cœur niveau 5, qui ouvre le Tier 4.', 'Resonators, nacre lattices; Core level 5, which opens Tier 4.']),

  // ── Energy: Energy (T1) → Power Grid → Power Plants (renewables, and plants that burn) → Great Power Plants ──
  en_pitch: node('t1_energy', 1, null, ['Éolienne à pas variable', 'Pitch-Control Turbine'], ['Débloque l’Éolienne à pas variable : jusqu’à 140 kW, dès le moindre souffle.', 'Unlocks the Pitch-Control Turbine: up to 140 kW, from the lightest breeze.'], [['iron_plate', 20], ['copper_wire', 20]]),
  en2: node('t1_energy', 2, 'en_pitch', ['Panneaux solaires', 'Solar Panels'], ['Débloque le Panneau solaire : 200 kW en plein soleil.', 'Unlocks the Solar Panel: 200 kW in full sun.'], [['glass', 30], ['copper_wire', 20]]),
  en_heavyacc: node('t2_grid', 3, null, ['Accumulateur lourd', 'Heavy Accumulator'], ['Débloque l’Accumulateur lourd : 4 000 kW·min.', 'Unlocks the Heavy Accumulator: 4,000 kW·min.'], [['copper_coil', 30], ['cable', 20]]),
  en4: node('t2_grid', 4, 'en_heavyacc', ['Chargeur', 'Battery Charging'], ['Débloque le Chargeur et les batteries chargées.', 'Unlocks the Battery Charger and charged batteries.'], [['copper_coil', 30], ['copper_plate', 40]]),
  en_solarfarm: node('t3_plants', 5, null, ['Ferme solaire', 'Solar Farm'], ['Débloque la Ferme solaire : 600 kW en plein soleil.', 'Unlocks the Solar Farm: 600 kW in full sun.'], [['lens', 20], ['glass', 120]]),
  en_bigwind: node('t3_plants', 6, 'en_solarfarm', ['Grande éolienne', 'Great Turbine'], ['Débloque la Grande éolienne : jusqu’à 1 200 kW.', 'Unlocks the Great Turbine: up to 1,200 kW.'], [['thermal_core', 15], ['steel', 100]]),
  en_tower: node('t4_plants', 9, null, ['Tour solaire', 'Solar Tower'], ['Débloque la Tour solaire : 3 MW en plein soleil.', 'Unlocks the Solar Tower: 3 MW in full sun.'], [['resonator', 10], ['lens', 60]]),
  en5: node('t3_plants', 5, null, ['Géothermie', 'Geothermal Power'], ['Débloque la Centrale géothermique, sur les évents.', 'Unlocks the Geothermal Plant, on vents.'], [['thermal_core', 20], ['ceramic', 60]]),
  en_cellgen: node('t3_plants', 6, 'en5', ['Générateur à batteries', 'Battery Generator'], ['Débloque le Générateur à batteries : 600 kW par batterie chargée.', 'Unlocks the Battery Generator: 600 kW per charged battery.'], [['empty_cell', 30], ['thermal_core', 20]]),
  enK: node('t4_plants', 9, null, ['Le Cœur-Soleil', 'The Sunheart'], ['Débloque le Cœur-Soleil : 20 MW pour un résonateur toutes les 30 minutes.', 'Unlocks the Sunheart: 20 MW for one resonator every 30 minutes.'], [['resonator', 15], ['thermal_core', 40]]),

  // ── Extraction: Extraction (T1) → Quarry → Deep Mining (drilling, excavation) → Great Works ──
  // D107: the Fast Drill opens the theme at Tier 1: more ore off the same deposit, what a young
  // base needs (the Face Cutter left for the plans, D101). The Quarry (Tier 2) opens on Earthworks
  // (`tr2`, the excavator) and works the rubble it digs: the sifter's stone, the backfiller's, the
  // bits it wears.
  ex_fastdrill: node('t1_extraction', 1, null, ['Foreuse rapide', 'Fast Drill'], ['Débloque la Foreuse rapide : 35/min.', 'Unlocks the Fast Drill: 35/min.'], [['iron_plate', 40], ['copper_wire', 10]]),
  // The brickworks (D123): sand off the ground and the Steam plan's water, pressed into bricks — the
  // furnaces' lining and the Core's walls. Extraction's second Tier 1 node: the land's materials one
  // step further; the steel mill (Machines) is built of its bricks.
  ex_brick: node('t1_extraction', 2, 'ex_fastdrill', ['Briqueterie', 'Brickworks'], ['Débloque la Briqueterie : un sable et deux eaux font une brique, pour les fourneaux, l’aciérie et le Cœur.', 'Unlocks the Brickworks: a sand and two waters make a brick, for the furnaces, the steel mill and the Core.'], [['sand', 40], ['iron_plate', 30]]),
  ex_sifter: node('t2_quarry', 3, 'tr2', ['Tamiseur', 'Sifter'], ['Débloque le Tamiseur : sable, fer ou cuivre tirés de la pierre.', 'Unlocks the Sifter: sand, iron or copper out of stone.'], [['gear', 30], ['steel', 20]]),
  ex3: node('t2_quarry', 4, 'ex_sifter', ['Remblai', 'Backfill'], ['Débloque la Remblayeuse.', 'Unlocks the Backfiller.'], [['gear', 40], ['brick', 80]]),
  ex4: node('t2_quarry', 4, 'ex3', ['Forets à basalte', 'Basalt Bits'], ['L’obsidienne (H3) devient creusable ; le basalte se creuse plus vite.', 'Obsidian (H3) becomes diggable; basalt digs faster.'], [['steel', 40], ['motor', 10]], [flag('digH3'), flag('basaltBits')]),
  ex5: node('t3_deep', 5, null, ['Puits profond', 'Deep Bore'], ['Débloque la Foreuse profonde.', 'Unlocks the Deep Bore.'], [['thermal_core', 15], ['pipe', 60]]),
  ex_hppump: node('t3_deep', 6, 'ex5', ['Pompe haute pression', 'High-Pressure Pump'], ['Débloque la Pompe haute pression : 240 eau/min.', 'Unlocks the High-Pressure Pump: 240 water/min.'], [['ceramic', 100], ['pipe', 80]]),
  ex_giant: node('t4_works', 9, null, ['Foreuse géante', 'Giant Drill'], ['Débloque la Foreuse géante : 90/min, plafonds ×2.', 'Unlocks the Giant Drill: 90/min, caps ×2.'], [['resonator', 10], ['thermal_core', 40]]),
  ex7: node('t3_deep', 5, null, ['Taille-cœur', 'Heartrock Cutters'], ['Le cœur-de-roche (H4) devient creusable.', 'Heartrock (H4) becomes diggable.'], [['lens', 15], ['gear', 80]], [flag('digH4')]),
  ex_heavyexc: node('t3_deep', 6, 'ex7', ['Excavatrice lourde', 'Heavy Excavator'], ['Débloque l’Excavatrice lourde : deux fois plus vite, 6 tuiles de portée.', 'Unlocks the Heavy Excavator: twice as fast, 6 tiles of reach.'], [['thermal_core', 25], ['gear', 120]]),
  ex8: node('t4_works', 9, null, ['Remblai profond', 'Deep Fill'], ['La Remblayeuse comble aussi l’eau profonde (120 pierres par tuile).', 'The Backfiller also fills deep water (120 stone a tile).'], [['nacre_lattice', 10], ['ceramic', 200]], [flag('deepFill')]),

  // ── Machines: Foundry and Workshop (T1) → Ceramics and Optics, Automation → Electronics, Heavy
  // Engineering → Chips, Great Assembly (D128: the trunk's machines and the family's, re-split by what
  // a factory focused on them makes). Copper smelts like iron (D123): the Foundry opens on copper
  // plates at the smelter, the metal of what runs on power (owner, 2026-10-17: « De l'intérêt à faire
  // fondre le cuivre en plaque de cuivre »).
  dn_copper: node('t1_foundry', 1, null, ['Fonte du cuivre', 'Copper Smelting'], ['La plaque de cuivre à la fonderie : un minerai de cuivre et un charbon. Le métal de ce qui marche à l’électricité.', 'Copper plates at the smelter: a copper ore and a coal each. The metal of what runs on power.'], [['copper_ore', 20], ['iron_plate', 30]]),
  dn3: node('t1_foundry', 2, 'dn_copper', ['Machines compactes', 'Compact Machines'], ['Débloque la Fonderie compacte (1×2).', 'Unlocks the Compact Smelter (1×2).'], [['iron_plate', 40], ['glass', 10]]),
  // Steel (D123): two plates and a coal blown in the steel mill, the frame of the heavy machines; the
  // press rolls it into pipes (Mechanics' press: also `tr1`), and the mill is lined with the
  // brickworks' bricks (also `ex_brick`). Before the electric smelter, which is built of both.
  dn_steel: node('t1_foundry', 2, 'dn3', ['Aciérie', 'Steelworks'], ['Débloque l’Aciérie : deux plaques de fer et un charbon font un acier, que la presse roule en tuyaux.', 'Unlocks the Steel Mill: two iron plates and a coal make a steel, which the press rolls into pipes.'], [['brick', 30], ['copper_plate', 10]], [], ['tr1', 'ex_brick']),
  // The electric smelter (D106): the smelter's plates and glass on power, no coal — the Foundry's
  // last. Its node asks for what it is made of (D122: « un electric smelter node asks for copper wire
  // and plates »).
  dn_esmelt: node('t1_foundry', 2, 'dn_steel', ['Fonderie électrique', 'Electric Smelting'], ['Débloque la Fonderie électrique : plaques de fer et de cuivre et verre à l’électricité, sans charbon, au rythme de la fonderie.', 'Unlocks the Electric Smelter: iron and copper plates and glass on power, no coal, at the smelter’s pace.'], [['copper_plate', 20], ['brick', 20]]),
  dn_wiremill: node('t1_workshop', 2, 'tr1', ['Tréfileuse double', 'Twin Wire Mill'], ['Débloque la Tréfileuse double : le fil deux fois plus vite ; et le câble, trois fils torsadés, aux tréfileuses.', 'Unlocks the Twin Wire Mill: wire twice as fast; and cable, three wires twisted, at the wire mills.'], [['copper_wire', 40], ['steel', 10]], [], ['dn_steel']),
  // The quartz workshop (D128; owner, 2026-10-18: « le quartz workshop doit être sa propre machine dans
  // l'arbre »): its own node, the Workshop's, from the lab on — the quartz is in hand by then (the
  // Face Cutter, a plan since D101, or the Crier's). It came with the Face Cutter until D128: saves
  // that hold the plan hold it (save 20, persist/migrate.ts `quartzWorkshop`).
  dn_quartzshop: node('t1_workshop', 1, null, ['Atelier de quartz', 'Quartz Workshop'], ['Débloque l’Atelier de quartz : un quartz et deux fils de cuivre font un oscillateur, pour les serveurs, la recherche et le Cœur.', 'Unlocks the Quartz Workshop: a quartz and two copper wires make an oscillator, for the servers, research and the Core.'], [['quartz', 10], ['copper_wire', 10]]),
  // The electronics workshop (D129; owner, 2026-10-18: « le electronics workshop devrait probablement
  // avoir un style plus avancé, et demander plus en ressources que du verre et du cuivre… on peut le
  // reléguer au Tier 2 et faire autre chose de plus basique au Tier 1 »): a plan of Production until
  // D129, Automation's first node since — the id kept, so a claim that took the plan holds the node
  // (its workshops stand and make circuits). Circuits are a copper plate, two wires and a glass; its
  // resources are what an electronics works is made of. The Tier 1 base winds coils and builds motors
  // at the assembly bench instead (a plan).
  workshop: node('t2_automation', 3, null, ['Atelier d’électronique', 'Electronics Workshop'], ['Débloque l’Atelier d’électronique : les circuits imprimés (une plaque de cuivre, deux fils de cuivre, un verre), puis les servomoteurs et les bras robotisés.', 'Unlocks the Electronics Workshop: circuit boards (a copper plate, two copper wires, a glass), then servomotors and robot arms.'], [['copper_plate', 30], ['glass', 30], ['oscillator', 10]]),
  dn4: node('t2_automation', 3, 'workshop', ['Servomoteurs', 'Servomotors'], ['La recette du servomoteur : les machines avancées en sont construites.', 'The servomotor’s recipe: the advanced machines are built of them.'], [['copper_plate', 40], ['circuit', 40]]),
  // The compact assembly workshop runs the assembly workshop's recipes, Ceramics' (D107: none before it).
  dn_compact: node('t2_automation', 4, 'dn4', ['Atelier d’assemblage compact', 'Compact Assembly'], ['Débloque l’Atelier d’assemblage compact (2×2).', 'Unlocks the Compact Assembly Workshop (2×2).'], [['pace_bell', 6], ['ceramic', 30]], [], ['tr3']),
  dn_etcher: node('t3_electronics', 5, null, ['Graveuse', 'Etcher'], ['Débloque la Graveuse : l’électronique trois fois plus vite.', 'Unlocks the Etcher: electronics three times as fast.'], [['lens', 15], ['circuit', 100]]),
  dn7: node('t3_electronics', 6, 'dn_etcher', ['Robotique', 'Robotics'], ['La recette du bras robotisé : deux servomoteurs et deux circuits ; l’Usine de puces en est construite.', 'The robot arm’s recipe: two servomotors and two circuits; the Chip Fab is built of them.'], [['pace_bell', 30], ['circuit', 80]]),
  dn_chipfab: node('t4_chips', 9, null, ['Usine de puces', 'Chip Fab'], ['Débloque l’Usine de puces : l’électronique six fois plus vite.', 'Unlocks the Chip Fab: electronics six times as fast.'], [['robot_arm', 12], ['resonator', 5]]),
  dn_forge: node('t3_heavy', 5, null, ['Presse à forger', 'Forging Press'], ['Débloque la Presse à forger : les engrenages trois fois plus vite.', 'Unlocks the Forging Press: gears three times as fast.'], [['pace_bell', 15], ['steel', 100]]),
  dn_arc: node('t3_heavy', 6, 'dn_forge', ['Fonderie à arc', 'Arc Furnace'], ['Débloque la Fonderie à arc : plaques et verre sans charbon, deux fois plus vite que la fonderie électrique.', 'Unlocks the Arc Furnace: plates and glass without coal, twice as fast as the electric smelter.'], [['thermal_core', 25], ['ceramic', 80]]),
  dn8: node('t4_assembly', 9, null, ['Tour d’assemblage', 'Assembly Tower'], ['Débloque la Tour d’assemblage : l’assemblage quatre fois plus vite.', 'Unlocks the Assembly Tower: assembly four times as fast.'], [['resonator', 10], ['pace_bell', 40]]),

  // ── Commerce: Commerce (T1) → Finance → Market Economy → Great Trade ─────────
  // D107 (owner, 2026-10-17: « "Standing Orders" c'est déjà de la finance assez avancée »): Tier 1
  // is what a newcomer at the Crier uses — a second trade post, floor prices; Finance (Tier 2) holds
  // the standing orders and the token plans, which need the Server Room; the posts' levels, express
  // freight and the third post come later.
  cm_post2: node('t1_commerce', 1, null, ['Second comptoir', 'Second Post'], ['Un deuxième comptoir à la Criée : vendre ici, acheter là.', 'A second trade post at the Crier: sell here, buy there.'], [['iron_plate', 40], ['glass', 10]], [flag('post2')]),
  cm_floor: node('t1_commerce', 2, 'cm_post2', ['Prix plancher', 'Floor Prices'], ['Un prix minimum par objet : le comptoir garde ce qui se vendrait moins cher.', 'A minimum price per item: the post holds back what would sell for less.'], [['copper_coil', 10], ['copper_wire', 20]], [flag('floorPrices')]),
  // Auto-sell (D127): the Core's surplus sold at each minute's end, at CrierBelt's dearer cut (D126) —
  // Finance's first beside Standing Orders (D128: Commerce finished opens it, Floor Prices with it).
  // Its circuits and gears hint at the Core's sorting lift.
  cm_autosell: node('t2_finance', 3, null, ['Vente automatique', 'Auto-sell'], ['Le Cœur vend de lui-même ce qu’il reçoit au-delà d’un seuil, objet par objet (10 000 par défaut) : le surplus part au prix de la Criée, moins 40 %, au lieu de bloquer les rubans.', 'The Core sells on its own what it receives beyond a threshold, item by item (10,000 by default): the surplus goes at the Crier’s price, less 40%, instead of backing up the ribbons.'], [['motor', 10], ['gear', 40]], [flag('autoSell')]),
  cm2: node('t2_finance', 3, null, ['Ordres permanents', 'Standing Orders'], ['Jusqu’à 6 ordres d’import.', 'Up to 6 import orders.'], [['copper_coil', 30], ['oscillator', 10]], [add('orders', 4)]),
  cm_plan: node('t2_finance', 4, 'cm2', ['Forfait de calcul', 'Compute Plan'], ['Un forfait CrierBelt : les tokens à moitié prix, contre un montant fixe par heure.', 'A CrierBelt plan: tokens at half price, for a fixed fee an hour.'], [['circuit', 40], ['oscillator', 20]], [flag('tokenPlan')], ['an_servers']),
  cm_rent: node('t2_finance', 4, 'cm_plan', ['Location de serveurs', 'Server Rental'], ['CrierBelt rachète, à moitié prix, les tokens que tes serveurs n’utilisent pas.', 'CrierBelt buys the tokens your servers do not use, at half price.'], [['copper_wire', 80], ['circuit', 30]], [flag('serverRental')]),
  cm3: node('t3_market', 5, null, ['Quai élargi', 'Wider Wharf'], ['Comptoir niveau 2 : 240 objets par minute.', 'Trade post level 2: 240 items a minute.'], [['thermal_core', 10], ['gear', 80]], [flag('tradeL2')]),
  cm_express: node('t3_market', 6, 'cm3', ['Fret express', 'Express Freight'], ['Un ordre peut partir en express : deux fois plus vite, 25 % plus cher.', 'An order can ship express: twice as fast, 25% dearer.'], [['lens', 20], ['circuit', 80]], [flag('expressFreight')]),
  cm8: node('t4_trade', 7, null, ['Grand comptoir', 'Grand Post'], ['Comptoir niveau 3 : 480 objets par minute.', 'Trade post level 3: 480 items a minute.'], [['resonator', 5], ['nacre_lattice', 5]], [flag('tradeL3')]),
  cmK: node('t4_trade', 9, 'cm8', ['La Maison de Criée', 'The Crier House'], ['Un troisième comptoir.', 'A third trade post.'], [['resonator', 15], ['nacre_lattice', 10]], [flag('post3')]),

  // ── Analytics: Core Compute (T1) → Servers → Computing → Supercomputing ─────
  // The first lab runs on the Core's compute (D122: `BAL.coreCompute`, from its level 2). Tier 1's
  // node raises it (it brought the data collector until D122; the Data Relay `an_relay` after it is
  // gone, content/retired.ts `RESEARCH_GONE`), on the quartz workshop's oscillators; the servers come
  // at Tier 2.
  an_data: node('t1_core', 1, null, ['Surcadençage', 'Overclocking'], ['Le calcul du Cœur donne 500 tokens de plus par minute à tes recherches.', 'The Core’s compute gives your research 500 more tokens a minute.'], [['copper_coil', 10], ['oscillator', 5]], [add('coreCompute', 500)], ['dn_quartzshop']),
  an_servers: node('t2_servers', 3, null, ['Salle des serveurs', 'Server Room'], ['Débloque le Serveur : 2 000 tokens d’IA par minute, de l’électricité.', 'Unlocks the Server: 2,000 AI tokens a minute, from power.'], [['cable', 30], ['oscillator', 20]], [], ['workshop']),
  an_queue: node('t2_servers', 4, 'an_servers', ['File de recherche', 'Research Queue'], ['Chaque laboratoire enchaîne la recherche que tu lui as préparée.', 'Each lab moves on to the research you queued for it.'], [['circuit', 40], ['cable', 20]], [flag('researchQueue')]),
  an_cooled: node('t3_computing', 5, null, ['Serveur refroidi', 'Cooled Server'], ['Débloque le Serveur refroidi : 6 000 tokens par minute.', 'Unlocks the Cooled Server: 6,000 tokens a minute.'], [['pipe', 60], ['circuit', 60]]),
  an_slot: node('t3_computing', 6, 'an_cooled', ['Calcul partagé', 'Shared Computing'], ['Un emplacement de recherche de plus.', 'One more research slot.'], [['lens', 20], ['circuit', 100]], [{ k: 'slots', add: 1 }]),
  an_super: node('t4_super', 9, null, ['Supercalculateur', 'Supercomputer'], ['Débloque le Supercalculateur : 20 000 tokens par minute.', 'Unlocks the Supercomputer: 20,000 tokens a minute.'], [['resonator', 10], ['lens', 40]]),
  an_mining: node('t3_computing', 5, null, ['Fouille de données', 'Data Mining'], ['Le Cœur fouille ses relevés : son calcul donne 2 000 tokens de plus par minute.', 'The Core mines its own records: its compute gives 2,000 more tokens a minute.'], [['lens', 15], ['oscillator', 40]], [add('coreCompute', 2000)]),
  an_forecast: node('t3_computing', 6, 'an_mining', ['Prévision des cours', 'Price Forecast'], ['La Criée montre où va chaque cours dans l’heure.', 'The Crier shows where each price is heading within the hour.'], [['lens', 20], ['circuit', 80]], [flag('forecast')]),
  an_autolab: node('t4_super', 9, null, ['Laboratoire autonome', 'Autonomous Lab'], ['Débloque le Laboratoire autonome : un laboratoire qui calcule aussi, 5 000 tokens par minute.', 'Unlocks the Autonomous Lab: a lab that also computes, 5,000 tokens a minute.'], [['nacre_lattice', 10], ['lens', 40]]),

  // ── Logistics (Expansion until D107): Logistics (T1) → Territory → Transport ──
  xp_swift: node('t1_logistics', 1, null, ['Ruban vif', 'Swift Ribbon'], ['Débloque le Ruban vif (120/min).', 'Unlocks the Swift Ribbon (120/min).'], [['iron_plate', 30], ['copper_wire', 10]]),
  xp_bigsilo: node('t1_logistics', 2, 'xp_swift', ['Grand silo', 'Great Silo'], ['Débloque le Grand silo : 5 000 objets.', 'Unlocks the Great Silo: 5,000 items.'], [['iron_plate', 60], ['glass', 20]]),
  // The Gleaners (D103): the fence they do not cross and the ribbon under glass, by the time a line runs out past the Crown (the quartz, D87).
  xp_guard: node('t1_logistics', 2, 'xp_bigsilo', ['Grilles et rubans vitrés', 'Fences and Glazed Ribbons'], ['Débloque la Grille, que les Glaneurs ne franchissent pas, et le Ruban vitré, dont ils ne prennent rien.', 'Unlocks the Fence, which the Gleaners do not cross, and the Glazed Ribbon, from which they take nothing.'], [['glass', 40], ['iron_plate', 20]]),
  // The camouflaged ribbon (D109): the Territory opens on the ribbon that runs across land the claim does not
  // hold — a neighbouring base's too (D110) — buried, for its pace; Neighbour Treaties later opens that land to every ribbon and the poles.
  xp_camo: node('t2_land', 3, null, ['Ruban camouflé', 'Camouflaged Ribbon'], ['Débloque le Ruban camouflé (40/min) : enfoui sous le sable, il passe sur les terres des bases voisines, sans surcoût hors de tes terres, et les Glaneurs ne le voient pas.', 'Unlocks the Camouflaged Ribbon (40/min): buried under the sand, it runs across the neighbouring bases’ land, with no surcharge off your land, and the Gleaners do not see it.'], [['steel', 20], ['gear', 20]]),
  xp_bridges: node('t2_land', 3, 'xp_camo', ['Passerelles longues', 'Long Bridges'], ['Les passerelles portent à 8 tuiles.', 'Bridges reach 8 tiles.'], [['steel', 40], ['gear', 20]], [add('bridgeSpan', 4)]),
  // The pylons it reaches farther with are Land Registry's (D107), the Territory's since D128.
  // Far Claim (D119, was Tier 4 after the treaties): a parcel that does not touch the claim's land, from Tier 2 — after the camouflaged ribbon.
  xp_far: node('t2_land', 4, 'xp_camo', ['Concession lointaine', 'Far Claim'], ['Acheter une parcelle qui ne touche pas tes terres.', 'Buy a parcel that does not touch your land.'], [['steel', 30], ['copper_wire', 80]], [flag('farClaims')]),
  xp4: node('t2_land', 4, 'xp_bridges', ['Pylônes renforcés', 'Reinforced Pylons'], ['Les pylônes portent à 60 tuiles.', 'Pylons reach 60 tiles.'], [['steel', 40], ['cable', 40]], [add('pylonLink', 20)], ['tr4']),
  xp_distrib: node('t3_transport', 5, null, ['Distributeurs', 'Distributors'], ['Débloque le Distributeur (routeur 2×2).', 'Unlocks the Distributor (a 2×2 router).'], [['thermal_core', 10], ['gear', 100]]),
  xp_express: node('t3_transport', 6, 'xp_distrib', ['Ruban express', 'Express Ribbon'], ['Débloque le Ruban express (240/min).', 'Unlocks the Express Ribbon (240/min).'], [['lens', 15], ['gear', 120]]),
  // Its keystone, the Great Skydock (`xp_bigdock`), went with the skydocks (D108, content/retired.ts): Transport ends on the Express Ribbon.
  xp_treaties: node('t3_transport', 6, null, ['Traités de voisinage', 'Neighbour Treaties'], ['Tous tes rubans, pas seulement le camouflé, et tes poteaux traversent les terres des bases voisines, entre leurs bâtiments.', 'All your ribbons, not just the camouflaged one, and your poles cross the neighbouring bases’ land, between their buildings.'], [['lens', 20], ['copper_wire', 200]], [flag('neighbourCrossing')]),
} as const satisfies Record<string, ResearchDef>;

export type ResearchId = keyof typeof RESEARCH;

// ── plans (D33) ─────────────────────────────────────────────────────────────
// Instant unlocks paid from the Heart. Each id names the plan; by default a plan is named after
// the building it unlocks (`unlock: '<plan id>'` on that building). Root plans (no prerequisite)
// are cheap — the starting stock (120 plates, 40 glass, 60 copper wire) affords them all at once
// and still keeps CrierBelt's restart reserve (D36) — and costs grow with depth. Plans are
// declared path by path, in `PLAN_PATHS` order (the tree's bands, top to bottom), so the first
// plan ready to take is the topmost; effects apply in this order (they are flags: it never matters).
const plan = (lane: PlanDef['lane'], prereq: string[], cost: Array<[string, number]>, more: Partial<PlanDef> = {}): PlanDef =>
  ({ lane, prereq, cost, ...more });

const PATH_PLANS = {
  // ── production: smelting and crafting ──────────────────────────────────
  kiln: plan('production', [], [['iron_plate', 10]]),
  sand_collector: plan('production', ['kiln'], [['iron_plate', 5]]), // sand off the bare ground, for glass (2026-10-12)
  wire_mill: plan('production', ['kiln'], [['iron_plate', 15]]),
  // The assembly bench (D129): copper wire wound on iron plates into coils, after the wire mill — in
  // the electronics workshop's place, which is Tier 2's research now (its circuits wanted more than
  // wire and glass). Its motors wait for Mechanics' gears.
  assembly_bench: plan('production', ['wire_mill'], [['iron_plate', 15], ['copper_wire', 4]]),
  // The Face Cutter (D87): a plan since D101 (owner, 2026-10-17: « le face cutter devrait être
  // beaucoup plus rapide à obtenir »), taken with the others before the lab — the quartz a parcel
  // away is cut as soon as the parcel is bought. Its id kept from the research node it was: saves
  // that learnt it hold it still. It brings the Face Cutter (the Quartz Workshop and its oscillator
  // came with it until D128: a research node of their own now, `dn_quartzshop`, after the lab). Its quartz is a cliff face's: maps 1–2 have no vein
  // and buy it at the Crier, so the trade post comes first (D107: nothing unlocked that cannot be
  // used). On the Production path since the Survey path went with the survey beacon (D117; owner,
  // 2026-10-17: « le face cutter va dans production »).
  ex_quartz: plan('production', ['wire_mill', 'trade_post'], [['iron_plate', 20], ['glass', 6], ['copper_wire', 6]], {
    name: { fr: 'Haveuse', en: 'Face Cutter' },
    desc: {
      fr: 'La Haveuse, qui taille le quartz d’une paroi depuis son pied. L’Atelier de quartz, qui en fait des oscillateurs, se recherche au laboratoire.',
      en: 'The Face Cutter, which cuts quartz out of a cliff face from its foot. The Quartz Workshop, which makes oscillators of it, is researched at the lab.',
    },
  }),

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
  // The unloader, after the silo, is retired (D117; owner, 2026-10-17: « le "Unloader" n'est plus
  // nécessaire »): a silo's outputs empty it by themselves. Its plan, held, is dropped (save v17).
  underflow_gate: plan('logistics', ['overflow_gate'], [['iron_plate', 6], ['copper_wire', 2]]),

  // ── energy ────────────────────────────────────────────────────────────────
  wind_flower: plan('energy', [], [['iron_plate', 10]]),
  // The coal generator's plan (`brazier`) went with it (D143; owner, 2026-10-19: « coal incinerator,
  // delete it »): a claim that held it is refunded by save v22 (`PLANS_RETIRED`, content/retired.ts).
  // Water's first use, in Tier 1 (D114; owner, 2026-10-17: « Il faudrait que l'eau serve assez tôt
  // dans le jeu, dès le Tier 1 »): the steam boiler, and the pump and conduit that bring it water
  // (they were Ceramics', Tier 2). After the turbine since D143 (it hung from the coal generator's plan).
  steam: plan('energy', ['wind_flower'], [['iron_plate', 20], ['glass', 4], ['copper_wire', 2]], {
    name: { fr: 'Vapeur', en: 'Steam Power' },
    desc: {
      fr: 'La Chaudière à vapeur, et ce qui lui porte son eau\u00a0: la Pompe à eau et le Conduit.',
      en: 'The Steam Boiler, and what brings it its water: the Water Pump and the Conduit.',
    },
  }),

  // ── analytics (D41): what the base shows you, one readout per step. Each turns on its own
  // flag, named after it (`ANALYTICS` below); the UI reads them through src/ui/analytics.ts.
  // `telemetry` stays the first step (saves hold its id; the tutorial's quest 2 asks for it).
  telemetry: plan('analytics', [], [['iron_plate', 8], ['copper_wire', 2]], {
    name: { fr: 'Télémétrie', en: 'Telemetry' },
    desc: {
      fr: 'Les débits de ta base au HUD : ce qui entre au Cœur chaque minute, à côté de chaque stock.',
      en: 'Your base’s rates in the HUD: what comes into the Core each minute, beside each stock.',
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
  // The wind (D95): until this plan the player reads the wind only off the land and off what a
  // turbine gives once built; then the Vent view shows where it blows and from where.
  anemometry: plan('analytics', ['power_log'], [['iron_plate', 12], ['copper_wire', 6], ['glass', 4]], {
    name: { fr: 'Anémométrie', en: 'Wind Survey' },
    desc: {
      fr: 'La vue Vent (V) : où le Souffle porte et d’où il vient, sa courbe sur la journée, et ce qu’une éolienne donnerait là où tu la poses.',
      en: 'The Wind view (V): where the Sough blows and where it comes from, its curve over the day, and what a turbine would give where you place it.',
    },
    effects: [flag('anemometry')],
  }),

  // ── trade: the Crier's door. Its entry hangs from the telemetry (know your rates, then sell).
  trade_post: plan('trade', ['telemetry'], [['iron_plate', 20]]),
} as const satisfies Record<string, PlanDef>;

/**
 * The research lab's plan (D71, owner 2026-10-14): the gate between the plans and research. It
 * needs every other plan, and brings the lab (the data collector went with the data, D122).
 */
const LAB_GATE = { observatory: plan('gate', Object.keys(PATH_PLANS), [['iron_plate', 40], ['glass', 10], ['copper_wire', 10]]) } as const;

export const PLANS = { ...PATH_PLANS, ...LAB_GATE } as const satisfies Record<string, PlanDef>;

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

// ── categories (D128) ───────────────────────────────────────────────────────

const CAT_NODES = new Map<string, string[]>();
for (const [id, r] of Object.entries(RESEARCH) as Array<[string, ResearchDef]>) CAT_NODES.set(r.cat, [...(CAT_NODES.get(r.cat) ?? []), id]);

/** A category's nodes, in the table's order. */
export const categoryNodes = (c: string): readonly string[] => CAT_NODES.get(c) ?? [];

/** Is a category finished (D128): every node of it learnt — what opens the categories it gates. */
export const categoryDone = (c: string, done: ReadonlySet<string>): boolean => categoryNodes(c).every((id) => done.has(id));

/** The gates of a research node's category not finished yet (D128), in their table's order (none: open). */
export const unmetGates = (id: string, done: ReadonlySet<string>): string[] =>
  [...(categoryDef(researchNode(id)?.cat ?? '')?.gates ?? [])].filter((g) => !categoryDone(g, done));

/** The categories a category opens (D128): those of the next tier that name it in their gates. */
export const categoryOpens = (c: string): CategoryId[] => CATEGORY_IDS.filter((k) => (CATEGORIES[k].gates as readonly string[]).includes(c));

const NEEDS = new Map<string, readonly string[]>();
/**
 * Everything a research node waits for in the tree (D128), each once: its own prerequisites (as
 * drawn), its tier's gate (`TIER_GATE`: the node behind the Core's level the tier waits for, D118),
 * and every node of its category's gates. The engine reads them apart — a prerequisite missing, a
 * gate unfinished (`researchBlock`) —; the content's checks and the debug bases' grants as one list.
 */
export function researchNeeds(id: string): readonly string[] {
  const known = NEEDS.get(id);
  if (known) return known;
  const r = researchNode(id);
  if (!r) return [];
  const out = new Set(r.prereq);
  const g = TIER_GATE[r.tier];
  if (g && g !== id) out.add(g);
  for (const c of categoryDef(r.cat)?.gates ?? []) for (const n of categoryNodes(c)) out.add(n);
  const list = [...out];
  NEEDS.set(id, list);
  return list;
}

/** A category's name (the tree's headers, the launch dialog, the detail pane). */
export const categoryName = (c: string): Loc => categoryDef(c)?.name ?? { fr: c, en: c };

/** A tree node's prerequisites: a plan's own, a research node's every need (`researchNeeds`); none for an unknown id. */
export const treePrereq = (id: string): readonly string[] => planDef(id)?.prereq ?? researchNeeds(id);

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

/**
 * The plan paths, top to bottom on the tree: making things first, then knowing and selling. The
 * survey path (the survey beacon, then the Face Cutter) went with the beacon (D117): the fog lifts as
 * the claim grows, and the Face Cutter makes things.
 */
export const PLAN_PATHS: readonly PlanLane[] = ['production', 'logistics', 'energy', 'analytics', 'trade'];

/**
 * Analytics (D41): the flag each analytics plan turns on — its own id —, by the readout it gates.
 * The HUD, the stats screen and the hotkeys read these (src/ui/analytics.ts), never a bare string.
 */
export const ANALYTICS = {
  /** What comes into the Heart each minute, beside each stock in the HUD. */
  rates: 'telemetry',
  /** The Statistics screen (G) and its chip in the HUD. */
  ledger: 'statistics',
  /** The power history (demand against what is available) in the Statistics. */
  power: 'power_log',
  /** The machines' states in the Statistics. */
  machines: 'diagnostics',
  /** The wind (D95): the Vent view, the wind's readings in a turbine's card, its output while placing one. */
  wind: 'anemometry',
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
  for (const id of PLAN_IDS) if (PLANS[id].lane !== 'gate' && !PLAN_PATHS.includes(PLANS[id].lane)) errs.push(`plan ${id}: path ${PLANS[id].lane} is not in PLAN_PATHS`);
  // The gate (D71): one plan, the research lab's, after every plan of the paths; research hangs from it.
  const gates = PLAN_IDS.filter((id) => PLANS[id].lane === 'gate');
  if (gates.length !== 1 || gates[0] !== LAB_PLAN) errs.push(`the gate must be the one plan ${LAB_PLAN} (found ${gates.join(', ') || 'none'})`);
  for (const id of PLAN_IDS) if (PLANS[id].lane !== 'gate' && !PLANS[LAB_PLAN].prereq.includes(id)) errs.push(`plan ${LAB_PLAN}: does not need ${id} (the gate needs every plan)`);
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
