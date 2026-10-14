# Content: the data tables

All game data — items, recipes, buildings, research, the shape of Ysmère and every tuning knob — is plain, typed, DOM-free TypeScript in `src/content/`, keyed by string ids, with names written inline as `{ fr, en }`.
[registry.ts](../src/content/registry.ts) compiles the tables into dense indices for the engine; [validate.ts](../src/content/validate.ts) pins the invariants the engine and the design rely on.
Content declares *what* exists; *behaviour* is selected by a building's `kind` in the sim, the renderer and the UI. The sim is described in [engine.md](engine.md), the catch-up in [offline.md](offline.md), text in [i18n.md](i18n.md), the vocabulary in [glossary.md](glossary.md).

## Where things are

| File | Holds | Read by |
|---|---|---|
| [types.ts](../src/content/types.ts) | `Loc`, `ItemDef`, `ItemKind`, `Glyph`, `RecipeDef`, `PortDef`, `BuildingDef`, `BuildingKind`, `BuildCategory`, `RouterLogic`, `ReplaceGroup`, `ResearchDef`, `Effect`, `ModTarget` | every table |
| [items.ts](../src/content/items.ts) | `ITEMS` (31 items), `ItemId` | registry, item art, terrain painter, HUD |
| [recipes.ts](../src/content/recipes.ts) | `RECIPES` (19), `RecipeId`; machine lists `KILNS`, `WORKSHOPS`, `GREAT` | registry (`CRECIPES`), inspector |
| [buildings.ts](../src/content/buildings.ts) | `BUILDINGS` (44), `BuildingId` | registry, building art, build bar |
| [research.ts](../src/content/research.ts) | The unlock tree (D33): `PLANS` (22 instant unlocks paid from the Heart, in six paths: D41), `RESEARCH` (8 trunk + 5 × 9 branch nodes), `DEPTH_COST`, `BRANCH_CORE`, `PlanId`, `ResearchId`, `PLAN_IDS`; the paths `PLAN_PATHS`, `pathPlans`, `pathEntries`, `pathProblems`; the analytics flags `ANALYTICS`, `AnalyticsFeature`; tree helpers `isPlan`, `isResearch`, `isTreeNode`, `planDef`, `researchNode`, `treePrereq`, `buildingsUnlockedBy`, `nodeName` | research runtime and modifiers, the research system (`unlockPlan`), the tech tree screen, validation, quests |
| [reserve.ts](../src/content/reserve.ts) | CrierBelt's restart reserve (D36): `BOOTSTRAP` (the stages that rebuild production from the bare land), `ESSENTIAL`, `RESERVE_PARTS`, `RESERVED`, `reserveNeed(done)`, `stagePlans(s)`, `reserveProblems()` | the reserve system ([systems/reserve.ts](../src/sim/systems/reserve.ts)), validation, the tech tree screen |
| [quests.ts](../src/content/quests.ts) | `QUESTS` (the tutorial, 0–11 in run order: CrierBelt's message, objectives, reward, guide steps), `QUEST_IDS`, `QUEST_TITLES`, `QUEST_CHECK_TICKS`, `COLONY_NAME_MAX`, `questProblems()` (in `validateContent`) | [systems/quests.ts](../src/sim/systems/quests.ts), the quest log and the guide ([quests.md](quests.md)) |
| [emblem.ts](../src/content/emblem.ts) | The claim's emblem (D58): `EMBLEM_SHAPES`, `EMBLEM_SYMBOLS`, `EMBLEM_COLORS` (art tokens by name), `isEmblem` (known parts, a symbol unlike its field), `defaultEmblem(seed)`, `emblemKey` | `Sim.setEmblem`, the register's designer, the Heart's flag ([art/emblem.ts](../src/render/art/emblem.ts)) |
| [world.ts](../src/content/world.ts) | `WORLD_SEED`, `CIRQUE`, `RINGS`, `ARCHETYPES`, `UNIQUE_BIOMES`, `T3_UNIQUES`/`T4_UNIQUES`, `COMMON_DEPOSITS`, `DEPOSIT_CHANCE`, `RICH_MULT`, `COS64`/`SIN64` | [mapgen.ts](../src/sim/world/mapgen.ts), validation, dev helpers |
| [balance.ts](../src/content/balance.ts) | `BAL`, every tuning constant | sim systems, a few views and panels |
| [registry.ts](../src/content/registry.ts) | id ↔ index maps, `CRECIPES`, `BUILDING_KIND`, `costOf`, `recipesFor`, `toMu` | sim hot paths, render, UI |
| [validate.ts](../src/content/validate.ts), [validate.test.ts](../src/content/validate.test.ts) | content invariants and designed scarcities | vitest |
| [colonies.ts](../src/content/colonies.ts), `BAL.market` | the 8 sister-colony profiles (trade lines, uniques, growth, distance bands, pinned names) and the market knobs, read by the pure market engine ([src/market/README.md](../src/market/README.md)) | `src/market/` |

## Conventions

- **Tables are `as const satisfies Record<string, XDef>`.** You get literal id types (`ItemId`, `BuildingId`, `RecipeId`, `ResearchId`) and a shape check: a bad `kind`, `glyph`, `tier` or `side` is a compile error. Cross-references are plain strings, though: item ids in costs and recipes, building ids in `machines`, tree node ids (plan or research) in `unlock` and `prereq`. `tsc` does not check them. Validation and the registry do.
- **Units.** Tables use human units: items (fractions allowed), items/min, seconds, kW, kW·min, minutes, ◉. The registry and the graph compiler turn them into engine integers: milli-items (mu), ticks (10 per second), kW·tick, ‰, centi-ocelles. `BAL` holds values in the units its comments give: ‰, ticks, items or minutes.
- **Purity and layering.** Content files import only each other. [architecture.test.ts](../src/architecture.test.ts) would also allow `core`, and nothing else. [src/sim/tsconfig.json](../src/sim/tsconfig.json) compiles `content/` with the engine and without DOM types, so the tables can run in a Worker or on Node. No `window`, `document`, pixi or i18n in here. The determinism guard in [serialize.test.ts](../src/sim/serialize.test.ts) also scans `src/content`: no `Math.random`, no clock, no transcendental `Math` (`validate.ts` included). See [../ARCHITECTURE.md](../ARCHITECTURE.md).
- **Names are data.** `name: Loc` (and `desc: Loc` on buildings and research) live in the tables. They are not i18n keys. See [i18n.md](i18n.md).
- **Order matters.** Declaration order sets the indices, the build-bar tray order and the order in which research effects apply (see *Index stability* below).

## Items — `ITEMS`

```ts
copper_wire: { name: { fr: 'Fil de cuivre', en: 'Copper Wire' }, tier: 1, kind: 'material', value: 2.2, depth: 300, glyph: 'coil', color: '#c8743a' },
```

| Field | Meaning | Who uses it |
|---|---|---|
| `name` | `{ fr, en }` | every UI surface (`itemDef(i).name[locale()]`) |
| `tier` | 1–4 | the market (event targets, T3/T4 depth ramps) |
| `kind` | `ore` `fuel` `fluid` `material` `part` `science` `unique` `energy` `module` `rubble` | `fluid`: only conduits carry it (`isFluidItem` in [chain.ts](../src/sim/flow/chain.ts)), and it is left out of cargo pickers. `unique`: counted by `uniquesNeeded`. The other kinds are descriptive. |
| `value` | reference value V in ◉ | archive notes (`noteValue`, `applyNotes` in [runtime.ts](../src/sim/research/runtime.ts)); the market's price anchor (M6). Set by hand: the "computed for crafted items" comment in `types.ts` is not implemented. |
| `depth` | NPC market depth Q, items/min (0 = not tradable) | M6 |
| `glyph` | one silhouette from the `Glyph` union | [render/art/recipes/items.ts](../src/render/art/recipes/items.ts) (`GLYPHS: Record<Glyph, …>`, so a new glyph must be drawn before it compiles) |
| `color` | fill colour | the item glyph and the deposit dots in the terrain painter ([terrain.ts](../src/render/art/terrain.ts)) |

## Recipes — `RECIPES`

```ts
wire: {
  name: { fr: 'Fil de cuivre', en: 'Copper Wire' }, machines: ['wire_mill'], seconds: 3,
  ins: [['copper_ore', 1]], outs: [['copper_wire', 2]], unlock: 'start',
},
```

| Field | Rule |
|---|---|
| `machines` | building ids of **kind `machine`**. Use the shared lists `KILNS` (2 inputs), `WORKSHOPS` (2-input crafting and up), `GREAT` (3 inputs). |
| `seconds` | Cycle at speed 1000‰. `round(seconds × 10)` ticks must divide **1 200** (`CYCLE_LCM`), so the allowed whole seconds are 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60 and 120. |
| `ins`, `outs` | `[itemId, qty]`, with at most 3 decimals (`toMu` rounds to milli-items: 0.4 → 400 mu). **Exactly one output in practice**: `MachineNode` only offers `outs[0]`, so a second output would fill its buffer and block the machine. |
| `unlock` | `'start'` or a node of the unlock tree (a plan or a research id, D33). Mention it in a research node's `desc` by hand (a plan's detail pane lists its recipes itself). |
| `energyKwMin` | Compiled to `energyKwTicks`, but no engine code reads it. The cell charger's own `kw` (300 kW × 120 s = 600 kW·min) is what is actually drawn. |

A machine's effective speed is `mods.craftSpeed`, × speed modules (+30% each, +50% with `modules2`), × `BAL.towerSpeed` for `tower_workshop`, × `mods.excavatedSpeed` when the machine stands entirely on dug floor (graph compiler). Any input port accepts any of the recipe's inputs: the machine sorts them by item (`slotOf`).

## Buildings — `BUILDINGS`

```ts
wire_mill: {
  name: { fr: 'Tréfileuse', en: 'Wire Mill' },
  desc: { fr: 'Tire deux fils de cuivre de chaque minerai de cuivre. Le cuivre du cirque est maigre : prévois d’en acheter.', en: 'Draws two copper wires from each copper ore. Copper is scarce in the cirque: plan to buy some.' },
  kind: 'machine', category: 'production', w: 1, h: 2, needsZone: true, unlock: 'wire_mill', crafts: true, kw: 60, idleKw: 6,
  cost: [['iron_plate', 15], ['glass', 4]], ports: [P(0, 1, 'S', 'in'), P(0, 0, 'N', 'out')],
},
```

- **Geometry.** `w × h` and `ports` are given at rotation 0, front facing north. A port is `P(x, y, side, io)`: a tile of the unrotated footprint, the edge of that tile it opens on, and `in` or `out`. [entities.ts](../src/sim/entities.ts) rotates ports with integer index swaps. An `out` port pushes into the tile it faces. An `in` port takes from a ribbon whose head points at it. Forks have `ports: []`: their ports come from the ribbons around them.
- **`kw` / `idleKw`.** Draw while working and while idle. A *machine* without `kw` runs off-grid: the smelter (`kiln`) burns coal as a recipe input instead. Drills and pumps produce nothing unless they are on a grid. A building with `kw`, `idleKw`, `gen` or `accumulator` takes part in power (`linkable`): it joins a grid only once the player wires it to a pillar or the Hearth (D25, [engine.md](engine.md#power)); one with none of them is never wired.
- **`pole: { range, slots, tall? }`.** A link point (D25): `range` = how far its wires reach, in tiles, footprint edge to footprint edge (a wire takes the longer range of its two ends); `slots` = how many wires it holds; `tall: true` adds `mods.pylonLink` (Reinforced Pylons, xp4) to the range. Pole 6 / 8, pylon 24 / 4 (`tall`), the Hearth 8 / 6.
- **`lift`** (D45). A `belt` that hands on to the tile ahead one level up or down: the traction ribbon (`traction_ribbon`, 30/min, plan `traction` after the router). The only way a line changes level.
- **`onRock`** (D44). The building may stand on the mountains: its whole footprint on rock (`T.Rock1`–`Rock4`), never astride a cliff (or, like any building, its whole footprint on the floor). It is a terrain rule only: since D60 a building that `needsZone` needs its parcel on rock too (the Crown lies in the starting square; a turbine on a far mountain waits for its parcel). Set on the wind turbine, the pole, the pylon, the survey beacon, the ribbons, the router, the junction, the skybridge and the incinerator. A turbine's wind there is `BAL.windRock[hardness]` (1.4–2.0), against `BAL.windCirque` (0.25) on the cirque's floor.
- **`needsZone`** (the name is the zones'; since D60 it means *on the claim's land*, [land.md](land.md)). Production, power and stores must stand wholly on parcels the claim holds (the starting square, bought, granted or leased), refusal `outside_zone`. Infrastructure may leave it: ribbons, conduits, skybridges, junctions, routing blocks, masts, pylons, beacons, the incinerator. A ribbon or conduit not wholly on the claim's land costs ×`BAL.remoteBeltCostMult` (×`mods.remoteBeltCost`). Off the claim's land construction completes after a delay that grows with the distance from the Heart's tile (`remoteBuildTilesPerSec`, `mods.remoteBuildDelay`). Nothing at all may touch a sister claim's parcel the claim does not hold (`sister_land`).
- **`cost`** is paid from the Hearth stock and refunded in full on removal. `costOf` gives the base. The placement system adds the remote multiplier (never refunded, so it must leave the restart reserve whole: D36).
- **`unlock`.** `'start'` — only the starting kit: the drill, the ribbon and the pole (D33) —, `'never'` (the Hearth, placed at founding), or a node of the unlock tree: a plan id (most early buildings; the plan usually bears the building's id, `junction` and `bridge` for the crossing and the skybridge) or a research id. A building whose unlock is reconverted away stands **dormant**: no flow node, a grey wash (plans are never lost).
- **`category`.** The build-bar tab. A tray lists its category's buildings **in declaration order**, and the first ten get digit hotkeys. Logistics, production and energy already hold nine each.
- **`desc`.** What the building is for and how to hook it up, in one or two plain sentences, and since D53 mostly a fallback: the building card shows its first sentence only when nothing on the card shows how the building works, and the inspector only for a kind with no panel ([ui.md](ui.md#the-building-card)). Show first: a recipe, a port, a rule belongs in content the card draws, not in the sentence. The card derives every figure from the other fields (power, throughput, recipes per minute, stores, reach, ports, replacement, cost), so `desc` quotes only the numbers that decide, and they are not checked: keep them in step when tuning (see *Tune a number*). How to write one, typography included: [ui.md, Writing a good `desc`](ui.md#writing-a-good-desc). `building-facts.test.ts` holds every `desc` to one or two sentences.
- **`replaceGroup`** (decision D24). This field says what a building may be placed over, and what may be placed over it. A building replaces buildings of its own group that lie wholly inside its footprint. They are refunded first, and the refund counts towards the cost. The rules are in [engine.md](engine.md#placement-and-replacement).

  | Group | Buildings |
  |---|---|
  | `transport` | every ribbon tier, the routing blocks (router, sorters, gates, unloader, distributor), `crossing` (the Junction), `skybridge` |
  | `fluid` | `conduit` |
  | `power` | `mast`, `pylon` |
  | `drill` | `drill`, `deep_bore` |

  Without a group, a building never replaces and is never replaced: machines, stores, generators, the Hearth. A new ribbon tier or routing block joins `transport`; a new conduit-like line joins `fluid`. A new group is one more string in `ReplaceGroup` (`types.ts`), and nothing else in code. Mixing groups is a design choice: a junction cannot replace a conduit, for example.

What each `kind` means. The graph compiler's switch on `BuildingKind` lives in [compile.ts](../src/sim/graph/compile.ts); placement rules live in [systems/build.ts](../src/sim/systems/build.ts).

| `kind` | ids | Engine behaviour | Kind-specific fields |
|---|---|---|---|
| `hearth` | `hearth` | Reservoir holding the base's stock (cap `BAL.hearthCap[level]`), **inputs only** (it takes, it never gives: no outlets, and unloaders against it pull nothing — D34), a built-in solar panel (`BAL.hearthSolarKw` × sun ‰ × the solar research), an isotope core (`BAL.hearthCoreKw`, day and night), and a link point (8 tiles, 6 wires); not buildable. Each level past the first lowers the land's price (`BAL.land.hearthDiscount`) | `pole`, `gen`, ports (`storageCap` is not used) |
| `beacon` | `beacon` | No node: lifts the fog within `reveal` | `reveal` |
| `drill` | `drill`, `deep_bore`, `sand_collector` | `DrillNode`: majority ore under the footprint, rate = min(`perMin`, Σ tile caps × `capMult`‰ × ring-3 bonus); needs a deposit. With `drill.ground` (the sand collector, D38): that item off the bare ground at a steady `perMin`; needs bare sand (terrain Sand, no ore) under every tile (`needs_sand`) | `drill.perMin`, `drill.capMult`, `drill.ground` |
| `pump` | `pump` | `DrillNode` of water, 60/min (hard-coded) while on or beside water | — |
| `excavator` | `excavator` | Stone reservoir (`BAL.excavatorCap`) emptied through its outlet; digging is a landscape job; full power only while busy | — |
| `backfiller` | `backfiller` | Reservoir that takes stone (`BAL.backfillerCap`); filling is a landscape job | — |
| `belt` | `ribbon`, `traction_ribbon`, `swift_ribbon`, `express_ribbon` | Chain tiles, one item per tile, a tile a step at `perMin` steps a minute (D57); drag-placed (a drag through routing blocks keeps them, across another ribbon line lays a junction); group `transport`, so they replace each other and the routing blocks | `belt.perMin` (its pace and throughput; `ticksPerTile` only for conduits) |
| `conduit` | `conduit` | Chain tiles carrying fluids only | `belt` |
| `bridge` | `skybridge` | Chain tile that leaps to the next skybridge ahead within 4 + `mods.bridgeSpan` tiles | `belt` |
| `fork` | `router`, `sorter`, `inverted_sorter`, `overflow_gate`, `underflow_gate`, `unloader`, `distributor` (category `distribution`, their own build-bar tab) | `ForkNode` in the mode of its `logic` (see engine.md « Routing blocks ») | chosen item in `cfg` byte 0 (sorters, unloader); router side filters with `forkFilters` |
| `crossing` | `crossing` | No node: items pass straight through it, for ribbons, outlets and routing blocks' sides alike (engine.md, « Graph compilation ») | — |
| `storage` | `silo` | Single-item reservoir (port rate 240/min, hard-coded) | `storageCap` |
| `dock` | `skydock` | Reservoir (`BAL.dockCap`) with unloader ports; drifters and freight routes | — |
| `machine` | kilns, `wire_mill`, workshops, `ceramic_oven`, `cell_charger` | `MachineNode` running the recipe stored in `cfg` | listed in recipes' `machines`; `crafts: true` (never read) |
| `lab` | `observatory` | Reservoir that takes the science its project still owes; one research slot per observatory | — |
| `generator` | `brazier`, `sunheart` | `GeneratorNode`: burns `gen.fuel` ∝ dispatch; output `gen.kw` × `mods.genOut` | `gen.kw`, `gen.fuel`, `gen.fuelPerMin`, an `in` port. Without `fuel`, compilation throws. |
| `wind` / `solar` / `geothermal` | `wind_flower` / `sun_bulb` / `fumarole_tap` | Grid producers only: `gen.kw` × mods × local wind / sun; geothermal needs every footprint tile on a vent | `gen.kw` |
| `accumulator` | `accumulator` (the accumulator) | Grid storage: `kwMin × 600` kW·tick × `mods.accCap`, rate `kw × mods.accRate` | `accumulator` |
| `pole` | `mast`, `pylon` | Pillars: link points the player wires to each other, to the Hearth and to buildings (grids = the wires' components, D25); a new one wires itself to the nearest pillar or Hearth in reach with a free slot | `pole.range`, `pole.slots`, `pole.tall` |
| `trade` | `trade_post` | `ConsumerNode`: draws `idleKw`, accepts nothing (M6) | — |

Ids special-cased in code: `hearth` (founding), `tower_workshop` (×`BAL.towerSpeed`), `drill` and `excavator` (rotation variants in art), and the items `stone`, `water`, `pace_bell`, `iron_ore` and `copper_ore` in the sim. Map generation keeps a per-item base richness, and the HUD keeps an `ORDER` list. The ribbon drag's auto-junction lays the building of kind `crossing`, found by kind, not by id (`planBelts` in [systems/build.ts](../src/sim/systems/build.ts)). The waystation (`outpost`, its own kind) was retired with the influence zones (D60): its id lives on only in `RETIRED_COSTS` and the save v3 migration (`zonesToParcels`).

## The unlock tree — `PLANS` and `RESEARCH` (D33)

Everything a base uses beyond its starting kit is unlocked in **one tree with two kinds of node**, which share one id space (a building's or a recipe's `unlock` names either) and one set in the colony, `sim.done` (saved, hashed). The tech tree screen draws both ([ui.md](ui.md#the-tech-tree-screen)).

| | Plans — `PLANS` | Research — `RESEARCH` |
|---|---|---|
| Paid with | materials from the Heart, at once (`cost`, whole items) | data, by an observatory, under the allowance, over a minimum time |
| Taken by | the `unlockPlan` command (one click in the tree) | `startResearch` in an idle observatory |
| Rows in the tree | `lane`, its path (D41): `production`, `logistics`, `energy`, `analytics`, `trade`, `survey` | `branch`: the trunk, `ex`, `xp`, `dn`, `en`, `cm` |
| Prerequisites | plan ids (research ids are allowed) | research ids; the branch roots and `tr1` need the observatory's plan |
| Lost by a reconversion | never | yes, its branch |

### Plans — `PLANS`

```ts
router: plan('logistics', [], [['iron_plate', 5]]),
observatory: plan('production', ['workshop'], [['iron_plate', 20], ['copper_wire', 4]]),
telemetry: plan('analytics', [], [['iron_plate', 8], ['copper_wire', 2]], { name, desc, effects: [flag('telemetry')] }),
```

- **The starting kit** is what carries `unlock: 'start'`: the drill, the ribbon and the pole (and the Link tool, which is no building). Everything else a new base uses is a plan, including features with no building: the **analytics** readouts (below).
- **Fields.** `lane` (its path, the band it is drawn in), `prereq`, `cost`, optional `effects` (the research `Effect` kinds; a feature is a `flag`), optional `name` and `desc` — omitted, the plan shows its building's name and description. A plan with no building must give both (validated).
- **Declaration order** follows the paths (`PLAN_PATHS` order, top to bottom on the tree), so the first plan ready to take is the topmost one.
- **What a plan unlocks** is not listed on it: every building and recipe whose `unlock` is its id (`buildingsUnlockedBy`), plus its effects. Its id must not be a research id, `start` or `never`.
- **Costs.** Early materials only (plates, glass, copper wire), so a plan never waits on research. The root plans are cheap: the starting stock (`BAL.startStock`) pays for all of them at once and still keeps CrierBelt's restart reserve (pinned by [validate.test.ts](../src/content/validate.test.ts); D36: [the restart reserve](#the-restart-reserve--bootstrap-d36)); costs grow with depth.
- **Effects** of plans apply before research's, in `PLAN_IDS` order ([modifiers.ts](../src/sim/research/modifiers.ts)).

The plans as built, path by path in the tree's order (← prerequisite):

| Path | Plans and costs (plates · glass · copper wire) |
|---|---|
| Production · « Fondre et fabriquer » | Fonderie `kiln` 10 p · Collecteur de sable `sand_collector` ← kiln: 5 p · Atelier `workshop` ← kiln: 15 p, 2 g · Tréfileuse `wire_mill` ← kiln: 15 p · Observatoire `observatory` ← workshop: 20 p, 4 w — research hangs from it |
| Logistique · « Déplacer et trier » | Routeur `router` 5 p · Croisement `junction` (the crossing) ← router: 5 p · Trieur `sorter` ← router: 6 p, 2 w · Silo `silo` ← router: 8 p, 2 g · Passerelle `bridge` (the skybridge) ← junction: 6 p, 2 w · Trieur inversé `inverted_sorter` ← sorter: 6 p, 2 w · Vanne de trop-plein `overflow_gate` ← sorter: 6 p, 2 w · Déchargeur `unloader` ← silo: 6 p, 2 w (unloaders pull from stores, never from the Heart: D34) · Vanne de sous-débit `underflow_gate` ← overflow gate: 6 p, 2 w. Cheap on purpose (owner, 2026-10-12: "most of the logistics is too expensive") |
| Énergie · « Produire l’énergie » | Éolienne `wind_flower` 10 p · Générateur à charbon `brazier` ← wind turbine: 15 p, 2 w |
| Analytique · « Voir ta base » | Télémétrie `telemetry` 8 p, 2 w · Registre de production `statistics` ← telemetry: 10 p, 4 w · Relevé d’énergie `power_log` ← statistics: 12 p, 2 g, 4 w · Diagnostic `diagnostics` ← power log: 15 p, 2 g, 6 w |
| Commerce · « Vendre et acheter » | Comptoir `trade_post` ← telemetry (the path's entry hangs from the analytics': know your rates, then sell): 20 p |
| Arpentage · « Explorer le terrain » | Balise d’arpentage `beacon` 8 p, 2 g |

### Paths and the Analytics path (D41)

The plans grow in **paths of one theme each** (`PLAN_PATHS`, a plan's `lane`), drawn as bands of their own colour on the tree ([ui.md](ui.md#the-tech-tree-screen)). A path reads as one line: it grows from **one entry** (`pathEntries`: a root plan, or one hanging from another path's plan, like the trade post from the telemetry), and every other plan of it hangs from a plan of the same path, without a loop. `pathProblems()` checks it in `validateContent`; [validate.test.ts](../src/content/validate.test.ts) pins the six paths, their entries and their order.

**Analytics** holds everything that shows the player information about the base, one readout per step. Each analytics plan turns on exactly one flag, its own id; `ANALYTICS` names them by readout, and the UI reads them only through `analyticsOn(sim, feature)` ([ui/analytics.ts](../src/ui/analytics.ts)):

| Step | Flag (`ANALYTICS` key) | Turns on |
|---|---|---|
| Télémétrie | `telemetry` (`rates`) | the Δ/min beside each stock in the HUD. The id is kept: saves hold it, and the tutorial's quest 2 asks for it |
| Registre de production | `statistics` (`ledger`) | the Statistics screen (G) and its chip in the HUD |
| Relevé d’énergie | `power_log` (`power`) | the power history in the Statistics: demand against what is available |
| Diagnostic | `diagnostics` (`machines`) | the machines' states in the Statistics: how many run, wait for inputs, are blocked, unpowered or unwired, and which (`machineStates`) |

Unlocking one plays its reveal (the base dims around the new readout, CrierBelt says what it is: [ui.md](ui.md#the-spotlight-d41)). Readouts that stay free: the stock amounts, the ◉ and its ◉/h, the power % and its tooltip, the clock, the land mode (I) and the power overlay (P), the inspector and the building card. F (`ovFlow`) is bound to a flow overlay that does not exist yet; when it does, it is a natural next analytics step (a plan, its flag in `ANALYTICS`, a reveal in `ANALYTICS_REVEALS`).

The distributor, the swift and express ribbons, the compact machines, the great workshop, the pylon and everything later stay behind their research.

### Research — `RESEARCH`

Nodes are built with two helpers:

```ts
dn1: node('dn', 1, ['Tissage', 'Ribbon Weave'], ['Débloque le Ruban vif (120/min).', 'Unlocks the Swift Ribbon (120/min).']),
tr5: trunk(5, ['tr4'], [['journal_2', 100]], 120, ['Deuxième pupitre', 'Second Desk'], [...], [{ k: 'slots', add: 1 }]),
```

- **`node(branch, depth, name, desc, effects)`** derives everything else. The id must be `<branch><depth>`, or `<branch>K` for the keystone (depth 9). Prerequisites are the previous depth of the branch (8 for the keystone; the observatory's plan for depth 1) plus a trunk gate: depth ≥ 3 needs `tr1`, ≥ 5 `tr6`, ≥ 7 `tr8`. Cost and minimum minutes come from `DEPTH_COST[depth]`: from 25 survey journals and 3 min at depth 1 up to 300 atlases + 150 codex and 24 h for the keystone. Each branch is a straight line of 9 nodes.
- **`trunk(depth, prereq, cost, minutes, name, desc, effects)`** is fully explicit (`tr1` needs the observatory's plan). The trunk escapes the spreading penalty.
- **Branches.** `ex`, `xp`, `dn`, `en`, `cm`, plus `trunk`. Display names are i18n keys `research.branch.<b>`. `BRANCH_CORE` names the stat that mastery boosts: +`initiateBonus`‰ at 3 nodes, +`masterBonus`‰ at 6 (`slippage` is lowered instead of raised).
- **Effects** (`Effect`). `mul` (target ×permille), `add` (target + v), `flag` (a free string the sim tests with `mods.flags.has`) and `slots` (+research slots). They compile into `Mods` in [modifiers.ts](../src/sim/research/modifiers.ts), applied **in `PLAN_IDS` then `RESEARCH_IDS` order with a floor after each step**. The `unlock` effect kind exists in the type but is ignored. Unlocks come only from the `unlock` field of buildings, recipes and `BAL.hearthUpgrades`.
- **Land research** (D60, [land.md](land.md#research)): `tr4` « Cadastre » / Land Registry (it was Waystations) gives `flag('lease')`, and still opens the Heart's level 3; `xp1` Boundary Stones `mul('landPrice', 850)`; `xp2` Drone Relays halves `remoteBeltCost` and `remoteBuildDelay` (off the claim's land); `xp3` Land Charter `add('landGrowth', -40)` (each parcel bought raises the next one's price 6 % instead of 10 %); `xp7` Federation `mul('landRent', 700)` and `add('landGrowth', -20)`; `xp8` Far Claims `mul('farLand', 700)` (land whose centre lies past `BAL.land.farRadius`) beside `ring3Caps`; `xpK` Caravan City `mul('landRent', 800)` beside `drifterDistance`.
- **Costs at run time.** `cost = ⌈base × (1 + 0.12·N_others) × (1 − 0.04·min(n_branch, 8))⌉`, `time = D × (1 + 0.05·N_others) × 0.85 if n_branch ≥ 6`, in `effectiveCost` ([runtime.ts](../src/sim/research/runtime.ts)). The knobs are in `BAL`; projects and the allowance are covered in [engine.md](engine.md).

## The restart reserve — `BOOTSTRAP` (D36)

A base must always be able to rebuild its production (owner, 2026-10-12: the tutorial let a player spend everything on plans and be left with no plates and nothing to make them). [reserve.ts](../src/content/reserve.ts) says what rebuilding takes; the engine guards it ([engine.md](engine.md#crierbelts-restart-reserve-d36)).

```ts
export const BOOTSTRAP: readonly BootStage[] = [
  { makes: ['iron_plate', 'glass'], builds: [['drill', 3], ['kiln', 1], ['mast', 2]] },
  { makes: ['copper_wire'], builds: [['drill', 1], ['wire_mill', 1], ['mast', 2]] },
];
```

- **The bootstrap** is the production a base rebuilds from the bare land, in stages built in order. Stage 1, the smelter line: drills on iron, coal and sand, one smelter (plates, then glass: it switches recipe), two poles to reach the deposits beyond the Heart's 8-tile wires. Stage 2, the copper line: a drill on the copper vein, a wire mill, two poles. A stage's plans are its buildings' unlocks and their prerequisites (`stagePlans`: `kiln`, then `wire_mill`).
- **Essential items** (`ESSENTIAL`): what the stages make, iron plates, glass and copper wire. They are what a base can always make again, and every plan and the starting kit are paid in them.
- **The reserve** (`reserveNeed(done)`, share by share in `RESERVE_PARTS`): what the stages cost from the Heart's stock. That is every stage's buildings and the plans it still needs, without the items an earlier stage makes, since the base can wait for those. At founding: 59 plates, 6 glass, 4 copper wire (stage 1 in full; of stage 2, only its poles' copper wire, because nothing else makes copper wire). The smelter's plan takes its 10 plates with it once it is unlocked (49). `RESERVED` lists the items kept.
- **Pole counts** depend on the map. [reserve.test.ts](../src/sim/systems/reserve.test.ts) rebuilds a base holding exactly the reserve on the real cirque for 24 players (each player's deposits are jittered ±1 tile), at noon and at midnight, and fails if a stage needs more poles than it lists. On 80 players no stage needed more than 2.
- **Changing it.** A new cost on a bootstrap building or plan raises the reserve by itself. Validation then checks that the starting stock still covers it, with the first ring of plans bought, and `validate.test.ts` pins 59 / 6 / 4. A bootstrap building that moves behind research, a plan or start-kit cost in a material the bootstrap does not make, or a stage that no longer makes what it says each fails `reserveProblems` with its reason. If the cirque's deposits move, run the reserve test: it recounts the poles.

## World — `world.ts`

Pure data that [mapgen.ts](../src/sim/world/mapgen.ts) turns into tiles. `WORLD_SEED` is shared by every colony. `CIRQUE` is the common basin (D40: a third of its first area): floor radius 23, the Crown to 32 (H1 to 28, H3 from 37), the rim's jitter, the pass directions in 64ths of a turn, the four starting deposits (`rich` = per-tile cap in 10 mu per epoch, so 75 → 0.75 ore/min; sand is the ground, not a deposit) and the lake. Moving a deposit: the coal must stay beyond the Heart's 8-tile wire (quest 3's pole) and a whole coal and copper drill spot within r 18 of the Heart (the early reach the tutorial expects, well inside the starting square); `mapgen.test.ts` checks both on the real map, and `reserve.test.ts` the poles each bootstrap stage needs. `RINGS` gives the ring radii and the blend zone between world noise and player noise. `ARCHETYPES` holds the five per-player environments, each with `{ fr, en }` name and description. `UNIQUE_BIOMES` holds the six unique-resource sites; their `item` is automatically a raw item for validation. `COMMON_DEPOSITS` weights the deposit blobs beyond the Crown, and `DEPOSIT_CHANCE` and `RICH_MULT` scale them by ring. `COS64`/`SIN64` is an integer trig table, so map generation stays transcendental-free. Archetype and biome names are not displayed yet.

## Registry — ids and indices

Content is keyed by string ids. The engine works on **dense indices**: the position of the id in its table.

| Export | What |
|---|---|
| `ITEM_IDS`, `RECIPE_IDS`, `BUILDING_IDS`, `RESEARCH_IDS` | ids in declaration order (index → id) |
| `itemIdx`, `recipeIdx`, `buildingIdx`, `researchIdx` | id → index; **throw** on an unknown id |
| `hasItem`, `hasBuilding`, `hasRecipe`, `hasResearch` | non-throwing checks |
| `itemDef(i)`, `buildingDef(i)`, `recipeDef(i)`, `researchDef(i)` | index → definition |
| `N_ITEMS` | length of every per-item array (`Float64Array(N_ITEMS)` stocks, stats, reservoir stores) |
| `CRECIPES: CRecipe[]` | recipes precompiled once at import: `ticks = round(seconds × 10)`, inputs and outputs as `{ item: index, mu }`, `energyKwTicks`, `machines: Set<building index>`, `unlock`. Unknown ids throw **when the module loads**. |
| `recipesFor(building)` | the recipes a machine can run (inspector picker) |
| `costOf(building)` | base cost as `{ item, mu }[]` (no remote ×3) |
| `BUILDING_KIND[def]` | the `BuildingKind` per building index (cheap kind tests in hot code) |
| `isBeltDef(id)` | kind `belt` or `conduit`: laid by dragging (drag tool, ghost). What a building may replace is its `replaceGroup` |
| `toMu(items)` | items → milli-items (exact up to 3 decimals) |

**Why indices.** The tick loop and the catch-up use typed arrays indexed by item (stocks, buffers, produced/consumed counters), integer edges and integer `cfg` words. Comparing small integers is cheap, hashing them is stable, and saves stay compact. String ids remain at the edges: content tables, commands (`place('kiln', …)`, `setRecipe(id, 'plate')`), the debug handle and saved research ids.

**Index stability.** A save ([serialize.ts](../src/sim/serialize.ts)) stores raw indices: entity `def`, per-item stock and store arrays, machine `cfg` (recipe index + 1), fork filters (item index + 1), unloader `portItems`, ore diffs of terrain chunks, route items, project costs. Since D47 it also carries the table they refer to (`SaveData.content`: item, building and recipe ids in order, each recipe's inputs and outputs). Loading re-points every index by id ([sim/save-remap.ts](../src/sim/save-remap.ts), [persistence.md](persistence.md)), so **inserting or reordering entries is free**. Renaming or removing an id is not:
- A **renamed** id goes in `RENAMED` ([content/retired.ts](../src/content/retired.ts)).
- A **removed** building goes in `RETIRED_COSTS` (saves that hold one get its cost refunded).
- A recipe whose inputs or outputs change resets the machines that ran it, and their buffers go to the Heart.
- What cannot be mapped is listed on the player's absence report.

Research is saved by id, but its order still changes the `Mods` values (floors per step).

## Balance — `BAL`

One object, so balancing is one diff. The values are engine-facing integers (‰, ticks, items); check each knob's comment for its unit. `BAL.market` is the exception: the market computes in floats and only hands integers to the sim.

| System | Knobs | Read by |
|---|---|---|
| Founding | `startStock`, `startCredits` (◉, stored ×100), `startReveal` | colony constructor ([state.ts](../src/sim/state.ts)) |
| Hearth and stores | `hearthCap[level]`, `hearthSolarKw` (its solar panel's peak, 240 kW: two drills and a wire mill by day, nothing at night), `hearthCoreKw`, `hearthPortPerMin` (the trade posts' outlets; the Hearth has none), `hearthUpgrades` (unlock and cost of levels 2–4) | colony stock cap; graph compiler; [systems/build.ts](../src/sim/systems/build.ts) and the Hearth inspector panel |
| Machines and buffers | `inBufCrafts`, `outBufCrafts`, `drillBufItems`, `forkBufItems`, `towerSpeed` | [nodes.ts](../src/sim/flow/nodes.ts); graph compiler |
| Ribbons | `beltDensity`, `runSpanTicks`, `remoteBeltCostMult` | [chain.ts](../src/sim/flow/chain.ts), graph compiler, items view; placement |
| Power | `windCirque`, `windPlain`, `windMesa` (only `[0]` is read) | graph compiler (local wind) |
| Land and remote building (D60, [land.md](land.md)) | `land`: `parcel` (16 tiles a side), `base` and `tile` (centi-◉: every parcel, then per tile by ground), `depositPerValue` (per deposit tile and point of ore value, at richness 500), `growth` (‰ per parcel bought: the base of `mods.landGrowth`), `hearthDiscount` (‰ off per Heart level past the first), `rentPermille` (of the price, an hour), `sisterShare` (‰ of the parcels past the starting ring a sister claim owns), `sisterMarkup` (‰ by claim), `farRadius` (Far Claims); `landReveal` (fog lifted round a parcel newly held), `remoteBuildTilesPerSec` | [world/land.ts](../src/sim/world/land.ts), [systems/land.ts](../src/sim/systems/land.ts); placement; [modifiers.ts](../src/sim/research/modifiers.ts) |
| Research | `spreadCostPerNode`, `depthDiscountPerNode`, `spreadTimePerNode`, `masterTimeFactor`, `respecRefund`; `initiateBonus`, `masterBonus`; `respecCooldownDays` (not read) | [runtime.ts](../src/sim/research/runtime.ts); [modifiers.ts](../src/sim/research/modifiers.ts) |
| Market | `tradeFee` (`[0]` is the base of `mods.tradeFee`), `tradeThroughput`, `liftDelayMin` (not read until the trade post is wired, M6); `BAL.market` (floats by design, read by `src/market/`) | modifiers; the market |
| Digging and landfill | `digMinutes`, `digRubble`, `embedIron`(`Items`), `embedCopper`(`Items`), `fillSeconds`, `fillRubble`, `digReach`, `fillReach`, `excavatorCap`, `backfillerCap` | [space.ts](../src/sim/space.ts), [systems/landscape.ts](../src/sim/systems/landscape.ts), graph compiler (caps), the reach rings in overlays, build mode and inspector |
| Drifters | `dockShips`, `dockCap`, `drifterCap`, `drifterTilesPerMin`, `drifterLoadMin`, `drifterCost` | space.ts, graph compiler, [systems/freight.ts](../src/sim/systems/freight.ts) (purchase) and placement (refunds), drifters view, dock panel |
| Offline | `reservoirMargin` | [catchup.ts](../src/sim/offline/catchup.ts) |

The item ids inside `BAL` (`startStock`, `drifterCost`, `hearthUpgrades`) are typed as wide `Record<string, …>` and are not validated. A typo throws when used (`itemIdx`). An unknown `hearthUpgrades[].unlock` silently keeps that level locked forever.

## Validation — `validateContent()`

`validateContent()` returns a list of error strings. [validate.test.ts](../src/content/validate.test.ts) expects it to be empty and pins the scarcity numbers, and `main.ts` runs it at startup in development and throws on any problem.

| Invariant | Why it exists |
|---|---|
| Recipe items, machines and unlocks are known | The registry would throw at import; the test names the culprit. |
| Every recipe cycle (`round(seconds × 10)` ticks) divides 1 200 | A full-speed group then repeats with a short exact period. The offline warm-up searches for periods of up to `PERIOD_MAX` = 2 400 ticks ([offline.md](offline.md)). |
| Building unlocks and cost items are known | An unknown cost item would throw only when the building is first priced; an unknown unlock would lock it forever, silently. |
| Every port sits inside the footprint, on the edge its `side` names | A port must open onto a tile outside the building, where a ribbon can stand. An inner port could never connect. |
| Tree nodes' prerequisites and cost items are known; a plan id never shadows a research id, `start` or `never`; every plan has a whole-item cost, unlocks something (a building, a recipe or an effect) and names itself when it has no building | An unknown prerequisite would block a node forever; a plan without a building would have no name to show (D33). |
| No loop across plans and research (DFS), and every node reachable from the roots | The tree must be a DAG that the player can complete. |
| Paths (`pathProblems`, D41): every plan on a listed path, every path used; each path grows from exactly one entry and reaches all its plans through prerequisites on the same path, without a loop; an analytics plan turns on exactly its own flag, and `ANALYTICS` names each analytics plan once | The tree reads as separate lines of one theme each; a readout the UI gates on can never lose its plan. |
| Every building and recipe is reachable: `start`, `never` or a node the tree reaches; every Heart level's unlock is a known node | Nothing can sit out of the player's reach, silently. |
| The tutorial unlocks before it uses: every building, routing block and recipe a guide step points at is in the starting kit or unlocked by an earlier `unlock` step or `unlocked` objective (`questProblems`) | The tutorial never asks for something the player cannot have yet (D33). |
| No dead end (`reserveProblems`, D36): each bootstrap stage makes what it says, with its own machines, on recipes the start or its plans unlock (never research), from the cirque's deposits under its own drills; the reserve keeps only what the bootstrap makes; every plan and the starting kit are paid in those materials; the starting stock covers the reserve, even with the whole first ring of plans bought; a trade post against the Heart leaves at least the reserve (its stream reserve `tradeHearthReserve` plus its own cost); the Heart's core gives power at night (`hearthCoreKw > 0`) | A base can always rebuild its production, so the engine's guard has something to keep. The first ring of plans never meets a refusal. |
| Every item can be produced from `RAW` (the land: deposits, digging, pumping, unique biomes) through recipes | No dead items and no unbuildable costs. |
| Every science item that research asks for can be produced | Same reason. |
| `tiredVeinPerMin() × 2 < wirePerMechanicsWorkshop()`, pinned at 6.75 ore/min → 13.5 wire vs 18 | Design: the cirque's « filon fatigué » cannot feed one mechanics-journal workshop, so copper ore must be imported from T2. |
| `uniquesNeeded('atlas') ≥ 2`, `uniquesNeeded('codex') === 5` (pinned at 2 and 5; `journal_2` needs 0) | Each colony reaches about two uniques, so T3 and T4 require trade. |

Not validated, though the engine relies on it: a recipe has exactly one output; recipe `machines` are of kind `machine` and have enough input ports; kind-specific fields are present (`belt`, `pole`, `gen.fuel`…); `RAW` lists every land-sourced item (the list is hand-maintained); descriptions match the actual unlocks and numbers.

## Who reads what

| Layer | Reads | Where |
|---|---|---|
| Graph compiler | `BUILDING_KIND`, `buildingDef` (`belt`, `gen`, `drill`, `pole`, `accumulator`, `storageCap`, `kw`), `CRECIPES` by `cfg`, `BAL` | [compile.ts](../src/sim/graph/compile.ts), [entities.ts](../src/sim/entities.ts) (ports), [links.ts](../src/sim/power/links.ts) and [network.ts](../src/sim/power/network.ts) (wires, grids) |
| Flow nodes | `CRecipe`, `N_ITEMS`, item `kind` (fluids), buffer knobs | [src/sim/flow/](../src/sim/flow/) |
| Systems | unlocks, costs, `needsZone`, kind placement needs, `replaceGroup` (and ports, footprint, kind, `logic`: whether turning a building matters), `reveal`, recipes' `machines`, dig, fill, land and drifter knobs | [src/sim/systems/](../src/sim/systems/), [space.ts](../src/sim/space.ts), [world/land.ts](../src/sim/world/land.ts) |
| The tree | `PLANS`, `PLAN_IDS`, `RESEARCH`, `RESEARCH_IDS`, `BRANCH_CORE`, item `value` (notes); `planDef`, `isPlan` (`sim.unlocked`, `unlockPlan`) | [src/sim/research/](../src/sim/research/), [systems/research.ts](../src/sim/systems/research.ts), [state.ts](../src/sim/state.ts) |
| World generation | `world.ts` tables, item indices | [mapgen.ts](../src/sim/world/mapgen.ts) |
| Art | `BUILDINGS` (w, h, ports) plus one drawing per id; `ITEMS` (glyph, colour); belt tiers per id | [render/art/recipes/](../src/render/art/recipes/), [atlas.ts](../src/render/art/atlas.ts), [render.md](render.md) |
| World views | `BUILDING_KIND` (belts and conduits drawn as belt pieces), reach and drifter knobs | [render/world/](../src/render/world/) |
| UI | names, categories (tray order), costs, unlocks, `recipesFor`, the tree (plans' and research's names, descs, lanes, prerequisites, costs, effects — the tech tree screen lays it out from content); building `desc` and, for the building card, nearly every building field (`kw`/`idleKw`, `gen`, `accumulator`, `belt`, `drill`, `storageCap`, `reveal`, `pole`, `logic`, `ports`, `needsZone`, `replaceGroup`) with the `BAL` knobs behind them | [build-bar.ts](../src/ui/build-bar.ts), [building-facts.ts](../src/ui/building-facts.ts) and [building-card.ts](../src/ui/building-card.ts), the inspector's panels for the kind ([src/ui/inspector/](../src/ui/inspector/)), HUD, research and stats screens, [tip.ts](../src/ui/tip.ts), artboard, [ui.md](ui.md) |
| Input and shell | `isBeltDef` (drag tool, ghost), `costOf` previews, reach rings, `isoHead` (picking) | [tools.ts](../src/input/tools.ts), [src/app/](../src/app/), [input.md](input.md), [app.md](app.md) |

## How to…

### Add an item
1. Append an entry to `ITEMS`: `name`, `tier`, `kind`, `value`, `depth`, `glyph`, `color`.
2. For a new silhouette, add it to the `Glyph` union in `types.ts` and draw it in `GLYPHS` ([items.ts art](../src/render/art/recipes/items.ts)); the `Record<Glyph, …>` type makes this mandatory.
3. Make it producible. A crafted item needs a recipe (next section). A land-sourced item must be added to `RAW` in `validate.ts` and to world generation. For a deposit, that means `COMMON_DEPOSITS` or `CIRQUE.deposits` plus the per-item base richness that [mapgen.ts](../src/sim/world/mapgen.ts) hard-codes (default 500). A unique needs an `UNIQUE_BIOMES` site, which also makes it raw. A fluid uses `kind: 'fluid'` and travels by conduit only.
4. Optionally, add it to the early-chain `ORDER` list in [hud.ts](../src/ui/hud.ts); otherwise it appears in the HUD once held. Statistics, the cargo pickers and the art atlas pick it up automatically.
5. If it is tradable (`depth > 0`), the market expects at least one sister-colony supplier and one buyer for it in [colonies.ts](../src/content/colonies.ts) (secondary trade lines of weight 1 cover the goods the plan's table leaves out).
6. Run the content tests. If it changes atlas or codex chains or copper wire, re-check the scarcity pins.

### Add a recipe
1. Append to `RECIPES`: `machines` (ids of kind `machine`, usually `KILNS`, `WORKSHOPS` or `GREAT`), `seconds` from the divisor list, one output, quantities with at most 3 decimals, `unlock`.
2. If it is gated, name it in the unlocking node's `desc` (fr and en).
3. That is all. The inspector lists it via `recipesFor`, `setRecipe` checks `machines` and `unlock`, and the art has nothing to do. Append rather than insert: machines store the recipe index in `cfg`.

### Add a building
Content side:
1. Append to `BUILDINGS` with `name`, `desc`, `kind`, `category`, `w`, `h`, ports at rotation 0, `kw`/`idleKw`, `needsZone`, `cost`, `unlock` and the kind-specific fields from the table above. Its tray slot follows its position. A new ribbon tier, routing block, mast or drill also needs the matching `replaceGroup`, so that it can be placed over its kind and its kind over it.
2. For a machine, add its id to the `machines` of the recipes it runs (the `KILNS` / `WORKSHOPS` / `GREAT` lists).
3. For a gated building, set `unlock` to the node id and mention it in the node's `desc`.
4. Numbers that players will tune go to `BAL`.

Other touch points (grep an existing comparable id or kind):
5. Art, always: an iso drawing in [buildings.ts art](../src/render/art/recipes/buildings.ts) (`R[id]` with its `head`, which picking also uses) and a plan drawing in [buildings-top.ts](../src/render/art/recipes/buildings-top.ts). Both fall back to a generic violet dome, so a missing drawing is ugly, not an error. Rotation variants are baked when the building has ports or is not square (`needsRotations*`). The build-bar icon is the plan sprite. Belt-like ids also need a `BELT_TIERS` entry ([belts.ts](../src/render/art/recipes/belts.ts)); `isBeltDef` (registry) keeps them out of the building frames and the artboard everywhere.
6. Text: name and desc are inline; the desc is what the building card says first ([ui.md](ui.md#writing-a-good-desc)), and the card's figures follow from the fields (a new kind needs its rows in `building-facts.ts`). Any new panel line, status or refusal reason needs keys in [fr.ts](../src/i18n/fr.ts) and [en.ts](../src/i18n/en.ts) ([i18n.md](i18n.md)).
7. **A new `kind` only:**
   - `BuildingKind` in `types.ts`.
   - The graph compiler's switch on `BuildingKind` (flow node), its power pass (producers and accumulators) and `refundNode` (buffered items).
   - A node class in [nodes.ts](../src/sim/flow/nodes.ts) plus `NodeKind` in [node.ts](../src/sim/flow/node.ts). It must hash, snapshot and restore; a reservoir also needs its virtual mode for the catch-up ([engine.md](engine.md), [offline.md](offline.md)).
   - Placement needs and cost rules in [systems/build.ts](../src/sim/systems/build.ts): a new `PlaceReason` needs a `reason.*` key.
   - Per-tick behaviour in a `src/sim/systems/*` module and its pseudo-flow counterpart in the catch-up.
   - Pole or producer handling in [network.ts](../src/sim/power/network.ts).
   - The world views: belt pieces, items on belts, reach overlays ([render/world/](../src/render/world/)).
   - The drag tool for belt-like kinds: `isBeltDef` in the registry covers `belt` and `conduit` only ([tools.ts](../src/input/tools.ts), ghost view).
   - The build-mode previews ([src/app/](../src/app/)).
   - The inspector's panels for the kind ([src/ui/inspector/](../src/ui/inspector/)); a kind without an entry shows only the common parts.
8. Tests: content validation (ports, unlock, cost items), a behaviour test in `src/sim/*.test.ts` built with [testkit.ts](../src/sim/testkit.ts), and a smoke step if it belongs to a milestone flow ([testing.md](testing.md)). Check the sprite on the artboard.

### Add a research node or an effect
1. A branch node: `xyN: node('xy', N, [fr, en], [fr, en], effects)` (`xyK` for depth 9). Prerequisites, cost and time follow. A trunk node: `trunk(…)` with explicit values. Append it: application order matters.
2. Unlocks are set on the unlocked building, recipe or `BAL.hearthUpgrades` entry, never as an effect. Describe them in `desc`. A new effect target or flag also wants an icon in the tree screen's `EFFECT_ICON` ([research.ts screen](../src/ui/screens/research.ts)); without one the node shows the observatory.
3. A new **multiplier or additive target**:
   - add it to the `ModTarget` union in `types.ts`;
   - add it to the `targets` list in `baseMods()` ([modifiers.ts](../src/sim/research/modifiers.ts)): the default is 1000‰, or 0 if listed in `ADDITIVE`; a BAL-based start goes after the defaults, like `tradeFee` and `landGrowth`. Without it the value is `undefined` and turns to `NaN`;
   - read `sim.mods.<target>` where the behaviour lives. Research completion recomputes `Mods` and recompiles the graph (`rebuildDerived`).
4. A new **flag** is a free string. Test it with `mods.flags.has('…')` in the consumer; a typo is a silent no-op.
5. A new **branch** touches the `branch` union (`types.ts`), `Branch` and `BRANCH_CORE` (`research.ts`), `BranchId`, `BRANCHES` and `branchCounts` ([runtime.ts](../src/sim/research/runtime.ts)), `perBranch` (`modifiers.ts`) and a `research.branch.<b>` key. The tech tree screen builds its research lanes from `BRANCHES` (a lane colour in `screens.css`).
6. Tests: validation (prereqs, loops, reachability, producible costs) and [research.test.ts](../src/sim/research/research.test.ts), which pins `DEPTH_COST[7]` and the spreading knobs through the en7 example.

### Add a plan
1. Add it to `PLANS` (in [research.ts](../src/content/research.ts)) among its path's plans: `plan(lane, prereq, cost, more?)`, the lane being its path (D41); it must hang from a plan of the same path unless it is the path's entry (validated). Give its building `unlock: '<plan id>'` (usually the building's own id). A feature plan (no building) needs `name`, `desc` and `effects`; its consumer tests the flag (`mods.flags.has`), and its icon goes into the tree screen's `EFFECT_ICON`. An analytics step: its flag is its id, listed in `ANALYTICS`, read through `analyticsOn`, with a reveal in `ANALYTICS_REVEALS` (ui/analytics.ts) and a `focus.<id>` caption.
2. Keep root plans affordable from the starting stock together while keeping CrierBelt's restart reserve, and costs in the bootstrap's materials (plates, glass, copper wire). Both are validated (D36).
3. That is all for the engine: `unlockPlan` pays and records it, `sim.unlocked` and the build bar follow, the tree screen places it from its prerequisites and lane. If the tutorial uses the building, add an `unlock` step before the step that builds it (validated).
4. Tests: `npx vitest run src/content src/sim/research src/sim/systems/quests.test.ts`.

### Tune a number
1. Find it. Knobs live in `BAL`; per-thing numbers live in the tables (`cost`, `kw`, `perMin`, `seconds`, `DEPTH_COST`, `CIRQUE`…). Some are still hard-coded: see the pitfalls below.
2. Keep the units: integers where `BAL` says ‰, ticks or items; table quantities with at most 3 decimals; recipe seconds from the divisor list.
3. Update the descriptions that quote the number. Building and research `desc` strings repeat values by hand ("20/min", "rayon de 40 tuiles", "Stocke 1 200 kW·min", the land research's 6 % and −30 %).
4. Run `npm test`. These tests pin content numbers: `validate.test.ts` (6.75 / 18 / 2 / 5; the restart reserve 59 / 6 / 4, D36); `research.test.ts` (en7: 114 + 16 vs 224 + 30); `space.test.ts` (40 stone per pond tile, ribbons ×3 off the claim's land, drifter formula, Hearth level 2 and its land discount); `land.test.ts` (a bare parcel at `base` + 256 floor tiles, the growth, the rent per mille, the starting square's reach 2 on the template); `power.test.ts` (sun table, Lens Arrays floor); `flow.test.ts` (drill rate, ribbon transit); `mapgen.test.ts` (cirque layout); `catchup.test.ts`.
5. Changing a number changes state hashes, so recorded command logs replay differently. Saves stay loadable unless indices move.

## Known gaps and pitfalls

- **One output per recipe.** `MachineNode` emits `outs[0]` only, and validation does not check it.
- **Inert fields.** These are declared but not used: `crafts`; `energyKwMin`; the `unlock` effect; `tier` and `depth` outside the M6 market (in progress); archetype and biome names. (`ARCHETYPES.*.copperVein` is now the land's embedded-copper chance, through `MapGen.embedCopper`.) Also unused: `windMesa[1]`, `respecCooldownDays` (14 days and the 7-day grace are hard-coded in the research system and screen), `tradeThroughput`, `liftDelayMin`.
- **Research effects with no consumer yet.** The flags `tunnels` (ex6), `stormHarvest` (en7) and `deepHeat` (en8); every Commerce target and flag (`tradeFee` is only computed). The Commerce mastery stat (`slippage`) is therefore inert until M6.
- **`trade_post`** is buildable from the start but inert: a `ConsumerNode` that draws 10 kW and accepts nothing, so ribbons into it back up (M6).
- **Duplicated sources of truth.** The Hearth's `storageCap` and `gen.kw` duplicate `BAL.hearthCap[0]` and `BAL.hearthSolarKw`; the `BAL` values win. `CYCLE_LCM` is redeclared in `validate.ts`. Ticks per second (×10, ×600) is hard-coded in the registry. Hard-coded in the compiler: pump 60/min, silo and dock ports 240/min, excavator outlet 120/min, observatory store 200 items (`LAB_CAP`).
- **Validation approximations.** `tiredVeinPerMin` hard-codes the wire recipe's ×2 and ignores mapgen's ±20% per-player richness and 70% edge falloff. The margin still holds at +20% (16.2 < 18). `uniquesNeeded` minimises each input separately, so it is an upper bound.
- **Inexact fractions.** `sunheart.fuelPerMin: 1/30` becomes 33 mu per epoch.
- **Lists to keep in sync.** The branch list exists in four places, `ModTarget` in two, and flags are untyped strings.
- **Typography in tables is checked for punctuation only.** `i18n.test.ts` rejects a plain space before `: ; ! ? %` in the French half of every `{ fr, en }` ([i18n.md](i18n.md)); the thousands separator (U+202F) and the space between a number and its unit (U+00A0) are not checked.
- **Ids are persistent identity** (see *Index stability*): rename or remove an item, building or recipe only with a line in `content/retired.ts`.
