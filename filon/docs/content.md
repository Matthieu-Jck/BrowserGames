# Content: the data tables

All game data — items, recipes, buildings, research, the shape of Ysmère and every tuning knob — is plain, typed, DOM-free TypeScript in `src/content/`, keyed by string ids, with names written inline as `{ fr, en }`.
[registry.ts](../src/content/registry.ts) compiles the tables into dense indices for the engine; [validate.ts](../src/content/validate.ts) pins the invariants the engine and the design rely on.
Content declares *what* exists; *behaviour* is selected by a building's `kind` in the sim, the renderer and the UI. The sim is described in [engine.md](engine.md), the catch-up in [offline.md](offline.md), text in [i18n.md](i18n.md), the vocabulary in [glossary.md](glossary.md).

## Where things are

| File | Holds | Read by |
|---|---|---|
| [types.ts](../src/content/types.ts) | `Loc`, `ItemDef`, `ItemKind`, `Glyph`, `RecipeDef`, `PortDef`, `BuildingDef`, `BuildingKind`, `BuildCategory`, `RouterLogic`, `ReplaceGroup`, `ResearchDef`, `Effect`, `ModTarget` | every table |
| [items.ts](../src/content/items.ts) | `ITEMS` (30 items), `ItemId` | registry, item art, terrain painter, HUD |
| [recipes.ts](../src/content/recipes.ts) | `RECIPES` (25), `RecipeId`, `MAX_RECIPES` (3, D70); machine families `KILNS`, `ARC` (the electric smelter and the arc furnace: plates and glass on power, D106), `WIRE`, `PRESSES`, `ELECTRONICS`, `ASSEMBLY`, `OPTICS`, `SCRIPTORIUM` | registry (`CRECIPES`), inspector |
| [buildings.ts](../src/content/buildings.ts) | `BUILDINGS` (75), `BuildingId` | registry, building art, build bar |
| [research.ts](../src/content/research.ts) | The unlock tree (D33): `PLANS` (25 instant unlocks paid from the Heart in five paths, D41, D117, and the research lab's gate, D71), `RESEARCH` (70 nodes: the trunk's 9, the six families' 61; D69, D107), `DEPTH_COST`, `PlanId`, `ResearchId`, `PLAN_IDS`; the paths `PLAN_PATHS`, `pathPlans`, `pathEntries`, `pathProblems`; the analytics flags `ANALYTICS`, `AnalyticsFeature`; tree helpers `isPlan`, `isResearch`, `isTreeNode`, `planDef`, `researchNode`, `treePrereq`, `buildingsUnlockedBy`, `nodeName` | research runtime and modifiers, the research system (`unlockPlan`), the tech tree screen, validation, quests |
| [expertises.ts](../src/content/expertises.ts) | The expertises (D93): `EXPERTISES` (12, two per family: one production, one research, each with its own feat), `ExpertiseId`, `EXPERTISE_IDS`, `FeatKind`, `ExpertiseEffect`, `rankFor`, `effectAt`, `LOWER_IS_BETTER`, `expertiseProblems()` (in `validateContent`) | [systems/expertise.ts](../src/sim/systems/expertise.ts), [modifiers.ts](../src/sim/research/modifiers.ts), the Expertise window, the HUD, the Core's inspector |
| [gleaners.ts](../src/content/gleaners.ts) | The Gleaners' taste (D103): `GLEANER_TASTE`, ‰ by item id — how likely they take an item when they look at it on a ribbon (shiny made things 1000, duller ones less, the rest 0: ore, stone, sand, coal, water, data) | [flow/chain.ts](../src/sim/flow/chain.ts) `gleanTaste` |
| [reserve.ts](../src/content/reserve.ts) | CrierBelt's restart reserve (D36): `BOOTSTRAP` (the stages that rebuild production from the bare land), `ESSENTIAL`, `RESERVE_PARTS`, `RESERVED`, `reserveNeed(done)`, `stagePlans(s)`, `reserveProblems()` | the reserve system ([systems/reserve.ts](../src/sim/systems/reserve.ts)), validation, the tech tree screen |
| [quests.ts](../src/content/quests.ts) | `QUESTS` (the tutorial, 0–10 in run order: CrierBelt's message, objectives, reward, guide steps), `QUEST_IDS`, `QUEST_TITLES`, `QUEST_CHECK_TICKS`, `COLONY_NAME_MAX`, `questProblems()` (in `validateContent`) | [systems/quests.ts](../src/sim/systems/quests.ts), the quest log and the guide ([quests.md](quests.md)) |
| [emblem.ts](../src/content/emblem.ts) | The claim's emblem (D58): `EMBLEM_SHAPES`, `EMBLEM_SYMBOLS`, `EMBLEM_COLORS` (art tokens by name), `isEmblem` (known parts, a symbol unlike its field), `defaultEmblem(seed)`, `emblemKey` | `Sim.setEmblem`, the register's designer, the Heart's flag ([art/emblem.ts](../src/render/art/emblem.ts)) |
| [world.ts](../src/content/world.ts) | `WORLD_SEED`, `CIRQUE` / `CIRQUE_V1`, `MAPS` / `MAP_VERSION`, `OBSTACLES` (map 4, D94), `RINGS`, `MOUNTAINS`, `SHADE`, `ARCHETYPES`, `UNIQUE_BIOMES`, `T3_UNIQUES`/`T4_UNIQUES`, `COMMON_DEPOSITS`, `DEPOSIT_CHANCE`, `RICH_MULT`, `COS64`/`SIN64` | [mapgen.ts](../src/sim/world/mapgen.ts), validation, dev helpers |
| [balance.ts](../src/content/balance.ts) | `BAL`, every tuning constant | sim systems, a few views and panels |
| [registry.ts](../src/content/registry.ts) | id ↔ index maps, `CRECIPES`, `BUILDING_KIND`, `costOf`, `recipesFor`, `toMu`, `isBeltDef`, `isDragDef` (laid by dragging a line: ribbons, conduits, fences — D103) | sim hot paths, render, UI |
| [validate.ts](../src/content/validate.ts), [validate.test.ts](../src/content/validate.test.ts) | content invariants and designed scarcities | vitest |
| [usable.ts](../src/content/usable.ts) | Nothing unusable (D107): `usabilityProblems()` (in `validateContent`), `nodeUnusable(id)`, `knownAt(id)`, `usableWith(known)`, `buyable(item)`, `mapSpecific(item)`, `FEATURE_NEEDS` (what each feature of the tree acts on) | validation; see [Research](#research--research-d69-d70) |
| [colonies.ts](../src/content/colonies.ts), `BAL.market` | the 8 colony profiles (the other claims) (trade lines, uniques, growth, distance bands, pinned names) and the market knobs, read by the pure market engine ([src/market/README.md](../src/market/README.md)) | `src/market/` |
| [neighbours.ts](../src/content/neighbours.ts) | what a neighbouring base is built of (D110): per colony profile its chain — what heads it (`extract`, `extractN`: a drill wants a deposit, else a sand collector), its `makers` in order, its `store` —, its `power`, its `extra` buildings, what its ribbons carry stage by stage (`carries`) and its covered depots (`tents`); its Core (`NEIGHBOUR_CORE`: the 3 × 3 footprint the sim lays it as; `NEIGHBOUR_CORE_TOP`: its top piece by trade), the lift pad and the mast every base uses (`NEIGHBOUR_PAD`, `NEIGHBOUR_MAST`: the claim's own reach and slots), the depots' size, the cairns' spacing; laid out by [sim/world/neighbours.ts](../src/sim/world/neighbours.ts), checked by `validateContent` |

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
| `face` | an ore set in cliff faces (D87: `quartz`): its deposit lies on the rock tiles of a wall, worked only by a face cutter from the floor beside it | [sim/face.ts](../src/sim/face.ts) (`isFaceOre`): drills and the land price ignore it, an excavator leaves its tiles standing; validation counts it a raw item; the terrain painter draws it as crystals in the wall |

## Recipes — `RECIPES`

```ts
wire: {
  name: { fr: 'Fil de cuivre', en: 'Copper Wire' }, machines: ['wire_mill'], seconds: 3,
  ins: [['copper_ore', 1]], outs: [['copper_wire', 2]], unlock: 'start',
},
```

| Field | Rule |
|---|---|
| `machines` | building ids of **kind `machine`**: one family's list (`KILNS`, `ARC`, `WIRE`, `PRESSES`, `ELECTRONICS`, `ASSEMBLY`, `OPTICS`, `SCRIPTORIUM`, or a single machine). No machine may offer more than `MAX_RECIPES` = 3 recipes (D70, validated); an upgraded machine of the tree joins a family's list and runs it faster (`BuildingDef.speed`). |
| `seconds` | Cycle at speed 1000‰. `round(seconds × 10)` ticks must divide **1 200** (`CYCLE_LCM`), so the allowed whole seconds are 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60 and 120. |
| `ins`, `outs` | `[itemId, qty]`, with at most 3 decimals (`toMu` rounds to milli-items: 0.4 → 400 mu). **Exactly one output in practice**: `MachineNode` only offers `outs[0]`, so a second output would fill its buffer and block the machine. |
| `unlock` | `'start'` or a node of the unlock tree (a plan or a research id, D33). Mention it in a research node's `desc` by hand (a plan's detail pane lists its recipes itself). |
| `energyKwMin` | Compiled to `energyKwTicks`, but no engine code reads it. The cell charger's own `kw` (300 kW × 120 s = 600 kW·min) is what is actually drawn. |

A machine's effective speed is `mods.craftSpeed`, × its own `speed` (the upgraded machines, D70), × `BAL.towerSpeed` for `tower_workshop`, × `mods.excavatedSpeed` when the machine stands entirely on dug floor (graph compiler). Any input port accepts any of the recipe's inputs: the machine sorts them by item (`slotOf`).

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
- **`pole: { range, slots, climb, tall? }`.** A link point (D25): `range` = how far its wires reach, in tiles, footprint edge to footprint edge (a wire takes the longer range of its two ends); `slots` = how many wires it holds; `climb` (levels, D78) = how far its wires climb or come down and how high above the land they ride (a wire takes the larger climb of its two ends; any other building is 0: power/links.ts `wireSteep`, `wireObstacle`); `tall: true` adds `mods.pylonLink` (Reinforced Pylons, xp4) to the range. Pole 6 / 8 / 1, pylon 40 / 4 / 3 (`tall`; 2×2 and about three tiles tall since D75), the Hearth 8 / 6 / 1.
- **`glazed`** (D103). A `belt` under glass: the Gleaners take nothing it carries (its tile counts as guarded, never exposed). The glazed ribbon (`glazed_ribbon`, 60/min as the ribbon, 1 glass, research `xp_guard`, the `transport` group: dragged over a ribbon it covers it).
- **`camo`** (D109). A `belt` buried under the sand: it may be laid on a neighbouring base's open land, where every other piece is `neighbour_land` without the treaties; off the claim's land it costs ×`BAL.camoRemoteCostMult` (1), not ×`remoteBeltCostMult`; the Gleaners walk over it and never see it (guarded, never exposed). The camouflaged ribbon (`camo_ribbon`, 40/min, 1 plate and 2 sand, research `xp_camo`, the `transport` group); flat — a step wants a traction ribbon. A drag lays it by itself where the land refuses the dragged ribbon ([engine.md](engine.md)).
- **`lift`** (D45). A `belt` that hands on to the tile ahead one level up or down: the traction ribbon (`traction_ribbon`, 30/min, plan `traction` after the router). The only way a line changes level.
- **`onRock`** (D44). The building may stand on the mountains: its whole footprint on rock (`T.Rock1`–`Rock4`), never astride a cliff (or, like any building, its whole footprint on the floor). It is a terrain rule only: since D60 a building that `needsZone` needs its parcel on rock too (the Crown lies in the starting square; a turbine on a far mountain waits for its parcel). Set on the wind turbine, the pole, the pylon, the ribbons, the router, the junction, the skybridge, the incinerator, and (D63: a ceramic works by the tarn up on the Crown) the pump, the conduit and the ceramic oven, and (D114) the steam boiler, which stands by the tarn too. A pump draws only from water on its own level. A turbine's wind there is its place's exposure (D95: above its surroundings, open to the wind, out of the lee — [engine.md](engine.md#wind)); the Crown's crest is the cirque's windiest ground, its floor among the calmest.
- **`needsZone`** (the name is the zones'; since D60 it means *on the claim's land*, [land.md](land.md)). Production, power and stores must stand wholly on parcels the claim holds (the starting square, bought, granted or leased), refusal `outside_zone`. Infrastructure may leave it: ribbons, conduits, skybridges, junctions, routing blocks, masts, pylons, the incinerator. A ribbon or conduit not wholly on the claim's land costs ×`BAL.remoteBeltCostMult` (×`mods.remoteBeltCost`). Off the claim's land construction completes after a delay that grows with the distance from the Heart's tile (`remoteBuildTilesPerSec`, `mods.remoteBuildDelay`). Nothing at all may touch a sister claim's parcel the claim does not hold (`sister_land`).
- **`cost`** is paid from the Hearth stock and refunded in full on removal. `costOf` gives the base. The placement system adds the remote multiplier (never refunded, so it must leave the restart reserve whole: D36).
- **`unlock`.** `'start'` — only the starting kit: the drill, the ribbon and the pole (D33) —, `'never'` (the Hearth, placed at founding), or a node of the unlock tree: a plan id (most early buildings; the plan usually bears the building's id, `junction` and `bridge` for the crossing and the skybridge) or a research id. A building whose unlock is reconverted away stands **dormant**: no flow node, a grey wash (plans are never lost).
- **`category`.** The build-bar tab. A tray lists its category's buildings **in declaration order**, and the first ten get digit hotkeys. Logistics, production and energy already hold nine each.
- **`desc`.** What the building is for and how to hook it up, in one or two plain sentences, and since D53 mostly a fallback: the building card shows its first sentence only when nothing on the card shows how the building works, and the inspector only for a kind with no panel ([ui.md](ui.md#the-building-card)). Show first: a recipe, a port, a rule belongs in content the card draws, not in the sentence. The card derives every figure from the other fields (power, throughput, recipes per minute, stores, reach, ports, replacement, cost), so `desc` quotes only the numbers that decide, and they are not checked: keep them in step when tuning (see *Tune a number*). How to write one, typography included: [ui.md, Writing a good `desc`](ui.md#writing-a-good-desc). `building-facts.test.ts` holds every `desc` to one or two sentences.
- **`replaceGroup`** (decision D24). This field says what a building may be placed over, and what may be placed over it. A building replaces buildings of its own group that lie wholly inside its footprint. They are refunded first, and the refund counts towards the cost. The rules are in [engine.md](engine.md#placement-and-replacement).

  | Group | Buildings |
  |---|---|
  | `transport` | every ribbon tier, the routing blocks (router, sorters, gates, distributor), `crossing` (the Junction), `skybridge` |
  | `fluid` | `conduit` |
  | `power` | `mast`, `pylon` |
  | `drill` | `drill`, `deep_bore` |

  Without a group, a building never replaces and is never replaced: machines, stores, generators, the Hearth. A new ribbon tier or routing block joins `transport`; a new conduit-like line joins `fluid`. A new group is one more string in `ReplaceGroup` (`types.ts`), and nothing else in code. Mixing groups is a design choice: a junction cannot replace a conduit, for example.

What each `kind` means. The graph compiler's switch on `BuildingKind` lives in [compile.ts](../src/sim/graph/compile.ts); placement rules live in [systems/build.ts](../src/sim/systems/build.ts).

| `kind` | ids | Engine behaviour | Kind-specific fields |
|---|---|---|---|
| `hearth` | `hearth` | Reservoir holding the base's stock (cap `BAL.hearthCap[level]`), **inputs only** (it takes, it never gives: no outlets — D34), a built-in solar panel (`BAL.hearthSolarKw` × sun ‰ × the solar research), an isotope core (`BAL.hearthCoreKw`, day and night), and a link point (8 tiles, 6 wires); not buildable. Its one `out` port, the data outlet on its south-east corner, hands out the Survey Data the Analytics research has it make, from level `BAL.hearthDataLevel` (2) on (D68, D86); the port stands at every level, offering nothing before. | `pole`, `gen`, ports (`storageCap` is not used) |
| `fence` | `fence` | No node, no power (D103): it stands in the Gleaners' way — a pocket of floor fenced in is out of their reach ([world/reach.ts](../src/sim/world/reach.ts)); laid by dragging like a ribbon (`isDragDef`; `planBelts`: one on each free tile, one already there kept whatever its way); no replace group (a ribbon dragged across a fence line leaps it with a skybridge pair). Off the claim's land at its plain cost, after a kite's delay | — |
| `drill` | `drill`, `deep_bore`, `sand_collector`, `face_cutter` | `DrillNode`: majority ore under the footprint, rate = min(`perMin`, Σ tile caps × `capMult`‰ × ring-3 bonus); needs a deposit (a face ore is no drill's). With `drill.ground` (the sand collector, D38): that item off the bare ground at a steady `perMin`; needs bare sand (terrain Sand, no ore) under every tile (`needs_sand`). With `drill.face` (the face cutter, D87): it stands on the floor, its back against a wall, and works the face ore of the rock tiles its back touches (higher than its floor), at Σ their caps (`faceRate`, [face.ts](../src/sim/face.ts)); none behind it: `needs_face`; dropped facing away it turns its back to the wall (`placementRot` → `faceRot`) | `drill.perMin`, `drill.capMult`, `drill.ground`, `drill.face` |
| `pump` | `pump`, `hp_pump` | `DrillNode` of water at `drill.perMin` (60/min, the high-pressure pump's 240) while on or beside water of its own level; the pump and the conduit come with the Steam plan (D114; Ceramics' before) | `drill.perMin` |
| `excavator` | `excavator` | Stone reservoir (`BAL.excavatorCap`) emptied through its outlet; digging is a landscape job; full power only while busy | — |
| `backfiller` | `backfiller` | Reservoir that takes stone (`BAL.backfillerCap`); filling is a landscape job | — |
| `belt` | `ribbon`, `traction_ribbon`, `swift_ribbon`, `express_ribbon` | Chain tiles, one item per tile, a tile a step at `perMin` steps a minute (D57); drag-placed (a drag through routing blocks keeps them, across another ribbon line lays a junction); group `transport`, so they replace each other and the routing blocks | `belt.perMin` (its pace and throughput; `ticksPerTile` only for conduits) |
| `conduit` | `conduit` | Chain tiles carrying fluids only; its water keeps to its level or pours one terrace down (D114: a conduit facing the tile below a terrace's edge hands on to it; never up, never two at once: `cliff`) | `belt` |
| `bridge` | `skybridge` | Chain tile that leaps to the next skybridge ahead within 4 + `mods.bridgeSpan` tiles | `belt` |
| `fork` | `router`, `sorter`, `inverted_sorter`, `overflow_gate`, `underflow_gate`, `distributor` (category `distribution`, their own build-bar tab) | `ForkNode` in the mode of its `logic` (see engine.md « Routing blocks »; the unloader is retired, D117: a silo's outlets empty it by themselves) | chosen item in `cfg` byte 0 (sorters); router side filters with `forkFilters` |
| `crossing` | `crossing` | No node: items pass straight through it, for ribbons, outlets and routing blocks' sides alike (engine.md, « Graph compilation ») | — |
| `storage` | `silo`, `big_silo` | Single-item reservoir: every outlet hands out the one item it holds (port rate 240/min, hard-coded) | `storageCap` |
| `machine` | kilns, `electric_smelter` and `arc_furnace` (D106: the kilns' plates and glass on power), `wire_mill`, workshops, `ceramic_oven`, `cell_charger`, `quartz_workshop` (D87: the oscillator, its one recipe) | `MachineNode` running the recipe stored in `cfg` | listed in recipes' `machines`; `crafts: true` (never read) |
| `lab` | `observatory` (the Research Lab), `auto_lab` | Reservoir that takes the data its project still owes (any kind of science item); one project per lab; `lab.dataPerMin`: Survey Data it makes itself (D68) | — |
| `server` | `server`, `cooled_server`, `supercomputer` | Power only: `server.tokensPerMin` AI tokens a minute at its grid's satisfaction, billed against research each minute (D68) | — |
| `generator` | `brazier`, `steam_boiler`, `sunheart` | `GeneratorNode`: burns `gen.fuel` ∝ dispatch; output `gen.kw` × `mods.genOut`; with `gen.water` (the steam boiler, D114) it also drinks that much water a minute at full output, ∝ dispatch, and gives nothing without both in its boxes (`fueled`) | `gen.kw`, `gen.fuel`, `gen.fuelPerMin`, `gen.water`, an `in` port (the boiler two: each takes either). Without `fuel`, compilation throws. |
| `wind` / `solar` / `geothermal` | `wind_flower` / `sun_bulb` / `fumarole_tap` | Grid producers only: a turbine gives its rating `gen.kw` × mods on its curve `gen.wind` at the local wind (D95), a panel `gen.kw` × mods × sun; geothermal needs every footprint tile on a vent | `gen.kw`; a turbine's `gen.wind: { cutIn, rated, cutOut? }` (‰ of the reference wind: nothing below cut-in, the cube of the wind up to rated, all of it above, nothing from cut-out) — Éolienne 360 kW 400/1 400/3 600, à pas variable 480 kW 300/1 250 (no cut-out), Grande 1 200 kW 350/1 300/4 200 |
| `accumulator` | `accumulator` (the accumulator) | Grid storage: `kwMin × 600` kW·tick × `mods.accCap`, rate `kw × mods.accRate` | `accumulator` |
| `pole` | `mast`, `pylon` | Pillars: link points the player wires to each other, to the Hearth and to buildings (grids = the wires' components, D25); a new one wires itself to the nearest pillar or Hearth in reach with a free slot | `pole.range`, `pole.slots`, `pole.climb`, `pole.tall` |
| `trade` | `trade_post` | 5×5: pad and flame apron (D62); a `ReservoirNode` store whose one entrance takes, and sells, every tradable item but its cargo (D64: no export streams) and whose one exit hands out what it bought, in turn | `ports` (one `in`, one `out`) |

Ids special-cased in code: `hearth` (founding), `tower_workshop` (×`BAL.towerSpeed`), `drill` and `excavator` (rotation variants in art), and the items `stone`, `water`, `pace_bell` (the servomotor, once the speed module: the load hands modules an old save fitted back as servomotors, D81), `iron_ore` and `copper_ore` in the sim. Map generation keeps a per-item base richness, and the HUD keeps an `ORDER` list. The ribbon drag's auto-junction lays the building of kind `crossing`, found by kind, not by id (`planBelts` in [systems/build.ts](../src/sim/systems/build.ts)). The waystation (`outpost`, its own kind) was retired with the influence zones (D60): its id lives on only in `RETIRED_COSTS` and the save v3 migration (`zonesToParcels`). The 3×3 trade post's likewise as `trade_post_3x3` (D62, save v4 `postsToPads`).

## The unlock tree — `PLANS` and `RESEARCH` (D33)

Everything a base uses beyond its starting kit is unlocked in **one tree with two kinds of node**, which share one id space (a building's or a recipe's `unlock` names either) and one set in the colony, `sim.done` (saved, hashed). The tech tree screen draws both ([ui.md](ui.md#the-tech-tree-screen)).

| | Plans — `PLANS` | Research — `RESEARCH` |
|---|---|---|
| Paid with | materials from the Heart, at once (`cost`, whole items) | data (one more kind each tier: `SCIENCE`, D71) and AI tokens as it runs, in a research lab, under the allowance, over a minimum time (D68) |
| Taken by | the `unlockPlan` command (one click in the tree) | `startResearch` in an idle lab (or the Research Queue) |
| Rows in the tree | `lane`, its path (D41): `production`, `logistics`, `energy`, `analytics`, `trade`, `survey` | `branch`: the trunk or a family (`en`, `ex`, `dn`, `cm`, `an`, `xp`), and from Tier 3 its `spec` (D69) |
| Prerequisites | plan ids (research ids are allowed) | the node before it in its lineage and its tier's gate; the family roots and `tr1` need the lab's plan |

### Plans — `PLANS`

```ts
router: plan('logistics', [], [['iron_plate', 5]]),
data_collector: plan('production', ['kiln'], [['iron_plate', 10], ['copper_wire', 4]]),
observatory: plan('production', ['data_collector'], [['iron_plate', 20], ['copper_wire', 4]]),
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
| Production · « Fondre et fabriquer » | Fonderie `kiln` 10 p · Collecteur de sable `sand_collector` ← kiln: 5 p · Tréfileuse `wire_mill` ← kiln: 15 p · Atelier d’électronique `workshop` ← sand collector and wire mill (its circuits are wire and glass, D107): 15 p, 2 g · Haveuse `ex_quartz` (the Face Cutter: the face cutter, the quartz workshop and the oscillator's recipe; a plan since D101, no research wait; on this path since D117, the survey path gone) ← wire mill (the oscillator is quartz and copper wire) and the trade post (its quartz is a cliff face's: lands without a vein buy it at the Crier, D107): 20 p, 6 g, 6 w (the research lab is the gate after every plan, D71; the data collector comes with the research « Traitement des données », D101) |
| Logistique · « Déplacer et trier » | Routeur `router` 5 p · Croisement `junction` (the crossing) ← router: 5 p · Trieur `sorter` ← router: 6 p, 2 w · Silo `silo` ← router: 8 p, 2 g · Passerelle `bridge` (the skybridge) ← junction: 6 p, 2 w · Trieur inversé `inverted_sorter` ← sorter: 6 p, 2 w · Vanne de trop-plein `overflow_gate` ← sorter: 6 p, 2 w · Vanne de sous-débit `underflow_gate` ← overflow gate: 6 p, 2 w (the unloader, after the silo, is retired: D117). Cheap on purpose (owner, 2026-10-12: "most of the logistics is too expensive") |
| Énergie · « Produire l’énergie » | Éolienne `wind_flower` 10 p · Générateur à charbon `brazier` ← wind turbine: 15 p, 2 w · Vapeur `steam` (the steam boiler, the water pump and the conduit: water's first use, Tier 1, D114) ← coal generator: 20 p, 4 g, 2 w |
| Analytique · « Voir ta base » | Télémétrie `telemetry` 8 p, 2 w · Registre de production `statistics` ← telemetry: 10 p, 4 w · Relevé d’énergie `power_log` ← statistics: 12 p, 2 g, 4 w · Diagnostic `diagnostics` ← power log: 15 p, 2 g, 6 w · Anémométrie `anemometry` ← power log: 12 p, 4 g, 6 w (D95) |
| Commerce · « Vendre et acheter » | Comptoir `trade_post` ← telemetry (the path's entry hangs from the analytics': know your rates, then sell): 20 p |

### Paths and the Analytics path (D41)

The plans grow in **paths of one theme each** (`PLAN_PATHS`, a plan's `lane`), drawn as bands of their own colour on the tree ([ui.md](ui.md#the-tech-tree-screen)). A path reads as one line: it grows from **one entry** (`pathEntries`: a root plan, or one hanging from another path's plan, like the trade post from the telemetry), and every other plan of it hangs from a plan of the same path, without a loop. `pathProblems()` checks it in `validateContent`; [validate.test.ts](../src/content/validate.test.ts) pins the five paths, their entries and their order (the survey path went with the survey beacon, D117).

**Analytics** holds everything that shows the player information about the base, one readout per step. Each analytics plan turns on exactly one flag, its own id; `ANALYTICS` names them by readout, and the UI reads them only through `analyticsOn(sim, feature)` ([ui/analytics.ts](../src/ui/analytics.ts)):

| Step | Flag (`ANALYTICS` key) | Turns on |
|---|---|---|
| Télémétrie | `telemetry` (`rates`) | what comes into the Heart each minute, beside each stock in the HUD (D79). The id is kept: saves hold it, and the tutorial's quest 2 asks for it |
| Registre de production | `statistics` (`ledger`) | the Statistics screen (G) and its chip in the HUD |
| Relevé d’énergie | `power_log` (`power`) | the power history in the Statistics: demand against what is available |
| Diagnostic | `diagnostics` (`machines`) | the machines' states in the Statistics: how many run, wait for inputs, are blocked, unpowered or unwired, and which (`machineStates`) |
| Anémométrie | `anemometry` (`wind`) | the wind (D95): the Vent view (V), a turbine's wind in its card (why, its curve, its next 24 h), a turbine's output over a day while placing one; before it the player reads the wind only off the land's hints and a turbine's output |

Unlocking one plays its reveal (the base dims around the new readout, CrierBelt says what it is: [ui.md](ui.md#the-spotlight-d41)). Readouts that stay free: the stock amounts, the ◉ and its ◉/h, the power % and its tooltip, the clock, the land mode (I) and the power overlay (P), the inspector and the building card. F (`ovFlow`) is bound to a flow overlay that does not exist yet; when it does, it is a natural next analytics step (a plan, its flag in `ANALYTICS`, a reveal in `ANALYTICS_REVEALS`).

The distributor, the swift and express ribbons, the compact machines, the press, the assembly workshop, the pylon and everything later stay behind their research.

### Research — `RESEARCH` (D69, D70)

Four tiers on the depths (T1 = 1–2, T2 = 3–4, T3 = 5–6, T4 = 7 and the keystones ★, depth 9; `tierOfDepth`). The trunk opens each tier (`TIER_GATE`: T2 needs `tr_synth`, T3 `tr6`, T4 `tr8`). Tier 1 is completed whole (D93): its last trunk node, the Synthesis (`tr_synth`, `TIER1_WHOLE`), needs every other Tier 1 node and gives the Heart's level 3, whose Archive opens the expertises; Tier 2 also waits for two expertises chosen (`researchBlock` → `expertise`, [Expertises](#expertises-d93)). Six families (`FAMILY_IDS`; `FAMILIES[f]`: a name, one name per tier, and its specialities from Tier 3), the tree's lanes:

| Family | Tier 1 · Tier 2 | Specialities from Tier 3 |
|---|---|---|
| `en` Energy | Production d’électricité · Réseau électrique | `r` Renouvelables · `c` Centrales |
| `ex` Extraction | Extraction · Carrière | `d` Forage · `x` Excavation |
| `dn` Machines | Métallurgie · Automatisation | `e` Électronique · `m` Mécanique |
| `cm` Commerce | Échange · Finance | none: Économie de marché at Tiers 3–4 |
| `an` Analytics | Données · Serveurs | `c` Calcul · `m` Exploration de données |
| `xp` Logistics (Expansion until D107) | Manutention · Portée | `t` Transport · `c` Concessions |

```ts
en_solarfarm: node('en', 'r', 5, 'en4', ['Ferme solaire', 'Solar Farm'], ['Débloque la Ferme solaire…', 'Unlocks the Solar Farm…']),
tr5: trunk(5, 2, ['tr4'], 480, '200_000', 120, ['Deuxième pupitre', 'Second Desk'], [...], [{ k: 'slots', add: 1 }]),
```

- **`node(family, spec, depth, after, name, desc, effects, also)`**: `after` is the node before it in its lineage (null: the family's first node, which needs the lab's plan); the tier's gate is added, and `also`, what it acts on from another lane (D107: the Sifter needs Earthworks, the Compact Assembly Workshop Ceramics, the Compute Plan the Server Room, Reinforced Pylons Land Registry); its tokens and pace come from `DEPTH_COST[depth]` (D118: none at Tier 1 — data alone, no time —; 100 k tokens and 8 min at depth 3 up to 6 M tokens and 24 h for a keystone: 8 · 20 · 60 · 180 · 480 · 1 440 minutes, short early and long from Tier 3, D107; the pace is what the launch dialog aims its default token flow at, never a minimum), its data from `scienceCost(tier, DEPTH_COST[depth].data)` (D71): that much Survey Data (6 at depth 1, 20 · 90 · 240 · 960 · 1 920 · 2 880, 5 760 for a keystone: about 6 a minute at Tier 1, the Core's 3 and a collector) and, from Tier 2, a third as much Mechanics Data, from Tier 3 a twelfth as many atlases, at Tier 4 a fortieth as many codices. A trunk node that opens a tier sits in the tier before it (tr1 in T1, tr6 in T2, tr8 in T3), so it never asks for the kind it brings. A split family's lineages share the Tier 1–2 nodes and each runs on from the last of them. Ids: the old short ids where a node kept its meaning (`en2`, `ex4`, `dn4`, `cm3`…), descriptive ones for the rest (`en_pitch`, `an_servers`, `xp_far`…); renamed ids are in `RESEARCH_RENAMED` ([retired.ts](../src/content/retired.ts), save v7).
- **`trunk(depth, tier, prereq, data, tokens, minutes, name, desc, effects)`** is fully explicit (`tr1` needs the lab's plan alone: D87 hung it from the Face Cutter's research, D101 made the Face Cutter a plan). Its paces follow the tiers' (D107, D118): Mechanics and the Synthesis none (Tier 1: data alone, 0 tokens), Earthworks and Ceramics 8 min, Land Registry and the Second Desk 20, Atlas Lore 30, the Third Desk 3 h, Codex Lore 6 h.
- **Quartz** (D87). The Face Cutter `ex_quartz` « Haveuse » is a plan since D101, of the Production path since D117 (of the Survey path before) (the face cutter, the quartz workshop and the oscillator's recipe: no research wait in the tutorial); since D107 Extraction's lineage starts with the Fast Drill `ex_fastdrill` (Tier 1, depth 1), then Tier 2 « Carrière » works the rubble Earthworks digs: `ex_sifter` (depth 3, ← `tr2` too), `ex3` Backfill and `ex4` Basalt Bits (depth 4), from which Drilling and Excavation run. The Mechanics Data recipe (`journal_2`) takes 2 gears, 1 circuit and 1 quartz oscillator (the test bench gained a third input on its side, appended so the others keep their indices); a server costs 4 oscillators more.
- **Smelting on power** (D106). Machines' Tier 1 runs `dn3` (the compact smelter) → `dn_esmelt` « Fonderie électrique » / Electric Smelting (depth 2: the Electric Smelter and the two `ARC` recipes) → `dn_wiremill`; a lane holds one node a column, so the new node stands in the lineage rather than beside the twin wire mill. The recipes keep the arc furnace's ids, `arc_plate` and `arc_glass` (saves carry them), named « (électrique) » / "(electric)", at the coal recipes' 6 s: the electric smelter (speed 1000, 300 kW at work, 15 idle; 25 plates, 10 copper wire, 4 glass) makes 10 a minute like the smelter, the arc furnace (`dn_arc`, speed 2000) 20. Two recipes, so a new one waits for the player's choice (D83). On the Crier's board (`c_E` = `BAL.market.energyCost`) its 300 kW cost a little more than the smelter's 10 coal a minute, but it mines no coal, so it earns more per deposit tile (electric-smelter.test.ts).
- **Steam** (D114; owner, 2026-10-17: « Il faudrait que l'eau serve assez tôt dans le jeu, dès le Tier 1 »). Water's first use is power: the steam boiler `steam_boiler` « Chaudière à vapeur » (a 3×2 `generator`, its coal and water intakes at the back, onRock; 30 p, 6 g, 6 w) gives 600 kW for 8 coal and 30 water a minute at full output (`gen: { kw: 600, fuel: 'coal', fuelPerMin: 8, water: 30 }`): 75 kW per coal a minute against the coal generator's 30, two and a half times, so the cirque's scarce coal (D97) goes further. It burns and drinks only what the grid asks once the wind, the sun and the Core are used (the merit order), by night as by day. A pump (60/min) feeds two. It comes with the pump and the conduit (a plate a tile now; a ceramic before) in the Energy path's plan `steam` « Vapeur », after the coal generator's: before the lab, in Tier 1. Ceramics (`tr3`) keeps the ceramic oven, the assembly workshop and the accumulator. The wind and the sun keep their place: they cost nothing to run, where the boiler eats a coal drill's output and wants a pump by water, a conduit and a longer build (on map 4 the water nearest the Core is D115's spring pool at the floor's edge; on maps 2–3 the tarn up on the Crown, whose water now comes down in a conduit, D114). steam-boiler.test.ts holds the ratios.
- **Commerce** (D107: « "Standing Orders" c'est déjà de la finance assez avancée »): Tier 1 « Échange » is what a newcomer at the Crier uses — `cm_post2` « Second comptoir » (a second trade post: flag `post2`, read by `maxPosts`, which still counts `tradeL2` for older claims) and `cm_floor` Floor Prices; Tier 2 « Finance » the standing orders (`cm2`), the Compute Plan (`cm_plan`, ← the Server Room: no token is billed before it, D105) and Server Rental (`cm_rent`); Tiers 3–4 the post's levels (`cm3` « Quai élargi », `cm8` « Grand comptoir »), Express Freight and the third post (`cmK`).
- **Nothing unusable** (D107, [usable.ts](../src/content/usable.ts)): what a node unlocks works with what the base can have by then, in the order the tree imposes (its closure; a research node knows every plan). A building it unlocks is paid for with usable items (or the starting stock's) and, a crafting machine, runs at least one recipe, a generator burns a usable fuel; a recipe it unlocks has usable inputs and a buildable machine; a Heart level it gives is payable; a feature has what it acts on (`FEATURE_NEEDS`, which every feature key must be in). An item is usable when extracted (the land's common deposits, sand, water, stone, the Core's Survey Data, by a machine known), made (a known recipe on a buildable machine) or bought (a depth, a colony supplying it, a trade post); the uniques and a cliff face's quartz, which only some maps hold, count only as bought. Fixing a failure: move the node (a prerequisite, `also`), list the item at the Crier (`COLONY_PROFILES`), or change the recipe.
- **Every node gives something** (D70; `nodeGives` in validate.ts): the buildings and recipes whose `unlock` is its id, a Heart level, a feature `flag` the sim reads, research `slots`, an `add`. A node that would only multiply a number is refused. The `mul` kind stays for the few research-free multipliers some systems still read.
- **Effects** (`Effect`). `mul` (target ×permille), `add` (target + v), `flag` (a string the sim tests with `mods.flags.has`) and `slots`. They compile into `Mods` in [modifiers.ts](../src/sim/research/modifiers.ts), applied **in `PLAN_IDS` then `RESEARCH_IDS` order with a floor after each step**. No mastery bonus (D69).
- **Land research** (D60, D70, [land.md](land.md#research)): `tr4` « Cadastre » / Land Registry gives `flag('lease')` and the pylon (the Heart's level 3 moved to the Synthesis, D93); in Logistics › Concessions, `xp_treaties` (ribbons and poles over the neighbouring bases' land; after `xp4` since D119), `xp_far` (Tier 2, after `xp_camo`: buy a parcel apart from the claim's land; purchases otherwise grow it outward). Selling a parcel back needs no research (D119, `BAL.landResaleTax`; `xp_resell` is in `RESEARCH_GONE`, content/retired.ts).
- **Costs at run time.** A node costs its table's data and tokens, whatever else the claim owns (`effectiveCost` → `{ cost, tokens, aim }`, [runtime.ts](../src/sim/research/runtime.ts); D72 removed D69's spread penalty and lineage discount), less what a research expertise in place takes off its family (D93: `mods.fam`, when the project starts; one of research « time » takes its share off the data and the tokens, D118); the token price is `BAL.tokenCentsPerK`, the launch dialog's flows `BAL.tokenFlow`.
- **Tiers by the Core's level** (D118): `BAL.tierCoreLevel` = [1, 3, 4, 5] — Tier 2 at the Core's level 3, Tier 3 at 4, Tier 4 at 5. Each level is a row of `BAL.hearthUpgrades` (its unlock, the trunk node that closes the tier before, and its materials: level 5 after Codex Lore, 120 lenses, 60 thermal cores, 30 atlases), raised by the player. `hearthCap`, `hearthCoreKw`, `hearthSolarKw` and `coreReveal` have a value per level (5); a data item (`kind: 'science'`) is held at most `BAL.hearthDataCap` (200) whatever the level (D118). `validateContent` checks Tier 1 has no tokens and no pace and Tier 2+ both, and each tier's level exists, comes with its gate and never falls. Projects and the token flow are in [engine.md](engine.md#research).

## Expertises (D93)

[expertises.ts](../src/content/expertises.ts): what the base has learnt to do well, earned by what it did. The rules are the engine's ([engine.md](engine.md#expertises-d93)), the window the UI's ([ui.md](ui.md#the-expertise-window-d93)).

```ts
ore_cutting: { name: L('Abattage', 'Ore Cutting'), family: 'ex', feat: 'mined', ranks: [10_000, 150_000, 1_500_000],
               effect: { k: 'mod', targets: ['drillRate'] }, permille: [1100, 1150, 1200], icon: 'item:iron_ore' },
```

- **`feat`** (`FeatKind`): what counts, read off the colony at each minute's boundary — `grid` (the longest run of minutes the Core's grid served `BAL.expertise.gridPermille` at a minute's end), `capacity` (kW of generators standing), `mined` (ores, coal, stone, uniques made), `dug` (tiles dug or filled), `made` (materials and parts), `machines` (crafting machines standing), `sold` / `bought` (◉ at the Crier, lifetime), `data` (data items made), `tokens` (AI tokens research used), `parcels` (bought), `ribbons` (ribbon tiles standing). Each expertise has its own.
- **`ranks`**: the feat's value for ranks I, II, III (rising, whole). Measured on the debug bases (2026-10-16): the tutorial base after its first hour stands about 2 000 kW, 300 ribbon tiles, a parcel, 1 600 ◉ of sales; Tier 1 uses about 530 data and 280 000 tokens, which earn Archiving and Inference I by themselves.
- **`effect`** and **`permille`** (by rank): `mod` multiplies `Mods` targets (`genOut`, `drillRate`, `craftSpeed`, `dataRate`, `deliveryDelay`, `landPrice`; production +10/15/20 %, delays −15/25/35 %, land −10/15/20 %); `research` multiplies one aspect of its family's research (`time`, `tokens`, `data`: −15/25/35 %).
- **`icon`**: `item:<id>`, `building:<id>`, `glyph:<id>`, `mark:<id>` or `coin`; the window resolves it.
- **`expertiseProblems`** (in `validateContent`): two per family, one of each kind; a feat of its own each; thresholds rising and whole; the effect better at each rank (a boost above 1000 ‰, a cost or a delay — `LOWER_IS_BETTER` — and research under it); icons of a known kind.
- **`BAL.expertise`**: `level` (3: the Heart level that mounts the Archive), `slots` (2), `reorientCents` (150 000: 1 500 ◉) and `reorientGrowth` (2000 ‰: twice as much each time), `gapMinutes` (1 440: a réorientation's 24 h), `gridPermille` (950).

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

Pure data that [mapgen.ts](../src/sim/world/mapgen.ts) turns into tiles. `WORLD_SEED` is shared by every colony. **Map versions** (D63): `MAPS[v]` is what a land of version `v` reads — its cirque template, the archetypes' Crown foot (`crownOuter`), the mountains' hardness by ring and level, its quartz vein (map 3) — and `MAP_VERSION` (4) the version a new base is founded on; a saved base keeps its own (persistence.md). Never edit an old version's numbers (a base stands on them): add a version. `CIRQUE` (map 2) and `CIRQUE_V1` (map 1) are the common basin (`CirqueTemplate`; D40: a third of its first area): floor radius 23 and its rim's jitter, the Crown's `terrace` (2 tiles a level: a traction ribbon's elevator needs a flat tile in front of it), its `crest` (3) and, on map 2, its `ridge` (2: the level it keeps all round, rising to the crest only on the `shoulders`, the shared noise read round a circle, and round the tarn), `minCrest`, the foot (`crownOuter`: 29 on map 2, 34 on map 1; Closed Cirque 31 / 44, Wide Steppe 27 / 32), the hardness by level (`[1, 1, 2]`: the lilac rock on the crest, which map 2 has on its peaks only), `jitterAt` (map 2: the noise read at the bearing, so the terraces run as rings), the four starting deposits (the same on maps 1–3; map 4's `CIRQUE_V4` has them at most a tile off, in whole 2 × 2 blocks, each patch's shape seeded by its `shape`, D104; `rich` = per-tile cap in 10 mu per epoch, so 75 → 0.75 ore/min; sand is the ground, not a deposit) and the cirque's water: map 1's lake on the floor at (14, 8), map 2's tarn up on the crest at (27, 13), 21 tiles at level 3 (`onCrest`, `mound`: how far round it the crest stays); `spring` (map 4's `CIRQUE_V4`, D115): the tarn's peak dry; a `summit` north of the Crown (its offsets; a plateau at `level`, 6 — `MAX_LEVEL`, a level over every mountain's `MOUNTAIN_LEVEL` 5 — `top` tiles round its middle, its sides `fall` levels down a tile; the spring's `basin` of still water in its middle, `deep` at its heart), a stream `halfWidth` quarter tiles each side of the line from the basin down to its `pool` on the floor, and a flat `ledge` at its `level` on the way (the late base's potteries). `MOUNTAINS.hardness` is map 2's (H1 on the first two terraces near the cirque, the lilac rock on the high tops); map 1's is in `MAPS[1]`. Moving a deposit: the coal must stay beyond the Heart's 8-tile wire (quest 3's pole) and a whole coal and copper drill spot within r 18 of the Heart (the early reach the tutorial expects, well inside the starting square); `mapgen.test.ts` checks both on the real map, and `reserve.test.ts` the poles each bootstrap stage needs. `RINGS` gives the ring radii and the blend zone between world noise and player noise. `ARCHETYPES` holds the five per-player environments, each with `{ fr, en }` name and description. `UNIQUE_BIOMES` holds the six unique-resource sites; their `item` is automatically a raw item for validation. `COMMON_DEPOSITS` weights the deposit blobs beyond the Crown, and `DEPOSIT_CHANCE` and `RICH_MULT` scale them by ring. `COS64`/`SIN64` is an integer trig table, so map generation stays transcendental-free. `QUARTZ_VEIN` (map 3, D87) is the guaranteed quartz vein: the bearings it may stand at (`sides`: west or north, so its face looks east or south, the walls the iso camera sees), how far out its face is (`face` + 0…`faceSpan` − 1: 44–46 tiles, the parcel beside the starting square), how many face tiles hold quartz (`length`, 8: four cutters), the slide across (`shift`), the rock behind it (`depth`, `climb`, `top`), the floor kept at its foot (`apron`, `apronWide`) and the corridor of floor home to the Crown (`corridor`); its face tiles' richness is `BAL.depositRich.quartz` (750: 7.5 a minute a tile). `OBSTACLES` (map 4, D94) is the land's obstacles past the Crown: the **massifs** (`massif`: their noise's scale and octaves, where they fade in — `from`, `full`, `fade` —, the `threshold` past which the land stands at `rim` at once — the cliff, 3 — and a level more every `step`; kept `clear` tiles off what the land keeps, sunk in water; `ramps`: the second noise whose threshold makes a ramp), the **chasms** (`chasm`: how many, how many near — `rNear` —, their walk's `steps`, `stride`, `turn`, their `width` in quarter tiles, the `taper` of their ends), the **rivers** (`drainage`: the lattice's `grid`, `radius` and `jitter`, the node's elevation — `massifWeight`, `mountainWeight`, `tilt` to the sea —, the `rain` on the plains, raised land and massifs, the `channel` flow where a stream begins, its half `widths` by flow, its `meander` on the floor, the `lake` a deep hollow holds, the room it `keep`s off the Crown, the clearings and the vein), **the sea** (`sea`: the coast's `distance` along the world seed's bearing, its `coast` wobble and `scale`, the `shallow` band, a river mouth's `estuary` widening), the **corridors** to the guaranteed sites (`corridor`: `half` width, a bend `every` tiles by up to `wobble`, the `margin` the gaps keep) the room kept round the copper field (`copper`, 26: no obstacle, and never rougher than middling), the **roughness** that makes open desert and broken ground (`rugged`: its noise's `scale`, the lift it gives the massifs — `gain` — and the mountains — `mountainGain` —, the roughness the chasms need — `chasmMin`) and the **common deposits** that follow it (`ore`: `cells`² candidates a chunk, the circles they read — `near`, `far` —, their chance — `open` ‰ plus `perBroken` ‰ a broken point, at most `max` —, the radius of a `thin` blob — one block or two since D104 — and of a full one in tenths of a tile, a full one's `richRough`). `MapParams.oreBlock` (map 4: 2, D104) lays every deposit but the quartz face in whole blocks that wide on the world's grid, a drill's footprint. The chasms pinch and widen by `pinch` and branch (`branch`: `chance` ‰ a point, `steps`, `angle`). Widths in quarter tiles: 4–5 make a band two or three tiles wide (a skybridge pair leaps three). The land's price for its new grounds is `BAL.land.tile` (`river`, `chasm`, `sliver`); its ore at `BAL.land.depositPerValue` (250); `BAL.land.oreTiers` the ore pips' tiers. Archetype and biome names are not displayed yet.

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
| `revealOf(def)`, `BUILDING_REVEAL[def]` | the fog a building lifts when placed (D117): its `reveal` (the pylon: 40, its wires' reach), else `BAL.buildReveal` plus half its longer side; 0 for a line piece (the `transport` and `fluid` groups, the fence) |
| `toMu(items)` | items → milli-items (exact up to 3 decimals) |

**Why indices.** The tick loop and the catch-up use typed arrays indexed by item (stocks, buffers, produced/consumed counters), integer edges and integer `cfg` words. Comparing small integers is cheap, hashing them is stable, and saves stay compact. String ids remain at the edges: content tables, commands (`place('kiln', …)`, `setRecipe(id, 'plate')`), the debug handle and saved research ids.

**Index stability.** A save ([serialize.ts](../src/sim/serialize.ts)) stores raw indices: entity `def`, per-item stock and store arrays, machine `cfg` (recipe index + 1), fork filters (item index + 1), outlet `portItems`, ore diffs of terrain chunks, project costs. Since D47 it also carries the table they refer to (`SaveData.content`: item, building and recipe ids in order, each recipe's inputs and outputs). Loading re-points every index by id ([sim/save-remap.ts](../src/sim/save-remap.ts), [persistence.md](persistence.md)), so **inserting or reordering entries is free**. Renaming or removing an id is not:
- A **renamed** id goes in `RENAMED` ([content/retired.ts](../src/content/retired.ts)).
- A **removed** building goes in `RETIRED_COSTS` (saves that hold one get its cost refunded).
- A recipe whose inputs or outputs change resets the machines that ran it, and their buffers go to the Heart.
- What cannot be mapped is listed on the player's absence report.

Research is saved by id, but its order still changes the `Mods` values (floors per step).

## Balance — `BAL`

One object, so balancing is one diff. The values are engine-facing integers (‰, ticks, items); check each knob's comment for its unit. `BAL.market` is the exception: the market computes in floats and only hands integers to the sim.

| System | Knobs | Read by |
|---|---|---|
| Founding | `startStock`, `startCredits` (◉, stored ×100) | colony constructor ([state.ts](../src/sim/state.ts)) |
| The fog (D117) | `coreReveal` (tiles round the Core by its level 1–4: 44 at founding, then 56, 68, 80), `buildReveal` (round any building placed, plus half its longer side; `revealOf`: a pylon's own `reveal`, none for a line piece), `landReveal` (below) | colony constructor, `upgradeHearth`, `place` ([systems/build.ts](../src/sim/systems/build.ts)), `Sim.liftFog` |
| Expertises (D93) | `expertise`: `level`, `slots`, `reorientCents`, `reorientGrowth`, `gapMinutes`, `gridPermille` | [systems/expertise.ts](../src/sim/systems/expertise.ts), the Expertise window |
| Hearth and stores | `hearthCap[level]`, `hearthSolarKw` and `hearthCoreKw` (by level, D101: its isotope core 210/300/420/560 kW day and night, about 70 % of its noon power; its solar panel's peak 90/130/180/240 kW, nothing at night), `hearthDataBase` (the Survey Data a minute it makes from `hearthDataLevel`, research or not, D101), `hearthPortPerMin` (the trade posts' outlets; the Hearth has none), `hearthUpgrades` (unlock and cost of levels 2–4), `hearthDataLevel` (the level that mounts the data outlet: below it the Heart makes no data, D86) | colony stock cap; graph compiler; [systems/build.ts](../src/sim/systems/build.ts) and the Hearth inspector panel |
| Machines and buffers | `inBufCrafts`, `outBufCrafts`, `drillBufItems`, `forkBufItems`, `towerSpeed` | [nodes.ts](../src/sim/flow/nodes.ts); graph compiler |
| Ribbons | `beltDensity`, `runSpanTicks`, `remoteBeltCostMult` | [chain.ts](../src/sim/flow/chain.ts), graph compiler, items view; placement |
| Power: the wind (D95) | `wind`: the time — `curve` (36 ‰ a day epoch), `moodLow`/`moodHigh`, `step`, `veer`/`veerSide`; the place — `base`, `levelGain`, `relRadius`, `relGain`/`relGainLow`, `fetch`, `side`, `openGain`, `shelterGain`/`shelterMax`, `basinGain`, `funnelReach`/`funnelClear`/`funnel`, `min`/`max` | [world/wind.ts](../src/sim/world/wind.ts): `windAt`, the `WindField`'s exposures; through `windSite` (power/network.ts) the compiler, the inspector, the Vent view, the debug bases |
| Land and remote building (D60, [land.md](land.md)) | `land`: `parcel` (16 tiles a side), `base` and `tile` (centi-◉: every parcel, then per tile by ground), `depositPerValue` (per deposit tile and point of ore value, at richness 500), `growth` (‰ per parcel bought: the base of `mods.landGrowth`), `rentPermille` (of the price, an hour), `neighbours` (D110: map 4's holdings — `block`, `chance`, `size` —, maps 1–3's `scatter`, and where a base may stand: `floor` ‰ of `samples`² points on open floor), `farRadius` (Far Claims); `landReveal` (fog lifted round a parcel newly held), `remoteBuildTilesPerSec` | [world/land.ts](../src/sim/world/land.ts), [systems/land.ts](../src/sim/systems/land.ts); placement; [modifiers.ts](../src/sim/research/modifiers.ts) |
| Market | `tradeFee` (200 ‰: CrierBelt's fifth, the base of `mods.tradeFee`; no research lowers it, D64), `tradeOrders` (standing orders; Standing Orders +4), `tradeThroughput`, `liftDelayMin`; `BAL.market` (floats by design, read by `src/market/`) | modifiers; the market |
| Digging and landfill | `digMinutes`, `digRubble`, `embedIron`(`Items`), `embedCopper`(`Items`), `fillSeconds`, `fillRubble`, `digReach`, `fillReach`, `excavatorCap`, `backfillerCap` | [space.ts](../src/sim/space.ts), [systems/landscape.ts](../src/sim/systems/landscape.ts), graph compiler (caps), the reach rings in overlays, build mode and inspector |
| Offline | `reservoirMargin` | [catchup.ts](../src/sim/offline/catchup.ts) |
| The Gleaners (D103, D112) | `gleaners`: `window` (one raid a chain every 2 400 ticks of the world's clock), `raid` (how long a raid's posts may take: 600 ticks), `stagger` (each post opens 70 ticks after the one before), `group` (a band's size: `min` 3, `max` 5, one more each `per` 8 exposed cells past `min`; one item a post a raid), `pocket` (the largest closed pocket of floor out of their reach: 1 500 tiles), `darkSun` (the sun ‰ at or under which they are out: 0) | [world/reach.ts](../src/sim/world/reach.ts) via the compiler, [flow/chain.ts](../src/sim/flow/chain.ts), [systems/gleaners.ts](../src/sim/systems/gleaners.ts) |

The item ids inside `BAL` (`startStock`, `hearthUpgrades`) are typed as wide `Record<string, …>` and are not validated. A typo throws when used (`itemIdx`). An unknown `hearthUpgrades[].unlock` silently keeps that level locked forever.

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
| `tiredVeinPerMin() × 2 < wirePerElectronicsWorkshop()`, pinned at 6.75 ore/min → 13.5 wire vs 30 | Design: the cirque's « filon fatigué » cannot feed one electronics workshop on circuits, so copper ore must be imported from T2. |
| The Synthesis (`TIER1_WHOLE`) needs every other Tier 1 node, and `TIER_GATE[2]` is it; `expertiseProblems` | D93: Tier 1 is completed whole before the Core's level 3 and the expertises. |
| `recipesPerMachine()`: none over `MAX_RECIPES`; `nodeGives(id)` non-empty for every research node; a speciality only from Tier 3, a split family's Tier 3–4 nodes with one; each node needs its tier's gate | D69, D70. |
| `uniquesNeeded('atlas') ≥ 2`, `uniquesNeeded('codex') === 5` (pinned at 2 and 5; Survey Data needs 0) | Each colony reaches about two uniques, so T3 and T4 require trade. |
| Nothing unusable (`usabilityProblems`, [usable.ts](../src/content/usable.ts), D107): every plan and research node unlocks only buildings it lets the base pay for and run, recipes it lets it feed, Heart levels it lets it pay, features with what they act on — extracted, made or bought by then | The owner, 2026-10-17: a player must never unlock what they cannot use; what cannot be mined must at least be bought. |

Not validated, though the engine relies on it: a recipe has exactly one output; recipe `machines` are of kind `machine` and have enough input ports; kind-specific fields are present (`belt`, `pole`, `gen.fuel`…); `RAW` lists every land-sourced item (the list is hand-maintained); descriptions match the actual unlocks and numbers.

## Who reads what

| Layer | Reads | Where |
|---|---|---|
| Graph compiler | `BUILDING_KIND`, `buildingDef` (`belt`, `gen`, `drill`, `pole`, `accumulator`, `storageCap`, `kw`), `CRECIPES` by `cfg`, `BAL` | [compile.ts](../src/sim/graph/compile.ts), [entities.ts](../src/sim/entities.ts) (ports), [links.ts](../src/sim/power/links.ts) and [network.ts](../src/sim/power/network.ts) (wires, grids) |
| Flow nodes | `CRecipe`, `N_ITEMS`, item `kind` (fluids), buffer knobs | [src/sim/flow/](../src/sim/flow/) |
| Systems | unlocks, costs, `needsZone`, kind placement needs, `replaceGroup` (and ports, footprint, kind, `logic`: whether turning a building matters), `reveal`, recipes' `machines`, dig, fill and land knobs | [src/sim/systems/](../src/sim/systems/), [space.ts](../src/sim/space.ts), [world/land.ts](../src/sim/world/land.ts) |
| The tree | `PLANS`, `PLAN_IDS`, `RESEARCH`, `RESEARCH_IDS`, `BRANCH_CORE`, item `value` (notes); `planDef`, `isPlan` (`sim.unlocked`, `unlockPlan`) | [src/sim/research/](../src/sim/research/), [systems/research.ts](../src/sim/systems/research.ts), [state.ts](../src/sim/state.ts) |
| World generation | `world.ts` tables, item indices | [mapgen.ts](../src/sim/world/mapgen.ts) |
| Art | `BUILDINGS` (w, h, ports) plus one drawing per id; `ITEMS` (glyph, colour); belt tiers per id | [render/art/recipes/](../src/render/art/recipes/), [atlas.ts](../src/render/art/atlas.ts), [render.md](render.md) |
| World views | `BUILDING_KIND` (belts and conduits drawn as belt pieces), reach knobs | [render/world/](../src/render/world/) |
| UI | names, categories (tray order), costs, unlocks, `recipesFor`, the tree (plans' and research's names, descs, lanes, prerequisites, costs, effects — the tech tree screen lays it out from content); building `desc` and, for the building card, nearly every building field (`kw`/`idleKw`, `gen`, `accumulator`, `belt`, `drill`, `storageCap`, `reveal`, `pole`, `logic`, `ports`, `needsZone`, `replaceGroup`) with the `BAL` knobs behind them | [build-bar.ts](../src/ui/build-bar.ts), [building-facts.ts](../src/ui/building-facts.ts) and [building-card.ts](../src/ui/building-card.ts), the inspector's panels for the kind ([src/ui/inspector/](../src/ui/inspector/)), HUD, research and stats screens, [tip.ts](../src/ui/tip.ts), artboard, [ui.md](ui.md) |
| Input and shell | `isBeltDef` (drag tool, ghost), `costOf` previews, reach rings, `isoHead` (picking) | [tools.ts](../src/input/tools.ts), [src/app/](../src/app/), [input.md](input.md), [app.md](app.md) |

## How to…

### Add an item
1. Append an entry to `ITEMS`: `name`, `tier`, `kind`, `value`, `depth`, `glyph`, `color`.
2. For a new silhouette, add it to the `Glyph` union in `types.ts` and draw it in `GLYPHS` ([items.ts art](../src/render/art/recipes/items.ts)); the `Record<Glyph, …>` type makes this mandatory.
3. Make it producible. A crafted item needs a recipe (next section). A land-sourced item must be added to `RAW` in `validate.ts` and to world generation. For a deposit, that means `COMMON_DEPOSITS` or `CIRQUE.deposits` plus the per-item base richness that [mapgen.ts](../src/sim/world/mapgen.ts) hard-codes (default 500). A unique needs an `UNIQUE_BIOMES` site, which also makes it raw. A fluid uses `kind: 'fluid'` and travels by conduit only.
4. Optionally, add it to the early-chain `ORDER` list in [hud.ts](../src/ui/hud.ts); otherwise it appears in the HUD once held. Statistics, the cargo pickers and the art atlas pick it up automatically.
5. If it is tradable (`depth > 0`), the market expects at least one colony supplier and one buyer for it in [colonies.ts](../src/content/colonies.ts) (secondary trade lines of weight 1 cover the goods the plan's table leaves out).
6. Run the content tests. If it changes atlas or codex chains or copper wire, re-check the scarcity pins.

### Add a recipe
1. Append to `RECIPES`: `machines` (ids of kind `machine`: a family's list, three recipes at most per machine), `seconds` from the divisor list, one output, quantities with at most 3 decimals, `unlock`.
2. If it is gated, name it in the unlocking node's `desc` (fr and en).
3. That is all. The inspector lists it via `recipesFor`, `setRecipe` checks `machines` and `unlock`, and the art has nothing to do. Append rather than insert: machines store the recipe index in `cfg`.

### Add a building
Content side:
1. Append to `BUILDINGS` with `name`, `desc`, `kind`, `category`, `w`, `h`, ports at rotation 0, `kw`/`idleKw`, `needsZone`, `cost`, `unlock` and the kind-specific fields from the table above. Its tray slot follows its position. A new ribbon tier, routing block, mast or drill also needs the matching `replaceGroup`, so that it can be placed over its kind and its kind over it.
2. For a machine, add its id to the `machines` of the recipes it runs (a family's list; three recipes at most, D70).
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
1. A family node: `id: node(family, spec, depth, after, [fr, en], [fr, en], effects, also)` (a keystone at depth 9). Prerequisites, cost and time follow (`DEPTH_COST`); `also` names another lane's node it acts on. A trunk node: `trunk(…)` with explicit values. Append it: application order matters. The validation then checks it unlocks nothing unusable (D107): a new feature flag or `add` target goes into `FEATURE_NEEDS` ([usable.ts](../src/content/usable.ts)) with the buildings it acts on.
2. Unlocks are set on the unlocked building, recipe or `BAL.hearthUpgrades` entry, never as an effect. Describe them in `desc`. A new effect target or flag also wants an icon in the tree screen's `EFFECT_ICON` ([research.ts screen](../src/ui/screens/research.ts)); without one the node shows the lab.
3. A new **multiplier or additive target**:
   - add it to the `ModTarget` union in `types.ts`;
   - add it to the `targets` list in `baseMods()` ([modifiers.ts](../src/sim/research/modifiers.ts)): the default is 1000‰, or 0 if listed in `ADDITIVE`; a BAL-based start goes after the defaults, like `tradeFee` and `landGrowth`. Without it the value is `undefined` and turns to `NaN`;
   - read `sim.mods.<target>` where the behaviour lives. Research completion recomputes `Mods` and recompiles the graph (`rebuildDerived`).
4. A new **flag** is a free string. Test it with `mods.flags.has('…')` in the consumer; a typo is a silent no-op.
5. A new **branch** touches the `branch` union (`types.ts`), `Branch` and `BRANCH_CORE` (`research.ts`), `BranchId`, `BRANCHES` and `branchCounts` ([runtime.ts](../src/sim/research/runtime.ts)), `perBranch` (`modifiers.ts`) and a `research.branch.<b>` key. The tech tree screen builds its research lanes from `BRANCHES` (a lane colour in `screens.css`).
6. Tests: validation (prereqs, loops, reachability, producible costs) and [research.test.ts](../src/sim/research/research.test.ts), which pins the table's costs (D72: the same whatever the claim owns).

### Add a plan
1. Add it to `PLANS` (in [research.ts](../src/content/research.ts)) among its path's plans: `plan(lane, prereq, cost, more?)`, the lane being its path (D41); it must hang from a plan of the same path unless it is the path's entry (validated). Give its building `unlock: '<plan id>'` (usually the building's own id). A feature plan (no building) needs `name`, `desc` and `effects`; its consumer tests the flag (`mods.flags.has`), and its icon goes into the tree screen's `EFFECT_ICON`. An analytics step: its flag is its id, listed in `ANALYTICS`, read through `analyticsOn`, with a reveal in `ANALYTICS_REVEALS` (ui/analytics.ts) and a `focus.<id>` caption.
2. Keep root plans affordable from the starting stock together while keeping CrierBelt's restart reserve, and costs in the bootstrap's materials (plates, glass, copper wire). Both are validated (D36).
3. That is all for the engine: `unlockPlan` pays and records it, `sim.unlocked` and the build bar follow, the tree screen places it from its prerequisites and lane. If the tutorial uses the building, add an `unlock` step before the step that builds it (validated).
4. Tests: `npx vitest run src/content src/sim/research src/sim/systems/quests.test.ts`.

### Tune a number
1. Find it. Knobs live in `BAL`; per-thing numbers live in the tables (`cost`, `kw`, `perMin`, `seconds`, `DEPTH_COST`, `CIRQUE`…). Some are still hard-coded: see the pitfalls below.
2. Keep the units: integers where `BAL` says ‰, ticks or items; table quantities with at most 3 decimals; recipe seconds from the divisor list.
3. Update the descriptions that quote the number. Building and research `desc` strings repeat values by hand ("20/min", "rayon de 40 tuiles", "Stocke 1 200 kW·min", the land research's 6 % and −30 %).
4. Run `npm test`. These tests pin content numbers: `validate.test.ts` (6.75 / 18 / 2 / 5; the restart reserve 59 / 6 / 4, D36); `research.test.ts` (en7: 114 + 16 vs 224 + 30); `space.test.ts` (40 stone per pond tile, ribbons ×3 off the claim's land, Hearth level 2 and its land discount); `land.test.ts` (a bare parcel at `base` + 256 floor tiles, the growth, the rent per mille, the starting square's reach 2 on the template); `power.test.ts` (sun table: nothing at night); `flow.test.ts` (drill rate, ribbon transit); `mapgen.test.ts` (cirque layout); `catchup.test.ts`.
5. Changing a number changes state hashes, so recorded command logs replay differently. Saves stay loadable unless indices move.

## Known gaps and pitfalls

- **One output per recipe.** `MachineNode` emits `outs[0]` only, and validation does not check it.
- **Inert fields.** These are declared but not used: `crafts`; `energyKwMin`; the `unlock` effect; `tier` and `depth` outside the M6 market (in progress); archetype and biome names. (`ARCHETYPES.*.copperVein` is now the land's embedded-copper chance, through `MapGen.embedCopper`.) Also unused: `respecCooldownDays` (14 days and the 7-day grace are hard-coded in the research system and screen), `tradeThroughput`, `liftDelayMin`.
- **Research effects with no consumer yet.** The flags `tunnels` (ex6), `stormHarvest` (en7) and `deepHeat` (en8); every Commerce flag (`tradeFee` is fixed at CrierBelt's fifth, D64). The Commerce mastery stat (`slippage`) is therefore inert until M6.
- **Duplicated sources of truth.** The Hearth's `storageCap` and `gen.kw` duplicate `BAL.hearthCap[0]` and `BAL.hearthSolarKw`; the `BAL` values win. `CYCLE_LCM` is redeclared in `validate.ts`. Ticks per second (×10, ×600) is hard-coded in the registry. Hard-coded in the compiler: silo ports 240/min, excavator outlet 120/min, a lab's store 200 items (`LAB_CAP`) (a pump's rate is its `drill.perMin` since D70).
- **Validation approximations.** `tiredVeinPerMin` hard-codes the wire recipe's ×2 and ignores mapgen's ±20% per-player richness and 70% edge falloff. The margin still holds at +20% (16.2 < 18). `uniquesNeeded` minimises each input separately, so it is an upper bound.
- **Inexact fractions.** `sunheart.fuelPerMin: 1/30` becomes 33 mu per epoch.
- **Lists to keep in sync.** The branch list exists in four places, `ModTarget` in two, and flags are untyped strings.
- **Typography in tables is checked for punctuation only.** `i18n.test.ts` rejects a plain space before `: ; ! ? %` in the French half of every `{ fr, en }` ([i18n.md](i18n.md)); the thousands separator (U+202F) and the space between a number and its unit (U+00A0) are not checked.
- **Ids are persistent identity** (see *Index stability*): rename or remove an item, building or recipe only with a line in `content/retired.ts`.
