# Ocelle — Architecture

Ocelle is a persistent factory game that runs in the browser: one colony per player, unlimited offline production, a simulated world market. Technically it rests on three ideas:

1. **A deterministic integer engine, apart from everything else.** `src/sim` (with `src/content` and `src/core`) is pure TypeScript: no DOM, no clock, no randomness, integers only. It runs on the main thread today, and can run in a Worker or on a Node server unchanged.
2. **The same engine online and offline.** A week of absence is computed exactly, not estimated. Ticking and catching up use the same flow graph, and every long process is built so that both give the same result ([docs/offline.md](docs/offline.md)).
3. **A thin shell that shows one world two ways.** The shell (`src/app`) renders the colony with PixiJS, in an isometric view (to look around) and a top-down plan view (to build) that morph into each other. A DOM UI (cartouches) sits on top and reads the engine at 4 Hz.

The game design (French) lives in the plan: `~/.claude/plans/nous-allons-creer-un-mighty-perlis.md`. The story (who the player is, why the base is unmanned, CrierBelt, the words to use) is in [docs/lore.md](docs/lore.md). The repository is the source of truth for the code structure. This file is the map; the `docs/` folder holds the details.

---

## 1. Layers

```
            ┌──────────── shell: src/app/ · main.ts · debug.ts · settings.ts ────────────┐
            │ owns every part, wires them, runs the frame; nothing imports the shell     │
            └─────┬───────────────┬────────────────┬───────────────┬─────────────────────┘
                  ▼               ▼                ▼               ▼
            ui (DOM)        input (keys,     render (Pixi,     persist (saves) · audio (Web
          cartouches,       pointer, tools)   the two views)    Audio: score, ambience, cues)
          screens               │                │
                  │             └──────┬─────────┘
                  ▼                    ▼
                i18n             sim (the engine) ───► market (M6: the Crier, pure)
                  │                    │                  │
                  └──────────► content (data, BAL) ◄──────┘
                                       │
                                     core (pure helpers)
```

| Layer | Folder | Role | May import (runtime) |
|---|---|---|---|
| core | `src/core` | Integer maths (`fixed.ts`), hashing, seeded RNG/noise, the typed event bus, DOM helpers, tweens, shared string unions | — |
| content | `src/content` | All game data: items, recipes, buildings, research, world template, every tunable number (`BAL`), the registry (ids ⇄ indices), content invariants | core |
| i18n | `src/i18n` | French source strings, English parity, formatting, typography | core, content |
| market | `src/market` | The simulated NPC market behind the `MarketService` contract (the Crier) | core, content |
| sim | `src/sim` | The colony: state, commands, the flow graph, the tick, power, research, space, offline catch-up, save format | core, content, market |
| render | `src/render` | Pixi stage, projection and camera, layers, terrain and relief, the art kit (generated Moebius-style ink art), the world views | core, content, sim (+ types from input) |
| input | `src/input` | Keyboard and pointer, key bindings (AZERTY native), tools (build, ribbon drag, demolish, landscaping brush) and their previews | core, content, sim, render |
| ui | `src/ui` | DOM UI: HUD, build bar, inspector, toasts, tip, full screens, styles | core, content, sim, market, i18n, render's art kit and geometry (+ types from input) |
| persist | `src/persist` | The base kept (M7): the key-value store (IndexedDB), the envelope (gzip, checksum, export text), the a/b slots and copies, migrations, the one-tab lock, opening a base and paying the time owed | core, content, market, sim |
| audio | `src/audio` | Generative sound in Web Audio (D30): the score (director, sequencer, instruments), the ambience, the cues' recipes, the buildings' signatures (D120), the mixer; the shell drives it (`app/sound.ts`) and is its only importer | core, content |
| shell | `src/app`, `src/*.ts` | Boot, the App hub, the frame, the debug handle `window.FL` | anything |

These rules are **enforced** by [src/architecture.test.ts](src/architecture.test.ts). If a change needs a new edge, move the code instead: put the shared type or pure helper in the lower layer. Only widen the table, and update this file with it, when the edge is truly part of the design.

Two further guards protect the engine:
- [src/sim/tsconfig.json](src/sim/tsconfig.json): sim, market and content type-check **without DOM types**.
- The **determinism guard** in [src/sim/serialize.test.ts](src/sim/serialize.test.ts) scans `src/sim`, `src/content` and the core helpers the engine imports for `Math.random`, clocks and transcendental functions; `src/market` (floats allowed) is scanned for randomness and clocks.

---

## 2. The non-negotiables

| # | Invariant | Why | Guarded by |
|---|---|---|---|
| 1 | The engine is **integer and deterministic**: milli-items (`MU = 1000`), kW, ‰, centi-ocelles; no `Math.random`, `Date`, `sin/exp/log/pow/hypot`; total-order sorts; `isqrt` | Same save + same commands ⇒ same state, on any machine; a future server replays and validates | determinism guard, `hash()` comparisons in tests |
| 2 | **Online ≡ offline.** Any mechanic that changes state over time must be expressible to the catch-up (flow nodes, or the *pseudo-flow + allowance* pattern) | Offline production is unlimited and must not drift from online play | `catchup.test.ts` (online ≈ offline on random bases), mechanic-specific tests |
| 3 | **Commands are the only way in.** UI, tools and scripts change a colony only through the Sim's command methods; each validates, applies and logs itself (`sim.log`) | Replay, server validation, future undo | [src/sim/commands.test.ts](src/sim/commands.test.ts) (replay ⇒ same hash) |
| 4 | **Nothing vanishes silently** — but into an incinerator, the player's explicit choice (D51), or into the Gleaners' hands at night (D103), every item counted (`Sim.gleaned`), reported at dawn and marked on its line. Removal refunds 100 %; orphaned items go back to the Hearth; full stores push back instead of destroying | Players trust a persistent colony | conservation tests in `flow.test.ts`, `space.test.ts`, `gleaners.test.ts` (Δheld = produced − consumed − gleaned) |
| 5 | **The sim never produces text.** Events and reports carry ids and numbers; the UI translates | FR/EN everywhere, a server speaks no language | `SimEvent` types, i18n parity test |
| 6 | **The shell is a leaf.** Pixi only in `src/render`, Web Audio only in `src/audio`; the DOM UI never touches the scene graph; nothing imports `src/app` | Keeps the engine portable and the views replaceable | `architecture.test.ts` |
| 7 | **No silent reset** of a colony (M7): a/b slots with checksums, `prev` and `pre-*` copies, chained migrations, saves re-pointed by content id (D47); a save that does not open stops the boot instead of being replaced | One persistent colony per player | `persist/persist.test.ts`, `sim/save-remap.test.ts`, the smoke's M7 steps |
| 8 | **Every number lives in content** (`BAL` or the tables), never inline in a system | Balancing without code hunts | review; `validate.ts` invariants |

---

## 3. How it runs

### The frame ([src/app/app.ts](src/app/app.ts))

```
rAF (main.ts) → App.frame(dt)
  view.update(dt)            iso ⇄ plan morph: t → te (eased) → projection P
  input.frame(dt)            keyboard pan, held keys
  tickSim(dt)                fixed 10 Hz: whole 100 ms ticks, ≤ 8 per frame (longer gaps: the resync's catch-up, app/persistence.ts)
  drainSimEvents()           SimEvent → toasts, bus, view rebuilds (app/sim-events.ts)
  dirty chunks               dug / filled tiles repaint terrain + relief
  drawWorld(dt)              camera → terrain → relief → ghost → overlays → the view's marks (D88) → day/night (grade, lights, clouds) → items → tip → stats sample
  every 0.25 s               the view's readings (D88), HUD, build bar, inspector, the views' card, open screen refresh (change-only DOM writes)
  renderer.render()          one Pixi render of the stage
  perf                       numbers for the perf overlay (` key)
```

### The tick ([src/sim/state.ts](src/sim/state.ts))

```
Sim.step()
  1 constructions        remote kites that arrived → buildings              systems/build.ts
  2 ensureCompiled       recompile the flow graph if `dirty`                graph/compile.ts
  3 power                demands vs sun/wind → satisfaction ‰ per grid      systems/power.ts (the wind: world/wind.ts, D95)
  4 phases A → B → C     offers/accepts → transfers → machines & drills     flow/step.ts
                         (at night the Gleaners take from the exposed ribbons, D103)          systems/gleaners.ts, flow/chain.ts
  5 research             servers' output, each lab's power (`lit`, D122)       systems/research.ts
  6 landscape            dig / fill jobs advance, tiles turn to floor        systems/landscape.ts
  7 tick++ · boundary    every 600 ticks (1 game minute): trade posts trade, the Crier settles   systems/trade.ts
                         then the leases' hour: rent paid, or the lease lapses                   systems/land.ts
                         then the tokens' minute — the Core's compute, servers, the bank, bought flows to the labs that had power; the projects done finish, a queued one starts (D118, D122) —, then the expertises' minute (D93)   systems/research.ts, systems/expertise.ts
                         then the Gleaners' nightfall and dawn (D103: the night's tally, the morning report)   systems/gleaners.ts
  8 quests               the tutorial: rate windows at boundaries, a completion check every second   systems/quests.ts
```

### State, commands, events

- **`Sim` is a facade.** It holds the whole state and exposes the API. The rules live in `src/sim/systems/*.ts`, each a set of functions over the Sim (`build`, `belt-plan` (a ribbon drag planned whole, D73), `configure`, `research`, `landscape`, `land`, `power`, `trade`, `expertise` (the expertises, D93), `gleaners` (the Gleaners' nights, D103)). Formulas that need no state sit beside them (`space.ts`, `research/runtime.ts`, `power/*`).
- **Commands** ([src/sim/commands.ts](src/sim/commands.ts)): the `Command` union is what a player can do. Command methods log themselves, and `exec` / `replay` re-apply a log. A switch checked for exhaustiveness makes a new command kind fail to compile until it is handled.
- **Events**: the Sim appends `SimEvent`s, and the shell drains them once per frame through a handler table typed so that every event kind needs a handler ([src/app/sim-events.ts](src/app/sim-events.ts)).
- **Reads**: views and UI read the Sim directly. They pull at 4 Hz for the DOM, every frame for the views, and rebuild when a `structure` event arrives. They never write to it except through commands.
- **Derived state** (flow graph, the starting square and the neighbouring bases (D110), `Mods`, occupancy) is rebuilt, never saved. The save holds only what cannot be recomputed ([src/sim/serialize.ts](src/sim/serialize.ts)).

### Offline

`catchUp(sim, ticks)` ([src/sim/offline/catchup.ts](src/sim/offline/catchup.ts)) cuts the graph into groups at reservoirs. It warms each group up until its state repeats with an exact period, extrapolates whole periods until the next event (a store filling or emptying, a research project done, a tile dug, an epoch, a weather step…), then handles the event and repeats. Digs and fills attach to reservoirs as *pseudo-flows*: their stone follows a path-independent *allowance*. Research takes no items (D122): its lab's power is summed per segment (`lit`, like the servers' output) and its tokens come at the minute's boundary, so the catch-up and ticking agree exactly. Details: [docs/offline.md](docs/offline.md).

---

## 4. Where new code goes

| You are adding… | Put it in | And also |
|---|---|---|
| A game rule that changes state | `src/sim/systems/<domain>.ts` (new file for a new domain) | A facade method on `Sim`; a `Command` variant + `exec` case; save fields in `serialize.ts` and `hash()`; an online ≈ offline test |
| A pure formula (rates, costs, curves) | `src/sim/<domain>.ts` or `src/content` | Unit test with the plan's numbers |
| Numbers, items, recipes, buildings, research | `src/content/*` and `BAL` | `validate.ts` invariants when a rule must hold |
| A new building kind | see the checklist in [docs/extending.md](docs/extending.md) | content → graph compiler → node → inspector panel → art → i18n → tests |
| A new SimEvent | `SimEvent` in `src/sim/commands.ts` | A handler in `src/app/sim-events.ts` (compile-enforced) |
| A new full screen | `src/ui/screens/<name>.ts` (`root` + `refresh()`) | `screens.register(...)` in `app.ts`, a key in `input/bindings.ts` + `app/controls.ts`, i18n keys |
| An inspector section for a kind | a `Panel` in `src/ui/inspector/<group>.ts` | its entry in `src/ui/inspector/panels.ts` |
| Something drawn in the world | `src/render/world/<name>-view.ts` | a layer in `render/layers.ts`, a call in `App.drawWorld`; on a big base, re-draw only what a structural change touched and cull what is off screen (D92: the buildings view's records and buckets) |
| A specialised view (one system shown on its own, D88) | its readings in `src/sim/readouts/` (pure, read-only), its part of `Readouts`; its world marks in `render/world/views-view.ts`; its card in `src/ui/views/` | a `MapView` in `core/kinds.ts`, a key in `input/bindings.ts` + `app/controls.ts`, a button in `ui/views/view-bar.ts`, `MapViews.refresh`, an inspector facet (D89); [ui.md](docs/ui.md#the-specialised-views-d88) |
| Building / item art | `src/render/art/recipes/*` | atlas keys; `isoHead` for picking; the artboard shows it; a powered building's terminal in `src/render/art/terminals.ts` (where its wires attach) |
| A debug or test hook | `src/debug.ts` (`window.FL`) | sandbox only: never mutate a colony outside commands except in clearly-named rigs |
| A tutorial quest | `src/content/quests.ts` | an objective kind in `src/sim/systems/quests.ts`, a guide target in `src/ui/guide.ts`, i18n keys; [docs/quests.md](docs/quests.md) |
| Market logic | `src/market` (pure) | the sim calls it once per epoch through `MarketService` |
| A saved field | `SaveData` in `src/sim/serialize.ts` (optional, with a default) | its kind in `FIELDS` (`src/sim/save-remap.ts`); a renamed or removed content id: `src/content/retired.ts`; a new save shape: `MIGRATIONS` (`src/persist/migrate.ts`); [docs/persistence.md](docs/persistence.md) |
| A sound cue | `SfxCue` in `core/bus.ts`, its row in `CUES` (`audio/cues.ts`) and its recipe in `RECIPES` (`audio/sfx.ts`) | `bus.emit('sfx', { cue })` where it happens (or a mapping in `app/sound.ts`); measure its peak; [docs/audio.md](docs/audio.md) |
| A building's sound | nothing (its kind's signature); its own: its id in `ID_SIGNATURE`, or a new signature in `SIGNATURES` (`audio/signatures.ts`) and `SIG_RECIPES` (`audio/signature-sfx.ts`) | measure its peaks (`scripts/sound-levels.mjs`); [docs/audio.md](docs/audio.md), "Building signatures" |

---

## 5. Module map

**`src/core`**: `fixed.ts` (`mulDiv`, `ceilDiv`, `isqrt`, carries), `hash.ts` (`hash32`, `StateHasher`), `rng.ts`/`noise.ts` (seeded, quantised), `bus.ts` (typed `GameEvents`), `dom.ts` (`el`, change-only `setText`/`setAttr`), `tween.ts`, `pace.ts` (the frame cap's pacing, D100), `math.ts`, `store.ts` (settings storage), `kinds.ts` (shared unions: `ScreenId`, `ViewMode`, `Locale`…), `cpu-time.ts` (test-only: the CPU-time clock of the tests' time limits; nothing of the engine imports it).

**`src/content`**: `items.ts`, `recipes.ts`, `buildings.ts`, `research.ts`, `expertises.ts` (the expertises, D93: feats, ranks, effects), `gleaners.ts` (the Gleaners' taste: what they take, D103), `quests.ts` (the tutorial: objectives, rewards, guide steps), `world.ts` (seed, cirque template), `types.ts`, `registry.ts` (index arrays, `BUILDING_KIND`, `CRECIPES`, `costOf`, `isBeltDef`, `isDragDef`, `revealOf`: the fog a building lifts, D117…), `balance.ts` (`BAL`), `reserve.ts` (the bootstrap and CrierBelt's restart reserve, D36), `retired.ts` (renamed and removed ids, for saves: D47), `past-costs.ts` (what buildings cost before a change of price, so those built then refund it: D123), `validate.ts`, `usable.ts` (nothing unusable, D107: what a node unlocks can be paid for, fed and run by then). → [docs/content.md](docs/content.md), [docs/research.md](docs/research.md)

**`src/market`** (pure; the sim settles it once per epoch through `systems/trade.ts`): `types.ts` (the `MarketService` contract), `service.ts` (`LocalMarketService`), `engine.ts` (per-epoch state machine), `pricing.ts`, `events.ts`, `colonies.ts`, `board.ts`; content in `content/colonies.ts` and `BAL.market`. → [src/market/README.md](src/market/README.md)

**`src/sim`**: `state.ts` (facade), `commands.ts`, `cfg.ts` (entity `cfg` bit layout), `trade.ts` (trade post rules), `systems/*` (build, configure, research, reserve, landscape, land, power, trade, quests, expertise, gleaners: the Gleaners' nights — their clock, the night's tally, the morning report, the lines' marks, D103), `entities.ts`, `types.ts`, `constants.ts`, `space.ts`, `face.ts` (the cliff face, D87: which rock tiles a face cutter's back touches, its rate, its auto-turn), `ore-blocks.ts` (map 4's deposits in whole blocks, D104: where a drill held over ore snaps), `graph/` (compile, groups), `flow/` (chains, nodes, phases), `power/` (wires, grids from the wires, solver, weather & generators), `research/` (runtime, modifiers), `world/` (grid, mapgen, land parcels, climate, the wind — its time, its bearing, each tile's exposure, a turbine's curve: `wind.ts`, D95; map 4's lines — corridors, chasms, rivers — in `obstacles.ts` and the usable floor in `floor.ts`, D94; where the Gleaners walk and which ribbon tiles they reach, `reach.ts`, D103), `offline/` (catch-up, steady regimes, report), `serialize.ts`, `save-remap.ts` (saves re-pointed to today's content, D47), `refund.ts` (what a building gives back of its construction: its price when it went up, D123), `purse.ts` (the purse's journal, D102: every change of the ocelles by what made it — runtime only, the HUD's real ◉/h), `readouts/` (what the specialised views show, D88: grids by source and their 24 h forecast, ribbon throughput, production states and why, the wind and the turbines (D95), the Core's grid without the sun (`night.ts`: « Tenir la nuit » and the night notice, D101) — pure and read-only, below both render and ui), `dev.ts` (demo layout), `scenarios.ts` (the debug bases: ready-made colonies at each stage, built by real commands; the late base's works in `scenario-late.ts`, its drawn plans laid by `scenario-plans.ts`, the cirque worked to the full in `scenario-cirque.ts`, the quartz vein's cutters and workshop in `scenario-quartz.ts`, « La vapeur »'s boiler by the water in `scenario-steam.ts`, D114; the late base's steel line and brickworks in `scenario-basics.ts`, D123), `testkit.ts`, `bench/`. → [docs/engine.md](docs/engine.md), [docs/offline.md](docs/offline.md)

**`src/render`**: `stage.ts`, `projection.ts` (`proj(t)`: iso ⇄ plan), `iso.ts`, `camera.ts`/`camera-math.ts`, `layers.ts`, `relief.ts`, `perf-overlay.ts`, `stress.ts`, `daynight.ts` (the time of day's grade), `art/` (tokens, ink, shapes, iso-shapes, rock, terrain (+ worker; its water, rivers and crevasses in `gaps.ts`, the paint window and marching squares in `paint-kit.ts`, D94; the ore deposits in `ore.ts`, D99), atlas, dyn-atlas, solar, recipes incl. `fx.ts`), `world/` (terrain chunks, relief, buildings, items (`item-flow.ts`: items as persistent tokens through every hand-off, no Pixi; `items-view.ts` draws them), ghost, overlays, power wires (+ wire geometry), lights + cloud shadows, the work look: a production building that does not work drawn switched off, D83; the rivers' running water at near zooms, D94: `rivers-view.ts`; the specialised views' veil, marks and badges, D88 (the Vent view's wash and arrows, D95): `views-view.ts`; the wind's rare hints on the land, gust streaks and sand off the tops: `wind-hints-view.ts`; their marks drawn in `art/view-icons.ts`; the Gleaners at night and the glazed ribbons' glass hoods, `gleaners-view.ts`, their art in `art/recipes/gleaners.ts`, D103). → [docs/render.md](docs/render.md)

**`src/input`**: `input.ts`, `bindings.ts`, `tools.ts`, `link-tool.ts` (the power-wire tool), `belt-path.ts`, `touch.ts` (fingers → pan, pinch, tap, a tool's drag, long press as the right button, D96; pure). → [docs/input.md](docs/input.md)

**`src/ui`**: `hud.ts`, `build-bar.ts` (+ icon helpers), `inspector/` (inspector, panels per group incl. `trade.ts`, and `kit.ts`: the panels' kit — sections, the status line, icon equations, meters, number formats — that the building card and the screens share too, D89), `toasts.ts`, `tip.ts`, `deposit-card.ts` / `deposit-facts.ts` (the deposit card, D99), `stats.ts` (recorder), `gazette.ts`, `trade-view.ts`, `quest-log.ts` (the tutorial's log — a guided quest's step, a goal's « Indice », the optional objectives —, naming modal, toast text), `guide.ts` (the tutorial's arrow, and a goal's one marker on request, D101), `night-notice.ts` (the one-time notice before the first night, D101), `contract-notice.ts` (the starter contract fulfilled: continue at the market's price or stop, D101), `gleaners-card.ts` (the Gleaners' first night and each morning's report, D103), `analytics.ts` (what the tree's Analytics path unlocks, its reveals, the machines' states: D41), `tree-state.ts` (the tech tree's state and a project's tokens and flows, one derivation for the HUD and the tree screen, D118, D122), `launch-dialog.ts` (a research's launch, at every tier since D122: its resources from the Core, the tokens, the Core's compute and the servers' share, the bank, the flow bought and its cost, the expected end, D118), `keycap.ts` (the letter on a key bound by position, for the hints: the pipette's), `fit.ts` (the responsive layout's numbers, D96: the breakpoints, the window's fit factor), `stock-panel.ts` and `stock-facts.ts` (the Heart's stock behind the HUD's « Stock » button, by kind; what the base lacks, D96), `purse-card.ts`, `purse-facts.ts` and `token-facts.ts` (the purse's real ◉/h from the engine's journal, broken down by item sold, order, tokens and rent; the tokens made plain, D102), `sheet.ts` (a side panel as a bottom sheet on a narrow window, D96), `focus.ts` (the spotlight: a short black out around a new readout), `mention.ts` (an item named in the UI shows its icon: `itemRef` / `itemMention`), `item-picker.ts` (the item picker that replaces item `<select>`s), `screens/` (the main menu and its settings page, the intro, research, stats, crier, expertise (D93: the Archive's window), artboard, the absence report, the one-tab conflict panel), `views/` (the specialised views, D88: the selector, the side card and its Électricité, Logistique, Production and Vent parts, D95), `orbit/` (the orbital view), `styles/`. → [docs/ui.md](docs/ui.md)

**`src/persist`**: `kv.ts` (IndexedDB / memory), `envelope.ts`, `slots.ts`, `migrate.ts`, `lock.ts`, `colony.ts` (open, rebuild, time owed, catch-up). → [docs/persistence.md](docs/persistence.md)

**`src/audio`** (Web Audio; the pure parts unit-tested in Node): `theory.ts` (modes on D, chords, voice leading, melody ladders), `director.ts` (the time of day's mood, the activity's pulses, the generative `Score`), `sequencer.ts` (look-ahead clock), `levels.ts` (the mix: taper, bus trims, voice and ambience levels), `cues.ts` (arbitration, rate limits, measured peaks), `buffers.ts` (noises, impulse response, clip curve), `synth.ts` (instruments), `ambience.ts` (wind, machines, ribbons), `sfx.ts` (cue recipes), `signatures.ts` (the buildings' signatures: the table, the variants, the spatial fade, merging and spacing), `signature-sfx.ts` (their recipes), `engine.ts` (`SoundEngine`: the graph on any audio context), `sound.ts` (`Sound`: the shell's front door). → [docs/audio.md](docs/audio.md)

**`src/app`**: `app.ts` (hub + frame), `view.ts` (morph), `picking.ts`, `build-mode.ts`, `screens.ts`, `intro.ts` (the intro's shell side: when it plays, the Heart's landing, naming the claim), `sim-events.ts`, `controls.ts`, `views.ts` (the specialised views, D88: which one is on, their readings at 4 Hz), `layout.ts` (the responsive layout's numbers, D96: the zoom for the window, where the HUD and the build bar end, the canvas on a resize), `sound.ts` (what the base sounds like: unlock, world snapshot, cues), `debug-bases.ts` (the menu's debug bases: the player's colony set aside, frozen, and swapped back), `persistence.ts` (boot from the save, autosave, the world clock's resync, export / import / start over); at the root `main.ts` (boot), `debug.ts` (`window.FL`), `settings.ts`. → [docs/app.md](docs/app.md)

**`scripts/`**: `smoke.mjs` (end-to-end in the system Chrome via playwright-core), `shots.mjs` (named screenshots), `heart-shots.mjs` (the Core at each level), `desert-shots.mjs` (map 4's open desert, D94), `quartz-shots.mjs` (the quartz vein, its face cutters by day and night, a debug base mining it, D87), `view-shots.mjs` (the specialised views and the HUD on the late base, D88), `panel-shots.mjs` (the inspector on six kinds, the building card and the screens on the late base, D89), `render-bench.mjs` (the renderer's frame times on the late base and the stress colony, D92), `render-shots.mjs` (a pinned late base's pictures, compared pixel by pixel; an update against a full rebuild, D92), `soak.mjs` (a long session: what grows, what the frames cost; two builds compared in alternating windows, D100), `bridge-shots.mjs` (a backed-up line waiting on a skybridge's deck, a tall silo in front, before / after, D121), `wind-shots.mjs` (the wind's hints, the Vent view, a turbine's wind in the inspector before and after its plan, D95), `responsive.mjs` (the UI at seven window sizes on the late base, measured and shot, real fingers on a phone size, D96), `expertise-shots.mjs` (the Expertise window, a réorientation, the Core's Archive clicked in both views, its inspector and the HUD's chip, D93), `obstacle-shots.mjs` (map 4's land at far zoom, a river and a chasm up close, a skybridge pair over a chasm, the Terrain view's usable-floor gauges and the land panel's figure, D94), `crevasse-shots.mjs` (a crevasse and its skybridge pair, near and mid zoom, iso and plan, day and night, `TAG=before|after`), `space-ore-shots.mjs` (an open desert parcel beside a rich cramped one, far zoom, and the Terrain view's gauges and ore pips), `river-shots.mjs` (the drainage network down to the sea at far zoom, a confluence, a fall, the coast), `water-shots.mjs` (the water's texture and the Crown's spring, D115: a stream, a broad river, a confluence, a fall, the spring, a lake, the sea's edge, `TAG=before|after`), `river-seam-shots.mjs` (where a river meets darker water: a lake's and the sea's mouths, a chunk border, a confluence, a fall, near and mid zoom, iso and plan, noon and night, `TAG=before|after`), `block-shots.mjs` (map 4's cirque deposits in whole blocks, bare and under drills, plan and iso, a drill's ghost snapping onto them, D104), `gleaner-shots.mjs` (the Gleaners, D103: the grown base's quartz line at night with Gleaners at it, the Logistique view's night marks, a stretch fenced in, the late base's glazed lines by day and by night, the two cards in French and English, the ribbon's inspector), `research-shots.mjs` (D118: the grown base's locked Tier 2 and its band, a Tier 1 detail, the late base's launch dialog and a running project, FR and EN), `tree-shots.mjs` (the tech tree, D107, D111: the whole canvas, the window and focused chains on the late and grown bases, the zoom — the whole tree, a mid zoom, Ctrl+wheel about the pointer —, a tablet; `TAG=before|after`), `mesa-shots.mjs` (the mountains as Moebius mesas: a map 4 massif and the Crown at near, mid and far zoom, iso and plan, by day, dusk and night; a waterfall; `TAG=before|after`). → [docs/testing.md](docs/testing.md)

---

## 6. Docs

| Doc | For |
|---|---|
| [docs/engine.md](docs/engine.md) | The simulation: units, time, world, graph, flow, power, research, space, save, determinism |
| [docs/offline.md](docs/offline.md) | The exact catch-up and how to keep a new mechanic offline-exact |
| [docs/land.md](docs/land.md) | The claim's land: parcels, the starting square, prices, buying and leasing (D60) |
| [docs/persistence.md](docs/persistence.md) | Saves (slots, envelope, migrations, content remap), boot and the time owed, autosave, export / import, one tab at a time |
| [docs/content.md](docs/content.md) | Data tables, `BAL`, the registry, invariants |
| [docs/research.md](docs/research.md) | The tech tree's design: the arc, tokens, resources and pace by tier (D122: no data), the Core's compute, each family's lineage, the rules it keeps (nothing unusable, D107) |
| [docs/render.md](docs/render.md) | Projection, views, layers, relief, art pipeline |
| [docs/input.md](docs/input.md) | Bindings, tools, ribbon paths |
| [docs/ui.md](docs/ui.md) | DOM UI components and patterns |
| [docs/app.md](docs/app.md) | The shell: boot, frame, controllers |
| [docs/audio.md](docs/audio.md) | Generative sound: the score, the ambience, the cues, the mix and its measured levels, the knobs, adding a sound |
| [docs/i18n.md](docs/i18n.md) | Strings, formats, typography |
| [docs/testing.md](docs/testing.md) | Unit tests, perf, smoke, shots, `window.FL` |
| [docs/extending.md](docs/extending.md) | Step-by-step recipes (new item, recipe, building kind, research node, mechanic, screen…) |
| [docs/glossary.md](docs/glossary.md) | Game and engine vocabulary, FR / EN / code |
| [docs/quests.md](docs/quests.md) | The tutorial: quests 0–12, how they are checked and paid, the quest log and the guide, adding a quest |
| [docs/decisions.md](docs/decisions.md) | Why things are the way they are (locked decisions) |
| [docs/roadmap.md](docs/roadmap.md) | Milestone status, what M6–M8 must deliver, open questions |
