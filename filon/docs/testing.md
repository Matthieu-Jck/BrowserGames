# Testing and verification

Ocelle is checked by strict TypeScript (plus a "purity" project that compiles the engine without the DOM), vitest suites whose titles state invariants, an engine perf test run on its own, and a headless smoke test that plays the real game in the system Chrome through the `window.FL` debug handle and saves screenshots. A milestone is green only when all of them pass and someone has looked at the screenshots.

## Where things are

| What | Where |
|---|---|
| Scripts (`test`, `smoke`, `bench`…) | [package.json](../package.json) |
| Vitest config (`environment: 'node'`, `src/**/*.test.ts`), port 5183 | [vite.config.ts](../vite.config.ts) |
| Unit suites | `src/**/*.test.ts`, next to the code they guard |
| Test colonies | [src/sim/testkit.ts](../src/sim/testkit.ts) |
| Perf test and its colony | [perf.test.ts](../src/sim/bench/perf.test.ts), [base20k.ts](../src/sim/bench/base20k.ts) |
| Determinism guard | `determinism guard` in [serialize.test.ts](../src/sim/serialize.test.ts) |
| Purity guard | [src/sim/tsconfig.json](../src/sim/tsconfig.json) |
| Layering guard | [src/architecture.test.ts](../src/architecture.test.ts) |
| Content invariants | [validate.ts](../src/content/validate.ts), run by [validate.test.ts](../src/content/validate.test.ts) |
| Smoke test → `scripts/smoke-*.png` | [scripts/smoke.mjs](../scripts/smoke.mjs) |
| Art captures → `scripts/shot-*.png` | [scripts/shots.mjs](../scripts/shots.mjs) |
| Debug handle `window.FL` | [src/debug.ts](../src/debug.ts); sim-side helpers in [src/sim/dev.ts](../src/sim/dev.ts) |
| Debug bases (ready-made levels of a base) | [src/sim/scenarios.ts](../src/sim/scenarios.ts) on the layout kit at the end of [dev.ts](../src/sim/dev.ts); the menu page and the swap in [app/debug-bases.ts](../src/app/debug-bases.ts) |
| Dev-server launch configs | [.claude/launch.json](../../.claude/launch.json) at the BrowserGames root |
| Milestones ("done when") and the verification plan | design plan §10–§11, outside the repo: `~/.claude/plans/nous-allons-creer-un-mighty-perlis.md` |

Related: [ARCHITECTURE.md](../ARCHITECTURE.md) · [engine.md](engine.md) · [offline.md](offline.md) · [render.md](render.md) · [input.md](input.md) · [content.md](content.md) · [i18n.md](i18n.md) · [ui.md](ui.md) · [app.md](app.md) · [extending.md](extending.md) · [glossary.md](glossary.md) · [roadmap.md](roadmap.md).

## Commands

Run from `filon/`. There is no CI: everything runs locally.

| Command | Does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (all of `src/`, DOM libs, tests included), then `tsc --noEmit -p src/sim` (purity guard) |
| `npm test` | `vitest run --exclude 'src/sim/bench/**' && vitest run src/sim/bench`: every unit suite, then the perf test alone |
| `npm run build` | both typechecks, then `vite build` → `dist/` (gitignored) |
| `npm run dev` | Vite dev server on http://localhost:5183 |
| `npm run preview` | serves the current `dist/` on :5183 (build first) |
| `npm run smoke` | `node scripts/smoke.mjs` against `URL` (default `http://localhost:5183`); a server must already run |
| `node scripts/shots.mjs` | art-review captures; same server requirement |
| `npm run bench` | `vitest run src/sim/bench`: the perf test alone (the same second half of `npm test`) |

While iterating: `npx vitest run src/sim/offline` (a folder or file), `npx vitest run -t "fork splits"` (by title), `npx vitest` (watch mode), `CATCHUP_REPORT=1 npx vitest run src/sim/offline` (prints each random base and its worst online/offline delta).

## A milestone is green when

Plan §10: each milestone is green before the next one starts. Green means:

- [ ] `npm run typecheck` is clean (both projects).
- [ ] `npm test` passes: the suites **and** the perf test (it only runs if the suites pass). Its log line looks sane.
- [ ] `npm run build` succeeds.
- [ ] `npm run smoke` ends with `SMOKE TEST PASSED.` on the dev server **and** on `npm run preview`: worker URLs and chunking can break in the build alone.
- [ ] The screenshots were opened and looked at: `scripts/smoke-*.png`, plus `node scripts/shots.mjs` when the look changed. Numbers can pass while the picture is wrong (a missing chunk, a tray hiding the scene).
- [ ] Each item of the milestone's "done when" row (plan §10) maps to a test title or a smoke step, or is listed under [Known gaps](#known-gaps).

## Unit tests

- Co-located `*.test.ts`, run by vitest in Node (`environment: 'node'`): no DOM, no Pixi. Only pure modules get unit tests, so keep testable logic in modules that do not import `pixi.js` (as `camera-math.ts`, `iso.ts`, `relief.ts` and `belt-path.ts` do).
- **Titles are invariants.** A failing title names the promise that broke: fix the code, not the title, unless the design changed (then update the plan too).
- Engine units: 10 ticks per second (600 ticks = one minute = one epoch, 36 000 = one hour); quantities in milli-items (`sim.stock[i] / 1000`); rotations 0 N, 1 E, 2 S, 3 W. See [engine.md](engine.md) and [glossary.md](glossary.md).

| Layer | Suite | Invariants it guards |
|---|---|---|
| all of `src/` | [architecture.test.ts](../src/architecture.test.ts) | each layer imports only from the layers below it; nothing imports the shell (`src/app`, `main`, `debug`, `settings`) but the shell; `pixi.js` is only imported under `src/render`; Web Audio is only used under `src/audio` |
| core | [fixed.test.ts](../src/core/fixed.test.ts) | `isqrt` is the exact floor root; `mulDiv` stays exact past 2^53; `ceilDiv` rounds up; `waterfill` hands out all it can, respects caps, stays proportional, and rotates its leftovers so shares even out; `hash32` is pure; the state hasher tells streams apart and is reproducible |
| content | [validate.test.ts](../src/content/validate.test.ts) | `validateContent()` reports nothing (known ids and unlocks, recipe cycles divide 1 200 ticks, ports on the footprint edge, the unlock tree — plans and research — has no loop, every node and every building is reachable, and the tutorial unlocks before it uses; the plans' six paths (D41) in their order, each one line from one entry with no loop, the analytics path telemetry → ledger → power log → diagnostics, each turning on exactly its own flag; D33's start kit is the drill, the ribbon and the pole, and the root plans are affordable together from the starting stock; no dead end, D36: the bootstrap makes plates, glass and copper wire through plans alone, every plan is paid in them, and the starting stock holds the restart reserve, pinned at 59 / 6 / 4, with the first ring bought); every item can be produced from the land; the cirque's tired copper vein cannot feed one mechanics workshop (pinned: 6.75 ore/min vs 18 wire/min), so copper must be imported; an atlas needs two different uniques, a codex five |
| ui | [analytics.test.ts](../src/ui/analytics.test.ts) | D41: each analytics readout turns on with its own plan only, in path order (the telemetry alone gives the rates, not the Statistics); every analytics plan has a reveal (a `[data-hud-…]` hook, a caption in both languages); a reveal plays once per unlock and a colony seen for the first time is a baseline; the Diagnostics count the working buildings by state as the inspector reads them (an unwired drill is « no wire », a smelter without a recipe « no recipe »), worst first; the spotlight never plays by itself under automation, lasts about 2.4 s (reduced motion keeps the reading time), and keeps its hole and caption on screen |
| audio | [theory.test.ts](../src/audio/theory.test.ts) | MIDI ⇄ Hz; four modes on D, one colour apart; degrees wrap by octaves; chords in thirds (Lydian II and Dorian IV major); no diminished chord, home always there; upper structures are chord tones, never a ♭9; voice leading moves little and never stacks a unison or a semitone; the melody ladders have no big gaps; `ladderRung` inverts `ladderMidi` |
| audio | [director.test.ts](../src/audio/director.test.ts) | four parts of the day with their modes; night slower, darker, sparser, lower than day; the mood never jumps; pulses grow with activity and the night halves them; chords change on bar lines (2–8 bars) with their bass; every note is in the mode in force; the melody comes in phrases with rests, fewer at night, mostly by steps, in range; no 12-note stretch of melody ever comes back; a new part opens on its tonic chord; same seed, same score |
| audio | [sequencer.test.ts](../src/audio/sequencer.test.ts) | steps fall exactly on the grid, each once, however irregular the frames; handed out within the look-ahead, never late; a tempo change applies from the next step; after a stall the missed steps are skipped and the bars stay aligned |
| audio | [levels.test.ts](../src/audio/levels.test.ts) | dB ⇄ gain; the squared slider taper; bus gains from the sliders, the veil ducks the ambience only; every cue measured under −6 dBFS at full sliders; specific cues silence the generic ones of their frame, the highest generic one plays alone, ambient cues silence nothing, duplicates merge; the rate limiter; ribbon ticks one per tile, capped, ≥ 30 ms apart |
| audio | [buffers.test.ts](../src/audio/buffers.test.ts) | noises centred (no DC) at peak 0.9; pink noise darker than white and seamless as a loop; the click train sparse; the impulse response stereo, decorrelated, silent before its pre-delay, decaying by > 40 dB; the soft clip transparent below its knee; without Web Audio the `Sound` front door is a no-op that never throws |
| i18n | [i18n.test.ts](../src/i18n/i18n.test.ts) | every English message carries exactly the French placeholders; French never puts a plain space before `: ; ! ?`; placeholders, plurals and numbers are formatted per locale; a missing key renders `⟦key⟧` instead of crashing; the first supported browser language wins (else `en`) |
| input | [belt-path.test.ts](../src/input/belt-path.test.ts) | a click lays one tile in the tool rotation; a straight drag points every tile along the drag; an L goes x-first (y-first once flipped) and turns at the corner; backwards drags work, each tile adjacent to the next |
| input | [link-tool.test.ts](../src/input/link-tool.test.ts) | L takes the Link tool on both layouts; pick a pillar or the Heart, then each click wires or cuts (a drill is no place to start from: `needs_pillar`); clicking the source lets it go, Shift+click starts from another pillar; refusals carry their reason; Esc unwinds the source, then the tool; the preview's ring, targets, wires and start points, cached until something moves |
| render | [camera-math.test.ts](../src/render/camera-math.test.ts) | world → screen → world is the identity; zooming keeps the point under the cursor fixed; zoom is clamped; chunk ranges floor correctly on negative coordinates; the tile under a screen point |
| render | [iso.test.ts](../src/render/iso.test.ts) | tile → iso → tile is the identity; a tile is a 2:1 diamond (+x down-right, +y down-left, z lifts); the tile under the cursor; the ground matrix maps chunk texture corners onto the chunk diamond; the visible chunks include the centre one |
| render | [wire-geom.test.ts](../src/render/world/wire-geom.test.ts) | wire anchors (a pillar under its top, the Heart at its apex, other buildings on their roof, rotated footprints); a wire hangs from anchor to anchor and sags most at mid-span, symmetrically; the sag grows with the span, is capped and never reaches the ground; points along a polyline by length |
| render | [relief.test.ts](../src/render/relief.test.ts) | floor has no level, rock stands on whole terraces from a smoothed height; a lone column is a chamfered block that never leaves its tile; a diagonal staircase becomes one straight wall; terrace slabs nest (no overhangs, 60 random fields); only camera-facing walls are drawn, each ending against air or a neighbour; the chunk paint border reaches every leaning column |
| sim · flow | [flow.test.ts](../src/sim/flow/flow.test.ts) | a drill delivers its capped rate through a ribbon; items are conserved exactly (Δheld = produced − consumed, per item); latency equals ribbon transit; a dead-end ribbon fills, then the drill stops (backpressure); a refused head item blocks a mixed ribbon; no power, no production — not even beside the Heart's masts: a wire fixes it (and a drill just past the starting square is refused); processing nodes in reverse order gives the same hash; same commands, same hash; a fork splits evenly and never starves an unblocked output |
| sim · power | [power.test.ts](../src/sim/power/power.test.ts) | merit order renewables → fuel (load-following) → accumulators, satisfaction in 25 ‰ steps; an accumulator fills from the surplus, never past capacity; accumulators store and return the same energy offline as ticking; a third of the day is night, dawn and dusk ramp, Lens Arrays keep a floor |
| sim · power | [links.test.ts](../src/sim/power/links.test.ts) | the wires (D25): reach edge to edge with squared integers (pole 6, the Heart 8, pylon 24 / 40 with xp4, the longer end decides); who may be wired (`not_linkable`, `needs_pillar`, `self`, `missing`); slots (8 / 4 / 6, `slots`, `slots_other`, `already`); the wire table; an unwired building gets nothing, even beside the Heart; Heart → mast → mast → workshop powers it and taking the middle mast down splits the grid; `link` / `unlink` are logged, refusals are not, replay rebuilds the same wires; a new pillar wires itself to the nearest pillar or Heart with a free slot (ties: lowest id; a full Heart is passed over); a pylon over a pole keeps 4 of its 5 wires, pillars first (and replays); the Heart's solar panel follows the sun (240 kW at noon, 36 at first light, 0 at night; Lens Arrays included); save → load keeps the wires; online ≈ offline on a wired grid over a whole day (sun, wind, a coal generator at night); the demo base is wired whole |
| sim · research | [research.test.ts](../src/sim/research/research.test.ts) | the plan's en7 example is exact (specialist vs generalist cost and time; the trunk escapes the spreading penalty); a project never ends before its minimum duration; it slows when science runs short and resumes as it arrives; it starts only with prerequisites, a free slot and an idle observatory; cancelling refunds the science paid; catch-up completes the same research as ticking, fed by ribbon; reconversion removes the branch, leaves its buildings dormant, returns notes after the wait |
| sim · plans | [research.test.ts](../src/sim/research/research.test.ts) (« plans ») | a plan unlocks at once, paid from the Heart, logged, with a `plan` event; refusals (`unknown`, `prereq`, `done`, `unaffordable`; `reserve` in the next row) pay and log nothing; the telemetry plan brings its flag; research's roots wait for the observatory's plan; unlocks replay to the same hash and survive save → load (D33) |
| sim · reserve | [reserve.test.ts](../src/sim/systems/reserve.test.ts) | CrierBelt's restart reserve (D36; definitions in [engine.md](engine.md#crierbelts-restart-reserve-d36)). A new base holds the bootstrap's cost (59 plates, 6 glass, 4 copper wire); the smelter's plan takes its share with it. A plan that would eat into it is refused (`reserve`: nothing paid, nothing logged), the smelter's plan (wholly in the reserve) never is, and a short Heart still reads `unaffordable` first. Placing and removing never move the verdict, and rewards lift it. **Recoverable means rebuilt**: `rebuild()` takes every building down, then lays the stages as a player would (drills on the nearest whole-deposit spots, the smelter on plates then glass, the copper line, poles by `powerLine`) and must see each essential item made. It runs on the real cirque from exactly the reserve, for 24 players, at noon and at midnight, within the stages' pole counts. **Fuzz**: 24 seeded sequences × 150 random actions on a new player's base (plans, placements, ribbon drags, removals, wires, recipes, a whole smelter line, a trade post against the Heart and its export streams, time), half as a spender (plans and random building) and half as a builder (smelter lines, trade, long waits: production and stream sales are part of the walk); the invariant is checked after every action, `rebuild()` runs from the tightest and the last state, and the log replays to the same hash. It fails if the guard is switched off, if the smelter's plan costs more or the starting stock less than the reserve allows, if a stage lists too few poles, or if the drill starts costing gears |
| sim · logistics | [logistics.test.ts](../src/sim/logistics.test.ts) | Mindustry routing blocks: a router hands to every other side; a sorter sends its item straight and the rest aside (the inverted sorter the opposite); overflow / underflow gates; an unloader pulls the chosen item out of a silo, only while the silo holds it, and nothing out of the Heart (D34); junctions let two lines cross, and a junction set against a router (dragged across its feed line, or on its back, front and sides) passes its lines straight through, online as offline; a bridge leaps its gap |
| sim · ribbons | [ribbons.test.ts](../src/sim/ribbons.test.ts) | Tile by tile (D57): each pace steps perMin times a minute in a short repeating pattern; a full line is packed one item per tile, nothing moves between steps, 60/min; a line cut by a join still moves as one block; the straight line has a contested tile first, the side line its gaps; offline as online (same hash) |
| sim · bridges | [bridges.test.ts](../src/sim/bridges.test.ts) | Bridges at their line's pace (a swift line through a pair carries as much as a plain one, the pair inside the swift chain), offline as online; a bridge entered from behind only (D55) |
| render · items | [cell-flow.test.ts](../src/render/world/cell-flow.test.ts), [belt-lift.test.ts](../src/render/world/belt-lift.test.ts) | Items drawn from the cells at 60 frames a second (no jump, no pop-up but at a source, no loss but into a building; over a junction's hump; through a router); items on rock tops and up / down the traction elevators, the car following them (D56) |
| sim · replace | [replace.test.ts](../src/sim/replace.test.ts) | Placing over things (D24): a router over a ribbon replaces it (refund, one `place`, replay exact); a router set in a jammed line leaves each side the items standing on it; a swift ribbon dragged over a line upgrades it; a distributor over a 2×2 of ribbons; refused across groups, on partial overlap, when identical, never the Hearth; affordability counts the refund; a drag keeps the routers it passes; a drag across a perpendicular line lays a junction and both lines still flow; a re-rotated sorter keeps its item |
| sim · space | [space.test.ts](../src/sim/space.test.ts) | a dug tile yields its stone once, gives up its ore, then is buildable floor; hard rock waits for its research; land rules per building kind: production stands on the claim's land, infrastructure may leave it (the basic ribbon free everywhere, a paid tier ×3 off the claim's land); drifter throughput is C / (2d/v + 2t) per ship, in the formula and in the engine; a backfiller turns a pond tile into floor for 40 stone; crossings let two lines pass, skybridges leap rock; the Hearth levels up and land comes cheaper (`hearthDiscount`); a speed module speeds a machine up and draws more power; digging offline matches ticking |
| sim · land | [land.test.ts](../src/sim/land.test.ts) | Land in parcels (D60, [land.md](land.md)): the world cut in squares centred on the Heart, the starting square holding the Crown (5×5 parcels on the template); a parcel priced by what it holds (a deposit dearer), then the growth per parcel bought and a sister claim's markup; buying (a kiln may then stand there; a parcel held is not sold twice; the purse must pay); leasing after the Land Registry, the rent taken each hour and a lease the purse cannot pay lapsing, its kiln dormant and still there, awake again once bought; a lapse in the catch-up at the same hour as online (same ocelles, same hash, a `leaseLapsed` incident); a sister claim's parcel takes nothing, not even a pole (`sister_land`), until bought; buy, lease and end-lease replay to the same hash; save → load keeps the land, and a v2 save migrated by `zonesToParcels` is granted the parcels its buildings stand on |
| sim · mountains | [mountains.test.ts](../src/sim/mountains.test.ts) | D44 on the land of D60: a turbine, a pole, a pylon or a beacon stands on rock, never astride a cliff, a drill never; past the starting square poles and beacons still go up but a turbine waits for its parcel to be bought; the Sough gives a turbine on the Crown several times the floor's wind, more on harder rock; rock under a building is never marked for digging |
| sim · world | [mapgen.test.ts](../src/sim/world/mapgen.test.ts) | generation is deterministic; over 16 player seeds every colony lands in the same cirque (Hearth spot, deposits, lake, the Crown closed all round); the cirque floor differs < 3 % between players; the tutorial's distances hold on every land (iron within the Heart's wires, coal and copper a pole away, each with a whole drill spot within r 18, well inside the starting square); a T3 unique biome at r 180–280 and a T4 at r 340–460, with their resource; a full-rate copper field in the near belt; lagoons are wetter than mesas |
| sim · offline | [catchup.test.ts](../src/sim/offline/catchup.test.ts) | a single steady regime is reproduced bit-exactly (1 h); catch-up matches ticking when a reservoir runs dry mid-absence (`storageEmpty` reported); items are conserved through the catch-up; a week of a small base computes in < 4 s (`storageFull` reported); steady layouts lock into an exact period ≤ 2 400 ticks, jams included; **online ≈ offline on 12 random bases** (±2 items or 0.5 % of the item's flow) |
| sim · save | [serialize.test.ts](../src/sim/serialize.test.ts) | `load(save(sim))` keeps the state hash; a loaded colony continues exactly like the original; plus the determinism guard below |
| sim · commands | [commands.test.ts](../src/sim/commands.test.ts) | replaying a colony's command log on a fresh colony with the same seeds reproduces its state hash (demo base, recipe change, marks, a removal, a grant); `exec` refuses what the colony refuses (a plan before its prerequisite, a research id as a plan…) and logs only what it accepts |
| sim · debug bases | [scenarios.test.ts](../src/sim/scenarios.test.ts) | a level is founded at sunrise (its build runs in full sun); the tutorial and late bases pay their way on lands 1–3 (a line feeds the trade post's one entrance, its one standing order's plates leave by its one exit (D62), the grid at ≥ 90 % all day, ocelles earned); on the real map of players 1–3, every level builds in under 3 s (`SCENARIO_REPORT=1` logs the times): the expected quest is current, the expected roles stand (positions never pinned: they come from the map), the tutorial levels complete every quest on their own (nothing forced) with nothing skipped and nothing granted, the tutorial factory makes plates, glass, survey data and copper wire with Mechanics under way, the grown base has every plan and learns tr1, en1 and dn1 for real, the late base has its deep research granted (tr2, tr4, tr6 among it), the Heart at level 4 and its outer works on every land (a second trade post, a second gear workshop, a speed-module workshop; Mechanics Data for a second observatory where water past the Crown gives the ceramic), and over a game day makes circuits, speed modules and gears where the plain has copper (D61); the same level on the same land builds the same hash, and its log replays to it |
| sim · quests | [quests.test.ts](../src/sim/systems/quests.test.ts) | the quest table holds together and checks fall on every epoch boundary; a scripted base — a new player's, plans locked — completes quests 0–11 in order with real commands, unlocking each plan in the tree first and feeding every machine by its own lines (the Heart gives nothing, D34), the guide's step checked after every action, each once, each paid once; a machine is `feeds`-fed only by a production line (a router splits a line between the Heart and it); the `unlocked` objective counts plans and research; each reward lands in the Hearth exactly once; naming completes quest 0 at once (trimmed, bounded names); rates over whole game minutes; replay reproduces quests, rewards and the hash (forced completions too); save → load mid-window keeps the hash; a quest met during an absence completes right after the catch-up (and at the next check); a rate held through an absence completes at the first boundary after it; fees are waived while the reward lasts |

### Perf test

[perf.test.ts](../src/sim/bench/perf.test.ts) builds `buildBench()` from [base20k.ts](../src/sim/bench/base20k.ts): 1 680 cells of copper drill → ribbon → wire mill → ribbon → silo, each with a pole, two wind turbines and six idle ribbons, about 25 000 entities inserted directly (no land or cost checks; the parcels they cover granted, so none stands dormant) so it measures the engine, not the rules.

| Measure | Budget asserted | Plan §10 (M1) target |
|---|---|---|
| mean tick over 300 ticks, after a 60-tick JIT warm-up | < 3 ms | < 2 ms |
| a week of catch-up (`catchUp(sim, 7 × 24 × 36 000, { noDirect: true })`) after one hour online | < 3 s | < 2 s |
| correctness | every silo ends the week full (> 99 % of 1 000 wire) | |

It logs one line (entities, nodes, grids, compile ms, tick ms, catch-up ms, warm-ups, mode): read it, the trend matters as much as the pass. Timeout 120 s.

**Why it runs separately.** Vitest runs test files in parallel workers, and wall-clock budgets flake when other suites compete for the CPU. So `npm test` first runs everything except `src/sim/bench/**`, then runs `src/sim/bench` alone, and only if the first run passed (`&&`). Put new timing budgets in `src/sim/bench/`. The one exception today is the `< 4 s` week catch-up in `catchup.test.ts`, which runs in the parallel phase.

### Determinism guard

The `determinism guard` tests in [serialize.test.ts](../src/sim/serialize.test.ts) scan the source of `src/sim/**`, `src/content/**` and `src/core/{hash,fixed,noise,rng}.ts` (the core files the engine imports; skipping `*.test.ts`, `*.bench.ts`, `testkit.ts`), and list every `file:line: code` that uses the items below. A second test scans `src/market/**`, where floats and `Math.exp`/`log`/`pow` are allowed, for randomness and clocks only.

- `Math.random`, `Date.now`, `performance.now`, `new Date(`;
- transcendental Math: `sin cos tan exp log log2 log10 pow atan atan2 asin acos hypot sqrt cbrt sinh cosh tanh`;
- `**` with a non-literal exponent (`x ** 0.5`, `a ** b`). `x ** 2` is fine.

Lines starting with `//`, `/*` or `*`, and trailing `//` comments, are ignored. **Why:** the same engine must give bit-identical results online, offline and, later, on a server replaying the command log. Time and randomness come from the shell (`foundingEpoch`, seeded `@/core/rng`). Fix offenders with `isqrt`, squared distances and integer permille maths (`mulDiv`, `ceilDiv`). It is a text scan of fixed roots: the sim imports only `@/content/*` and those four core files today. A new import from elsewhere in `src/core` must be added to `roots`. `src/content` is not scanned.

### Purity guard

[src/sim/tsconfig.json](../src/sim/tsconfig.json) compiles `src/sim/**`, `src/market/**` and `src/content/**` with `lib: ["ES2022"]` and `types: []`: no DOM, no Node, no Vite types. Tests, `*.bench.ts` and `*.worker.ts` (they need `self`) are excluded. Every module these files import is checked under the same rules, so reaching `window`, `document`, `localStorage` or `@/core/dom` from the engine fails `npm run typecheck` and `npm run build`. **Why:** the engine, market and content must run in a Worker today and on a Node server later. DOM code belongs in `src/render`, `src/ui`, `src/input` or the shell (`src/app`, `main.ts`, `debug.ts`).

### Layering guard

[architecture.test.ts](../src/architecture.test.ts) parses the `import`/`export … from` lines of every non-test file under `src/` and fails on an edge the layer table does not allow (type-only imports get a few extra edges; the DOM UI may reach only render's art kit and pure geometry). The table and the reasons live in [ARCHITECTURE.md](../ARCHITECTURE.md) §1: when it fires, move the shared piece down a layer rather than widening the table. A new top-level folder under `src/` fails it until it is added to `ALLOWED`.

### Test colonies: the testkit

| Helper ([testkit.ts](../src/sim/testkit.ts)) | Gives |
|---|---|
| `testSim(extra?)` | a fresh colony on a flat world, seeds 7/11, founded at noon of world day 0 (`WORLD_EPOCH0 + 24`, full sun), Hearth at (512, 512) |
| `testSource(extra?)` | that flat world (`FlatSource`) alone: iron north (508, 498), sand east (522, 506), coal west (498, 506), copper south (508, 522) — all within the Heart's 8-tile wire reach — and a 3×3 vent `TEST_VENT` at (521, 517). Pass it to `deserialize(save, testSource())`. `extra` adds deposits `{ x, y, w, h, item, rich }` (`rich` 500 = 5/min/tile) |
| `line(x, y, rot, n)` | a straight ribbon path of n tiles for `sim.placeBelts` |
| `wire(sim, ids, from = Hearth)` | power wires (D25) through the `link` command, from the Hearth or a pillar; throws with the refusal. **Every powered building a test expects to run needs one**: nothing is powered by proximity |
| `drillToHearth(sim)` | a drill on iron at (511, 502) facing south, wired to the Hearth, and 7 ribbons into the Hearth's north input; returns the drill id, throws if anything fails |
| `steadyPower(sim)` | a geothermal plant on `TEST_VENT` wired to the Hearth (en5 granted outside commands, so not for replayed colonies): a constant 1.5 MW. The Heart's own panel follows the sun (240 kW at noon, nothing at night, and test colonies are founded at noon: the sun sets after 5 400 ticks), so tests that need a regime that never changes — bit-exact catch-ups — use it |
| `IRON()` `SAND()` `COAL()` `COPPER()` | item indices (call them) |

Local builders worth copying, or promoting to the testkit once a second suite needs them: `kilnLine`, `peatDrill`, `chimeMill`, `sandEast` and `twin(build)` in `catchup.test.ts`; `spaceSim(done)` (pushes rock and pond rectangles into the flat source) in `space.test.ts`; `landSim()` (ocelles to spend and the Land Registry) in `land.test.ts`; `gourdSim()` in `power.test.ts`; `labSim(journals)` in `research.test.ts`. `testSim()` learns every plan (pass `{ plans: false }` for a new player's base); tests unlock research with `sim.done.add(id)` then `sim.rebuildDerived()`, and give materials with `sim.grant(item, n)`. For the real generated cirque (as `commands.test.ts` does), found the colony on `new MapGen(WORLD_SEED, 1)`.

## Smoke test (`scripts/smoke.mjs`)

### How it runs

- **It does not start a server.** It opens `URL` (default `http://localhost:5183`). Start `npm run dev`, or `npm run build && npm run preview`, or a launch config, first. With nothing listening, `page.goto` throws before the harness prints anything.
- `playwright-core` (it ships no browser) drives the system Chrome (`CHROME` env var, default the macOS path `/Applications/Google Chrome.app/…`), headless, with `--use-angle=metal --enable-unsafe-swiftshader --ignore-gpu-blocklist` so WebGL works; viewport 1440×900; browser language `SMOKE_LOCALE` (default `fr-FR`).
- **Failure** = a step that throws, a `console.error`, an uncaught page error, or a non-2xx HTTP response (favicon excepted). Errors mentioning `favicon` or `Autoplay` are dropped. The run always goes to the end, then prints `ERRORS:` and exits 1, or prints `SMOKE TEST PASSED.` and exits 0.
- **Harness:** `step(name, fn)` prints `✓ name` or `✗ name: message`; `assert(cond, msg)` throws; `FL(fn, arg)` is `page.evaluate`. The function runs in the page, so data goes through `arg` (closures do not cross). Indented lines (`    fps=…`, `    produced: …`) are measurements worth reading.
- **Steps share one page and one colony, in order.** Later steps rely on earlier ones (the demo base from step 8, the observatory fed in step 14). Fix the first ✗ first: the next ones may be its echo.

| # | Ms | Step | Proves |
|---|---|---|---|
| 1 | M0 | boots | `window.FL` exists, `body[data-ready]` is set, the boot veil `[data-screen="boot"]` is gone |
| 2 | M0 | renderer | `FL.perf().renderer === 'webgl'` |
| 3 | M0 | worker | `FL.echo('ping')` returns `{ echo: 'ping', from: 'worker' }`, the classic break in a production build |
| 4 | M0 | i18n | the locale follows the browser, and `setLocale` switches `hud.power` live (en, then back to fr) |
| 5 | M0 | stress | 20 000 orbiting particles stay > 30 fps → `smoke-m0.png` |
| 6 | M2 | relief LOD | Crown relief: > 100 relief sprites up close (zoom 0.8), none from afar (zoom 0.2) |
| 7 | M2 | chunk sweep | four pan/zoom stops, each settles to `chunksMissing === 0` |
| 8 | M3 | build button | `.hud-build` morphs to the plan view with a category open; `B` returns to iso |
| 9 | M3 | drill | tray tab + slot clicks; hovering shows the build tip; a real click places a drill on a deposit |
| 10 | M3 | ribbon L | a mouse drag lays an L of 7 ribbons; `X` and a box drag remove them; the plates are refunded (±1) |
| 11 | M3 | land refusal | a kiln clicked just past the starting square (40 tiles out on the default land) is refused, with a toast naming the claim's land (« Hors de vos terres »), and nothing is placed |
| 12 | M3 | inspector | in iso, a click on the Hearth dome opens the inspector titled Foyer/Hearth |
| 13 | M3 | production | after `FL.tick(3000)` the demo has made > 20 ore and > 5 plates, and items are drawn on ribbons → `smoke-m3.png` |
| 14 | M4 | research | `T` opens the screen, tr1 (Mechanics) starts from its card, the HUD chip counts down, a toast lands when it is learnt → `smoke-m4.png` |
| 15 | M4 | stats | `G` opens the stats screen and it lists rows |
| 16 | M5 | dig | brush (`C`) a 5×5 box over soft rock near a powered excavator: ≥ 6 tiles marked, ≥ 6 dug and ≥ 60 stone in 40 game minutes → `smoke-m5-dig.png` |
| 17 | M5 | drifters | two skydocks on the claim's land, two drifters and a route deliver > 10 plates in 3 game minutes → `smoke-m5-route.png` (no waystation: retired with the zones, D60) |
| 18 | M3 | 10 000 items | a 50×60 ribbon serpentine packed with ≥ 10 000 items stays > 30 fps → `smoke-items.png` |
| 19 | D60 | land mode | `I` opens the land mode over the plan view; a mouse click picks a parcel for sale, the land panel shows it → `smoke-land.png`; its « Acheter » button buys it (`sim.land.bought` grows, a toast lands); two Esc return to iso |
| 20 | M6 | shortage | 45 game minutes in, the Gazette lists Port-Écume's glass shortage and the bid is up; a glass stream on the demo's post (against the Heart) pays > 100 ◉ in a minute; `M` opens the Crier → `smoke-m6-crier.png` |
| 21 | M6 · D62 | import by the exit | the 5 × 5 post refuses an item on its exit (`setPortItem(post, 1, …)` → false: its one exit hands out everything it bought, in turn); `FL.connect` lays a ribbon from that exit into the Heart; a copper ore order delivers ≥ 10 ore with a « Livraison » toast; selected, the inspector shows no outlet picker (`[data-outlet]`), the entrance with the glass it sells, the exit linked (`[data-gate-linked]`) with the ore → `smoke-m6-post.png` (the post's art up close, a cargo drone on its deck) |

### Driving the game

- **Set up with FL, act with the real UI** when the milestone is about the UI: selectors (`.hud-build`, `.bb-tab[data-cat=…]`, `.bb-slot[data-def=…]`, `[data-screen="research"][data-open]`, `.rs-card[data-id=…]`, `.hud-rs[data-id=…]`, `.inspector`, `.toast`, `#tooltip`), keys (`b`, `x`, `c`, `t`, `g`, `Escape`; see [input.md](input.md)) and the mouse. Setup with no FL helper yet goes through `FL.app.sim` (steps 9, 16, 17).
- **Mouse on tiles:** `tileXY(tx, ty)` calls `FL.tileToScreen`, the CSS px of a tile's centre in the current view, then `page.mouse.move/down/up/click`. The projection morphs between iso and plan, so wait for `settleView('plan' | 'iso')` (mode set, morph `t` at 1 or 0) before converting. After `FL.lookAt` the script waits ~300 ms for the hover state. In iso, tall sprites stand above their footprint: step 12 clicks 40 px above the Hearth's centre.
- **The main menu stays out of the way:** under playwright `navigator.webdriver` is true, so the menu does not open at boot and Esc never opens it (also with `?nomenu`; `?menu` forces it). Open it with `FL.menu(true)` or the HUD's `.hud-menu` button. The intro ([D31](decisions.md)) does not play either (nor with `?nomenu` or `?demo`), so the base keeps its Heart in view and its claim unnamed; `FL.intro(true)` opens it for a test.
- **Wait on game state, not on time:** `page.waitForFunction(() => window.FL.perf().chunksMissing === 0, …)`, `page.waitForSelector('[data-screen="stats"][data-open]')`. Fixed `waitForTimeout` is kept for fps windows (2.5 s) and hover.
- **Advance the sim with `FL.tick(n)`** (synchronous; 600 ticks = one game minute), then assert on `FL.produced`, `FL.stocks`, `FL.research`, `FL.entityAt`.
- **Screenshots:** `page.screenshot({ path: shot('smoke-<name>.png') })`; `shot()` resolves next to the script, so any working directory works. `scripts/*.png` is gitignored.
- **No server:** the script first `fetch`es `URL` and exits with code 2 and a one-line hint if nothing answers.

### Dev server or preview build

| Target | How | Catches |
|---|---|---|
| dev | `npm run dev`, then `npm run smoke` | logic and UI regressions; fastest loop |
| build | `npm run build && npm run preview`, then `npm run smoke` | bundling: worker URLs, the separate `pixi` chunk, `base: './'` paths, minification |
| any URL | `URL=http://host:port npm run smoke` | another served copy. A query such as `?seed=2` picks the land, but the steps were tuned on the default seed |

Both servers bind 5183 with `strictPort`, so stop one before starting the other, and remember that `preview` serves whatever `dist/` holds. `SMOKE_LOCALE=en-US npm run smoke` changes the browser language, and the text assertions accept both languages, but see [Known gaps](#known-gaps).

## Art captures (`scripts/shots.mjs`)

`node scripts/shots.mjs` (server running) writes `scripts/shot-*.png` for reviewing the art direction (the plan's M2 gate, and whenever the look changes). Same Chrome setup with `deviceScaleFactor: 1`; env `URL`, `SEED` (default 1, sent as `?seed=`), `SHOT_LOCALE` (default `fr-FR`). There is no pass/fail: page errors are only printed. `settle(ms)` waits 400 ms, then for `chunksMissing === 0` (at most 20 s), then `ms` more (default 2.5 s).

| Capture | Scene |
|---|---|
| `shot-base.png` | the demo base (`FL.demo()`), iso, zoom 1.1 |
| `shot-hero.png` | the base under the Crown, zoom 0.55 |
| `shot-cirque.png` | the cirque from afar, zoom 0.32 |
| `shot-crown.png` | a Crown close-up, zoom 0.8 |
| `shot-morph.png` | 250 ms after opening Extraction: the iso → plan morph mid-way |
| `shot-plan.png` | plan view, a drill in hand over a free deposit spot (ghost and tip) |
| `shot-inspect.png` | iso, the inspector open on the demo kiln (tile 520, 516) |
| `shot-research.png` | research screen: tr1, tr2, en1–en3, dn1 learnt, ex1 running, en4 selected |
| `shot-stats.png` | the stats screen |
| `shot-artboard.png` | the artboard (`FL.open('artboard')`), full page |

**To add one**, insert a block **before** the artboard capture: that block moves the artboard out of `#screens` and hides `#stage`, `#ui` and `#screens`, so nothing renders after it. Position with `FL.lookAt` or UI actions, `await settle()`, then `page.screenshot({ path: 'scripts/shot-<name>.png' })` and `console.log('✓ shot-<name>.png')`. Other `shot-*.png` files in `scripts/` (for example `shot-m5-*.png`) come from one-off scripts and may be stale.

## The debug handle `window.FL`

[src/debug.ts](../src/debug.ts) installs `window.FL` as the last step of boot. It is deterministic: only `fps` and `perf` depend on wall-clock time. Return values cross `page.evaluate`, so they are plain data. `FL.app` is the escape hatch to the live app; `FL.app.sim` is the colony; `FL.app.sound.describe()` reports the sound (state, cues played, the score's part and chord: [audio.md](audio.md)).

| Group | Method | Does |
|---|---|---|
| boot, perf | `ready()` | always `true`: `FL` exists only once boot has finished |
| | `fps()` · `perf()` | frames per second · a copy of the perf stats: `fps frameMs maxFrameMs tickMs renderMs drawCalls renderer`, plus `atlasMs sprites chunks chunksMissing vramMB reliefSprites reliefBaked items lights` |
| | `echo(msg)` | a round trip through the module worker (rejects after 4 s) |
| camera, view | `camera(tx?, ty?, zoom?)` | the camera centre in tiles and the zoom; with arguments it jumps there (no glide) |
| | `lookAt(tx, ty, zoom?)` | jumps to a tile's centre |
| | `view(mode?)` | `{ mode: 'iso' \| 'plan', t }` with `t` the morph (0 iso … 1 plan, 0.5 s); with a mode it starts the morph but opens no category |
| | `tileToScreen(tx, ty)` | CSS px of a tile's centre in the current view: feed it to `page.mouse` |
| tools, picking | `category(cat?)` | opens a build category (plan view); `null` stops building (iso); returns the open one |
| | `tool(def?)` | takes a building in hand (a toast refuses a locked one); `'demolish'` and `'mark'` (the brush) toggle those tools, `'link'` the Link tool; `null` drops the tool (and the Link tool); returns `{ k, def }` or `null` |
| | `selected(id?)` | the inspected entity (0 = none); with an id, selects it |
| | `entityAt(x, y)` | `{ id, def, x, y, rot }` or `null` |
| | `freeSpot(def, x, y, r = 12, rot = 0)` | the nearest placeable tile in growing rings, or `null` |
| | `toasts()` | the visible toasts' text, newest last |
| sim control | `pause()` · `resume()` | stops / restarts the real-time loop (`tick` still works) |
| | `tick(n = 1)` | runs n ticks synchronously |
| | `place(def, x, y, rot = 0, recipe?)` | a real placement (land, terrain, cost checked, paid from the Hearth), optional recipe → `{ ok, reason, id? }` |
| | `stocks()` · `produced(item)` | Hearth stock in items (non-zero only) · cumulative production of an item |
| | `itemsOnRibbons()` | items currently drawn on ribbons (render side) |
| | `hash()` | the engine state hash |
| content helpers | `itemIndex(id)` | the index of an item id |
| | `demo()` | grants materials and lays the demo base (drills, kiln line, workshop, observatory, silo, trade post, wind, a coal generator fed by its own coal drill, every powered building wired through lines of masts) → ids by name |
| | `powerTo(id)` | wires an entity into the Heart's grid: a wire from a pillar in reach, else a line of poles on free floor, each wired to the last → masts placed (real, paid placements and `link` commands) |
| | `link(a, b)` / `unlink(a, b)` | the wire commands → `{ ok, reason }` / `boolean` (D25) |
| | `links(id)` | the ids an entity is wired to |
| | `grid(id)` | `{ net, sat, supply, demand }`: its grid (-1: none) and that grid's last tick |
| | `linking(source?)` | the Link tool: an id starts it from that pillar (0: none chosen), `null` puts it away → `{ active, source, hover, verdict }` |
| | `wires()` | wires drawn by the wires view |
| | `archetype()` | `archetype/secondary` of the land |
| research | `research(id?)` | with an id, starts it; returns `{ ok, reason, projects: [{ id, permille }], done }`, or `{ ok: false, reason }` on refusal |
| sandbox, perf rigs | `stress({ items })` | n particles orbiting the Hearth (the M0 ParticleContainer spike); `0` removes them |
| | `feedLab(item, n)` | drops n items straight into the first built observatory's store |
| | `ribbonField(x, y, rows, cols)` | lifts the fog, grants plates, lays a ribbon serpentine and finishes remote construction at once → tiles laid |
| | `fillRibbons(item)` | packs every ribbon to capacity, ignoring conservation → items added |
| screens | `open(s)` · `close()` · `screen()` | opens `'research'`, `'stats'` or `'artboard'` (built on first use; opening the open one keeps it); any other id just closes the open screen until its screen exists · closes the open screen · the open one or `null` |
| main menu | `menu(open?, page?)` | is the main menu open; `true` opens it (on `'settings'` or `'about'` when given), `false` closes it. Under automation the menu never opens by itself ([app.md](app.md), boot), so a test opens it with `FL.menu(true)` |
| day / night | `dayPhase(at?)` | the moment the look shows: `{ hour, sun, night, tempC, shifted }`; with an hour (0–24) or `'dawn'` · `'noon'` · `'dusk'` · `'night'`, shifts the clock the look and the HUD read (never the sim: power keeps the world clock), and time flows on from there; `null` returns to the world clock ([render.md](render.md), *Day and night*) |
| i18n | `locale()` · `setLocale(l)` · `t(key, params?)` | the language · switches it live · translates (`⟦key⟧` when missing) |
| tutorial | `quests()` · `completeQuest(id)` · `nameColony(name)` · `nameModal(open?)` | the current quest, its progress, what is done, titles, waived fees and where the guide points (`{ quest, step, at }`) · forces every quest up to `id` (logged `quest` commands, rewards paid) · names the claim (quest 0) · the naming modal open or not ([quests.md](quests.md)) |
| debug bases | `debugSaves()` · `debugSave(id \| null)` | the levels (`claim smelter survey tutorial grown late`), the one in play (`null`: the player's base) and `realHash` — the player's base's hash wherever it is (in play or kept aside: it must not move while a debug base is in) · builds a level on the player's land and plays it, the player's base kept aside → `{ ok, level, ms, ticks, forced, skipped, granted, quest, hash }`; `null` brings the player's base back → `{ ok, hash }`. `null` / `{ ok: false }` when the page is off (preview build without `?debug`) ([app.md](app.md), *Debug bases*) |
| intro | `intro(open?, at?)` | `{ open, panel, landing, t, heartHidden }`: the beat on screen (`city`, `investor`, `crierbelt`, `name`, `landing`), the landing running and its clock (s), the Heart still hidden; `true` opens it (at `'story'`, the register `'name'`, or straight at the `'landing'`), `false` closes it (the Heart shown, a signed name registered). `FL.app.landing.seek(t, true)` jumps the landing to a time and holds it there, for screenshots ([app.md](app.md)) |
| spotlight | `focusReveal(id?)` | `{ open, id, phase, queued }`: the reveal on screen (D41, [ui.md](ui.md#the-spotlight-d41)); with an analytics plan's id plays its reveal now — under automation reveals never play by themselves, so this is the only way to see one (`played: false` for an id with no reveal); `null` skips it. Wait for `[data-screen="focus"][data-phase="hold"]` before a shot |

### The sandbox rule

**Sandbox helpers must never pollute a real colony.** `feedLab`, `ribbonField`, `fillRibbons`, `stress`, `demo` (free materials) and any direct write through `FL.app.sim` (`sim.done.add`, `sim.stores.get(id)[i] = …`, `builtAt = 0`) are cheats. Writes outside the Sim commands are not in `sim.log`, may break item conservation, and make the colony impossible to replay (see the header of [commands.ts](../src/sim/commands.ts)). `place`, `powerTo`, `research(id)` and `tick` act like a player.

- A base persists (M7, [persistence.md](persistence.md)). Under automation (`navigator.webdriver`) or with `?sandbox`, the saves go to the database `ocelle-sandbox`, never to the player's `ocelle`. A playwright context also starts with empty storage. So the smoke's cheats stay in the sandbox.
- **A reload opens the same base** (the smoke's quests step used to reload for a fresh one): to start from bare land, use `FL.wipe()` (start over: a `pre-wipe` copy, then a reload). `?paused` opens the base paused, so a hash read after a reload is the base as loaded. The clock is manual under automation (no resync); `FL.clock('live')` turns it on.
- In the player's own browser (no sandbox), cheats now stay in the base. Prefer the debug bases there.
- **Debug bases** are the ready-made sandbox: `FL.debugSave(id)` swaps in a scripted base and keeps the player's aside, untouched; `FL.debugSave(null)` brings it back as it was ([app.md](app.md), *Debug bases*). Only the late level writes outside the commands (its research, listed in `granted`).
- A new helper that writes state outside a command says so in its JSDoc (`Sandbox:` / `Perf rig:`) and goes behind the same gate.

## Dev environment

- **Port 5183, `strictPort`**, for both `vite` and `vite preview`: a busy port makes the server fail instead of moving, so scripts never hit another port by accident. Only one of dev and preview can run at a time.
- **[.claude/launch.json](../../.claude/launch.json)** (BrowserGames root) has two entries for the preview tool: `filon` runs `npm --prefix filon run dev`, `filon-preview` runs `npm --prefix filon run preview`, both on port 5183.
- **In-app browser pitfall.** The Claude desktop Browser pane is usually a hidden tab, and browsers pause `requestAnimationFrame` in hidden tabs. Ocelle runs on one rAF loop (`main.ts`), so the sim, camera easing, view morph, terrain painting and fps all stop, and any wait on `view().t` or `chunksMissing` hangs. Use the pane to look; test interactions with the headless smoke or a one-off playwright script.
- **One-off playwright scripts** go in `filon/scripts/`: a bare `import 'playwright-core'` resolves from the script's own folder, so a script in `/tmp` or a scratchpad cannot find it. Copy the launch block (Chrome path and flags) and the `shot()` helper from `smoke.mjs`.
- A fatal boot error is shown in `#err` ([index.html](../index.html)) and also reaches the console, where the smoke counts it.

## Recipes

### Add a unit test for a new mechanic (sim)

1. Extend the domain's suite (`space.test.ts`, `research.test.ts`…) or create `<mechanic>.test.ts` next to the module it tests; vitest picks up `src/**/*.test.ts`. Where the rule itself goes (a system in `src/sim/systems/` behind a `Sim` facade method) is in [ARCHITECTURE.md](../ARCHITECTURE.md) §4 and [extending.md](extending.md).
2. Build with `testSim()`. Add deposits with `testSim([{ x, y, w, h, item, rich }])`, or terrain the way `spaceSim` does; unlock research with `sim.done.add(id)` + `sim.rebuildDerived()`; give materials with `sim.grant`.
3. Act through Sim commands (`place`, `placeBelts`, `setRecipe`, `setPortItem`, `designate`, `startResearch`…): the calls a player, and a replayed log, make. A new player action gets a `Command` variant, an `exec` case and a log entry, and joins the replay test in `commands.test.ts`.
4. Title = invariant ("a backfiller fills a pond tile with 40 stone: new floor"). Assert exact integers where the engine is exact (milli-items, ticks), and derive expectations from the design formula, not from a previous run.
5. Cover what the mechanic touches:
   - moves items → conservation: `totalHeld(i)` before and after equals produced − consumed (pattern in `flow.test.ts`);
   - new state → add it to `Sim.hash()` and to `serialize`/`deserialize`, then extend `serialize.test.ts`. The save round trip compares hashes, so state the hash ignores goes untested;
   - new content rules → `validate.ts`;
   - offline behaviour → next recipe.
6. Iterate with `npx vitest run src/sim/<path>`; finish with `npm test` and `npm run typecheck`. The determinism guard rejects randomness, clocks and transcendental Math in the new code.

### Add an online ≈ offline check for a new mechanic

The catch-up must land where ticking lands (plan §12, risk 1). How to make the mechanic offline-exact in the first place: [offline.md](offline.md), "Making a new mechanic offline-exact".

1. Make two identical colonies: `twin(build)` from `catchup.test.ts`, or `serialize` once and `deserialize` twice (the power, research and space suites do this, which also exercises the save).
2. Run `on.run(N)` and `catchUp(off, N, { noDirect: true })`. **Always pass `noDirect`:** below `DIRECT_TICKS` (1 200 ticks) `catchUp` just ticks, and the test would compare the engine with itself.
3. Choose N to cross the events the mechanic creates (a reservoir emptying or filling, a construction or research completing, a dug tile, epoch boundaries every 600 ticks). That is where catch-up and ticking can differ.
4. Compare `off.tick === on.tick`; stocks bit-exact (and the same hash) when the base has a single steady regime, otherwise within the property-test tolerance (±2 items or 0.5 % of the item's flow); the mechanic's own state (tiles dug, research done, accumulator energy); and `rep.incidents` for the expected kinds (`storageEmpty`, `storageFull`, `researchDone`…).
5. Add the mechanic as an option of the random-base generator in `online ≈ offline on random bases` so the 12 seeds explore its combinations. Debug with `CATCHUP_REPORT=1`.
6. If it adds warm-ups (`rep.warmups`) or falls back to `rep.mode === 'approx'`, check the perf test's log line.

### Add a smoke step

```js
// ── M6: market ────────────────────────────────────────────────
await step('market: <the invariant, phrased as the title>', async () => {
  // 1. Set up deterministically through FL (FL.app.sim only when no helper exists).
  await FL(() => window.FL.demo());
  // 2. Act through the real UI when the milestone is about the UI.
  await page.keyboard.press('<key>');
  await page.waitForSelector('[data-screen="<id>"][data-open]', { timeout: 2000 });
  // 3. Advance game time synchronously, then assert on game state.
  await FL(() => window.FL.tick(600));
  const s = await FL(() => window.FL.stocks());
  assert(s.iron_plate > 0, `no plates: ${JSON.stringify(s)}`);
  // 4. Screenshot what a human must look at, then leave the UI as you found it.
  await page.screenshot({ path: 'scripts/smoke-m6.png' });
  await page.keyboard.press('Escape');
});
```

- [ ] Insert it before the closing 10 000-item perf step, which floods the colony with a 3 000-tile ribbon rig.
- [ ] Prefer a new `FL` helper to a long `FL.app.sim` block.
- [ ] Wait with `waitForFunction` / `waitForSelector`, not sleeps; drive the mouse only through `tileXY` after `settleView`.
- [ ] Accept both languages in text checks (`/Mécanique|Mechanics/`) and log key numbers on an indented line.
- [ ] Run it on dev and on preview; open the screenshot.

### Add a debug hook to `FL`

1. Declare it in the `FilonDebug` interface with a one-line JSDoc (prefix `Sandbox:` or `Perf rig:` if it writes outside the commands) and implement it in the `api` object of `installDebug`.
2. Keep it deterministic (no timers, no `Date.now`) and return plain data: it crosses `page.evaluate`. Speak ids (`'iron_plate'`) and whole items at the boundary, as `produced` and `stocks` do.
3. Put colony logic in [src/sim/dev.ts](../src/sim/dev.ts) (DOM-free and unit-testable, like `buildDemo` and `powerLine`) and keep `debug.ts` a thin wrapper.
4. Prefer a command path to a direct write. If it must write directly, it is a sandbox helper (see [the sandbox rule](#the-sandbox-rule)).
5. Add it to the table above and replace any `FL.app.sim` smoke block it supersedes.

## The Crier's hooks for tests

`[data-screen="market"]`, tabs `[data-crier-tab="prices|trade|board"]` and panes `[data-crier-pane]`, `[data-crier-balance]`, `[data-crier-rate]`; prices `[data-price-item="<itemId>"][data-event="on|soon"]` (cells `.cr-bid`, `.cr-ask`) and `[data-trade-item]` (⇄); posts `[data-post="<id>"]` / `[data-crier-nopost]`, stream selects `[data-export-slot="<post>:<slot>"]` (values are item ids), orders `[data-order="<id>"]`, `[data-order-state]`, `[data-order-cancel="<id>"]`, the order form `[data-order-item|n|max|add="<post>"]` (pick the item before the max: a new item resets it); spot `[data-spot-item]`, `[data-spot-n]`, `[data-spot-preset]`, `[data-spot-sell]`, `[data-spot-buy]`, `[data-spot-quote="sell|buy"]`; flights `[data-flight="<post>:<itemId>"]`; the board `[data-board-recipe="<id>"][data-best]`; the Gazette `[data-gazette="<eventId>"][data-when="now|soon"]`; the trade panel `[data-insp-slot]`, `[data-insp-order-cancel]`, `[data-insp-crier]`, its gates `[data-gate="in|out"]` (D62; the exit `[data-gate-linked]` while a ribbon takes from it, the items as `.insp-chip[data-item]`); the HUD's `[data-hud-crier]`.

## Known gaps

Verification that plan §10–§11 asks for and that does not exist yet. Milestone status and what M6–M8 must deliver are in [roadmap.md](roadmap.md).

| Area | Missing |
|---|---|
| M6 market | Covered: the pure engine (`src/market/market.test.ts`) and the trade posts (`src/sim/trade.test.ts`: streams from the Hearth at the bid minus the fee, orders and deliveries, hysteresis, throughput, the post limit, spot trades, a full Hearth sold down by a stream unjams its line offline as online, the demo's post handing the smoke's copper ore order out by a ribbon into the Heart with no demo pole in front of a port, **trading offline ≡ ticking** (same ocelles, same hash), save → load with goods in flight), trade commands in the replay test, and two smoke steps (the Port-Écume shortage sells bulbs dear; an imported copper ore order leaves by the post's one exit and is delivered, the inspector showing the gates, steps 20–21). Still open: the Crier screen and the orbital view have no automated checks beyond opening the screen and the screenshot `smoke-m6-crier.png`. |
| M7 persistence | Covered: `persist/persist.test.ts` (one changed byte caught, gzip and export round trips, a/b fallback, `prev`, the wipe, migrations (2 → 3 parcels granted, 3 → 4 the old 3×3 posts refunded), opening at the same hash, 8 hours caught up), `sim/save-remap.test.ts` (content reordered, renamed, removed; a recipe changed) and five smoke steps (the save note, a reload at the same hash, `simulateAbsence(8)` under 15 s with production, export → start over → import at the same hash, a second tab taking over). Still open: the plan's `advance`, `catchupStats`, `loseContext`. IndexedDB itself is only exercised by the smoke (Node has none: the unit tests use `MemoryKV`). |
| M8 polish | Quests: covered by `quests.test.ts` (a scripted run completes 0–11) and `FL.quests` / `FL.completeQuest`; no smoke step yet plays one through the real UI. A full smoke run in fr-FR **and** en-US: the last smoke step scans the HUD, the inspector and the research and stats screens for `⟦key⟧` in both languages, but the i18n step still ends on `setLocale('fr')`, so under `SMOKE_LOCALE=en-US` the steps in between run in French. Captures of night, flow heat and the far zoom. A stress colony (2 000 buildings, 5 000 ribbons, 10 000 items) at > 30 fps. |
| M1 engine | Online ≈ offline covers 12 random bases; the plan says 200. Compilation is a full rebuild that carries state over (ribbon contents redistributed, orphans refunded), and no test edits a running base to check conservation across recompiles (the plan's "incremental ≡ full"). Perf budgets are 3 ms / 3 s against the plan's 2 ms / 2 s. No engine test covers wind gusts, fuel generators or machines slowing under low satisfaction (only `solvePower` itself). |
| Hash coverage | `Sim.hash()` covers the terrain, level and ore diffs, the land (parcels bought, granted, leased) and the fog, but not project costs, and it drops fractions of a milli-item (offline freight), so the save and replay tests cannot see a divergence there ([engine.md](engine.md), *Known gaps*). |
| M2–M3 | No atlas tests; no `belt-geom`, `interp` or `bindings` tests (only `belt-path`); the smoke drags an L of 7 ribbons where §10 says 10. |
| Tooling | Fixed in the architecture pass: `npm run bench` runs the perf test; `main.ts` runs `validateContent()` at dev startup (and throws); the smoke test takes `CHROME`, checks for a server, and writes screenshots next to itself. |
