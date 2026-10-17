# The tech tree's design

What the unlock tree holds and the rules it keeps. The tables are in [src/content/research.ts](../src/content/research.ts) ([content.md](content.md#the-unlock-tree--plans-and-research-d33): fields, helpers, how to add a node), the engine's side (projects, the allowance, tokens) in [engine.md](engine.md#research), the screen in [ui.md](ui.md#the-tech-tree-screen). Decisions: D33 (one tree), D41 (plan paths), D68–D72 (research), D93 (expertises), D101 (the tutorial's pacing), D105 (no tokens before servers), D106 (the electric smelter), D107 (this shape).

## The arc

1. **Plans** (instant, paid from the Heart): six paths of one theme each — production, logistics, energy, analytics, trade, survey. The tutorial offers them a few at a time (D101).
2. **The research lab's plan** (the gate, D71): every plan first.
3. **Tier 1**, completed whole: its last node, the **Synthesis**, needs every other Tier 1 node and gives the Core's level 3, whose Archive opens the **expertises** (D93).
4. **Tier 2** waits for the Synthesis and two expertises chosen. **Tier 3** opens with Atlas Lore (`tr6`), **Tier 4** with Codex Lore (`tr8`): the trunk's gates stand in the tier before the one they open.

Each research family carries on a plan path's theme, deeper: production → **Machines**, logistics → **Logistique**, energy → **Énergie**, analytics → **Analytique**, trade → **Commerce**, survey → **Extraction**. The same name on both sides is the same theme.

## Time and data by tier (D107)

Short early, long late (owner, 2026-10-17: « c'est au T3-4 qu'on commence à avoir de la recherche vraiment longue »). `DEPTH_COST`, by a family node's depth:

| Tier | Depth | Minimum time | Survey Data | Other data (share) | AI tokens |
|---|---|---|---|---|---|
| 1 | 1 · 2 | 1 min · 3 min | 6 · 20 | — | 10 k · 30 k, free before the servers (D105) |
| 2 | 3 · 4 | 8 min · 20 min | 90 · 240 | Mechanics Data ⅓ | 100 k · 300 k |
| 3 | 5 · 6 | 1 h · 3 h | 960 · 1 920 | + atlases 1/12 | 600 k · 1,2 M |
| 4 | 7 · 9 ★ | 8 h · 1 day | 2 880 · 5 760 | + codices 1/40 | 2 M · 6 M |

The data follows the time, so a lab is neither starved nor flooded: about 6 Survey Data a minute at Tier 1 (the Core's 3 and a collector or two), 11–12 at Tier 2, 11–16 at Tier 3, 4–6 at Tier 4. The trunk is explicit: Mechanics 1 min, the Synthesis 3, Earthworks and Ceramics 8, Land Registry and the Second Desk 20, Atlas Lore 30, the Third Desk 3 h, Codex Lore 6 h. An expertise in place takes 15–35 % off its family's time, tokens or data (D93); on research this long it matters from Tier 3.

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
| Logistique: Manutention · Portée | Swift Ribbon → Great Silo → Fences and Glazed Ribbons | Long Bridges → Reinforced Pylons (+ Land Registry) | Transport: Distributors → Express Ribbon → Great Skydock ★ · Claims: Parcel Resale → Neighbour Treaties → Far Claim ★ |

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
    - **bought** at the Crier: a market depth, a sister colony that supplies it, and a trade post the base can build.
  - What only some maps hold counts only as **bought**: the T3 and T4 uniques, and a cliff face's quartz (maps 1–2 have no vein).
  - When the rule fails, fix it by moving the node (a prerequisite, `also`), listing the item at the Crier (`COLONY_PROFILES`), or changing the recipe.
- **Every node unlocks something**, a building, a recipe or a feature, never a bare percentage (D70). At most three recipes per machine (D70).
- **Data in time** (D71): a plan costs only what the plans let a base make; a research node only what its prerequisites and the plans let it make. So Tier 2's Mechanics Data needs the test bench (Mechanics), and Tier 3's atlases need Atlas Lore before them.
- **The arc** (D93): the Synthesis needs every other Tier 1 node; each family node needs its tier's gate; a speciality starts at Tier 3. Tier 2 also waits for two expertises. That is the engine's `researchBlock` → `expertise`, not a prerequisite.
- **No reconversion** (D107: « retire le bouton reconvert de l'arbre »): what a claim learns stays learnt. The tree has no « Reconvertir » and nothing starts one; a save's reconversion under way (`respec:<family>`) still runs out and pays its archive notes.
- **Saves**: a node keeps its id when it moves, so `sim.done` holds ids. A node removed or renamed needs a line in [retired.ts](../src/content/retired.ts). When older claims must hold a node to keep what they had, add a save step: D93's Synthesis, D106's Electric Smelting, D107's Tier 1 newcomers (`tierOneWhole`). Running projects keep the cost they started at.

## Changing the tree

- Retime by `DEPTH_COST` (families) or a trunk node's own numbers. `validate.test.ts` checks each tier's time band.
- A new node: see [content.md](content.md#add-a-research-node-or-an-effect). Run `npx vitest run src/content src/sim/research src/persist src/ui/screens/tree-layout.test.ts`. The debug bases' research lists live in [scenarios.ts](../src/sim/scenarios.ts) (`GROWN_RESEARCH`, `GROWN_NEXT`, `LATE_RESEARCH`); the scenario tests check D85's never-idle lines.
- Look at it: `node scripts/tree-shots.mjs` (with `URL=` for a frozen build, `TAG=` and `OUT=`) takes the whole tree and hovered chains at 1440 × 900 and on a tablet.
