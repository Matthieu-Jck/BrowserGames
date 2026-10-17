# Offline catch-up (`src/sim/offline`)

A colony keeps producing while the player is away, with no cap on the absence. `catchUp(sim, ticks)` advances a colony by any number of ticks with the **same engine** as online play, in time that grows with the number of *events* (epochs, stores filling or emptying, research and digs finishing), not with the length of the absence: each independent part of the factory is ticked only until its state repeats exactly, then extrapolated by whole periods. A single steady regime is reproduced bit for bit; where the catch-up has to approximate, it says so in its report.

Read [engine.md](engine.md) first (nodes, phases, reservoirs, the allowance pattern). Tests: [testing.md](testing.md). The shell calls it at boot for the time since the last save, and online whenever the base falls behind the wall clock (a hidden tab, dropped ticks); the report becomes « Pendant ton absence » ([persistence.md](persistence.md)).

## Where things are

| Path | Role |
|---|---|
| [offline/catchup.ts](../src/sim/offline/catchup.ts) | `catchUp(sim, ticks, opts)`: segments, events, reservoir states, throttles, power modes, pseudo-flows, the main loop |
| [offline/steady.ts](../src/sim/offline/steady.ts) | Warm-ups: virtual reservoirs, period detection, `Regime`, `flowAt`, `materialize`, `condKey` |
| [offline/report.ts](../src/sim/offline/report.ts) | `AwayReport`, `Incident`, `newReport` |
| [graph/groups.ts](../src/sim/graph/groups.ts) | `buildGroups`: sub-graphs cut at reservoirs, `rotL`, `signature` |
| [flow/nodes.ts](../src/sim/flow/nodes.ts) | `ReservoirNode` virtual mode (`vState`, `vRate`, `vPool`, `vTick`), `V_NORMAL/V_EMPTY/V_FULL` |
| [research/runtime.ts](../src/sim/research/runtime.ts), [space.ts](../src/sim/space.ts), [systems/](../src/sim/systems/) | The allowance rules the catch-up reuses: `advanceProject`, `advanceJob`/`jobRate` |
| [offline/catchup.test.ts](../src/sim/offline/catchup.test.ts) | Exactness, dry reservoir, conservation, a week, steady periods, 12 random bases |
| [bench/perf.test.ts](../src/sim/bench/perf.test.ts) | A week of the 25 k-entity base |

## The contract

- **Same rules, same functions.** Groups are stepped by `runPhases` exactly as online; research, digs and fills are advanced by the online functions; finishing a project or a job calls the online `finishProjects` / `completeJobs`; each minute boundary calls the online `tradeEpoch`, `landEpoch`, `tokenEpoch` (research's AI tokens, D68), `expertiseEpoch` (the expertises' feats and slots, D93) and `gleanEpoch` (the Gleaners' nightfall and dawn, D103).
- **Bit-exact for a steady regime.** If no store crosses a bound and every grid's renewables cover its peak demand (full satisfaction, no fuel dispatch), the catch-up ends with the same stocks and the same `hash()` as ticking (test: "reproduces a single steady regime bit-exactly").
- **Flagged approximation elsewhere.** Stores at a bound, power shared between regimes, non-periodic groups: approximate, reported through `mode` and incidents ([Exact vs approximate](#exact-vs-approximate)). Not every source of error is flagged yet (*Known gaps*).
- **Unlimited.** Production never stops because the player was away; it stops only for lack of input or room (back-pressure), as online.
- **Deterministic** (same colony + same `ticks` ⇒ same result) but **not equal to ticking**: a replay must repeat the same `catchUp` calls.
- Gaps of at most `DIRECT_TICKS = 1200` ticks (2 min) are simply ticked (`mode: 'direct'`); `{ noDirect: true }` forces the regime path (tests).

Why it is built this way: [decisions.md](decisions.md) (D2 unlimited offline production, D17 long processes as pseudo-flows).

## Calling it from the shell

`catchUp(sim, ticks, opts?)` mutates the colony in place and returns an `AwayReport`. `ticks` is the real time away in ticks (`elapsed ms / TICK_MS`); afterwards `sim.tick` has moved by exactly `ticks`, so the colony's world clock (`absEpoch`) stays aligned with the wall clock. It is synchronous and DOM-free. Nothing in the app calls it yet (only tests and the bench); M7 will run it in a Worker by posting the save, catching up there and posting the save back ([roadmap.md](roadmap.md)). Afterwards the shell drains `sim.events` as usual (tiles dug, research finished, `structure`), sets `rep.computeMs`, and hands the report to the absence screen ([ui.md](ui.md)). Right after the catch-up the shell also calls `sim.checkQuests()`: the catch-up runs no `step`, so the tutorial's current quest is checked there (its rate windows then span the absence); without the call, the first online check, within a second, finds the same ([quests.md](quests.md)).

## The big picture

```
catchUp(sim, ticks)
  ticks ≤ 1200 → sim.run(ticks)                                        mode 'direct'
  setup(): groups, runs, reservoir states, grids, pending constructions
  loop until end:
    assign jobs · classify reservoir items · settle (regimes ⇄ power ⇄ throttles)
    pseudo-flows (research draws, data files, stone) · throttles again if needed
    t = min(next epoch boundary, next event)          (level events ≥ 60 ticks ahead)
    advance(t): reservoirs += regime flows; jobs, research, accumulators by the online rules
    tiles done │ research done or a science fully paid │ constructions due
        → materialize every group, apply, recompile, setup()
    epoch boundary → trade, the leases' hour (a lapse: materialize, recompile) → tokens → expertises (a change of the Mods: materialize, recompile) → new weather → power modes
  materialize every group; sim.tick = end; report
```

## Groups: why cut at reservoirs

`buildGroups` takes the connected components of the flow graph over edges that do not touch a reservoir. Every non-reservoir node belongs to exactly one group; the edges between a group and a reservoir are its boundary (`resIn`, `resOut`). Reservoirs are the Hearth, silos, trade posts and also every store a long process hangs off: research labs, excavators, backfillers (and servers, power-only nodes of no group).

The cut is sound because a reservoir item **between its bounds** behaves the same whatever its level: an outlet offers `min(stock, portRate)` = `portRate` and an inlet accepts `cap − stock`, more than any tick's inflow. So the groups on either side of a reservoir evolve independently, the level is just the running sum of their flows, and each group can be warmed up and extrapolated on its own. Groups still interact in two ways, both handled explicitly: through a reservoir item that reaches a bound (states and throttles) and through a shared power grid (power modes).

A `Group` also carries `nets`, its fuel generators `gens`, its nodes in the tick's accept order `accOrder` (the ribbons downstream first, D57), `rotL` (the lcm of every rotation modulus `n` its nodes and boundaries use in `now % n`, and of its ribbons' and boundary outlets' step patterns `stepPeriod` — they step on the world's clock; a trade post's exit times the length of its `cycle` (D62) —, so the phase of `now` is part of its state) and `sig`, a structural signature (node kinds, entities, grids, power draws, speeds, rates, recipes, tiles, edges, outlet items) used in cache keys.

## Virtual reservoirs and the reservoir state machine

During a warm-up the group's boundary reservoirs are put in **virtual mode** (`Virtualizer` in steady.ts): they see only this group's edges and record flows (`vIn`, `vOut`) instead of changing levels. Each item has a state:

| State | Online meaning | Virtual behaviour |
|---|---|---|
| `V_NORMAL` | between the bounds | offers `portRate`, accepts everything: identical to the real reservoir |
| `V_EMPTY` | nearly empty | offers only a small pool refilled at the group's **throttle** rate (its share of the item's total inflow); the pool starts at the true remaining stock |
| `V_FULL` | nearly full | accepts only into a room pool refilled at the group's share of the item's total outflow; the pool starts at the true remaining room |

Pools refill once per tick (`vTick`, mu per epoch with a carry) and never bank more than a few ticks of throughput (`portRate·4 + 4000` mu). They are hashed, so a throttled group still finds an exact period.

States are kept per (reservoir, item) with the margin `m = BAL.reservoirMargin` (20 items) and hysteresis (`classify`):

| From | To | When |
|---|---|---|
| NORMAL | EMPTY / FULL | level < m / level > cap − m |
| EMPTY | NORMAL (or FULL) | level > 2m |
| FULL | NORMAL (or EMPTY) | level < cap − 2m |

A group only sees EMPTY for items it **pulls** from that reservoir and FULL for items it **pushes** into it (`effState`; pull/push sets come from the items its outlets hand out, the group's products, and any flow later seen in a regime).

**Throttles** (`computeThrottles`): for an EMPTY item the total is the item's inflow (regime inflows + pseudo-inflows) per epoch; for a FULL item, its outflow (regime outflows + pseudo-outflows). Each throttled group gets a share proportional to its flow while the item was NORMAL (`normalIn` / `normalOut`), or an equal share when unknown. A total is updated only when it moves by more than max(10 mu, 1 %), which re-warms the throttled groups. The effect: an empty Hearth item is shared out as it arrives, and a full one takes in only what leaves.

## Warm-ups and exact periods

`warmUp(g, grp, ctx, cond, now, key, scratch)`:

1. Enter virtual mode under `cond` (per-item states and throttle rates, per-grid satisfaction and dispatch — fixed for the whole warm-up) and snapshot the group (`s0`).
2. Step the group's nodes plus its virtual reservoirs with `runPhases`, up to `WARM_MAX = 2 × PERIOD_MAX = 4800` ticks.
3. After each tick hash the state (`hashState`: `now % rotL`, every node's `hash(h, now)` with relative ticks, the virtual pools) into a 53-bit key. The first key seen twice gives the transient `t1` (its first occurrence) and the period `p`.
4. Record per tick the cumulative gross in/out flow per (reservoir, item), production and consumption, per-grid demand, which generators had fuel.
5. Build the `Regime`: the keys with flow, `prefT` (net inflow at every tick of the transient), `prefP` (over one period), gross `inP`/`outP` per period, `dAvg`/`dMax` per grid, `fueled` ‰ per generator, production/consumption over the transient and per period, and `s1`, the snapshot at the start of the period.
6. Restore the group to `s0`: the timeline is advanced analytically by the caller.

Short exact periods are by design: recipe cycles divide `CYCLE_LCM = 1200`, satisfaction moves in 25 ‰ steps, chains coalesce due runs into a canonical form, fairness depends only on `now % n`. If no state repeats within 4800 ticks the regime is marked **not exact**: `t1 = 1200` (settle) and the window [1200, 4800] is used as one long averaged "period" (`mode: 'approx'`). Test: "steady layouts lock into an exact period, jams included".

## Extrapolation and materialization

`flowAt(reg, j, e)` is the exact cumulative net inflow of key `j` after `e` elapsed ticks:

```
e ≤ t1:  prefT[e]
e > t1:  prefT[t1] + ⌊(e − t1)/p⌋ · prefP[p] + prefP[(e − t1) mod p]
```

`advance(to)` adds `flowAt(to − start) − flowAt(now − start)` to every reservoir item of every run: integers, whole periods plus a prefix, no per-tick work. Production and consumption statistics follow the regime exactly too (`statAt`: the transient's per-tick totals, then whole periods plus a prefix, from `Regime.prodSeries` / `consSeries`). Until 2026-10-13 they were linearised (`prodP · dt / p`) and missed each regime's transient: a line draining a silo into an incinerator counted 175 of 200 items offline.

The nodes of a group are not touched while its regime holds. `materialize` rebuilds their true state when needed — before a group is re-warmed under new conditions, before a recompile, and at the end: for `e ≤ t1` restore `s0` and step `e` ticks; otherwise restore `s1` at the start of the current period and step `(e − t1) mod p` ticks. Snapshots store absolute ticks (chain runs) and `restore(s, shift)` moves them, so a state captured at one time is valid at another.

## The regime cache

Regimes are kept in a per-call `Map` keyed by `condKey`: the group's signature, `modsKey(sim.mods)`, every grid's satisfaction and dispatch, and every non-NORMAL boundary item with its throttle rate. Each fresh warm-up stores its regime. A group that has been warmed up `CACHE_AFTER = 6` times since the last `setup()` and re-enters a known key reuses the cached regime without warming: it jumps into the cached cycle with no transient, which sets `mode: 'approx'`. Regimes that repeat (day/night, a store cycling between states, a windy grid's satisfaction) therefore stop costing warm-ups. Since the tile-by-tile ribbons (D57) the jump is careful, because a group's behaviour now depends on the phase of the world's clock (the ribbons and outlets step on it) and its ribbons hold more items in transit:

- **An exact regime** jumps to a point of its cycle **in phase** with `now` (`lag` = (now − s1.tick) mod `rotL` ticks in, the regime then counted as started `lag` ticks before now) and **holding the items the group holds now** (`groupHeld`, per item): from `lag`, a phase's turn (`rotL` ticks) at a time, up to `SEARCH` = 100 ticks (`scanGroup`, one virtual session); failing an exact match, at the closest point. A blind jump to `s1` lost or made the items in transit that differed (about a dozen over a few hours on the test bases: the random-base test failed).
- **An averaged regime** (no exact period: already an approximation) still jumps to `s1`.

## The Gleaners (D103)

The Gleaners' theft is a rule of the ribbon chains ([engine.md](engine.md#the-gleaners-d103)), inside the flow phases, so a group's warm-up runs it like any node's update — offline-exact by construction, under three additions:

- **The night is a condition.** `Cond.night` (set by `condFor` for a group with an exposed chain, `Group.glean`, from the segment's world minute) goes into the regime's key (`condKey`: `night`) and into the warm-up's context (`setPower` sets `ctx.glean`). At each minute boundary where the night begins or ends, every such group is marked dirty and takes a new regime at the next `settle` (twice a day; after `CACHE_AFTER` warm-ups the cache serves them, in phase).
- **The window is in the period.** At night a group's behaviour follows the raid window (`GLEAN_WINDOW` = 2 400 ticks of the world's clock, D112) as well as its rotations and beats: `Group.rotNight` = lcm(`rotL`, 2 400), used by `hashState` and the cache's jump (`rotOf`) under a night condition; by day `rotL` holds, so a group by day keeps its short period.
- **What is taken is a statistic of the regime.** The warm-up records `ctx.gleaned` per tick as a third series beside production and consumption (`Regime.gleanItems`, `gleanSeries`, `gleanAt`); `advance` adds each run's takings to `Sim.gleaned` and the report (`AwayReport.gleaned`) and marks them on the group's most exposed chain (`Group.gleanTile`, `markTaken`). The boundary's `gleanEpoch` then reports dawn as online; the catch-up keeps its `gleaners` events (one a night at most).

Bit-exact on a steady exposed line over two nights (`gleaners.test.ts`: the same takings, stocks, stores, morning reports and `hash()`).

## Power during the catch-up

`computeNetModes` solves each grid per segment from the current regimes rather than per tick: demand `dAvg` and `dMax` summed over the groups on the grid plus what its **reservoir buildings** draw (research labs, servers, excavators, backfillers, trade posts: `resKw`, fixed between recompiles; they belong to no group), fuel capacity `F` and effective `Feff` (`outKw × fueled ‰`), renewables `R` from this epoch's weather (the same `weatherAt`, `weatherKey` and `renewableKw` as online — the Heart's solar panel included, so the base's own power follows the sun offline too; a turbine's exposures are fixed at compile and the wind is the world clock's, D95), accumulator energy, capacity and rate. The grids themselves are the wires' components (D25), compiled by the same `compileGraph`; wires change only through commands, so an absence never rewires anything:

| Case | Satisfaction | Dispatch | Accumulators |
|---|---|---|---|
| `R ≥ dMax` | 1000 | 0 | charge at `min(rate, R − dAvg)` until full |
| `R + Feff ≥ dMax` (generators) | 1000 | `⌈(dAvg − R)·1000/F⌉` ‰, at least 1 (online's exact share: D114, no longer rounded up to 25 ‰) | — |
| accumulators hold energy | `(R + Feff + discharge)/dAvg`, floored to 25 ‰ | 1000 if it has generators | discharge `min(rate, dAvg − R − Feff)` |
| otherwise | `(R + Feff)/dAvg`, floored to 25 ‰ | 1000 if it has generators | — |

Modes are recomputed for every grid after a `setup()` or when the weather (sun ‰, wind ‰, the day's bearing: `weatherKey`, D95) differs from the last segment's, and otherwise only for grids where a group took a new regime or whose accumulators just filled up or ran dry. Since the sun moves every epoch, that is every grid at every boundary, so two of its inputs are kept between calls: a grid's load (`netLoad`: demand, fuel capacity, fueled share), summed again only for a grid in `netDirty` (a regime on it changed) or after a `setup()`, and its renewables per `weatherKey` (`netR`: the wind rounded to 50 ‰, a few hundred distinct weathers a week at most), both dropped at every `setup()`. Same inputs, same modes. A grid whose mode changes marks every group on it dirty (re-warm under the new satisfaction) and logs a `brownout` incident when it drops below 1000. Demand depends on satisfaction and satisfaction on demand, so `settle()` iterates *regimes → power modes → throttles* up to four passes, then finishes the dirty regimes. Accumulator energy is advanced by `accRate × dt`, spread in id order like online. Fuel generators are ordinary flow nodes inside groups: their fuel arrives by ribbon and burns at the fixed dispatch of the warm-up.

## Pseudo-flows: research and jobs

Long processes are not flow nodes: they hang off reservoir stores. `labFlows()` declares each one, every iteration, as a known flow of its reservoir (mu per tick, keyed `ri × N_ITEMS + item`):

| Process | Reservoir | Map | Rate |
|---|---|---|---|
| Research project | its lab | `labOut`, per data item still owed | `cost × sat / (dur·1000)` while `el < dur·1000` |
| Survey Data out of the Heart / an autonomous lab (D68) | the Heart / the lab | `pIn`, `journal_1` | `rate × sat / (600·1000)` (the Heart: sat 1000) |
| Dig | the excavator's store | `pIn`, stone | `jobRate = mu × sat / (dur·1000)` |
| Fill | the backfiller's store | `labOut`, stone | `jobRate` |

**AI tokens** (D68) are no flow: a project's tokens follow its `el` (`takeTokens` after `advanceProject`, into `sim.tokenUse`), the servers add `tokensPerMin × sat × dt` to `sim.serverAcc` for the segment (`serverTick`, the grid's satisfaction of the segment), and the boundary's `tokenEpoch` bills them as online. Segments never cross a minute boundary, so the bill is the online one. A purse that goes into the red sets `researchHeld` at that boundary: the projects' satisfaction is 0 from the next segment on (`researchHeld` / `researchResumed` incidents). The same per-segment rule as research's `el` applies: exact while each grid's satisfaction holds within the segment. Data files out of the Heart and the autonomous labs (`dataTick`) are whole milli-items with the remainder carried (`sim.dataAcc`), the same total as online over any split.

Pseudo-flows enter `rateOf` (next events) and the throttle totals, so a store fed by ribbons and drained by research is classified and throttled like any other. The process itself is advanced in `advance(dt)` by the online functions with this segment's satisfaction: `advanceProject(p, store, dt, sat)`, `sim.advanceJobs(dt, …)` (an excavator whose store is FULL gets satisfaction 0, the offline form of "digging pauses at the cap").

**Why the allowance makes this exact.** A project may have paid `⌊cost · el / (dur·1000)⌋` after elapsed powered time `el`, and pays `min(due, store)`. `el` is a plain sum of `sat × ticks`, so when the store never runs short, the amount paid after a segment is the same whether the segment was advanced in one call or tick by tick. Digs and fills use the same rule on stone. The next-event rule keeps every store away from its bounds inside a segment, which is exactly the "store never runs short" condition.

## Segments and events

A segment ends at the next epoch boundary or the next event, whichever is first (`nextEvent`), and never less than `MIN_STEP = 60` ticks ahead for level-driven events.

| Event | When | What happens |
|---|---|---|
| Epoch boundary | every `EPOCH` ticks | **trade** (`sim.tradeEpoch()`, the same call as online: deliveries, orders, sales, the market's settlement; it moves reservoir levels and ocelles only, so no group is materialized; every (reservoir, item) whose level it moved is re-classified at the next `classify` (`moved`), since a key with no flow is not looked at otherwise — a full Hearth that a stream sells down takes its jammed line again, at the same moment as online; its per-minute `trade` / `delivered` / `gazette` events are dropped and the absence's trade lands in the report: `sold`, `bought`, `earned`, `spent`, `creditsDelta`), then **the leases' hour** (`sim.landEpoch()`, the same call as online, right after the trade: rent paid from the ocelles; when a lease would lapse — `lapsing`, the purse short of a rent due — every group is materialized first, since what stands on that parcel goes dormant and the graph is rebuilt; a `leaseLapsed` incident with its `parcel`; the `land` events are dropped like the trade's), then the new weather — the sun step and the wind (each epoch: the day's curve, its mood, the gust window every 10; the bearing each day, D95) → power modes |
| Reservoir bound | a key's net rate brings its level to m or cap − m (NORMAL), above 2m (EMPTY, rising), below cap − 2m (FULL, falling) | `classify` → new state → throttles, re-warms; `storageFull` / `storageEmpty` incidents for the Hearth |
| Research done | `el` reaches `dur·1000` at the project's satisfaction | `finishProjects` (unlocks, `Mods`), recompile, `setup()`; `researchDone` incident |
| Data fully paid | detected after `advance` | the lab stops accepting it (an autonomous lab stops making it): recompile, `setup()` |
| Tile dug / filled | a job's `el` reaches `dur·1000` | `completeJobs` (terrain, embedded ore, events), re-assign; recompile only if a pump's water or the set of busy machines changed (their draw) |
| Expertises (D93) | at each epoch boundary, after the tokens' bill | `sim.expertiseEpoch(satOf)` with the segment's grid modes (`netModes[n].sat`: the Core's grid at the minute's end, the `grid` feat), the same call as online; the feats read counters that are exact at a boundary (`produced` follows the regimes; the Crier's ledger, tokens, land and what stands change only at boundaries or by commands). An expertise in place whose rank rose, or one coming into place after its réorientation's 24 h, changes the Mods: every group is materialized, the graph recompiled, `setup()`. Its `expertise` events are kept (notices after the absence) |
| Construction | the earliest pending `builtAt` | `builtAt = 0`, recompile, `setup()`; `built` incident |
| Accumulators full / empty | `(cap − E)/accRate` or `E/−accRate` | the segment ends there and the grid is marked for a new power mode (`netDirty`) |

Every recompile is followed by `setup()`, which rebuilds groups and runs from the new graph and classifies every reservoir item again from its level.

**One instant, in the online order.** After `advance(t)`, the loop handles what happened at `t` in the order `Sim.step` does: the tick's completions (tiles, research), then the epoch boundary (trade, then the leases' hour), then the constructions due at the new tick. A graph change materializes the groups once, recompiles and runs `setup()`.

**A worked example** (the "silo runs dry" test). The test stocks one silo with 1 000 iron ore and another with 400 coal; they feed a kiln whose plates ribbon back to the Hearth. The silos' ribbons, the kiln and the plate ribbon form one group with three boundary edges: one from each silo, one into the Hearth.

1. `setup()` finds every reservoir item NORMAL. One warm-up: ribbons fill and kiln buffers settle (the transient), then each craft repeats (the period). Net flows: −30 ore/min, −6 coal/min, +15 plates/min.
2. `nextEvent` puts the ore's crossing of the 20-item margin about 33 minutes away. Until then each segment is one epoch; the regime holds, so a segment costs a few `flowAt` calls and no warm-up.
3. At the crossing, `classify` turns the silo's ore EMPTY (no incident: storage incidents cover only the Hearth). Nothing produces ore, so the throttle is 0: the group is warmed up again with a pool holding the last ore. The kiln drains it, starves, and the new regime has no flows.
4. The rest of the two hours costs one segment per epoch and no more warm-ups.

## Exact vs approximate

At the edges of approximate regimes `advance()` keeps every store within [0, cap]: what it trims at the cap goes to `rep.lostMu` (any store, not only the Hearth) and what it would have taken below 0 to `rep.clampedMu`, per item — the measured error bar of `mode: 'approx'`.


| Situation | Result |
|---|---|
| Absence ≤ 1200 ticks | ticked one by one: exact (`mode: 'direct'`) |
| Group with NORMAL boundaries, renewables covering peak demand, period ≤ 4800 ticks | bit-exact flows and end state |
| Research, digs, fills whose stores never run short | exact totals (allowance) |
| A store at a bound (EMPTY / FULL) | throttled shares instead of per-tick port order; drain and fill timing shift a little |
| Power | one mode per grid and segment from regime averages; dispatch at the exact ceiling of the average need (online: of each tick's; a steady load burns and drinks the same to the milli-item, steam-boiler.test.ts); accumulators charge at `R − dAvg` |
| No period within 4800 ticks | the [1200, 4800] window extrapolated (`mode: 'approx'`) |
| Cache reuse | the group jumps into the cached cycle, in phase, at the point holding its items or the closest one (an averaged regime: to its end); `mode: 'approx'` |
| Event timing | level events at least 60 ticks apart; paid-science and construction changes applied at segment ends |
| Statistics | produced/consumed linearised |

**The report** (`AwayReport`, ids and numbers only; the UI localises): `fromTick`, `toTick`, `mode` (`direct` / `exact` = every regime periodic / `approx`), `warmups` and `warmTicks` (cost), `produced`, `consumed`, `hearthDelta` per item, `lostMu` (overflow trimmed at a store's cap in `advance`) and `clampedMu` (what a store would have gone below 0 by), `gleaned` (what the Gleaners took off the ribbons by night, D103), the trade of the absence (`sold`, `bought`, `earned`, `spent`, `creditsDelta`), and `incidents` (`storageFull`, `storageEmpty`, `brownout`, `researchDone`, `built`, `leaseLapsed`, `researchHeld`, `researchResumed`, with tick and item/entity/ref/parcel). `computeMs` is left for the caller. `lostMu` / `clampedMu` measure the edge error of the approximate cases; the error inside a non-periodic regime is not measured (bounded in practice by the tests below).

## Tests that guard it

| Test | Guards |
|---|---|
| "reproduces a single steady regime bit-exactly" ([catchup.test.ts](../src/sim/offline/catchup.test.ts)) | drill → ribbon → Hearth for 1 h: same stocks, same `hash()`, < 6 warm-ups |
| "matches online play when a reservoir runs dry mid-absence" | kiln line, 2 h, ore runs out: plates and coal within 25 items; `storageEmpty` reported |
| "conserves items through the catch-up" | ore consumed ≈ 2 × plates made (within 3 items) |
| "a week-long absence of a small base computes quickly" | 7 days in < 4 s; ore empty, coal fills to the cap, `storageFull` reported |
| "steady layouts lock into an exact period, jams included" | every group of a mixed base is exact with `p ≤ 2400` |
| "online ≈ offline on random bases" (12 seeds) | random mixes of lines, grants and warm-ups over 1–4 h: every stock within max(2 items, 0.5 % of its flow). `CATCHUP_REPORT=1` prints the worst gap |
| "accumulators store and give back the same energy offline as ticking" ([power.test.ts](../src/sim/power/power.test.ts)) | accumulator energy equal after 1 800 ticks of charging (discharge is not covered) |
| "online ≈ offline: data by ribbon, the Heart's files, servers, the minute's bill" ([research.test.ts](../src/sim/research/research.test.ts)): the same tokens used and bought, the same purse, the same data in the Heart |
| (before D68) "the offline catch-up completes the same research as ticking" | research fed by ribbon finishes both ways; data consumed within 1 item |
| "digging offline matches ticking" ([space.test.ts](../src/sim/space.test.ts)) | same tiles dug, stone within 1 item |
| "online ≈ offline: a rank rising and a réorientation coming into place during an absence, bit for bit" ([expertise.test.ts](../src/sim/systems/expertise.test.ts)) | drill line on steady power, Ore Cutting in place 60 ore short of rank II and a réorientation 40 minutes from its end, 2 h: the same ranks, slots, Mods, stocks and `hash()` |
| "online ≈ offline over two nights: the same takings, stocks and state" ([gleaners.test.ts](../src/sim/gleaners.test.ts)) | a 20-tile exposed line of glass from noon over two nights (D103): the same `gleaned`, the report's, stocks, stores, the dawn events and `hash()` |
| "a lease lapses in the catch-up at the same hour as online…" ([land.test.ts](../src/sim/land.test.ts)) | a leased kiln over four hours of rent the purse covers for three: the lease lapses both ways, same ocelles, same `hash()`, a `leaseLapsed` incident |
| perf test ([perf.test.ts](../src/sim/bench/perf.test.ts)) | a week of base20k in < 3 s, every silo full at the end |

The twin pattern used by all of them: build, `serialize`, `deserialize` twice, `a.run(N)` against `catchUp(b, N, { noDirect: true })`, compare.

## Performance

Cost is about *warm-ups × group size × warm ticks* plus *segments × runs*: segments are at least one per epoch (10 080 for a week), and each warm-up costs at most 4800 ticks of one group. It barely grows with the absence once regimes are cached. Last recorded runs (dev machine; the tests print them):

| Base | Week of absence | Warm-ups | Mode |
|---|---|---|---|
| base20k (25 201 entities, 10 081 nodes, 1 681 grids; 0.8 ms per online tick) | 0.9 s (2026-10-15); 2.0 s (2026-10-16, D95: the wind's calms brown its cells out, a loaded machine; 1.3 s with a steady wind) | 3 477; 13 440 | exact; approx |
| `late` debug base (seed 1, built and run 600 ticks; re-measured 2026-10-15, D92: its windy grid changes satisfaction every few minutes; drills on capped deposits have cycles of tens of thousands of ticks, so most of its big groups never repeat) | 23.5 s CPU (8 h: 10 s) | 255 (8 h: 237) | approx |

The late base (D66: standing orders, digs, long lines; drifter routes too until D108, when these times were measured) is the case to watch, and the slow one: **a week takes 23.5 s of CPU, eight hours 10 s** (Node, seed 1, after 600 ticks; re-measured 2026-10-15, D92 — the 16 s and 0.65 s written here before were stale). Where a week goes (a CPU profile and counters): `ensureRegime` 85 %. Most of it is `materialize`, bringing a group to its true state when its regime ends: 2 580 times, 1.9 M group ticks (≈ 89 M node-ticks), three quarters of them in *approximate* regimes (no exact period within 4 800 ticks: 165 of the 255 warm-ups), which step from their end state up to 3 600 ticks each time. Then the warm-ups (0.9 M ticks, hashing the group every tick: 5 s) and the cache jumps' search for the phase (2.5 M node-ticks). Each node-tick costs about 150 ns. D92 made the hot loop cheaper without changing a bit of the result — a ribbon's step verdict kept for its tick (`Chain.steps`: asked three times a tick), `StateHasher.int` without a division for the common integers — 26.5 s → 23.5 s on the week; the end hash, the report and the save are identical on five catch-ups (late seeds 1 and 2, grown, tutorial, base20k). Candidates, measured but not done (the first three change the approximate results, so they are the owner's call): an approximate regime that ends restores its end state without stepping (as a cache jump already does, the error bounded by the group's own capacity; it would save about half the week's time), coarser satisfaction steps in the regime keys, direct ticking of short segments; checkpoints along the exact regimes' cycles (bit-exact, about 2–3 s); a Worker for the boot catch-up (planned in M7: it hides the time, it does not cut it).
| small kiln + coal base (the "week-long absence" test) | 33–206 ms | 9–12 | approx |

**The per-boundary work counts on a big base.** A week has 10 080 epoch boundaries, and anything the catch-up or the online epoch calls there that walks the whole base is paid 10 080 times. base20k's week had drifted from 1.5 s to 4.25 s (idle machine) once the catch-up re-assigned jobs at every boundary as online (*Known gaps*): `assignJobs` walked all 25 k entities for idle excavators each time (2.4 s of it), the grid modes re-summed every grid's load and renewables at each new sun step (0.7 s), and the claim's hourly value priced every building one by one (0.3 s). Fixed on 2026-10-15 without changing a result: `ents.ofKinds(['excavator', 'backfiller'])` (a cached, id-ordered subset of `ents.sorted()`), the grid caches above, and `ents.defCounts()` for the value (an integer sum per building def). The week's end hash, report and save are the same bit for bit as before, on base20k and on the `late`, `grown` and `tutorial` levels. What is left of base20k's 0.9 s: the trade epoch, `advance` over 1 680 runs per segment, `settle`, and the 3 477 warm-ups (about 0.15 s together). A new per-boundary pass over entities, grids or runs belongs behind an index or a cache like these.

The plan's target is < 2 s for 7 days: base20k is under it (0.87 s), the `late` debug base far over (23.5 s, above). The shell runs it on the main thread for now, behind the boot veil. A Worker (serialize, catch up, serialize back) comes when bases grow enough to make a resync visible ([persistence.md](persistence.md)).

## Known gaps / pitfalls

- ~~Reservoir buildings' power draw was ignored offline~~ — fixed (`resKw`); guarded by "reservoir buildings (servers, observatories, excavators) draw power offline too" in `catchup.test.ts`.
- ~~Accumulator events did not refresh power modes~~ — fixed: a grid whose accumulators fill or run dry is re-solved; guarded by "an accumulator that runs dry stops covering the deficit offline too".
- ~~Trade's level changes on keys with no flow were never re-classified~~ — fixed (`moved`): a full Hearth sold down by a stream kept its line jammed for the whole absence, losing about 40 % of that line's output (posts no longer sell the Hearth's stock since D64; `moved` still re-classifies what a boundary's deliveries move).
- **A post's deliveries come in over their epoch offline** (fixed 2026-10-14; it was the known gap "a small store drained by an outlet does not flow offline"). Under 2m (40 items) a key stays EMPTY, and an EMPTY key's throttle is its inflow, while a trade post's deliveries land in a lump at the boundary: offline the exit used to wait for 40 items where online it hands them out at once. Now the catch-up takes a delivery into a store under 2m back out after `tradeEpoch` (`spreadDeliveries`) and lets it in again item by item over the epoch, as a pseudo inflow (`pIn`, like a dig's rubble): the exit's group is throttled to it and hands the items out as they come. It is whole again by the next boundary (`flushDeliveries`, also before any new graph and at the end), so the trade there sees the container as online: purchases, ocelles and the ledger match line for line (trade.test.ts), and what has left the container keeps within an item or two. A delivery into a store above 2m stays a lump (a level like any other). What remains: a line jammed behind the exit still takes a few items offline under its throttled supply (a blocked chain's regime: trade.test.ts allows a few items over four hours).
- **Pseudo inflows are credited before a short level is clamped** (fixed 2026-10-14). An EMPTY key's consumers draw its throttle, its inflow, and that inflow may be a pseudo one (a dig's rubble, a post's spread deliveries) that `advance` credits after the regimes. The level used to be clamped at zero right after the regimes' draw — those items were counted lost — and then the pseudo inflow came in on top: the consumers made them twice. The late base's drifter-fed workshop made half again its output, and the claim earned 70 % more offline than ticking. Now `advance` notes the keys a regime drew below zero and clamps them only once every inflow of the step is in. Over a game hour on the late base, the ocelles offline and online agree within about 1 %.
- **Non-periodic regimes can drift.** The [1200, 4800] window of an `approx` regime may still contain a transient (a long ribbon filling); its average is extrapolated for as long as the conditions hold, possibly the whole absence. Only `mode` reveals it.
- **Cache reuse is not conservative**: the jump to `s1` replaces buffer and ribbon contents (error bounded by the group's internal capacity per re-entry, not counted).
- **Clamps in `advance`**: a level driven below 0 is set to 0 and overflow above the cap is trimmed; both are now counted (`clampedMu`, `lostMu`, every store). With `MIN_STEP = 60` ticks and a 20-item margin they need a net drain above ~200 items/min on one item, but nothing prevents it.
- ~~Jobs were only re-assigned on `jobsDirty` offline~~ — fixed: the catch-up re-assigns at every epoch boundary as online (recompiling when a machine goes busy), and finished research / constructions set `jobsDirty`; guarded by "a dig that research unlocks during an absence starts offline as online" in `space.test.ts`. One tick of difference remains when a research completes in the middle of a tick online.
- `solve.ts` says it is "identical online and offline", but the catch-up has its own solver (`computeNetModes`), on regime averages (its dispatch is online's ceiling of the average need since D114; it was rounded up to 25 ‰, which made a half-called steam boiler burn and drink a few per cent too much).
- A reservoir → reservoir edge (Hive City direct insertion between two stores) belongs to no group and does not flow offline.
- No `epoch` events and no market settlement during a catch-up yet (M6). `storageOk`, `accEmpty`, `accFull`, `orderPaused`, `orderResumed` are declared but never emitted; storage incidents cover only the Hearth; stone, embedded ore and dug tiles are missing from the report (they reach `sim.produced` and `sim.events` only).
- Every recompile re-warms every group (`setup()` resets `warmCount`, so the cache is not used right after): frequent research completions on a large base cost a full warm-up round each.
- `signature` omits reservoir accept sets and capacities and silo locks (routing blocks' mode, chosen item, filters and sides are in it); a cached regime from before a recompile could be reused for a group whose observatory now accepts something else (only after 6 warm-ups).
- `CYCLE_LCM` guarantees short periods only at speed 1000 ‰ and full power; research speed bonuses, the upgraded machines' speeds and low satisfaction can push periods past 4800 ticks (`approx`).
- Period detection trusts a 53-bit state key (collisions improbable, unchecked).
- The plan asks for online ≈ offline on 200 random bases; the suite has 12. Catch-ups are not logged, so a server cannot replay them yet.

## Checklist: making a new mechanic offline-exact

1. **Choose its place.** Inside a group (a flow node, simulated by warm-ups for free) or on a boundary (a process attached to a reservoir store, declared as a pseudo-flow). Never a process that reads a store level from inside a group.
2. **A flow node** must follow the phase contract ([engine.md](engine.md)): start-of-tick reads only; all dynamic state in `hash(h, now)` (relative ticks) and `snapshot`/`restore(s, shift)`; fairness only through `now % n`, folded into `Group.rotL`; every parameter that changes its dynamics in `signature`; cycles dividing `CYCLE_LCM` at full speed; `demand()` a function of hashed state. Check `reg.exact` in a warm-up test.
3. **A process** follows the allowance rule (`el += sat × ticks`, moved = `mulDiv(total, el, dur·1000)`, take `min(due, available)`), keeps a saved and hashed record, and gets:
   - its rate in `labFlows()` (`labOut` for draws, `pIn` for deposits),
   - its completion time in `nextEvent()`,
   - its advance in `advance(dt)` through the same function as online,
   - its completion handling after `advance` (`materializeAll()`, apply, then `markDirty` + `ensureCompiled` + `setup()` if the graph changes),
   - its pause conditions mapped to reservoir states (like `jobSatOff`).
4. **Power**: online reads `ctx.sat`, offline reads `netModes`; both through the same accessor (`projectSat`, `jobSat`). Mind the first pitfall above if its building is a reservoir.
5. **World-clock inputs** (weather, later market events) are functions of the absolute epoch and change only at epoch boundaries, where segments end. A place's input (a turbine's exposure, D95) is a function of the land as the world made it and of the building's own foot, fixed at compile: never of what changes during an absence.
6. **Nothing vanishes**: refund or report (`lostMu`, a new incident kind) instead of clamping.
7. **Report** new outcomes in `AwayReport` as ids and numbers.
8. **Test** with a twin from one save: `a.run(N)` vs `catchUp(b, N, { noDirect: true })`, compare stocks, `hash()` when exact, `produced`/`consumed`; add a week-long run for cost; add the mechanic to the random-bases suite if ordinary bases can contain it (recipe in [testing.md](testing.md)).
