// expertises.ts — the claim's expertises (D93; owner, 2026-10-14: « les expertises, c'est très
// bien »): what the base has learnt to do well, as the tree's arc places them — the plans, the
// research lab, Tier 1 whole, the Core's level 3 and its Archive, where the claim picks two
// expertises it has earned, then Tier 2 and on.
//   · Each is EARNED by what the base did: a feat counted off the colony (ore extracted, ocelles of
//     sales at the Crier, the Core's grid held at 95 % hour after hour, parcels bought…), in three
//     ranks (I–III) whose thresholds the feat must reach — kept up, it climbs; a rank once earned
//     stays.
//   · Each IMPROVES one family: its production (a multiplier on a number the engine already reads
//     through the Mods: generators' output, drills' rate, machines' pace, data made, deliveries'
//     delay, land's price) or its research (the time, the AI tokens or the data a node of that
//     family takes). The percentages of the game live here only (D70, D72): the tree unlocks what
//     can be built, the expertises how well it is done.
//   · Two per family, one of each kind, each with a feat of its own: two picked are always two
//     ways of earning. The claim holds two at a time (`BAL.expertise.slots`); changing one is a
//     « réorientation »: paid in ocelles, dearer each time, the new one in place 24 h later.
// The rules are the engine's (src/sim/systems/expertise.ts); the window is ui/screens/expertise.ts.
// Pure data: no DOM, no clock.
import type { FamilyId, Loc, ModTarget } from './types';

/**
 * What a feat counts, read off the colony at each minute's boundary (systems/expertise.ts
 * `featValue`), in its unit:
 * · `grid`: the longest run of minutes the Core's grid served at least `BAL.expertise.gridPermille`
 *   at the minute's end (minutes);
 * · `capacity`: the rated output of every generator standing, the Core's panel included (kW);
 * · `mined`: raw matter extracted — ores, coal, stone, uniques (items made by drills, collectors,
 *   cutters and excavators);
 * · `dug`: tiles dug out or filled (the landscape's changes);
 * · `made`: materials and parts made (plates, glass, wire, gears, circuits…);
 * · `machines`: crafting machines standing;
 * · `sold` / `bought`: ocelles earned by sales and spent on purchases at the Crier, lifetime (◉);
 * · `data`: data items made (every kind);
 * · `tokens`: AI tokens research used, lifetime;
 * · `parcels`: parcels bought (held for good);
 * · `ribbons`: ribbon tiles laid (standing).
 */
export type FeatKind = 'grid' | 'capacity' | 'mined' | 'dug' | 'made' | 'machines' | 'sold' | 'bought' | 'data' | 'tokens' | 'parcels' | 'ribbons';

/** What a research expertise lowers in its family's nodes: the minimum time, the AI tokens, the data (every kind). */
export type ResearchAspect = 'time' | 'tokens' | 'data';

/**
 * What an expertise improves: a production number (one or more `Mods` targets, each multiplied
 * by the rank's ‰), or its family's research (one aspect, multiplied by the rank's ‰).
 */
export type ExpertiseEffect =
  | { readonly k: 'mod'; readonly targets: readonly ModTarget[] }
  | { readonly k: 'research'; readonly aspect: ResearchAspect };

export interface ExpertiseDef {
  readonly name: Loc;
  readonly family: FamilyId;
  readonly feat: FeatKind;
  /** The feat's value that earns ranks I, II and III (strictly rising). */
  readonly ranks: readonly [number, number, number];
  readonly effect: ExpertiseEffect;
  /** The effect at ranks I, II and III, ‰ of the number it multiplies (1100: +10 %; 850: −15 %). */
  readonly permille: readonly [number, number, number];
  /**
   * Its picture, for the UI: `item:<id>`, `building:<id>`, `glyph:<id>` (ui/glyphs.ts), `mark:<id>`
   * (the kit's marks) or `coin` (the ocelle).
   */
  readonly icon: string;
}

const L = (fr: string, en: string): Loc => ({ fr, en });

/** A production boost by rank: +10, +15, +20 %. */
const BOOST = [1100, 1150, 1200] as const;
/** A research saving by rank: −15, −25, −35 %. */
const SAVING = [850, 750, 650] as const;

/**
 * The expertises, by family in the tree's order (`FAMILY_IDS`): for each, the production one,
 * then the research one. Thresholds are set so a claim that completes Tier 1 has earned rank I of
 * several when the window opens (measured on the debug bases, 2026-10-16: the tutorial's base has
 * about 2 000 kW standing, 300 ribbon tiles, a parcel, 1 600 ◉ of sales after its first hour) — two
 * of them by Tier 1 itself, whose 13 nodes use about 530 data and 280 000 tokens (Archiving,
 * Inference) — and rank III asks for a long-grown base.
 */
export const EXPERTISES = {
  // ── Energy ───────────────────────────────────────────────────────────────
  steady_grid: { name: L('Réseau tenu', 'Steady Grid'), family: 'en', feat: 'grid', ranks: [120, 1440, 10_080], effect: { k: 'mod', targets: ['genOut'] }, permille: BOOST, icon: 'glyph:power' },
  power_eng: { name: L('Génie électrique', 'Power Engineering'), family: 'en', feat: 'capacity', ranks: [1_500, 6_000, 25_000], effect: { k: 'research', aspect: 'data' }, permille: SAVING, icon: 'building:wind_flower' },
  // ── Extraction ───────────────────────────────────────────────────────────
  ore_cutting: { name: L('Abattage', 'Ore Cutting'), family: 'ex', feat: 'mined', ranks: [10_000, 150_000, 1_500_000], effect: { k: 'mod', targets: ['drillRate'] }, permille: BOOST, icon: 'item:iron_ore' },
  geology: { name: L('Géologie', 'Geology'), family: 'ex', feat: 'dug', ranks: [10, 100, 1_000], effect: { k: 'research', aspect: 'time' }, permille: SAVING, icon: 'building:excavator' },
  // ── Machines ─────────────────────────────────────────────────────────────
  fabrication: { name: L('Fabrication', 'Fabrication'), family: 'dn', feat: 'made', ranks: [2_500, 40_000, 400_000], effect: { k: 'mod', targets: ['craftSpeed'] }, permille: BOOST, icon: 'item:gear' },
  methods: { name: L('Méthodes', 'Methods'), family: 'dn', feat: 'machines', ranks: [12, 40, 120], effect: { k: 'research', aspect: 'time' }, permille: SAVING, icon: 'building:workshop' },
  // ── Commerce ─────────────────────────────────────────────────────────────
  procurement: { name: L('Approvisionnement', 'Procurement'), family: 'cm', feat: 'bought', ranks: [1_000, 15_000, 150_000], effect: { k: 'mod', targets: ['deliveryDelay'] }, permille: SAVING, icon: 'glyph:crier' },
  trading: { name: L('Négoce', 'Trading'), family: 'cm', feat: 'sold', ranks: [3_000, 30_000, 300_000], effect: { k: 'research', aspect: 'tokens' }, permille: SAVING, icon: 'coin' },
  // ── Analytics ────────────────────────────────────────────────────────────
  archiving: { name: L('Archivage', 'Archiving'), family: 'an', feat: 'data', ranks: [500, 5_000, 50_000], effect: { k: 'mod', targets: ['dataRate'] }, permille: BOOST, icon: 'item:journal_1' },
  inference: { name: L('Inférence', 'Inference'), family: 'an', feat: 'tokens', ranks: [250_000, 3_000_000, 30_000_000], effect: { k: 'research', aspect: 'tokens' }, permille: SAVING, icon: 'mark:token' },
  // ── Expansion ────────────────────────────────────────────────────────────
  estate: { name: L('Domaine', 'Estate'), family: 'xp', feat: 'parcels', ranks: [1, 4, 12], effect: { k: 'mod', targets: ['landPrice'] }, permille: [900, 850, 800], icon: 'glyph:parcel' },
  haulage: { name: L('Convoyage', 'Haulage'), family: 'xp', feat: 'ribbons', ranks: [300, 1_500, 6_000], effect: { k: 'research', aspect: 'data' }, permille: SAVING, icon: 'building:ribbon' },
} as const satisfies Record<string, ExpertiseDef>;

export type ExpertiseId = keyof typeof EXPERTISES;
/** In the table's order (the window's, family by family). */
export const EXPERTISE_IDS = Object.keys(EXPERTISES) as ExpertiseId[];

export const isExpertise = (id: string): id is ExpertiseId => Object.prototype.hasOwnProperty.call(EXPERTISES, id);
export const expertiseDef = (id: string): ExpertiseDef | undefined => (isExpertise(id) ? (EXPERTISES as Record<string, ExpertiseDef>)[id] : undefined);

/** The rank a feat's value earns (0: not yet). */
export function rankFor(def: ExpertiseDef, value: number): number {
  let r = 0;
  while (r < 3 && value >= def.ranks[r]!) r++;
  return r;
}

/** The ‰ an expertise multiplies by at a rank (1–3; 1000 below rank I). */
export const effectAt = (def: ExpertiseDef, rank: number): number => (rank >= 1 ? def.permille[Math.min(3, rank) - 1]! : 1000);

/**
 * The table's invariants (run by validateContent): two per family, one production and one
 * research; a feat of its own each (two picked are two ways of earning); thresholds rising and
 * whole; production boosts above 1000 ‰ (or a saving under it where the number is a cost or a
 * delay), research savings under it, both rising with the rank; icons of a known kind.
 */
export function expertiseProblems(families: readonly FamilyId[]): string[] {
  const errs: string[] = [];
  const feats = new Map<FeatKind, string>();
  for (const id of EXPERTISE_IDS) {
    const d: ExpertiseDef = EXPERTISES[id];
    const seen = feats.get(d.feat);
    if (seen) errs.push(`expertise ${id}: feat ${d.feat} is ${seen}'s already`);
    feats.set(d.feat, id);
    if (!families.includes(d.family)) errs.push(`expertise ${id}: unknown family ${d.family}`);
    if (!(d.ranks[0] > 0 && d.ranks[0] < d.ranks[1] && d.ranks[1] < d.ranks[2]) || !d.ranks.every(Number.isInteger)) errs.push(`expertise ${id}: ranks must rise, whole and above 0`);
    if (!d.permille.every((p) => Number.isInteger(p) && p > 0)) errs.push(`expertise ${id}: its ‰ must be whole and above 0`);
    const lowers = d.effect.k === 'research' || d.effect.targets.some((t) => LOWER_IS_BETTER.has(t));
    const better = lowers ? d.permille[0] < 1000 && d.permille[1] < d.permille[0] && d.permille[2] < d.permille[1] : d.permille[0] > 1000 && d.permille[1] > d.permille[0] && d.permille[2] > d.permille[1];
    if (!better) errs.push(`expertise ${id}: its effect must improve with each rank`);
    if (!/^(item|building|glyph|mark):[a-z_0-9]+$|^coin$/i.test(d.icon)) errs.push(`expertise ${id}: icon ${d.icon} is of no known kind`);
  }
  for (const f of families) {
    const mine = EXPERTISE_IDS.filter((id) => EXPERTISES[id].family === f).map((id) => EXPERTISES[id].effect.k);
    if (mine.length !== 2 || !mine.includes('mod') || !mine.includes('research')) errs.push(`family ${f}: one production and one research expertise wanted (has ${mine.join(', ') || 'none'})`);
  }
  return errs;
}

/** Mod targets that are a cost or a delay: an expertise lowers them. */
export const LOWER_IS_BETTER: ReadonlySet<ModTarget> = new Set<ModTarget>(['deliveryDelay', 'landPrice', 'landRent', 'slippage', 'remoteBuildDelay']);
