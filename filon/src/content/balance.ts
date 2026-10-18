// balance.ts — every tuning constant in one object (replicatas' pattern): balancing is one
// diff. Engine-facing values are integers (milli-items, ticks, permille, centi-ocelles).

export const BAL = {
  // ── start ────────────────────────────────────────────────────────────────
  startStock: { iron_plate: 120, glass: 40, copper_wire: 60, coal: 50 } as Record<string, number>,
  startCredits: 300, // ◉

  // ── hearth & storage ─────────────────────────────────────────────────────
  hearthCap: [5000, 10000, 20000, 40000, 80000], // per item, by Hearth level 1..5 (level 5: D118)
  // The Hearth's power, by level 1..5 (D101, level 5 D118; owner, 2026-10-16: « the solar panels from the core
  // should do a less important part of its electricity production »): its isotope core gives the
  // most, day and night (× genOut) — about 70 % of what it gives at noon —, its built-in solar panel
  // the rest at full sun (× SOLAR‰ and the solar research, like a sun bulb; D25). Level 1: 210 + 90 kW,
  // two drills at night, three by day: the first night asks for a turbine (« Tenir la nuit »), it
  // never cuts the base dead. The world clock is shared, so a base may be founded at night.
  hearthSolarKw: [90, 130, 180, 240, 320],
  hearthCoreKw: [210, 300, 420, 560, 740],
  hearthPortPerMin: 120, // an outlet's pace: a trade post's exit (the Core's data outlet went with the data, D122)
  reservoirMargin: 20, // items: within this of a bound, offline treats the reservoir as at the bound

  // ── machines ─────────────────────────────────────────────────────────────
  inBufCrafts: 2, // input buffers hold this many crafts' worth
  outBufCrafts: 3,
  drillBufItems: 5,
  // Deposit richness off the cirque template (100 = 1 item/min per tile; mapgen's procedural
  // fields, hidden veins and unique sites — the cirque's own deposits are in content/world.ts).
  // quartz: a face tile of the vein (D87), what a face cutter cuts out of it: two tiles make its 15/min.
  depositRich: { iron_ore: 500, sand: 400, coal: 300, copper_ore: 500, salt: 300, quartz: 750 } as Record<string, number>,
  uniqueRich: 100,
  forkBufItems: 2,

  // ── belts ────────────────────────────────────────────────────────────────
  beltDensity: 1, // items per ribbon tile: one item per square; a full ribbon blocks (owner, 2026-10-11)
  conduitDensity: 4, // water per conduit tile (a fluid, not drawn as items)
  remoteBeltCostMult: 3,
  /** A camouflaged ribbon off the claim's land (D109): its cost × this, not `remoteBeltCostMult` (1: no surcharge; the kite's delay still applies). */
  camoRemoteCostMult: 1,
  runSpanTicks: 20, // parcels of the same item merge over at most 2 s

  // ── power ────────────────────────────────────────────────────────────────
  // The wind (D95, sim/world/wind.ts): the weather's wind over open flat ground at a time (‰ of
  // the reference wind) × a tile's exposure (‰), from the land as the world made it. A turbine's
  // curve (content/buildings.ts `gen.wind`) turns that local wind into its share of its rating.
  wind: {
    // ── the time: a day's curve × the day's mood × the gust window ──
    // ‰ at the start of each day epoch (epoch 0 = 20:00, 6 = midnight, 24 = noon): the Sough rises
    // at dusk and blows through the night over the tops, lulls in the late morning, picks up with
    // the afternoon's heat. It complements the sun (owner's night is dark for the panels).
    curve: [
      1060, 1120, 1170, 1210, 1240, 1260, 1270, 1270, 1260, 1240, 1210, 1170,
      1120, 1060, 990, 920, 860, 810, 780, 760, 760, 770, 790, 820,
      850, 880, 910, 940, 960, 980, 990, 1000, 1010, 1020, 1030, 1040,
    ] as readonly number[],
    moodLow: 650, // ‰: a world day runs from this calm…
    moodHigh: 1350, // …to this breezy (hash of WORLD_SEED and the day, blended from one day start to the next)
    step: 50, // ‰: the time's wind is rounded to this (few distinct weathers: the catch-up keeps one solve per weather)
    veer: 4, // bearing steps (of 64): a day's wind comes from the prevailing bearing, or this much either side of it
    veerSide: 200, // ‰ of the days on each side (the rest: the prevailing bearing)
    // ── the place: a tile's exposure ‰ (the land as generated: a dig does not move the wind) ──
    base: 820, // flat ground, an average fetch
    levelGain: 40, // per level above the floor: the air runs faster higher up
    relRadius: 6, // tiles: the box (2r+1)² whose mean level a tile stands above or below…
    relGain: 340, // …per level above it: tops, ridges, the Crown's crest windy…
    relGainLow: 120, // …and per level below it: a gully a little calmer (the lee and the bowl do the rest)
    fetch: 32, // tiles looked upwind (and round, for the basin)
    side: 6, // bearing steps: the two side rays of the upwind fan (≈ 34°)
    openGain: 380, // the share of the upwind fan clear of higher ground, full fetch: wide open ground
    shelterGain: 1800, // ‰ of shelter per level-per-tile of the steepest higher ground upwind (the lee)…
    shelterMax: 850, // …at most
    basinGain: 480, // ‰ off in a bowl: the share of eight bearings that meet higher ground within the fetch
    funnelReach: 8, // tiles: higher ground on both flanks this close…
    funnelClear: 16, // …and the way upwind clear this far: a pass, the wind funnelled through it…
    funnel: 300, // …‰ more
    min: 60,
    max: 2600,
  },

  // ── climate: the cirque desert's air (sim/world/climate.ts) ──────────────
  climate: {
    // deci-°C at the start of each day epoch, interpolated tick by tick. Epoch 0 = 20:00 (the
    // night falls), 6 = midnight, 12 = 04:00 (dawn: the coldest), 24 = noon, 27 = 14:00 (the
    // hottest), 33 = 18:00 (dusk). Fast cooling after sunset, slow through the night.
    curve: [
      196, 170, 147, 128, 111, 97, 85, 74, 65, 58, 51, 45,
      40, 43, 55, 76, 103, 133, 164, 194, 222, 248, 272, 294,
      314, 336, 355, 370, 368, 360, 347, 330, 309, 284, 256, 226,
    ] as readonly number[],
    dayVarPeak: 30, // deci-°C: a world day runs up to ±3 °C hotter / colder at its hottest hour…
    dayVarLow: 20,  // …and ±2 °C at its coldest (hash of WORLD_SEED and the day)
    solarRef: 250,  // deci-°C: above 25 °C solar panels lose solarLoss ‰ of output per °C
    solarLoss: 4,
    // Survival heaters (like a planetary rover's): below 15 °C the Heart's electronics (and the
    // accumulators' cells) draw heaterKwPerDeg kW per °C to stay above their cold limit.
    heaterBelow: 150,
    heaterKwPerDeg: 8,
  },

  // ── land & space (docs/land.md, D60) ─────────────────────────────────────
  // The fog (D117: no survey beacon; it lifts as the claim grows). Round the Core by its level 1..5:
  // at founding the cirque, its Crown (r 32; a Closed Cirque's 43) and the near belt's first deposits
  // (from r 36); each level a parcel's half farther.
  coreReveal: [44, 56, 68, 80, 92],
  landReveal: 32,  // fog lifted round a parcel the claim comes to hold (from its centre): the parcel (23 tiles, half-diagonal 16) and a margin round it
  buildReveal: 12, // round any building placed (plus half its longer side; `revealOf`): a pole line walks the fog back, two poles' reach ahead
  remoteBuildTilesPerSec: 4,
  land: {
    // Tiles a side; parcels are centred on the Heart (odd: its parcel exactly so). The starting
    // square, `startRings` rings round the Heart's parcel — 3×3 —, holds about exactly the cirque
    // (owner, 2026-10-15, D74: « le joueur ne devrait posséder que 9 parcelles… à peu près
    // exactement le cirque »): −34…+34 tiles, where map 2's Crown reaches 29–33 (36 at the tarn's peak).
    parcel: 23,
    startRings: 1,
    base: 20_000, // centi-ocelles: every parcel, before what it holds
    /**
     * Centi-ocelles per tile, by ground: what it gives to build on (rock to dig, water to pump or fill,
     * a vent to tap). Floor pays in full only where it is usable (D94, world/floor.ts: a 2 × 2 machine
     * fits on it at one level); a sliver of it pays as rock. A river gives water to pump from its bank
     * and nothing to stand on; a chasm nothing at all.
     */
    tile: { floor: 60, sliver: 25, rock: 25, water: 90, river: 20, chasm: 0, salt: 70, vent: 3_000, dunes: 15 } as Record<string, number>,
    /** Centi-ocelles per deposit tile, per point of the ore's value (items.ts), at a richness of 500 (5/min): scaled by the tile's own. */
    // 250 since D94 (was 400): on map 4 the ore lies in broken ground, and a parcel rich in it and
    // short of room costs a little more than an open one (≈ 540–620 ◉ against ≈ 515), not half again.
    depositPerValue: 250,
    /** A parcel's ore at a glance (D94: the Terrain view's and the land panel's pips): deposit tiles for one, two, three. */
    oreTiers: [1, 13, 40] as readonly number[],
    growth: 1100, // ‰ on the price per parcel already bought (Land Charter lowers it)
    rentPermille: 30, // of the price, an hour
    /**
     * The neighbouring bases (D110): parcels held by another claim of the Crier, a working base on
     * them, never for sale nor lease. None within `minRing` − 1 rings of the Heart's parcel: the two
     * rings round the starting square stay free, the first bases on the horizon (owner, 2026-10-17:
     * « Il y a trop de bases de PNJ autour de moi »). Map 4 groups them in holdings (`holdings`): the
     * parcel grid cut in `block` × `block` squares round the Heart's, `chance` ‰ of them holding one
     * base of `size` parcels side by side (inclusive), each parcel of it with at least `floor` ‰ of
     * its `samples` × `samples` sample points on open floor (a base stands there) and nothing the land
     * guarantees the claim (a site, the copper field, a vent, a corridor). Maps 1–3 keep a share of
     * the sister claims' scattered parcels (`scatter` ‰ past `minRing`, the same draw as before D110:
     * fewer, never others) where a base fits. Was 420 ‰ and 125 ‰ from ring 3 (D110's first cut).
     * A base has sand to collect when its floor holds `sand` places of 2 × 2 bare sand (a collector's);
     * its Core leaves its hub's middle when fewer than `pocket` tiles of floor join it there.
     */
    neighbours: { minRing: 4, scatter: 40, block: 3, chance: 120, size: [2, 3] as readonly number[], floor: 450, samples: 5, sand: 12, pocket: 400 },
    farRadius: 320, // tiles: land beyond is cheaper with Far Claims (xp8)
  },

  // ── research (D69) ───────────────────────────────────────────────────────
  // A node costs its table's price whatever else the claim owns: the spread penalty and the
  // lineage discount were removed (owner, 2026-10-15, D72).
  /**
   * The Core's level each tier needs (D118; owner, 2026-10-17: « il faut que le Tier 2 soit montré
   * comme bloqué tant que le core n'est pas niveau 3, etc. »), by tier 1..4: Tier 2 at level 3 (the
   * Archive, where the expertises open), Tier 3 at 4, Tier 4 at 5. Each level is the player's own
   * upgrade (`hearthUpgrades`), behind the trunk node that closes the tier before.
   */
  tierCoreLevel: [1, 3, 4, 5] as readonly number[],
  // ── AI tokens (D68, D118, D122): never owned, delivered to research as a flow ───
  // Every node needs a number of tokens (D122: research's one currency, with resources paid at
  // launch), delivered at each minute's end: the Core's compute and the claim's servers' output of
  // the minute (the oldest project first; what nobody needs is lost, or rented with Server Rental),
  // then each project's flow bought from CrierBelt at this price.
  tokenCentsPerK: 1000, // centi-ocelles per 1 000 tokens at CrierBelt: 10 ◉ the thousand
  /**
   * The flows the launch dialog offers (tokens a minute, D118): these mantissas at every power of
   * ten from `min` up — 500, 750, 1 000, 1 500, 2 000, 3 000, 5 000, 7 500, 10 000… — so the slider
   * moves in steps a player reads at a glance.
   */
  tokenFlow: { min: 500, steps: [100, 150, 200, 300, 500, 750] as readonly number[] },
  // The Compute Plan (cm_plan): CrierBelt's tokens at this share of the price, for a fee an hour.
  tokenPlan: { priceFactor: 500, feeCentsPerHour: 6000 },
  serverRental: 500, // ‰ of the price CrierBelt pays for the tokens a claim's servers leave unused (cm_rent)
  // Express freight (cm_express): ‰ of the delay, ‰ of the price.
  express: { delay: 500, price: 1250 },
  landResaleTax: 200, // ‰ of a parcel's market price the Ring's Cadastre keeps when it is sold back (D119)

  // ── market (see market/) ─────────────────────────────────────────────────
  tradeFee: 200, // ‰ CrierBelt takes on every trade: it holds the Ring's monopoly, and nothing lowers it (owner, 2026-10-14, D64)
  tradeThroughput: [120, 240, 480], // items/min
  liftDelayMin: [3, 2, 1], // minutes from a purchase to the lift-off, by trade-post level (D113: was 10, 6, 3)
  tradeOrders: 2,           // standing import orders (Standing Orders: +4)
  importHysteresis: 30,     // ‰: an order paused above its max resumes once the ask is 3 % below it
  // The starter contract (D101): CrierBelt's one-time offer for a new base's first purchase, off
  // the market (prices never see it). `cents`: the fixed price per item in centi-ocelles — 2 ◉,
  // no fee, half the ore's market value; `n` items in all, `perMin` a minute; each purchase lands
  // in the post's container `delayMin` game minutes later, and leaves only by its exit.
  // Fulfilled, it stops (D101: the owner's base bought on for hours, unseen): continued, it is an
  // ordinary order, capped at the ask × continueOver ‰. Its lots land a minute after each purchase:
  // the tutorial waits on no slow delivery.
  starter: { item: 'copper_ore', n: 40, perMin: 10, cents: 200, delayMin: 1, continueOver: 1100 },
  /**
   * The Crier Ring's NPC market (src/market, design §6). It computes in floats, being
   * authoritative where it runs; only its outputs reach the sim, as integers. Times are minutes
   * (= epochs), prices multiples r of the item's reference value V, depths items/min.
   */
  /** The claim's value (systems/value.ts, D50): sampled every `everyMin` world minutes, `points` kept (two weeks). */
  value: { everyMin: 60, points: 336 },
  market: {
    // NPC supply S = S0·e·r^supplyExp, demand D = D0·e′·r^−demandExp; the price stays in [rMin, rMax]·V.
    supplyExp: 0.8,
    demandExp: 0.6,
    rMin: 0.25,
    rMax: 4,
    bisectSteps: 24,  // equilibrium r* by bisection on ln r ∈ [ln rMin, ln rMax]
    blockMin: 5,      // equilibrium + smoothing every 5 epochs, on the player's average flows
    tauMin: { common: 360, unique: 720 }, // ln r eases toward ln r* (6 h / 12 h); spot shocks fade the same
    eventTauMin: 20,  // an event's impact reaches the price this fast (a 2 h shortage must show)
    spread: { common: 0.04, unique: 0.1 }, // bid = P·(1 − s/2), ask = P·(1 + s/2)
    // Stateless noise: smooth value noise on a Gaussian lattice, [spacing (min), gain] per
    // octave, normalised to σ; correlation falls to 1/e after ≈ 12 h (an OU-like wander).
    noiseSigma: { common: 0.06, unique: 0.12 },
    noiseOctaves: [[1200, 1], [600, 0.6], [300, 0.36], [90, 0.22]],
    // Spot trades: a stock L at once averages P·(K/L)·(1 − e^(−L/K)) with K = κ·Q (κ in minutes of
    // flow), and leaves a lasting factor max(shockFloor, 1 − L/2K) on the price.
    spotKappaMin: 30,
    shockFloor: 0.25,
    // The colonies (the other claims): delivery delay by distance band; T3/T4 markets ramp up over the colony's
    // first days (rampSupply: depth ramps and prices stay at V; false: demand alone ramps).
    // D113 (owner, 2026-10-17: a 10/min order's first ore 20 minutes away « it's way too long »):
    // was 15, 45, 120, 240. Near goods land within minutes; the far uniques still take an hour.
    delayMin: { near: 2, medium: 8, far: 25, veryFar: 60 },
    rampFrom: 0.2,
    rampDays: [0, 0, 0, 30, 45], // by tier (index = tier; 0 = no ramp)
    rampSupply: true,
    growthCapDays: 365, // each colony grows linearly (its profile's %/day) for at most this long
    // 0: an item's NPC supply and demand both grow at the mean rate of its traders (deeper, and
    // anchored at V); 1: each side at its own colonies' rate (atlases +24 % by day 30, circuits −13 %).
    growthSkew: 0,
    historyPoints: 24,  // sparklines: one mid price every historyEveryMin
    historyEveryMin: 60,
    tradeEmaMin: 60,    // smoothing of the player's trade per colony (freight arcs)
    // World events: one per 6 h window with probability eventChance ‰, from hash(WORLD_SEED,
    // window); the Gazette announces each one eventLeadMin before it starts.
    eventWindowMin: 360,
    eventChance: 350,
    eventLeadMin: [60, 180],
    eventTierWeights: [3, 3, 2, 1], // shortage, glut and boom targets by tier T1..T4
    events: {
      shortage: { weight: 35, side: 'demand', mult: 2, hours: [12, 36] },
      boom: { weight: 15, side: 'demand', mult: 1.5, hours: [48, 48] },
      glut: { weight: 25, side: 'supply', mult: 1.8, hours: [12, 36] },
      storm: { weight: 10, side: 'demand', mult: 2.5, hours: [24, 48] },
      caravan: { weight: 15, side: 'supply', mult: 2, hours: [12, 24] },
    },
    stormItem: 'charged_cell',
    // Every new colony's first trade: glass bulbs run short at Port-Écume (announced at founding).
    firstTrade: { item: 'glass', colony: 'port_ecume', mult: 2, afterMin: 20, durationMin: 120, leadMin: 20 },
    // "What pays" board: what a kW·min of a machine costs (◉, coal burnt as fuel).
    energyCost: 0.04,
    // "What pays" board: its raw tile caps (◉ per raw tile-minute) are the drills' own numbers,
    // BAL.depositRich / uniqueRich (content/world.ts `tileCapsPerMin`); the cirque's tired chime
    // vein (0.75) is the exception, not the rule.
  },

  // ── space: digging, landfill, hearth levels ──────────────────────────────
  digMinutes: [5, 10, 20, 40], // per tile, hardness H1..H4 (before research)
  digRubble: [10, 12, 15, 20],  // stone per tile
  digReach: 3,                  // tiles from an excavator's footprint: it stands almost against the rock (owner, 2026-10-13, D54; was 18 from its centre, D18)
  embedIron: 300,              // ‰ chance a dug tile hides 20 ochre ore
  embedIronItems: 20,
  embedCopper: 80,               // ‰ chance of 15 copper ore (150 ‰ in a closed cirque)
  embedCopperItems: 15,
  excavatorCap: 200,            // stone stored before the excavator pauses
  fillReach: 8,
  fillSeconds: 30,
  fillRubble: { shallow: 40, salt: 25, deep: 120 } as Record<string, number>,
  backfillerCap: 200,
  /**
   * Hearth upgrades (level 2, 3, 4, 5): the tree node that makes each possible and its materials —
   * the player's own upgrade (`hearthUp`), never a research's gift. Levels 3–5 open Tiers 2–4
   * (`tierCoreLevel`, D118), each behind the trunk node that closes the tier before.
   */
  hearthUpgrades: [
    // Level 2 is the player's to raise (D101: a tutorial quest, « Le Cœur grandit »), paid in what the
    // base makes by « La Criée »: it mounts the compute bay, whose tokens run the first lab (D122).
    { unlock: 'start', cost: [['iron_plate', 120], ['glass', 40], ['copper_wire', 40]] },
    // Level 3 closes Tier 1 (D93): the Synthesis, paid in Tier 1's own parts; it mounts the Archive of
    // the expertises. D123: its walls are Tier 1's new materials too — bricks, steel, copper plates
    // (gears 150 → 100), so the steel mill and the brickworks have the Core to build towards.
    { unlock: 'tr_synth', cost: [['gear', 100], ['circuit', 60], ['oscillator', 30], ['brick', 120], ['steel', 40], ['copper_plate', 30]] },
    // Level 4 closes Tier 2 (D118), in Tier 2's parts and, since D123, the steel, bricks, pipes and
    // cables a base of that size makes in bulk (circuits 200 → 150).
    { unlock: 'tr6', cost: [['circuit', 150], ['thermal_core', 20], ['steel', 150], ['brick', 300], ['pipe', 60], ['cable', 60]] },
    // Level 5 opens Tier 4 (D118): after Resonance (ex Codex Lore), paid in Tier 3's optics and the
    // first resonators (30 atlases until D122); it mounts the uplink (north-west).
    { unlock: 'tr8', cost: [['lens', 120], ['thermal_core', 60], ['resonator', 20]] },
  ] as ReadonlyArray<{ unlock: string; cost: ReadonlyArray<readonly [string, number]> }>,
  /**
   * The Core's compute (D122; owner, 2026-10-17: « la monnaie pour débloquer les recherches sera
   * uniquement les tokens »): AI tokens a minute it gives research, by level 1..5, with no power
   * and no ribbon — delivered at each minute's end with the servers' (systems/research.ts
   * `tokenEpoch`), lost when no project needs them. Level 2 mounts its compute bay on the south-east
   * corner (D86's data outlet's place): from there Tier 1 runs on it alone, a node in a few minutes
   * (`DEPTH_COST`); a bought flow or the servers go faster. Each level raises it; the Analytics
   * research adds to it (`coreCompute`, whole tokens), the Archiving expertise multiplies it.
   */
  coreCompute: [0, 1000, 1500, 2000, 3000] as readonly number[],

  // ── expertises (D93, content/expertises.ts) ──────────────────────────────
  expertise: {
    /** The Heart level that mounts the Archive (its south-west corner, D86): the window opens there. */
    level: 3,
    /** How many the claim holds at a time; that many chosen open Tier 2. */
    slots: 2,
    /** A réorientation's price (centi-◉): the first, then × `reorientGrowth` ‰ for each one before it. */
    reorientCents: 150_000,
    reorientGrowth: 2000,
    /** Minutes a réorientation leaves the slot without its expertise: the new one holds 24 h later. */
    gapMinutes: 1440,
    /** The share of its demand the Core's grid must serve at a minute's end for the minute to count (‰, the `grid` feat). */
    gridPermille: 950,
  },

  // ── the Gleaners (D103, D112; content/gleaners.ts: what they take) ───────
  // A small people of the open desert: at night they come in groups to the ribbons they reach and
  // take a few shiny things (sim/world/reach.ts, sim/flow/chain.ts). A ribbon chain's tiles beside open
  // desert floor are its exposed cells; once a `window` a group raids it: each takes up a post beside
  // one cell and takes the first thing to its taste that rides past, then they go.
  gleaners: {
    /**
     * Their raids repeat every `window` ticks on each exposed chain (D112): four minutes, three raids a
     * night. At most `PERIOD_MAX` (2 400): a night group's period folds it in (graph/groups.ts `rotNight`).
     */
    window: 2400,
    /** How long a raid's group may take (ticks): from the first of them taking up its post to the raid's end. */
    raid: 600,
    /** The posts open one after the other, this many ticks apart: they gather, then reach out one by one. */
    stagger: 70,
    /** The group: `min` to `max` of them, one more for every `per` exposed tiles past `min` (a shorter exposure, one a tile). Each takes one item a raid. */
    group: { min: 3, max: 5, per: 8 },
    /** A pocket of desert floor this small (tiles), closed by rock, water, buildings or fences, is out of their reach. */
    pocket: 1500,
    /** The sun (‰, `SOLAR`) at or under which they are out: the dark hours. */
    darkSun: 0,
  },
} as const;
