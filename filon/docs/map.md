# Map: where a change goes, what it touches, what to run

Read this **instead of** browsing the code or reading whole docs. Find your kind of change, open only the files named, run only the tests named, update only the doc section named. The long docs (`render.md` ~1 900 lines, `decisions.md` rows of 2–3 k characters) are references: `grep` the heading or the `| Dnnn |` row you need, never read them whole.

Size the effort to the change (owner, 2026-10-19: « each session is going extremely far even for very tiny changes »):

| Change | Verify with | Screenshots | Smoke / bench |
|---|---|---|---|
| A number or a text | `npm run typecheck` + the area's tests below | no | no |
| One UI detail | + the area's tests | one shot of the thing | no |
| A rule of the sim | + the area's tests + `src/sim/offline` if it moves items or time | only if it shows | the lead runs them |
| A new mechanic | the area's tests + an online ≈ offline twin | the new thing, once | the lead runs them |

The lead runs the full suite, the bench, the build and the smoke once per commit. Sessions don't.

Slow tests, to run only when your change can affect them: `src/sim/scenarios.test.ts` (~40 s: the debug bases), `src/sim/pacing` (~15 s), `src/sim/offline/catchup.test.ts` (~25 s), `src/sim/ore-blocks.test.ts` (~17 s), `src/sim/face.test.ts` (~10 s), `src/sim/bench` (perf).

## By kind of change

**A number** (a cost, a rate, a power, a price, a time)
- Edit: `src/content/balance.ts` (`BAL`) or the table that holds it: `buildings.ts`, `recipes.ts`, `research.ts`, `items.ts`, `quests.ts`.
- Test: `npx vitest run src/content`, plus the mechanic's own test (below). Early-game economy (power, prices, quests): `src/sim/pacing`.
- Doc: the content's row in `docs/content.md`; a decision row if the owner asked.
- Watch: the debug bases (`scenarios.test.ts`) when the number feeds production or power; a recipe's cycle must divide 1 200 ticks.

**A text**
- Edit: `src/i18n/fr.ts` (the source) and `en.ts` (same keys and placeholders); content texts are `{ fr, en }` in the tables.
- Test: `npx vitest run src/i18n src/ui/building-facts.test.ts` (descriptions: two sentences at most).
- Watch: French typography (U+00A0 before `:`, U+202F before `; ! ? %`); words from `docs/lore.md` (« le Cœur », « base », no humans).

**A building, a recipe or an item: new, changed or removed**
- Edit: `src/content/buildings.ts` / `recipes.ts` / `items.ts` (ports: `P()`, water ports `PW()`), its unlock in `research.ts`, its art in `src/render/art/recipes/buildings.ts` (iso) and `buildings-top.ts` (plan), its sound in `src/audio/signatures.ts`.
- Removing or renaming an id: `src/content/retired.ts`; saves (below).
- Test: `npx vitest run src/content src/render/art`, plus the mechanic's test.
- Doc: `content.md`, `glossary.md`.

**A machine, a ribbon, a flow rule**
- Edit: `src/sim/flow/nodes.ts` (machines, drills, reservoirs, routing blocks, generators), `flow/chain.ts` (ribbons, conduits, the Gleaners' raids), `graph/compile.ts` (what connects to what, drill rates), `graph/groups.ts` (`signature`).
- Test: `npx vitest run src/sim/flow src/sim/offline` + the mechanic's test (`src/sim/*.test.ts` by name).
- Doc: `engine.md` (the flow), `offline.md` (its checklist, if the rule changes over time).
- Watch: determinism (integers, no `Math.random`), every state in `hash`/`snapshot`, fairness by `now % n`.

**Placing and dragging** (refusals, junctions, bridges, lifts)
- Edit: `src/sim/systems/build.ts` (`canPlace`, `PlaceReason`), `systems/belt-plan.ts` (drags), `src/input/tools.ts`; the refusal's text `reason.*` in i18n and its glyph in the tip.
- Test: `npx vitest run src/sim/belt-plan.test.ts src/sim/bridges.test.ts src/sim/junction-*.test.ts src/ui/tip.test.ts`.
- Doc: `engine.md` (placement), `ui.md` (the tip).

**Power**
- Edit: `src/sim/power/solve.ts` (the merit order), `systems/power.ts` (online), `power/network.ts` (weather, producers), `world/wind.ts`; offline modes in `offline/catchup.ts` (`computeNetModes`); the night readout `readouts/night.ts`.
- Test: `npx vitest run src/sim/power src/sim/steam-boiler.test.ts src/sim/wind-spacing.test.ts src/sim/world/wind.test.ts`; if offline changes, `src/sim/offline`.
- Watch: the late debug base's grid (`scenarios.test.ts`), the pacing nights.

**Research and the tree**
- Edit: `src/content/research.ts` (nodes, categories, unlocks), `src/sim/systems/research.ts` (tokens, launches); the screen `src/ui/screens/research.ts` + `tree-layout.ts` + `src/ui/tree-state.ts` + `src/ui/launch-dialog.ts`.
- Test: `npx vitest run src/sim/research src/ui/tree-state.test.ts src/ui/screens/tree-layout.test.ts src/content` (`usable.ts`: nothing unlocked is unusable, D107).
- Doc: `research.md`.

**Trade, the Crier, orders**
- Edit: `src/sim/systems/trade.ts` (posts, sales, purchases, the minute's settlement), `systems/orders.ts`, `systems/ranking.ts`, `src/market/*` (pure), `src/ui/screens/crier.ts`, `ui/inspector/trade.ts`.
- Test: `npx vitest run src/sim/trade.test.ts src/sim/autosell.test.ts src/sim/post-entrance.test.ts src/market` + the orders test.
- Doc: `engine.md` (trade).

**Land**
- Edit: `src/sim/systems/land.ts`, `src/sim/world/land.ts`, `BAL.land`; the panel `src/ui/land-panel.ts` + `land-facts.ts`.
- Test: `npx vitest run src/sim/land.test.ts src/sim/land-resale.test.ts src/ui/land-facts.test.ts`.
- Doc: `land.md`.

**The map and the terrain** (generation)
- Edit: `src/sim/world/mapgen.ts`, `src/content/world.ts`, `world/obstacles.ts`, `world/floor.ts`.
- Test: `npx vitest run src/sim/world` + `scenarios.test.ts` (the debug bases stand on it).
- Watch: **`MAP_VERSION`**: never change what an existing map version makes; add a version (D63). New maps reach only new bases.
- Doc: `engine.md` (map generation), `persistence.md` (map versions).

**The terrain's drawing** (rock, water, spires)
- Edit: `src/render/art/rock.ts`, `terrain.ts` (+ its worker), `gaps.ts` (rivers), `water-top.ts`, `spire.ts`, `src/render/relief.ts`, `render/world/relief-view.ts`, `terrain-chunks.ts`.
- Test: `npx vitest run src/render`.
- Doc: `render.md` (terrain, relief): grep the section.

**Buildings and items on screen** (depth, shadows, animation)
- Edit: `src/render/world/stand.ts` (depth keys), `buildings-view.ts`, `items-view.ts`, `cast-shadows.ts`, `sky-decks.ts`, `belt-lift.ts`; art in `src/render/art/recipes/*`, `atlas.ts`.
- Test: `npx vitest run src/render/world src/render/art`.
- Doc: `render.md` (the depth sort's rules table).

**A panel, the HUD, notices**
- Edit: `src/ui/inspector/*` (panels share `kit.ts`), `hud.ts`, `toasts.ts`, `build-bar.ts`, `tip.ts`, `stock-panel.ts`, `*-notice.ts`; styles in `src/ui/styles/`.
- Test: `npx vitest run src/ui`.
- Doc: `ui.md`.

**The tutorial**
- Edit: `src/content/quests.ts` (objectives, hints, rewards: keep the indices), `src/sim/systems/quests.ts`, `src/ui/guide.ts`, `quest-log.ts`; the tutorial debug base's builders in `src/sim/scenarios.ts`.
- Test: `npx vitest run src/sim/systems/quests.test.ts src/sim/pacing`.
- Doc: `quests.md`.

**Saves**
- Edit: `src/sim/serialize.ts`, `src/sim/save-remap.ts` (`FIELDS`), `src/persist/migrate.ts` (`SAVE_VERSION`, `MIGRATIONS`), `src/content/retired.ts`.
- A new saved field is optional with a default and listed in `FIELDS`; a new shape bumps `SAVE_VERSION` (another session may bump too: re-read just before).
- Test: `npx vitest run src/persist`.
- Doc: `persistence.md`.

**A player action** (anything that changes the base)
- Edit: a `Command` variant + its `exec` case in `src/sim/commands.ts` + a `Sim` method in `src/sim/state.ts`.
- Test: `npx vitest run src/sim/commands.test.ts`.

**The offline catch-up**
- Edit: `src/sim/offline/catchup.ts`, `offline/steady.ts`.
- Test: `npx vitest run src/sim/offline` + the bench (`src/sim/bench`, alone).
- Doc: `offline.md`.

**The debug bases**
- Edit: `src/sim/scenarios.ts` and `scenario-*.ts`, `src/sim/dev.ts` (the demo).
- Test: `npx vitest run src/sim/scenarios.test.ts` (slow).

**Others**: the Gleaners `src/sim/systems/gleaners.ts`, `flow/chain.ts` (raids), `render/world/gleaners-view.ts`; neighbouring bases `src/sim/world/neighbours.ts`, `neighbour-chain.ts`, `render/world/neighbours-view.ts`; audio `src/audio/*` (`npx vitest run src/audio`); keys `src/input/bindings.ts`; blueprints and undo `src/sim/systems/blueprint.ts`, `src/input/undo.ts`, `src/ui/blueprint-panel.ts`; layering is checked by `src/architecture.test.ts`.

## What changes ripple into

| If you change | Also check |
|---|---|
| A content number feeding production or power | the debug bases (`scenarios.test.ts`), the pacing bounds |
| A building's ports or footprint | its art (iso and plan), `building-facts`, the debug bases that lay it, blueprints' mirror twins |
| A sim rule over time | offline exactness: a twin `a.run(N)` vs `catchUp(b, N, { noDirect: true })` |
| Map generation | `MAP_VERSION`, the debug bases, the pacing bot, neighbouring bases' layouts |
| A saved field or an id | `FIELDS`, `retired.ts`, `SAVE_VERSION`/`MIGRATIONS`, `src/persist` tests |
| A recipe or item id | `retired.ts`, the Gleaners' tastes, neighbouring bases' chains, orders' goods |
| A refusal reason | its i18n key, the tip's glyph, the smoke's placing steps |
