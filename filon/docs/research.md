# The tech tree's design

What the unlock tree holds and the rules it keeps. The tables are in [src/content/research.ts](../src/content/research.ts) ([content.md](content.md#the-unlock-tree--plans-and-research-d33): fields, helpers, how to add a node), the engine's side (projects, the token flow) in [engine.md](engine.md#research), the screen in [ui.md](ui.md#the-tech-tree-screen). Decisions: D33 (one tree), D41 (plan paths), D68–D72 (research), D93 (expertises), D101 (the tutorial's pacing), D106 (the electric smelter), D107 (this shape), D118 (tiers by the Core's level, tokens a flow — it replaced D105's free tokens before the servers), D122 (no data: tokens at every tier and resources paid at launch, the Core's compute).

## The arc

1. **Plans** (instant, paid from the Heart): five paths of one theme each — production, logistics, energy, analytics, trade (the survey path went with the survey beacon, D117: the Face Cutter is Production's). The tutorial offers them a few at a time (D101).
2. **The research lab's plan** (the gate, D71): every plan first.
3. **Tier 1**, completed whole: its last node, the **Synthesis**, needs every other Tier 1 node and makes the Core's level 3 possible, whose Archive opens the **expertises** (D93).
4. **Each tier waits for the Core's level** (D118, `BAL.tierCoreLevel`): **Tier 2** at level 3 (and two expertises chosen, D93), **Tier 3** at level 4, **Tier 4** at level 5. Each level is the player's own upgrade, paid in items (`BAL.hearthUpgrades`, the Core's card), behind the trunk node that closes the tier before: the Synthesis (`tr_synth`) for level 3, Optics (`tr6`) for 4, Resonance (`tr8`) for 5. The trunk's gates stand in the tier before the one they open; a tier's nodes are its trunk's too. A tier where an older claim already holds a node stays open to it (`tierCoreOpen`).

Each research family carries on a plan path's theme, deeper: production → **Machines**, logistics → **Logistique**, energy → **Énergie**, analytics → **Analytique**, trade → **Commerce** (**Extraction** carried on the survey path's, gone with the survey beacon, D117). The same name on both sides is the same theme.

## Tokens, resources and pace by tier (D107, D118, D122)

Research takes no data any more (D122; owner, 2026-10-17: « On va enlever le principe de la data. Le laboratoire n'a plus besoin d'entrée, et on n'a plus besoin de générer de la data. La monnaie pour débloquer les recherches sera uniquement les tokens, et des fois on aura besoin de certaines ressources qui font sens »). A node costs two things:

- **AI tokens, at every tier**, delivered as a flow (below): its only currency.
- **Resources**, one to three kinds, paid from the Core's stock **when it is launched**, as a plan is (`ResearchDef.cost`, the `res` of `node()` / `trunk()`), under CrierBelt's restart reserve (D36). They are picked per node so they hint at what it unlocks: Mechanics plates and copper wire, the Electric Smelting copper wire and plates, the Server Room circuits and oscillators (its clocks), Tier 2 gears, circuits, oscillators, servomotors and ceramic, Tier 3 lenses and thermal cores, Tier 4 resonators, nacre lattices and robot arms (D123 swapped some for its steel, bricks, pipes, cables and copper plates). A cancel hands them back.

There is no minimum time (D118). A node ends at the minute its tokens are in. The pace (`minutes`) is only what the launch dialog aims its default flow at: short early, long late (owner, 2026-10-17: « c'est au T3-4 qu'on commence à avoir de la recherche vraiment longue »). `DEPTH_COST`, by a family node's depth:

| Tier | Depth | AI tokens | Pace (the dialog's aim) | Its resources, as a rule |
|---|---|---|---|---|
| 1 | 1 · 2 | 2 000 · 5 000 | 2 min · 5 min | 20–60 plates, glass, copper wire; a few circuits, oscillators |
| 2 | 3 · 4 | 100 k · 300 k | 8 min · 20 min | 20–100 gears, circuits, oscillators, ceramic; a few servomotors |
| 3 | 5 · 6 | 600 k · 1,2 M | 1 h · 3 h | 10–30 lenses or thermal cores, with gears, circuits or ceramic |
| 4 | 7 · 9 ★ | 2 M · 6 M | 8 h · 1 day | 5–15 resonators or nacre lattices, with lenses or thermal cores |

The trunk is explicit: Mechanics 2 000 tokens, the Synthesis 10 000 (10 min), Earthworks 15 000 and Ceramics 60 000 (8 min), Land Registry and the Second Desk 20 min, Optics (`tr6`, Atlas Lore until D122) 30 min, the Third Desk 3 h, Resonance (`tr8`, Codex Lore until D122) 6 h. **Tier 1 runs on the Core's compute alone**, its 1 000 tokens a minute from level 2: a node in two to five minutes, all of Tier 1 in about an hour; a bought flow (10 ◉ the thousand, a Tier 1 node 20–50 ◉) or Overclocking (`an_data`, +500) go faster. At 10 ◉ the thousand a depth-3 node's tokens cost 1 000 ◉ whatever the flow: a faster flow pays the same sooner, and only the free flows (the Core's compute, the servers) cost nothing — two servers and a level-3 Core with Overclocking (6 000 a minute) carry a depth-3 node in 17 minutes alone. An expertise in place takes 15–35 % off its family's tokens (research « time » and tokens) or resources (D93, D122); on research this long it matters from Tier 3.

### The Core's compute (D122)

From its level 2 the Core gives research a steady token flow, its **compute** (« calcul du Cœur »): `BAL.coreCompute` 1 000, 1 500, 2 000, 3 000 tokens a minute at levels 2–5 (none at level 1), plus Overclocking (`an_data`, +500) and Data Mining (`an_mining`, +2 000), × Archiving (D93: `tokenRate`). It needs no power and no ribbon: `Sim.coreComputeRate()` is read at each minute's end. Level 2 mounts its **compute bay** on the south-east corner, where the data outlet stood (D86; `HeartPiece` `'compute'`). The **autonomous lab** (`an_autolab`) also computes, 5 000 tokens a minute like a server, project or not.

### The token flow (D118, D122)

- **Delivered at each minute's end** (`tokenEpoch`) to the projects **whose lab had power during the minute** (`Project.lit`), **in the order they started** (the oldest first, each to its need):
  1. the free pool: the Core's compute, then the servers' output of the minute — what nobody needs is lost, the servers' share rented back with Server Rental;
  2. the **bank** (`Sim.tokenBank`): tokens an older save's data was turned into (D122, persistence.md), never refilled;
  3. each project's **bought flow** (`buy`, tokens a minute), at most what it still needs, so the flow stops by itself once the project has its tokens.
  A project with its tokens in is done at that boundary.
- **Launching any node** opens the launch dialog (D122: every tier): its resources from the Core (have / need), the tokens it needs, the free flows it would get (and the bank's), a slider over the flow ladder (`BAL.tokenFlow`: 0, 500, 750, 1 000, 1 500, 2 000, 3 000, 5 000…), the cost a minute and the expected end. The default (`tokenBuyDefault`): its tokens over its pace, less the free rate it would get now (all of it unless a running project still takes it), up the ladder — 0 at Tier 1, where the Core's compute suffices. A running project's flow can be changed in the tree (`tokenBuy`). A queued start (the Research Queue) buys nothing; it waits for its resources and starts at a project's end or at the minute's end they are in.
- **A purse in the red holds the bought flows** (`researchHeld`, a toast, an absence incident) until it is back above zero; the free flows and the bank go on. Launching with a bought flow needs the purse out of the red (`debt`); the free flows need no purse.
- **The Compute Plan** (half price for a fee an hour) and **Server Rental** (CrierBelt buys the servers' unused tokens back at half price) stay: both still act on the flow.

## The families

Each family is one lineage through Tiers 1–2, then (but Commerce) two specialities from Tier 3. A node's prerequisites are the node before it, its tier's gate and, written `+`, what it acts on from another lane.

| Family | Tier 1 | Tier 2 | Tiers 3–4 |
|---|---|---|---|
| Fondations (trunk) | Mechanics (press, gears) → **Synthesis** | Earthworks (excavator) · Ceramics → Land Registry → Second Desk · Optics | Third Desk · Resonance |
| Énergie: Production d'électricité · Réseau électrique | Pitch-Control Turbine → Solar Panels | Heavy Accumulator → Battery Charging | Renewables: Solar Farm → Great Turbine → Solar Tower ★ · Power Plants: Geothermal → Battery Generator → Sunheart ★ |
| Extraction: Extraction · Carrière | Fast Drill → Brickworks (D123) | Sifter (+ Earthworks) → Backfill → Basalt Bits | Drilling: Deep Bore → High-Pressure Pump → Giant Drill ★ · Excavation: Heartrock Cutters → Heavy Excavator → Deep Fill ★ |
| Machines: Métallurgie · Automatisation | Copper Smelting (D123) → Compact Smelter → Steelworks (D123; + Mechanics, + Brickworks) → Electric Smelting (and copper plates on power) → Twin Wire Mill (and cable) | Servomotors → Compact Assembly (+ Ceramics) | Electronics: Etcher → Robotics → Chip Fab ★ · Mechanics: Forging Press → Arc Furnace → Assembly Tower ★ |
| Commerce: Échange · Finance · Économie de marché | Second Post → Floor Prices | Standing Orders → Compute Plan (+ Server Room) → Server Rental | Wider Wharf → Express Freight → Grand Post → The Crier House ★ |
| Analytique: Traitement · Serveurs | Overclocking (the Core's compute +500; the data collector and the Data Relay until D122) | Server Room → Research Queue | Computing: Cooled Server → Shared Computing → Supercomputer ★ · Data Mining: Data Mining (the Core's compute +2 000) → Price Forecast → Autonomous Lab (a lab that computes) ★ |
| Logistique: Manutention · Portée | Swift Ribbon → Great Silo → Fences and Glazed Ribbons | Camouflaged Ribbon (D109) → Long Bridges → Reinforced Pylons (+ Land Registry) | Transport: Distributors → Express Ribbon (no keystone: the Great Skydock went with the skydocks, [D108](decisions.md)) · Claims: Neighbour Treaties (after Reinforced Pylons); Far Claim sits in Tier 2 after the Camouflaged Ribbon, D119 |

## The rules (validated)

`validateContent` ([validate.ts](../src/content/validate.ts)) fails the build on any of these; [validate.test.ts](../src/content/validate.test.ts) pins them.

- **Nothing unusable** (D107, [usable.ts](../src/content/usable.ts)). Whatever a node unlocks works with what the base can have by then, in the order the tree imposes: a plan knows its prerequisites; a research node knows every plan and its own prerequisites, the tier gates included.
  - A building can be paid for, with usable items or the starting stock. A crafting machine runs at least one recipe. A generator's fuel is usable.
  - A recipe's inputs are usable, and one of its machines can be built.
  - A Heart level is payable.
  - A feature has what it acts on (`FEATURE_NEEDS`): the excavator for the digging bits, a server for the token plans, the pylon for its reach, a trade post for the Crier's features, a lab for research slots and the queue.
  - **Usable** means one of:
    - **extracted** by a machine known: the land's common deposits, the ground's sand, water, stone;
    - **made** by a known recipe on a buildable machine, from usable inputs;
    - **bought** at the Crier: a market depth, a colony that supplies it, and a trade post the base can build.
  - What only some maps hold counts only as **bought**: the T3 and T4 uniques, and a cliff face's quartz (maps 1–2 have no vein).
  - When the rule fails, fix it by moving the node (a prerequisite, `also`), listing the item at the Crier (`COLONY_PROFILES`), or changing the recipe.
- **Every node unlocks something**, a building, a recipe or a feature, never a bare percentage (D70). At most three recipes per machine (D70).
- **Resources in time** (D71, D122): a plan costs only what the plans let a base make; a research node's resources only what its prerequisites and the plans let it make (`makeableWith`: gears after Mechanics' press, ceramic after Ceramics, lenses after Optics), and they can be had before it (`usable.ts`: extracted, made or bought). One to three kinds, whole (validate.test.ts).
- **The arc** (D93): the Synthesis needs every other Tier 1 node; each family node needs its tier's gate; a speciality starts at Tier 3. Tier 2 also waits for two expertises. That is the engine's `researchBlock` → `expertise`, not a prerequisite.
- **Tokens and the Core's levels** (D118, D122): every node takes tokens and a pace, a Tier 1 node at most 10 000 (the Core's compute runs it in minutes); `BAL.tierCoreLevel` rises tier by tier, each level exists (`BAL.hearthUpgrades`) and comes with the tier's gate (level 3 with the Synthesis, 4 with Optics, 5 with Resonance), and Tier 2's level is the Archive's (`BAL.expertise.level`). That is `researchBlock` → `core`, not a prerequisite.
- **No reconversion** (D107: « retire le bouton reconvert de l'arbre »): what a claim learns stays learnt. The tree has no « Reconvertir » and nothing starts one; a save's reconversion under way (`respec:<family>`) still runs out and pays its archive notes.
- **Saves**: a node keeps its id when it moves, so `sim.done` holds ids. A node removed or renamed needs a line in [retired.ts](../src/content/retired.ts). When older claims must hold a node to keep what they had, add a save step: D93's Synthesis, D106's Electric Smelting, D107's Tier 1 newcomers (`tierOneWhole`). Running projects keep the cost they started at. Save 18 (D118, `researchFlows`): a project under way loses its minimum time, a Tier 1 one its tokens, a Tier 2+ one counts the tokens it had used as delivered. Save 19 (D122, `dataRetired`): a project's paid data counts as tokens delivered (a Tier 1 one needs Tier 1's tokens now; the excess is banked), it owes no resources; the Data Relay (`an_relay`) is forgotten; the data held anywhere is banked as tokens by the remap ([persistence.md](persistence.md)).

## Changing the tree

- Repace by `DEPTH_COST` (families) or a trunk node's own numbers (`tokens`, `minutes`: the launch dialog's aim); retune a node's resources in its `res` (validation says when the base cannot make them before it). `validate.test.ts` checks each tier's band, Tier 1's tokens against the Core's compute, and the resources' shape.
- A new node: see [content.md](content.md#add-a-research-node-or-an-effect). Run `npx vitest run src/content src/sim/research src/persist src/ui/screens/tree-layout.test.ts`. The debug bases' research lists live in [scenarios.ts](../src/sim/scenarios.ts) (`GROWN_RESEARCH`, `GROWN_NEXT`, `LATE_RESEARCH`, `SURVEY_PROJECT`, `ADVANCED_PROJECT`; `Builder.affordNode` grants a node's resources); the scenario tests check D85's never-idle lines.
- Look at it: `node scripts/tree-shots.mjs` (with `URL=` for a frozen build, `TAG=` and `OUT=`) takes the whole tree, focused chains and the zoom at 1440 × 900 and on a tablet.
