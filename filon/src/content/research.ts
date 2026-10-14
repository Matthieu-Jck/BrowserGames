// research.ts — the one unlock tree (D33): everything the base uses beyond its starting kit
// (drill, ribbon, pole and the Link tool) is unlocked here, in two kinds of node.
//   · PLANS: instant unlocks paid with materials from the Heart, Mindustry-style — no lab, no
//     time. Cheap near the root (the starting stock affords every root plan), dearer deeper; six
//     paths of one theme each (D41: production, logistics, energy, analytics, trade, survey —
//     `PLAN_PATHS`), each growing from one entry. Unlocking one is the `unlockPlan` command
//     (src/sim/systems/research.ts).
//   · RESEARCH (D69): the tree's advanced part, run by research labs over a minimum time and paid
//     as it runs in data files (items, by ribbon) and AI tokens (D68: bought by the minute, the
//     claim's own servers first). It reads in four tiers. The trunk (the Foundations) opens each
//     tier; six families grow beside it, each named anew at every tier (Commerce: Exchange, then
//     Finance, then Market Economy) and most splitting in two specialities at Tier 3 (Precision
//     Machines: Electronics or Mechanics). The higher the tier, the dearer a node gets for every
//     node owned elsewhere — another family, or the sibling speciality (runtime.ts `penalty`):
//     the tree pushes a claim to specialise.
//   · Every node unlocks something: a building (its `unlock` field names the node) or a feature
//     (a flag the engine reads, a research slot, a Heart output); never a bare boost (owner,
//     2026-10-14, D70).
// What a node unlocks is derived from the `unlock` field of buildings and recipes (and BAL's
// Heart levels); plan and research ids share one namespace and one `sim.done` set.
import { BUILDINGS } from './buildings';
import type { BuildingDef, Effect, FamilyId, Loc, PlanDef, PlanLane, ResearchDef, ResearchTier } from './types';

/**
 * What a node of each depth uses up as it runs — data (`scienceCost`), AI tokens — and its minimum duration
 * (minutes). Depths 1–2 are Tier 1, 3–4 Tier 2, 5–6 Tier 3, 7 and the keystones (9) Tier 4.
 * Tokens cost `BAL.tokenCentsPerK` at CrierBelt's servers (10 ◉ the thousand).
 */
export const DEPTH_COST: Record<number, { data: number; tokens: number; minutes: number }> = {
  1: { data: 15, tokens: 10_000, minutes: 3 },
  2: { data: 60, tokens: 30_000, minutes: 15 },
  3: { data: 180, tokens: 100_000, minutes: 45 },
  4: { data: 480, tokens: 300_000, minutes: 120 },
  5: { data: 960, tokens: 600_000, minutes: 240 },
  6: { data: 1920, tokens: 1_200_000, minutes: 480 },
  7: { data: 2880, tokens: 2_000_000, minutes: 720 },
  9: { data: 5760, tokens: 6_000_000, minutes: 1440 },
};

/**
 * The kinds of data research uses (owner, 2026-10-14: the different kinds stay, D71), one more
 * each tier, each a share of the node's data: Survey Data (from the data collectors and the
 * Core), Mechanics Data from Tier 2 (the test bench), atlases from Tier 3 and codices from Tier 4
 * (the scriptorium) — so every tier asks the claim for one more production line.
 */
export const SCIENCE: ReadonlyArray<readonly [string, number]> = [['journal_1', 1], ['journal_2', 3], ['atlas', 12], ['codex', 40]];

/** A node's data: `data` Survey Data and a share of it in each higher kind its tier uses. */
export function scienceCost(tier: ResearchTier, data: number): Array<[string, number]> {
  return SCIENCE.slice(0, tier).map(([item, div]) => [item, Math.max(1, Math.ceil(data / div))] as [string, number]);
}

/** A depth's tier. */
export const tierOfDepth = (depth: number): ResearchTier => (depth <= 2 ? 1 : depth <= 4 ? 2 : depth <= 6 ? 3 : 4);

/** The trunk node a family node of each tier needs (Tier 1 needs none: the lab's plan). */
export const TIER_GATE: Record<ResearchTier, string | null> = { 1: null, 2: 'tr1', 3: 'tr6', 4: 'tr8' };

/** The plan research hangs from: no lab, no research (D33). */
const LAB_PLAN = 'observatory';

/** The families, in the tree's order (top to bottom under the trunk). */
export const FAMILY_IDS: readonly FamilyId[] = ['en', 'ex', 'dn', 'cm', 'an', 'xp'];

/**
 * A family's names (D69): one per tier for its shared lineage (Tiers 1–2, and 3–4 when it does not
 * split), and its specialities from Tier 3 on, by key.
 */
export interface FamilyDef {
  readonly name: Loc;
  readonly tiers: readonly [Loc, Loc, Loc, Loc];
  readonly specs?: Readonly<Record<string, Loc>>;
}

const L = (fr: string, en: string): Loc => ({ fr, en });

export const FAMILIES: Readonly<Record<FamilyId, FamilyDef>> = {
  en: { name: L('Énergie', 'Energy'), tiers: [L('Production d’électricité', 'Power Generation'), L('Réseau électrique', 'Power Grid'), L('Énergie', 'Energy'), L('Énergie', 'Energy')], specs: { r: L('Renouvelables', 'Renewables'), c: L('Centrales', 'Power Plants') } },
  ex: { name: L('Extraction', 'Extraction'), tiers: [L('Extraction', 'Extraction'), L('Prospection', 'Prospecting'), L('Extraction', 'Extraction'), L('Extraction', 'Extraction')], specs: { d: L('Forage', 'Drilling'), x: L('Excavation', 'Excavation') } },
  dn: { name: L('Machines', 'Machines'), tiers: [L('Machines de précision', 'Precision Machines'), L('Automatisation', 'Automation'), L('Machines', 'Machines'), L('Machines', 'Machines')], specs: { e: L('Électronique', 'Electronics'), m: L('Mécanique', 'Mechanics') } },
  cm: { name: L('Commerce', 'Commerce'), tiers: [L('Échange', 'Exchange'), L('Finance', 'Finance'), L('Économie de marché', 'Market Economy'), L('Économie de marché', 'Market Economy')] },
  an: { name: L('Analytique', 'Analytics'), tiers: [L('Analytique', 'Analytics'), L('Données', 'Data'), L('Analytique', 'Analytics'), L('Analytique', 'Analytics')], specs: { c: L('Calcul', 'Computing'), m: L('Exploration de données', 'Data Mining') } },
  xp: { name: L('Expansion', 'Expansion'), tiers: [L('Arpentage', 'Surveying'), L('Logistique', 'Logistics'), L('Expansion', 'Expansion'), L('Expansion', 'Expansion')], specs: { t: L('Transport', 'Transport'), c: L('Concessions', 'Claims') } },
};

/** What a family is called where a node stands: its speciality from the split on, else its tier's name. */
export function familyName(family: FamilyId, tier: ResearchTier, spec?: string): Loc {
  const f = FAMILIES[family];
  return (spec ? f.specs?.[spec] : undefined) ?? f.tiers[tier - 1]!;
}

const mul = (target: Extract<Effect, { k: 'mul' }>['target'], permille: number): Effect => ({ k: 'mul', target, permille });
const add = (target: Extract<Effect, { k: 'add' }>['target'], v: number): Effect => ({ k: 'add', target, v });
const flag = (f: string): Effect => ({ k: 'flag', flag: f });
void mul;

function trunk(depth: number, tier: ResearchTier, prereq: string[], data: number, tokens: number, minutes: number, name: [string, string], desc: [string, string], effects: Effect[] = []): ResearchDef {
  return { name: { fr: name[0], en: name[1] }, desc: { fr: desc[0], en: desc[1] }, branch: 'trunk', tier, depth, prereq, cost: scienceCost(tier, data), tokens, minutes, effects };
}

/**
 * A family node: its cost from its depth, its prerequisites — the node before it in its lineage
 * (`after`; none for a family's first node, which needs the lab's plan) and its tier's gate.
 */
function node(family: FamilyId, spec: string | undefined, depth: number, after: string | null, name: [string, string], desc: [string, string], effects: Effect[] = []): ResearchDef {
  const tier = tierOfDepth(depth);
  const prereq: string[] = [after ?? LAB_PLAN];
  const g = TIER_GATE[tier];
  if (g) prereq.push(g);
  const c = DEPTH_COST[depth]!;
  return { name: { fr: name[0], en: name[1] }, desc: { fr: desc[0], en: desc[1] }, branch: family, ...(spec ? { spec } : {}), tier, depth, prereq, cost: scienceCost(tier, c.data), tokens: c.tokens, minutes: c.minutes, effects };
}

export const RESEARCH = {
  // ── the trunk: the Foundations, which open each tier ─────────────────────
  tr1: trunk(1, 1, ['observatory'], 20, 8_000, 5, ['Mécanique', 'Mechanics'], ['Presse et engrenages ; Cœur niveau 2. Ouvre le Tier 2.', 'Press and gears; Core level 2. Opens Tier 2.']),
  tr2: trunk(2, 2, ['tr1'], 40, 15_000, 10, ['Terrassement', 'Earthworks'], ['Excavatrice : creuser le grès et le basalte (H1–H2).', 'Excavator: dig sandstone and basalt (H1–H2).']),
  tr3: trunk(3, 2, ['tr1'], 120, 60_000, 30, ['Céramique', 'Ceramics'], ['Four à céramique, pompes et conduits ; atelier d’assemblage, batteries vides, accumulateurs.', 'Ceramic oven, pumps and conduits; assembly workshop, empty batteries, accumulators.']),
  tr4: trunk(4, 2, ['tr3'], 240, 120_000, 60, ['Cadastre', 'Land Registry'], ['Baux de parcelles, pylônes ; Cœur niveau 3.', 'Parcel leases, pylons; Core level 3.'], [flag('lease')]),
  tr5: trunk(5, 2, ['tr4'], 480, 200_000, 120, ['Deuxième pupitre', 'Second Desk'], ['Un deuxième emplacement de recherche.', 'A second research slot.'], [{ k: 'slots', add: 1 }]),
  tr6: trunk(6, 2, ['tr4'], 960, 400_000, 240, ['Cartographie', 'Atlas Lore'], ['Atelier d’optique, Scriptorium, Embarcadère ; lentilles, toiles, cœurs thermiques, atlas ; Cœur niveau 4. Ouvre le Tier 3.', 'Optics workshop, Scriptorium, Skydock; lenses, canvas, thermal cores, atlases; Core level 4. Opens Tier 3.']),
  tr7: trunk(7, 3, ['tr6'], 2880, 800_000, 720, ['Troisième pupitre', 'Third Desk'], ['Un troisième emplacement de recherche.', 'A third research slot.'], [{ k: 'slots', add: 1 }]),
  tr8: trunk(8, 3, ['tr6'], 5760, 1_500_000, 1440, ['Codex', 'Codex Lore'], ['Codex, résonateurs, treillis de nacre. Ouvre le Tier 4.', 'Codex, resonators, nacre lattices. Opens Tier 4.']),

  // ── Energy: Power Generation → Power Grid → Renewables | Power Plants ─────
  en_pitch: node('en', undefined, 1, null, ['Éolienne à pas variable', 'Pitch-Control Turbine'], ['Débloque l’Éolienne à pas variable : 200 kW × le vent.', 'Unlocks the Pitch-Control Turbine: 200 kW × the wind.']),
  en2: node('en', undefined, 2, 'en_pitch', ['Panneaux solaires', 'Solar Panels'], ['Débloque le Panneau solaire.', 'Unlocks the Solar Panel.']),
  en_heavyacc: node('en', undefined, 3, 'en2', ['Accumulateur lourd', 'Heavy Accumulator'], ['Débloque l’Accumulateur lourd : 4 000 kW·min.', 'Unlocks the Heavy Accumulator: 4,000 kW·min.']),
  en4: node('en', undefined, 4, 'en_heavyacc', ['Chargeur', 'Battery Charging'], ['Débloque le Chargeur et les batteries chargées.', 'Unlocks the Battery Charger and charged batteries.']),
  en_solarfarm: node('en', 'r', 5, 'en4', ['Ferme solaire', 'Solar Farm'], ['Débloque la Ferme solaire : 600 kW, 20 % la nuit.', 'Unlocks the Solar Farm: 600 kW, 20% at night.']),
  en_bigwind: node('en', 'r', 6, 'en_solarfarm', ['Grande éolienne', 'Great Turbine'], ['Débloque la Grande éolienne : 500 kW × le vent.', 'Unlocks the Great Turbine: 500 kW × the wind.']),
  en_tower: node('en', 'r', 9, 'en_bigwind', ['Tour solaire', 'Solar Tower'], ['Débloque la Tour solaire : 3 MW le jour, 30 % la nuit.', 'Unlocks the Solar Tower: 3 MW by day, 30% at night.']),
  en5: node('en', 'c', 5, 'en4', ['Géothermie', 'Geothermal Power'], ['Débloque la Centrale géothermique, sur les évents.', 'Unlocks the Geothermal Plant, on vents.']),
  en_cellgen: node('en', 'c', 6, 'en5', ['Générateur à batteries', 'Battery Generator'], ['Débloque le Générateur à batteries : 600 kW par batterie chargée.', 'Unlocks the Battery Generator: 600 kW per charged battery.']),
  enK: node('en', 'c', 9, 'en_cellgen', ['Le Cœur-Soleil', 'The Sunheart'], ['Débloque le Cœur-Soleil : 20 MW pour un résonateur toutes les 30 minutes.', 'Unlocks the Sunheart: 20 MW for one resonator every 30 minutes.']),

  // ── Extraction: Extraction → Prospecting → Drilling | Excavation ─────────
  ex_sifter: node('ex', undefined, 1, null, ['Tamiseur', 'Sifter'], ['Débloque le Tamiseur : sable, fer ou cuivre tirés de la pierre.', 'Unlocks the Sifter: sand, iron or copper out of stone.']),
  ex3: node('ex', undefined, 2, 'ex_sifter', ['Remblai', 'Backfill'], ['Débloque la Remblayeuse.', 'Unlocks the Backfiller.']),
  ex4: node('ex', undefined, 3, 'ex3', ['Forets à basalte', 'Basalt Bits'], ['L’obsidienne (H3) devient creusable ; le basalte se creuse plus vite.', 'Obsidian (H3) becomes diggable; basalt digs faster.'], [flag('digH3'), flag('basaltBits')]),
  ex_fastdrill: node('ex', undefined, 4, 'ex4', ['Foreuse rapide', 'Fast Drill'], ['Débloque la Foreuse rapide : 35/min.', 'Unlocks the Fast Drill: 35/min.']),
  ex5: node('ex', 'd', 5, 'ex_fastdrill', ['Puits profond', 'Deep Bore'], ['Débloque la Foreuse profonde.', 'Unlocks the Deep Bore.']),
  ex_hppump: node('ex', 'd', 6, 'ex5', ['Pompe haute pression', 'High-Pressure Pump'], ['Débloque la Pompe haute pression : 240 eau/min.', 'Unlocks the High-Pressure Pump: 240 water/min.']),
  ex_giant: node('ex', 'd', 9, 'ex_hppump', ['Foreuse géante', 'Giant Drill'], ['Débloque la Foreuse géante : 90/min, plafonds ×2.', 'Unlocks the Giant Drill: 90/min, caps ×2.']),
  ex7: node('ex', 'x', 5, 'ex_fastdrill', ['Taille-cœur', 'Heartrock Cutters'], ['Le cœur-de-roche (H4) devient creusable.', 'Heartrock (H4) becomes diggable.'], [flag('digH4')]),
  ex_heavyexc: node('ex', 'x', 6, 'ex7', ['Excavatrice lourde', 'Heavy Excavator'], ['Débloque l’Excavatrice lourde : deux fois plus vite, 6 tuiles de portée.', 'Unlocks the Heavy Excavator: twice as fast, 6 tiles of reach.']),
  ex8: node('ex', 'x', 9, 'ex_heavyexc', ['Remblai profond', 'Deep Fill'], ['La Remblayeuse comble aussi l’eau profonde (120 pierres par tuile).', 'The Backfiller also fills deep water (120 stone a tile).'], [flag('deepFill')]),

  // ── Machines: Precision Machines → Automation → Electronics | Mechanics ───
  dn3: node('dn', undefined, 1, null, ['Machines compactes', 'Compact Machines'], ['Débloque la Fonderie compacte (1×2).', 'Unlocks the Compact Smelter (1×2).']),
  dn_wiremill: node('dn', undefined, 2, 'dn3', ['Tréfileuse double', 'Twin Wire Mill'], ['Débloque la Tréfileuse double : le fil deux fois plus vite.', 'Unlocks the Twin Wire Mill: wire twice as fast.']),
  dn4: node('dn', undefined, 3, 'dn_wiremill', ['Allure', 'Pace'], ['Un emplacement de module par machine, et la recette du module de vitesse (+30 % de vitesse, +40 % d’énergie).', 'One module slot per machine, and the speed module’s recipe (+30% speed, +40% power).'], [flag('modules1')]),
  dn_compact: node('dn', undefined, 4, 'dn4', ['Atelier d’assemblage compact', 'Compact Assembly'], ['Débloque l’Atelier d’assemblage compact (2×2).', 'Unlocks the Compact Assembly Workshop (2×2).']),
  dn_etcher: node('dn', 'e', 5, 'dn_compact', ['Graveuse', 'Etcher'], ['Débloque la Graveuse : circuits et modules trois fois plus vite.', 'Unlocks the Etcher: circuits and modules three times as fast.']),
  dn7: node('dn', 'e', 6, 'dn_etcher', ['Allure II', 'Pace II'], ['Deux emplacements de module par machine, +50 % chacun.', 'Two module slots per machine, +50% each.'], [flag('modules2')]),
  dn_chipfab: node('dn', 'e', 9, 'dn7', ['Usine de puces', 'Chip Fab'], ['Débloque l’Usine de puces : circuits et modules six fois plus vite.', 'Unlocks the Chip Fab: circuits and modules six times as fast.']),
  dn_forge: node('dn', 'm', 5, 'dn_compact', ['Presse à forger', 'Forging Press'], ['Débloque la Presse à forger : les engrenages trois fois plus vite.', 'Unlocks the Forging Press: gears three times as fast.']),
  dn_arc: node('dn', 'm', 6, 'dn_forge', ['Fonderie à arc', 'Arc Furnace'], ['Débloque la Fonderie à arc : plaques et verre sans charbon.', 'Unlocks the Arc Furnace: plates and glass without coal.']),
  dn8: node('dn', 'm', 9, 'dn_arc', ['Tour d’assemblage', 'Assembly Tower'], ['Débloque la Tour d’assemblage : l’assemblage quatre fois plus vite.', 'Unlocks the Assembly Tower: assembly four times as fast.']),

  // ── Commerce: Exchange → Finance → Market Economy (one lineage) ─────────
  cm2: node('cm', undefined, 1, null, ['Ordres permanents', 'Standing Orders'], ['Jusqu’à 6 ordres d’import.', 'Up to 6 import orders.'], [add('orders', 4)]),
  cm_floor: node('cm', undefined, 2, 'cm2', ['Prix plancher', 'Floor Prices'], ['Un prix minimum par objet : le comptoir garde ce qui se vendrait moins cher.', 'A minimum price per item: the post holds back what would sell for less.'], [flag('floorPrices')]),
  cm3: node('cm', undefined, 3, 'cm_floor', ['Second quai', 'Second Wharf'], ['Comptoir niveau 2 (240/min) ; un second comptoir.', 'Trade post level 2 (240/min); a second post.'], [flag('tradeL2')]),
  cm_plan: node('cm', undefined, 4, 'cm3', ['Forfait de calcul', 'Compute Plan'], ['Un forfait CrierBelt : les tokens à moitié prix, contre un montant fixe par heure.', 'A CrierBelt plan: tokens at half price, for a fixed fee an hour.'], [flag('tokenPlan')]),
  cm8: node('cm', undefined, 5, 'cm_plan', ['Grand comptoir', 'Grand Post'], ['Comptoir niveau 3 (480/min).', 'Trade post level 3 (480/min).'], [flag('tradeL3')]),
  cm_express: node('cm', undefined, 6, 'cm8', ['Fret express', 'Express Freight'], ['Un ordre peut partir en express : deux fois plus vite, 25 % plus cher.', 'An order can ship express: twice as fast, 25% dearer.'], [flag('expressFreight')]),
  cm_rent: node('cm', undefined, 7, 'cm_express', ['Location de serveurs', 'Server Rental'], ['CrierBelt rachète, à moitié prix, les tokens que tes serveurs n’utilisent pas.', 'CrierBelt buys the tokens your servers do not use, at half price.'], [flag('serverRental')]),
  cmK: node('cm', undefined, 9, 'cm_rent', ['La Maison de Criée', 'The Crier House'], ['Un troisième comptoir.', 'A third trade post.'], [flag('post3')]),

  // ── Analytics: Analytics → Data → Computing | Data Mining ────────────────
  an_data: node('an', undefined, 1, null, ['Traitement des données', 'Data Processing'], ['Le Cœur traite l’activité de la base : 1 fichier de données par minute, par sa sortie de données.', 'The Core processes the base’s activity: 1 data file a minute, out of its data outlet.'], [add('heartData', 1000)]),
  an_relay: node('an', undefined, 2, 'an_data', ['Relais de données', 'Data Relay'], ['Débloque le Relais de données : 6 fichiers par minute.', 'Unlocks the Data Relay: 6 files a minute.']),
  an_servers: node('an', undefined, 3, 'an_relay', ['Salle des serveurs', 'Server Room'], ['Débloque le Serveur : tes propres tokens d’IA, de l’électricité.', 'Unlocks the Server: your own AI tokens, from power.']),
  an_queue: node('an', undefined, 4, 'an_servers', ['File de recherche', 'Research Queue'], ['Chaque laboratoire enchaîne la recherche que tu lui as préparée.', 'Each lab moves on to the research you queued for it.'], [flag('researchQueue')]),
  an_cooled: node('an', 'c', 5, 'an_queue', ['Serveur refroidi', 'Cooled Server'], ['Débloque le Serveur refroidi : 6 000 tokens par minute.', 'Unlocks the Cooled Server: 6,000 tokens a minute.']),
  an_slot: node('an', 'c', 6, 'an_cooled', ['Calcul partagé', 'Shared Computing'], ['Un emplacement de recherche de plus.', 'One more research slot.'], [{ k: 'slots', add: 1 }]),
  an_super: node('an', 'c', 9, 'an_slot', ['Supercalculateur', 'Supercomputer'], ['Débloque le Supercalculateur : 20 000 tokens par minute.', 'Unlocks the Supercomputer: 20,000 tokens a minute.']),
  an_mining: node('an', 'm', 5, 'an_queue', ['Fouille de données', 'Data Mining'], ['Le Cœur produit 2 fichiers de données de plus par minute.', 'The Core makes 2 more data files a minute.'], [add('heartData', 2000)]),
  an_forecast: node('an', 'm', 6, 'an_mining', ['Prévision des cours', 'Price Forecast'], ['La Criée montre où va chaque cours dans l’heure.', 'The Crier shows where each price is heading within the hour.'], [flag('forecast')]),
  an_autolab: node('an', 'm', 9, 'an_forecast', ['Laboratoire autonome', 'Autonomous Lab'], ['Débloque le Laboratoire autonome : 3 fichiers par minute, sur place.', 'Unlocks the Autonomous Lab: 3 files a minute, on site.']),

  // ── Expansion: Surveying → Logistics → Transport | Claims ───────────────
  xp_swift: node('xp', undefined, 1, null, ['Ruban vif', 'Swift Ribbon'], ['Débloque le Ruban vif (120/min).', 'Unlocks the Swift Ribbon (120/min).']),
  xp_bigsilo: node('xp', undefined, 2, 'xp_swift', ['Grand silo', 'Great Silo'], ['Débloque le Grand silo : 5 000 objets.', 'Unlocks the Great Silo: 5,000 items.']),
  xp_bridges: node('xp', undefined, 3, 'xp_bigsilo', ['Passerelles longues', 'Long Bridges'], ['Les passerelles portent à 8 tuiles.', 'Bridges reach 8 tiles.'], [add('bridgeSpan', 4)]),
  xp4: node('xp', undefined, 4, 'xp_bridges', ['Pylônes renforcés', 'Reinforced Pylons'], ['Les pylônes portent à 60 tuiles.', 'Pylons reach 60 tiles.'], [add('pylonLink', 20)]),
  xp_distrib: node('xp', 't', 5, 'xp4', ['Distributeurs', 'Distributors'], ['Débloque le Distributeur (routeur 2×2).', 'Unlocks the Distributor (a 2×2 router).']),
  xp_express: node('xp', 't', 6, 'xp_distrib', ['Ruban express', 'Express Ribbon'], ['Débloque le Ruban express (240/min).', 'Unlocks the Express Ribbon (240/min).']),
  xp_bigdock: node('xp', 't', 9, 'xp_express', ['Grand embarcadère', 'Great Skydock'], ['Débloque le Grand embarcadère : 8 Dérivants, deux fois plus de fret.', 'Unlocks the Great Skydock: 8 Drifters, twice the freight.']),
  xp_resell: node('xp', 'c', 5, 'xp4', ['Revente de parcelles', 'Parcel Resale'], ['Revendre une parcelle achetée, à 80 % de son prix.', 'Sell a bought parcel back, at 80% of its price.'], [flag('landResale')]),
  xp_treaties: node('xp', 'c', 6, 'xp_resell', ['Traités de voisinage', 'Neighbour Treaties'], ['Tes rubans et poteaux traversent les parcelles des concessions sœurs.', 'Your ribbons and poles cross the sister claims’ parcels.'], [flag('sisterCrossing')]),
  xp_far: node('xp', 'c', 9, 'xp_treaties', ['Concession lointaine', 'Far Claim'], ['Acheter une parcelle qui ne touche pas tes terres.', 'Buy a parcel that does not touch your land.'], [flag('farClaims')]),
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
  workshop: plan('production', ['kiln'], [['iron_plate', 15], ['glass', 2]]),
  wire_mill: plan('production', ['kiln'], [['iron_plate', 15]]),

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
      en: 'Your base’s rates in the HUD: what the Core gains or loses per minute, beside each stock.',
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

/**
 * The research lab's plan (D71, owner 2026-10-14): the gate between the plans and research. It
 * needs every other plan, and brings the lab and the data collector that feeds it.
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
