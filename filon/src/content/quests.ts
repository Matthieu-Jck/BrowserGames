// quests.ts — the tutorial (design §8 « Prise en main », decision D28): twelve objectives, 0–11,
// run in this order, one at a time. The fiction: the player is an investor living in Verrière,
// Ysmère's glass city, in partnership with CrierBelt (the company that runs the Crier Ring and
// its cargo lifts, and takes a cut on every trade); their base in the Bonne-Veine cirque is
// fully automated, built by drones and steered from afar. CrierBelt is the voice that sets the
// objectives (`desc`: its messages, « vous ») and pays the rewards (its shipments and bonuses);
// the guide's hints (`steps`) speak as the rest of the UI does (« tu »).
//
// Two rules shape it (owner, 2026-10-12):
// · the Heart only takes in (D34): it pays for construction and sells next to a trade post, it
//   never feeds a machine — every machine is fed by its own production lines, so the tutorial
//   builds lines: a router splits the iron line between the Heart and the smelter, another
//   shares the coal, routers branch the plate and glass lines into the workshop;
// · everything beyond the starting kit (drill, ribbon, pole, the Link tool) is unlocked in
//   the tech tree (D33): a quest opens the tree and unlocks what it needs before using it — the
//   telemetry first, then the smelter and the router, the junction once lines cross…
//
// Pure data, three parts per quest:
// · objectives: what it asks, read by the engine (src/sim/systems/quests.ts) from the base's
//   state and counters (`any`: one of them is enough);
// · reward: what it gives, paid into the Heart when it completes (items, ◉, a building's
//   materials, a Heart level's materials, waived Crier fees, a title in the register);
// · steps: how the guide shows the way (src/ui/guide.ts) — each a UI target and a one-line
//   hint; the first step whose `done` objective does not hold yet is the current one, so a step
//   is never shown once the base already does what it asks.
// Numbers live here (targets, rewards); how to add a quest: docs/quests.md. Targets are kept small
// (owner, 2026-10-12: "the tutorial is too long"): each one is a minute or two of play, never a wait.
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { RESEARCH, isTreeNode } from './research';
import type { BuildCategory, BuildingDef, Loc, RecipeDef } from './types';
import { CIRQUE } from './world';

/** The engine looks at the current quest every this many ticks (1 game second; divides an epoch). */
export const QUEST_CHECK_TICKS = 10;
/** A colony name: 1 to this many characters. */
export const COLONY_NAME_MAX = 32;

/**
 * What a quest asks. Counters marked *since* count from the moment the quest became current;
 * the others read the colony as it stands. `label` replaces the generated line in the log;
 * `title` is the title an `any` quest's reward grants when this objective completes it.
 */
export type QuestObjective = (
  /** The claim was named (the `nameColony` command). */
  | { readonly k: 'name' }
  /** n built (finished, awake) buildings among `defs` (drills on a deposit of `item`, if given). */
  | { readonly k: 'build'; readonly defs: readonly string[]; readonly item?: string; readonly n: number }
  /** The Hearth holds n of these items (summed). */
  | { readonly k: 'stock'; readonly items: readonly string[]; readonly n: number }
  /** n of these items made (mined or crafted), *since*. */
  | { readonly k: 'produce'; readonly items: readonly string[]; readonly n: number }
  /** These items made at `perMin` or more over the last full game minute (epoch to epoch). */
  | { readonly k: 'rate'; readonly items: readonly string[]; readonly perMin: number }
  /** n buildings among `defs` (drills on a deposit of `item`, if given) wired into a grid (generators: their output reaches it). */
  | { readonly k: 'linked'; readonly defs: readonly string[]; readonly item?: string; readonly n: number }
  /** n buildings among `defs` on a grid that serves them (satisfaction above 0). */
  | { readonly k: 'powered'; readonly defs: readonly string[]; readonly n: number }
  /** A research node started (or already learnt). */
  | { readonly k: 'research'; readonly id: string }
  /** These nodes of the tech tree unlocked: plans taken, research learnt (D33). */
  | { readonly k: 'unlocked'; readonly ids: readonly string[] }
  /** A trade post touching the Hearth (it sells from, and delivers into, its stock). */
  | { readonly k: 'post' }
  /** n of these items sold through the Crier (streams and spot sales), *since*. */
  | { readonly k: 'export'; readonly items: readonly string[]; readonly n: number }
  /** A standing import order for this item. */
  | { readonly k: 'order'; readonly item: string }
  /** n of these items delivered by imports (bought and arrived), *since*. */
  | { readonly k: 'import'; readonly items: readonly string[]; readonly n: number }
  /** An export stream sells the output of one of the `top` first lines of « Ce qui rapporte ». */
  | { readonly k: 'board'; readonly top: number }
  /** n tiles dug out of rock (the colony's total). */
  | { readonly k: 'dig'; readonly n: number }
  /** A built building whose centre lies `r` tiles or more from the Hearth's. */
  | { readonly k: 'reach'; readonly r: number }
  /** n buildings among `defs` set to this recipe. */
  | { readonly k: 'recipe'; readonly defs: readonly string[]; readonly recipe: string; readonly n: number }
  /** An export stream of this item, on any post. */
  | { readonly k: 'stream'; readonly item: string }
  /** n built buildings among `defs` (drills on a deposit of `item`, if given) whose output reaches the Heart through ribbons and routing blocks. */
  | { readonly k: 'delivers'; readonly defs: readonly string[]; readonly item?: string; readonly n: number }
  /**
   * n built buildings among `to` (set to `recipe`, if given) that receive `item` from a building
   * making it — a drill on its deposit, a machine on a recipe that puts it out — through ribbons
   * and routing blocks: a production line, the only way a machine is fed (the Heart gives nothing).
   */
  | { readonly k: 'feeds'; readonly item: string; readonly to: readonly string[]; readonly recipe?: string; readonly n: number }
) & { readonly label?: Loc; readonly title?: string };

export type QuestObjectiveKind = QuestObjective['k'];

/** What a completed quest pays into the Hearth (and the colony). */
export interface QuestReward {
  readonly items?: ReadonlyArray<readonly [string, number]>;
  /** Ocelles (◉). */
  readonly credits?: number;
  /** The materials of one building (its construction cost), e.g. « 1 générateur à charbon ». */
  readonly kit?: string;
  /** The materials of a Hearth level (2–4, from BAL.hearthUpgrades). */
  readonly hearthLevel?: number;
  /** The Crier's fees are waived for this many game minutes. */
  readonly feeFreeMin?: number;
  /** The title of the objective that completed the quest (`any` quests). */
  readonly title?: boolean;
}

/** A place in the world the guide can point at. */
export type GuideSpot =
  | { readonly deposit: string } // the cirque deposit of an item
  | { readonly between: string } // halfway between the Heart and the cirque deposit of an item: where a machine fed from it goes
  | { readonly hearth: true }
  | { readonly intake: true }    // a free input of the Heart, the nearest to the newest producer: where its ribbon must end
  | { readonly beyond: true }    // past the Crown (D45: closed, no pass)
  | { readonly entity: string }  // the first built building of a kind
  | { readonly newest: string }; // the newest built building of a kind

/** What the guide's arrow points at for a step; it follows the UI (tab → slot → the world). */
export type GuideTarget =
  /** Building `def`: its build-bar tab, then its slot, then (in hand) the spot. */
  | { readonly k: 'build'; readonly def: string; readonly at?: GuideSpot }
  /**
   * Branch the line carrying `item` into a building among `to`: while no routing block stands on
   * that line, a router onto it (tab, slot, then the line's tile nearest that building — it
   * replaces the ribbon, D24); then a ribbon to the building that does not receive `item` yet.
   */
  | { readonly k: 'branch'; readonly item: string; readonly to: readonly string[] }
  /** A machine among `defs`: the building in the world, then its recipe button. */
  | { readonly k: 'recipe'; readonly defs: readonly string[]; readonly recipe: string }
  /** The power Link tool. */
  | { readonly k: 'link' }
  /** The tech tree (the HUD chip, T), then the first of these nodes still locked: a plan's « Débloquer », a research's card and « Lancer ». */
  | { readonly k: 'unlock'; readonly ids: readonly string[] }
  /** The research screen (the HUD chip), the node's card, its start button. */
  | { readonly k: 'research'; readonly id: string }
  /** The Crier (the HUD ◉), a tab, then a control (export stream, order form, best line). */
  | { readonly k: 'crier'; readonly tab: 'prices' | 'trade' | 'board'; readonly focus?: 'export' | 'order' | 'best' }
  /** The landscaping brush. */
  | { readonly k: 'brush' }
  /** The quest log's naming button. */
  | { readonly k: 'name' }
  /** No arrow: the hint alone. */
  | { readonly k: 'none' };

export interface QuestStep {
  readonly hint: Loc;
  readonly target: GuideTarget;
  /** The step is over once this holds (counters count from the founding). Omitted: it lasts until the quest ends. */
  readonly done?: QuestObjective;
  /** UI-only: the step is over once the player has looked at this (the Crier's board). */
  readonly seen?: 'board';
}

/** Extra live lines the quest log shows for a quest. */
export type QuestInfo = 'vein' | 'delivery' | 'shortage' | 'board';

/**
 * A piece of the interface the tutorial reveals (owner, 2026-10-12: nothing on screen before
 * the tutorial uses it): HUD readouts, the construction bar, screens and tools. The bar's tabs
 * then follow what is unlocked (D27: a tab shows once one of its buildings is). An item's stock
 * shows once revealed here or once the base has made some of it itself.
 */
export type Reveal =
  | 'credits' | 'power' | 'clock' | 'research' | 'stats' | 'crier' | 'brush' | 'build'
  | `stock:${string}`;

export interface QuestDef {
  readonly name: Loc;
  readonly desc: Loc;
  /** What appears on screen when this quest becomes current (cumulative). */
  readonly reveals?: readonly Reveal[];
  readonly objectives: readonly QuestObjective[];
  /** One objective is enough (else all of them). */
  readonly any?: boolean;
  readonly reward: QuestReward;
  readonly steps: readonly QuestStep[];
  readonly info?: QuestInfo;
}

const ORES = ['iron_ore', 'copper_ore'] as const;
const DRILLS = ['drill', 'deep_bore'] as const;
const KILNS = ['kiln', 'kiln_compact'] as const;
const WORKSHOPS = ['workshop', 'great_workshop', 'great_workshop_compact', 'tower_workshop'] as const;
const MASTS = ['mast', 'pylon'] as const;
const NEAR_HEART = { hearth: true } as const;
/** Where an output ribbon must end: a free input of the Heart (its teal nozzles). */
const INTAKE = { intake: true } as const;

export const QUESTS = {
  // ── 0 ── the name ───────────────────────────────────────────────────────────
  claim: {
    name: { fr: 'Ta concession', en: 'Your Claim' },
    desc: {
      fr: 'Bienvenue dans le partenariat. Vos drones ont posé le Cœur de votre base au fond du cirque de Bonne-Veine ; elle travaille seule, vous la pilotez depuis Verrière. Donnez un nom à votre concession, que nous l’inscrivions au registre de la Criée.',
      en: 'Welcome to the partnership. Your drones have set your base’s Heart down in the Bonne-Veine cirque; it works by itself, and you steer it from Verrière. Give your claim a name, and we will enter it in the Crier’s register.',
    },
    objectives: [{ k: 'name' }],
    reward: {},
    steps: [
      { hint: { fr: 'Donne un nom à ta concession.', en: 'Give your claim a name.' }, target: { k: 'name' } },
    ],
  },

  // ── 1 ── a drill, a wire, a ribbon (the starting kit) ───────────────────────
  first_strike: {
    name: { fr: 'Premier coup de pioche', en: 'First Strike' },
    reveals: ['build', 'power', 'stock:iron_plate', 'stock:glass', 'stock:copper_wire', 'stock:iron_ore'],
    desc: {
      fr: 'Première étape : extraire. Posez une foreuse sur le gisement de fer, reliez-la au Cœur pour l’énergie, et tracez un ruban pour le minerai.',
      en: 'Step one: extract. Put a drill on the iron deposit, wire it to the Heart for power, and lay a ribbon for the ore.',
    },
    objectives: [
      { k: 'build', defs: DRILLS, n: 1 },
      { k: 'stock', items: ORES, n: 10, label: { fr: 'Minerai au Cœur', en: 'Ore in the Heart' } },
    ],
    reward: { items: [['iron_plate', 20]] },
    steps: [
      {
        hint: { fr: 'Pose une foreuse sur le gisement de fer, au nord du Cœur (R : tourner).', en: 'Place a drill on the iron deposit, north of the Heart (R: rotate).' },
        target: { k: 'build', def: 'drill', at: { deposit: 'iron_ore' } },
        done: { k: 'build', defs: DRILLS, n: 1 },
      },
      {
        hint: { fr: 'Relie-la au Cœur : outil Relier, clique le Cœur puis la foreuse. Trop loin (plus de 8 tuiles) ? Pose un poteau entre les deux.', en: 'Wire it to the Heart: Link tool, click the Heart, then the drill. Too far (over 8 tiles)? Place a pole between them.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: DRILLS, n: 1 },
      },
      {
        hint: { fr: 'Trace un ruban depuis la sortie de la foreuse jusqu’à une entrée du Cœur (ses buses turquoise).', en: 'Lay a ribbon from the drill’s output to an input of the Heart (its teal nozzles).' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: DRILLS, n: 1 },
      },
      { hint: { fr: 'Le minerai arrive : laisse-le s’entasser jusqu’à 10.', en: 'The ore is coming in: let it pile up to 10.' }, target: { k: 'none' } },
    ],
  },

  // ── 2 ── the tech tree's first plan, a second drill ─────────────────────────
  ribbon_lines: {
    name: { fr: 'Le Ruban', en: 'Ribbon Lines' },
    reveals: ['research'],
    desc: {
      fr: 'Une foreuse donne 20 minerais par minute, pas plus. Doublez-la. Et pour suivre vos débits, débloquez la Télémétrie dans l’arbre des techniques : un plan se paie en matériaux du Cœur et sert aussitôt.',
      en: 'A drill gives 20 ore a minute, no more. Double it. And to follow your rates, unlock Telemetry in the tech tree: a plan is paid with materials from the Heart and works at once.',
    },
    objectives: [
      { k: 'unlocked', ids: ['telemetry'] },
      { k: 'linked', defs: DRILLS, n: 2 },
      { k: 'produce', items: ORES, n: 20, label: { fr: 'Minerai extrait', en: 'Ore mined' } },
    ],
    reward: { items: [['glass', 10]] },
    steps: [
      {
        hint: { fr: 'Ouvre l’arbre des techniques (T) et débloque la Télémétrie.', en: 'Open the tech tree (T) and unlock Telemetry.' },
        target: { k: 'unlock', ids: ['telemetry'] },
        done: { k: 'unlocked', ids: ['telemetry'] },
      },
      {
        hint: { fr: 'Pose une deuxième foreuse sur le gisement de fer.', en: 'Place a second drill on the iron deposit.' },
        target: { k: 'build', def: 'drill', at: { deposit: 'iron_ore' } },
        done: { k: 'build', defs: DRILLS, n: 2 },
      },
      {
        hint: { fr: 'Relie-la elle aussi au Cœur (outil Relier).', en: 'Wire it to the Heart too (Link tool).' },
        target: { k: 'link' },
        done: { k: 'linked', defs: DRILLS, n: 2 },
      },
      {
        hint: { fr: 'Un ruban de sa sortie jusqu’à une entrée du Cœur, ou dans le ruban de la première foreuse.', en: 'A ribbon from its output to an input of the Heart, or into the first drill’s ribbon.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: DRILLS, n: 2 },
      },
      { hint: { fr: 'Les deux foreuses livrent : vingt minerais de plus. Le débit s’affiche à côté du stock.', en: 'Both drills deliver: twenty more ore. The rate shows next to the stock.' }, target: { k: 'none' } },
    ],
  },

  // ── 3 ── plates: a smelter fed by its lines, the router splits the iron ─────
  bloom_kiln: {
    name: { fr: 'La fonderie', en: 'The Smelter' },
    desc: {
      fr: 'Le minerai brut se vend mal, et le Cœur ne fait que recevoir : une fonderie se nourrit à même vos lignes. Le routeur partage la ligne de fer entre le Cœur et elle ; le charbon vient tout droit de sa foreuse.',
      en: 'Raw ore sells poorly, and the Heart only takes in: a smelter feeds straight from your lines. A router shares the iron line between the Heart and the smelter; the coal comes straight from its drill.',
    },
    objectives: [
      { k: 'build', defs: ['router'], n: 1 },
      { k: 'feeds', item: 'iron_ore', to: KILNS, n: 1, label: { fr: 'Minerai de fer jusqu’à la fonderie', en: 'Iron ore to the smelter' } },
      { k: 'feeds', item: 'coal', to: KILNS, n: 1, label: { fr: 'Charbon jusqu’à la fonderie', en: 'Coal to the smelter' } },
      { k: 'produce', items: ['iron_plate'], n: 10 },
    ],
    reward: { items: [['iron_plate', 30]] },
    steps: [
      {
        hint: { fr: 'Arbre des techniques (T) : débloque la Fonderie et le Routeur.', en: 'Tech tree (T): unlock the Smelter and the Router.' },
        target: { k: 'unlock', ids: ['kiln', 'router'] },
        done: { k: 'unlocked', ids: ['kiln', 'router'] },
      },
      {
        hint: { fr: 'Pose une foreuse sur le gisement de charbon, à l’ouest du Cœur.', en: 'Place a drill on the coal deposit, west of the Heart.' },
        target: { k: 'build', def: 'drill', at: { deposit: 'coal' } },
        done: { k: 'build', defs: DRILLS, item: 'coal', n: 1 },
      },
      {
        hint: { fr: 'Le charbon est trop loin du Cœur pour un fil direct (8 tuiles au plus) : pose un poteau à mi-chemin (onglet Énergie). Il se relie tout seul au Cœur.', en: 'The coal is too far from the Heart for a direct wire (8 tiles at most): place a pole halfway (Energy tab). It wires itself to the Heart.' },
        target: { k: 'build', def: 'mast', at: { between: 'coal' } },
        done: { k: 'build', defs: MASTS, n: 1 },
      },
      {
        hint: { fr: 'Relie la foreuse au poteau : outil Relier, clique le poteau puis la foreuse. Un poteau tend ses fils jusqu’à 6 tuiles ; encore trop loin ? Pose un autre poteau.', en: 'Wire the drill to the pole: Link tool, click the pole, then the drill. A pole reaches 6 tiles; still too far? Place another pole.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: DRILLS, item: 'coal', n: 1 },
      },
      {
        hint: { fr: 'Pose une fonderie entre le Cœur et le charbon : ses deux entrées sont à l’arrière (R : tourner).', en: 'Place a smelter between the Heart and the coal: its two inputs are at the back (R: rotate).' },
        target: { k: 'build', def: 'kiln', at: { between: 'coal' } },
        done: { k: 'build', defs: KILNS, n: 1 },
      },
      {
        hint: { fr: 'Clique la fonderie et choisis la recette Plaque de fer.', en: 'Click the smelter and pick the Iron Plate recipe.' },
        target: { k: 'recipe', defs: KILNS, recipe: 'iron_plate' },
        done: { k: 'recipe', defs: KILNS, recipe: 'iron_plate', n: 1 },
      },
      {
        hint: { fr: 'Amène le fer à la fonderie avec un routeur : pose-le où tu veux sur ta ligne de fer (il remplace le ruban), puis un ruban du routeur jusqu’à une entrée de la fonderie.', en: 'Get the iron to the smelter with a router: drop it anywhere on your iron line (it replaces the ribbon), then a ribbon from the router to an input of the smelter.' },
        target: { k: 'branch', item: 'iron_ore', to: KILNS },
        done: { k: 'feeds', item: 'iron_ore', to: KILNS, n: 1 },
      },
      {
        hint: { fr: 'Un ruban de la foreuse à charbon jusqu’à l’autre entrée de la fonderie.', en: 'A ribbon from the coal drill to the smelter’s other input.' },
        target: { k: 'build', def: 'ribbon', at: { entity: 'kiln' } },
        done: { k: 'feeds', item: 'coal', to: KILNS, n: 1 },
      },
      {
        hint: { fr: 'Et un ruban de sa sortie jusqu’à une entrée du Cœur.', en: 'And a ribbon from its output to an input of the Heart.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: KILNS, n: 1 },
      },
      { hint: { fr: 'Les plaques arrivent : dix en tout. Le routeur distribue le fer à tour de rôle.', en: 'The plates are coming: ten in all. The router deals the iron out in turn.' }, target: { k: 'none' } },
    ],
  },

  // ── 4 ── power: wind turbines on the grid, a powered workshop ───────────────
  first_wind: {
    name: { fr: 'Le Souffle', en: 'The Sough' },
    reveals: ['clock'],
    desc: {
      fr: 'Le panneau du Cœur s’éteint la nuit, et ses fils sont comptés. Le Souffle ne porte qu’en hauteur : plantez deux éoliennes sur la Couronne, les montagnes autour du cirque, reliez-les au réseau de poteau en poteau, et alimentez un atelier.',
      en: 'The Heart’s panel goes dark at night, and its wires are few. The Sough only blows up high: plant two wind turbines on the Crown, the mountains round the cirque, wire them to the grid pole by pole, and power a workshop.',
    },
    objectives: [
      { k: 'linked', defs: ['wind_flower'], n: 2 },
      { k: 'powered', defs: WORKSHOPS, n: 1 },
    ],
    reward: { kit: 'brazier' },
    steps: [
      {
        hint: { fr: 'Arbre des techniques : débloque l’Éolienne et l’Atelier.', en: 'Tech tree: unlock the Wind Turbine and the Workshop.' },
        target: { k: 'unlock', ids: ['wind_flower', 'workshop'] },
        done: { k: 'unlocked', ids: ['wind_flower', 'workshop'] },
      },
      {
        hint: { fr: 'Plante deux éoliennes sur la Couronne, les montagnes autour du cirque (onglet Énergie) : au fond du cirque, abrité, le vent ne donne presque rien.', en: 'Plant two wind turbines on the Crown, the mountains round the cirque (Energy tab): down in the sheltered cirque the wind gives next to nothing.' },
        target: { k: 'build', def: 'wind_flower', at: NEAR_HEART },
        done: { k: 'build', defs: ['wind_flower'], n: 2 },
      },
      {
        hint: { fr: 'Pose un atelier près de la fonderie : il recevra ses plaques.', en: 'Place a workshop near the smelter: it will take its plates.' },
        target: { k: 'build', def: 'workshop', at: { entity: 'kiln' } },
        done: { k: 'build', defs: WORKSHOPS, n: 1 },
      },
      {
        hint: { fr: 'Outil Relier : du Cœur, de poteau en poteau (ils se posent aussi sur la roche), jusqu’à chaque éolienne.', en: 'Link tool: from the Heart, pole to pole (they stand on rock too), to each turbine.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: ['wind_flower'], n: 2 },
      },
      {
        hint: { fr: 'Puis relie l’atelier, lui aussi.', en: 'Then wire the workshop too.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: WORKSHOPS, n: 1 },
      },
    ],
  },

  // ── 5 ── glass: a second smelter, the coal line shared by a router ──────────
  glassworks: {
    name: { fr: 'La verrerie', en: 'The Glassworks' },
    desc: {
      fr: 'Le verre se vend bien, et la recherche en réclame. Une seconde fonderie le coule à partir de sable : il y en a partout, c’est le sol du désert, et un collecteur le ramasse où tu veux. Elle brûle aussi du charbon : partage la ligne de charbon avec un routeur.',
      en: 'Glass sells well, and research calls for it. A second smelter casts it from sand: there is sand everywhere, it is the desert floor, and a collector scoops it wherever you like. It burns coal too: share the coal line with a router.',
    },
    objectives: [
      { k: 'feeds', item: 'sand', to: KILNS, n: 1, label: { fr: 'Sable jusqu’à une fonderie', en: 'Sand to a smelter' } },
      { k: 'feeds', item: 'coal', to: KILNS, n: 2, label: { fr: 'Charbon jusqu’aux deux fonderies', en: 'Coal to both smelters' } },
      { k: 'produce', items: ['glass'], n: 10 },
    ],
    reward: { items: [['iron_plate', 20], ['glass', 20]] },
    steps: [
      {
        hint: { fr: 'Arbre des techniques : débloque le Collecteur de sable.', en: 'Tech tree: unlock the Sand Collector.' },
        target: { k: 'unlock', ids: ['sand_collector'] },
        done: { k: 'unlocked', ids: ['sand_collector'] },
      },
      {
        hint: { fr: 'Pose une seconde fonderie près de la première.', en: 'Place a second smelter near the first.' },
        target: { k: 'build', def: 'kiln', at: { entity: 'kiln' } },
        done: { k: 'build', defs: KILNS, n: 2 },
      },
      {
        hint: { fr: 'Clique-la et choisis la recette Verre.', en: 'Click it and pick the Glass recipe.' },
        target: { k: 'recipe', defs: KILNS, recipe: 'glass' },
        done: { k: 'recipe', defs: KILNS, recipe: 'glass', n: 1 },
      },
      {
        hint: { fr: 'Pose deux collecteurs de sable juste à côté : n’importe où sur le sable nu. Trois sables font un verre.', en: 'Place two sand collectors right beside it: anywhere on bare sand. Three sand make one glass.' },
        target: { k: 'build', def: 'sand_collector', at: { newest: 'kiln' } },
        done: { k: 'build', defs: ['sand_collector'], n: 2 },
      },
      {
        hint: { fr: 'Relie-les au réseau (outil Relier).', en: 'Wire them into the grid (Link tool).' },
        target: { k: 'link' },
        done: { k: 'linked', defs: ['sand_collector'], n: 2 },
      },
      {
        hint: { fr: 'Du charbon pour elle : un routeur sur le ruban du charbon, puis un ruban du routeur jusqu’à la nouvelle fonderie.', en: 'Coal for it: a router on the coal ribbon, then a ribbon from the router to the new smelter.' },
        target: { k: 'branch', item: 'coal', to: KILNS },
        done: { k: 'feeds', item: 'coal', to: KILNS, n: 2 },
      },
      {
        hint: { fr: 'Le sable : des rubans des collecteurs jusqu’à son autre entrée (ils peuvent se rejoindre sur un seul).', en: 'The sand: ribbons from the collectors to its other input (they may join onto one).' },
        target: { k: 'build', def: 'ribbon', at: { newest: 'kiln' } },
        done: { k: 'feeds', item: 'sand', to: KILNS, n: 1 },
      },
      {
        hint: { fr: 'Le verre au Cœur : un ruban de sa sortie jusqu’à une entrée du Cœur.', en: 'The glass to the Heart: a ribbon from its output to an input of the Heart.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: KILNS, n: 2 },
      },
      { hint: { fr: 'Le verre coule : dix en tout.', en: 'The glass is flowing: ten in all.' }, target: { k: 'none' } },
    ],
  },

  // ── 6 ── survey data and research ───────────────────────────────────────────
  field_journal: {
    name: { fr: 'Données d’arpentage', en: 'Survey Data' },
    desc: {
      fr: 'La recherche se nourrit de données d’arpentage : un atelier les compile (deux plaques et un verre par paquet), un observatoire les transmet aux laboratoires de Verrière. Branchez l’atelier sur vos lignes de plaques et de verre, puis lancez Mécanique.',
      en: 'Research feeds on survey data: a workshop compiles it (two plates and a glass a package), an observatory uplinks it to Verrière’s labs. Plug the workshop into your plate and glass lines, then start Mechanics.',
    },
    objectives: [
      { k: 'produce', items: ['journal_1'], n: 3 },
      { k: 'build', defs: ['observatory'], n: 1 },
      { k: 'research', id: 'tr1' },
    ],
    reward: { credits: 100 },
    steps: [
      {
        hint: { fr: 'Arbre des techniques : débloque l’Observatoire, qui ouvre la recherche.', en: 'Tech tree: unlock the Observatory, which opens research.' },
        target: { k: 'unlock', ids: ['observatory'] },
        done: { k: 'unlocked', ids: ['observatory'] },
      },
      {
        hint: { fr: 'Clique l’atelier et choisis Données d’arpentage.', en: 'Click the workshop and pick Survey Data.' },
        target: { k: 'recipe', defs: WORKSHOPS, recipe: 'journal_1' },
        done: { k: 'recipe', defs: WORKSHOPS, recipe: 'journal_1', n: 1 },
      },
      {
        hint: { fr: 'Des plaques pour l’atelier : un routeur sur le ruban des plaques, puis un ruban du routeur jusqu’à l’atelier.', en: 'Plates for the workshop: a router on the plate ribbon, then a ribbon from the router to the workshop.' },
        target: { k: 'branch', item: 'iron_plate', to: WORKSHOPS },
        done: { k: 'feeds', item: 'iron_plate', to: WORKSHOPS, n: 1 },
      },
      {
        hint: { fr: 'Et du verre : un routeur sur le ruban du verre, puis un ruban jusqu’à l’autre entrée de l’atelier.', en: 'And glass: a router on the glass ribbon, then a ribbon to the workshop’s other input.' },
        target: { k: 'branch', item: 'glass', to: WORKSHOPS },
        done: { k: 'feeds', item: 'glass', to: WORKSHOPS, n: 1 },
      },
      {
        hint: { fr: 'Pose un observatoire près de l’atelier.', en: 'Place an observatory near the workshop.' },
        target: { k: 'build', def: 'observatory', at: { entity: 'workshop' } },
        done: { k: 'build', defs: ['observatory'], n: 1 },
      },
      {
        hint: { fr: 'Relie l’observatoire au réseau.', en: 'Wire the observatory into the grid.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: ['observatory'], n: 1 },
      },
      {
        hint: { fr: 'Un ruban de la sortie de l’atelier jusqu’à l’observatoire : les données y montent.', en: 'A ribbon from the workshop’s output to the observatory: the data goes up from there.' },
        target: { k: 'build', def: 'ribbon', at: { entity: 'observatory' } },
        done: { k: 'feeds', item: 'journal_1', to: ['observatory'], n: 1 },
      },
      {
        hint: { fr: 'Dans l’arbre (T), lance Mécanique.', en: 'In the tree (T), start Mechanics.' },
        target: { k: 'research', id: 'tr1' },
        done: { k: 'research', id: 'tr1' },
      },
      { hint: { fr: 'Les paquets arrivent : trois en tout. La recherche les consomme à mesure.', en: 'The packages are coming: three in all. Research uses them up as they arrive.' }, target: { k: 'none' } },
    ],
  },

  // ── 7 ── the first trade ────────────────────────────────────────────────────
  crier_calls: {
    name: { fr: 'La Criée appelle', en: 'The Crier Calls' },
    reveals: ['credits', 'crier'],
    desc: {
      fr: 'Port-Écume manque de verre et paie cher. Un comptoir collé au Cœur vend depuis son stock, à chaque levée : nos cargos montent, nous prenons notre part, le reste est à vous.',
      en: 'Port-Écume is short of glass and pays well. A trade post against the Heart sells from its stock at every lift: our cargo craft go up, we take our cut, the rest is yours.',
    },
    objectives: [
      { k: 'post', label: { fr: 'Un comptoir collé au Cœur', en: 'A trade post against the Heart' } },
      { k: 'export', items: ['glass'], n: 10 },
    ],
    reward: { credits: 150 },
    info: 'shortage',
    steps: [
      {
        hint: { fr: 'Arbre des techniques : débloque le Comptoir.', en: 'Tech tree: unlock the Trade Post.' },
        target: { k: 'unlock', ids: ['trade_post'] },
        done: { k: 'unlocked', ids: ['trade_post'] },
      },
      {
        hint: { fr: 'Pose un comptoir collé au Cœur (onglet Commerce).', en: 'Place a trade post against the Heart (Commerce tab).' },
        target: { k: 'build', def: 'trade_post', at: NEAR_HEART },
        done: { k: 'post' },
      },
      {
        hint: { fr: 'Ouvre la Criée (M), onglet Échanges : un flux d’export de verre.', en: 'Open the Crier (M), Trade tab: an export stream of glass.' },
        target: { k: 'crier', tab: 'trade', focus: 'export' },
        done: { k: 'stream', item: 'glass' },
      },
      { hint: { fr: 'Chaque minute, le comptoir vend le verre que le Cœur a en trop (il en garde 25).', en: 'Every minute the post sells the glass the Heart has to spare (it keeps 25).' }, target: { k: 'none' } },
    ],
  },

  // ── 8 ── the tired vein ─────────────────────────────────────────────────────
  tired_vein: {
    name: { fr: 'Le filon fatigué', en: 'The Tired Vein' },
    desc: {
      fr: 'Nos relevés sont formels : le filon de cuivre du cirque est maigre. Tirez-en quand même du fil de cuivre, une foreuse dessus et une tréfileuse au bout.',
      en: 'Our surveys are clear: the cirque’s copper vein is thin. Draw copper wire from it anyway, with a drill on it and a wire mill at the end.',
    },
    objectives: [
      { k: 'build', defs: ['wire_mill'], n: 1 },
      { k: 'produce', items: ['copper_wire'], n: 10 },
    ],
    reward: { items: [['circuit', 10]] },
    info: 'vein',
    steps: [
      {
        hint: { fr: 'Arbre des techniques : débloque la Tréfileuse.', en: 'Tech tree: unlock the Wire Mill.' },
        target: { k: 'unlock', ids: ['wire_mill'] },
        done: { k: 'unlocked', ids: ['wire_mill'] },
      },
      {
        hint: { fr: 'Pose une foreuse sur le filon de cuivre, au sud du Cœur.', en: 'Place a drill on the copper vein, south of the Heart.' },
        target: { k: 'build', def: 'drill', at: { deposit: 'copper_ore' } },
        done: { k: 'build', defs: DRILLS, item: 'copper_ore', n: 1 },
      },
      {
        hint: { fr: 'Pose une tréfileuse à côté.', en: 'Place a wire mill beside it.' },
        target: { k: 'build', def: 'wire_mill', at: { deposit: 'copper_ore' } },
        done: { k: 'build', defs: ['wire_mill'], n: 1 },
      },
      {
        hint: { fr: 'Clique la tréfileuse et choisis Fil de cuivre.', en: 'Click the wire mill and pick Copper Wire.' },
        target: { k: 'recipe', defs: ['wire_mill'], recipe: 'copper_wire' },
        done: { k: 'recipe', defs: ['wire_mill'], recipe: 'copper_wire', n: 1 },
      },
      {
        hint: { fr: 'Relie la foreuse de cuivre au réseau (des poteaux portent les fils jusque-là).', en: 'Wire the copper drill into the grid (poles carry the wires out there).' },
        target: { k: 'link' },
        done: { k: 'linked', defs: DRILLS, item: 'copper_ore', n: 1 },
      },
      {
        hint: { fr: 'Puis la tréfileuse.', en: 'Then the wire mill.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['wire_mill'], n: 1 },
      },
      {
        hint: { fr: 'Un ruban de la foreuse jusqu’à la tréfileuse.', en: 'A ribbon from the drill to the wire mill.' },
        target: { k: 'build', def: 'ribbon', at: { entity: 'wire_mill' } },
        done: { k: 'feeds', item: 'copper_ore', to: ['wire_mill'], n: 1 },
      },
      {
        hint: { fr: 'Et un de la tréfileuse jusqu’à une entrée du Cœur.', en: 'And one from the wire mill to an input of the Heart.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: ['wire_mill'], n: 1 },
      },
      { hint: { fr: 'Compte le fil : le filon ne suffira pas longtemps.', en: 'Count the wire: the vein will not last you long.' }, target: { k: 'none' } },
    ],
  },

  // ── 9 ── buying ─────────────────────────────────────────────────────────────
  first_purchase: {
    name: { fr: 'Premier achat', en: 'First Purchase' },
    desc: {
      fr: 'Ce que le cirque n’a pas, la Criée le vend. Un ordre d’import permanent achète chaque minute, tant que le prix reste sous votre maximum. Vos achats arrivent dans le conteneur du comptoir et n’en sortent que par sa sortie, chacun son tour : tant qu’elle ne mène nulle part, l’ordre attend et rien n’est débité. Pour ce premier achat, CrierBelt vous offre une journée sans commission.',
      en: 'What the cirque lacks, the Crier sells. A standing import order buys every minute, as long as the price stays under your maximum. Your purchases land in the post’s container and leave only by its exit, each in turn: until it leads somewhere, the order waits and nothing is paid. For this first purchase, CrierBelt gives you a day without its cut.',
    },
    objectives: [
      { k: 'order', item: 'copper_ore' },
    ],
    reward: { feeFreeMin: 24 * 60 },
    info: 'delivery',
    steps: [
      {
        hint: { fr: 'Criée (M), onglet Échanges : un ordre d’import de minerai de cuivre, 10/min, 6 ◉ au plus.', en: 'Crier (M), Trade tab: an import order of copper ore, 10/min, at most 6 ◉.' },
        target: { k: 'crier', tab: 'trade', focus: 'order' },
        done: { k: 'order', item: 'copper_ore' },
      },
    ],
  },

  // ── 10 ── what pays ─────────────────────────────────────────────────────────
  the_board: {
    name: { fr: 'Le Tableau', en: 'The Board' },
    desc: {
      fr: 'Notre tableau, « Ce qui rapporte », classe vos recettes au prix du jour, par tuile de gisement. Faites passer un flux d’export sur l’une des trois premières.',
      en: 'Our board, “What pays”, ranks your recipes at today’s prices, per deposit tile. Switch an export stream to one of the top three.',
    },
    objectives: [{ k: 'board', top: 3 }],
    reward: { hearthLevel: 2 },
    info: 'board',
    steps: [
      {
        hint: { fr: 'Criée (M), « Ce qui rapporte » : les meilleures lignes sont en haut.', en: 'Crier (M), “What pays”: the best lines are at the top.' },
        target: { k: 'crier', tab: 'board', focus: 'best' },
        seen: 'board',
      },
      {
        hint: { fr: 'Puis, onglet Échanges : un flux d’export sur l’une des trois premières.', en: 'Then, Trade tab: an export stream on one of the top three.' },
        target: { k: 'crier', tab: 'trade', focus: 'export' },
      },
    ],
  },

  // ── 11 ── beyond the Crown ──────────────────────────────────────────────────
  beyond_crown: {
    name: { fr: 'Au-delà de la Couronne', en: 'Beyond the Crown' },
    reveals: ['brush'],
    desc: {
      fr: 'La Couronne enferme le cirque, sans un col. On en sort par-dessus : des rubans à traction montent les objets de gradin en gradin, des poteaux y portent le courant. Plantez une balise de l’autre côté — vos drones la livrent —, ou percez la roche : le registre en fera mention.',
      en: 'The Crown closes the cirque in, without a pass. The way out is over it: traction ribbons lift items from terrace to terrace, poles carry the power up. Plant a beacon on the far side — your drones deliver it — or dig through the rock: the register will make a note of it.',
    },
    objectives: [
      { k: 'dig', n: 2, title: 'taille' },
      { k: 'reach', r: CIRQUE.crownOuter, title: 'arpentage', label: { fr: 'Un bâtiment au-delà de la Couronne', en: 'A building beyond the Crown' } },
    ],
    any: true,
    reward: { title: true },
    steps: [
      {
        hint: { fr: 'Arbre des techniques : débloque la Balise d’arpentage.', en: 'Tech tree: unlock the Survey Beacon.' },
        target: { k: 'unlock', ids: ['beacon'] },
        done: { k: 'unlocked', ids: ['beacon'] },
      },
      {
        hint: { fr: 'Plante une balise d’arpentage au-delà de la Couronne… ou creuse deux tuiles (excavatrice, puis pinceau C).', en: 'Plant a survey beacon beyond the Crown… or dig two tiles (an excavator, then the brush, C).' },
        target: { k: 'build', def: 'beacon', at: { beyond: true } },
      },
    ],
  },
} as const satisfies Record<string, QuestDef>;

export type QuestId = keyof typeof QUESTS;
/** Quests in the order they run (their index is the quest's number, 0–11). */
export const QUEST_IDS = Object.keys(QUESTS) as QuestId[];

/** Titles a quest can grant: a mention of the base in the Crier's register (shown with its name). */
export const QUEST_TITLES: Readonly<Record<string, Loc>> = {
  taille: { fr: 'Perce-Couronne', en: 'Crown Breaker' },
  arpentage: { fr: 'Passe-Crête', en: 'Ridge Runner' },
};

/** A quest by id (undefined for an unknown id). */
export const questDef = (id: string): QuestDef | undefined => (QUESTS as Record<string, QuestDef>)[id];

// ── validation (run by content/validate.ts) ─────────────────────────────────

const has = (table: object, id: string): boolean => Object.prototype.hasOwnProperty.call(table, id);
const CATEGORIES: readonly BuildCategory[] = ['extraction', 'logistics', 'distribution', 'production', 'energy', 'colony', 'commerce'];
const recipeOf = (id: string): RecipeDef | undefined => (has(RECIPES, id) ? (RECIPES as Record<string, RecipeDef>)[id] : undefined);
const buildingOf = (id: string): BuildingDef | undefined => (has(BUILDINGS, id) ? (BUILDINGS as Record<string, BuildingDef>)[id] : undefined);

function objectiveProblems(where: string, o: QuestObjective, out: string[]): void {
  const items = (list: readonly string[]): void => { for (const it of list) if (!has(ITEMS, it)) out.push(`${where}: unknown item ${it}`); };
  const defs = (list: readonly string[]): void => { for (const d of list) if (!has(BUILDINGS, d)) out.push(`${where}: unknown building ${d}`); };
  if ('items' in o) { items(o.items); if (!o.items.length) out.push(`${where}: no items`); }
  if ('item' in o && o.item !== undefined) items([o.item]);
  if ('defs' in o) { defs(o.defs); if (!o.defs.length) out.push(`${where}: no buildings`); }
  if ('n' in o && !(Number.isInteger(o.n) && o.n > 0)) out.push(`${where}: n must be a positive integer`);
  if (o.k === 'rate' && !(o.perMin > 0)) out.push(`${where}: perMin must be positive`);
  if (o.k === 'research' && !has(RESEARCH, o.id)) out.push(`${where}: unknown research ${o.id}`);
  if (o.k === 'unlocked') {
    if (!o.ids.length) out.push(`${where}: no tree node`);
    for (const id of o.ids) if (!isTreeNode(id)) out.push(`${where}: unknown tree node ${id}`);
  }
  if (o.k === 'recipe') {
    const r = recipeOf(o.recipe);
    if (!r) out.push(`${where}: unknown recipe ${o.recipe}`);
    else for (const d of o.defs) if (!r.machines.includes(d)) out.push(`${where}: ${d} cannot run ${o.recipe}`);
  }
  if (o.k === 'feeds') {
    defs(o.to);
    if (!o.to.length) out.push(`${where}: no buildings`);
    if (o.recipe !== undefined) {
      const r = recipeOf(o.recipe);
      if (!r) out.push(`${where}: unknown recipe ${o.recipe}`);
      else for (const d of o.to) if (!r.machines.includes(d)) out.push(`${where}: ${d} cannot run ${o.recipe}`);
    }
  }
  if (o.title !== undefined && !has(QUEST_TITLES, o.title)) out.push(`${where}: unknown title ${o.title}`);
}

/** The cirque deposit of an item exists (the guide circles it, or the way to it from the Heart). */
const cirqueDeposit = (item: string): boolean => CIRQUE.deposits.some((d) => d.item === item);

/** Problems with the quest table (empty when it holds together). */
export function questProblems(): string[] {
  const out: string[] = [];
  // What the tutorial has had the player unlock so far (D33): the starting kit, then each `unlock`
  // step and `unlocked` objective, in run order. A step must never point at a building, a recipe
  // or a routing block the player cannot have yet: the tutorial unlocks before it uses.
  const have = new Set<string>(['start']);
  const usable = (where: string, unlock: string, what: string): void => {
    if (!have.has(unlock)) out.push(`${where}: ${what} is used before it is unlocked (${unlock})`);
  };
  for (const [id, q] of Object.entries(QUESTS) as Array<[string, QuestDef]>) {
    if (!q.objectives.length) out.push(`quest ${id}: no objective`);
    if (q.any && q.objectives.length < 2) out.push(`quest ${id}: 'any' needs two objectives or more`);
    q.objectives.forEach((o, i) => objectiveProblems(`quest ${id} objective ${i}`, o, out));
    const r = q.reward;
    for (const [it, n] of r.items ?? []) {
      if (!has(ITEMS, it)) out.push(`quest ${id}: unknown reward item ${it}`);
      if (!(n > 0)) out.push(`quest ${id}: reward ${it} must be positive`);
    }
    if (r.kit !== undefined && !has(BUILDINGS, r.kit)) out.push(`quest ${id}: unknown kit ${r.kit}`);
    if (r.hearthLevel !== undefined && !BAL.hearthUpgrades[r.hearthLevel - 2]) out.push(`quest ${id}: no Hearth level ${r.hearthLevel}`);
    if (r.title && !q.objectives.every((o) => o.title !== undefined)) out.push(`quest ${id}: a title reward needs a title on every objective`);
    if (!q.steps.length) out.push(`quest ${id}: no step for the guide`);
    q.steps.forEach((s, i) => {
      const where = `quest ${id} step ${i}`;
      const t = s.target;
      if (t.k === 'unlock') {
        if (!t.ids.length) out.push(`${where}: no tree node`);
        for (const n of t.ids) { if (!isTreeNode(n)) out.push(`${where}: unknown tree node ${n}`); have.add(n); }
      }
      if (t.k === 'build') {
        const b = buildingOf(t.def);
        if (!b) out.push(`${where}: unknown building ${t.def}`);
        else {
          if (!CATEGORIES.includes(b.category)) out.push(`${where}: ${t.def} is in no build-bar tab`);
          usable(where, b.unlock, t.def);
        }
        const at = t.at;
        if (at && 'deposit' in at && !cirqueDeposit(at.deposit)) out.push(`${where}: no cirque deposit of ${at.deposit}`);
        if (at && 'between' in at && !cirqueDeposit(at.between)) out.push(`${where}: no cirque deposit of ${at.between}`);
        if (at && 'entity' in at && !has(BUILDINGS, at.entity)) out.push(`${where}: unknown building ${at.entity}`);
        if (at && 'newest' in at && !has(BUILDINGS, at.newest)) out.push(`${where}: unknown building ${at.newest}`);
      }
      if (t.k === 'branch') {
        if (!has(ITEMS, t.item)) out.push(`${where}: unknown item ${t.item}`);
        if (!t.to.length) out.push(`${where}: no buildings`);
        for (const d of t.to) if (!has(BUILDINGS, d)) out.push(`${where}: unknown building ${d}`);
        usable(where, BUILDINGS.router.unlock, 'router');
      }
      if (t.k === 'recipe') {
        objectiveProblems(where, { k: 'recipe', defs: t.defs, recipe: t.recipe, n: 1 }, out);
        const rc = recipeOf(t.recipe);
        if (rc) usable(where, rc.unlock, `recipe ${t.recipe}`);
      }
      if (t.k === 'research' && !has(RESEARCH, t.id)) out.push(`${where}: unknown research ${t.id}`);
      if (s.done) {
        objectiveProblems(`${where} done`, s.done, out);
        if (s.done.k === 'unlocked') for (const n of s.done.ids) have.add(n);
      }
    });
    for (const o of q.objectives) if (o.k === 'unlocked') for (const n of o.ids) have.add(n);
  }
  return out;
}
