# Pacing: the first three hours (D146)

How a new base plays for its first three game hours, measured by a headless player on the real map, lands 1–3, with what was off, what changed, and the numbers the next features (CrierBelt delivery orders, blueprints) size themselves on. One game minute is one real minute (`EPOCH`), so three game hours are three hours of play; a day is 36 minutes, its night 12 dark minutes between a dusk and a dawn of 3 each.

Related: [quests.md](quests.md) (the tutorial), [research.md](research.md), [content.md](content.md), [testing.md](testing.md) (how to re-run it), [decisions.md](decisions.md) (D146).

## Method

**The player.** [sim/pacing/bot.ts](../src/sim/pacing/bot.ts) (`playPacing`) founds a base as the debug bases do — the real map (map 5), `playerSeed` 1, 2 or 3, founded at the sunrise before the scenarios' minute (`scenarioEpoch`), so the first night falls at minute 18 — and plays it through commands only: placements, ribbons, wires, recipes, plans, research launches, the starter contract, spot purchases, parcels. It obeys every rule a player meets.

- **Its hands are the scenarios'.** `PacingBot` extends the debug bases' `Builder` (scenarios.ts) and reuses each quest's builder (`firstStrike`, `bloomKiln`, `glassworks`, `steamPower`, `wallQuartz`, `quartzWorks`…). Every « grant what is short » of the `Builder` becomes « wait until the base has it »: `afford`, `affordNode`, `plan`, `landFor`, `until` and `wire` wait, and each wait is recorded with what it waited for. `sim.grant` and `sim.grantCredits` are replaced by a hook that records a problem and gives nothing. No quest is ever forced.
- **It plays the tutorial as its guide and hints do.** It follows the objectives in order and does what the guide's arrow points at: the windiest Crown spot for a turbine, a wire mill out by the copper vein, the glass smelter where its line leaves room for « La Criée »'s router, the slag sorter where the slag waits.
- **Two players.**
  - *Hints*: asks for the goals' hints (« Indice ») and builds what they name beyond the objectives. That is « Le Cœur grandit »'s second iron smelter with its own drill pair, built as soon as the quest finds the Core short of plates.
  - *No hints*: the objectives and the arrow only.
- **Past the tutorial.**
  - Tier 1's research, one node after another on the Core's compute, in the order a player takes them (what the base makes first, the Synthesis last). The lab launches the first that can start. It never buys tokens.
  - The lines that research opens, where the base has room: Mechanics' press, a motor bench off the coil and gear lines, sand into the Core, the brickworks.
  - What a node or the Core's level 3 has lacked for 8 minutes, bought at the Crier as a spot purchase (the trade post's exit leads into the Core), keeping 100 ◉ in the purse.
  - The Core's level 3 once the Synthesis is learnt, two expertises at its Archive, then Tier 2's first nodes.
- **Power.** After « Tenir la nuit », a night whose grid dipped under 100 % makes the player add two turbines the next morning, as soon as the Core can pay. That is someone who reads the energy bar.
- **Waits have caps** (45 game minutes on items, 60 on a quest or a parcel). Past one, the step goes on without it and the run reports a problem.

**What it records**, every 5 seconds (power) and every minute (the rest):

- the minute each quest is met, and the first drill, trade post and sale;
- the Core's levels, the lab, each Tier 1 category finished, the Synthesis, Tier 2 open;
- the purse each minute and its journal by kind (`purseLog`);
- every night's lowest satisfaction, minutes under 100 %, demand and turbines;
- every wait, with its cause and what it was for;
- the Core's stock and what was made, taken into the Core and sold a minute at each hour's end;
- the lab's idle minutes by reason, and what was bought.

**Determinism.** Integers, no clock: the same land, founding minute and content give the same run. A run of three hours takes 2 s.

**Its limits.**

- The builders are the debug bases' layout heuristics. In the bot's crowded tutorial base they sometimes find no room, and the bot buys instead:
  - the brickworks never (it fits on bare land);
  - the press or the motor bench on some lands.
- The bot sells only what the tutorial's lines bring to the trade post (glass, iron ore). It sells none of the Core's surplus quartz or ore.
- It never buys research tokens and never continues the starter contract.
- It builds no extra drills or smelters beyond what the tutorial and its hints name.
- It filters a router's side to what the machine beyond takes (problem 5), which no hint says.

So its income is the tutorial factory's, a floor for a player who expands.

**Re-run it** ([testing.md](testing.md)):

```bash
PACING_OUT=scripts/pacing-now.json npx vitest run src/sim/pacing
```

```bash
node scripts/pacing-report.mjs scripts/pacing-now.json hints
```

The raw runs behind this page are [scripts/pacing-d146.json](../scripts/pacing-d146.json) (`node scripts/pacing-report.mjs` prints its tables). Its four sets are:

- `before-*`: the content at 26f04ca, the same bot;
- `after-*`: D146;
- `*-hints` and `*-nohints`: the two players.

## Milestones by land (game minutes, before → after D146)

A player who asks for hints:

| Milestone | Land 1 | Land 2 | Land 3 |
|---|---:|---:|---:|
| 1 Premier coup de pioche | 0.8 | 0.6 | 0.9 |
| 2 La fonderie · 3 Tenir la nuit | 2.6 | 2.5 | 2.6 |
| 4 La verrerie | 3.8 → **3.9** | 3.8 → **3.9** | 3.9 |
| 5 La vapeur | 5.5 → **4.9** | 5.4 → **4.8** | 5.4 → **4.9** |
| first trade post · first sale | 7 · 8 → **7** | 8 · 9 → **8** | 8 · 8 |
| 6 La Criée · 7 Les scories | 16 → **13** | 17 → **14** | 16 → **14** |
| 8 Le Cœur grandit (Core level 2) | 27.1 → **21.9** | 28.1 → **22.7** | 26.3 → **22.5** |
| research lab placed | 40 → **32** | 41 → **33** | 38 → **33** |
| 9 Le laboratoire | 41.3 → **33.4** | 42.9 → **34.4** | 39.1 → **33.6** |
| 10 Le quartz de la paroi | 46 → **39.3** | 47.2 → **40.4** | 43.2 → **39.1** |
| 11 Les pièces de la Synthèse (tutorial over) | 49.9 → **43.8** | 53.5 → **43.2** | 47 → **42** |
| Tier 1 · Energy | 57 → **50** | 59 → **50** | 54 → **49** |
| Tier 1 · Extraction | 91 → **59** | 91 → **65** | 76 → **61** |
| Tier 1 · Logistics | 104 → **77** | 95 → **81** | 93 → **75** |
| Tier 1 · Commerce | 82 → **101** | 121 → **85** | 72 → **79** |
| Tier 1 · Workshop | 134 → **120** | 134 → **121** | 131 → **113** |
| Tier 1 · Foundry | 138 → **116** | 138 → **125** | 135 → **117** |
| Tier 1 done (the Synthesis) | 160 → **142** | 160 → **148** | 157 → **139** |
| Core level 3 | 180 → **162** | 179 → **169** | 176 → **160** |
| Tier 2 open (two expertises chosen) | — → **163** | 180 → **170** | 177 → **161** |

A player who never asks for a hint:

| Milestone | Land 1 | Land 2 | Land 3 |
|---|---:|---:|---:|
| 8 Le Cœur grandit | 29 → **21** | 30.2 → **21.5** | 27.4 → **21.9** |
| 9 Le laboratoire | 62.9 → **43** | 65 → **43.7** | 58 → **44** |
| 10 Le quartz de la paroi | 71.6 → **54.2** | 73.5 → **55.2** | 65.9 → **55** |
| 11 Les pièces de la Synthèse | 77.6 → **62.9** | 87.7 → **63.1** | 71.6 → **60** |
| Tier 1 done | — → **161** | — | — |

Founded at another hour (D146's content, the hints player): 9 minutes after sunrise (the first night at minute 9), at dusk, or six minutes into the dark. The milestones move by a minute or two.

- A base founded at dusk or in the dark runs its first 5 minutes at 55 % (three drills on the Core's 210 kW night core) until « Tenir la nuit »'s turbine and « La vapeur »'s boiler stand: a mild start.
- Four of those nine runs dip once more, for 1.5–2 minutes at 475–500 ‰, on the night that falls just after the tutorial: the base has put up its press and bench, and the six turbines are a bare margin.

On land 1 founded six minutes into the dark, the contract's line joined the copper line on the bend at the wire mill's door. The first slag stuck there, where no sorter can take it in, and the base made no wire for the rest of the run. See the problems, 5.

## The purse

Every 5 minutes over three hours, the hints player (one bar = 5 minutes, full height = 3 468 ◉):

```
land 1 before ▁▁▁▂▂▂▂▂▃▄▄▄▄▅▅▅▅▅▆▆▆▆▆▇▆▆▇▇▇▆▆▇▇▁▁▁
land 1 after  ▁▁▂▂▂▃▃▃▄▅▄▅▅▅▆▆▆▆▆▇▇▇▇▇█▇▇███▄▃▂▁▁▁
land 2 before ▁▁▁▂▂▂▂▂▃▃▄▄▄▄▄▄▄▄▅▅▅▅▅▅▅▅▅▆▆▅▅▆▆▁▁▁
land 2 after  ▁▁▂▂▂▂▃▃▄▄▅▅▅▅▆▆▆▆▇▇▇▇▇▇▇█▇▇▆▇▇▃▃▂▁▁
land 3 before ▁▁▁▂▂▂▂▃▃▄▄▄▄▄▅▅▅▆▆▆▆▆▇▇▇▇▇█▇▇▇██▃▃▄
land 3 after  ▁▁▂▂▂▂▃▃▄▅▅▅▅▆▆▆▆▇▇▇▇▇███▇███▂▂▃▃▃▃▄
```

The purse climbs to about 3 000 ◉ by the second hour, with almost nothing to spend it on. It falls to a few hundred when the Synthesis and the Core's level 3 ask for parts the base cannot make yet, bought at the Crier.

◉ by hour, after D146 (lands 1–3, the hints player):

| Hour | Sales | Rewards | Parcel | Spot purchases | Change | Purse at its end |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 132–1 165 | 1 150 | −496 to −503 | −98 to −199 | +1 515 to +1 641 | 1 815–1 941 |
| 2 | 1 679–1 817 | 0 | 0 | −465 to −669 | +1 010 to +1 351 | 2 844–3 292 |
| 3 | 1 487–1 561 | 0 | 0 | −3 542 to −4 139 | −1 980 to −2 651 | 243–1 312 |

The no-hints player sells as much (1 095–1 116, 1 812–1 920, 1 561–1 677 ◉) and ends the third hour with 1 190–4 280 ◉: it reaches the Synthesis later or not at all, so it buys less. Before D146 the post sold 680–845, 1 040–1 530 and 740–1 370 ◉ in hours 1, 2 and 3: the glass smelter ran at two thirds, sharing the plates' coal.

## Power, every night

The Core's grid at its lowest (‰) and minutes under 100 %, the hints player. Each cell is « before → after »: lowest · minutes under · demand at dusk · turbines standing.

| Night (from) | Land 1 | Land 2 | Land 3 |
|---|---|---|---|
| 1 (18 min) | 1000 · 0 → **1000 · 0** · 835 kW · 1 t. | 1000 · 0 → **1000 · 0** · 790 kW · 1 t. | 1000 · 0 → **1000 · 0** · 574 kW · 1 t. |
| 2 (54 min) | 750 · 7.1 → **1000 · 0** · 1 156 kW · 6 t. | **275** · 14.3 → **1000 · 0** · 1 222 kW · 6 t. | 800 · 13.8 → **1000 · 0** · 1 180 kW · 6 t. |
| 3 (90 min) | 950 · 0.3 → **1000 · 0** | 450 · 2.5 → **1000 · 0** | 975 · 0.1 → **1000 · 0** |
| 4 (126 min) | 1000 · 0 → **1000 · 0** | 1000 · 0 → **1000 · 0** | 1000 · 0 → **1000 · 0** |
| 5 (162 min) | 1000 · 0 → **1000 · 0** | 1000 · 0 → **1000 · 0** | 1000 · 0 → **1000 · 0** |

- Before D146 the bot's own turbines (two after each dipping night) held nights 4–5. After it, every night holds on all six runs (both players), and the bot never needs to add one.
- The no-hints player's base reached that size later: before D146 it dipped on night 3–4 (325–975 ‰, up to 5.5 minutes).
- By day the grid dips only in the first five minutes, before « La vapeur »'s boiler: 800 ‰ for a minute before D146, 650–675 ‰ for 2.3–2.9 minutes after (the glass smelter's own coal drill draws 90 kW more).

## Dead zones and problems, by how much they hurt a new player

Measured before D146; what changed is in the next section.

1. **The plates run dry for most of the first hour (fixed).**
   - One coal drill on the cirque gives about 13 coal a minute. « La verrerie »'s arrow pointed at a router sharing it between the plate smelter and the glass smelter (10 each at full pace): plates came at 6.5 a minute.
   - That was just before the plate-hungry stretch: the Core's level 2 (120 plates), the 25 plans of « Le laboratoire » (268 plates), the lab, the cutters, the workshop. The player waited 44–50 minutes of the first hour on items, almost all plates, one plan or building at a time.
   - The player who never asks for a hint ended the tutorial at 72–88 minutes: « Le laboratoire » alone took 30 minutes of plate waits. The one who asks read « Le Cœur grandit »'s second-smelter hint and ended at 47–54.
   - Past the tutorial the no-hints player still bought 50–255 plates.
2. **The second night dips hard, unannounced (fixed).**
   - By minute 54 the base draws 1 000–1 260 kW at night: two or three smelters' drills, the lab (150 kW), the face cutters, the workshop, the bench. « Tenir la nuit » was met at minute 2.6 with one turbine, and nothing asks for power again.
   - The grid fell to 275–800 ‰ for 7–14 minutes.
   - Two engine traits make the dip deep (design questions, below):
     - The steam boiler's own coal drill gives 8.75–10 coal a minute for its 8. A brownout slows the drill, the boiler's five-coal box runs dry, and the grid drops to 30 % in pulses.
     - `nightCover` counts a fuel generator at its current dispatch. So by day, with the boiler filling the gap, it reads about 1 − sun ÷ demand whatever the wind adds. It read 92–100 % at that dusk, so the night notice stayed quiet: 100 % on the land that then fell to 275 ‰.
3. **The lab stands idle for Tier 1's new materials** (a design question).
   - From the end of the tutorial to the Synthesis the lab waits 43–53 minutes in all, in stretches of 11–16 minutes:
     - the Steelworks (bricks and copper plates), the Twin Wire Mill (steel), the Synthesis (motors, oscillators, gears);
     - the Brickworks before them (40 sand in the Core: no tutorial line brings sand there);
     - Copper Smelting (20 copper ore in the Core: the vein's ore all goes to the mill).
   - Each wants a line the player has not built, or a purchase.
   - Research time itself is short: Tier 1's 18 nodes take about an hour of the Core's compute.
4. **Copper wire is the Tier 1 cap** (a design question).
   - The tired vein gives 2.5–2.8 copper ore a minute, so 5 wire a minute. The quartz workshop (two wires an oscillator) or the coil bench (two a coil) takes all of it: 2.5 oscillators or 2.5 coils a minute, one or the other.
   - The Core gets no wire after the first hour (0–13 in stock at hours 2–3, against 50–60 before D146's faster tutorial).
   - The Synthesis and the Core's level 3 (40 oscillators, 40 motors of 80 coils) are bought: 40–50 motors on every land and 50–55 oscillators or coils on two.
   - The bot never continues the starter contract (« Arrêter » is the default). At the market price 10 ore a minute would cost about 2 900 ◉ an hour, twice what the base earns.
5. **A mixed line jams a two-input machine** (a tutorial hazard; the bot now avoids it).
   - When the Core's inputs are all taken, the quartz line runs into the wire line's side (the guide's `INTAKE` spot accepts « a ribbon that leads there »). « Les pièces de la Synthèse »'s routers on that line then send the workshop mostly quartz.
   - The workshop's quartz box fills, the branch stops on a quartz, and no wire ever arrives: on the hints player's lands the workshop made no oscillator in three hours.
   - Its hints never mention a router's side filter. The bot sets them (`filterFeed`) as a careful player would; the measurements above are with the filters.
6. **« Les scories »'s hint can be impossible to follow** (a rare tutorial hazard).
   - The hint says to lay the sorter « sur ce dernier ruban », where the slag waits at the mill's door. When that last tile is a bend, a sorter (fed only from behind) cannot take the line in on any of its four turns, and lifting the tile does not free it.
   - The quest is still met (its sorter on the contract's line catches the next slags), but the first slag stays at the door and the copper line stays jammed: no wire, and « Le laboratoire »'s plans wait for good.
   - Seen once in 15 runs: land 1 founded in the dark, the contract's line joining the copper line on that bend.
7. **The Core fills with what nothing uses** (an observation for orders).
   - By hour 3 the Core holds 2 160–3 130 iron ore (the first drill's line, 12–18 a minute), 2 480–2 810 quartz (the face cutters' 20 a minute: the workshop takes 2.5 at most) and 2 000 sand (the bot's own line for the Brickworks' research).
   - The quartz alone is worth about 4 000 ◉ an hour at the Crier: twice the post's sales. Nothing in the game tells the player it is there to sell.
8. **The hour-3 money wall** (an observation).
   - Buying what the Synthesis and the Core's level 3 ask for and the base cannot make costs 4 100–4 940 ◉ over hours 2–3 (3 270–3 820 before D146). That is about three hours of sales, and the purse ends the third hour at 240–1 310 ◉.
   - A player who builds the brickworks, a steel line and a second post's copper instead pays in time rather than ◉.
9. **« Tenir la nuit » teaches little** (by design, D101).
   - At minute 2.6 the base draws about 300 kW. One turbine and the Core's 210 kW night core meet 80 % at once, in the same minute as « La fonderie ».
   - Asking 100 % changes nothing: one turbine still does it. So the quest cannot prepare the second night.

Nothing else was impossible or absurd:

- no grant was asked for, no wait hit its cap, no plan was asked for before the tree offers it, every quest was met on its own;
- the money never waited (the vein's parcel is paid by « Le laboratoire »'s 600 ◉);
- no cost was out of proportion to income.

## What changed (D146)

Two tutorial changes, tuning in the quest table only (content/quests.ts). D143's wind, solar and boiler numbers are untouched, and so is D97's « a drill pair a smelter ».

1. **« La verrerie »'s coal: a drill of its own** (`GLASS_COAL`).
   - Its two hints point at a second coal drill on the cirque's deposit and its ribbon to the glass smelter's other input (the kit's drill: no plan).
   - A router on the coal line still meets the quest, and passes the hints by (`unless`).
   - The router is learnt one quest later: « La Criée » gets a hint for its plan, just before the one that puts a router on the glass line toward the trade post.
   - The plate smelter keeps its whole coal: plates 10 a minute from minute 4, glass 10.
2. **« Le quartz de la paroi »: six turbines on the grid** (`WIND_SIX`, a third objective, « Six éoliennes au réseau »).
   - Two hints: turbines at the Crown's windiest spots, then their wire. The brief says the night is coming and the base already draws more than the Core and the boiler give in the dark.
   - It is a count, not `night`: past « La vapeur » that measure cannot judge a night by day (problem 2).
   - Four turbines left two lands dipping (475–500 ‰ for 3–7 minutes); six hold every night on every run.
   - It costs the quest 1.5–3 minutes and 60 plates, 24 glass and 36 wire.

Before → after:

| | Hints | No hints |
|---|---|---|
| Tutorial over | 47–54 → **42–44 min** | 72–88 → **60–63 min** |
| « Le laboratoire » | 39–43 → **33–34** | 58–65 → **43–44** |
| Waits on items, first hour | 44–45 → **33–39 min** | 50 → **47 min** (the tutorial still fills the hour, 15–25 minutes shorter) |
| The Synthesis (Tier 1 done) | 157–160 → **139–148** | none → land 1 at **161** |
| The Core's level 3 | 176–180 → **160–169** | none |
| Tier 2 open | 177–180 (two lands) → **161–170** | none |
| Second night | 275–800 ‰, 7–14 min under → **1000 ‰** | (dipped on night 3–4: 325–975 ‰) → **1000 ‰** |
| Sales, hours 1 · 2 · 3 (◉) | 743–844 · 1 148–1 527 · 1 162–1 368 → **1 132–1 165 · 1 679–1 817 · 1 487–1 561** | 681–776 · 1 039–1 273 · 736–1 162 → **1 095–1 116 · 1 812–1 920 · 1 561–1 677** |

The debug bases follow the change: the tutorial level puts the quest's six turbines up after its power top-up (scenarios.ts `quartzWind`).

## Numbers for delivery orders and blueprints

After D146, the tutorial's factory alone (a player who expands earns more):

- **◉ an hour.**
  - Sales: about **1 150** in hour 1, **1 750** in hour 2, **1 550** in hour 3 (glass 4–5 a minute and iron ore 6–9 a minute through the post's entrance, a fifth to CrierBelt).
  - The quests pay **1 150 ◉** in all (the last 300 come with the tutorial's end, in hour 2 for the no-hints player), the vein's parcel takes about 500.
  - An order paying 300–600 ◉ is a quarter to a third of an hour's sales: noticeable without dwarfing the base's trade. 1 500 ◉ or more is an event.
- **What flows and piles up** (items a minute at hours 2–3, the hints player):

  | Item | Made | Into the Core | Sold | In the Core at hour 3 |
  |---|---:|---:|---:|---:|
  | iron plate | 16–25 | 15–16 | — | 1 650–1 860 |
  | glass | 10 | 5–6 | 4–5 | 710–800 |
  | iron ore | 34–52 | 12–18 | 6–9 | 2 160–3 130 |
  | quartz | 20 | 17–21 | — | 2 480–2 810 |
  | sand (the bot's line for the Brickworks' research) | 45 | 15 | — | ≈ 2 000 |
  | copper wire | 5–5.5 | 0 past hour 1 | — | 0–13 |
  | oscillator or copper coil (the wire goes to one) | 0–2.7 | 0–2.6 | — | 10–320 |
  | gear (once the press stands) | 0–2.4 | 0–2.5 | — | 0–120 |
  | motor, brick, steel, copper plate | ≈ 0 (bought) | | | |

  The no-hints player makes 10–17 plates a minute and holds 240–830 at hour 3.
- **How long the base can wait for an order.**
  - From its surplus alone: 200 plates in 12–14 minutes, 300 quartz in 15, 100 glass in 20 (what reaches the Core), 200 iron ore in 11–17.
  - Copper wire and Tier 1 parts are slow or bought: no wire is spare once the workshop and the bench run; 20 gears take 10 minutes once the press runs.
  - **Raw goods and plates: 20–40 minutes. Glass: 30–60. Wire and Tier 1 parts: 60–120 or more, or a purchase.** The window should outlast a night (12 dark minutes, 18 with dusk and dawn).
  - Quartz is the natural first order: the base has it in quantity and no use for it.
- **What a blueprint can cost.**
  - At the end of the first hour the Core holds 30–80 plates, 180–190 glass and 60–75 wire. A blueprint priced in materials must stay within what the tutorial lines bring in 10–20 minutes.
  - From hour 2 on, plates pile up (+900 an hour) and glass (+300); wire does not.
  - In ◉, a blueprint of 200–500 is a fair hour-2 purchase. Anything above 1 500 competes with the Synthesis' parts in hour 3.

## Bigger than tuning, for the lead (ranked)

1. **`nightCover` cannot judge a night once a boiler stands.** It reads a fuel generator at its current dispatch, so by day it reads about 1 − sun ÷ demand whatever the wind adds; the night notice and any `night` objective after « La vapeur » are blind (it read 100 % at the dusk of a night that fell to 275 ‰).
   - Suggested: count a fuelled generator at its full output while its fuel holds (box and line).
   - Engine readout: `readouts/night.ts`.
2. **The boiler's death spiral.**
   - Its coal drill slows with the grid. At 900 ‰ it gives less than the boiler's 8 coal a minute, and the boiler's 5-coal box runs dry in under 40 s.
   - Then the grid loses 700 kW and the drill slows further. The grid drops to 30 % in pulses.
   - Options: a larger fuel box (`GeneratorNode.fuelCap`), drills that keep their pace at a slight brownout, or a boiler that slows rather than stops.
3. **Tier 1's material web.** The lab waits 43–53 minutes for bricks, copper plates, steel, motors and oscillators, while sand and copper ore never reach the Core on the tutorial's lines.
   - Options:
     - a hint or a quest past the tutorial naming the brickworks and a copper-plate line;
     - research costs in what the tutorial base makes;
     - the starter contract's copper extended.
4. **Copper.** 5 wire a minute caps oscillators or coils at 2.5 a minute, and leaves the Core no wire. Decide whether Tier 1's copper is meant to be bought (then say so in a quest) or mined (a richer second vein within reach).
5. **Mixed lines into two-input machines.**
   - A router hands a machine whatever its line carries, and the branch stops on the first item the machine has enough of.
   - Options: a router that holds back from a side what that side's machine refuses now; or « Les pièces de la Synthèse »'s hints naming the side filter.
6. **The tutorial's slag on a bend.**
   - The hint's sorter spot can be a bend, where no sorter takes the line in.
   - Options: let a sorter laid over a bend take its line in from the side it comes from, or have the hint ask for « le dernier ruban droit ».
7. **The Core's surplus** (2 000–3 000 each of ore, quartz and sand by hour 3): auto-sell is Tier 2. A first quest or delivery order that sells it would show the player its value.
