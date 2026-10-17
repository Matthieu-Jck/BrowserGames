# The tech tree's design

What the unlock tree holds and the rules it keeps. The tables are in [src/content/research.ts](../src/content/research.ts) ([content.md](content.md#the-unlock-tree--plans-and-research-d33): fields, helpers, how to add a node), the engine's side (projects, the token flow) in [engine.md](engine.md#research), the screen in [ui.md](ui.md#the-tech-tree-screen). Decisions: D33 (one tree), D41 (plan paths), D68–D72 (research), D93 (expertises), D101 (the tutorial's pacing), D106 (the electric smelter), D107 (this shape), D118 (tiers by the Core's level, Tier 1 on data alone, tokens a flow — it replaced D105's free tokens before the servers).

## The arc

1. **Plans** (instant, paid from the Heart): five paths of one theme each — production, logistics, energy, analytics, trade (the survey path went with the survey beacon, D117: the Face Cutter is Production's). The tutorial offers them a few at a time (D101).
2. **The research lab's plan** (the gate, D71): every plan first.
3. **Tier 1**, completed whole: its last node, the **Synthesis**, needs every other Tier 1 node and makes the Core's level 3 possible, whose Archive opens the **expertises** (D93).
4. **Each tier waits for the Core's level** (D118, `BAL.tierCoreLevel`): **Tier 2** at level 3 (and two expertises chosen, D93), **Tier 3** at level 4, **Tier 4** at level 5. Each level is the player's own upgrade, paid in items (`BAL.hearthUpgrades`, the Core's card), behind the trunk node that closes the tier before: the Synthesis (`tr_synth`) for level 3, Atlas Lore (`tr6`) for 4, Codex Lore (`tr8`) for 5. The trunk's gates stand in the tier before the one they open; a tier's nodes are its trunk's too. A tier where an older claim already holds a node stays open to it (`tierCoreOpen`).

Each research family carries on a plan path's theme, deeper: production → **Machines**, logistics → **Logistique**, energy → **Énergie**, analytics → **Analytique**, trade → **Commerce** (**Extraction** carried on the survey path's, gone with the survey beacon, D117). The same name on both sides is the same theme.

## Data, tokens and pace by tier (D107, D118)

No research has a minimum time any more (D118; owner, 2026-10-17: « le temps pour débloquer la recherche dépend uniquement du temps pour acheminer la data au labo, et pour avoir le nombre de tokens requis »). **Tier 1 takes data alone**: a node is done as soon as its data is in the lab, and tokens are never mentioned. **From Tier 2** a node also needs a number of AI tokens, delivered as a flow — the claim's servers' output, then a flow bought from CrierBelt when the player launches it (the launch dialog). The pace (`minutes`) is what that dialog aims its default flow at: short early, long late (owner, 2026-10-17: « c'est au T3-4 qu'on commence à avoir de la recherche vraiment longue »). `DEPTH_COST`, by a family node's depth:

| Tier | Depth | Pace (the dialog's aim) | Survey Data | Other data (share) | AI tokens |
|---|---|---|---|---|---|
| 1 | 1 · 2 | — | 6 · 20 | — | — |
| 2 | 3 · 4 | 8 min · 20 min | 90 · 240 | Mechanics Data ⅓ | 100 k · 300 k |
| 3 | 5 · 6 | 1 h · 3 h | 960 · 1 920 | + atlases 1/12 | 600 k · 1,2 M |
| 4 | 7 · 9 ★ | 8 h · 1 day | 2 880 · 5 760 | + codices 1/40 | 2 M · 6 M |

The data follows the pace, so a lab is neither starved nor flooded: about 6 Survey Data a minute at Tier 1 (the Core's 3 and a collector or two: Mechanics' 6 files in a minute or two), 11–12 at Tier 2, 11–16 at Tier 3, 4–6 at Tier 4. The trunk is explicit: Mechanics and the Synthesis data alone, Earthworks and Ceramics 8 minutes, Land Registry and the Second Desk 20, Atlas Lore 30, the Third Desk 3 h, Codex Lore 6 h. At 10 ◉ the thousand (CrierBelt, half with the Compute Plan), a depth-3 node's tokens cost 1 000 ◉ whatever the flow: a faster flow pays the same sooner, and only the servers' share is free — two servers (4 000 a minute) carry a depth-3 node in 25 minutes alone. An expertise in place takes 15–35 % off its family's tokens or data — one of research « time » off both, since the time follows them (D93, D118); on research this long it matters from Tier 3.

### The token flow (D118)

- **Delivered at each minute's end** (`tokenEpoch`): the servers' output of the minute to the projects that need tokens, **in the order they started** (the oldest first, each to its need; what nobody needs is lost, or rented back with Server Rental), then each project's **bought flow** (`buy`, tokens a minute) tops it up — at most what it still needs, so the flow stops by itself once the project has its tokens. A project with its data in and its tokens in is done at that boundary.
- **Launching a Tier 2+ node** opens the launch dialog: the tokens it needs, the servers' current flow and the share it would get, a slider over the flow ladder (`BAL.tokenFlow`: 0, 500, 750, 1 000, 1 500, 2 000, 3 000, 5 000…), the cost a minute and the expected time (its data at the base's production, its tokens at these flows). The default (`tokenBuyDefault`): its tokens over its pace, less the servers' rate it would get now (all of it unless a running project still takes it), up the ladder. A running project's flow can be changed in the tree (`tokenBuy`). A queued start (the Research Queue) buys nothing.
- **A purse in the red holds the bought flows** (`researchHeld`, a toast, an absence incident) until it is back above zero; data and the servers' tokens go on. Starting a Tier 2+ node needs the purse out of the red (`debt`); Tier 1 never costs a coin.
- **The Compute Plan** (half price for a fee an hour) and **Server Rental** (CrierBelt buys the servers' unused tokens back at half price) stay: both still act on the flow.

## The families

Each family is one lineage through Tiers 1–2, then (but Commerce) two specialities from Tier 3. A node's prerequisites are the node before it, its tier's gate and, written `+`, what it acts on from another lane.

| Family | Tier 1 | Tier 2 | Tiers 3–4 |
|---|---|---|---|
| Fondations (trunk) | Mechanics (press, gears, test bench) → **Synthesis** | Earthworks (excavator) · Ceramics → Land Registry → Second Desk · Atlas Lore | Third Desk · Codex Lore |
| Énergie: Production d'électricité · Réseau électrique | Pitch-Control Turbine → Solar Panels | Heavy Accumulator → Battery Charging | Renewables: Solar Farm → Great Turbine → Solar Tower ★ · Power Plants: Geothermal → Battery Generator → Sunheart ★ |
| Extraction: Extraction · Carrière | Fast Drill | Sifter (+ Earthworks) → Backfill → Basalt Bits | Drilling: Deep Bore → High-Pressure Pump → Giant Drill ★ · Excavation: Heartrock Cutters → Heavy Excavator → Deep Fill ★ |
| Machines: Métallurgie · Automatisation | Compact Smelter → Electric Smelting → Twin Wire Mill | Servomotors → Compact Assembly (+ Ceramics) | Electronics: Etcher → Robotics → Chip Fab ★ · Mechanics: Forging Press → Arc Furnace → Assembly Tower ★ |
| Commerce: Échange · Finance · Économie de marché | Second Post → Floor Prices | Standing Orders → Compute Plan (+ Server Room) → Server Rental | Wider Wharf → Express Freight → Grand Post → The Crier House ★ |
| Analytique: Données · Serveurs | Data Processing (data collector) → Data Relay | Server Room → Research Queue | Computing: Cooled Server → Shared Computing → Supercomputer ★ · Data Mining: Data Mining → Price Forecast → Autonomous Lab ★ |
| Logistique: Manutention · Portée | Swift Ribbon → Great Silo → Fences and Glazed Ribbons | Camouflaged Ribbon (D109) → Long Bridges → Reinforced Pylons (+ Land Registry) | Transport: Distributors → Express Ribbon (no keystone: the Great Skydock went with the skydocks, [D108](decisions.md)) · Claims: Neighbour Treaties (after Reinforced Pylons); Far Claim sits in Tier 2 after the Camouflaged Ribbon, D119 |

## The rules (validated)

`validateContent` ([validate.ts](../src/content/validate.ts)) fails the build on any of these; [validate.test.ts](../src/content/validate.test.ts) pins them.

- **Nothing unusable** (D107, [usable.ts](../src/content/usable.ts)). Whatever a node unlocks works with what the base can have by then, in the order the tree imposes: a plan knows its prerequisites; a research node knows every plan and its own prerequisites, the tier gates included.
  - A building can be paid for, with usable items or the starting stock. A crafting machine runs at least one recipe. A generator's fuel is usable.
  - A recipe's inputs are usable, and one of its machines can be built.
  - A Heart level is payable.
  - A feature has what it acts on (`FEATURE_NEEDS`): the excavator for the digging bits, a server for the token plans, the pylon for its reach, a trade post for the Crier's features, a lab for research slots and the queue.
  - **Usable** means one of:
    - **extracted** by a machine known: the land's common deposits, the ground's sand, water, stone, the Core's own Survey Data;
    - **made** by a known recipe on a buildable machine, from usable inputs;
    - **bought** at the Crier: a market depth, a colony that supplies it, and a trade post the base can build.
  - What only some maps hold counts only as **bought**: the T3 and T4 uniques, and a cliff face's quartz (maps 1–2 have no vein).
  - When the rule fails, fix it by moving the node (a prerequisite, `also`), listing the item at the Crier (`COLONY_PROFILES`), or changing the recipe.
- **Every node unlocks something**, a building, a recipe or a feature, never a bare percentage (D70). At most three recipes per machine (D70).
- **Data in time** (D71): a plan costs only what the plans let a base make; a research node only what its prerequisites and the plans let it make. So Tier 2's Mechanics Data needs the test bench (Mechanics), and Tier 3's atlases need Atlas Lore before them.
- **The arc** (D93): the Synthesis needs every other Tier 1 node; each family node needs its tier's gate; a speciality starts at Tier 3. Tier 2 also waits for two expertises. That is the engine's `researchBlock` → `expertise`, not a prerequisite.
- **The Core's levels** (D118): Tier 1 has no tokens and no pace, every node of Tier 2 and up both; `BAL.tierCoreLevel` rises tier by tier, each level exists (`BAL.hearthUpgrades`) and comes with the tier's gate (level 3 with the Synthesis, 4 with Atlas Lore, 5 with Codex Lore), and Tier 2's level is the Archive's (`BAL.expertise.level`). That is `researchBlock` → `core`, not a prerequisite.
- **No reconversion** (D107: « retire le bouton reconvert de l'arbre »): what a claim learns stays learnt. The tree has no « Reconvertir » and nothing starts one; a save's reconversion under way (`respec:<family>`) still runs out and pays its archive notes.
- **Saves**: a node keeps its id when it moves, so `sim.done` holds ids. A node removed or renamed needs a line in [retired.ts](../src/content/retired.ts). When older claims must hold a node to keep what they had, add a save step: D93's Synthesis, D106's Electric Smelting, D107's Tier 1 newcomers (`tierOneWhole`). Running projects keep the cost they started at. Save 18 (D118, `researchFlows`): a project under way loses its minimum time, a Tier 1 one its tokens (it finishes once its data is paid), a Tier 2+ one counts the tokens it had used as delivered.

## Changing the tree

- Repace by `DEPTH_COST` (families) or a trunk node's own numbers (`minutes`: the launch dialog's aim; Tier 1 none). `validate.test.ts` checks each tier's band, and that Tier 1 alone takes no tokens.
- A new node: see [content.md](content.md#add-a-research-node-or-an-effect). Run `npx vitest run src/content src/sim/research src/persist src/ui/screens/tree-layout.test.ts`. The debug bases' research lists live in [scenarios.ts](../src/sim/scenarios.ts) (`GROWN_RESEARCH`, `GROWN_NEXT`, `LATE_RESEARCH`); the scenario tests check D85's never-idle lines.
- Look at it: `node scripts/tree-shots.mjs` (with `URL=` for a frozen build, `TAG=` and `OUT=`) takes the whole tree, focused chains and the zoom at 1440 × 900 and on a tablet.
