// quests.ts — the tutorial (design §8 « Prise en main », decisions D28 and D101): the claim's name,
// then eleven quests (« Les scories » added by D125), run in this order, one at a time. The fiction: the player is an investor
// living in Verrière, Ysmère's glass city, in partnership with CrierBelt (the company that runs the
// Crier Ring and its cargo lifts, and takes a cut on every trade); their base in the Bonne-Veine
// cirque is fully automated, built by drones and steered from afar. CrierBelt is the voice that sets
// the objectives (`desc`: its messages, « vous ») and pays the rewards (its shipments and bonuses);
// the guide's hints speak as the rest of the UI does (« tu »).
//
// Two kinds of quest (D101; owner, 2026-10-16: « le début va trop vite et le tutoriel est trop
// long […] Parfois, on peut mettre une quête sans exiger du joueur qu'il clique à un endroit en
// particulier, le laisser expérimenter »):
// · **guided** (`steps`): the first basics only — a drill and its ribbon into the Core, a smelter
//   fed by a drill pair, a wire. The guide's arrow walks the steps, one action each; steps that
//   share a sentence share its hint, so the player reads a few larger steps. The first step whose
//   `done` does not hold (and that was never done: the guide remembers) is the current one; the last
//   is a closing line with no `done` (D98), what to watch while the quest waits for its numbers;
// · **goals** (`hints`): a short brief in CrierBelt's voice, one to three measurable objectives, a
//   reward — no arrow, no step list. On request (the log's « Indice ») or after a long while with no
//   progress (`QUEST_HINT_AFTER`), one gentle marker on the first hint still to do; never a stream.
// Objectives judge outcomes (the compiled graph, rates, stocks, totals), never particular clicks or
// tiles, so any way the player finds counts, and what was done before the quest (`ever`) counts too.
//
// Two rules from 2026-10-12 still shape it: the Heart only takes in (D34) — every machine is fed by
// its own lines —, and everything beyond the starting kit is unlocked in the tech tree (D33). The
// tree no longer offers every plan at once (D101): each quest `reveals` the few plans it is about
// (`plan:<id>`), and « Le laboratoire » (id `field_journal`) opens the rest (`plans`), a goal the player works
// through at their own pace before the lab (D71).
//
// Pure data, four parts per quest: objectives (read by the engine, src/sim/systems/quests.ts),
// reward (paid into the Heart on completion), steps or hints (the guide, src/ui/guide.ts), reveals
// (what of the interface it brings). Numbers live here; how to add a quest: docs/quests.md.
// Things the player can find alone are optional `SIDE_GOALS`, ticks in the log, not quests.
import { BAL } from './balance';
import { BUILDINGS } from './buildings';
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { PLAN_IDS, PLANS, RESEARCH, isPlan, isTreeNode } from './research';
import type { BuildCategory, BuildingDef, Loc, RecipeDef } from './types';
import { CIRQUE } from './world';

/** The engine looks at the current quest every this many ticks (1 game second; divides an epoch). */
export const QUEST_CHECK_TICKS = 10;
/** A colony name: 1 to this many characters. */
export const COLONY_NAME_MAX = 32;
/**
 * A goal quest's soft hint (D101): after this many game ticks with none of its objectives moving
 * (5 game minutes), the guide shows its one marker once, unasked. Tunable.
 */
export const QUEST_HINT_AFTER = 3000;
/**
 * The quest table's shape, saved with the quest state (D101): a save from an older table has its
 * quest ids folded into today's (`QUEST_FOLDS`), the quests added since counted done when it was
 * past them (`QUEST_ADDED`), and its current quest's baselines taken afresh. 2: the D101 table;
 * 3: « Le Cœur grandit » added; 4: « La vapeur » (D114); 5: « Les scories » (D125).
 */
export const QUEST_TABLE = 5;

/**
 * What a quest asks. Counters marked *since* count from the moment the quest became current, or
 * from the founding with `ever` (work done before the quest counts: D101); the others read the
 * colony as it stands. `label` replaces the generated line in the log; `title` is the title an
 * `any` quest's reward grants when this objective completes it.
 */
export type QuestObjective = (
  /** The claim was named (the `nameColony` command). */
  | { readonly k: 'name' }
  /** n built (finished, awake) buildings among `defs` (drills on a deposit of `item`, if given). */
  | { readonly k: 'build'; readonly defs: readonly string[]; readonly item?: string; readonly n: number }
  /** The Hearth holds n of these items (summed). */
  | { readonly k: 'stock'; readonly items: readonly string[]; readonly n: number }
  /** n of these items made (mined or crafted), *since* (or `ever`). */
  | { readonly k: 'produce'; readonly items: readonly string[]; readonly n: number; readonly ever?: true }
  /** These items made at `perMin` or more over the last full game minute (epoch to epoch). */
  | { readonly k: 'rate'; readonly items: readonly string[]; readonly perMin: number }
  /** n buildings among `defs` (drills on a deposit of `item`, if given) wired into a grid (generators: their output reaches it). */
  | { readonly k: 'linked'; readonly defs: readonly string[]; readonly item?: string; readonly n: number }
  /** n buildings among `defs` on a grid that serves them (satisfaction above 0). */
  | { readonly k: 'powered'; readonly defs: readonly string[]; readonly n: number }
  /** A research node started (or already learnt). */
  | { readonly k: 'research'; readonly id: string }
  /** These nodes of the tech tree unlocked: plans taken, research learnt (D33). */
  | { readonly k: 'unlocked'; readonly ids: readonly string[]; readonly label?: Loc }
  /** A trade post built. */
  | { readonly k: 'post' }
  /** n of these items sold through the Crier (by a post's entrance, or spot sales), *since* (or `ever`). */
  | { readonly k: 'export'; readonly items: readonly string[]; readonly n: number; readonly ever?: true }
  /** A standing import order for this item. */
  | { readonly k: 'order'; readonly item: string }
  /** n of these items delivered by imports (bought and arrived), *since* (or `ever`). */
  | { readonly k: 'import'; readonly items: readonly string[]; readonly n: number; readonly ever?: true }
  /** n tiles dug out of rock (the colony's total). */
  | { readonly k: 'dig'; readonly n: number }
  /**
   * The land's quartz vein stands on the claim's land, its parcel held (D87); met at once on a land
   * without one (maps 1–2, founded before it: their quartz comes from the Crier).
   */
  | { readonly k: 'vein' }
  /** A built building whose centre lies `r` tiles or more from the Hearth's. */
  | { readonly k: 'reach'; readonly r: number }
  /** n buildings among `defs` set to this recipe. */
  | { readonly k: 'recipe'; readonly defs: readonly string[]; readonly recipe: string; readonly n: number }
  /** n built buildings among `defs` (drills on a deposit of `item`, if given) whose output reaches the Heart through ribbons and routing blocks. */
  | { readonly k: 'delivers'; readonly defs: readonly string[]; readonly item?: string; readonly n: number }
  /**
   * n built buildings among `to` (set to `recipe`, if given) that receive `item` from a building
   * making it — a drill on its deposit, a machine on a recipe that puts it out, a trade post handing
   * out what it bought — through ribbons and routing blocks: a production line, the only way a
   * machine is fed (the Heart gives nothing). `from`: only producers among these buildings (the
   * trade post: goods bought, used, D101).
   */
  | { readonly k: 'feeds'; readonly item: string; readonly to: readonly string[]; readonly recipe?: string; readonly from?: readonly string[]; readonly n: number }
  /**
   * The Core's grid would serve `pct` % of its demand without the sun (D101, « Tenir la nuit »):
   * its producers in this weather with the sun at nothing, its fuelled generators, and what its
   * accumulators hold spread over a whole night. Read at any hour, so the player prepares by day.
   */
  | { readonly k: 'night'; readonly pct: number }
  /** CrierBelt's starter contract signed (D101: `BAL.starter`, systems/trade.ts). */
  | { readonly k: 'starter' }
  /** n parcels held beyond the starting square (bought, granted or leased: D60). */
  | { readonly k: 'land'; readonly n: number }
  /** The Core at this level or above (D101, « Le Cœur grandit »: the player's `hearthUp`). */
  | { readonly k: 'hearth'; readonly level: number }
) & { readonly label?: Loc; readonly title?: string };

export type QuestObjectiveKind = QuestObjective['k'];

/** What a completed quest pays into the Hearth (and the colony). */
export interface QuestReward {
  readonly items?: ReadonlyArray<readonly [string, number]>;
  /** Ocelles (◉). */
  readonly credits?: number;
  /** The materials of one building (its construction cost), e.g. « 1 éolienne ». */
  readonly kit?: string;
  /** The materials of a Hearth level (2–4, from BAL.hearthUpgrades). */
  readonly hearthLevel?: number;
  /** The title of the objective that completed the quest (`any` quests). */
  readonly title?: boolean;
  /** A title in the register, whatever completed the quest (a `QUEST_TITLES` id). */
  readonly grant?: string;
}

/** A place in the world the guide can point at. */
export type GuideSpot =
  | { readonly deposit: string } // the cirque deposit of an item
  | { readonly between: string } // halfway between the Heart and the cirque deposit of an item: where a machine fed from it goes
  | { readonly hearth: true }
  | { readonly intake: true }    // a free input of the Heart, the nearest to the newest producer: where its ribbon must end
  | { readonly beyond: true }    // past the Crown (D45: closed, no pass)
  | { readonly entity: string }  // the first built building of a kind
  | { readonly newest: string }  // the newest built building of a kind
  | { readonly vein: true }      // the floor at the foot of the land's quartz vein (D87): where a face cutter goes
  | { readonly windy: true }     // the Crown's windiest free spot for a turbine (D95: the wind field, read off the land)
  | { readonly water: true }     // the nearest spot to the Core where a pump draws water (D114: on any level; readouts/water.ts)
  | { readonly refused: true };  // a door where something waits refused (D139): the Core's, else a machine's (a slag at a line's head); none, the newest wire mill

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
  /** The tech tree (the HUD chip, T), then the first of these nodes ready to take (else still locked): a plan's « Débloquer », a research's card and « Lancer ». */
  | { readonly k: 'unlock'; readonly ids: readonly string[] }
  /** The research screen (the HUD chip), the node's card, its start button. */
  | { readonly k: 'research'; readonly id: string }
  /**
   * The Crier (the HUD ◉), a tab, then a control: the order form (its item, its rate `n` a minute if
   * given, « Ajouter »), or the starter contract's « Signer » (D101).
   */
  | { readonly k: 'crier'; readonly tab: 'prices' | 'trade' | 'board'; readonly focus?: 'order' | 'starter'; readonly n?: number }
  /** The landscaping brush. */
  | { readonly k: 'brush' }
  /** Buy a parcel (D60): the HUD's land button, then the parcel holding the spot, then its « Acheter ». */
  | { readonly k: 'land'; readonly at: GuideSpot }
  /** The quest log's naming button. */
  | { readonly k: 'name' }
  /** The Core's next level (D101): the Core in the world, then the upgrade at its card's foot. */
  | { readonly k: 'hearth' }
  /** The HUD's « Stock » button (D96: the Heart's stock is behind it), until its panel is open. */
  | { readonly k: 'stock' }
  /** No arrow: the hint alone. */
  | { readonly k: 'none' };

/** A guided quest's step, or a goal quest's hint: what to point at, in one line. */
export interface QuestStep {
  readonly hint: Loc;
  readonly target: GuideTarget;
  /** The step is over once this holds (counters count from the founding). Omitted: it lasts until the quest ends. */
  readonly done?: QuestObjective;
  /** Passed by while this holds (a hint for one way of doing it, once another way did it: D101). */
  readonly unless?: QuestObjective;
  /**
   * Only on a land with a quartz vein (`vein`: map 3, D87), or only on one without (`novein`: the
   * lands founded before it, whose quartz comes from the Crier): elsewhere the guide passes it by.
   */
  readonly land?: 'vein' | 'novein';
}

/** Extra live lines the quest log shows for a quest. */
export type QuestInfo = 'vein' | 'delivery' | 'shortage';

/**
 * A piece of the interface the tutorial reveals (owner, 2026-10-12: nothing on screen before
 * the tutorial uses it): HUD readouts, the construction bar, screens and tools. The bar's tabs
 * then follow what is unlocked (D27: a tab shows once one of its buildings is). An item's stock
 * shows once revealed here or once the base has made some of it itself. The specialised views
 * (D88) come one by one with the quest whose trouble they show (`view:*`; ui/views/view-bar.ts
 * shows the selector once one is in): Production and Électricité with the smelter (why a machine
 * waits; the night its three drills will see), Logistique with the glass's shared coal, Terrain
 * with the quartz parcel. The tree offers a plan once revealed (`plan:<id>`; `plans`: every plan, D101).
 */
export type Reveal =
  | 'credits' | 'power' | 'clock' | 'research' | 'stats' | 'crier' | 'brush' | 'build' | 'plans'
  | 'view:production' | 'view:power' | 'view:logistics' | 'view:land'
  | `plan:${string}`
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
  /** A guided quest (D101): the arrow walks these. */
  readonly steps?: readonly QuestStep[];
  /** A goal (D101): no arrow; on request or after a long stall, one marker for the first of these still to do. */
  readonly hints?: readonly QuestStep[];
  readonly info?: QuestInfo;
}

const ORES = ['iron_ore', 'copper_ore'] as const;
const DRILLS = ['drill', 'deep_bore'] as const;
const KILNS = ['kiln', 'kiln_compact'] as const;
const NEAR_HEART = { hearth: true } as const;
/** Where an output ribbon must end: a free input of the Heart (its teal nozzles). */
const INTAKE = { intake: true } as const;
/** « Tenir la nuit »'s measure: its turbine hints pass by once it holds (D101). */
const NIGHT_HOLDS = { k: 'night', pct: 80 } as const;
/** « Le Cœur grandit »'s measure: its hints for what is short pass by once the Core is raised. */
const CORE_2 = { k: 'hearth', level: 2 } as const;
/**
 * « Le quartz de la paroi »'s power (D146): by then the base draws more at night than the Core, the
 * boiler and « Tenir la nuit »'s turbine give (1 100–1 400 kW against about 1 100), and the next night
 * is a quarter hour away: it dipped to 30–85 % for 7–12 minutes on lands 1–3, the boiler's coal drill
 * slowing with the grid until the boiler ran dry. Six turbines wired hold it (docs/pacing.md). A count,
 * not `night`: past « La vapeur » that measure reads the boiler at its day's dispatch, so by day it
 * cannot tell a night that holds from one that does not.
 */
const WIND_SIX = { k: 'linked', defs: ['wind_flower', 'pitch_turbine'], n: 6, label: { fr: 'Six éoliennes au réseau', en: 'Six turbines on the grid' } } as const;
/** The plans of the six paths: all of them open the research lab's plan (D71). */
const PATH_PLANS = PLAN_IDS.filter((id) => PLANS[id].lane !== 'gate');

/** « La Criée »'s vein drill: one sentence over its two hints (the drill, its ribbon). */
const VEIN_DRILL = { fr: 'Le filon de cuivre, au sud du Cœur, est maigre mais il dure : une foreuse dessus, son ruban jusqu’à la tréfileuse.', en: 'The copper vein, south of the Core, is thin but it lasts: a drill on it, its ribbon to the wire mill.' } as const;
// « La fonderie »'s larger steps: one sentence each, over the steps its arrow walks (D101).
const KILN_COAL = { fr: 'Le charbon : une foreuse sur son gisement, à l’ouest, et un ruban de sa sortie jusqu’à une entrée de la fonderie.', en: 'The coal: a drill on its deposit, to the west, and a ribbon from its output to an input of the smelter.' } as const;
const KILN_IRON = { fr: 'Le fer : une deuxième foreuse sur le gisement de fer, et son ruban jusqu’à l’autre entrée.', en: 'The iron: a second drill on the iron deposit, and its ribbon to the other input.' } as const;
/** « La verrerie »'s coal (D146): one sentence over its two hints (the drill, its ribbon). */
const GLASS_COAL = { fr: 'Le charbon de la verrerie : une deuxième foreuse sur le gisement de charbon, son ruban jusqu’à l’autre entrée de la fonderie à verre. La fonderie de fer garde ainsi tout le sien.', en: 'The glassworks’ coal: a second drill on the coal deposit, its ribbon to the glass smelter’s other input. The iron smelter keeps all of its own that way.' } as const;
const KILN_WIRE = { fr: 'Relie les deux nouvelles foreuses au réseau (outil Relier). Trop loin pour un fil ? Un poteau le porte plus loin.', en: 'Wire both new drills into the grid (Link tool). Too far for a wire? A pole carries it further.' } as const;

export const QUESTS = {
  // ── the name (the intro's register, D31) ───────────────────────────────────
  claim: {
    name: { fr: 'Ta concession', en: 'Your Claim' },
    desc: {
      fr: 'Bienvenue dans le partenariat. Vos drones ont posé le Cœur de votre base au fond du cirque de Bonne-Veine ; elle travaille seule, vous la pilotez depuis Verrière. Donnez un nom à votre concession, que nous l’inscrivions au registre de la Criée.',
      en: 'Welcome to the partnership. Your drones have set your base’s Core down in the Bonne-Veine cirque; it works by itself, and you steer it from Verrière. Give your claim a name, and we will enter it in the Crier’s register.',
    },
    objectives: [{ k: 'name' }],
    reward: {},
    steps: [
      { hint: { fr: 'Donne un nom à ta concession.', en: 'Give your claim a name.' }, target: { k: 'name' } },
    ],
  },

  // ── 1 ── guided: a drill, a wire, a ribbon (the starting kit) ────────────────
  first_strike: {
    name: { fr: 'Premier coup de pioche', en: 'First Strike' },
    reveals: ['build', 'power', 'stock:iron_plate', 'stock:glass', 'stock:copper_wire', 'stock:iron_ore'],
    desc: {
      fr: 'Première étape : extraire. Une foreuse sur le gisement de fer, un fil du Cœur pour l’énergie, un ruban pour le minerai.',
      en: 'Step one: extract. A drill on the iron deposit, a wire from the Core for power, a ribbon for the ore.',
    },
    objectives: [
      { k: 'build', defs: DRILLS, n: 1 },
      { k: 'stock', items: ORES, n: 10, label: { fr: 'Minerai au Cœur', en: 'Ore in the Core' } },
    ],
    reward: { items: [['iron_plate', 20]] },
    steps: [
      {
        // Its output leaves at the front, north before a turn: away from the Core (playtest 2026-10-16).
        hint: { fr: 'Pose une foreuse sur le gisement de fer, au nord du Cœur, sa sortie tournée vers lui (R : tourner).', en: 'Place a drill on the iron deposit, north of the Core, its output turned towards it (R: rotate).' },
        target: { k: 'build', def: 'drill', at: { deposit: 'iron_ore' } },
        done: { k: 'build', defs: DRILLS, n: 1 },
      },
      {
        hint: { fr: 'Relie-la au Cœur : outil Relier, clique le Cœur puis la foreuse.', en: 'Wire it to the Core: Link tool, click the Core, then the drill.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: DRILLS, n: 1 },
      },
      {
        hint: { fr: 'Trace un ruban de sa sortie jusqu’à une entrée du Cœur (ses buses turquoise).', en: 'Lay a ribbon from its output to an input of the Core (its teal nozzles).' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: DRILLS, n: 1 },
      },
      // The closing line (D98): what to watch while the ore comes — the Stock, where it lands.
      { hint: { fr: 'Le minerai monte au Cœur. Ouvre le Stock pour le voir arriver.', en: 'The ore is on its way to the Core. Open the Stock to watch it come in.' }, target: { k: 'stock' } },
    ],
  },

  // ── 2 ── guided: a smelter fed by a drill pair (D97: 10 ore and 10 coal a minute) ──
  // The tree's first plan. No router: one drill of each feeds one smelter, the first drill keeps
  // feeding the Core (D101; the router comes with the glass, where a line is shared).
  bloom_kiln: {
    name: { fr: 'La fonderie', en: 'The Smelter' },
    // The clock and the Électricité view come here: three drills outgrow what the Core gives at
    // night, and the night notice (D101) points at that view before the first sunset.
    reveals: ['research', 'clock', 'view:production', 'view:power', 'plan:kiln'],
    desc: {
      fr: 'Le minerai brut se vend mal, et le Cœur ne fait que recevoir. Une fonderie coule des plaques ; elle se nourrit à même ses lignes : une foreuse de fer et une de charbon, chacune son ruban.',
      en: 'Raw ore sells poorly, and the Core only takes in. A smelter casts plates; it feeds straight from its lines: one drill on iron and one on coal, each with its ribbon.',
    },
    objectives: [
      { k: 'feeds', item: 'iron_ore', to: KILNS, n: 1, label: { fr: 'Minerai de fer jusqu’à la fonderie', en: 'Iron ore to the smelter' } },
      { k: 'feeds', item: 'coal', to: KILNS, n: 1, label: { fr: 'Charbon jusqu’à la fonderie', en: 'Coal to the smelter' } },
      { k: 'produce', items: ['iron_plate'], n: 10, ever: true },
    ],
    reward: { items: [['iron_plate', 30]] },
    steps: [
      {
        hint: { fr: 'Ouvre l’arbre des techniques (T) : un plan se paie en matériaux du Cœur et sert aussitôt. Prends la Fonderie.', en: 'Open the tech tree (T): a plan is paid in materials from the Core and works at once. Take the Smelter.' },
        target: { k: 'unlock', ids: ['kiln'] },
        done: { k: 'unlocked', ids: ['kiln'] },
      },
      {
        hint: { fr: 'Pose une fonderie entre le Cœur et le charbon, à l’ouest : ses deux entrées sont à l’arrière (R : tourner).', en: 'Place a smelter between the Core and the coal, to the west: its two inputs are at the back (R: rotate).' },
        target: { k: 'build', def: 'kiln', at: { between: 'coal' } },
        done: { k: 'build', defs: KILNS, n: 1 },
      },
      {
        hint: { fr: 'Clique-la et choisis la recette Plaque de fer.', en: 'Click it and pick the Iron Plate recipe.' },
        target: { k: 'recipe', defs: KILNS, recipe: 'iron_plate' },
        done: { k: 'recipe', defs: KILNS, recipe: 'iron_plate', n: 1 },
      },
      { hint: KILN_COAL, target: { k: 'build', def: 'drill', at: { deposit: 'coal' } }, done: { k: 'build', defs: DRILLS, item: 'coal', n: 1 } },
      { hint: KILN_COAL, target: { k: 'build', def: 'ribbon', at: { entity: 'kiln' } }, done: { k: 'feeds', item: 'coal', to: KILNS, n: 1 } },
      { hint: KILN_IRON, target: { k: 'build', def: 'drill', at: { deposit: 'iron_ore' } }, done: { k: 'build', defs: DRILLS, item: 'iron_ore', n: 2 } },
      { hint: KILN_IRON, target: { k: 'build', def: 'ribbon', at: { entity: 'kiln' } }, done: { k: 'feeds', item: 'iron_ore', to: KILNS, n: 1 } },
      // Wired after their lines: a drill cuts nothing unpowered, but lines first show the whole
      // factory before the power — and the link step finds the pole's place itself (D90).
      { hint: KILN_WIRE, target: { k: 'link' }, done: { k: 'linked', defs: DRILLS, item: 'coal', n: 1 } },
      { hint: KILN_WIRE, target: { k: 'link' }, done: { k: 'linked', defs: DRILLS, item: 'iron_ore', n: 2 } },
      {
        hint: { fr: 'Et les plaques au Cœur : un ruban de la sortie de la fonderie jusqu’à une entrée du Cœur.', en: 'And the plates to the Core: a ribbon from the smelter’s output to an input of the Core.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: KILNS, n: 1 },
      },
      { hint: { fr: 'Les plaques arrivent. Regarde la fonderie : elle attend ce que ses deux lignes lui portent.', en: 'The plates are coming. Watch the smelter: it waits for what its two lines bring.' }, target: { k: 'none' } },
    ],
  },

  // ── 3 ── goal: hold the night (D101; the wind, D95) ──────────────────────────
  // The Core's panel gives nothing at night (owner, 2026-10-16: « something should tell the user
  // that the core has solar panels that will stop producing electricity at night »): the night
  // notice (ui/night-notice.ts) says it before the first sunset, this quest asks for the answer.
  // Its isotope core gives most of its power, day and night (BAL.hearthCoreKw: two drills' worth at
  // level 1), so the night is about the player's own machines: three drills outgrow it. The wind
  // alone answers it since D143 retired the coal generator (owner, 2026-10-19: « coal incinerator,
  // delete it »): one thing to learn in the first hour, the turbine the night does not stop; the
  // steam boiler, the coal-fired plant now, comes two quests on with its pump and conduit (« La
  // vapeur »), and the brief says so. Solar with storage is Tier 1 research and Tier 2's accumulators.
  first_wind: {
    name: { fr: 'Tenir la nuit', en: 'Through the Night' },
    reveals: ['plan:wind_flower'],
    desc: {
      fr: 'Le noyau du Cœur donne jour et nuit, assez pour deux foreuses ; son panneau, lui, s’éteint au soir. Vos machines demandent déjà plus. Le Souffle ne tombe pas le soir, et il porte en hauteur, sur la Couronne : des éoliennes bien exposées y tiendront la nuit. Plus tard, une chaudière à vapeur la tiendra aussi, avec votre charbon et de l’eau. Préparez vos machines à passer la nuit.',
      en: 'The Core’s core gives day and night, enough for two drills; its panel goes dark at dusk. Your machines already ask for more. The Sough does not drop at dusk, and it blows up high, on the Crown: well-exposed turbines there will hold the night. Later, a steam boiler will hold it too, with your coal and some water. Get your machines ready for the night.',
    },
    objectives: [NIGHT_HOLDS],
    // One more turbine's materials (D143: the coal generator's until it left the game): the base grows, and a turbine gives 100 kW at most.
    reward: { kit: 'wind_flower' },
    hints: [
      {
        hint: { fr: 'L’Éolienne est dans l’arbre (T), voie Énergie.', en: 'The Wind Turbine is in the tree (T), on the Energy path.' },
        target: { k: 'unlock', ids: ['wind_flower'] },
        done: { k: 'unlocked', ids: ['wind_flower'] },
      },
      {
        hint: { fr: 'Le vent porte sur les crêtes de la Couronne, là où rien ne l’abrite : la flèche en montre une bien exposée.', en: 'The wind blows on the Crown’s crests, where nothing shelters it: the arrow shows a well-exposed one.' },
        target: { k: 'build', def: 'wind_flower', at: { windy: true } },
        done: { k: 'build', defs: ['wind_flower'], n: 1 },
      },
      {
        hint: { fr: 'Relie-la au réseau de poteau en poteau : ils se posent aussi sur la roche.', en: 'Wire it into the grid pole by pole: they stand on rock too.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: ['wind_flower'], n: 1 },
      },
      {
        hint: { fr: 'Une deuxième éolienne, ailleurs sur la Couronne.', en: 'A second turbine, elsewhere on the Crown.' },
        target: { k: 'build', def: 'wind_flower', at: { windy: true } },
        done: { k: 'build', defs: ['wind_flower'], n: 2 },
        unless: NIGHT_HOLDS,
      },
      {
        hint: { fr: 'Relie-la elle aussi.', en: 'Wire it in too.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: ['wind_flower'], n: 2 },
        unless: NIGHT_HOLDS,
      },
      // The wind is weak where they stand, or the base draws a lot: more turbines until it holds.
      ...[3, 4].flatMap((n) => [
        {
          hint: { fr: 'La nuit ne tient pas encore\u00a0: une éolienne de plus, bien exposée.', en: 'The night does not hold yet: one more turbine, well exposed.' },
          target: { k: 'build', def: 'wind_flower', at: { windy: true } },
          done: { k: 'build', defs: ['wind_flower'], n },
          unless: NIGHT_HOLDS,
        } as const,
        {
          hint: { fr: 'Relie-la au réseau.', en: 'Wire it into the grid.' },
          target: { k: 'link' },
          done: { k: 'linked', defs: ['wind_flower'], n },
          unless: NIGHT_HOLDS,
        } as const,
      ]),
    ],
  },

  // ── 4 ── goal: glass (a second smelter, sand off the floor, the coal shared) ──
  glassworks: {
    name: { fr: 'La verrerie', en: 'The Glassworks' },
    reveals: ['view:logistics', 'plan:sand_collector', 'plan:router', 'plan:junction'],
    desc: {
      fr: 'Le verre se vend bien, et la recherche en réclame. Le sable, c’est le sol même du désert : un collecteur le ramasse n’importe où. Une seconde fonderie le coule en verre, pourvu qu’elle ait aussi son charbon.',
      en: 'Glass sells well, and research calls for it. Sand is the desert floor itself: a collector scoops it anywhere. A second smelter casts it into glass, provided it has its coal too.',
    },
    objectives: [
      { k: 'produce', items: ['glass'], n: 10, ever: true },
      { k: 'feeds', item: 'glass', to: ['hearth'], n: 1, label: { fr: 'Du verre jusqu’au Cœur', en: 'Glass to the Core' } },
    ],
    reward: { items: [['iron_plate', 20], ['glass', 20]] },
    hints: [
      {
        hint: { fr: 'Le Collecteur de sable est dans l’arbre, voie Production.', en: 'The Sand Collector is in the tree, on the Production path.' },
        target: { k: 'unlock', ids: ['sand_collector'] },
        done: { k: 'unlocked', ids: ['sand_collector'] },
      },
      {
        hint: { fr: 'Une seconde fonderie, près de la première.', en: 'A second smelter, near the first.' },
        target: { k: 'build', def: 'kiln', at: { entity: 'kiln' } },
        done: { k: 'build', defs: KILNS, n: 2 },
      },
      {
        hint: { fr: 'Clique-la : recette Verre.', en: 'Click it: the Glass recipe.' },
        target: { k: 'recipe', defs: KILNS, recipe: 'glass' },
        done: { k: 'recipe', defs: KILNS, recipe: 'glass', n: 1 },
      },
      {
        hint: { fr: 'Un collecteur de sable juste à côté, sur le sable nu : trois sables font un verre.', en: 'A sand collector right beside it, on bare sand: three sand make one glass.' },
        target: { k: 'build', def: 'sand_collector', at: { newest: 'kiln' } },
        done: { k: 'build', defs: ['sand_collector'], n: 1 },
      },
      {
        hint: { fr: 'Le collecteur veut de l’énergie : relie-le au réseau.', en: 'The collector needs power: wire it into the grid.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['sand_collector'], n: 1 },
      },
      {
        hint: { fr: 'Un ruban du collecteur jusqu’à une entrée de la fonderie à verre.', en: 'A ribbon from the collector to an input of the glass smelter.' },
        target: { k: 'build', def: 'ribbon', at: { newest: 'kiln' } },
        done: { k: 'feeds', item: 'sand', to: KILNS, n: 1 },
      },
      // Its coal from a drill of its own (D146): a router sharing the plate smelter's coal line halved
      // both smelters (one coal drill, ~13 a minute, for two that take 10 each: 6.5 plates a minute)
      // just before the tutorial's plate-hungry quests; the deposit takes four drills or more. The
      // router comes with « La Criée », on the glass line (a router on the coal line still meets this).
      {
        hint: GLASS_COAL,
        target: { k: 'build', def: 'drill', at: { deposit: 'coal' } },
        done: { k: 'build', defs: DRILLS, item: 'coal', n: 2 },
        unless: { k: 'feeds', item: 'coal', to: KILNS, n: 2 },
      },
      {
        hint: GLASS_COAL,
        target: { k: 'build', def: 'ribbon', at: { newest: 'kiln' } },
        done: { k: 'feeds', item: 'coal', to: KILNS, n: 2 },
      },
      {
        hint: { fr: 'Le verre au Cœur : un ruban de sa sortie jusqu’à une entrée du Cœur.', en: 'The glass to the Core: a ribbon from its output to an input of the Core.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'feeds', item: 'glass', to: ['hearth'], n: 1 },
      },
    ],
  },

  // ── 5 ── goal: steam (D114: water's first use, from Tier 1) ──────────────────
  // Owner, 2026-10-17: « Il faudrait que l'eau serve assez tôt dans le jeu, dès le Tier 1 ». The
  // cirque's coal is short (D97: a drill pair a smelter); a boiler turns it into steady power, 700 kW
  // for 8 coal a minute (D143: the one coal-fired plant since the coal generator left the game), day
  // and night, with water from a pump by conduit. Where the water is, the guide's arrow shows (`water`: the nearest pump spot from the Core, on any
  // level: map 4's spring pool at the floor's edge, D115; the tarn up on the Crown on maps 2–3); a
  // conduit's water pours down the terraces one at a time (D114: never up), so a boiler may stand
  // below the water it drinks.
  steam_power: {
    name: { fr: 'La vapeur', en: 'Steam Power' },
    reveals: ['plan:steam'],
    desc: {
      fr: 'Le vent faiblit parfois, et votre base grandit. Une chaudière à vapeur tire de votre charbon une électricité sûre, de jour comme de nuit : 700 kW pour 8 charbon par minute, pourvu qu’on lui donne de l’eau. Une pompe au bord de l’eau, un conduit jusqu’à la chaudière — l’eau y descend les gradins, mais ne les monte jamais —, son charbon par ruban, et le tout relié au réseau.',
      en: 'The wind drops at times, and your base is growing. A steam boiler turns your coal into steady power, by day and by night: 700 kW for 8 coal a minute, as long as it has water. A pump at the water’s edge, a conduit to the boiler — water comes down the terraces in it, but never climbs them —, its coal by ribbon, and all of it wired into the grid.',
    },
    objectives: [
      { k: 'feeds', item: 'water', to: ['steam_boiler'], n: 1, label: { fr: 'L’eau jusqu’à la chaudière', en: 'Water to the boiler' } },
      { k: 'feeds', item: 'coal', to: ['steam_boiler'], n: 1, label: { fr: 'Le charbon jusqu’à la chaudière', en: 'Coal to the boiler' } },
      { k: 'linked', defs: ['steam_boiler'], n: 1, label: { fr: 'La chaudière au réseau', en: 'The boiler on the grid' } },
    ],
    reward: { items: [['iron_plate', 30], ['glass', 10]] },
    hints: [
      {
        // After the turbine's plan (D143: it hung from the coal generator's until that went): the arrow takes the first not taken.
        hint: { fr: 'Le plan Vapeur est dans l’arbre (T), voie Énergie, après l’Éolienne : la chaudière, la pompe et le conduit.', en: 'The Steam Power plan is in the tree (T), on the Energy path, after the Wind Turbine: the boiler, the pump and the conduit.' },
        target: { k: 'unlock', ids: ['wind_flower', 'steam'] },
        done: { k: 'unlocked', ids: ['steam'] },
      },
      {
        hint: { fr: 'Une pompe au bord de l’eau, à son niveau : la flèche montre l’eau la plus proche du Cœur.', en: 'A pump at the water’s edge, on its level: the arrow shows the water nearest the Core.' },
        target: { k: 'build', def: 'pump', at: { water: true } },
        done: { k: 'build', defs: ['pump'], n: 1 },
      },
      {
        hint: { fr: 'La chaudière près de l’eau, à son niveau ou plus bas (onglet Énergie) : dans un conduit, l’eau descend les gradins un à un, mais ne monte jamais.', en: 'The boiler near the water, on its level or lower (Energy tab): in a conduit, water comes down the terraces one by one, but never climbs.' },
        target: { k: 'build', def: 'steam_boiler', at: { newest: 'pump' } },
        done: { k: 'build', defs: ['steam_boiler'], n: 1 },
      },
      {
        hint: { fr: 'Un conduit de la pompe à une entrée de la chaudière : il se trace en glissant, comme un ruban, et descend les gradins.', en: 'A conduit from the pump to an input of the boiler: lay it by dragging, like a ribbon, down the terraces.' },
        target: { k: 'build', def: 'conduit', at: { newest: 'pump' } },
        done: { k: 'feeds', item: 'water', to: ['steam_boiler'], n: 1 },
      },
      {
        hint: { fr: 'Son charbon : une foreuse de plus sur le gisement, son ruban jusqu’à l’autre entrée.', en: 'Its coal: one more drill on the deposit, its ribbon to the other input.' },
        target: { k: 'build', def: 'drill', at: { deposit: 'coal' } },
        done: { k: 'feeds', item: 'coal', to: ['steam_boiler'], n: 1 },
      },
      {
        hint: { fr: 'Relie la chaudière au réseau.', en: 'Wire the boiler into the grid.' },
        target: { k: 'link' },
        done: { k: 'linked', defs: ['steam_boiler'], n: 1 },
      },
      {
        hint: { fr: 'La pompe aussi : sans courant, elle ne pompe rien.', en: 'The pump too: without power, it pumps nothing.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['pump'], n: 1 },
      },
    ],
  },

  // ── 6 ── goal: the Crier both ways — glass sold, copper bought and used ───────
  // It folds in three quests of the first tutorial (« La Criée appelle », « Le filon fatigué »,
  // « Premier achat »): the owner, 2026-10-16: « on dit au joueur de placer une commande de cuivre
  // sur le marché, mais jamais de s'en servir. Je n'avais même pas relié mon tradepost ». The
  // starter contract (BAL.starter: fixed price, capped, off the market; at its cap it stops and asks,
  // ui/contract-notice.ts) lands in the post's container and leaves only by its exit: the quest is
  // met when the bought ore reaches a wire mill.
  crier_trade: {
    name: { fr: 'La Criée', en: 'The Crier' },
    reveals: ['credits', 'crier', 'plan:telemetry', 'plan:trade_post', 'plan:wire_mill', 'stock:copper_ore'],
    desc: {
      fr: 'La Criée vous est ouverte. Port-Écume manque de verre et paie bien : un comptoir vend chaque minute ce que son entrée lui apporte, nous prenons un cinquième. Et le filon de cuivre du cirque est maigre : pour votre tréfileuse, nous vous offrons un contrat de départ, du minerai à prix fixe. Vos achats ne sortent que par la sortie du comptoir.',
      en: 'The Crier is open to you. Port-Écume is short of glass and pays well: a trade post sells, every minute, whatever its entrance brings, and we take a fifth. And the cirque’s copper vein is thin: for your wire mill, we offer you a starter contract, ore at a fixed price. Your purchases leave only by the post’s exit.',
    },
    objectives: [
      { k: 'export', items: ['glass'], n: 5, ever: true, label: { fr: 'Verre vendu', en: 'Glass sold' } },
      { k: 'import', items: ['copper_ore'], n: 10, ever: true, label: { fr: 'Minerai de cuivre acheté, livré', en: 'Copper ore bought, delivered' } },
      { k: 'feeds', item: 'copper_ore', to: ['wire_mill'], from: ['trade_post'], n: 1, label: { fr: 'Le minerai de cuivre acheté, jusqu’à la tréfileuse', en: 'The bought copper ore, to the wire mill' } },
    ],
    // 40 copper wire (D90: what the plans, the Core's level 2, the lab and the face cutter's poles
    // take beyond what the young wire mill makes). The Core's level 2 is no longer this reward: it is
    // the next quest, the player's own click (D101).
    reward: { credits: 150, items: [['copper_wire', 40]] },
    info: 'delivery',
    hints: [
      {
        hint: { fr: 'Le Comptoir est dans l’arbre, voie Commerce ; il demande d’abord la Télémétrie.', en: 'The Trade Post is in the tree, on the Commerce path; it asks for Telemetry first.' },
        target: { k: 'unlock', ids: ['telemetry', 'trade_post'] },
        done: { k: 'unlocked', ids: ['trade_post'] },
      },
      {
        hint: { fr: 'Pose un comptoir près de la fonderie à verre (onglet Commerce) : rien ne se construit dans l’anneau que brûlent ses drones.', en: 'Place a trade post near the glass smelter (Commerce tab): nothing is built in the ring its drones scorch.' },
        target: { k: 'build', def: 'trade_post', at: { newest: 'kiln' } },
        done: { k: 'post' },
      },
      {
        hint: { fr: 'Relie le comptoir au réseau.', en: 'Wire the post into the grid.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['trade_post'], n: 1 },
      },
      {
        // D146: « La verrerie » feeds its coal by a drill of its own; the router is learnt here.
        hint: { fr: 'Le Routeur est dans l’arbre, voie Logistique : il partage une ligne entre deux chemins.', en: 'The Router is in the tree, on the Logistics path: it shares a line between two ways.' },
        target: { k: 'unlock', ids: ['router'] },
        done: { k: 'unlocked', ids: ['router'] },
      },
      {
        hint: { fr: 'Du verre à son entrée (sa rampe turquoise) : un routeur sur la ligne du verre, un ruban jusqu’à elle.', en: 'Glass to its entrance (its teal ramp): a router on the glass line, a ribbon to it.' },
        target: { k: 'branch', item: 'glass', to: ['trade_post'] },
        done: { k: 'feeds', item: 'glass', to: ['trade_post'], n: 1 },
      },
      {
        hint: { fr: 'La Tréfileuse est dans l’arbre, voie Production.', en: 'The Wire Mill is in the tree, on the Production path.' },
        target: { k: 'unlock', ids: ['wire_mill'] },
        done: { k: 'unlocked', ids: ['wire_mill'] },
      },
      {
        hint: { fr: 'Une tréfileuse près de la sortie du comptoir.', en: 'A wire mill near the post’s exit.' },
        target: { k: 'build', def: 'wire_mill', at: { entity: 'trade_post' } },
        done: { k: 'build', defs: ['wire_mill'], n: 1 },
      },
      {
        hint: { fr: 'Relie la tréfileuse au réseau.', en: 'Wire the wire mill into the grid.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['wire_mill'], n: 1 },
      },
      // The vein's own drill: thin, but it lasts once the contract is spent (the tutorial's plans and
      // poles still want copper wire after it: D90).
      {
        hint: VEIN_DRILL,
        target: { k: 'build', def: 'drill', at: { deposit: 'copper_ore' } },
        done: { k: 'build', defs: DRILLS, item: 'copper_ore', n: 1 },
      },
      {
        hint: VEIN_DRILL,
        target: { k: 'build', def: 'ribbon', at: { entity: 'wire_mill' } },
        done: { k: 'feeds', item: 'copper_ore', to: ['wire_mill'], from: DRILLS, n: 1 },
      },
      {
        hint: { fr: 'Criée (M), onglet Échanges : signe le contrat de départ.', en: 'Crier (M), Trade tab: sign the starter contract.' },
        target: { k: 'crier', tab: 'trade', focus: 'starter' },
        done: { k: 'starter' },
      },
      {
        hint: { fr: 'Un ruban de la sortie du comptoir (sa rampe corail) jusqu’à la tréfileuse, ou dans le ruban qui y mène : tant qu’elle ne mène nulle part, rien n’est acheté.', en: 'A ribbon from the post’s exit (its coral ramp) to the wire mill, or into the ribbon that leads there: until it leads somewhere, nothing is bought.' },
        target: { k: 'build', def: 'ribbon', at: { entity: 'wire_mill' } },
        done: { k: 'feeds', item: 'copper_ore', to: ['wire_mill'], from: ['trade_post'], n: 1 },
      },
      {
        hint: { fr: 'Et le fil au Cœur : un ruban de la tréfileuse jusqu’à une entrée du Cœur.', en: 'And the wire to the Core: a ribbon from the wire mill to an input of the Core.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: ['wire_mill'], n: 1 },
      },
    ],
  },

  // ── 7 ── goal: the slag (D125, D139) ─────────────────────────────────────────
  // Owner, 2026-10-18: « il faudrait que certaines machines produisent des déchets en alternance avec
  // leur vraie production, qu'il faille traiter », then « don't make smelters and early game machines
  // create slag or scraps. that's for later, but the tutorial should still show how to sort them with
  // the sorter » (D139). No machine of the tutorial leaves any: the slag comes with CrierBelt's starter
  // contract (« La Criée »: a slag with every five ore, `BAL.starter.waste`), out by the post's exit
  // with the ore, and the wire mill refuses it — its line stops at the mill's door. CrierBelt says
  // what it is, that the Core takes none either, and how it is dealt with: a sorter set to the ore on
  // that line (laid over its last tile, it takes the slag waiting there, D139), an incinerator on its
  // side — or the slag led into the post's entrance and sold.
  slag: {
    name: { fr: 'Les scories', en: 'The Slag' },
    reveals: ['plan:sorter', 'plan:incinerator', 'stock:slag'],
    desc: {
      fr: 'Le minerai de notre contrat sort d’une fonderie de l’Anneau : il arrive avec ses scories, une pour cinq minerais, par la sortie du comptoir. Votre tréfileuse les refuse, et toute sa ligne se bouche derrière la première. Le Cœur n’en prend pas non plus. Plus tard, l’aciérie et la presse en laisseront aussi. Triez-les : un trieur réglé sur le minerai le laisse filer tout droit et pousse le reste sur ses côtés, un incinérateur brûle ce qui y tombe. Ou menez-les à l’entrée du comptoir, qui les vend pour presque rien.',
      en: 'The ore of our contract comes out of a foundry of the Ring: it arrives with its slag, one for five ore, by the post’s exit. Your wire mill refuses it, and its whole line jams behind the first. The Core takes none either. Later on, the steel mill and the press will leave some too. Sort it: a sorter set to the ore lets it run straight on and pushes the rest out of its sides, an incinerator burns whatever falls in. Or lead it to the post’s entrance, which sells it for next to nothing.',
    },
    objectives: [
      { k: 'feeds', item: 'slag', to: ['incinerator'], n: 1, label: { fr: 'Les scories triées vers un incinérateur', en: 'The slag sorted to an incinerator' } },
      { k: 'export', items: ['slag'], n: 5, ever: true, label: { fr: 'Ou des scories vendues', en: 'Or slag sold' } },
    ],
    any: true,
    reward: { items: [['iron_plate', 30], ['copper_wire', 10]] },
    hints: [
      {
        hint: { fr: 'Le Trieur et l’Incinérateur sont dans l’arbre, voie Logistique.', en: 'The Sorter and the Incinerator are in the tree, on the Logistics path.' },
        target: { k: 'unlock', ids: ['sorter', 'incinerator'] },
        done: { k: 'unlocked', ids: ['sorter', 'incinerator'] },
      },
      {
        // Laid over the line's last tile, it takes the slag that waits there (D139: compile.ts keeps a
        // ribbon tile's item in the routing block laid on it).
        hint: { fr: 'La scorie attend devant la tréfileuse : pose un trieur sur ce dernier ruban, clique-le et choisis le minerai de cuivre.', en: 'The slag waits at the wire mill’s input: place a sorter on that last ribbon tile, click it and pick the copper ore.' },
        target: { k: 'build', def: 'sorter', at: { refused: true } },
        done: { k: 'build', defs: ['sorter', 'inverted_sorter'], n: 1 },
      },
      {
        hint: { fr: 'Un incinérateur contre un côté libre du trieur : les scories y tombent, le minerai file à la tréfileuse.', en: 'An incinerator against a free side of the sorter: the slag falls in, the ore runs on to the wire mill.' },
        target: { k: 'build', def: 'incinerator', at: { newest: 'sorter' } },
        done: { k: 'feeds', item: 'slag', to: ['incinerator'], n: 1 },
      },
    ],
  },

  // ── 8 ── goal: the Core's level 2 (D101) ──────────────────────────────────────
  // Owner, 2026-10-16: « there should be a quest in the tutorial where you upgrade it ». A player
  // action paid in what the base makes by now (BAL.hearthUpgrades[0]: plates, glass, copper wire),
  // one click on the Core's card (the logged `hearthUp`). The level grows the Core's power (its core
  // and its panel, BAL.hearthCoreKw/hearthSolarKw) and mounts its compute bay (D122: D86's data
  // outlet's corner), whose tokens run the first lab in « Le laboratoire ».
  core_upgrade: {
    name: { fr: 'Le Cœur grandit', en: 'The Core Grows' },
    desc: {
      fr: 'Votre Cœur peut monter d’un niveau : un noyau plus fort, un panneau plus grand, un entrepôt plus vaste, et une baie de calcul sur son coin sud-est, dont les tokens d’IA feront tourner vos recherches. Il se paie en plaques, en verre et en fil de cuivre, ce que votre base fait déjà. Réunissez-les au Cœur, puis montez-le.',
      en: 'Your Core can go up a level: a stronger core, a larger panel, a bigger store, and a compute bay on its south-east corner, whose AI tokens will run your research. It is paid in plates, glass and copper wire, what your base already makes. Gather them in the Core, then raise it.',
    },
    objectives: [CORE_2],
    reward: { credits: 100 },
    hints: [
      // What is short, the slowest first (one marker at a time; gone once the Core is raised).
      {
        hint: { fr: 'Il manque du fil de cuivre au Cœur : la tréfileuse en fait, le contrat de départ la nourrit, le filon aussi.', en: 'The Core is short of copper wire: the wire mill makes it, fed by the starter contract and by the vein.' },
        target: { k: 'hearth' },
        done: { k: 'stock', items: ['copper_wire'], n: 40 },
        unless: CORE_2,
      },
      {
        hint: { fr: 'Il manque du verre au Cœur : la fonderie à verre l’y porte.', en: 'The Core is short of glass: the glass smelter brings it there.' },
        target: { k: 'hearth' },
        done: { k: 'stock', items: ['glass'], n: 40 },
        unless: CORE_2,
      },
      {
        hint: { fr: 'Il manque des plaques au Cœur : une deuxième fonderie de fer double le débit.', en: 'The Core is short of plates: a second iron smelter doubles the rate.' },
        target: { k: 'hearth' },
        done: { k: 'stock', items: ['iron_plate'], n: 120 },
        unless: CORE_2,
      },
      {
        hint: { fr: 'Clique le Cœur : au pied de sa fiche, monte-le au niveau 2.', en: 'Click the Core: at the foot of its card, raise it to level 2.' },
        target: { k: 'hearth' },
        done: CORE_2,
      },
    ],
  },

  // ── 9 ── goal: every plan, then the lab on the Core's compute (D71, D101, D122) ──
  // The research lab is the gate between the plans and research (owner, 2026-10-14). The plans are
  // a goal at the player's own pace (D101: a calm count, no arrow down the tree). The first lab runs
  // on the Core's compute (D122: its tokens from level 2, no ribbon — it ran on the Core's Survey Data
  // before, by a ribbon from its outlet): the lab placed, powered, Mechanics launched — its resources
  // paid from the Core, its tokens in within minutes. The id stays `field_journal` (« Données
  // d'arpentage » until D122): saves hold it.
  field_journal: {
    name: { fr: 'Le laboratoire', en: 'The Research Lab' },
    reveals: ['plans', 'brush'],
    desc: {
      fr: 'Quand tous les plans sont pris, le laboratoire de recherche s’ouvre. Il ne prend rien par ruban : une recherche se paie au Cœur quand vous la lancez, quelques ressources, puis avance au rythme des tokens d’IA qu’elle reçoit — ceux de la baie de calcul du Cœur, ou un flux acheté à CrierBelt. Prenez les plans à votre rythme, posez le laboratoire, reliez-le au réseau et lancez la Mécanique.',
      en: 'Once every plan is taken, the research lab opens. It takes nothing by ribbon: a research is paid from the Core when you launch it, a few resources, then moves at the pace of the AI tokens it receives — the Core’s compute bay’s, or a flow bought from CrierBelt. Take the plans at your own pace, place the lab, wire it into the grid and launch Mechanics.',
    },
    objectives: [
      { k: 'unlocked', ids: PLAN_IDS, label: { fr: 'Plans pris', en: 'Plans taken' } },
      { k: 'powered', defs: ['observatory'], n: 1, label: { fr: 'Le laboratoire sous tension', en: 'The lab powered' } },
      { k: 'research', id: 'tr1' },
    ],
    // 600 (D90; 300 at D87, 100 before): the next objective buys the quartz vein's parcel, 450–575 ◉,
    // and the purse is never below zero here (imports wait): it can always pay.
    reward: { credits: 600 },
    hints: [
      {
        hint: { fr: 'Un plan prêt à prendre : le journal compte ceux qui restent.', en: 'A plan ready to take: the log counts those left.' },
        target: { k: 'unlock', ids: PATH_PLANS },
        done: { k: 'unlocked', ids: PATH_PLANS },
      },
      {
        hint: { fr: 'Tous les plans sont pris : le Laboratoire de recherche, au bout des plans.', en: 'Every plan is taken: the Research Lab, at the end of the plans.' },
        target: { k: 'unlock', ids: ['observatory'] },
        done: { k: 'unlocked', ids: ['observatory'] },
      },
      {
        hint: { fr: 'Le laboratoire près du Cœur (onglet Recherche) : aucun ruban ne le nourrit.', en: 'The lab near the Core (Research tab): no ribbon feeds it.' },
        target: { k: 'build', def: 'observatory', at: NEAR_HEART },
        done: { k: 'build', defs: ['observatory'], n: 1 },
      },
      {
        hint: { fr: 'Relie le laboratoire au réseau.', en: 'Wire the lab into the grid.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['observatory'], n: 1 },
      },
      {
        hint: { fr: 'Dans l’arbre (T), lance la Mécanique : ses plaques et son fil se paient au Cœur, et le calcul du Cœur lui donne ses tokens en quelques minutes.', en: 'In the tree (T), launch Mechanics: its plates and wire are paid from the Core, and the Core’s compute gives it its tokens within minutes.' },
        target: { k: 'research', id: 'tr1' },
        done: { k: 'research', id: 'tr1' },
      },
    ],
  },

  // ── 10 ── goal: quartz in the wall, past the Crown (D87) ──────────────────────
  // The resource the cirque lacks, a parcel away: the land's first purchase, a face cutter at the
  // foot of the nearest mountain's wall, its quartz carried home over the Crown on traction ribbons.
  // It is the tutorial's way past the Crown (D101: « Au-delà de la Couronne » folded in, its
  // register title « Passe-Crête » with it). The Face Cutter is a plan of the Survey path, taken with
  // the others (D101; owner, 2026-10-16: « le face cutter devrait être beaucoup plus rapide à
  // obtenir »): no research wait. A land founded before the vein buys its quartz instead.
  wall_quartz: {
    name: { fr: 'Le quartz de la paroi', en: 'Quartz in the Wall' },
    reveals: ['view:land'],
    desc: {
      fr: 'Le cirque n’a pas de quartz. La montagne la plus proche en a, serti dans sa paroi, à une parcelle de vos terres, au-delà de la Couronne. Achetez cette parcelle, posez-y une haveuse au pied de la paroi, et ramenez le quartz au Cœur par-dessus la Couronne : des rubans à traction montent les objets de gradin en gradin. Et la nuit revient bientôt : vos machines tirent déjà plus que le Cœur et la chaudière ne donnent dans le noir, six éoliennes au réseau la tiendront.',
      en: 'The cirque has no quartz. The nearest mountain does, set in its face, one parcel from your land, beyond the Crown. Buy that parcel, set a face cutter at the foot of the wall, and bring the quartz back to the Core over the Crown: traction ribbons lift items from terrace to terrace. And the night comes back soon: your machines already draw more than the Core and the boiler give in the dark, six turbines on the grid will hold it.',
    },
    objectives: [
      { k: 'vein', label: { fr: 'La parcelle de la veine', en: 'The vein’s parcel' } },
      { k: 'stock', items: ['quartz'], n: 10, label: { fr: 'Quartz au Cœur', en: 'Quartz in the Core' } },
      WIND_SIX,
    ],
    reward: { kit: 'quartz_workshop', grant: 'arpentage' },
    hints: [
      {
        land: 'vein',
        hint: { fr: 'Terrain (I) : achète la parcelle de la veine de quartz, juste au-delà de la Couronne.', en: 'Land (I): buy the parcel of the quartz vein, just beyond the Crown.' },
        target: { k: 'land', at: { vein: true } },
        done: { k: 'vein' },
      },
      {
        land: 'vein',
        hint: { fr: 'Une haveuse au pied de la paroi, dos à la roche : elle se tourne d’elle-même.', en: 'A face cutter at the foot of the wall, its back to the rock: it turns by itself.' },
        target: { k: 'build', def: 'face_cutter', at: { vein: true } },
        done: { k: 'build', defs: ['face_cutter'], n: 1 },
      },
      {
        land: 'vein',
        hint: { fr: 'Relie-la au réseau : des poteaux passent la Couronne, gradin par gradin.', en: 'Wire it into the grid: poles cross the Crown, terrace by terrace.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['face_cutter'], n: 1 },
      },
      {
        land: 'vein',
        hint: { fr: 'Un ruban de la haveuse jusqu’à une entrée du Cœur : sur la Couronne, il se fait ruban à traction.', en: 'A ribbon from the face cutter to an input of the Core: on the Crown, it turns into traction ribbon.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'delivers', defs: ['face_cutter'], n: 1 },
      },
      {
        land: 'novein',
        hint: { fr: 'Ta terre n’a pas de veine de quartz : Criée (M), onglet Échanges, un ordre d’import de quartz, que la sortie du comptoir mène au Cœur.', en: 'Your land has no quartz vein: Crier (M), Trade tab, an import order of quartz, which the post’s exit leads into the Core.' },
        target: { k: 'crier', tab: 'trade', focus: 'order' },
        done: { k: 'order', item: 'quartz' },
      },
      // D146: the turbines (« Tenir la nuit »'s hints, up to six): on the Crown's windiest spots, wired.
      {
        hint: { fr: 'La nuit qui vient : des éoliennes sur la Couronne, bien exposées, jusqu’à six.', en: 'The coming night: turbines on the Crown, well exposed, up to six.' },
        target: { k: 'build', def: 'wind_flower', at: { windy: true } },
        done: { k: 'build', defs: ['wind_flower', 'pitch_turbine'], n: 6 },
      },
      {
        hint: { fr: 'Relie-les au réseau, de poteau en poteau.', en: 'Wire them into the grid, pole by pole.' },
        target: { k: 'link' },
        done: WIND_SIX,
      },
    ],
  },

  // ── 11 ── goal: two of the parts the Core's level 3 is paid in (D90, after D93) ─
  // From the tutorial into the end of Tier 1 (playtest 2026-10-16: once the quartz came, nothing named
  // the next goal). Level 3 is paid in gears, motors and quartz oscillators (and, since D123, in the
  // bricks, steel and copper plates of Tier 1's new works — named in the text, not asked here); the
  // gears and the motors wait for Mechanics' press (started in « Le laboratoire », it is learnt in its
  // own time), so the tutorial ends on the two lines it can build at once (D101: no wait but building
  // time) — the quartz workshop's after its own node, a few minutes on the Core's compute (D128), and
  // the assembly bench's coils, of which the motors are wound (D129: the electronics workshop and its
  // circuits went to Tier 2; this step built it until then).
  synth_parts: {
    name: { fr: 'Les pièces de la Synthèse', en: 'Parts for the Synthesis' },
    desc: {
      fr: 'Le Tier 1 se referme sur la Synthèse : elle demande l’Atelier (la presse, l’atelier de quartz, la tréfileuse double), l’aciérie et le calcul du Cœur, puis le niveau 3 du Cœur se paie en engrenages, moteurs et oscillateurs à quartz, et dans les nouveaux matériaux du Tier 1 : briques, acier, plaques de cuivre. Ce niveau porte l’Archive des expertises ; deux expertises ouvrent le Tier 2, où chaque catégorie attend celles du Tier 1 sur lesquelles elle bâtit. Lancez l’Atelier de quartz, puis montez les lignes des oscillateurs et des bobines de cuivre, jusqu’au Cœur : l’établi de montage fera des moteurs des bobines.',
      en: 'Tier 1 closes on the Synthesis: it asks for the Workshop (the press, the quartz workshop, the twin wire mill), the steel mill and the Core’s compute, then the Core’s level 3 is paid in gears, motors and quartz oscillators, and in Tier 1’s new materials: bricks, steel, copper plates. That level mounts the Expertise Archive; two expertises open Tier 2, where each category waits for those of Tier 1 it builds on. Launch the Quartz Workshop, then set up the oscillator and copper coil lines, into the Core: the assembly bench will make motors of the coils.',
    },
    objectives: [
      { k: 'feeds', item: 'oscillator', to: ['hearth'], n: 1, label: { fr: 'Oscillateurs jusqu’au Cœur', en: 'Oscillators to the Core' } },
      { k: 'feeds', item: 'copper_coil', to: ['hearth'], n: 1, label: { fr: 'Bobines jusqu’au Cœur', en: 'Coils to the Core' } },
    ],
    // Ocelles for what comes next: the next parcels, the Crier's orders.
    reward: { credits: 300 },
    hints: [
      {
        // Its own research node since D128 (`dn_quartzshop`): two thousand tokens, the Core's compute's two minutes.
        hint: { fr: 'Dans l’arbre (T), lance l’Atelier de quartz : le calcul du Cœur l’apprend en quelques minutes.', en: 'In the tree (T), launch the Quartz Workshop: the Core’s compute learns it within minutes.' },
        target: { k: 'unlock', ids: ['dn_quartzshop'] },
        done: { k: 'unlocked', ids: ['dn_quartzshop'] },
      },
      {
        hint: { fr: 'L’atelier de quartz près du Cœur : ses matériaux t’ont été livrés.', en: 'The quartz workshop near the Core: its materials were delivered to you.' },
        target: { k: 'build', def: 'quartz_workshop', at: NEAR_HEART },
        done: { k: 'build', defs: ['quartz_workshop'], n: 1 },
      },
      {
        hint: { fr: 'Un établi de montage à côté : il bobine le fil de cuivre sur des plaques de fer.', en: 'An assembly bench beside it: it winds copper wire on iron plates.' },
        target: { k: 'build', def: 'assembly_bench', at: { entity: 'quartz_workshop' } },
        done: { k: 'build', defs: ['assembly_bench'], n: 1 },
      },
      {
        // Once Mechanics is learnt the bench has two recipes and waits for a choice (D83); before, it starts on its coils.
        hint: { fr: 'Clique-le et choisis la recette Bobine de cuivre.', en: 'Click it and pick the Copper Coil recipe.' },
        target: { k: 'recipe', defs: ['assembly_bench'], recipe: 'copper_coil' },
        done: { k: 'recipe', defs: ['assembly_bench'], recipe: 'copper_coil', n: 1 },
      },
      {
        hint: { fr: 'Relie l’atelier et l’établi au réseau.', en: 'Wire the workshop and the bench into the grid.' },
        target: { k: 'link' },
        done: { k: 'powered', defs: ['quartz_workshop', 'assembly_bench'], n: 2 },
      },
      {
        hint: { fr: 'Du quartz pour l’atelier de quartz : un routeur sur ta ligne de quartz, un ruban jusqu’à une de ses entrées.', en: 'Quartz for the quartz workshop: a router on your quartz line, a ribbon to one of its inputs.' },
        target: { k: 'branch', item: 'quartz', to: ['quartz_workshop'] },
        done: { k: 'feeds', item: 'quartz', to: ['quartz_workshop'], n: 1 },
      },
      {
        hint: { fr: 'Et du fil de cuivre : un routeur sur la ligne de la tréfileuse, un ruban jusqu’à son autre entrée.', en: 'And copper wire: a router on the wire mill’s line, a ribbon to its other input.' },
        target: { k: 'branch', item: 'copper_wire', to: ['quartz_workshop'] },
        done: { k: 'feeds', item: 'copper_wire', to: ['quartz_workshop'], n: 1 },
      },
      {
        hint: { fr: 'Du fil de cuivre pour l’établi aussi : un ruban depuis le routeur de la ligne de fil.', en: 'Copper wire for the bench too: a ribbon from the wire line’s router.' },
        target: { k: 'branch', item: 'copper_wire', to: ['assembly_bench'] },
        done: { k: 'feeds', item: 'copper_wire', to: ['assembly_bench'], n: 1 },
      },
      {
        hint: { fr: 'Et des plaques de fer : un routeur sur la ligne des plaques, un ruban jusqu’à son autre entrée.', en: 'And iron plates: a router on the plates’ line, a ribbon to its other input.' },
        target: { k: 'branch', item: 'iron_plate', to: ['assembly_bench'] },
        done: { k: 'feeds', item: 'iron_plate', to: ['assembly_bench'], n: 1 },
      },
      {
        hint: { fr: 'Les oscillateurs au Cœur : un ruban de l’atelier de quartz jusqu’à une entrée du Cœur, ou dans un ruban qui y mène.', en: 'The oscillators to the Core: a ribbon from the quartz workshop to an input of the Core, or into a ribbon that leads there.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'feeds', item: 'oscillator', to: ['hearth'], n: 1 },
      },
      {
        hint: { fr: 'Les bobines aussi : un ruban de l’établi jusqu’au Cœur.', en: 'The coils too: a ribbon from the bench to the Core.' },
        target: { k: 'build', def: 'ribbon', at: INTAKE },
        done: { k: 'feeds', item: 'copper_coil', to: ['hearth'], n: 1 },
      },
    ],
  },
} as const satisfies Record<string, QuestDef>;

export type QuestId = keyof typeof QUESTS;
/** Quests in the order they run (their index: 0 the claim's name, then the quests 1–10). */
export const QUEST_IDS = Object.keys(QUESTS) as QuestId[];

/**
 * The first tutorial's quest ids (before D101) and where each went, for the saves (systems/quests.ts
 * `loadQuests`): a today's quest that folds old ones in counts as done once all of them were done.
 * The ids not listed and gone (« Le Ruban », « Au-delà de la Couronne ») are only dropped: what they
 * asked is part of the quests around them now (a second drill, the way past the Crown).
 */
export const QUEST_FOLDS: Readonly<Record<string, QuestId>> = {
  crier_calls: 'crier_trade',
  tired_vein: 'crier_trade',
  first_purchase: 'crier_trade',
};

/**
 * Quests a later table added, with that table (D101): in a save from an older table, one counts as
 * done once a quest after it in run order was done (the player was past it; systems/quests.ts
 * `foldDone`). « Le Cœur grandit » came with table 3: before, « La Criée » paid level 2's materials.
 * « La vapeur » came with table 4 (D114): a player past it plays on, one still at « La Criée » meets it first.
 */
export const QUEST_ADDED: Readonly<Partial<Record<QuestId, number>>> = { core_upgrade: 3, steam_power: 4, slag: 5 };

/** Titles a quest can grant: a mention of the base in the Crier's register (shown with its name). */
export const QUEST_TITLES: Readonly<Record<string, Loc>> = {
  taille: { fr: 'Perce-Couronne', en: 'Crown Breaker' },
  arpentage: { fr: 'Passe-Crête', en: 'Ridge Runner' },
};

/** A quest by id (undefined for an unknown id). */
export const questDef = (id: string): QuestDef | undefined => (QUESTS as Record<string, QuestDef>)[id];

/** Is it a goal (D101: hints on request) rather than a guided quest (an arrow along its steps)? */
export const isGoal = (q: QuestDef): boolean => !q.steps;

/** A quest's steps or its hints, whichever it has (the guide reads both alike). */
export const guideSteps = (q: QuestDef): readonly QuestStep[] => q.steps ?? q.hints ?? [];

// ── the optional objectives (D101) ──────────────────────────────────────────

/**
 * What the player can discover alone (the analytics, the land, the views): ticks in the quest log,
 * no reward, no arrow — the log lists those met and those to find, from quest `from` on.
 */
export interface SideGoal {
  readonly name: Loc;
  /** Met when this holds (read like a quest's objectives, from the founding). */
  readonly objective?: QuestObjective;
  /** Or: the map views opened at least once (the UI's own record: views are not the sim's). */
  readonly views?: readonly string[];
  /** Shown from this quest on. */
  readonly from: QuestId;
  /** Its icon: a glyph's (ui/glyphs.ts), a building's, or an item's. */
  readonly icon: { readonly glyph: string } | { readonly building: string } | { readonly item: string };
}

export const SIDE_GOALS: Readonly<Record<string, SideGoal>> = {
  views: { name: { fr: 'Les vues : Production, Électricité, Logistique', en: 'The views: Production, Power, Logistics' }, views: ['production', 'power', 'logistics'], from: 'glassworks', icon: { glyph: 'building' } },
  telemetry: { name: { fr: 'Télémétrie : les débits dans le Stock', en: 'Telemetry: the rates in the Stock' }, objective: { k: 'unlocked', ids: ['telemetry'] }, from: 'crier_trade', icon: { item: 'iron_ore' } },
  parcel: { name: { fr: 'Une parcelle de plus (Terrain, I)', en: 'One more parcel (Land, I)' }, objective: { k: 'land', n: 1 }, from: 'crier_trade', icon: { glyph: 'parcel' } },
  ledger: { name: { fr: 'Le registre de production (G)', en: 'The production ledger (G)' }, objective: { k: 'unlocked', ids: ['statistics'] }, from: 'field_journal', icon: { item: 'iron_plate' } },
  wind: { name: { fr: 'Anémométrie : où porte le vent (V)', en: 'Wind Survey: where the wind blows (V)' }, objective: { k: 'unlocked', ids: ['anemometry'] }, from: 'field_journal', icon: { building: 'wind_flower' } },
};

// ── validation (run by content/validate.ts) ─────────────────────────────────

const has = (table: object, id: string): boolean => Object.prototype.hasOwnProperty.call(table, id);
const CATEGORIES: readonly BuildCategory[] = ['extraction', 'logistics', 'distribution', 'production', 'research', 'energy', 'colony', 'commerce'];
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
  if (o.k === 'night' && !(Number.isInteger(o.pct) && o.pct > 0 && o.pct <= 100)) out.push(`${where}: pct must be 1–100`);
  if (o.k === 'hearth' && !(Number.isInteger(o.level) && o.level >= 2 && o.level <= BAL.hearthUpgrades.length + 1)) out.push(`${where}: no Core level ${o.level}`);
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
    if (o.from) { defs(o.from); if (!o.from.length) out.push(`${where}: an empty from`); }
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
  // step or hint and `unlocked` objective, in run order. A step must never point at a building, a
  // recipe or a routing block the player cannot have yet: the tutorial unlocks before it uses.
  const have = new Set<string>(['start']);
  // What the tree offers so far (D101): a plan a quest asks for must have been revealed by then.
  const offered = new Set<string>();
  let allPlans = false;
  const usable = (where: string, unlock: string, what: string): void => {
    if (!have.has(unlock)) out.push(`${where}: ${what} is used before it is unlocked (${unlock})`);
  };
  const shown = (where: string, ids: readonly string[]): void => {
    for (const n of ids) if (isPlan(n) && !allPlans && !offered.has(n)) out.push(`${where}: plan ${n} is asked for before the tree offers it`);
  };
  for (const [id, q] of Object.entries(QUESTS) as Array<[string, QuestDef]>) {
    for (const r of q.reveals ?? []) {
      if (r === 'plans') allPlans = true;
      else if (r.startsWith('plan:')) { const p = r.slice(5); if (!isPlan(p)) out.push(`quest ${id}: reveals unknown plan ${p}`); offered.add(p); }
    }
    if (!q.objectives.length) out.push(`quest ${id}: no objective`);
    if (q.objectives.length > 4) out.push(`quest ${id}: more than four objectives (D101: one to three, a goal's measures)`);
    if (q.any && q.objectives.length < 2) out.push(`quest ${id}: 'any' needs two objectives or more`);
    q.objectives.forEach((o, i) => {
      objectiveProblems(`quest ${id} objective ${i}`, o, out);
      if (o.k === 'unlocked' && o.ids !== PLAN_IDS) shown(`quest ${id} objective ${i}`, o.ids);
    });
    const r = q.reward;
    for (const [it, n] of r.items ?? []) {
      if (!has(ITEMS, it)) out.push(`quest ${id}: unknown reward item ${it}`);
      else if ((ITEMS as Record<string, { kind: string }>)[it]!.kind === 'waste') out.push(`quest ${id}: reward ${it} is waste: the Core takes none in (D139)`);
      if (!(n > 0)) out.push(`quest ${id}: reward ${it} must be positive`);
    }
    if (r.kit !== undefined && !has(BUILDINGS, r.kit)) out.push(`quest ${id}: unknown kit ${r.kit}`);
    if (r.hearthLevel !== undefined && !BAL.hearthUpgrades[r.hearthLevel - 2]) out.push(`quest ${id}: no Hearth level ${r.hearthLevel}`);
    if (r.title && !q.objectives.every((o) => o.title !== undefined)) out.push(`quest ${id}: a title reward needs a title on every objective`);
    if (r.grant !== undefined && !has(QUEST_TITLES, r.grant)) out.push(`quest ${id}: unknown title ${r.grant}`);
    // Guided or a goal, never both (D101); a guided quest's last step is its closing line (D98: the
    // guide falls back to it once every step holds — a last step with a `done` was asked again).
    if (!!q.steps === !!q.hints) out.push(`quest ${id}: steps (guided) or hints (a goal), one of the two`);
    const list = guideSteps(q);
    if (!list.length) out.push(`quest ${id}: no step or hint for the guide`);
    const last = q.steps?.[q.steps.length - 1];
    if (last && (last.done || last.land || last.unless)) out.push(`quest ${id}: its last step must be a closing line, with no \`done\` nor \`land\``);
    for (const s of q.hints ?? []) if (!s.done) out.push(`quest ${id}: a hint without \`done\` would never go`);
    list.forEach((s, i) => {
      const where = `quest ${id} ${q.steps ? 'step' : 'hint'} ${i}`;
      const t = s.target;
      if (t.k === 'unlock') {
        if (!t.ids.length) out.push(`${where}: no tree node`);
        for (const n of t.ids) { if (!isTreeNode(n)) out.push(`${where}: unknown tree node ${n}`); have.add(n); }
        shown(where, t.ids);
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
      if (t.k === 'hearth') {
        // The level it raises the Core to (its `done`, else the quest's Core objective): unlocked by then.
        const goal = s.done?.k === 'hearth' ? s.done : q.objectives.find((o): o is Extract<QuestObjective, { k: 'hearth' }> => o.k === 'hearth');
        const up = goal ? BAL.hearthUpgrades[goal.level - 2] : undefined;
        if (!goal || !up) out.push(`${where}: a Core target in a quest with no Core level to reach`);
        else usable(where, up.unlock, `Core level ${goal.level}`);
      }
      if (t.k === 'crier' && t.n !== undefined && !(Number.isInteger(t.n) && t.n > 0)) out.push(`${where}: an order's rate must be a positive integer`);
      if (t.k === 'land' && !('vein' in t.at) && !('entity' in t.at)) out.push(`${where}: a land target names the vein or a building`);
      if (s.unless) objectiveProblems(`${where} unless`, s.unless, out);
      if (s.done) {
        objectiveProblems(`${where} done`, s.done, out);
        if (s.done.k === 'unlocked') for (const n of s.done.ids) have.add(n);
      }
    });
    for (const o of q.objectives) if (o.k === 'unlocked') for (const n of o.ids) have.add(n);
  }
  for (const [old, now] of Object.entries(QUEST_FOLDS)) {
    if (has(QUESTS, old)) out.push(`fold ${old}: still a quest`);
    if (!has(QUESTS, now)) out.push(`fold ${old}: unknown quest ${now}`);
  }
  for (const [id, table] of Object.entries(QUEST_ADDED)) {
    if (!has(QUESTS, id)) out.push(`added ${id}: unknown quest`);
    if (!(table !== undefined && table >= 2 && table <= QUEST_TABLE)) out.push(`added ${id}: table ${table} is not 2–${QUEST_TABLE}`);
  }
  for (const [id, g] of Object.entries(SIDE_GOALS)) {
    if (!has(QUESTS, g.from)) out.push(`side goal ${id}: unknown quest ${g.from}`);
    if (!!g.objective === !!g.views) out.push(`side goal ${id}: an objective or views, one of the two`);
    if (g.objective) objectiveProblems(`side goal ${id}`, g.objective, out);
    const ic = g.icon;
    if ('glyph' in ic && !ic.glyph) out.push(`side goal ${id}: no glyph`);
    if ('building' in ic && !has(BUILDINGS, ic.building)) out.push(`side goal ${id}: unknown building ${ic.building}`);
    if ('item' in ic && !has(ITEMS, ic.item)) out.push(`side goal ${id}: unknown item ${ic.item}`);
  }
  return out;
}
