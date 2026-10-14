# Glossary

The vocabulary of Ocelle in two parts: game terms as the player reads them (French first, English second, with the code id), and the engine and code terms used across `src/`.
Names come from the content tables ([content.md](content.md)) and the dictionaries ([i18n.md](i18n.md)). The mechanics behind the engine terms are in [engine.md](engine.md), [offline.md](offline.md) and [render.md](render.md).

## Where things are

| Kind of term | Source of truth |
|---|---|
| Building, item and research names | [buildings.ts](../src/content/buildings.ts), [items.ts](../src/content/items.ts), [research.ts](../src/content/research.ts) (`name: { fr, en }`) |
| World, archetype and biome names | [world.ts](../src/content/world.ts) |
| UI words (screens, statuses, branches) | [fr.ts](../src/i18n/fr.ts), [en.ts](../src/i18n/en.ts) |
| Engine units and cadence | [constants.ts](../src/sim/constants.ts), [types.ts](../src/sim/types.ts) |
| Layers and invariants | [../ARCHITECTURE.md](../ARCHITECTURE.md) |

## A. Game vocabulary

### World, base and lore

The story behind the names is in [lore.md](lore.md) (D29).

| Français | English | Code | Meaning |
|---|---|---|---|
| Ysmère | Ysmere | — | The planet: a pale-ochre desert under a constant wind. |
| Verrière | Verriere | — | The planet's only human city, where the player lives; never drawn. |
| CrierBelt | CrierBelt | — | The company that runs the Crier Ring and its cargo lifts; the player's partner (it takes the trade fee). |
| concession · base | claim · base | `Sim.colonyName` | The player's single persistent base, fully automated and piloted from afar (code says "colony"). |
| le Souffle | the Sough | gust levels in `constants.ts` | The constant wind. Also the French name of the Energy branch. |
| Cirque de Bonne-Veine | the cirque | `CIRQUE` | The starting basin (r ≤ 23), the same for every colony. |
| la Couronne | the Crown | `CIRQUE`, `crownOuter`, `crownReach` | The closed mountain ring round the cirque (D45). Map 2 (D63): a sandstone ridge two levels high from the floor's rim (r ≈ 23) to its foot (r ≈ 29), rising in a few places to lilac level-3 peaks; the biggest holds the tarn. Map 1 (older bases): three levels to r 34 |
| le lac perché / the tarn | the tarn | `CIRQUE.lake`, `TerrainSource.tarn` | The cirque's lake, up on the Crown's biggest peak at its level (D63): a pump on its edge, a ceramic works beside it on the rock |
| col | pass | `CIRQUE.passDirs` | A gap through the Crown. |
| le filon fatigué | the tired vein | the `copper_ore` deposit of `CIRQUE` | The deliberately poor copper deposit (≈ 6.75 ore/min) that forces imports. |
| Proche couronne · Les Étendues · Les Lointains · Mer de dunes | — | `RINGS.near`, `reaches`, `far`, `playable` | The rings beyond the Crown (32–160, 160–320, 320–480); décor past 500. |
| archétype | archetype | `ARCHETYPES` (`closed`, `steppe`, `lagoons`, `mesas`, `embers`) | A per-player environment: Cirque fermé / Closed Cirque, Grande Steppe / Wide Steppe, Lagunes de sel / Salt Lagoons, Mesas sifflantes / Whistling Mesas, Champs de braise / Ember Fields. |
| biome unique | unique biome | `UNIQUE_BIOMES` | A site that yields one unique resource. T3: Bosquet de verre / Glassgrove, Falaises à résine / Resin Cliffs, Champs de braise / Ember Fields. T4: Marais d'encre / Inkmarsh, Mer de nacre / Nacre Seabed, Les Orgues / Organ Peaks. |
| gisement | deposit | per-tile `ore` and `rich` ([grid.ts](../src/sim/world/grid.ts)) | Ore tiles: infinite, but capped per tile per minute. Only drills extract them. |
| roche H1–H4 | rock H1–H4 | `T.Rock1`…`T.Rock4` | Diggable rock by hardness: sandstone, basalt, lilac obsidian (ex4), heartrock (ex7). |
| évent | vent | `T.Vent` | The tile a geothermal plant must stand on. |
| saline | salt flat | `T.Salt` | Takes ribbons, masts and salt drills; can be backfilled. |
| brouillard | fog | `Sim.explored` | Unexplored land. Lifted at founding (r 44), round each parcel the claim comes to hold (r 32 from its centre) and by beacons. |
| parcelle | parcel | `PARCEL`, `parcelAt`, `sim.land` ([world/land.ts](../src/sim/world/land.ts)) | A square of land, 16 tiles a side, on a grid centred on the Heart; CrierBelt sells and leases it at a price from what it holds (ground, deposits), dearer with each parcel bought ([land.md](land.md), D60). |
| carré de départ | starting square | `Land.inStart`, `Land.reach` | The claim's grant: the square of parcels round the Heart that holds the whole Crown (5×5 on most lands, 7×7 round a closed cirque); never bought nor lost. The land panel calls it « Concession d’origine » / Original grant. |
| vos terres | your land (the claim's land) | `Land.holds`, `covers`; refusal `outside_zone` « Hors de vos terres » | The parcels the claim holds: the starting square, those bought, granted (an older save) or leased. A production building stands wholly on them; ribbons, poles and beacons may cross other land. |
| bail · loyer | lease · rent | `rentLand`, `Lease`, `landEpoch`, `endLease` | A parcel rented by the hour once « Cadastre » / Land Registry (`tr4`) is learnt: 3 % of its price an hour, fixed for the lease's life. A rent the purse cannot pay ends it (« Bail perdu »): what stands there goes dormant until the parcel is held again. |
| Aménager | Landscape | the `mark` tool; `designated` | The brush that marks rock to dig or water to fill. |
| Vue · Plan | View · Plan | `ViewMode` `'iso'` / `'plan'` | The default isometric view, and the top-down board used to build. |

### Buildings (`BUILDINGS`, kind in brackets)

| Français | English | Code | Meaning |
|---|---|---|---|
| Cœur | Heart | `hearth` [hearth] | The base's core (code: "Hearth"): depot of the base's stock, pays for construction, drone bay, uplink, small solar array. Placed at founding; grows to level 4, each level past the first making land 5 % cheaper. |
| Avant-poste | Waystation | `outpost` (retired, D60) | Gone with the influence zones it extended: a save that still holds one gets it refunded (`RETIRED_COSTS`), its store to the Heart, and the claim keeps the parcels it stood on. |
| Balise d'arpentage | Survey Beacon | `beacon` [beacon] | Lifts the fog within 40 tiles; can stand off the claim's land and on rock (never on a sister claim's parcel). |
| Foreuse · Foreuse profonde | Drill · Deep Bore | `drill`, `deep_bore` [drill] | Extract the majority ore beneath them, capped by the tiles' caps. |
| Collecteur de sable | Sand Collector | `sand_collector` [drill, `ground`] | Scoops sand off the bare ground, 15/min, anywhere on plain sand (sand is the floor, no deposit; D38). |
| Excavatrice | Excavator | `excavator` [excavator] | Digs marked rock within its reach, yields stone and embedded ore. |
| Pompe à eau | Water Pump | `pump` [pump] | 60 water/min at the water's edge. |
| Remblayeuse | Backfiller | `backfiller` [backfiller] | Fills marked water and salt flats with stone, making new floor. |
| Ruban · Ruban vif · Ruban express | Ribbon · Swift Ribbon · Express Ribbon | `ribbon`, `swift_ribbon`, `express_ribbon` [belt] | Conveyors: 60, 120 and 240 items/min. |
| Routeur | Router | `router` [fork] | Takes in at its back only and deals out in turn to its front and sides; a filter per side keeps that side for one item (D35). Dropped onto a ribbon, it takes the ribbon's way. |
| Trieur / Trieur inversé | Sorter / Inverted Sorter | `sorter`, `inverted_sorter` [fork] | Directional: the chosen item straight on, others to the sides (inverted: the opposite). |
| Vanne de trop-plein / de sous-débit | Overflow / Underflow Gate | `overflow_gate`, `underflow_gate` [fork] | Directional: straight on first, then the sides (underflow: the opposite). |
| Déchargeur | Unloader | `unloader` [fork] | Against a store: takes its chosen item out to the ribbons and machines around. |
| Distributeur | Distributor | `distributor` [fork] | A big 2×2 router that takes from and gives to every side (eight sides), with dn5. |
| Croisement | Junction | `crossing` [crossing] | Two ribbon lines cross without mixing. |
| Passerelle | Bridge | `skybridge` [bridge] | Leaps up to 3 tiles (7 with dn2) to the next bridge in its direction. |
| Croisement | Crossing | `crossing` [crossing] | Two ribbon lines cross without mixing. |
| Passerelle | Skybridge | `skybridge` [bridge] | A ribbon that leaps 4 tiles (8 with dn2) over ribbons, rock or water. |
| Conduit | Conduit | `conduit` [conduit] | Water pipe, 240/min; carries fluids only. |
| Silo | Silo | `silo` [storage] | Buffers 1 000 items of a single kind. |
| Embarcadère | Skydock | `skydock` [dock] | Hosts drifters; the end of a freight route. |
| Fonderie (compacte) | (Compact) Smelter | `kiln`, `kiln_compact` [machine] | Smelts ore and sand by burning coal; needs no grid. |
| Tréfileuse | Wire Mill | `wire_mill` [machine] | Copper ore → copper wire. |
| Atelier · Grand atelier (compact) · Atelier-tour | Workshop · (Compact) Great Workshop · Tower Workshop | `workshop`, `great_workshop`, `great_workshop_compact`, `tower_workshop` [machine] | 2-input crafting, 3-input crafting, and 3-input crafting at 4× speed. |
| Four à céramique | Ceramic Oven | `ceramic_oven` [machine] | Stone + water → ceramic. |
| Chargeur | Cell Charger | `cell_charger` [machine] | Charges cells: exportable energy. |
| Observatoire | Observatory | `observatory` [lab] | One research slot, fed with journals. |
| Poteau | Pole | `mast` [pole] | A pillar: up to 8 wires, each up to 6 tiles long (edge to edge). A new one wires itself to the nearest pillar or Cœur in reach. |
| Pylône | Pylon | `pylon` [pole] | A long-reach pillar: up to 4 wires, 24 tiles long (40 with xp4). |
| fil · relier | wire · link | `sim.links` (`PowerLinks`), `link` / `unlink` commands | A power wire: an explicit, saved pair of buildings, one end a pillar or the Cœur, the other a pillar or anything that makes, uses or stores power (D25). Drawn hanging in the air. The « Relier » / Link tool (L) strings and cuts them. |
| pilier | pillar | content `pole` (`mast`, `pylon`, and the Cœur) | A link point: a building that carries wires — its `range` (how far, edge to edge) and `slots` (how many). |
| réseau | grid | `Net` | The buildings joined by wires: one satisfaction for all; « hors réseau » = on no wire. |
| Générateur à charbon | Coal Generator | `brazier` [generator] | +300 kW, burning 10 coal/min. |
| Éolienne | Wind Turbine | `wind_flower` [wind] | +120 kW × local wind (0.7 in the cirque). |
| Panneau solaire | Solar Panel | `sun_bulb` [solar] | +150 kW in full sun. |
| Accumulateur | Accumulator | `accumulator` [accumulator] | Stores 1 200 kW·min, delivers 300 kW. |
| Centrale géothermique | Geothermal Plant | `fumarole_tap` [geothermal] | +1.5 MW on a vent. |
| Cœur-Soleil | Sunheart | `sunheart` [generator] | +20 MW; burns a resonator every 30 min. |
| Comptoir | Trade Post | `trade_post` [trade] | CrierBelt's cargo pad: 5×5, its flame apron kept clear, one entrance (what it sells) and one exit (what it bought, in turn) on flame-proof ribbons (D62). |
| tablier (du comptoir) | flame apron | the trade post's outer ring | The one-tile ring round the post's pad that the drones' flames keep clear: nothing else stands on it (D62). |
| Dérivant | Drifter | `BAL.drifterCost`, `Sim.fleet` | A freight airship bought at a skydock (not a building). Carries one item along a route. |

### Items (`ITEMS`)

| Français | English | Code | Meaning |
|---|---|---|---|
| Minerai de fer · Sable · Charbon · Minerai de cuivre · Sel | Iron Ore · Sand · Coal · Copper Ore · Salt | `iron_ore`, `sand`, `coal`, `copper_ore`, `salt` | Drilled raw materials. Coal is fuel; copper is scarce in the cirque. The early game uses ordinary materials on purpose; the exotic ones (T3–T4 uniques) come later (D23). |
| Pierre · Eau | Stone · Water | `stone`, `water` | From digging (item kind `rubble`) and from pumps. Water is a fluid and cannot be traded. |
| Plaque de fer · Verre · Fil de cuivre | Iron Plate · Glass · Copper Wire | `iron_plate`, `glass`, `copper_wire` | T1 products, and the usual building costs. |
| Engrenage · Circuit imprimé · Céramique · Batterie vide / chargée | Gear · Circuit Board · Ceramic · Empty / Charged Battery | `gear`, `circuit`, `ceramic`, `empty_cell`, `charged_cell` | T2 parts. A charged battery is energy you can export. |
| Verre-spore · Résine céleste · Sel de braise | Sporeglass · Sky Resin · Embersalt | `sporeglass`, `sky_resin`, `embersalt` | T3 uniques: each colony reaches only some of them, so they are traded. |
| Mousse lumen · Nacre fossile · Quartz chantant | Lumen Moss · Fossil Nacre · Singing Quartz | `lumen_moss`, `fossil_nacre`, `singing_quartz` | T4 uniques. |
| Lentille · Toile de résine · Cœur thermique · Résonateur · Treillis de nacre | Lens · Resin Canvas · Thermal Core · Resonator · Nacre Lattice | `lens`, `resin_canvas`, `thermal_core`, `resonator`, `nacre_lattice` | T3–T4 parts. |
| données (Données d’arpentage · Données mécaniques) | data (Survey Data · Mechanics Data) | `journal_1`, `journal_2` | T1 and T2 science: data cartridges the base produces, delivered to observatories (which uplink them). |
| Atlas · Codex | Atlas · Codex | `atlas`, `codex` | T3 science (needs 2 uniques) and T4 science (needs 5). |
| Module de vitesse | Speed Module | `pace_bell` | A module fitted into a machine: +30% speed (+50% with dn7), +40% power each. |

### Research, economy, states

| Français | English | Code | Meaning |
|---|---|---|---|
| arbre des techniques | tech tree | `PLANS` + `RESEARCH`, the `research` screen (T) | The one unlock tree (D33): plans on the left, research on the right; everything beyond the starting kit is unlocked there. |
| plan · Débloquer | plan · Unlock | `PLANS`, `unlockPlan`, `planBlock` | An instant node of the tree, paid from the Heart's stock in one click (the router, the smelter, the telemetry…). Never lost. |
| kit de départ | starting kit | `unlock: 'start'` | What a new base has: the drill, the ribbon, the pole and the Link tool. |
| chemin · Analytique · Commerce · Arpentage | path · Analytics · Trade · Survey | `PLAN_PATHS`, a plan's `lane` | The plans' paths of one theme each (D41): Production, Logistique, Énergie, Analytique, Commerce, Arpentage; each a band of its colour on the tree. |
| Télémétrie · Registre de production · Relevé d’énergie · Diagnostic | Telemetry · Production Ledger · Power Log · Diagnostics | plans and flags `telemetry`, `statistics`, `power_log`, `diagnostics` (`ANALYTICS`) | The Analytics path (D41): the HUD's rates; the Statistics screen (G) and its chip; its power history; its machines' states. The telemetry was research tr1's, then one plan for the rates and the screen. |
| révélation | reveal | `Spotlight`, `ANALYTICS_REVEALS`, `FL.focusReveal` | The short « black out » that lifts a newly unlocked readout out of the dimmed base, with CrierBelt's line (D41). |
| Réserve de relance | Restart reserve | `reserveNeed`, `planBlock` → `reserve`, `BOOTSTRAP` | What the Heart and its buildings must always cover so the base can rebuild its production: the bootstrap (a smelter line, then the copper line) less what an earlier stage makes. A plan never eats into it (D36). |
| Tronc | Trunk | `tr1`…`tr8` | The spine: gates the branches. It has no spreading penalty. |
| Taille · Arpentage · Densité · Souffle · Criée | Stonecraft · Wayfinding · Density · Current · Exchange | `ex`, `xp`, `dn`, `en`, `cm` | The five branches, with 9 nodes each (`research.branch.*`). |
| clé de voûte | keystone | depth 9, id `<branch>K` | A branch's last node. |
| Initié · Maître · Grand Maître | Initiate · Master · Grand Master | `BRANCH_CORE`, `BAL.initiateBonus`, `masterBonus` | Mastery at 3 and 6 nodes, and the keystone. It boosts the branch's core stat. |
| emplacement de recherche · pupitre | research slot · desk | `mods.slots` | How many projects can run at once: 1, then 2 (tr5), 3 (tr7), 4 (dnK). |
| étalement | spread | `penalty()` | Extra cost and time per node owned in other branches. |
| reconversion | reconversion (respec) | `respec`, `respec:<branch>` | Gives a branch up, deepest node first. Half its science comes back as archive notes after a wait. |
| notes d'archive | archive notes | `Sim.notes` | Non-tradable credit (centi-◉ of science value) that pre-pays new research. |
| en sommeil | dormant | `St.Dormant`, `isDormant` | A building whose unlock was reconverted away, or that needs land and stands off the claim's (a lease lapsed or given up): no flow, grey wash. |
| ocelle ◉ | ocelli (HUD) | `Sim.credits` in **centi-ocelles** | The currency. `BAL` and the UI speak ◉, the engine ×100. |
| la Criée | the Crier Ring | M6 | CrierBelt's orbital exchange, where every claim trades (`screen.crier`). |
| concessions sœurs | sister claims | [colonies.ts](../src/content/colonies.ts) (code: "colonies"); `Land.sister` | The market's forty simulated actors: other CrierBelt partners' bases. They also own about one parcel in eight beyond the ring round the starting square, sold or leased at ×1.6–2.4 the price CrierBelt would ask, and closed even to ribbons until the claim holds it. |
| valeur de référence · profondeur | reference value V · market depth Q | `ItemDef.value`, `ItemDef.depth` | The price anchor in ◉, and the NPC market depth in items/min. |
| Sortie (d'un stock) | outlet | `Ent.portItems` | An unloader port of a dock, set to one item — never of the Heart, which only takes in (D34). A trade post's one exit hands out all it bought, in turn (D62). |

## B. Engine and code terms

| Term | Meaning | Where |
|---|---|---|
| id / index | String id in content and commands; dense integer index in the engine (position in the table). | [registry.ts](../src/content/registry.ts) |
| MU, milli-item | 1 item = 1 000 mu. Every engine quantity is integer mu. | `MU` in [constants.ts](../src/sim/constants.ts), `toMu` |
| ‰ (permille) | Multipliers, speeds and satisfaction: 1000 = ×1. | throughout; `permille` in [fixed.ts](../src/core/fixed.ts) |
| tick | 1/10 s (`TPS = 10`). The sim's step. | constants.ts |
| epoch | 600 ticks = one minute (the sim runs in real time at 10 Hz): weather steps and (M6) market settlement. "Per epoch" = per minute. | `EPOCH` |
| day · gust window | 36 epochs (12 dark, 3 dawn, 18 sun, 3 dusk) · 10 epochs at one of 5 wind levels. | `DAY_EPOCHS`, `SOLAR`, `GUST_*` |
| world epoch | Absolute minute since `WORLD_EPOCH0`. Weather depends only on it and `WORLD_SEED`. | constants.ts; `foundingEpoch` |
| `CYCLE_LCM` · `PERIOD_MAX` | Every recipe cycle divides 1 200 ticks · the warm-up's period window (2 400). | constants.ts, [validate.ts](../src/content/validate.ts) |
| centi-ocelle | The engine's money unit (1 ◉ = 100). | `Sim.credits`, `credits()` in [format.ts](../src/i18n/format.ts) |
| kind | `BuildingKind`: the behaviour selector of a building. | [content/types.ts](../src/content/types.ts), `BUILDING_KIND` |
| entity (`Ent`) · `def` | A placed building or ribbon tile (ids never reused) · its building index. | [types.ts](../src/sim/types.ts), [entities.ts](../src/sim/entities.ts) |
| footprint · port · world port | Rotated size · a building's in/out opening · the same in world coordinates with the tile it faces. | entities.ts |
| `cfg` | Per-entity config word: recipe + 1 and speed modules (machines), side filters (forks). | [cfg.ts](../src/sim/cfg.ts) |
| command · log · replay | Every mutation is a logged `Command`; replaying the log rebuilds the same state hash. | [commands.ts](../src/sim/commands.ts) |
| `SimEvent` | What the colony reports to the shell: ids and numbers only. | commands.ts |
| graph | The flow graph compiled from grid + entities: nodes, chains, edges, power nets. | [compile.ts](../src/sim/graph/compile.ts) |
| node (`FNode`) | A flow participant with phase methods (offer, accept, split, take, give, update). | [node.ts](../src/sim/flow/node.ts), [nodes.ts](../src/sim/flow/nodes.ts) |
| edge | A link from an out port to an in port; at most one per port, so there is no contention. | compile.ts |
| phases A/B/C | A: offers, accepts and splits from start-of-tick state; B: transfers; C: internal updates. The result does not depend on node order. | node.ts, [step.ts](../src/sim/flow/step.ts) |
| chain | A maximal run of same-pace ribbon tiles, each with exactly one feeder: one cell per tile, an item moving one tile on each of its tier's steps (D57). A conduit's chain is a FIFO of runs. | [chain.ts](../src/sim/flow/chain.ts) |
| step / beat | When a ribbon moves its items one tile: perMin times a minute on the world's clock, the same for every ribbon of that pace (`stepAt`); store outlets hand out an item on their own beat. | chain.ts `stepAt`, `stepPeriod` |
| cell | One ribbon tile's place for one item (`Chain.cells`). | chain.ts |
| run | A conduit chain's FIFO element `{ item, mu, from, to }`: a quantity and the tick window in which it reaches the head ("parcel" in older text and comments). | chain.ts `Run` |
| chain tier | The building index of a chain's ribbons (ribbon, swift, express, conduit, skybridge). | chain.ts |
| routing block | A `ForkNode`: router, sorter, gate, unloader, distributor (kind `fork`); its links come from its surroundings. Side-loading onto a ribbon is a lower-priority incoming edge. | `ForkNode` in nodes.ts; `rim`, `routingPorts`, links in compile.ts |
| reservoir | A stock node with a capacity: the Hearth, silos, docks, trade posts, observatories, excavators, backfillers. Groups are cut at reservoirs. | `ReservoirNode` in nodes.ts |
| unloader port | A reservoir out port handing out one chosen item (`portItems`): skydock outlets, and the virtual ports unloaders add to the stores they touch — never on the Heart, which has no outputs (D34). | nodes.ts, [types.ts](../src/sim/types.ts) |
| virtual mode | During warm-ups a reservoir behaves by state flags (normal, empty, full) and records flows instead of changing its stock. | `V_NORMAL`/`V_EMPTY`/`V_FULL`, [steady.ts](../src/sim/offline/steady.ts) |
| rotating allocation · water-filling | Fair splits of capacity among edges, rotating with the tick · a proportional capped split (tested; no flow-engine caller yet). | `allocRotating` in node.ts · `waterfill` in fixed.ts |
| group | A connected component of the graph cut at reservoirs: the unit the catch-up warms up and extrapolates. | [groups.ts](../src/sim/graph/groups.ts) |
| net (power grid) | A connected component of the wires among built, awake buildings (union-find, D25); every pillar heads one, an ordinary building joins one only through a wire. Its producers, consumers and accumulators share one satisfaction. | `Net`, `buildGrids` in [network.ts](../src/sim/power/network.ts) |
| link point · reach · slots | A pillar or the Hearth (content `pole`) · how far a wire may go: footprint edge to footprint edge, the longer range of its two ends · how many wires a link point holds. | [links.ts](../src/sim/power/links.ts) `linkPoint`, `gap2`, `linkCheck` |
| satisfaction *s* | Served ÷ demanded power on a grid, in ‰, floored to 25‰ steps. Machines run at speed × *s*. | [solve.ts](../src/sim/power/solve.ts), `SAT_STEP` |
| merit order · dispatch | Renewables → fuel generators → accumulators · the ‰ of fuel capacity in use, which sets the fuel burn. | solve.ts |
| `Mods` · flag | Research effects compiled into one table (‰ multipliers, additive integers) · a named boolean effect (`mods.flags`). | [modifiers.ts](../src/sim/research/modifiers.ts) |
| project | A research (or a reconversion `respec:<branch>`) holding a slot. | [runtime.ts](../src/sim/research/runtime.ts) |
| allowance | A cap ⌊total × e ÷ duration⌋ on what a timed process may have paid or moved after elapsed powered time *e*. It makes research and digging path-independent, so online and offline agree. | runtime.ts `advanceProject`, [space.ts](../src/sim/space.ts) `advanceJob` |
| designation | A tile marked for digging (rock) or filling (water, salt flat). | `Sim.designated`, [landscape.ts](../src/sim/systems/landscape.ts) |
| job | The single dig or fill an excavator or backfiller is running. | `Job` in space.ts |
| route · fleet | Freight of one item between two skydocks at `ships × C / (2d/v + 2t)` per minute · drifters per dock. | `Route` in space.ts, [freight.ts](../src/sim/systems/freight.ts) |
| regime | A group's periodic behaviour under fixed conditions (reservoir flags, power, mods), cached by key. | steady.ts, [catchup.ts](../src/sim/offline/catchup.ts) |
| warm-up | Stepping a group with the online tick code until its state hash repeats: transient *t₁* + period *p* + prefix. | `warmUp` in steady.ts |
| segment · event | The catch-up's timeline cut at events: epoch, reservoir at a bound, accumulator full or empty, construction or research done. | catchup.ts |
| pseudo-flow | A timed process the catch-up treats as a known, constant reservoir in-flow or out-flow: research draws, dug stone, backfills, freight. | catchup.ts, [src/sim/systems/](../src/sim/systems/) |
| direct · exact · approx | Catch-up modes: ticked one by one · every regime periodic · some regimes averaged. | [report.ts](../src/sim/offline/report.ts) |
| away report · incident | The "while you were away" summary (ids and numbers) · one notable event in it. | report.ts |
| state hash | A two-lane 32-bit hash of the whole state, used for determinism checks (`FL.hash()`). | `StateHasher` in [hash.ts](../src/core/hash.ts) |
| determinism guard · layering · purity check | Bans `Math.random`, the clock and transcendental maths in the engine and the content tables · allowed imports per folder · engine, content and market compiled without the DOM. | [serialize.test.ts](../src/sim/serialize.test.ts), [architecture.test.ts](../src/architecture.test.ts), [src/sim/tsconfig.json](../src/sim/tsconfig.json) |
| chunk · terrain class · diff | 32 × 32 tiles of the 1 024² world · `T.Sand`…`T.Filled` · the saved terrain and ore overrides on top of generated land. | constants.ts, types.ts, [grid.ts](../src/sim/world/grid.ts) |
| `WORLD_SEED` · player seed | The shared seed (cirque, weather) · the per-colony seed blended in with distance; it also picks the archetype. | world.ts, [mapgen.ts](../src/sim/world/mapgen.ts) |
| `BAL` | The single object holding every tuning knob. | [balance.ts](../src/content/balance.ts) |
| iso view · plan view | `ViewMode`: look and inspect in 2:1 isometric · build on a top-down board. | [kinds.ts](../src/core/kinds.ts), [view.ts](../src/app/view.ts) |
| plan-ness *t*, *te* | The morph parameter (0 = iso, 1 = plan), linear over 0.5 s · its eased value, which every renderer reads. | view.ts |
| projection *P(t)*, *M(t)* | The linear map tiles → world px at plan-ness *t* · `P(t)·P(0)⁻¹`, carrying iso volumes during the morph. | [projection.ts](../src/render/projection.ts) |
| iso px · level | Tile 64 × 32 px, one height level 16 px · a relief step. | [iso.ts](../src/render/iso.ts), [relief.ts](../src/render/relief.ts) |
| relief | Rock drawn as stepped columns, depth-sorted with the buildings. | relief.ts, [relief-view.ts](../src/render/world/relief-view.ts) |
| sprite atlas · dynamic atlas | Sprite pages baked at boot · pages baked on demand (relief). | [atlas.ts](../src/render/art/atlas.ts), [dyn-atlas.ts](../src/render/art/dyn-atlas.ts) |
| art recipe | A drawing function per building, item, belt tier or icon. | [render/art/recipes/](../src/render/art/recipes/) |
| glyph | An item's silhouette, coloured by its token. | `Glyph` in content types; [items.ts art](../src/render/art/recipes/items.ts) |
| ink · tokens | The Moebius-style stroke kit · the colour tokens shared with CSS. | [ink.ts](../src/render/art/ink.ts), [tokens.ts](../src/render/art/tokens.ts) |
| cartouche · lettering | The inked paper panel at the base of every UI panel (and the status badges) · the title font class. | `.cartouche` / `.lettering` in [base.css](../src/ui/styles/base.css); [icons.ts](../src/render/art/recipes/icons.ts) |
| artboard | Dev screen showing every sprite, for art review. | [artboard.ts](../src/ui/screens/artboard.ts) |
| `FL` | The `window.FL` debug and test handle (`place`, `tick`, `stocks`, `research`, `setLocale`, `t`, `hash`…). | [debug.ts](../src/debug.ts) |
| smoke · testkit · base20k | End-to-end browser run · test colony builders · the 20 000-building bench. | [smoke.mjs](../scripts/smoke.mjs), [testkit.ts](../src/sim/testkit.ts), [base20k.ts](../src/sim/bench/base20k.ts), [testing.md](testing.md) |

## Words that mean two things

- **atlas**: the T3 science item `atlas`, or the sprite atlas (`render/art/atlas.ts`).
- **recipe**: a crafting recipe (`RECIPES`), or an art recipe (a drawing function in `render/art/recipes/`).
- **kind**: `BuildingKind`, `ItemKind`, `NodeKind` (flow node class), `Effect.k`, `JobKind` (`dig` / `fill`) or `IncidentKind`.
- **tier**: an item's tier (1–4, T1–T4 in the design), or a chain's tier (the building index of its ribbons).
- **depth**: a research node's depth (1–9), an item's market depth Q, or the iso draw order (`depthOf`, `buildingZ`).
- **grid**: the tile grid (`Grid`), or a power grid (`Net`).
- **port**: a building's in/out opening (`PortDef`), or an unloader outlet (`portItems`).
- **parcel**: a square of land (`PARCEL`, [world/land.ts](../src/sim/world/land.ts)), or, in older text and comments, a conduit's run (`Run`) or a ribbon's item before D57.
- **Souffle / Criée**: the wind and the exchange, but also the French names of the Energy and Commerce branches (EN Current, Exchange).
- **Champs de braise**: both the `embers` archetype and the `emberfields` T3 biome.
- **Content id vs kind vs English name**:
  - `pylon` is the Pylône / Pylon, `mast` the Poteau / Pole;
  - `outpost` was the Waystation (retired, D60), `skydock` has kind `dock`;
  - `observatory` has kind `lab`, `silo` kind `storage`, the ribbons kind `belt`, `skybridge` kind `bridge`;
  - `accumulator` is the Accumulator;
  - `brazier` and `sunheart` have kind `generator`.
- **plan**: the plan view, or the design plan document in `~/.claude/plans/`.

## Trade (M6)

| Term | Meaning | Where |
|---|---|---|
| Comptoir / Trade Post (`trade_post`, kind `trade`) | The colony's dock at the Crier: a 5×5 store whose one entrance takes, and sells, every tradable item but its cargo, and whose one exit hands out its purchases in turn (D62, D64) | `sim/trade.ts`, `systems/trade.ts` |
| Cargaison / cargo | What a post bought and holds or awaits (on order, on its way, in its container): its exit hands it out, its entrance takes everything else, to sell (D64; export streams are gone) | `TradeState.cargo`, `cargoOf` |
| Standing order / ordre d'import | Item, whole items/min, max price: bought each boundary while the ask is under the max (pause above, resume 3 % below) | `ImportOrder`, `orderTrades` |
| Spot / comptant | A stock sold or bought at once along the market's depth (slippage), booked on the market | `spotTrade`, `quoteSpot`, `MarketService.book` |
| Lift / levée | Goods leaving or reaching a post; a delivery comes after the lift delay plus the supplying colony's delay | `deliveryTicks`, `Shipment` |
| Throughput / débit | Items a post lifts per minute, imports and exports together (120 / 240 / 480 by level) | `throughputMu` |
| Ledger / registre | The rolling record of trades (epoch, post, item, kind, mu, centi-◉) | `TradeState.ledger` |
| Gazette | The Crier's news: world events announced 1–3 h ahead, the scripted Port-Écume shortage | `market/events.ts`, `ui/gazette.ts` |
| Sister colony / colonie sœur | One of the 40 NPC colonies of the market (profile, band, delay, supplies / needs) | `content/colonies.ts`, `market/colonies.ts` |
| bid / ask | What the market pays / asks per item this epoch (centi-◉), before the post's fee | `sim.prices` |

## Persistence (M7)

| Term | Meaning | Where |
|---|---|---|
| time owed | How far the base's world clock (founding minute + ticks) is behind the wall clock; paid by the offline catch-up at boot and by the online resync | `owedTicks` in [persist/colony.ts](../src/persist/colony.ts) |
| envelope | A stored save: header (format, version, savedAt, tick, name, seq) + gzip payload + checksum; the `.ocelle` export is its text form | [persist/envelope.ts](../src/persist/envelope.ts) |
| slot | Where an envelope is kept: `a` / `b` (alternating), `prev`, `pre-import`, `pre-migration`, `pre-wipe` | [persist/slots.ts](../src/persist/slots.ts) |
| content table | The ids a save's indices refer to; loading re-points them to today's content (D47) | [sim/save-remap.ts](../src/sim/save-remap.ts) |
| « Pendant ton absence » / "While you were away" | The report of a catch-up of 10 minutes or more | [ui/screens/absence.ts](../src/ui/screens/absence.ts) |
| sandbox database | `ocelle-sandbox`: where automation (and `?sandbox`) saves, never the player's `ocelle` | [app/persistence.ts](../src/app/persistence.ts) |
