# Quests: the tutorial

The claim's name, then eleven quests, played in order, one at a time (design plan §8 « Prise en main »; decisions D28, D33, D34 and, for today's shape, **D101** in [decisions.md](decisions.md); « Les scories », **D125**). CrierBelt, the player's partner (see [lore.md](lore.md)), sets each quest in a short message and pays a reward when it is met. The player sees the quests numbered 1–11; the claim's name is the register's entry, not a numbered quest. Code and content use indices 0–11.

Two kinds of quest (D101; owner, 2026-10-16: « le début va trop vite et le tutoriel est trop long. Le joueur débloque plein de trucs, mais comme le tutoriel lui dit toujours sur quoi cliquer partout, le joueur ne va pas lire et perdre de l'intérêt. Parfois, on peut mettre une quête sans exiger du joueur qu'il clique à un endroit en particulier, le laisser expérimenter »):

- **Guided** (`steps`): the first basics only — a drill and its ribbon into the Core, a smelter fed by a drill pair, a wire. The guide's arrow walks the steps, one action each; steps that share a sentence share its hint, so the player reads a few larger steps while the arrow stays precise.
- **Goals** (`hints`): a short brief in CrierBelt's voice, one to three measurable objectives, a reward. No arrow and no step list. The quest log's « Indice » asks for help: one marker on the first hint still to do, gone once that hint holds. After `QUEST_HINT_AFTER` (5 game minutes) with none of the quest's objectives moving, that marker comes once by itself. Never a stream.

Objectives judge outcomes — the compiled graph, rates, stocks, totals — never particular clicks or tiles, so any way the player finds counts. A counter with `ever` counts from the founding, so what was done before its quest counts too (the plates made while the smelter's quest was not yet current, the glass already sold).

Three parts, one per layer:

| Part | File | Does |
|---|---|---|
| Content | [content/quests.ts](../src/content/quests.ts) | `QUESTS` (in run order): name and CrierBelt's message (`{ fr, en }`), `reveals`, objectives, `any`, reward, `steps` (guided) or `hints` (goal), live `info`; `QUEST_TITLES`; `QUEST_FOLDS` (the first tutorial's ids, for saves); `QUEST_ADDED` (quests a later table added, for saves); `SIDE_GOALS` (the optional objectives); `QUEST_CHECK_TICKS`, `QUEST_HINT_AFTER`, `QUEST_TABLE`, `COLONY_NAME_MAX`; `isGoal`, `guideSteps`; `questProblems()` (run by `validateContent`) |
| Engine | [sim/systems/quests.ts](../src/sim/systems/quests.ts), [sim/readouts/night.ts](../src/sim/readouts/night.ts) | `QuestState` (on `sim.quests`), objective progress, completion, rewards, the `name` and `quest` commands, rate windows, `revealed` and `planOffered`, save (with the folds), hash; `nightCover`, the Core's grid without the sun |
| UI | [ui/quest-log.ts](../src/ui/quest-log.ts), [ui/guide.ts](../src/ui/guide.ts), [ui/night-notice.ts](../src/ui/night-notice.ts), [ui/styles/quests.css](../src/ui/styles/quests.css) | The quest log (left, under the HUD), the completion toast's text, the naming modal; the guide's arrow, ring and bubble; the night notice |

Tests: [sim/systems/quests.test.ts](../src/sim/systems/quests.test.ts). The French halves of `QUESTS`, `QUEST_TITLES` and `SIDE_GOALS` are in the i18n typography test.

## The quests as built

Two rules still shape it (owner, 2026-10-12): **the Heart only takes in** (D34) — every machine is fed by its own production lines —; and **everything beyond the starting kit is unlocked in the tech tree** (D33) — a quest's plans come from the tree. **The tree offers only what the tutorial has reached** (D101): each quest `reveals` the few plans it is about (`plan:<id>`); the others are drawn faint, « Plus tard », with no cost and no button, and the HUD's badge does not count them. « Données d'arpentage » reveals every plan (`plans`): the rest of the kit is a goal the player works through at their own pace before the lab (D71). The engine takes any plan (debug bases, `FL.unlock`); the pacing is the tree's (`planOffered`).

| # | id | Kind | Reveals | Objectives (all, unless *any*) | Reward |
|---|---|---|---|---|---|
| — | `claim` · Ta concession | guided | — | the claim is named (`name` command) | — (its entry in the register) |
| 1 | `first_strike` · Premier coup de pioche | guided: 4 steps | the construction bar, power, the first stocks | a drill built; 10 ore in the Core | 20 iron plates |
| 2 | `bloom_kiln` · La fonderie | guided: 11 steps, 7 sentences to read | the tree (its chip, T), the clock, the Production and Électricité views; plan Fonderie | iron ore and coal reach a smelter by lines (`feeds`); 10 plates made (`ever`) | 30 iron plates |
| 3 | `first_wind` · Tenir la nuit | goal | plan Éolienne | the Core's grid would hold 80 % of its demand without the sun (`night`) | a wind turbine kit (its cost; the coal generator's until D143) |
| 4 | `glassworks` · La verrerie | goal | the Logistique view; plans Collecteur de sable, Routeur, Jonction | 10 glass made (`ever`); glass reaches the Core | 20 plates, 20 glass |
| 5 | `steam_power` · La vapeur (D114) | goal | plan Vapeur | water reaches a steam boiler from a pump (`feeds`); coal reaches it (`feeds`); the boiler on a grid (`linked`) | 30 plates, 10 glass |
| 6 | `crier_trade` · La Criée | goal | ocelles, the Crier; plans Télémétrie, Comptoir, Tréfileuse | 5 glass sold (`ever`); 10 copper ore bought and delivered (`import`, `ever`); the bought ore reaches a wire mill (`feeds` `from` the trade post) | 150 ◉, 40 copper wire |
| 7 | `slag` · Les scories (D125, D139) | goal, `any` | plans Trieur, Incinérateur; the slag's stock | the starter contract's slag reaches an incinerator (`feeds`: a post whose cargo holds it counts as its producer, as a waste's makers do, `wasteItem`), or 5 slag sold (`export`, `ever`) | 30 plates, 10 copper wire |
| 8 | `core_upgrade` · Le Cœur grandit | goal | — | the Core at level 2 (`hearth`): the player's own `hearthUp`, paid in 120 plates, 40 glass and 40 copper wire; it mounts the compute bay, whose tokens run the first lab (D122) | 100 ◉ |
| 9 | `field_journal` · Le laboratoire (D122; « Données d’arpentage » until then, the id kept) | goal | every plan; the brush | every plan unlocked (a calm count, « Plans pris 9/25 »; the Face Cutter's among them); the lab powered (`powered`); Mechanics (`tr1`) started | 600 ◉ |
| 10 | `wall_quartz` · Le quartz de la paroi | goal | the Terrain view | the vein's parcel held (`vein`); 10 quartz in the Core | a quartz workshop kit; the title « Passe-Crête » (`grant`) |
| 11 | `synth_parts` · Les pièces de la Synthèse | goal | — | oscillators and copper coils each led into the Core (D129: the assembly bench beside the quartz workshop, its plates by a router on the plates' line (D139: the smelters leave no slag); circuits until then, from the electronics workshop, Tier 2's now) | 300 ◉ |

**« Les scories »** (D125, D139; owner, 2026-10-18: « il faudrait que certaines machines produisent des déchets en alternance avec leur vraie production, qu'il faille traiter », then « don't make smelters and early game machines create slag or scraps. that's for later, but the tutorial should still show how to sort them with the sorter »). No machine of the tutorial leaves waste (D139: only the steel line does). The slag comes with CrierBelt's starter contract: its ore is out of a foundry of the Ring, one slag with every five ore (`BAL.starter.waste`, 8 in all), out by the post's exit in turn with the ore. The wire mill refuses it, and the copper line stops at the mill's door under the refusal's badge. Right after « La Criée », CrierBelt says what slag is, that the Core takes none either (D139), and that the steel mill and the press will leave some later. Its hints: the two plans; a sorter laid over the line's last tile, set to the copper ore (laid there it takes in the slag that waits: compile.ts keeps a ribbon tile's item in the routing block laid on it); an incinerator against its free side (the guide's spots `{ refused: true }` — the door where something waits refused, the Core's first, else a machine's — and `{ newest: 'sorter' }`). Leading the slag into the post's entrance and selling it meets it too (`any`). Recycling (slag bricks at the brickworks, the steel mill's slag) comes with Tier 1's research, past the tutorial.

The first tutorial (D28–D98) had twelve quests after the name and 81 steps; today's has two guided quests of 4 and 11 steps after the name (one step), and 61 hints on request (D114: « La vapeur »'s 7). D101 kept its arc — the cirque's basics → glass and power → copper and the Crier → past the Crown → the lab and Tier 1 → quartz — and merged or cut the rest:

- « Le Ruban » (a second drill, the telemetry) is gone: the second drill is the smelter's, and the telemetry is an optional objective.
- « La fonderie » has no router any more: one drill of each feeds one smelter (D97: 10 ore and 10 coal a minute). The router comes with the glass, where the coal is shared — or a second coal drill does it, and that hint passes by (`unless`).
- « Le Souffle » became « Tenir la nuit », whose measure is the grid without the sun.
- « La Criée appelle », « Le filon fatigué » and « Premier achat » are one quest, « La Criée ». Its purchase is the starter contract, and the quest is met when the bought ore reaches a wire mill (owner, 2026-10-16: « on dit au joueur de placer une commande de cuivre sur le marché, mais jamais de s'en servir. Je n'avais même pas relié mon tradepost »).
- « Au-delà de la Couronne » folded into « Le quartz de la paroi », the tutorial's way past the Crown; its title « Passe-Crête » with it.

The second pass (D101, owner's notes of the same night) took out every wait that is not building time:

- **No research wait** (owner: « le face cutter devrait être beaucoup plus rapide à obtenir, ce tutoriel est chiant »). The Face Cutter (`ex_quartz`) is a plan (of the Production path since D117), taken with every plan in « Le laboratoire »; « Le quartz de la paroi » no longer waits on it. « Le laboratoire » only *starts* Mechanics (`tr1`, whose prerequisite is now the lab's plan alone), and « Les pièces de la Synthèse » asks for the two parts it can build at once: the gears wait for Mechanics' press, learnt in its own time. Its first hint (D128) launches the Quartz Workshop's own node (`dn_quartzshop`, the Workshop's: two minutes of the Core's compute), which the workshop the quest's kit pays for needs; its text says what the Synthesis needs since D128 (the Workshop, the Steelworks, the Core's compute) and that each Tier 2 category waits for those of Tier 1 it builds on. The tutorial debug base learns it for real before laying its quartz works (`learnQuartzShop`, scenario-quartz.ts).
- **The Core grows by the player's hand** (owner: « there should be a quest in the tutorial where you upgrade it »). « Le Cœur grandit » is the Core's level 2 (`BAL.hearthUpgrades[0]`, unlock `start`): one click on the Core's card once its plates, glass and copper wire are in the Core. No quest grants a level any more (« La Criée » used to pay level 2's materials, and Mechanics gated it).
- **The first lab runs on the Core** (owner: « The quest where you start researching could use the core's data production rather than a data collector, which could be unlocked later »). Since D122 that is the Core's compute: from level 2 its compute bay gives research 1 000 AI tokens a minute (`BAL.coreCompute`), with no power and no ribbon, so the lab only needs the grid and Mechanics' resources (30 plates, 10 copper wire) leave the Core at launch; a Tier 1 node takes two to five minutes. Overclocking (`an_data`, Tier 1) adds 500 a minute. Until D122 the Core made 2 Survey Data a minute at its data outlet and a ribbon fed the lab; the data collector came with « Traitement des données ».
- **Tokens, lightly**: the tutorial's research is Tier 1, on the Core's compute alone (the launch dialog's default buys nothing there), so the quests name the tokens only to say where they come from (« Le laboratoire »: the Core's compute bay, or a flow bought from CrierBelt).

**The starter contract** (`BAL.starter`, [engine.md](engine.md#trade)): CrierBelt's one-time offer, « Contrat de départ · prix fixe », signed on a post's card in the Crier. It brings 40 copper ore at a fixed 2 ◉, 10 a minute, each lot landing a game minute later, off the market. It buys nothing while the post's exit leads nowhere, so the player meets the exit's rule at once. « La Criée »'s hints show the post's exit (« sa rampe corail ») and the ribbon into the mill.

- **At its cap it stops** (owner, 2026-10-16: on their base the tutorial's copper order bought on for hours, about −2 200 ◉/h, unseen). The order stands paused (`orderHold` 'fulfilled'), and a notice ([ui/contract-notice.ts](../src/ui/contract-notice.ts), `[data-screen="contract"]`) says « Contrat de départ rempli » with the ore's icon, today's market price and what that costs a minute. It asks one question: « Continuer au prix du marché » (`[data-contract-go]`: the logged `starterGo` command, an ordinary order from then on, capped 10 % over the ask: `BAL.starter.continueOver`) or « Arrêter » (`[data-contract-stop]`, the default: the order cancelled). The same two buttons stand on its row in the Crier.
- **Every standing order shows its live cost**, « −37 ◉/min » in coral (`orderCentsPerMin`), or « — » and why it holds. The contract's row shows its fixed price and what is left of its allowance as a bar.


**The night** (owner, 2026-10-16: « something should tell the user that the core has solar panels that will stop producing electricity at night »):

- The objective `night` reads `nightCover` ([sim/readouts/night.ts](../src/sim/readouts/night.ts)). That is the Core's grid's producers in this epoch's weather with the sun at nothing, its fuelled generators, and what its accumulators hold spread over a night, against what the grid asks for now. It reads the same at any hour, so the player prepares by day, and the log shows « 54 % / 80 % ». Its hints are the turbines, at the Crown's windiest spots (D95), two and then two more while the night does not hold (`unless`). Since D143 the wind alone answers it (the coal generator left the game): one thing to learn in the first hour, the turbine the night does not stop; its brief says a steam boiler will hold the night too, later, with coal and water — « La vapeur », two quests on, with its pump and conduit. Solar with storage was set aside: the panel is a Tier 1 research at the lab, the accumulators Tier 2's, neither to hand in the first hour.
- The night notice ([ui/night-notice.ts](../src/ui/night-notice.ts)) comes once per base, about one game hour (1.5 game minutes) before a sunset, if two things hold: the sun gives at least 15 % of the Core's grid, and `nightCover` is under 80 %.
  - It shows the sun going down behind the Crown, then a turbine (a coal generator beside it until D143).
  - It shows two figures, « Le soleil : 30 % de ton énergie » and « La nuit : 77 % de ta demande ».
  - Its one sentence: « Le panneau du Cœur s’éteint au soir ; son noyau donne jour et nuit, mais tes machines demandent déjà plus. Ajoute des éoliennes avant le soir : le vent, lui, ne tombe pas la nuit. »
  - Its buttons: « Vue Électricité (P) » (shown once the view is offered) and « Compris ».
  - It goes by itself at nightfall. The brief's « accumulateurs » became « un générateur à charbon » (accumulators are a research of Tier 2, tr3, not to hand yet), and that went with the generator (D143): the turbine is the answer at hand.
- The Core gives most of its power day and night (D101; owner: « the solar panels from the core should do a less important part of its electricity production »): its isotope core, `BAL.hearthCoreKw` (210 kW at level 1, then 300, 420, 560), about 70 % of what it gives at noon; its panel the rest in full sun (`BAL.hearthSolarKw`: 90, 130, 180, 240). So « Tenir la nuit » is about the player's own machines: two drills hold the night on the core alone, and the three drills of « La fonderie » (270 kW) outgrow it. That is why the clock and the Électricité view come with that quest.

**Optional objectives** (`SIDE_GOALS`): what the player can discover alone. Each is a tick in the log's « Objectifs libres » list, with no reward and no arrow, shown from its quest on:

- the views (Production, Électricité, Logistique opened once; the log's own record, per base);
- the telemetry;
- one more parcel;
- the production ledger (G);
- the wind survey (V).

**Saves** (`QUEST_TABLE` 5, `QUEST_FOLDS`, `QUEST_ADDED`): a save from an older table loads into today's quests (`loadQuests` → `foldDone`). Kept ids stay done. « La Criée » is done once « La Criée appelle », « Le filon fatigué » and « Premier achat » all were, at the last one's tick. « Le Ruban » and « Au-delà de la Couronne » are dropped. « Le Cœur grandit » (added with table 3), « La vapeur » (table 4, D114) and « Les scories » (table 5, D125) count as done when a quest after them was. The current quest is the first not done in today's order, its baselines taken afresh: the old ones belonged to the old table.

So a base saved at…

- « Le Ruban » goes on at « La fonderie »;
- « La Criée appelle », « Le filon fatigué » or « Premier achat » goes on at « La vapeur » (D114: it comes before « La Criée » now), then « La Criée »;
- « Au-delà de la Couronne », or « Le laboratoire » (« Données d'arpentage ») not done, goes on at « Les scories » (D125), then « Le Cœur grandit » (met at once by a Core already at level 2);
- « Le quartz de la paroi » or later goes on where it was.

The save's research moved with it (save 13, [persistence.md](persistence.md)): a claim with the lab's plan holds « Traitement des données » (Overclocking since D122, when the data collectors were taken down and refunded by save 19's remap); a Face Cutter under way is its plan taken.

A goal met already completes at the next check. The scripted test loads a save at each old quest.

Pacing: the scripted run (`quests.test.ts`, every line laid by hand, `QUEST_REPORT=1` prints the minutes) finishes the guided quests in two game minutes. « La Criée » waits on the contract's first lots (a minute after each purchase), and nothing after it waits on research: the run ends in the ninth game minute. The debug levels play every quest on their own ([scenarios.ts](../src/sim/scenarios.ts)); the headless play-through's times per quest are in D101.

## How the engine runs them

- **State** (`sim.quests`, saved, hashed): the ids done and the tick each was, the current index, the current quest's *baselines* (one counter value per objective, captured when it became current), its *rate windows*, `named`, `titles`, `skipped`.
- **Objectives** read the colony as it stands (`build`, `stock`, `linked`, `powered`, `research`, `unlocked`, `post`, `order`, `dig`, `reach`, `recipe`, `delivers`, `feeds`, `name`, `vein`, `night`, `starter`: the contract signed, `land`: parcels held beyond the starting square, `hearth`: the Core's level) or a counter *since* the quest began, or from the founding with `ever` (`produce` from `sim.produced`, `export` from `trade.soldTotal`, `import` = bought minus in flight).
  - `linked` / `powered` read what the inspector's grid module reads (`graph.netOfEnt`, `sim.netPower`): an outcome, whatever the wiring tool looks like.
  - `unlocked` counts tree nodes done (plans and research alike, D33).
  - The line objectives walk the compiled graph through ribbons and routing blocks only (`flows`): any ribbon tier, bridges and junctions on the way. `delivers`: a building's output reaches the Heart. `feeds`: a building (on a recipe, if given) receives an item from one of its producers (`producersOf`: drills on its deposit, machines whose recipe makes it, trade posts holding it in their cargo; the Core gives nothing since D122). Its `from` keeps only the producers among some buildings: the trade post, for goods bought and used; the drills, for ore of one's own.
  - `night` is `nightCover`'s percentage; `rate` compares the counter's rise over its window: `(v1 − v0)·EPOCH ≥ perMin·1000·(t1 − t0)`, integers only.
- **When completion is checked**, at fixed points so a replay meets the same ones:
  1. every `QUEST_CHECK_TICKS` (10) ticks, at the end of `Sim.step` (`questStep`);
  2. inside the `name` command (quest 0 completes at once);
  3. `sim.checkQuests()`, which the shell calls right after an offline catch-up (the catch-up does not run `step`). Without it the next online check, within a second, finds the same thing: an absence cannot skip a quest. Only the current quest can complete during an absence; the next one starts afterwards. Every objective is a state read or a counter the catch-up keeps exact (the contract's purchases run in the same `tradeEpoch` offline), so online and offline agree.
- **Rate windows**: a window opens when the quest becomes current and closes at the first epoch boundary at least a whole minute later; then one per minute. After a catch-up the open window spans the absence, so its average rate counts. (No quest uses `rate` today.)
- **Completion** (`finish`): logs `{ k: 'quest', id }`, pays the reward into the Heart (items past its cap if need be — nothing vanishes; ◉; the title of the objective that completed an `any` quest, or `grant`'s), records it, makes the next quest current (`activate`: baselines, windows) and pushes the `quest` SimEvent. Then any next quests that already hold complete too.
- **Replay**: a replay re-runs the same ticks, so automatic completions happen again at the same tick and log themselves; their logged entries are then refused by `exec` (the quest is no longer current) and log nothing. Logs and hashes match; nothing is paid twice. A forced entry (`force: true`, debug) is re-forced.
- **No fee waiver**: CrierBelt's fifth is never waived (D64); an old save's `feeFreeUntil` is read by nothing.
- **Save**: `SaveData.quests` (optional, ids rather than indices, `table`); a save without it starts at quest 0; a save from an older table is folded (above); if the quest table changed, the current quest takes fresh baselines.

## The UI

- **Quest log** (`QuestLog`, `[data-screen="quests"]`):
  - The header: the claim's name on a coral ribbon (click: rename), « Partenariat CrierBelt · objectif n sur 9 » (« · inscription au registre » for the name), the guide switch (☞) and fold (▾).
  - The current quest: its number, name, CrierBelt's message (« vous »), its objectives each with its icon (the item, the building or its plan's building, a glyph for the night, the contract, the land), its inked box, progress and bar (the D89 kit's), live `info` lines, reward chips.
  - Then, for a guided quest, the guide step's hint (« tu », like the rest of the UI); for a goal, the « Indice » button (`[data-quest-hint]`: « Indice » / « Masquer l'indice »; greyed with « Tout est en place : il ne reste qu'à attendre. » once every hint holds; it nudges when the soft hint came by itself) and, while asked for, its hint.
  - Then the optional objectives (« Objectifs libres · n/m », `[data-quest-side]`, foldable, `[data-quest-side-goal="<id>"][data-met]`), then the objectives met, ticked.
  - It is placed under the HUD's left column, clear of the build bar. A completion stamps a ✓ on it. Once the tutorial is over the log leaves the screen: 20 s (`DONE_SHOW_TICKS`) after the last objective is met, at once when it was skipped.
- **Toast**: `questToast(id, title?)` — « CrierBelt : objectif atteint — La fonderie · +30 Plaque de fer » (handler in [app/sim-events.ts](../src/app/sim-events.ts)).
- **Naming modal** (`[data-screen="name"]`): CrierBelt's welcome, a name to start from (↻ for another), « Inscrire la concession » / « Plus tard ». It opens by itself once on an unnamed claim when no full screen is up (the main menu shows first at boot); never under `navigator.webdriver` or `?nomenu`, where the claim stays « Concession sans nom » and quest 0 open until a script names it. Enter registers, Esc defers; the quest log's « Nommer la concession… » reopens it.
- **Guide** (`Guide`, `[data-screen="guide"]`):
  - **Which step.**
    - A guided quest's step is the first whose `done` objective does not hold (counters from the founding, read on the compiled graph, so steps done out of order are passed by) and that never held before on this base: the guide remembers the steps done (`passed`, per base and quest, in localStorage), so a step completed, even out of order, never comes back.
    - A guided quest ends on a closing line, a step with no `done` (D98; `questProblems` checks it). Once every other step holds, that line is the step, so the guide never asks again for the last thing the player did (owner, 2026-10-16: « it keeps telling me what to do (put a ribbon) even though it's done already »); a step whose `done` holds is never pointed at.
    - A goal shows nothing until its hint is asked for (`toggleHint`) or comes after a long stall (`nudge`). Then it shows `hintIndex`'s hint — the first that applies on this land, whose `unless` does not hold, and not done — until that hint's `done` holds or the player puts it away; the next one waits to be asked for.
  - **Its target follows the UI.**
    - `build`: the tab, then the slot (with what the Core lacks to pay for it, if anything: « Il manque au Cœur : 2 Plaque de fer, 2 Verre »), then (in hand) a spot in the world. The spot is shown only for the very first drill, for the quartz vein's foot (`{ vein: true }`), for a turbine (`{ windy: true }`, D95: the Crown's windiest free spot) and for the first pump (`{ water: true }`, D114: the nearest spot to the Core where a pump draws water, on any level — [readouts/water.ts](../src/sim/readouts/water.ts) `nearestWater`; on map 4 D115's spring pool at the floor's edge, on maps 2–3 the tarn up on the Crown); elsewhere the hint alone says where.
    - `unlock`: the HUD's tree chip (`[data-hud-tree]`), then in the tree the first of its nodes the Core can take now, else the first still locked (`unlockNode`: « all plans » points at one ready plan, never down the list), scrolled into view, then its « Débloquer » (`[data-unlock="<id>"]`) or, for a research, its card and « Lancer ». A plan the Heart cannot pay for yet: the bubble says what it lacks.
    - `branch`: while no routing block stands on the line of that item (or none on it has a side free for one more branch), the router (its tab, its slot); then a ribbon on to the building still to feed.
    - `recipe`: the machine still to set (one with no recipe first), then its recipe button once it is the one inspected. The building still in hand: « Range d’abord l’outil… ».
    - `link`: the Énergie tab and the Link tool, then where the wire starts — the Heart, or the nearest pole of its grid that reaches the building (`linkFrom`). None reaching it: the pole's slot and, the pole in hand, the tile where it goes (`poleSpot`). Then the building still unwired.
    - `research`: the HUD chip, the card, « Lancer ».
    - `crier`: the HUD's purse, then its card's « Ouvrir la Criée » (D102: a click on the purse opens the card first), the tab, then the order form (its item picker, its rate field when the step gives one, then « Ajouter ») or the starter contract's « Signer » (`[data-starter-take]`, D101; no post yet, the bubble says so).
    - `land`: the HUD's land button while the land mode is off, the parcel holding the step's spot, its « Acheter ».
    - `stock`: the HUD's « Stock » button until its panel is open.
    - `hearth`: the Core in the world, then its card's « Passer au niveau 2 » (`[data-insp-act="hearth-up"]`) once it is the one inspected.
    - `brush`, `name`.
  - **Narrow windows.** An `unlock` or `research` target's tree chip may be folded: the arrow points at the research fold (`[data-hud-fold="research"]`).
  - **A screen in the way.** When a full screen covers a target out in the world, the arrow points at the screen's ✕ (`.rs-close`).
  - **Every step done, the quest still short.** The first production building standing unwired or without a recipe gets the arrow, « Foreuse à l’arrêt : Sans câble » (`stalled:<def>:<why>`, D88's `stopWhy`).
  - **The bubble's manners** (D101; owner, the same day: « here the tutorial blocks me from seeing what I'm supposed to do »).
    - It never covers what it points at, nor the controls the step needs: the card or panel round the target, such as a post's card and its order form, a tree node and the tree's detail panel, or the inspector.
    - It keeps off the quest log and the side panels.
    - It tries above what sits low, below what sits high, beside, round the target's corners and beside the log, and keeps the first spot clear, else the one that covers least.
    - It is worked out every frame, so it follows resizes and scrolls.
    - Its « – » (`[data-guide-tuck]`) tucks it into a ☞ chip by the ring with no arrow; a click on the chip brings it back (remembered).
    - A world target's bubble glides the camera there on click.
  - **When it hides.** While the modal is up, or when switched off (remembered in localStorage).
- **Night notice** (`NightNotice`, `[data-screen="night"]`, `[data-night-view]`, `[data-night-ok]`) and **contract notice** (`ContractNotice`, `[data-screen="contract"]`): above. They stack top right (`.notices`) and wait under a full screen or a side panel.
- **The tree's pacing** ([screens/research.ts](../src/ui/screens/research.ts) `stateOf`): a plan not offered yet is in the state `later` (faint, dotted, no cost line, its button off, « Plus tard : le partenariat y viendra »); [tree-state.ts](../src/ui/tree-state.ts) `readyPlans` leaves it out of the HUD's count.

## Add a quest

1. **Content**: add an entry to `QUESTS` where it should run (order is the run order; ids are saved, so they must stay stable — a quest renamed or merged needs a line in `QUEST_FOLDS`, and a new table shape a `QUEST_TABLE` bump). Give it:
   - `name` and `desc` (CrierBelt's message, « vous », short — see [lore.md](lore.md));
   - `objectives` (one to three; outcomes, never clicks) and `reward`;
   - `reveals` (the plans it is about, `plan:<id>`);
   - either `steps` (guided: only for a basic the player has never seen; the last one a closing line with no `done`, usually `target: { k: 'none' }`, saying what the base is doing while the quest waits) or `hints` (a goal: each with a `done`; `unless` for a way another way makes pointless).

   French typography: U+00A0 before `:`, U+202F before `; ! ? %` (escapes ` ` / ` ` are fine).
2. **A new objective kind**: add it to `QuestObjective` (content), read it in `objectiveProgress`, give it a log label in `objectiveLabel` and an icon in `objectiveIcon` (the `never` checks fail to compile until all exist), add a `quest.obj.<kind>` key to `fr.ts` and `en.ts`. A counter that counts *since* the quest began goes in `counter` and `SINCE` (`ever` makes it count from the founding). Keep it integer and offline-exact: state the catch-up keeps (stocks, entities, research, trade totals) or `sim.produced`.
3. **A new guide target**: add it to `GuideTarget` and resolve it in `Guide.target`, preferring stable `data-*` hooks (add one to the component, a tiny edit).
4. **Unlock before use** (D33): a step or hint that builds something outside the starting kit, sets a recipe or branches a line with a router must come after an `unlock` step (or an `unlocked` objective) for it, in this quest or an earlier one; a plan it names must be revealed by then (D101). `questProblems` checks both.
5. **A new reward kind**: `QuestReward`, `rewardItems` / `payReward` (engine), `rewardRow` / `rewardText` (UI).
6. **An optional objective**: an entry in `SIDE_GOALS` (an objective read from the founding, or views; its icon; the quest it shows from).
7. **Check**: `npx vitest run src/sim/systems/quests.test.ts src/content src/i18n src/sim/scenarios.test.ts`.
   - Extend the scripted run in `quests.test.ts` so it completes the new quest with real commands. It starts from a new player's base (`veinSim()`), unlocks each plan with `unlockPlan`, and asserts the guide's step after each action in a guided quest (`stepNow`) and the hint on request in a goal (`hintNow`).
   - Give the tutorial debug level its move (`scenarios.ts`), the quest met on its own.
   - Look at it with `FL.completeQuest('<previous id>')`, `FL.questHint(true)` and `FL.unlock(id)`.

## Debug and smoke hooks

The tutorial debug levels ([sim/scenarios.ts](../src/sim/scenarios.ts)) play the tutorial on their own, every quest met, nothing forced or skipped (`scenarios.test.ts`):

- `claim` stands at quest 1;
- `smelter` at « La fonderie »;
- `survey` at « La Criée » (« La vapeur » played: [scenario-steam.ts](../src/sim/scenario-steam.ts));
- `tutorial` at « Les pièces de la Synthèse », Mechanics learnt and the lab's next node under way, a second in (D122: its resources granted where short, `Builder.affordNode`, its tokens from the Core's compute; `labNext`). It is a base to play the last quest from; the bot and the smoke start there.

Its « Tenir la nuit » plants two turbines on the Crown's windiest spot (`crownWind`) beside the two on the floor. Its glass smelter goes down with its first sand collector, on the collector's far side from the Heart; a spot that leaves no way in for the sand is taken back up and the next point of the coal line tried (D104: the coal's irregular patch can box the smelter's inlet in). Its « La vapeur » (D114, [scenario-steam.ts](../src/sim/scenario-steam.ts)) sets a pump on the far shore from the Core of the water nearest it (`waterSpots`: map 4's spring pool at the floor's edge, D115), the boiler beyond it, a conduit between (`routeLevel` with `fall`: water may pour down the terraces), and a coal drill of the boiler's own on the cirque's coal whose line keeps to the floor's rim (`rimRoute`: the middle is the post's, the lab's and the quartz lines', laid after) and crosses the lines in its way on junctions; all wired pole by pole. D85's idle check counts a source that feeds only generators on standby, backed up behind them, as on standby too. Its « La Criée » signs the starter contract and leads the post's exit into the side of the copper drill's line. Once the contract is delivered it stops the fulfilled order (« Arrêter ») and takes that ribbon up, so the exit can feed the Heart later (`tradeLine`); a junction it crossed goes back to the crossed line's ribbon. « Le Cœur grandit » raises the Core with the logged command; « Le laboratoire » sets the lab well east of the Core, unfed (D122: no ribbon), wires it and starts Mechanics, its resources granted where short (`affordNode`). No survey beacon past the Crown since D117 (it planted one before): the quartz vein's parcel, bought, and the poles that carry the power over the Crown lift the fog out there, as they do in play. The `grown` level learns Overclocking (`an_data`; no collector since D122). D85's idle check (`idleAfter`) leaves out a lab with no project: research waiting on the player's choice is not a broken line. The smelter's own iron drill gets an overflow gate into the Heart (`ironSurplus`): it cuts more than one smelter takes. The `grown` level completes the last quest by force: its assembly bench's and press's lines take room the crowded core does not always leave (D129: it tries the bench as an extra, off the wire line and a plate line). The scripted run in `quests.test.ts` plays it with real commands. From the tutorial level on a level ends with its power topped up (`powerUp`): the best turbine the claim has learnt, each a turbine's room from the others (D132) on the Crown's windiest spots, then on the open sand round it, until the next two days' weather holds the grid — the late base's are Great Turbines (D132).

`FL.vein()` gives the land's quartz vein: its face tiles, the side it looks to, its parcel, the face cutters' four spots; null on maps 1–2.

`FL.quests()` gives the current id, index, named, name, done, titles, progress, and where the guide points: `{ quest, step, at, hint, tucked }`, e.g. `hud:tree`, `tree:unlock:kiln`, `line:iron_ore`, `crier:starter`, `screen:close`, `hidden`.

Other hooks:

- `FL.completeQuest(id)` forces every quest up to `id`, logged, rewards paid; it unlocks no plan.
- `FL.questHint(show?)` asks for a goal's hint or puts it away, and returns `{ goal, shown, left, auto }`.
- `FL.nightNotice(show?)` shows the night notice now, whatever the hour, and returns whether it is on show.
- `FL.unlock(id?)` unlocks a plan and its missing prerequisites through commands, their costs granted first; with no id, every plan.
- `FL.nameColony(name)`, `FL.nameModal(open?)`.

Selectors: `[data-contract-go]`, `[data-contract-stop]`, `[data-starter-go]`, `[data-starter-stop]`, `[data-order-cost]`, `[data-insp-act="hearth-up"]`, `[data-hud-tree]`, `.tr-node[data-id="<id>"][data-state]`, `[data-unlock="<id>"]`, `[data-screen="quests"]`, `[data-quest="<id>"]`, `[data-quest-obj="<i>"][data-met]`, `[data-quest-hint]`, `[data-quest-side]`, `[data-quest-side-goal="<id>"]`, `[data-quest-name]`, `[data-quest-rename]`, `[data-quest-fold]`, `[data-quest-guide]`, `[data-quest-donebtn]`, `[data-quest-done="<id>"]`, `[data-screen="name"]`, `[data-quest-name-input]`, `[data-quest-name-ok]`, `[data-quest-name-later]`, `[data-screen="guide"]`, `[data-guide-tuck]`, `[data-screen="night"]`, `[data-night-ok]`, `[data-night-view]`, `[data-starter-take]`.

## Known gaps

- The catch-up checks quests only at its end (through the shell): two quests in a row cannot both complete during one absence.
- The guide's hints name keys (T, M, L, C, R, I, P) by the default bindings.
- `night` reads the wind as it blows now: a calm hour can read under the wind's average, and a gusty one above it. The quest asks for what holds at some moment, not through a whole night.
- The guide's memory of steps done is per browser (localStorage), not in the save: another browser shows a guided step again if the base no longer does what it asks.
- « Les vues » (an optional objective) is the log's own record, per browser too.
- A full screen (the tree, the Crier) covers the quest log and its « Indice »: the player closes it first.
- CrierBelt's restart reserve (D36) can hold back a plan a quest asks for. This only happens when the player has first spent the margin above the reserve on other plans. The tree says why, and the hint keeps pointing at the plan. Quest rewards and the first plates a smelter makes lift the hold.

## What the tutorial reveals (D32)

The interface grows with the tutorial (owner, 2026-10-12: nothing on screen before the tutorial uses it). Each quest lists `reveals`, and they appear when that quest becomes current, cumulatively:

- HUD readouts: `credits`, `power`, `clock`, `research` (the tech tree's chip and T);
- the construction bar as a whole (`build`: its tabs, the Build button, the Link hotkey);
- screens and tools: `crier`, `stats`, `brush`;
- the specialised views (D88), one by one with the quest whose trouble they show: Production and Électricité with the smelter (why a machine waits; the night its three drills will see), Logistique with the glass's shared coal, Terrain with the quartz parcel. The land key I works from `build` on, as an off-land refusal says. No selector before the smelter;
- the tree's plans (`plan:<id>`, `plans`, D101);
- item stocks (`stock:<item>`). An item's stock also shows once the base has made some itself.

`revealed(sim)` (in [sim/systems/quests.ts](../src/sim/systems/quests.ts)) returns the set, or `null` for everything once the tutorial is done or **skipped** (« Passer le tutoriel » in the log: the `skipQuests` command; the demo base starts skipped). Skipping the tutorial shows the whole interface, not what is still locked in the tree.

The bar's **tabs** are no tutorial reveal: once `build` is revealed, a tab shows as soon as one of its buildings is unlocked (D27, D33). At the start that is Extraction, Logistique and Énergie (drill, ribbon, pole); then Production with the smelter, Distribution with the router, Commerce with the trade post, Colonie with the fence (D103; the survey beacon was its first, until D117).

The HUD's rates (what comes into the Heart each minute, D79) are no tutorial reveal but a plan: **Télémétrie** (the `telemetry` flag), the first step of the tree's Analytics path (D41), offered with « La Criée » (the trade post needs it) and an optional objective. The HUD, the build bar (the brush, the Build button) and the hotkeys (T, G, M, C, L) all read what is revealed and unlocked.

| Quest | Reveals |
|---|---|
| 1 first_strike | the construction bar; power; plates, glass, copper wire, iron ore |
| 2 bloom_kiln | the tech tree (its HUD chip, T); the clock (day / night, temperature); the Production and Électricité views; plan Fonderie |
| 3 first_wind | plan Éolienne |
| 4 glassworks | the Logistique view; plans Collecteur de sable, Routeur, Jonction |
| 5 steam_power | plan Vapeur |
| 6 crier_trade | ocelles; the Crier; copper ore; plans Télémétrie, Comptoir, Tréfileuse |
| 8 field_journal (« Le laboratoire ») | every plan; the landscaping brush |
| 9 wall_quartz | the Terrain view |
