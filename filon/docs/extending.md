# Extending Ocelle: recipes

Step-by-step checklists for the changes that come up most, across every layer they touch. Each recipe names the files and the functions involved. When a recipe and the code disagree, the code wins: fix this file in the same change. Background: [ARCHITECTURE.md](../ARCHITECTURE.md) for the layers and invariants, [content.md](content.md) for the data tables, [engine.md](engine.md) for the engine, [offline.md](offline.md) for the catch-up.

**Before you start**: read the plan's section for the feature (`~/.claude/plans/nous-allons-creer-un-mighty-perlis.md`). Numbers go into `BAL` or the tables, never inline. **When you are done**: `npm run typecheck`, `npm test`, `npm run build`, a running dev server + `npm run smoke`, and look at the screenshots ([testing.md](testing.md)).

---

## 1. Add an item

1. [src/content/items.ts](../src/content/items.ts): an entry `id: { name: { fr, en }, tier, kind, value, depth, glyph, color }`. `value` is the reference price in ◉; `depth` is the NPC market depth in items/min (0 = not tradable, as for fluids). `kind` drives a few rules (`fluid` never rides ribbons or routes; `science`, `unique`…).
2. A glyph: reuse one, or add it to `GLYPHS` in [render/art/recipes/items.ts](../src/render/art/recipes/items.ts). The atlas bakes every item automatically (`iKey(id)`), and the UI's `itemIcon` uses the same frame.
3. Where it comes from: a recipe output (§2), a deposit (drills: the world template / mapgen ore tables), or another source (stone from digging, water from pumps).
4. Where it goes: recipe inputs, research costs, building costs. [validate.ts](../src/content/validate.ts) fails on items no recipe or deposit can produce (`reachableItems`), and on some scarcity rules.
5. The HUD shows held items by a fixed `ORDER` first, then everything else ([hud.ts](../src/ui/hud.ts)); add it to `ORDER` if it belongs to the early chain.

## 2. Add a recipe

1. [src/content/recipes.ts](../src/content/recipes.ts): `{ name, machines: [...building ids], seconds, ins: { item: qty }, outs: { item: qty }, energyKwMin?, unlock }`.
2. **The cycle must divide 1 200 ticks** (`seconds × 10` divides `CYCLE_LCM`), or the offline catch-up loses its exact periods. `validate.ts` checks this.
3. `unlock`: `'start'` or a research id. The inspector only offers unlocked recipes (`recipesFor(def)` filtered by `sim.unlocked`).
4. Nothing else: the registry compiles it (`CRECIPES`, milli-items, ticks), machines pick it up, the inspector lists it, and the market board (M6) will price it.

## 3. Add a building of an existing kind (e.g. a new machine)

1. [src/content/buildings.ts](../src/content/buildings.ts): `{ name, kind, category, w, h, ports: [{ x, y, side, io }], kw, idleKw, needsZone, unlock, cost, …kind fields }`. Ports must sit on the footprint's edge (validated). `needsZone: true` for anything that produces, powers or stores: it then stands wholly on the claim's land, and goes dormant if a lease under it lapses ([land.md](land.md)); infrastructure (lines, routing blocks, masts) leaves it `false` and may cross other land. `onRock: true` lets it stand on the mountains.
2. Art: an iso recipe in `R` of [render/art/recipes/buildings.ts](../src/render/art/recipes/buildings.ts) (with `head`, the sprite height in levels; picking in iso uses it through `isoHead`), and a plan recipe in `R` of [render/art/recipes/buildings-top.ts](../src/render/art/recipes/buildings-top.ts). Without them a violet dome stands in (`fallback`). If the look changes with rotation, check `needsRotations` / `needsRotationsTop`. Review it on the art board (`FL.open('artboard')`).
3. The build bar lists it under its `category` automatically; costs and locks come from the entry.
4. Machines: its recipes name it in `machines`.
5. Power (D25): with `kw`, `idleKw`, `gen` or `accumulator` it takes part in power and runs only once the player wires it to a pillar or the Heart (the Link tool, L). The wire rule, the grids, the wires view and the inspector's grid module pick it up by themselves (a new producer kind also needs a case in `producerOf` and in the module's reasons, `outputOf` in ui/inspector/power.ts). One thing to add: its **terminal**, where the wires meet it, in `TERMINALS` of [render/art/terminals.ts](../src/render/art/terminals.ts). It is one point or a few, in the building's unrotated frame (tile x, y, height z). The art draws it, through `terminalIso` / `terminalTop`, and the wires hang from it. `wire-geom.test.ts` fails for a powered building without one, or with one above its sprite. A new pillar is a `pole: { range, slots, climb }` (`climb`: the terraces its wires climb and clear, D78; `tall` for the xp4 bonus) in the `power` replace group; its terminals are its insulators.
6. Replacement: a new ribbon tier, routing block, mast or drill gets the `replaceGroup` of its kind (`transport`, `fluid`, `power`, `drill`). It can then be placed over its kind, and its kind over it, when the replaced building lies wholly inside the new footprint ([content.md](content.md), [engine.md](engine.md#placement-and-replacement)). Leave it out for anything that must never be built over (machines, stores).

## 4. Add a new building kind

Everything in §3, plus:

| Layer | Where | What |
|---|---|---|
| content | [types.ts](../src/content/types.ts) | add the kind to `BuildingKind` (`BUILDING_KIND` is typed with it, so comparisons are checked) |
| sim | [graph/compile.ts](../src/sim/graph/compile.ts) | a `case` in `compileGraph`'s switch that builds its node. Use `reuse(e, make, same)` so state survives recompiles; reservoir-like buildings get a store in `inp.stores` |
| sim | [flow/nodes.ts](../src/sim/flow/nodes.ts) | a node class if no existing one fits (`ReservoirNode`, `MachineNode`, `DrillNode`, `GeneratorNode`, `ForkNode`, `ConsumerNode`). It implements the `FNode` contract of [flow/node.ts](../src/sim/flow/node.ts): `offer` (A1), `accept` (A2), `split` (A3), `take` / `give` (B), `update` (C), `demand()`, `status`, and **`hash`, `snapshot`, `restore`**. Saving and the catch-up's regimes depend on those three: no absolute ticks in the state, shift them in `restore` |
| sim | [systems/build.ts](../src/sim/systems/build.ts) | placement rules if it needs terrain (`needs_water`, `needs_vent`…) or has special costs; new reasons go in `PlaceReason` and get `reason.<x>` i18n keys |
| sim | [state.ts](../src/sim/state.ts) `heldIn` | if the node buffers items (conservation tests count them) |
| sim | [offline/catchup.ts](../src/sim/offline/catchup.ts) | only if it does something outside the flow phases (a long process, an event): see §6 |
| ui | [inspector/panels.ts](../src/ui/inspector/panels.ts) | its panels (§9) |
| i18n | `fr.ts` / `en.ts` | inspector strings; status keys if it introduces a status |
| tests | `flow.test.ts`, `space.test.ts`… | its behaviour, conservation, and save → load at the same hash |

Then grep for an existing comparable kind (`grep -rn "'dock'" src`) and check every hit: those are the places a kind is special-cased.

## 5. Add a research node or a branch effect

1. [src/content/research.ts](../src/content/research.ts): `node(branch, depth, [fr, en], [descFr, descEn], effects)`. Depth gives the base cost and duration from the plan's table; prerequisites follow the branch and the trunk gates.
2. Effects: `add(stat, n)`, `mul(stat, ‰)`, `flag(name)`. A new stat or flag is declared in `Mods` ([sim/research/modifiers.ts](../src/sim/research/modifiers.ts)): the stat list, the defaults in `computeMods`, any clamp at the end. Engine code reads `sim.mods.<stat>` or `sim.mods.flags.has(name)`, never the research ids.
3. A unlock: buildings and recipes name the node in `unlock`. A building whose node a save no longer holds (a reconversion from before D107) stands **dormant** automatically (`isDormant`).
4. `modsKey` (part of the catch-up's regime cache key) covers every stat, so a new stat needs nothing more there; check it if you add a non-numeric effect.
5. Tests: `research.test.ts` pins the table's costs. Add one for the effect where it applies.

### 5b. Add an expertise (D93)

1. [src/content/expertises.ts](../src/content/expertises.ts): a row in `EXPERTISES` — its family, a `feat` of its own (a new `FeatKind` needs its case in `featValue`, [systems/expertise.ts](../src/sim/systems/expertise.ts), read only from what is exact at a minute's boundary: a cumulative counter, what stands, the ledger), three rising thresholds, its effect (`mod` targets of `Mods`, or one `research` aspect) and its ‰ by rank, an icon. `expertiseProblems` keeps one production and one research per family.
2. A new `mod` target: in `ModTarget` and `baseMods` ([modifiers.ts](../src/sim/research/modifiers.ts)), read where the engine computes that number (the compiler for a node's rate: a change of the Mods recompiles the graph, online and in the catch-up). A cost or a delay goes in `LOWER_IS_BETTER`.
3. i18n: `exp.feat.<kind>` and, for a new target, `exp.fx.<target>`; the window's effect icon (`effectIcon`) and the feat's unit (`featText`).
4. Tests: expertise.test.ts — the feat at a boundary, the effect where the engine reads it, and the online ≈ offline twin if it changes a flow.

## 6. Add a mechanic that runs over time (a new system)

Examples: digging, freight, trading, the land's leases. The engine must stay **exact offline**.

1. **Pure rules** first: `src/sim/<domain>.ts` (formulas, durations, rates; integers), with unit tests that reproduce the plan's numbers.
2. **State** on the `Sim` (`state.ts`): the fields, with a comment saying what is saved.
3. **A system** `src/sim/systems/<domain>.ts`: commands (validate → apply → `sim.log.push({ tick, cmd })` → `sim.dirty = true` if the graph changes → `sim.events.push(...)` if the shell must react), and an online `<domain>Tick(sim)`. If it spends from the Heart's stock for good (anything a removal does not give back), refuse it when `sim.reserveShort(cost)` is not empty: a base must always be able to rebuild its production (D36, [engine.md](engine.md#crierbelts-restart-reserve-d36)).
4. **Facade**: one-line methods on `Sim` that delegate; call the tick from `Sim.step()` at the right place in the order (comment at the top of `state.ts`).
5. **Commands**: a variant in `Command` and a case in `exec` ([commands.ts](../src/sim/commands.ts)). The exhaustive switch reminds you.
6. **Offline**: pick the pattern ([offline.md](offline.md)).
   - It moves items between reservoirs at a known rate → a **pseudo-flow**: add its rates to `labOut` / `pIn` in `labFlows()`, advance it in `advance()`, and add its completions to `nextEvent()`.
   - Its progress pays out over time → use an **allowance** (`⌊total · elapsed / duration⌋`), so the result is path-independent ([space.ts](../src/sim/space.ts) `advanceJob`, research `advanceProject`).
   - It happens at epoch boundaries (market settlement, a lease's hour) → run the same function in the online tick and in the catch-up loop at `now % EPOCH === 0` (`tradeEpoch`, `landEpoch`). If it can change the graph there (a lease lapsing puts buildings to sleep), materialize the groups before calling it, as `lapsing` lets the catch-up do.
   - It changes the graph (unlocks, idle → busy) → materialize, recompile, `setup()`, as the existing branches do.
7. **Save** (§8) and **hash**: add the fields to `Sim.hash()`; save → load must give the same hash.
8. **Tests**: rules; online ≈ offline (`catchUp(b, n, { noDirect: true })` vs `a.run(n)`); save → load mid-process continues bit for bit; replay (`commands.test.ts` pattern).
9. **Shell**: a `SimEvent` + handler if the player should be told (§7), an inspector panel, `FL` hooks, a smoke step.

## 7. Add a SimEvent

1. A variant in `SimEvent` ([commands.ts](../src/sim/commands.ts)): ids and numbers, no text.
2. Push it from the system: `sim.events.push({ k: '…', … })`.
3. A handler in `HANDLERS` ([app/sim-events.ts](../src/app/sim-events.ts)). It is required: the mapped type fails to compile without it. Toasts take i18n keys; bus events go in `GameEvents` ([core/bus.ts](../src/core/bus.ts)).
4. The catch-up does not emit events: if the player must hear about it after an absence, add an incident to the report ([offline/report.ts](../src/sim/offline/report.ts)).

## 8. Add a saved field

1. [src/sim/serialize.ts](../src/sim/serialize.ts): add it to the save type **as optional** (`field?:`), write it in `serialize`, read it in `deserialize` with a default (`d.field ?? default`). Old saves keep loading, and the plan's rule is never to reset a colony silently. A change that cannot default bumps `SAVE_VERSION` and adds a step to `MIGRATIONS` ([persist/migrate.ts](../src/persist/migrate.ts)).
1. Declare it in `FIELDS` ([src/sim/save-remap.ts](../src/sim/save-remap.ts)): `plain`, `index` (it holds item / building / recipe indices: remap it in `remapSave`) or `refs` (entity ids: drop what refers to a building that came down). The build fails until it is declared ([persistence.md](persistence.md)).
2. Never save what can be recomputed (graph, `Mods`, occupancy, the starting square and the sister claims' parcels, anything derived from the seeds).
3. Floats that the engine evolves (rare: a carry) round-trip exactly through JSON; save them as they are.
4. `Sim.hash()`: include the field (sorted when it comes from a Map / Set).
5. Test: save → load → same hash, then continue both copies the same number of ticks → same hash.

## 9. UI: a panel, a screen, a HUD element

- Inspector panel: [ui.md](ui.md) ("Add an inspector panel for a kind").
- Full screen: [app.md](app.md) ("Add a full screen") and [ui.md](ui.md).
- HUD element: [ui.md](ui.md).
- Every string: keys in `fr.ts` first, then `en.ts` ([i18n.md](i18n.md)).

## 10. Render: a world view, a layer, an overlay

See [render.md](render.md). In short: a `render/world/<name>-view.ts` class with `update(...)` (or `draw`), a layer from `layers.ts` (or a new `LayerName` in the right z-position, with its cross-fade), constructed in `App`'s constructor, updated in `App.drawWorld`. Flat things live in tile space under the projection `P`; volumes in iso space. Read the sim; never write it.

## 11. Input: a key, a tool

See [input.md](input.md). A key: an `Action` + binding ([input/bindings.ts](../src/input/bindings.ts)) and a case in `Controls.action` ([app/controls.ts](../src/app/controls.ts)). A tool: a `ToolState` kind with its `down` / `move` / `up` / `preview` in [input/tools.ts](../src/input/tools.ts), started from `BuildMode` ([app/build-mode.ts](../src/app/build-mode.ts)), drawn by the ghost view.

## 12. Tests, debug hooks, smoke steps

See [testing.md](testing.md): sim tests with [testkit.ts](../src/sim/testkit.ts) colonies, `FL` methods in [debug.ts](../src/debug.ts) (colony logic in [sim/dev.ts](../src/sim/dev.ts)), and smoke steps that drive the real mouse through `FL.tileToScreen` and wait on game state.

## 13. A tutorial quest

See [quests.md](quests.md) (« Add a quest »): an entry in `QUESTS` ([content/quests.ts](../src/content/quests.ts)) with CrierBelt's message, objectives, reward and guide steps; a new objective kind is read in [sim/systems/quests.ts](../src/sim/systems/quests.ts) and labelled in [ui/quest-log.ts](../src/ui/quest-log.ts); a new guide target is resolved in [ui/guide.ts](../src/ui/guide.ts); extend the scripted run in `quests.test.ts`.

## 14. Tune a number

Everything tunable is in `BAL` ([content/balance.ts](../src/content/balance.ts)) or the tables. Change it, run `npm test`: `validate.ts` and the tests that reproduce the plan's numbers tell you whether the change breaks a design rule (the tired vein, the atlas / codex uniques, the restart reserve, the elasticity examples). When a design number changes for good, update the plan too.
