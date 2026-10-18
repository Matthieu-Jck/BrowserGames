// types.ts — content definition shapes. Content is plain typed data keyed by string id;
// registry.ts compiles ids to dense indices for the engine. Names are inline {fr, en}.

export interface Loc { readonly fr: string; readonly en: string }

export type Tier = 1 | 2 | 3 | 4;
export type Side = 'N' | 'E' | 'S' | 'W';

export type ItemKind =
  | 'ore' | 'fuel' | 'fluid' | 'material' | 'part' | 'unique' | 'energy' | 'rubble';

/** Glyph shapes the art pipeline knows how to ink (render/art/recipes/items.ts). */
export type Glyph =
  | 'pebble' | 'grain' | 'coal' | 'copper' | 'crystal' | 'rubble' | 'drop' | 'salt' | 'plate' | 'pane'
  | 'coil' | 'gear' | 'servo' | 'arm' | 'chip' | 'tile' | 'cell' | 'cellCharged' | 'shard'
  | 'resin' | 'ember' | 'lens' | 'canvas' | 'core' | 'moss' | 'nacre' | 'quartz' | 'resonator'
  | 'lattice' | 'oscillator'
  // D123: steel's bar, the brick, the pipe, the cable (copper plate is a plate, in copper).
  | 'ingot' | 'brick' | 'pipe' | 'cable';

export interface ItemDef {
  readonly name: Loc;
  readonly tier: Tier;
  readonly kind: ItemKind;
  /** Reference value V in ocelles (the market anchors on it). Computed for crafted items. */
  readonly value?: number;
  /** NPC market depth Q (items/min); 0 = not tradable. */
  readonly depth: number;
  readonly glyph: Glyph;
  /** Fill colour token for the glyph. */
  readonly color: string;
  /**
   * An ore set in a cliff face (D87: quartz): its deposit lies on the rock tiles of a wall, and only
   * a face cutter (`drill.face`) works it, from the floor beside the wall. A drill does not see it,
   * and an excavator leaves its tiles standing.
   */
  readonly face?: boolean;
}

export interface RecipeDef {
  readonly name: Loc;
  /** Building ids that can run it. */
  readonly machines: readonly string[];
  /** Cycle in seconds at speed 1 (cycle ticks must divide 1200). */
  readonly seconds: number;
  readonly ins: ReadonlyArray<readonly [string, number]>;
  readonly outs: ReadonlyArray<readonly [string, number]>;
  /** Extra electrical energy per craft (kW·min), e.g. the cell charger. */
  readonly energyKwMin?: number;
  /** Research id that unlocks it, or 'start'. */
  readonly unlock: string;
}

export interface PortDef {
  /** Tile within the unrotated footprint. */
  readonly x: number;
  readonly y: number;
  /** Edge of that tile the port opens on (unrotated; rot 0 = front faces N). */
  readonly side: Side;
  readonly io: 'in' | 'out';
}

export type BuildingKind =
  | 'hearth' | 'drill' | 'belt' | 'fork' | 'crossing' | 'bridge' | 'pole'
  | 'machine' | 'lab' | 'generator' | 'wind' | 'solar' | 'geothermal' | 'storage' | 'trade'
  | 'excavator' | 'pump' | 'conduit' | 'accumulator' | 'backfiller' | 'sink'
  // Mints AI tokens from power (D68): research uses them as they come, the oldest project first.
  | 'server'
  // A fence (D103): no node, no power; it stands in the Gleaners' way (sim/world/reach.ts).
  | 'fence';

export type BuildCategory = 'extraction' | 'logistics' | 'distribution' | 'production' | 'research' | 'energy' | 'colony' | 'commerce';

/**
 * How a routing block (kind `fork`) hands items on. `router`: every side, round-robin, to
 * ribbons, machines and stores alike. Directional ones (placed with a rotation: in from the
 * back): `sorter` (the chosen item straight on, others to the sides), `inverted` (the chosen
 * item to the sides, others straight on), `overflow` (straight on, the sides when it is full),
 * `underflow` (the sides, straight on when they are full). The unloader, which pulled the chosen
 * item out of an adjacent store, is retired (D117): a silo's outputs empty it by themselves.
 */
export type RouterLogic = 'router' | 'distributor' | 'sorter' | 'inverted' | 'overflow' | 'underflow';

/**
 * Replacement, the Mindustry way: a building may be placed over buildings of its own group
 * that lie wholly inside its footprint; they are taken down (fully refunded) first. A router
 * over a ribbon, a swift ribbon over a ribbon, a distributor over four routers, a pylon
 * over a pole, a deep bore over a drill. `transport`: ribbons of every tier, routing
 * blocks, the junction and the bridge; `fluid`: conduits; `power`: masts; `drill`: drills.
 * No group: never replaces, never replaced (machines, stores, the Hearth…).
 */
export type ReplaceGroup = 'transport' | 'fluid' | 'power' | 'drill' | 'wind';

/**
 * A wind turbine's curve (D95), in ‰ of the reference wind (the local wind: the weather's × the
 * place's exposure): nothing below `cutIn`; from there its share of its rating grows as the wind's
 * cube up to `rated`, then holds; at `cutOut` and above it stops (a storm), without one it holds on.
 */
export interface WindCurve { readonly cutIn: number; readonly rated: number; readonly cutOut?: number }

export interface BuildingDef {
  readonly name: Loc;
  readonly kind: BuildingKind;
  /** Overrides the kind's height class (D124): true = a skybridge may pass over it. Absent: its kind's (`FLAT_KINDS`), tall by default. */
  readonly flat?: boolean;
  readonly category: BuildCategory;
  readonly w: number;
  readonly h: number;
  readonly ports: readonly PortDef[];
  /** Electrical draw while working / idle (kW). */
  readonly kw?: number;
  readonly idleKw?: number;
  /** Production buildings stand on the claim's land (its parcels, D60); infrastructure may cross other land. */
  readonly needsZone: boolean;
  /**
   * May stand on the mountains (D44): its whole footprint on rock, or its whole footprint on the
   * floor, as any building (on the claim's land when it `needsZone`, D60).
   */
  readonly onRock?: boolean;
  readonly cost: ReadonlyArray<readonly [string, number]>;
  readonly unlock: string;
  /** Recipes this machine can run (machines only). */
  readonly crafts?: boolean;
  /**
   * Belt-like: `perMin`, its pace — a ribbon moves its items one tile a step, perMin steps a minute
   * (D57: one item per tile, so also its throughput); `ticksPerTile`, a conduit's water travel time
   * (ribbons ignore it).
   */
  readonly belt?: { readonly ticksPerTile: number; readonly perMin: number };
  /** A traction ribbon (D45): it hands on to the tile ahead one level up or down — the only way a line changes level. */
  readonly lift?: boolean;
  /** A glazed ribbon (D103): the glass over it keeps the Gleaners' hands off what it carries. */
  readonly glazed?: boolean;
  /**
   * A camouflaged ribbon (D109): buried under the sand. It may be laid on a neighbouring base's open land
   * (D110; a sister claim's before) as on free land, off the claim's land at its own cost (`BAL.camoRemoteCostMult`, not the ×3), and the
   * Gleaners walk over it without seeing it. Flat: it never climbs a step.
   */
  readonly camo?: boolean;
  /**
   * A power link point (D25: the pillars and the Hearth): `range` = how far its wires reach
   * (tiles, footprint edge to edge), `slots` = how many wires it holds. `tall`: the Reinforced Pylons
   * research (`mods.pylonLink`) lengthens its wires. `climb` (levels, D78): how far its wires may
   * climb or come down, and how high above the land they ride — a wire takes its taller end's, its
   * two ends at most that many levels apart, no tile between them higher than that above the line
   * joining their grounds (power/links.ts). Nothing is powered by proximity: a building joins a
   * grid only through wires.
   */
  readonly pole?: { readonly range: number; readonly slots: number; readonly climb: number; readonly tall?: boolean };
  /**
   * Generator output (kW) and fuel burn at full output (items/min). A solar plant gives
   * nothing at night (owner, 2026-10-14: « la nuit les panneaux sont à 0 »). A wind turbine's
   * `kw` is its rating, reached on its curve (`wind`, D95). A steam boiler (D114) also drinks
   * `water` items/min at full output, like its fuel in proportion to what the grid asks: without
   * both in its boxes it gives nothing.
   */
  readonly gen?: { readonly kw: number; readonly fuel?: string; readonly fuelPerMin?: number; readonly water?: number; readonly wind?: WindCurve };
  /**
   * An extractor (kind `drill`): `perMin` at most. A drill mines the deposit under it (bounded by its
   * tiles' caps); with `ground`, it collects that item off the bare ground instead — every tile of
   * its footprint plain sand, no deposit — at a steady `perMin` (the sand collector: sand is the
   * desert floor itself, owner 2026-10-12). With `face` (the face cutter, D87), it stands
   * on the floor beside a wall and works the face ore (`ItemDef.face`) of the rock tiles its back
   * touches, each at its tile's cap. A pump's `perMin` is its water a minute.
   */
  readonly drill?: { readonly perMin: number; readonly capMult?: number; readonly ground?: string; readonly face?: boolean };
  /** A machine's crafting speed, ‰ of the recipe's own (the upgraded machines of the tree, D70). */
  readonly speed?: number;
  /**
   * AI tokens a minute at full power (D68): a server's (kind `server`), or a lab that computes its
   * own (the autonomous lab, D122) — either way into the claim's pool, the oldest project first.
   */
  readonly server?: { readonly tokensPerMin: number };
  /** An excavator's reach (tiles from its footprint) and digging speed (‰). */
  readonly excavator?: { readonly reach: number; readonly speed: number };
  readonly storageCap?: number;
  /**
   * The fog it lifts for good when placed (D117), in tiles from its footprint's centre. Omitted: every
   * building lifts `BAL.buildReveal` plus half its longer side — but a line piece (the `transport` and
   * `fluid` groups: ribbons, routing blocks, junctions, bridges, conduits) lifts none (`revealOf`, sim/space.ts).
   */
  readonly reveal?: number;
  readonly accumulator?: { readonly kwMin: number; readonly kw: number };
  /** Routing blocks (kind `fork`): how they hand items on. */
  readonly logic?: RouterLogic;
  /** What it may be placed over, and what may be placed over it (same group only). */
  readonly replaceGroup?: ReplaceGroup;
  /**
   * What it is for and how to hook it up, in one or two plain sentences (shown as is: the
   * building card, the inspector, and the first sentence alone in the build tip). The card
   * derives its figures from the other fields; quote here only the numbers that matter.
   */
  readonly desc: Loc;
}

/** The research families (D69): each a lineage named anew at every tier, most splitting in two at Tier 3. */
export type FamilyId = 'en' | 'ex' | 'dn' | 'cm' | 'an' | 'xp';
export type ResearchTier = 1 | 2 | 3 | 4;

export interface ResearchDef {
  readonly name: Loc;
  readonly desc: Loc;
  /** Its family, or the trunk (the Foundations that open each tier). */
  readonly branch: 'trunk' | FamilyId;
  /** Its speciality within the family from Tier 3 on (a key of the family's `specs`); none before the split. */
  readonly spec?: string;
  /** Its tier (D69): the column it stands in, and the Core's level it waits for (D118). */
  readonly tier: ResearchTier;
  /** Depth: the cost band (`DEPTH_COST`; 9 = a keystone ★); trunk nodes use their order. */
  readonly depth: number;
  /** Tree nodes it needs: research ids, or a plan id (the family roots need the lab's plan). */
  readonly prereq: readonly string[];
  /**
   * The resources it asks for (D122): paid from the Core's stock when it is launched, as a plan is,
   * whole items — what it unlocks hints at them (an electric smelter's node asks for wire and plates).
   */
  readonly cost: ReadonlyArray<readonly [string, number]>;
  /** AI tokens it needs (D68, D122: at every tier), delivered as a flow — the Core's compute, the claim's servers, one bought from CrierBelt. */
  readonly tokens: number;
  /** The pace its tier runs at (minutes, D118: no minimum time): what the launch dialog aims its default token flow at. */
  readonly minutes: number;
  readonly effects: readonly Effect[];
}

/**
 * The path a plan belongs to in the unlock tree (D33, D41): one theme each, drawn as its own
 * labelled band — logistics (move and sort), production (smelt and make), energy, analytics
 * (what the base shows you), trade. The survey path went with the survey beacon (D117). Order and
 * checks: `PLAN_PATHS` in research.ts.
 */
/** A plan path, or `gate`: the research lab's plan, between all the plans and research (D71). */
export type PlanLane = 'logistics' | 'production' | 'energy' | 'analytics' | 'trade' | 'gate';

/**
 * A plan (D33): an instant unlock of the one tree, paid with materials from the Heart the
 * moment it is taken, Mindustry-style — no observatory, no data, no time. What it unlocks is
 * read from content (the buildings and recipes whose `unlock` is its id) plus its own
 * `effects` (a feature such as telemetry). Research nodes are the tree's advanced part.
 */
export interface PlanDef {
  /** Shown name. Omitted: the name of the (first) building it unlocks. */
  readonly name?: Loc;
  /** What it brings, in a sentence. Omitted: the description of the building it unlocks. */
  readonly desc?: Loc;
  /** Its path (the tree's band it is drawn in). */
  readonly lane: PlanLane;
  /** Tree nodes it needs first (plan ids, or research ids). */
  readonly prereq: readonly string[];
  /** Paid from the Heart's stock when it is unlocked (whole items). */
  readonly cost: ReadonlyArray<readonly [string, number]>;
  readonly effects?: readonly Effect[];
}

export type Effect =
  | { readonly k: 'unlock'; readonly id: string }
  | { readonly k: 'slots'; readonly add: number }
  | { readonly k: 'mul'; readonly target: ModTarget; readonly permille: number }
  | { readonly k: 'add'; readonly target: ModTarget; readonly v: number }
  | { readonly k: 'flag'; readonly flag: string };

export type ModTarget =
  | 'digSpeed' | 'rubbleYield' | 'embeddedOre' | 'windOut' | 'solarOut' | 'geoOut'
  | 'accCap' | 'accRate' | 'genOut' | 'craftSpeed' | 'tradeFee' | 'deliveryDelay' | 'slippage'
  | 'landPrice' | 'landRent' | 'landGrowth' | 'farLand' | 'remoteBeltCost' | 'remoteBuildDelay'
  | 'pylonLink' | 'ring3Caps'
  | 'bridgeSpan' | 'orders' | 'excavatedSpeed' | 'gustVariance'
  // Tokens a minute the Core's compute gives research on top of its level's (D122), whole tokens.
  | 'coreCompute'
  // The expertises' own (D93, ‰): the drills' and cutters' rate (and their deposit's cap); the
  // claim's own tokens (D122: the Core's compute, the servers, the autonomous labs).
  | 'drillRate' | 'tokenRate';
