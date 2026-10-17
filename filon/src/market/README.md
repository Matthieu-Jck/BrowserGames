# `src/market` — the Crier Ring's NPC market

The simulated world market of design §6 (« la Criée »): forty colonies (the other claims of the Crier; some are the player's neighbouring bases, D110), an elastic price per tradable item, world events and their Gazette, spot trades with slippage, and the « Ce qui rapporte » (What pays) board. It sits behind the `MarketService` contract (design §9). The sim calls it once per epoch through that contract, the UI reads its snapshot, and a future server client can implement the same contract.

It is pure TypeScript that imports only `src/core` and `src/content` (enforced by [architecture.test.ts](../architecture.test.ts)). It type-checks without DOM types in the purity project ([src/sim/tsconfig.json](../sim/tsconfig.json)). It is **deterministic**: a pure function of (world seed, absolute world epoch, the player's flows, the founding epoch), with no `Math.random`, clock or timers (a guard test scans the sources). It computes in floats (`Math.exp`/`log` are allowed here, because the market is authoritative where it runs). Everything that reaches the sim is an integer: prices in centi-ocelles per item (◉ × 100), quantities in milli-items (mu).

## Files

| File | Holds |
|---|---|
| [types.ts](types.ts) | The contract `MarketService` and every public shape: `MarketConfig`, `MarketEpochIn` / `MarketEpochOut`, `PriceTable`, `Quote`, `MarketEvent`, `ImportSource`, `ColonyView`, `MarketSnapshot`, `BoardOptions` / `BoardRow`, `MarketSave` |
| [service.ts](service.ts) | `LocalMarketService` (`impl: 'npc-v1'`): the facade, snapshot, save / load |
| [engine.ts](engine.ts) | `MarketEngine`: the per-epoch state machine (flows → equilibrium → smoothing → prices), spot booking, trade attribution per colony, hourly history |
| [pricing.ts](pricing.ts) | Pure maths: `lnEquilibrium` (bisection), `lnRatioNoFlow`, `rampAt`, the stateless noise (`gauss`, `noiseAt`), the spot depth curve (`meanPath`, `spotShock`), integer helpers `bidCents` / `askCents`, `valueCents`, `afterFee` |
| [events.ts](events.ts) | `windowEvent` (one 6 h world window), `firstTradeEvent` (the scripted Port-Écume shortage), `EventSchedule`, `eventsAt` |
| [colonies.ts](colonies.ts) | `makeColonies(seed)` (names, bands, places, sizes, uniques) and `tradeByItem` (per item: import sources nearest first, buyers, growth) |
| [board.ts](board.ts) | `board(engine, recipes, energyCost, opts)`: margins, ◉ per raw tile-minute, price impact |
| [market.test.ts](market.test.ts) | The invariants (the plan's numbers, events, save / load, perf, determinism) |

Content it reads: [content/colonies.ts](../content/colonies.ts) (the eight profiles, their weighted trade lines, the pinned names Port-Écume / Sept-Cornes / Hameau-Lilas, name syllables, positions), `BAL.market` in [content/balance.ts](../content/balance.ts) (every knob), `ITEMS` (`value` = V, `depth` = Q; `depth: 0` = not traded, such as water), `RECIPES` and `BUILDINGS` (for the board).

## Public API

```ts
const market = new LocalMarketService({ worldSeed, foundingEpoch, startEpoch?, events?, firstTrade?, noise? });
market.settle({ epoch, sold?, bought?, spot?, slippage? }): MarketEpochOut  // once per epoch, in order
market.prices(): PriceTable                                                 // { epoch, bid[], ask[] } cents, by item index
market.quote(item, 'buy' | 'sell', qtyMu, slippage = 1000): Quote          // pure
market.book(item, side, qtyMu, slippage = 1000): Quote                     // price AND book a spot trade
market.sources(item): readonly ImportSource[]                              // { colony, delayMin, share }, nearest first
market.snapshot(): MarketSnapshot                                          // colonies, items, events, trade per colony
market.board(recipeIds, energyCost, { home?, flows?, craftSpeed?, tileCaps? }): BoardRow[]
market.save(): MarketSave            /  LocalMarketService.load(save, config)
afterFee(cents, side, feePermille) · valueCents(mu, unitCents, side)        // integer helpers for the trade post
```

`item` is a registry index (what the sim stores) or an item id. `sold`, `bought` and `spot` are `ArrayLike<number>` of mu by item index, such as the sim's `Float64Array(N_ITEMS)` accumulators. `book`, `prices` and `sources` extend the plan's contract.

## The model

Per tradable item, with r = P / V (V = the item's reference value):

1. **NPC curves.** Supply S = S0·e·r^0.8, demand D = D0·e′·r^−0.6, where e and e′ are the event multipliers. S0 and D0 are the item's depth Q at the colony's day 0 (balanced: r = 1). Both grow linearly with the colonies that trade the item (1–2.5 %/day). With `growthSkew: 0` they grow at the same mean rate, so the market deepens without drifting off V (`1` gives each side its own colonies' rate: atlases +24 % by day 30). The T3/T4 markets start at 20 % of their depth and reach 100 % after 30 days (T3) or 45 days (T4), counted from the founding.
2. **Equilibrium** r*: D(r*) + imports = S(r*) + exports, solved by bisection (24 steps on ln r ∈ [ln 0.25, ln 4]) on the player's **average flows over the last 5 epochs**. Equilibrium and smoothing run every 5 epochs. Exporting 0.1 Q gives r* ≈ 0.93, 0.5 Q gives 0.695, Q gives 0.48.
3. **Smoothing.** ln r_f ← ln r_f + (1 − e^(−Δ/τ))·(ln r* − ln r_f), with τ = 6 h for commons and 12 h for uniques. The events' impact (ln r* with events − ln r* without) eases in separately with τ = 20 min, so that a 2 h shortage still shows.
4. **Noise** u(t): stateless smooth value noise on a Gaussian lattice, `hash(seed, item, octave, cell)`. It has four octaves (20 h, 10 h, 5 h, 1.5 h), is normalised to σ = 0.06 (commons) or 0.12 (uniques), and decorrelates to 1/e in about 12 h. It is never saved.
5. **Price.** P = V·exp(ln r_f + ln e_f + u + shock), clamped to [0.25 V, 4 V]. bid = ⌊P·(1 − s/2)⌋ and ask = ⌈P·(1 + s/2)⌉ in cents, with spread s = 4 % (commons) or 10 % (uniques). The trade post's fee comes on top (`afterFee`), so a round trip loses about 19 % on commons and 23 % on uniques.
6. **Spot.** Over a net volume w booked this epoch, the marginal price is P·e^(−w/K), with K = κ·Q (κ = 30 min of NPC flow; slippage ‰ scales it), clamped to the bounds. Selling L at once averages P·(K/L)·(1 − e^(−L/K)): 9 000 plates fetch 0.787 P. At the next settle, the epoch's net volume leaves a factor max(0.25, 1 − w/2K) on the price (−25 % for those plates; buying leaves the mirror factor in ln space). It fades with τ.
7. **Events.** World events come in 6 h windows. A window holds an event with probability 35 % (from `hash(worldSeed, window)`): shortage (demand ×2, 12–36 h), tier boom (×1.5, 48 h), glut (supply ×1.8), storm season (charged cells ×2.5), unique caravan (supply ×2 of a unique). The Gazette announces each one 1–3 h before it starts. Each colony also gets its scripted first trade: a glass shortage at Port-Écume (×2) from 20 min after founding, for 2 h.

## Tuning knobs

All the knobs are in `BAL.market`:
- curves and bounds: `supplyExp`, `demandExp`, `rMin`, `rMax`, `bisectSteps`;
- timing and spread: `blockMin`, `tauMin`, `eventTauMin`, `spread`;
- noise: `noiseSigma`, `noiseOctaves`;
- spot trades: `spotKappaMin`, `shockFloor`;
- colonies and growth: `delayMin` (2 / 8 / 25 / 60 min by band, D113), `rampFrom`, `rampDays`, `rampSupply`, `growthCapDays`, `growthSkew`;
- views: `historyPoints`, `historyEveryMin`, `tradeEmaMin`;
- events: `eventWindowMin`, `eventChance` (‰), `eventLeadMin`, `eventTierWeights`, `events` (per kind: weight, side, mult, hours), `stormItem`, `firstTrade`;
- the board: `tileCapPerMin`.

The colonies' trade lines, counts, bands, growth and names live in [content/colonies.ts](../content/colonies.ts).

## Integrating it into the sim

- **Create it** at founding: `new LocalMarketService({ worldSeed: sim.worldSeed, foundingEpoch: sim.foundingEpoch })`. Its first table prices `foundingEpoch`. For a colony saved before the market existed, pass `startEpoch: sim.absEpoch()`: it starts at the no-trade equilibrium without replaying.
- **Settle at every epoch boundary**, online and in the offline catch-up alike (the same call, in order). When `tick % EPOCH === 0`, `sim.absEpoch()` is the epoch that just began, so call `market.settle({ epoch: sim.absEpoch() - 1, sold, bought })` with the mu the trade post exported and imported **during the epoch that just ended**, then zero the accumulators. The result holds the integer `bid` / `ask` (cents by item index) for the new epoch: trade at those until the next boundary. A week offline means 10 080 settles, which take about 60 ms. A stale epoch is ignored. A gap is filled with trade-free epochs (and a gap over 10 days restarts the market at equilibrium), but the sim should never rely on either.
- **Streams.** Mu entering an export stream during epoch n is sold at that epoch's bid: credit `afterFee(valueCents(mu, bid[i], 'sell'), 'sell', mods.tradeFee)` and add the mu to `sold[i]`. Crediting per epoch from the per-epoch flows keeps online and offline ledgers identical. Keep a sub-cent carry if you credit more often than once per epoch.
- **Standing import orders.** Each epoch, while `ask[i] ≤ max` (±3 % hysteresis) and the credits suffice, buy the order's rate: debit `afterFee(valueCents(mu, ask[i], 'buy'), 'buy', fee)` and add the mu to `bought[i]`. The goods arrive after the trade post's lift delay (`BAL.liftDelayMin[level]`) plus `market.sources(i)[0].delayMin` × `mods.deliveryDelay` ‰: an in-flight record the sim saves. The market attributes imports to that nearest supplier.
- **Spot trades.** `const q = market.book(i, side, mu, mods.slippage)`, then credit or debit `afterFee(q.totalCents, side, fee)`. `book` makes later quotes in the same epoch continue down (or up) the depth curve, so splitting a sale gains nothing, and its −25 %-style shock lands at the next settle. Moving the goods through the trade post's throughput is the sim's job. Do not also report a booked trade in `settle({ spot })`: that field is only for callers that log per-epoch totals instead of calling `book`. Use `quote` (pure) for previews.
- **Events.** `settle` returns `started`, `ended` and `announced` (ids and numbers only): forward them as `SimEvent`s for toasts and the Gazette. The scripted shortage is announced at the founding epoch itself, before any settle, so the UI finds it in `snapshot().events.announced`.
- **Save.** `market.save()` goes into the colony payload. It is JSON-safe and holds only flow-dependent state: smoothed ratios, event offsets, shocks, block sums, booked spot volume, 24 h history, per-colony trade, keyed by item ids and colony keys. Colonies, noise, events and depths are recomputed from the seeds. Load with `LocalMarketService.load(save, { worldSeed, foundingEpoch })`, which throws on a malformed save and never resets silently. A save should be taken between boundaries, with `save.epoch === sim.absEpoch() - 1`.
- **UI.** `snapshot()` holds the colonies (names `{ fr, en }`, profile, `lat` / `lon` / `arc`, delay, supplies and needs), each item's bid / ask / mid / hourly `history` / `trend` / depths / sources, active and announced events, and the player's smoothed trade per colony in centi-◉ per minute (the freight arcs). `board(unlockedRecipeIds, cE, { home, craftSpeed: mods.craftSpeed })` gives the What-pays rows, sorted by ◉ per raw tile-minute. With peat as fuel, cE ≈ 0.04 ◉ per kW·min.
