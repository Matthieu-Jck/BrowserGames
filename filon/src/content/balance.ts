// balance.ts — every tuning constant in one object (replicatas' pattern): balancing is one
// diff. Engine-facing values are integers (milli-items, ticks, permille, centi-ocelles).

export const BAL = {
  // ── start ────────────────────────────────────────────────────────────────
  startStock: { iron_plate: 120, glass: 40, copper_wire: 60, coal: 50 } as Record<string, number>,
  startCredits: 300, // ◉

  // ── hearth & storage ─────────────────────────────────────────────────────
  hearthCap: [5000, 10000, 20000, 40000], // per item, by Hearth level 1..4
  // The Hearth's built-in solar panel at full sun (× SOLAR‰ and the solar research, like a sun
  // bulb; D25): two drills and a wire mill by day — wind, coal generators and accumulators earn their place
  // from the first evening.
  hearthSolarKw: 240,
  // …and its isotope core (× genOut): a steady trickle day and night, enough for one drill.
  // The world clock is shared, so a base may be founded at night: it must never start dead.
  hearthCoreKw: 90,
  hearthPortPerMin: 120, // each unloader port
  reservoirMargin: 20, // items: within this of a bound, offline treats the reservoir as at the bound

  // ── machines ─────────────────────────────────────────────────────────────
  inBufCrafts: 2, // input buffers hold this many crafts' worth
  outBufCrafts: 3,
  drillBufItems: 5,
  // Deposit richness off the cirque template (100 = 1 item/min per tile; mapgen's procedural
  // fields, hidden veins and unique sites — the cirque's own deposits are in content/world.ts).
  depositRich: { iron_ore: 500, sand: 400, coal: 300, copper_ore: 500, salt: 300 } as Record<string, number>,
  uniqueRich: 100,
  forkBufItems: 2,

  // ── belts ────────────────────────────────────────────────────────────────
  beltDensity: 1, // items per ribbon tile: one item per square; a full ribbon blocks (owner, 2026-10-11)
  conduitDensity: 4, // water per conduit tile (a fluid, not drawn as items)
  remoteBeltCostMult: 3,
  runSpanTicks: 20, // parcels of the same item merge over at most 2 s

  // ── power ────────────────────────────────────────────────────────────────
  windCirque: 250, // ‰ local wind on the cirque's floor: sheltered, a poor spot for a turbine (owner, 2026-10-13)
  windHeight: [1400, 1600, 1800, 2000], // ‰ up on the land by its height: level 1, 2, 3, 4 and above (D44; by height, not hardness, since 2026-10-14)
  windPlain: 1000,
  windMesa: [1600, 2000],

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
  startReveal: 44, // tiles of land explored at founding: the cirque, its Crown (r 32; a Closed Cirque's 43) and the near belt's first deposits (from r 36)
  landReveal: 32,  // fog lifted round a parcel the claim comes to hold (from its centre)
  remoteBuildTilesPerSec: 4,
  land: {
    // Tiles a side; parcels are centred on the Heart (odd: its parcel exactly so). The starting
    // square, `startRings` rings round the Heart's parcel — 3×3 —, holds about exactly the cirque
    // (owner, 2026-10-15, D74: « le joueur ne devrait posséder que 9 parcelles… à peu près
    // exactement le cirque »): −34…+34 tiles, where map 2's Crown reaches 29–33 (36 at the tarn's peak).
    parcel: 23,
    startRings: 1,
    base: 20_000, // centi-ocelles: every parcel, before what it holds
    /** Centi-ocelles per tile, by ground: what it gives to build on (rock to dig, water to pump or fill, a vent to tap). */
    tile: { floor: 60, rock: 25, water: 90, salt: 70, vent: 3_000, dunes: 15 } as Record<string, number>,
    /** Centi-ocelles per deposit tile, per point of the ore's value (items.ts), at a richness of 500 (5/min): scaled by the tile's own. */
    depositPerValue: 400,
    growth: 1100, // ‰ on the price per parcel already bought (Land Charter lowers it)
    rentPermille: 30, // of the price, an hour
    sisterShare: 125, // ‰ of the parcels beyond the starting ring that a sister claim owns
    sisterMarkup: [1600, 1800, 2000, 2200, 2400] as readonly number[], // ‰ on the content price, by claim
    farRadius: 320, // tiles: land beyond is cheaper with Far Claims (xp8)
  },

  // ── research (D69) ───────────────────────────────────────────────────────
  // A node costs its table's price whatever else the claim owns: the spread penalty and the
  // lineage discount were removed (owner, 2026-10-15, D72).
  respecRefund: 500, // ‰ of the data (250 for a keystone)
  respecCooldownDays: 14,
  // ── AI tokens (D68): never owned, paid the minute they are used ───────────
  // Research uses tokens as it runs; each minute the claim's servers cover what they can (what
  // they make and nobody uses is lost), CrierBelt's servers the rest, at this price.
  tokenCentsPerK: 1000, // centi-ocelles per 1 000 tokens at CrierBelt: 10 ◉ the thousand
  // The Compute Plan (cm_plan): CrierBelt's tokens at this share of the price, for a fee an hour.
  tokenPlan: { priceFactor: 500, feeCentsPerHour: 6000 },
  serverRental: 500, // ‰ of the price CrierBelt pays for the tokens a claim's servers leave unused (cm_rent)
  // Express freight (cm_express): ‰ of the delay, ‰ of the price.
  express: { delay: 500, price: 1250 },
  landResale: 800, // ‰ of what a parcel cost, when sold back (xp_resell)

  // ── market (see market/) ─────────────────────────────────────────────────
  tradeFee: 200, // ‰ CrierBelt takes on every trade: it holds the Ring's monopoly, and nothing lowers it (owner, 2026-10-14, D64)
  tradeThroughput: [120, 240, 480], // items/min
  liftDelayMin: [10, 6, 3], // minutes from a purchase to the lift-off, by trade-post level
  tradeOrders: 2,           // standing import orders (Standing Orders: +4)
  importHysteresis: 30,     // ‰: an order paused above its max resumes once the ask is 3 % below it
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
    // Sister colonies: delivery delay by distance band; T3/T4 markets ramp up over the colony's
    // first days (rampSupply: depth ramps and prices stay at V; false: demand alone ramps).
    delayMin: { near: 15, medium: 45, far: 120, veryFar: 240 },
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
  /** Hearth upgrades (level 2, 3, 4): research gate and materials. */
  hearthUpgrades: [
    { unlock: 'tr1', cost: [['iron_plate', 200], ['gear', 50]] },
    { unlock: 'tr4', cost: [['gear', 300], ['ceramic', 100], ['circuit', 50]] },
    { unlock: 'tr6', cost: [['circuit', 200], ['thermal_core', 20]] },
  ] as ReadonlyArray<{ unlock: string; cost: ReadonlyArray<readonly [string, number]> }>,

  // ── drifters ─────────────────────────────────────────────────────────────
  dockShips: 4,
  dockCap: 2000,
  drifterCap: 200,
  drifterTilesPerMin: 60,
  drifterLoadMin: 1,
  drifterCost: { resin_canvas: 20, gear: 10, circuit: 5 } as Record<string, number>,
} as const;
