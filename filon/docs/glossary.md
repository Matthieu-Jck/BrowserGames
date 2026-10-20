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
| le Souffle | the Sough | `windAt`, `BAL.wind` ([world/wind.ts](../src/sim/world/wind.ts)) | The wind (D95): the day's curve × the day's mood × the gust window, from a prevailing bearing; strong on tops and open ground, calm in the lee and in bowls. Also the French name of the Energy branch. |
| exposition | exposure | `WindField`, `windSite` | How much of the wind a tile catches (‰), read off the land as the world made it: height above its surroundings, the fetch upwind, the lee, the bowl, a pass (D95). |
| Anémométrie | Wind Survey | `anemometry` (plan, flag) | The analytics plan that shows the wind: the Vent view (V), a turbine's wind in its card, its output while placing one (D95). |
| Cirque de Bonne-Veine | the cirque | `CIRQUE` | The starting basin (r ≤ 23), the same for every colony. |
| la Couronne | the Crown | `CIRQUE`, `crownOuter`, `crownReach` | The closed mountain ring round the cirque (D45). Map 2 (D63): a sandstone ridge two levels high from the floor's rim (r ≈ 23) to its foot (r ≈ 29), rising in a few places to lilac level-3 peaks; the biggest holds the tarn. Map 1 (older bases): three levels to r 34 |
| le lac perché / the tarn | the tarn | `CIRQUE.lake`, `TerrainSource.tarn` | The cirque's lake, up on the Crown's biggest peak at its level (D63): a pump on its edge, a ceramic works beside it on the rock |
| col | pass | `CIRQUE.passDirs` | A gap through the Crown. |
| le filon fatigué | the tired vein | the `copper_ore` deposit of `CIRQUE` | The deliberately poor copper deposit (≈ 6.75 ore/min) that forces imports. |
| Proche couronne · Les Étendues · Les Lointains · Mer de dunes | — | `RINGS.near`, `reaches`, `far`, `playable` | The rings beyond the Crown (32–160, 160–320, 320–480); décor past 500. |
| archétype | archetype | `ARCHETYPES` (`closed`, `steppe`, `lagoons`, `mesas`, `embers`) | A per-player environment: Cirque fermé / Closed Cirque, Grande Steppe / Wide Steppe, Lagunes de sel / Salt Lagoons, Mesas sifflantes / Whistling Mesas, Champs de braise / Ember Fields. |
| biome unique | unique biome | `UNIQUE_BIOMES` | A site that yields one unique resource. T3: Bosquet de verre / Glassgrove, Falaises à résine / Resin Cliffs, Champs de braise / Ember Fields. T4: Marais d'encre / Inkmarsh, Mer de nacre / Nacre Seabed, Les Orgues / Organ Peaks. |
| gisement | deposit | per-tile `ore` and `rich` ([grid.ts](../src/sim/world/grid.ts)) | Ore tiles: infinite, but capped per tile per minute. Only drills extract them. |
| bloc de gisement | deposit block | `MapParams.oreBlock`, `blocksOf` ([mapgen.ts](../src/sim/world/mapgen.ts)), `oreSnap` ([ore-blocks.ts](../src/sim/ore-blocks.ts)) | Map 4 (D104): a deposit is an irregular patch of whole 2 × 2 squares on the world's even grid, a drill's footprint; a drill held over ore snaps onto them. |
| paroi · veine de quartz | face · quartz vein | `QUARTZ_VEIN`, `TerrainSource.quartzVein`, `isFaceOre` ([face.ts](../src/sim/face.ts)) | A face is the wall between floor ground and higher rock. Map 3 (D87) guarantees a quartz vein in the nearest mountain past the Crown, in the parcel west or north of the starting square: eight face tiles holding quartz, floor at their foot. Map 5 (D136) adds a few short faces farther out, 2–6 tiles in the rough ground's walls (`QUARTZ_FACES`, `MapGen.facesIn`). Only a face cutter works a face; no drill takes it, no excavator digs it. |
| massif · falaise · rampe | massif · cliff · ramp | `OBSTACLES.massif`, `MASSIF` / `RAMP` flags, `settle4` ([mapgen.ts](../src/sim/world/mapgen.ts)) | Map 4 (D94): a big mountain past the Crown that rises straight to level 3 — a sheer cliff no traction ribbon climbs (`steep`) — and on up to 5; here and there a ramp brings it down half a level a tile, terraces two deep. |
| précipice · crevasse | chasm | `T.Chasm`, `OBSTACLES.chasm`, refusal `chasm` | Map 4 (D94): a crevasse 1–3 tiles wide winding across broken ground at level 0, pinching and widening, with side cracks. Nothing stands in it, nothing fills it; a skybridge pair leaps it, a wire passes over. |
| désert ouvert · terres accidentées | open desert · broken ground | `OBSTACLES.rugged`, `OBSTACLES.desert`, `oreCell` ([mapgen.ts](../src/sim/world/mapgen.ts)) | Map 4 (D94: space or ore): wide stretches of flat floor with little or no ore — all round the cirque out to the second ring of parcels past its starting square, and large ones farther out, no water, crevasse or mountain in them —, and ground cut by massifs, mountains and crevasses where the deposits lie, against the walls. |
| rivière · ruisseau · chute | river · stream · fall | `T.River`, `OBSTACLES.drainage`, refusal `river` | Map 4 (D94): a drainage network — streams a tile or two wide springing on the massifs (their water at the massif's level, stepping down in falls), joining into rivers that widen to a broad current of 5–8 tiles down to the sea. Nothing stands in it, nothing fills it; a skybridge pair leaps a narrow one; a pump on its bank draws from it. |
| mer | sea | `OBSTACLES.sea`, `seaAt`, `FL.sea` | Map 4 (D94): the shared world's sea, past a coast about 360 tiles out along a bearing the world seed picks; the rivers drain to it. |
| aiguilles | spires | `SPIRES`, `spireField`, `BIOME.spire`, art/spire.ts, `FL.spires` | Map 6 (D147): a field of rock needles 4–14 levels tall, a tile at the foot, in a wedge of the open sand round the Crown, its floor badlands (`BIOME.spireGround`); a needle's level is its height. |
| couloir | corridor | `LineKind.Corridor` ([world/obstacles.ts](../src/sim/world/obstacles.ts)) | Map 4 (D94): the way kept from the Crown's foot to each guaranteed site, clear of massifs, chasms, rivers and water. |
| sol constructible | usable floor | `usableFloor`, `parcelFloor` ([world/floor.ts](../src/sim/world/floor.ts)) | A floor tile a 2 × 2 machine can stand on at one level (D94); a parcel's share of it is its figure in the land panel and its gauge in the Terrain view, and what its price pays most for. |
| vue (Normale, Électricité, Logistique, Production, Terrain) | view (Normal, Power, Logistics, Production, Land) | `MapView` ([core/kinds.ts](../src/core/kinds.ts)), `MapViews` ([app/views.ts](../src/app/views.ts)), `Readouts` ([sim/readouts/](../src/sim/readouts/)) | A specialised view (D88): one system drawn bold over the base dimmed under a paper veil, with its side card; P, F, O, I (Terrain is the land mode); Esc back to Normal. Not the iso / plan *view* (`ViewMode`), which it keeps |
| roche H1–H4 | rock H1–H4 | `T.Rock1`…`T.Rock4` | Diggable rock by hardness: sandstone, basalt, lilac obsidian (ex4), heartrock (ex7). |
| évent | vent | `T.Vent` | The tile a geothermal plant must stand on. |
| saline | salt flat | `T.Salt` | Takes ribbons, masts and salt drills; can be backfilled. |
| brouillard | fog | — | None since D148 (owner, 2026-10-19: « make it so that there's no fog of war anywhere »): the whole world is known from the founding. D117's fog (`Sim.explored`, lifted round the Core, the parcels held and the buildings stood up) is gone; a save's discs are dropped on load (save v23). |
| parcelle | parcel | `PARCEL`, `parcelAt`, `sim.land` ([world/land.ts](../src/sim/world/land.ts)) | A square of land, 23 tiles a side (D74; 16 before), on a grid centred on the Heart; CrierBelt sells and leases it at a price from what it holds (ground, deposits), dearer with each parcel bought ([land.md](land.md), D60). |
| revente · taxe du Cadastre | resale · Cadastre tax | `sellLand`, `resalePrice`, `marketPrice`, `BAL.landResaleTax` | A bought parcel sells back at any time, no research: CrierBelt pays its market price (what buying it would cost now) less 20 %, the tax of the Cadastre de l'Anneau, which registers land ([land.md](land.md), D119). |
| carré de départ | starting square | `Land.inStart`, `Land.reach` | The claim's grant: the 3 × 3 parcels round the Heart, about exactly the cirque and its Crown (D74); never bought nor lost. The land panel calls it « Concession d’origine » / Original grant. |
| vos terres | your land (the claim's land) | `Land.holds`, `covers`; refusal `outside_zone` « Hors de vos terres » | The parcels the claim holds: the starting square, those bought, granted (an older save) or leased. A production building stands wholly on them; ribbons, poles and pylons may cross other land. |
| bail · loyer | lease · rent | `rentLand`, `Lease`, `landEpoch`, `endLease` | A parcel rented by the hour once « Cadastre » / Land Registry (`tr4`) is learnt: 3 % of its price an hour, fixed for the lease's life. A rent the purse cannot pay ends it (« Bail perdu »): what stands there goes dormant until the parcel is held again. |
| Aménager | Landscape | the `mark` tool; `designated` | The brush that marks rock to dig or water to fill. |
| Vue · Plan | View · Plan | `ViewMode` `'iso'` / `'plan'` | The default isometric view, and the top-down board used to build. |

### Buildings (`BUILDINGS`, kind in brackets)

| Français | English | Code | Meaning |
|---|---|---|---|
| Cœur | Core | `hearth` [hearth] | The base's core (code: "Hearth"; older docs say "Heart"): depot of the base's stock, pays for construction, drone bay, uplink, small solar array. Placed at founding; grows to level 5, each level mounting one piece on a corner of its slab and dressing it up (D86): level 2 its compute bay (south-east, where its data outlet stood until D122), whose tokens run research; level 3 the Archive of the expertises. It gives no item. |
| Avant-poste | Waystation | `outpost` (retired, D60) | Gone with the influence zones it extended: a save that still holds one gets it refunded (`RETIRED_COSTS`), its store to the Heart, and the claim keeps the parcels it stood on. |
| Foreuse · Foreuse profonde | Drill · Deep Bore | `drill`, `deep_bore` [drill] | Extract the majority ore beneath them, capped by the tiles' caps. |
| Collecteur de sable | Sand Collector | `sand_collector` [drill, `ground`] | Scoops sand off the bare ground, 15/min, anywhere on plain sand (sand is the floor, no deposit; D38). |
| Excavatrice | Excavator | `excavator` [excavator] | Digs marked rock within its reach, yields stone and embedded ore. |
| Pompe à eau | Water Pump | `pump` [pump] | 60 water/min at the water's edge. |
| Remblayeuse | Backfiller | `backfiller` [backfiller] | Fills marked water and salt flats with stone, making new floor. |
| Ruban · Ruban vif · Ruban express | Ribbon · Swift Ribbon · Express Ribbon | `ribbon`, `swift_ribbon`, `express_ribbon` [belt] | Conveyors: 60, 120 and 240 items/min. |
| Routeur | Router | `router` [fork] | Takes in at its back only and deals out in turn to its front and sides; a filter per side keeps that side for one item (D35). Dropped onto a ribbon, its back takes the way the items enter there (on a curve too), unless turned with R (D98). |
| Trieur / Trieur inversé | Sorter / Inverted Sorter | `sorter`, `inverted_sorter` [fork] | Directional: the chosen item straight on, others to the sides (inverted: the opposite). |
| Vanne de trop-plein / de sous-débit | Overflow / Underflow Gate | `overflow_gate`, `underflow_gate` [fork] | Directional: straight on first, then the sides (underflow: the opposite). |
| Distributeur | Distributor | `distributor` [fork] | A big 2×2 router that takes from and gives to every side (eight sides), with dn5. |
| Croisement | Junction | `crossing` [crossing] | Two ribbon lines cross without mixing. |
| Passerelle | Bridge | `skybridge` [bridge] | Leaps up to 3 tiles (7 with dn2) to the next bridge in its direction. |
| Croisement | Crossing | `crossing` [crossing] | Two ribbon lines cross without mixing. |
| Passerelle | Skybridge | `skybridge` [bridge] | A ribbon that leaps 4 tiles (8 with dn2) over ribbons, rock or water. |
| Conduit | Conduit | `conduit` [conduit] | Water pipe, 240/min; carries fluids only. |
| Silo | Silo | `silo` [storage] | Buffers 1 000 items of a single kind. |
| Fonderie (compacte) | (Compact) Smelter | `kiln`, `kiln_compact` [machine] | Smelts ore and sand by burning coal; needs no grid. |
| Aciérie · Briqueterie | Steel Mill · Brickworks | `steel_mill`, `brickworks` [machine] | D123's two Tier 1 works: the steel mill blows two iron plates and a coal into a steel (150 kW); the brickworks presses a sand and two waters into a brick (90 kW). Steel, bricks, copper plates, pipes and cables are what the buildings of Tiers 1–3 and the Core's levels 3–4 are built of. |
| Fonderie électrique · Fonderie à arc | Electric Smelter · Arc Furnace | `electric_smelter`, `arc_furnace` [machine] | Smelt ore and sand on grid power, no coal (D106): the electric smelter at the smelter's pace for 300 kW (Tier 1), the arc furnace twice as fast (Mechanics). Their recipes keep the ids `arc_plate`, `arc_glass`. |
| Tréfileuse | Wire Mill | `wire_mill` [machine] | Copper ore → copper wire. |
| Atelier d’électronique · Graveuse · Fonderie de puces | Electronics Workshop · Etcher · Chip Fab | `workshop`, `etcher`, `chip_fab` [machine] | The electronics family: circuits, servomotors and robot arms (D70: at most three recipes per machine). The workshop is Tier 2's research (Automation's first) since D129, a plan before. |
| Établi de montage | Assembly Bench | `assembly_bench` [machine] | Tier 1's plain workbench (D129, a plan of Production in the electronics workshop's place): copper coils, and motors with Mechanics. « Établi », not « Atelier »: not the assembly workshop (`great_workshop`). |
| Atelier d’assemblage (compact) · Tour d’assemblage | (Compact) Assembly Workshop · Assembly Tower | `great_workshop`, `great_workshop_compact`, `tower_workshop` [machine] | 3-input assembly: batteries, thermal cores, resonators; the tower at 4× speed. |
| Presse · Presse à forger | Press · Forge Press | `press`, `forge_press` [machine] | Iron plate → gear (the forge press at ×3). |
| Atelier d’optique · Scriptorium | Optics Workshop · Scriptorium | `optics_workshop`, `scriptorium` [machine] | Lenses and nacre lattice · resin canvas (its Atlas and Codex went with the data, D122). |
| Four à céramique | Ceramic Oven | `ceramic_oven` [machine] | Stone + water → ceramic. |
| Chargeur | Cell Charger | `cell_charger` [machine] | Charges cells: exportable energy. |
| Laboratoire de recherche | Research Lab | `observatory` [lab] | 3×3 since D84 (the 2×2 one retired, `observatory_2x2`). Where research runs and the research slots are held (D68): it takes nothing by ribbon and has no ports (D122), only power — its project takes its tokens at a minute's end only if the lab had power in it. Its plan is the gate after every other plan (D71). |
| Collecteur de données · Relais de données | Data Collector · Data Relay | `data_collector`, `data_relay` (retired, D122) | Powered makers of Survey Data, gone with the data: a save that holds one has it taken down and refunded (`RETIRED_COSTS`), the data it held banked as tokens. |
| Laboratoire autonome | Autonomous Lab | `auto_lab` [lab, `server`] | A research lab that also computes (D122): 5 000 tokens a minute into the claim's pool while powered, like a server, project or not (Analytics · Data Mining's keystone). |
| Serveur · Serveur refroidi · Supercalculateur | Server · Cooled Server · Supercomputer | `server`, `cooled_server`, `supercomputer` [server] | The claim's own compute: tokens a minute for its research while powered (2 000, 6 000, 20 000), billed before CrierBelt's (D70). |
| Poteau | Pole | `mast` [pole] | A pillar: up to 8 wires, each up to 6 tiles long (edge to edge), climbing and clearing one terrace (D78). A new one wires itself to the nearest pillar or Cœur in reach. |
| Pylône | Pylon | `pylon` [pole] | A long-reach pillar, 2×2 and about three tiles tall (D75): up to 4 wires, 40 tiles long (60 with xp4), climbing and clearing three terraces (D78). The 1×1 pylon of older saves is `pylon_1x1`, retired (refunded) |
| fil · relier | wire · link | `sim.links` (`PowerLinks`), `link` / `unlink` commands | A power wire: an explicit, saved pair of buildings, one end a pillar or the Cœur, the other a pillar or anything that makes, uses or stores power (D25). Drawn hanging in the air. The « Relier » / Link tool (L) strings and cuts them. |
| gabarit · copier · coller · améliorer · annuler | blueprint · copy · paste · upgrade · undo | `Blueprint`, `Sim.blueprints` ([systems/blueprint.ts](../src/sim/systems/blueprint.ts)), `Tools` states `copy` / `paste` / `upgrade`, `UndoStack` | D154: an area of the base taken as pieces and laid again elsewhere, turned (R) or mirrored (M), through the player's own commands, paid whole or not at all; the library (K) keeps named ones in the save; « Améliorer » (N) lifts a box's ribbons a tier; Ctrl/⌘+Z takes back the last placement, paste or demolition. « Gabarit », not « plan »: the tree's plans (D33) and the plan view have that word |
| pilier | pillar | content `pole` (`mast`, `pylon`, and the Cœur) | A link point: a building that carries wires — its `range` (how far, edge to edge), `slots` (how many) and `climb` (how many terraces up, down and over, D78). |
| réseau | grid | `Net` | The buildings joined by wires: one satisfaction for all; « hors réseau » = on no wire. |
| Chaudière à vapeur | Steam Boiler | `steam_boiler` [generator] | +700 kW, burning 8 coal and drinking 30 water a minute at full output (D114, D143): the one plant that burns coal (the coal generator, `brazier`, was retired by D143). Its plan « Vapeur » / Steam Power (`steam`) brings the water pump and the conduit too. |
| Éolienne | Wind Turbine | `wind_flower` [wind] | Up to 100 kW on its curve at the local wind: nothing below ×0.4, full from ×1.4, stopped from ×3.6 (D95, D143); six tiles at least from another turbine, middle to middle (`BAL.wind.spacing`, D132). |
| Panneau solaire | Solar Panel | `sun_bulb` [solar] | +200 kW in full sun (D143). |
| Accumulateur | Accumulator | `accumulator` [accumulator] | Stores 1 200 kW·min, delivers 300 kW. |
| Centrale géothermique | Geothermal Plant | `fumarole_tap` [geothermal] | +1.5 MW on a vent. |
| Cœur-Soleil | Sunheart | `sunheart` [generator] | +20 MW; burns a resonator every 30 min. |
| Comptoir | Trade Post | `trade_post` [trade] | CrierBelt's cargo pad: 5×5, its flame apron kept clear, one entrance (what it sells) and one exit (what it bought, in turn) on flame-proof ribbons (D62). |
| tablier (du comptoir) | flame apron | the trade post's outer ring | The one-tile ring round the post's pad that the drones' flames keep clear: nothing else stands on it (D62). |
| Haveuse | Face Cutter | `face_cutter` [drill, `drill.face`] | Stands on the floor at the foot of a quartz face, its back to the rock, and cuts the face tiles it touches (7.5/min each, 15 at most); never on the wall (`needs_face`); it turns its back to the wall by itself (D87, research `ex_quartz`). |
| Atelier de quartz | Quartz Workshop | `quartz_workshop` [machine] | Cuts quartz into blades and mounts each on two copper wires: the quartz oscillator, its one recipe (D87, `ex_quartz`). |

### Items (`ITEMS`)

| Français | English | Code | Meaning |
|---|---|---|---|
| Minerai de fer · Sable · Charbon · Minerai de cuivre · Sel | Iron Ore · Sand · Coal · Copper Ore · Salt | `iron_ore`, `sand`, `coal`, `copper_ore`, `salt` | Drilled raw materials. Coal is fuel; copper is scarce in the cirque. The early game uses ordinary materials on purpose; the exotic ones (T3–T4 uniques) come later (D23). |
| Pierre · Eau | Stone · Water | `stone`, `water` | From digging (item kind `rubble`) and from pumps. Water is a fluid and cannot be traded. |
| Plaque de fer · Verre · Fil de cuivre | Iron Plate · Glass · Copper Wire | `iron_plate`, `glass`, `copper_wire` | T1 products, and the usual building costs. |
| Engrenage · Circuit imprimé · Céramique · Batterie vide / chargée | Gear · Circuit Board · Ceramic · Empty / Charged Battery | `gear`, `circuit`, `ceramic`, `empty_cell`, `charged_cell` | T2 parts. A charged battery is energy you can export. |
| Verre-spore · Résine céleste · Sel de braise | Sporeglass · Sky Resin · Embersalt | `sporeglass`, `sky_resin`, `embersalt` | T3 uniques: each colony reaches only some of them, so they are traded. |
| Mousse lumen · Nacre fossile · Quartz chantant | Lumen Moss · Fossil Nacre · Singing Quartz | `lumen_moss`, `fossil_nacre`, `singing_quartz` | T4 uniques. |
| Quartz | Quartz | `quartz` (item `face: true`) | T1 raw ore set in cliff faces (D87): the face cutter's; traded at the Crier (what a land founded before map 3 buys). Not the T4 unique Singing Quartz. |
| Oscillateur à quartz | Quartz Oscillator | `oscillator` | A part (D87): 1 quartz + 2 copper wire at the quartz workshop; a server costs four; the Server Room and Overclocking ask for some among their resources (D122). |
| Lentille · Toile de résine · Cœur thermique · Résonateur · Treillis de nacre | Lens · Resin Canvas · Thermal Core · Resonator · Nacre Lattice | `lens`, `resin_canvas`, `thermal_core`, `resonator`, `nacre_lattice` | T3–T4 parts. |
| Données d'arpentage · Données mécaniques | Survey Data · Mechanics Data | `journal_1`, `journal_2` (retired, D122) | Research's data until D122 (D71: one more kind each tier). What a save still holds of them anywhere is banked as tokens (`RETIRED_ITEM_TOKENS`), and the absence report says so. |
| Banc d'essai | Test Bench | `test_bench` (retired, D122) | Made Mechanics Data out of gears, circuits and an oscillator; taken down and refunded in older saves, its buffers to the Heart. |
| Atlas · Codex | Atlas · Codex | `atlas`, `codex` (retired, D122) | Tier 3 and Tier 4 data (they needed uniques); banked as tokens in older saves. Optics (`tr6`) and Resonance (`tr8`) were Atlas Lore and Codex Lore. |
| Bobine de cuivre · Moteur électrique | Copper Coil · Electric Motor | `copper_coil`, `motor` | T1 parts of the assembly bench (D129): a coil is 2 copper wires on an iron plate's core, a motor 2 coils and a gear. Turbines, the electric smelter and the accumulators are built of coils; the drills, the twin wire mill, the excavator, the Synthesis and the Core's level 3 take motors. |
| Servomoteur | Servomotor | `pace_bell` | A part (D81; once the speed module, gone): a motor + 2 circuits (D129; 4 circuits + 2 gears before); the advanced machines of the Machines family are built of it, and the Crier trades it. |
| Bras robotisé | Robot Arm | `robot_arm` | A part (D81, Robotics `dn7`): 2 servomotors + 2 circuits; the Chip Fab is built of it. |
| Scories · Chutes | Slag · Scrap | `slag`, `scrap` (item kind `waste`) | The machines' waste (D125), the steel line's only since D139: the steel mill puts out a slag every five steels, the press a scrap every five pipe crafts, through the same output as their product (`RecipeDef.waste`); the tutorial's comes with the starter contract's ore. Sorted off and burnt in an incinerator, or sold cheap at a post's entrance; **no machine takes it in** (D151: D125's slag bricks and recycled steel are gone — waste is a nuisance to get rid of, never a resource). **The Core takes none in** (D139, `CORE_TAKES`): a line bringing it stops at its door. |
| bac à déchets | waste bin | `MachineNode.wBuf`, `wItem`, `wc` | A machine's waste waiting to go out, first, through its product's output (two at most, `BAL.wasteBufItems`); full, the machine stops (D125). |
| refusé à l'entrée | refused at the input | `coreRefusals`, `machineRefusals`, `refusedAt` ([readouts/core-door.ts](../src/sim/readouts/core-door.ts)); `drawRefusal` | What waits at a door that will not take it (D139): at an intake of the Core (no waste in), or at a machine's input whose recipe does not take its line's head. Its line stops behind it; the refusal's badge (the item struck through in a coral ring) hangs over the door, and a sorter laid on that tile takes it in. |

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
| Tronc | Trunk | `tr1`…`tr8` (ids kept) | Until D128 the spine that opened the tiers; its nodes are now shared out among the categories (`paced`), the tiers' gates among them (`TIER_GATE`: the Synthesis, Optics, Resonance). |
| catégorie | category | `CATEGORIES`, `ResearchDef.cat`, `CategoryDef` | A group of one tier's research nodes, named after what a base focused on it does (D128: Fonderie · Foundry, Atelier · Workshop, Finance, Mine profonde · Deep Mining…). It opens once its gates are finished. |
| porte (d'une catégorie) | gate (of a category) | `CategoryDef.gates`, `unmetGates`, `researchBlock` → `gate` | The categories of the tier before that a category waits for, every node of them learnt (D128): « Finance · après Commerce 1/2 ». |
| thème | theme | `ThemeId`, `THEMES`, `ResearchDef.theme` (`en`, `ex`, `dn`, `cm`, `an`, `xp`) | The six research themes, the families of D69 until D128 (their ids kept): Énergie, Extraction, Machines, Commerce, Analytique, Logistique (`xp`, Expansion until D107). Each category carries one: its colour, and what an expertise of it improves. Each carries on a plan path's theme ([research.md](research.md)). |
| palier | tier | `ResearchDef.tier`, `tierOfDepth` | T1–T4: a band of the tree, each with its own categories (D128), opened by the Core's level (D118) behind its gate (`TIER_GATE`); its tokens and pace grow with it (`DEPTH_COST`). |
| clé de voûte | keystone | depth 9, ★ | A Tier 4 category's great node (the Sunheart, the Chip Fab, the Crier House…). |
| emplacement de recherche · pupitre | research slot · desk | `mods.slots` | How many projects can run at once: 1, then 2 (tr5), 3 (tr7), 4 (an_slot). |
| file d’attente | queue | `labQueue`, `queueResearch` | Research waiting for a free slot (Analytics: « File de recherche »). |
| token | token | `tokens`, `tokIn`, `tokenEpoch`, `BAL.tokenCentsPerK` | AI compute a research needs in a set number, at every tier (D68, D118, D122). Never owned nor stored: a flow delivered each minute to the projects whose lab had power (`lit`), in the order they started — the Core's compute and the servers' first, then the bank, then the flow bought from CrierBelt for each. Called « token » in French too, never « jeton ». |
| calcul du Cœur · baie de calcul | the Core's compute · compute bay | `Sim.coreComputeRate()`, `BAL.coreCompute`, `HeartPiece` `'compute'` | The AI tokens a minute the Core gives research from its level 2 (1 000, 1 500, 2 000, 3 000 by level; + Overclocking and Data Mining; × Archiving), with no power and no ribbon (D122); the compute bay is the server cabinet its level 2 mounts on its south-east corner. |
| réserve de tokens | token bank | `Sim.tokenBank`, `tokens.bank` | Tokens an older save's data was turned into (D122, save v19): delivered after the free flows and before any bought one, never refilled. |
| ressources (d'une recherche) | resources (of a research) | `ResearchDef.cost`, `res` in `node()` / `paced()` | The one to three kinds of items a research node costs, paid from the Core at launch and handed back on a cancel (D122): gears, copper, circuits, lenses… |
| flux de tokens acheté | bought token flow | `buy`, `setTokenBuy`, `tokenBuy`, `BAL.tokenFlow` | Tokens a minute a research buys from CrierBelt while it needs them (D118): chosen in the launch dialog, billed each minute, it stops by itself once the research has its tokens; held while the purse is in the red. |
| forfait de calcul | compute plan | `tokenPlan`, `setTokenPlan` | CrierBelt's hourly plan: tokens at half price for a fee an hour. |
| recherche suspendue | research held | `researchHeld` | Purse in debt after the token bill: the bought flows stop until credits are back above zero (D118); the free flows and the bank go on. |
| reconversion | reconversion (respec) | `respec:<family>` | Retired (D107: its button left the tree). Gave a family (a theme since D128) up, deepest node first; half its data came back as archive notes after a wait. A save's reconversion under way still runs out. |
| notes d'archive | archive notes | `Sim.notes` | Non-tradable credit (centi-◉) from an old reconversion; it pays a new project's tokens at CrierBelt's list price (D122; it pre-paid data before). |
| Synthèse | Synthesis | `tr_synth`, `TIER_GATE[2]` | Core Compute's last node (D93, D128): it needs what the Core's level 3 is paid in — the Workshop, the Steelworks, Overclocking —, gives that level and opens Tier 2 (with two expertises). |
| expertise | expertise | `EXPERTISES`, `Sim.expertise` | What the base has learnt to do well (D93): earned by a feat (`FeatKind`), ranks I–III, two held at a time; a production number or one theme's research, by a percentage. |
| les Glaneurs | the Gleaners | `systems/gleaners.ts`, `world/reach.ts`, `Chain.raidStep`, `Sim.gleaned` | The small desert people that takes shiny things off the ribbons it reaches, at night (D103). |
| un raid, un poste | a raid, a post | `Chain.raidPosts`, `raidAt`, `raidHeld` | A band of three to five Gleaners at a run of a line's exposed cells, once a window; each post takes one item that rides onto its cell (D112). |
| exposé la nuit, à l'abri | exposed at night, kept safe (guarded) | `Graph.glean.exposed`, `.guarded` | A ribbon tile beside desert floor the Gleaners reach; one under glass or beside a fenced-in pocket. |
| grille | fence | `fence` (kind `fence`) | A 1×1 mesh cage the Gleaners do not cross, laid by dragging (D103). |
| ruban vitré | glazed ribbon | `glazed_ribbon` (`BuildingDef.glazed`) | A ribbon under glass: the Gleaners take nothing it carries (D103). |
| ruban camouflé, enfoui | camouflaged ribbon, buried | `camo_ribbon` (`BuildingDef.camo`) | A ribbon buried under the sand: it runs on a neighbouring base's open land and costs the same off the claim's land; slower (40/min), flat; the Gleaners walk over it unseeing (D109). |
| exploit | feat | `featValue`, `FeatKind` | What earns an expertise: a counter of what the base did (ore extracted, ◉ of sales, the Core's grid held at 95 % in a row…), read at each minute's boundary. |
| Archive des expertises | Expertise Archive | `HEART_CORNERS` `archive`, `heartPieceAt` | The Core's level-3 corner piece (D86): the way into the Expertise window (E). |
| réorientation | reorientation | `reorient`, `reorientCost`, `BAL.expertise` | Replacing an expertise in place: paid, dearer each time, the new one in place 24 h later. |
| en sommeil | dormant | `St.Dormant`, `isDormant` | A building whose unlock was reconverted away, or that needs land and stands off the claim's (a lease lapsed or given up): no flow, grey wash. |
| ocelle ◉ | ocelli (HUD) | `Sim.credits` in **centi-ocelles** | The currency. `BAL` and the UI speak ◉, the engine ×100. |
| la Criée | the Crier Ring | M6 | CrierBelt's orbital exchange, where every claim trades (`screen.crier`). |
| vente automatique | auto-sell | `cm_autosell`, flag `autoSell`, `sim.trade.autoSell`, the `autoSell` command and ledger line | Commerce's Tier 2 node (D127): the Core sells, item by item, what it holds beyond a threshold at each minute's end, at the bid less 40 %; it takes that item uncapped, so its lines never back up. Set in the Stock panel. |
| concessions (les autres) | claims (the other) | [colonies.ts](../src/content/colonies.ts) (code: "colonies") | The market's forty simulated actors: other CrierBelt partners' claims, each with its name and emblem (`colonyEmblem`). « Concessions sœurs » / "sister claims" until D110. |
| base voisine | neighbouring base | [world/neighbours.ts](../src/sim/world/neighbours.ts), [world/neighbour-chain.ts](../src/sim/world/neighbour-chain.ts), [content/neighbours.ts](../src/content/neighbours.ts), [render/world/neighbours-view.ts](../src/render/world/neighbours-view.ts); `Land.neighbour`, `Sim.neighbours` | Another claim's land beside the player's, a few out on the horizon (none within three rings), and the working base on it (D110): its trade's goods made on real recipes from what its land gives, mined on site, each step adding value, nothing bought (D134), into its store, its Core and CrierBelt's trade post; what it does on its card and its band (« Fonderie : minerai de fer → plaque de fer → engrenage »), its own grid of masts and wires, dome tents, banner poles, cairns, all in its colours; from the seeds, never saved. Not for sale nor lease; its land takes the claim's ribbons and poles only with Neighbour Treaties, its buildings nothing. |
| valeur de référence · profondeur | reference value V · market depth Q | `ItemDef.value`, `ItemDef.depth` | The price anchor in ◉, and the NPC market depth in items/min. |
| Sortie (d'un stock) | outlet | `Ent.portItems` | A store's out port handing out one item on its beat: a silo's (its one item; the unloader that pulled a chosen one is retired, D117) — never the Heart's stock, which only takes in (D34). A trade post's one exit hands out all it bought, in turn (D62). |

## B. Engine and code terms

| Term | Meaning | Where |
|---|---|---|
| id / index | String id in content and commands; dense integer index in the engine (position in the table). | [registry.ts](../src/content/registry.ts) |
| MU, milli-item | 1 item = 1 000 mu. Every engine quantity is integer mu. | `MU` in [constants.ts](../src/sim/constants.ts), `toMu` |
| ‰ (permille) | Multipliers, speeds and satisfaction: 1000 = ×1. | throughout; `permille` in [fixed.ts](../src/core/fixed.ts) |
| tick | 1/10 s (`TPS = 10`). The sim's step. | constants.ts |
| epoch | 600 ticks = one minute (the sim runs in real time at 10 Hz): weather steps and (M6) market settlement. "Per epoch" = per minute. | `EPOCH` |
| day · gust window | 36 epochs (12 dark, 3 dawn, 18 sun, 3 dusk) · 10 epochs at one of 5 gust levels, part of the wind (D95). | `DAY_EPOCHS`, `SOLAR`, `GUST_*` |
| world epoch | Absolute minute since `WORLD_EPOCH0`. Weather depends only on it and `WORLD_SEED`. | constants.ts; `foundingEpoch` |
| `CYCLE_LCM` · `PERIOD_MAX` | Every recipe cycle divides 1 200 ticks · the warm-up's period window (2 400). | constants.ts, [validate.ts](../src/content/validate.ts) |
| centi-ocelle | The engine's money unit (1 ◉ = 100). | `Sim.credits`, `credits()` in [format.ts](../src/i18n/format.ts) |
| kind | `BuildingKind`: the behaviour selector of a building. | [content/types.ts](../src/content/types.ts), `BUILDING_KIND` |
| entity (`Ent`) · `def` | A placed building or ribbon tile (ids never reused) · its building index. | [types.ts](../src/sim/types.ts), [entities.ts](../src/sim/entities.ts) |
| footprint · port · world port | Rotated size · a building's in/out opening · the same in world coordinates with the tile it faces. | entities.ts |
| `cfg` | Per-entity config word: recipe + 1 (machines; bits 16–19 held speed modules until D81), side filters (forks). | [cfg.ts](../src/sim/cfg.ts) |
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
| routing block | A `ForkNode`: router, sorter, gate, distributor (kind `fork`); its links come from its surroundings. Side-loading onto a ribbon is a lower-priority incoming edge. | `ForkNode` in nodes.ts; `rim`, `routingPorts`, links in compile.ts |
| reservoir | A stock node with a capacity: the Hearth, silos, trade posts, research labs, servers (power only), excavators, backfillers. Groups are cut at reservoirs. | `ReservoirNode` in nodes.ts |
| virtual mode | During warm-ups a reservoir behaves by state flags (normal, empty, full) and records flows instead of changing its stock. | `V_NORMAL`/`V_EMPTY`/`V_FULL`, [steady.ts](../src/sim/offline/steady.ts) |
| rotating allocation · water-filling | Fair splits of capacity among edges, rotating with the tick · a proportional capped split (tested; no flow-engine caller yet). | `allocRotating` in node.ts · `waterfill` in fixed.ts |
| group | A connected component of the graph cut at reservoirs: the unit the catch-up warms up and extrapolates. | [groups.ts](../src/sim/graph/groups.ts) |
| net (power grid) | A connected component of the wires among built, awake buildings (union-find, D25); every pillar heads one, an ordinary building joins one only through a wire. Its producers, consumers and accumulators share one satisfaction. | `Net`, `buildGrids` in [network.ts](../src/sim/power/network.ts) |
| link point · reach · slots | A pillar or the Hearth (content `pole`) · how far a wire may go: footprint edge to footprint edge, the longer range of its two ends · how many wires a link point holds. | [links.ts](../src/sim/power/links.ts) `linkPoint`, `gap2`, `linkCheck` |
| climb · « dénivelé » | How many levels a wire may climb or come down between its ends, and how high above the land it rides: the larger climb of its two ends (pole and Cœur 1, pylon 3, D78). A tile rising above it bars the wire (`blocked`). | [links.ts](../src/sim/power/links.ts) `wireClimb`, `wireSteep`, `wireObstacle` |
| satisfaction *s* | Served ÷ demanded power on a grid, in ‰, floored to 25‰ steps. Machines run at speed × *s*. | [solve.ts](../src/sim/power/solve.ts), `SAT_STEP` |
| merit order · dispatch | Renewables → fuel generators → accumulators · the ‰ of fuel capacity in use, which sets the fuel burn. | solve.ts |
| `Mods` · flag | Research effects compiled into one table (‰ multipliers, additive integers) · a named boolean effect (`mods.flags`). | [modifiers.ts](../src/sim/research/modifiers.ts) |
| project | A research (or a reconversion `respec:<branch>`) holding a slot. | [runtime.ts](../src/sim/research/runtime.ts) |
| allowance | A cap ⌊total × e ÷ duration⌋ on what a timed process may have paid or moved after elapsed powered time *e*. It makes research and digging path-independent, so online and offline agree. | runtime.ts `advanceProject`, [space.ts](../src/sim/space.ts) `advanceJob` |
| designation | A tile marked for digging (rock) or filling (water, salt flat). | `Sim.designated`, [landscape.ts](../src/sim/systems/landscape.ts) |
| job | The single dig or fill an excavator or backfiller is running. | `Job` in space.ts |
| regime | A group's periodic behaviour under fixed conditions (reservoir flags, power, mods), cached by key. | steady.ts, [catchup.ts](../src/sim/offline/catchup.ts) |
| warm-up | Stepping a group with the online tick code until its state hash repeats: transient *t₁* + period *p* + prefix. | `warmUp` in steady.ts |
| segment · event | The catch-up's timeline cut at events: epoch, reservoir at a bound, accumulator full or empty, construction or research done. | catchup.ts |
| pseudo-flow | A timed process the catch-up treats as a known, constant reservoir in-flow or out-flow: research draws, dug stone, backfills. | catchup.ts, [src/sim/systems/](../src/sim/systems/) |
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

- **atlas**: the sprite atlas (`render/art/atlas.ts`); in older text, the T3 data item `atlas`, retired with the data (D122).
- **recipe**: a crafting recipe (`RECIPES`), or an art recipe (a drawing function in `render/art/recipes/`).
- **kind**: `BuildingKind`, `ItemKind`, `NodeKind` (flow node class), `Effect.k`, `JobKind` (`dig` / `fill`) or `IncidentKind`.
- **tier**: an item's tier (1–4, T1–T4 in the design), or a chain's tier (the building index of its ribbons).
- **depth**: a research node's depth (1–9), an item's market depth Q, or the iso draw order (`depthOf`, `buildingZ`).
- **grid**: the tile grid (`Grid`), or a power grid (`Net`).
- **port**: a building's in/out opening (`PortDef`), and what an outlet hands out (`portItems`).
- **parcel**: a square of land (`PARCEL`, [world/land.ts](../src/sim/world/land.ts)), or, in older text and comments, a conduit's run (`Run`) or a ribbon's item before D57.
- **Logistique / Énergie / Analytique / Commerce**: plan paths (D41), and also research families of the same theme (D107: a plan path leads into its family); the families are `FamilyId`s, the paths `PLAN_PATHS`. « Arpentage » was the survey path from D107 (Logistics' Tier 1 was named so before) until D117, which retired it with the survey beacon; the word named the Survey Data until D122, which retired it too; in code it is still the id of the title « Passe-Crête » (`grant: 'arpentage'`).
- **Heart / Core / Hearth**: one building, `hearth`: « le Cœur » in French, the Core in English (since D68; older docs say the Heart), the Hearth in code.
- **Champs de braise**: both the `embers` archetype and the `emberfields` T3 biome.
- **Content id vs kind vs English name**:
  - `pylon` is the Pylône / Pylon, `mast` the Poteau / Pole;
  - `outpost` was the Waystation (retired, D60), `skydock` the Skydock and `big_dock` the Great Skydock (retired with the drifters, [D108](decisions.md));
  - `observatory` is the Research Lab (kind `lab`), `hearth` the Core (« le Cœur »), `silo` kind `storage`, the ribbons kind `belt`, `skybridge` kind `bridge`;
  - `accumulator` is the Accumulator;
  - `steam_boiler`, `cell_generator` and `sunheart` have kind `generator`; `brazier` was the Coal Generator (retired, [D143](decisions.md)).
- **plan**: the plan view, or the design plan document in `~/.claude/plans/`.

## Trade (M6)

| Term | Meaning | Where |
|---|---|---|
| Comptoir / Trade Post (`trade_post`, kind `trade`) | The base's cargo pad at the Crier: a 5×5 pad whose one entrance takes, and sells, every tradable item — its cargo's too, into a store of its own (D131) — and whose one exit hands out its purchases in turn from its container (D62, D64) | `sim/trade.ts`, `systems/trade.ts` |
| Cargaison / cargo | What a post bought and holds or awaits (on order, on its way, in its container): its exit hands it out from the container; its entrance takes everything, the cargo's items too, to sell, in a store apart (D64, D131; export streams are gone) | `TradeState.cargo`, `cargoOf` |
| Standing order / ordre d'import | Item, whole items/min, max price: bought each boundary while the ask is under the max (pause above, resume 3 % below) | `ImportOrder`, `orderTrades` |
| Spot / comptant | A stock sold or bought at once along the market's depth (slippage), booked on the market | `spotTrade`, `quoteSpot`, `MarketService.book` |
| Lift / levée | Goods leaving or reaching a post; a delivery comes after the lift delay plus the supplying colony's delay | `deliveryTicks`, `Shipment` |
| Throughput / débit | Items a post lifts per minute, imports and exports together (120 / 240 / 480 by level) | `throughputMu` |
| Ledger / registre | The rolling record of trades (epoch, post, item, kind, mu, centi-◉) | `TradeState.ledger` |
| Gazette | The Crier's news: world events announced 1–3 h ahead, the scripted Port-Écume shortage | `market/events.ts`, `ui/gazette.ts` |
| Colony (code) / concession (UI) | One of the 40 NPC claims of the market (profile, band, delay, supplies / needs); some hold land beside the player's as neighbouring bases (D110) | `content/colonies.ts`, `market/colonies.ts` |
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
