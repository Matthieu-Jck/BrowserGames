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
| [research/runtime.ts](../src/sim/research/runtime.ts), [space.ts](../src/sim/space.ts), [systems/](../src/sim/systems/) | The allowance rules the catch-up reuses: `advanceProject`, `advanceJob`/`jobRate`, `moveFreight`/`routeRateNow` |
| [offline/catchup.test.ts](../src/sim/offline/catchup.test.ts) | Exactness, dry reservoir, conservation, a week, steady periods, 12 random bases |
| [bench/perf.test.ts](../src/sim/bench/perf.test.ts) | A week of the 25 k-entity base |

## The contract

- **Same rules, same functions.** Groups are stepped by `runPhases` exactly as online; research, digs, fills and freight are advanced by the online functions; finishing a project or a job calls the online `finishProjects` / `completeJobs`; each minute boundary calls the online `tradeEpoch` and `landEpoch`.
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
    pseudo-flows (research draws, stone, freight) · throttles again if needed
    t = min(next epoch boundary, next event)          (level events ≥ 60 ticks ahead)
    advance(t): reservoirs += regime flows; jobs, freight, research, accumulators by the online rules
    tiles done │ research done or a science fully paid │ constructions due
        → materialize every group, apply, recompile, setup()
    epoch boundary → trade, the leases' hour (a lapse: materialize, recompile) → new weather → power modes
  materialize every group; sim.tick = end; report
```

## Groups: why cut at reservoirs

`buildGroups` takes the connected components of the flow graph over edges that do not touch a reservoir. Every non-reservoir node belongs to exactly one group; the edges between a group and a reservoir are its boundary (`resIn`, `resOut`). Reservoirs are the Hearth, silos, trade posts and also every store a long process hangs off: observatories, excavators, backfillers, skydocks.

The cut is sound because a reservoir item **between its bounds** behaves the same whatever its level: an unloader offers `min(stock, portRate)` = `portRate` and an inlet accepts `cap − stock`, more than any tick's inflow. So the groups on either side of a reservoir evolve independently, the level is just the running sum of their flows, and each group can be warmed up and extrapolated on its own. Groups still interact in two ways, both handled explicitly: through a reservoir item that reaches a bound (states and throttles) and through a shared power grid (power modes).

A `Group` also carries `nets`, its fuel generators `gens`, its nodes in the tick's accept order `accOrder` (the ribbons downstream first, D57), `rotL` (the lcm of every rotation modulus `n` its nodes and boundaries use in `now % n`, and of its ribbons' and boundary outlets' step patterns `stepPeriod` — they step on the world's clock; a trade post's exit times the length of its `cycle` (D62) —, so the phase of `now` is part of its state) and `sig`, a structural signature (node kinds, entities, grids, power draws, speeds, rates, recipes, tiles, edges, unloader items) used in cache keys.

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

A group only sees EMPTY for items it **pulls** from that reservoir and FULL for items it **pushes** into it (`effState`; pull/push sets come from unloader items, the group's products, and any flow later seen in a regime).

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

## Power during the catch-up

`computeNetModes` solves each grid per segment from the current regimes rather than per tick: demand `dAvg` and `dMax` summed over the groups on the grid plus what its **reservoir buildings** draw (observatories, excavators, backfillers, skydocks, trade posts: `resKw`, fixed between recompiles; they belong to no group), fuel capacity `F` and effective `Feff` (`outKw × fueled ‰`), renewables `R` from this epoch's weather (the same `weatherAt`, `weatherKey` and `renewableKw` as online — the Heart's solar panel included, so the base's own power follows the sun offline too), accumulator energy, capacity and rate. The grids themselves are the wires' components (D25), compiled by the same `compileGraph`; wires change only through commands, so an absence never rewires anything:

| Case | Satisfaction | Dispatch | Accumulators |
|---|---|---|---|
| `R ≥ dMax` | 1000 | 0 | charge at `min(rate, R − dAvg)` until full |
| `R + Feff ≥ dMax` (generators) | 1000 | `(dAvg − R)/F` rounded up to 25 ‰ | — |
| accumulators hold energy | `(R + Feff + discharge)/dAvg`, floored to 25 ‰ | 1000 if it has generators | discharge `min(rate, dAvg − R − Feff)` |
| otherwise | `(R + Feff)/dAvg`, floored to 25 ‰ | 1000 if it has generators | — |

Modes are recomputed for every grid after a `setup()` or when the weather (sun ‰, gust ‰) differs from the last segment's, and otherwise only for grids where a group took a new regime or whose accumulators just filled up or ran dry. A grid whose mode changes marks every group on it dirty (re-warm under the new satisfaction) and logs a `brownout` incident when it drops below 1000. Demand depends on satisfaction and satisfaction on demand, so `settle()` iterates *regimes → power modes → throttles* up to four passes, then finishes the dirty regimes. Accumulator energy is advanced by `accRate × dt`, spread in id order like online. Fuel generators are ordinary flow nodes inside groups: their fuel arrives by ribbon and burns at the fixed dispatch of the warm-up.

## Pseudo-flows: research, jobs and freight

Long processes are not flow nodes: they hang off reservoir stores. `labFlows()` declares each one, every iteration, as a known flow of its reservoir (mu per tick, keyed `ri × N_ITEMS + item`):

| Process | Reservoir | Map | Rate |
|---|---|---|---|
| Research project | its observatory | `labOut`, per science item still owed | `cost × sat / (dur·1000)` while `el < dur·1000` |
| Dig | the excavator's store | `pIn`, stone | `jobRate = mu × sat / (dur·1000)` |
| Fill | the backfiller's store | `labOut`, stone | `jobRate` |
| Drifter route | origin / destination skydock | `labOut` / `pIn`, the route's item | `routeRateNow` (0 while a dock is unpowered) |

Pseudo-flows enter `rateOf` (next events) and the throttle totals, so a store fed by ribbons and drained by research is classified and throttled like any other. The process itself is advanced in `advance(dt)` by the online functions with this segment's satisfaction: `advanceProject(p, store, dt, sat)`, `sim.advanceJobs(dt, …)` (an excavator whose store is FULL gets satisfaction 0, the offline form of "digging pauses at the cap"), `sim.moveFreight(r, dt, …, exactMu = false)`.

**Why the allowance makes this exact.** A project may have paid `⌊cost · el / (dur·1000)⌋` after elapsed powered time `el`, and pays `min(due, store)`. `el` is a plain sum of `sat × ticks`, so when the store never runs short, the amount paid after a segment is the same whether the segment was advanced in one call or tick by tick. Digs and fills use the same rule on stone. The next-event rule keeps every store away from its bounds inside a segment, which is exactly the "store never runs short" condition. Freight is linear in time (rate × ticks) and therefore path-independent too, except that online rounds to whole milli-items.

## Segments and events

A segment ends at the next epoch boundary or the next event, whichever is first (`nextEvent`), and never less than `MIN_STEP = 60` ticks ahead for level-driven events.

| Event | When | What happens |
|---|---|---|
| Epoch boundary | every `EPOCH` ticks | **trade** (`sim.tradeEpoch()`, the same call as online: deliveries, orders, sales, the market's settlement; it moves reservoir levels and ocelles only, so no group is materialized; every (reservoir, item) whose level it moved is re-classified at the next `classify` (`moved`), since a key with no flow is not looked at otherwise — a full Hearth that a stream sells down takes its jammed line again, at the same moment as online; its per-minute `trade` / `delivered` / `gazette` events are dropped and the absence's trade lands in the report: `sold`, `bought`, `earned`, `spent`, `creditsDelta`), then **the leases' hour** (`sim.landEpoch()`, the same call as online, right after the trade: rent paid from the ocelles; when a lease would lapse — `lapsing`, the purse short of a rent due — every group is materialized first, since what stands on that parcel goes dormant and the graph is rebuilt; a `leaseLapsed` incident with its `parcel`; the `land` events are dropped like the trade's), then the new sun step (each epoch) and gust window (every 10) → power modes |
| Reservoir bound | a key's net rate brings its level to m or cap − m (NORMAL), above 2m (EMPTY, rising), below cap − 2m (FULL, falling) | `classify` → new state → throttles, re-warms; `storageFull` / `storageEmpty` incidents for the Hearth |
| Research done | `el` reaches `dur·1000` at the project's satisfaction | `finishProjects` (unlocks, `Mods`), recompile, `setup()`; `researchDone` incident |
| Science fully paid | detected after `advance` | the observatory stops accepting it: recompile, `setup()` |
| Tile dug / filled | a job's `el` reaches `dur·1000` | `completeJobs` (terrain, embedded ore, events), re-assign; recompile only if a pump's water or the set of busy machines changed (their draw) |
| Construction | the earliest pending `builtAt` | `builtAt = 0`, recompile, `setup()`; `built` incident |
| Accumulators full / empty | `(cap − E)/accRate` or `E/−accRate` | the segment ends there and the grid is marked for a new power mode (`netDirty`) |
| Freight | no event of its own | route rates follow dock power each iteration; dock stores have bounds like any reservoir |

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
| Power | one mode per grid and segment from regime averages; dispatch rounded up to 25 ‰ (online: exact ceiling each tick); accumulators charge at `R − dAvg` |
| No period within 4800 ticks | the [1200, 4800] window extrapolated (`mode: 'approx'`) |
| Cache reuse | the group jumps into the cached cycle, in phase, at the point holding its items or the closest one (an averaged regime: to its end); `mode: 'approx'` |
| Event timing | level events at least 60 ticks apart; paid-science and construction changes applied at segment ends |
| Statistics, freight | produced/consumed linearised; freight moved in fractional milli-items |

**The report** (`AwayReport`, ids and numbers only; the UI localises): `fromTick`, `toTick`, `mode` (`direct` / `exact` = every regime periodic / `approx`), `warmups` and `warmTicks` (cost), `produced`, `consumed`, `hearthDelta` per item, `lostMu` (overflow trimmed at a store's cap in `advance`) and `clampedMu` (what a store would have gone below 0 by), the trade of the absence (`sold`, `bought`, `earned`, `spent`, `creditsDelta`), and `incidents` (`storageFull`, `storageEmpty`, `brownout`, `researchDone`, `built`, `leaseLapsed`, with tick and item/entity/ref/parcel). `computeMs` is left for the caller. `lostMu` / `clampedMu` measure the edge error of the approximate cases; the error inside a non-periodic regime is not measured (bounded in practice by the tests below).

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
| "the offline catch-up completes the same research as ticking" ([research.test.ts](../src/sim/research/research.test.ts)) | research fed by ribbon finishes both ways; science consumed within 1 item |
| "digging offline matches ticking" ([space.test.ts](../src/sim/space.test.ts)) | same tiles dug, stone within 1 item |
| "a lease lapses in the catch-up at the same hour as online…" ([land.test.ts](../src/sim/land.test.ts)) | a leased kiln over four hours of rent the purse covers for three: the lease lapses both ways, same ocelles, same `hash()`, a `leaseLapsed` incident |
| perf test ([perf.test.ts](../src/sim/bench/perf.test.ts)) | a week of base20k in < 3 s, every silo full at the end |

The twin pattern used by all of them: build, `serialize`, `deserialize` twice, `a.run(N)` against `catchUp(b, N, { noDirect: true })`, compare.

## Performance

Cost is about *warm-ups × group size × warm ticks* plus *segments × runs*: segments are at least one per epoch (10 080 for a week), and each warm-up costs at most 4800 ticks of one group. It barely grows with the absence once regimes are cached. Last recorded runs (dev machine; the tests print them):

| Base | Week of absence | Warm-ups | Mode |
|---|---|---|---|
| base20k (25 201 entities, 10 081 nodes, 1 681 grids; 0.8 ms per online tick) | 1.5 s | 3 522 | exact |
| `late` debug base (2026-10-13, after D57: its windy grid changes satisfaction every few minutes, ~100 000 regime changes a week; drills on capped deposits have cycles of tens of thousands of ticks, so its big groups never repeat) | 16 s (8 h: 1.3 s) | 167 | approx |

The late base (D66: drifter routes, standing orders, digs) is the case to watch: eight game hours take about 2.5–3.7 s in Node on a loaded machine (2026-10-14, after the clamp and freight fixes below). Its week: most of it is bringing groups to their true state at each regime change (`materialize`, ~10 s), then the cache jumps' search (~3 s). Candidates: a Worker for the boot catch-up (planned in M7), coarser satisfaction steps in the regime keys, or direct ticking of short segments.
| small kiln + coal base (the "week-long absence" test) | 33–206 ms | 9–12 | approx |

The plan's target is < 2 s for 7 days. The shell runs it on the main thread for now: a week of the `late` debug base takes about 0.65 s in Node (0.4 s for `grown`), behind the boot veil. A Worker (serialize, catch up, serialize back) comes when bases grow enough to make a resync visible ([persistence.md](persistence.md)).

## Known gaps / pitfalls

- ~~Reservoir buildings' power draw was ignored offline~~ — fixed (`resKw`); guarded by "reservoir buildings (docks, observatories, excavators) draw power offline too" in `catchup.test.ts`.
- ~~Accumulator events did not refresh power modes~~ — fixed: a grid whose accumulators fill or run dry is re-solved; guarded by "an accumulator that runs dry stops covering the deficit offline too".
- ~~Trade's level changes on keys with no flow were never re-classified~~ — fixed (`moved`): a full Hearth sold down by a stream kept its line jammed for the whole absence, losing about 40 % of that line's output (posts no longer sell the Hearth's stock since D64; `moved` still re-classifies what a boundary's deliveries move).
- **A post's deliveries come in over their epoch offline** (fixed 2026-10-14; it was the known gap "a small store drained by an outlet does not flow offline"). Under 2m (40 items) a key stays EMPTY, and an EMPTY key's throttle is its inflow, while a trade post's deliveries land in a lump at the boundary: offline the exit used to wait for 40 items where online it hands them out at once. Now the catch-up takes a delivery into a store under 2m back out after `tradeEpoch` (`spreadDeliveries`) and lets it in again item by item over the epoch, as a pseudo inflow (`pIn`, like freight): the exit's group is throttled to it and hands the items out as they come. It is whole again by the next boundary (`flushDeliveries`, also before any new graph and at the end), so the trade there sees the container as online: purchases, ocelles and the ledger match line for line (trade.test.ts), and what has left the container keeps within an item or two. A delivery into a store above 2m stays a lump (a level like any other). What remains: a line jammed behind the exit still takes a few items offline under its throttled supply (a blocked chain's regime: trade.test.ts allows a few items over four hours).
- **Pseudo inflows are credited before a short level is clamped** (fixed 2026-10-14). An EMPTY key's consumers draw its throttle, its inflow, and that inflow may be a pseudo one (freight, a dig's rubble, a post's spread deliveries) that `advance` credits after the regimes. The level used to be clamped at zero right after the regimes' draw — those items were counted lost — and then the pseudo inflow came in on top: the consumers made them twice. The late base's drifter-fed workshop made half again its output, and the claim earned 70 % more offline than ticking. Now `advance` notes the keys a regime drew below zero and clamps them only once every inflow of the step is in. Over a game hour on the late base, the ocelles offline and online agree within about 1 %.
- **A freight route carries only what it can** (fixed 2026-10-14). Its pseudo flows used to count at the ships' full rate. They are now capped by an EMPTY source dock's inflow and a FULL destination's outflow (`labFlows`), as `moveFreight` moves no more online (space.test.ts: a slow drill feeding a fast route).
- **Non-periodic regimes can drift.** The [1200, 4800] window of an `approx` regime may still contain a transient (a long ribbon filling); its average is extrapolated for as long as the conditions hold, possibly the whole absence. Only `mode` reveals it.
- **Cache reuse is not conservative**: the jump to `s1` replaces buffer and ribbon contents (error bounded by the group's internal capacity per re-entry, not counted).
- **Clamps in `advance`**: a level driven below 0 is set to 0 and overflow above the cap is trimmed; both are now counted (`clampedMu`, `lostMu`, every store). With `MIN_STEP = 60` ticks and a 20-item margin they need a net drain above ~200 items/min on one item, but nothing prevents it.
- ~~Jobs were only re-assigned on `jobsDirty` offline~~ — fixed: the catch-up re-assigns at every epoch boundary as online (recompiling when a machine goes busy), and finished research / constructions set `jobsDirty`; guarded by "a dig that research unlocks during an absence starts offline as online" in `space.test.ts`. One tick of difference remains when a research completes in the middle of a tick online.
- `solve.ts` says it is "identical online and offline", but the catch-up has its own solver (`computeNetModes`) with stepped dispatch.
- A reservoir → reservoir edge (Hive City direct insertion between two stores) belongs to no group and does not flow offline.
- Freight moves fractional milli-items offline, so dock stocks stop being integers (the hash truncates them).
- No `epoch` events and no market settlement during a catch-up yet (M6). `storageOk`, `accEmpty`, `accFull`, `orderPaused`, `orderResumed` are declared but never emitted; storage incidents cover only the Hearth; stone, embedded ore and dug tiles are missing from the report (they reach `sim.produced` and `sim.events` only).
- Every recompile re-warms every group (`setup()` resets `warmCount`, so the cache is not used right after): frequent research completions on a large base cost a full warm-up round each.
- `signature` omits reservoir accept sets and capacities and silo locks (routing blocks' mode, chosen item, filters and sides are in it); a cached regime from before a recompile could be reused for a group whose observatory now accepts something else (only after 6 warm-ups).
- `CYCLE_LCM` guarantees short periods only at speed 1000 ‰ and full power; research speed bonuses, speed modules and low satisfaction can push periods past 4800 ticks (`approx`).
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
4. **Power**: online reads `ctx.sat`, offline reads `netModes`; both through the same accessor (`projectSat`, `jobSat`, `routeRateNow`). Mind the first pitfall above if its building is a reservoir.
5. **World-clock inputs** (weather, later market events) are functions of the absolute epoch and change only at epoch boundaries, where segments end.
6. **Nothing vanishes**: refund or report (`lostMu`, a new incident kind) instead of clamping.
7. **Report** new outcomes in `AwayReport` as ids and numbers.
8. **Test** with a twin from one save: `a.run(N)` vs `catchUp(b, N, { noDirect: true })`, compare stocks, `hash()` when exact, `produced`/`consumed`; add a week-long run for cost; add the mechanic to the random-bases suite if ordinary bases can contain it (recipe in [testing.md](testing.md)).
