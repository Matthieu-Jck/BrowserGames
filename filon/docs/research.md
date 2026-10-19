# The tech tree's design

What the unlock tree holds and the rules it keeps. The tables are in [src/content/research.ts](../src/content/research.ts) ([content.md](content.md#the-unlock-tree--plans-and-research-d33): fields, helpers, how to add a node), the engine's side (projects, the token flow) in [engine.md](engine.md#research), the screen in [ui.md](ui.md#the-tech-tree-screen) (since D144 a swimlane matrix: the themes' lanes, the tiers' columns behind walls locked by the Core's level). Decisions: D33 (one tree), D41 (plan paths), D68–D72 (research), D93 (expertises), D101 (the tutorial's pacing), D106 (the electric smelter), D107 (the families' shape until D128), D118 (tiers by the Core's level, tokens a flow — it replaced D105's free tokens before the servers), D122 (no data: tokens at every tier and resources paid at launch, the Core's compute), D128 (each tier its own categories, gated by those of the tier before; the launch dialog told around where the tokens come from).

## The arc

1. **Plans** (instant, paid from the Heart): five paths of one theme each — production, logistics, energy, analytics, trade (the survey path went with the survey beacon, D117: the Face Cutter is Production's). Energy is the wind turbine, then Steam Power (the boiler, the pump, the conduit): the coal generator's plan between them went with the coal generator (D143; save v22 refunds it to a claim that held it). The tutorial offers them a few at a time (D101).
2. **The research lab's plan** (the gate, D71): every plan first.
3. **Tier 1**: its seven categories open with the lab. Its **Synthesis** (Core Compute's last node) makes the Core's level 3 possible, whose Archive opens the **expertises** (D93). Since D128 it needs what that level is paid in — the Workshop (the press, the quartz workshop, the twin wire mill), the Steelworks and their chain, Overclocking — no longer Tier 1 whole: the rest of Tier 1 is what Tier 2's categories wait for.
4. **Each tier waits for the Core's level** (D118, `BAL.tierCoreLevel`): **Tier 2** at level 3 (and two expertises chosen, D93), **Tier 3** at level 4, **Tier 4** at level 5. Each level is the player's own upgrade, paid in items (`BAL.hearthUpgrades`, the Core's card), behind a node of the tier before (`TIER_GATE`): the Synthesis (`tr_synth`) for level 3, Optics (`tr6`, Ceramics and Optics) for 4, Resonance (`tr8`, Electronics) for 5. A tier where an older claim already holds a node stays open to it (`tierCoreOpen`).
5. **Each category waits for its gates** (D128): the categories of the tier before it builds on, finished — every node of them learnt. Usually one (Commerce → Finance), sometimes two (Foundry and Workshop → Automation; Automation and Ceramics and Optics → Heavy Engineering); Tier 1's none.

**Categories and themes** (D128). Each tier has its own categories, named after what a base focused on them does (owner, 2026-10-18: « en fonction de l'objectif global de ce que serait une usine focalisée sur tel ou tel type de machine »). Each carries one of six **themes** — the families' ids of D69, kept: Énergie `en`, Extraction `ex`, Machines `dn`, Commerce `cm`, Analytique `an`, Logistique `xp` — its colour on the tree, and what an expertise of that theme improves (D93). A theme carries on a plan path's, deeper: production → Machines, logistics → Logistique, energy → Énergie, analytics → Analytique, trade → Commerce.

## Tokens, resources and pace by tier (D107, D118, D122)

Research takes no data any more (D122; owner, 2026-10-17: « On va enlever le principe de la data. Le laboratoire n'a plus besoin d'entrée, et on n'a plus besoin de générer de la data. La monnaie pour débloquer les recherches sera uniquement les tokens, et des fois on aura besoin de certaines ressources qui font sens »). A node costs two things:

- **AI tokens, at every tier**, delivered as a flow (below): its only currency.
- **Resources**, one to three kinds, paid from the Core's stock **when it is launched**, as a plan is (`ResearchDef.cost`, the `res` of `node()` / `trunk()`), under CrierBelt's restart reserve (D36). They are picked per node so they hint at what it unlocks: Mechanics plates and copper wire, the Electric Smelting copper wire and plates, the Server Room cable and oscillators (its clocks), Tier 1 coils and motors where it asked circuits until D129 (the electronics workshop is Tier 2's), Tier 2 gears, circuits (after the electronics workshop), oscillators, servomotors and ceramic, Tier 3 lenses and thermal cores, Tier 4 resonators, nacre lattices and robot arms (D123 swapped some for its steel, bricks, pipes, cables and copper plates). A cancel hands them back.

There is no minimum time (D118). A node ends at the minute its tokens are in. The pace (`minutes`) is only what the launch dialog aims its default flow at: short early, long late (owner, 2026-10-17: « c'est au T3-4 qu'on commence à avoir de la recherche vraiment longue »). `DEPTH_COST`, by a node's depth:

| Tier | Depth | AI tokens | Pace (the dialog's aim) | Its resources, as a rule |
|---|---|---|---|---|
| 1 | 1 · 2 | 2 000 · 5 000 | 2 min · 5 min | 20–60 plates, glass, copper wire; a few coils, motors, oscillators (no circuits: D129) |
| 2 | 3 · 4 | 100 k · 300 k | 8 min · 20 min | 20–100 gears, coils, motors, oscillators, ceramic; circuits after the electronics workshop; a few servomotors |
| 3 | 5 · 6 | 600 k · 1,2 M | 1 h · 3 h | 10–30 lenses or thermal cores, with gears, circuits or ceramic |
| 4 | 7 · 9 ★ | 2 M · 6 M | 8 h · 1 day | 5–15 resonators or nacre lattices, with lenses or thermal cores |

The trunk's old nodes keep their own pace (`paced`): Mechanics 2 000 tokens, the Synthesis 10 000 (10 min), Earthworks 15 000 and Ceramics 60 000 (8 min), Land Registry and the Second Desk 20 min, Optics (`tr6`, Atlas Lore until D122) 30 min, the Third Desk 3 h, Resonance (`tr8`, Codex Lore until D122) 6 h. **Tier 1 runs on the Core's compute alone**, its 1 000 tokens a minute from level 2: a node in two to five minutes, all of Tier 1 in about an hour; a bought flow (10 ◉ the thousand, a Tier 1 node 20–50 ◉) or Overclocking (`an_data`, +500) go faster. At 10 ◉ the thousand a depth-3 node's tokens cost 1 000 ◉ whatever the flow: a faster flow pays the same sooner, and only the free flows (the Core's compute, the servers) cost nothing — two servers and a level-3 Core with Overclocking (6 000 a minute) carry a depth-3 node in 17 minutes alone. An expertise in place takes 15–35 % off its theme's tokens (research « time » and tokens) or resources (D93, D122); on research this long it matters from Tier 3.

### The Core's compute (D122)

From its level 2 the Core gives research a steady token flow, its **compute** (« calcul du Cœur »): `BAL.coreCompute` 1 000, 1 500, 2 000, 3 000 tokens a minute at levels 2–5 (none at level 1), plus Overclocking (`an_data`, +500) and Data Mining (`an_mining`, +2 000), × Archiving (D93: `tokenRate`). It needs no power and no ribbon: `Sim.coreComputeRate()` is read at each minute's end. Level 2 mounts its **compute bay** on the south-east corner, where the data outlet stood (D86; `HeartPiece` `'compute'`). The **autonomous lab** (`an_autolab`) also computes, 5 000 tokens a minute like a server, project or not.

### The token flow (D118, D122)

- **Delivered at each minute's end** (`tokenEpoch`) to the projects **whose lab had power during the minute** (`Project.lit`), **in the order they started** (the oldest first, each to its need):
  1. the free pool: the Core's compute, then the servers' output of the minute — what nobody needs is lost, the servers' share rented back with Server Rental;
  2. the **bank** (`Sim.tokenBank`): tokens an older save's data was turned into (D122, persistence.md), never refilled;
  3. each project's **bought flow** (`buy`, tokens a minute), at most what it still needs, so the flow stops by itself once the project has its tokens.
  A project with its tokens in is done at that boundary.
- **Launching any node** opens the launch dialog (D122: every tier; D128: told around the outcome): its resources from the Core (chips: how many, what the Core holds), the tokens it needs, a bar of where they will come from — the bank at the first boundary, the free compute once the projects launched before have theirs, the flow bought, what none reaches — with one plain sentence on what matters, a slider over the flow ladder (`BAL.tokenFlow`: 0, 500, 750, 1 000, 1 500, 2 000, 3 000, 5 000…) with its cost a minute and in all (gone when the bank or the free compute bring every token at the first boundary), and the end. The estimate is the engine's (`launchSources`: the boundary's own order, stretch by stretch). The default (`tokenBuyDefault`): the ladder's first flow that brings its tokens in by its pace, by that estimate — 0 at Tier 1, where the Core's compute suffices, and 0 when the bank covers it (until D128 it counted no bank while another project ran, and proposed buying what the bank would pay). A running project's flow can be changed in the tree (`tokenBuy`). A queued start (the Research Queue) buys nothing; it waits for its resources and starts at a project's end or at the minute's end they are in.
- **A purse in the red holds the bought flows** (`researchHeld`, a toast, an absence incident) until it is back above zero; the free flows and the bank go on. Launching with a bought flow needs the purse out of the red (`debt`); the free flows need no purse.
- **The Compute Plan** (half price for a fee an hour) and **Server Rental** (CrierBelt buys the servers' unused tokens back at half price) stay: both still act on the flow.

## The categories (D128)

A node's prerequisites by name are the node before it in its category and, written `+`, what it takes from another category of **its tier**; the tiers before come through its category's gates (← here) and its tier's gate. In the table's order: the tree's top to bottom.

| Tier | Category (theme) ← gates | Nodes |
|---|---|---|
| 1 | Énergie (en) | Pitch-Control Turbine (140 kW since D143) → Solar Panels (200 kW a panel since D143) |
| 1 | Extraction (ex) | Fast Drill → Brickworks (D123) |
| 1 | Fonderie · Foundry (dn) | Copper Smelting (D123) → Compact Smelter → Steelworks (+ Mechanics, + Brickworks) → Electric Smelting |
| 1 | Atelier · Workshop (dn) | Mechanics (press, gears) → Twin Wire Mill (+ Steelworks; cable) · Quartz Workshop (oscillators; D128, the Face Cutter's plan's until then) |
| 1 | Commerce (cm) | Second Post → Floor Prices |
| 1 | Calcul du Cœur · Core Compute (an) | Overclocking (+ Quartz Workshop) → **Synthesis** (+ Twin Wire Mill; the Core's level 3) |
| 1 | Logistique (xp) | Swift Ribbon → Great Silo → Fences and Glazed Ribbons |
| 2 | Réseau électrique · Power Grid (en) ← Énergie | Heavy Accumulator → Battery Charging |
| 2 | Carrière · Quarry (ex) ← Extraction | Earthworks (excavator) → Sifter → Backfill → Basalt Bits |
| 2 | Céramique et optique · Ceramics and Optics (dn) ← Fonderie | Ceramics → **Optics** (+ Electronics Workshop: its thermal cores and the Core's level 4 take circuits, D129; the Core's level 4) |
| 2 | Automatisation · Automation (dn) ← Fonderie, Atelier | Electronics Workshop (circuits; a plan until D129) → Servomotors → Compact Assembly (+ Ceramics) |
| 2 | Finance (cm) ← Commerce | Auto-sell (D127) · Standing Orders → Compute Plan (+ Server Room) → Server Rental |
| 2 | Serveurs · Servers (an) ← Calcul du Cœur | Server Room (+ Electronics Workshop, D129) → Research Queue · Second Desk |
| 2 | Territoire · Territory (xp) ← Logistique | Camouflaged Ribbon (D109) → Long Bridges → Reinforced Pylons (+ Land Registry), Far Claim (D119) · Land Registry (+ Ceramics) |
| 3 | Centrales · Power Plants (en) ← Réseau électrique | Solar Farm → Great Turbine · Geothermal → Battery Generator |
| 3 | Mine profonde · Deep Mining (ex) ← Carrière | Deep Bore → High-Pressure Pump · Heartrock Cutters → Heavy Excavator |
| 3 | Électronique · Electronics (dn) ← Automatisation | Etcher → Robotics · **Resonance** (the Core's level 5) |
| 3 | Mécanique lourde · Heavy Engineering (dn) ← Automatisation, Céramique et optique | Forging Press → Arc Furnace |
| 3 | Économie de marché · Market Economy (cm) ← Finance | Wider Wharf → Express Freight |
| 3 | Calcul · Computing (an) ← Serveurs | Cooled Server → Shared Computing · Data Mining → Price Forecast · Third Desk |
| 3 | Transport (xp) ← Territoire | Distributors → Express Ribbon · Neighbour Treaties |
| 4 | Grandes centrales · Great Power Plants (en) ← Centrales | Solar Tower ★ · The Sunheart ★ |
| 4 | Grands travaux · Great Works (ex) ← Mine profonde | Giant Drill ★ · Deep Fill ★ |
| 4 | Puces · Chips (dn) ← Électronique | Chip Fab ★ |
| 4 | Grand assemblage · Great Assembly (dn) ← Mécanique lourde | Assembly Tower ★ |
| 4 | Grand négoce · Great Trade (cm) ← Économie de marché | Grand Post → The Crier House ★ |
| 4 | Supercalcul · Supercomputing (an) ← Calcul | Supercomputer ★ · Autonomous Lab ★ |

Logistics has no Tier 4 category: its keystone, the Great Skydock, went with the skydocks (D108).

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
- **The categories** (D128, `categoryProblems`): each of a tier and a known theme, holding nodes; Tier 1's without gates; a later tier's gates are categories of the tier before (so they never loop, and each tier is reached through the one before), named once. A node stands in its category's tier and theme, a depth-costed one in its depth's tier, and names only prerequisites of its own tier. Each tier has categories, and its gate (`TIER_GATE`) stands in the tier before. That every gate can be finished — its nodes reached, nothing unusable on the way — is the tree's own checks', which read the gates as needs (`researchNeeds`).
- **The arc** (D93): Tier 2 also waits for two expertises. That is the engine's `researchBlock` → `expertise`, not a prerequisite; a gate unfinished is `gate` (D128).
- **Tokens and the Core's levels** (D118, D122): every node takes tokens and a pace, a Tier 1 node at most 10 000 (the Core's compute runs it in minutes); `BAL.tierCoreLevel` rises tier by tier, each level exists (`BAL.hearthUpgrades`) and comes with the tier's gate (level 3 with the Synthesis, 4 with Optics, 5 with Resonance), and Tier 2's level is the Archive's (`BAL.expertise.level`). That is `researchBlock` → `core`, not a prerequisite.
- **No reconversion** (D107: « retire le bouton reconvert de l'arbre »): what a claim learns stays learnt. The tree has no « Reconvertir » and nothing starts one; a save's reconversion under way (`respec:<family>`) still runs out and pays its archive notes.
- **Saves**: a node keeps its id when it moves, so `sim.done` holds ids; a node learnt stays learnt in a category its gates now lock (D128: only what is still to learn there waits). A node removed or renamed needs a line in [retired.ts](../src/content/retired.ts). When older claims must hold a node to keep what they had, add a save step: D93's Synthesis, D106's Electric Smelting, D107's Tier 1 newcomers (`tierOneWhole`). Running projects keep the cost they started at. Save 18 (D118, `researchFlows`): a project under way loses its minimum time, a Tier 1 one its tokens, a Tier 2+ one counts the tokens it had used as delivered. Save 19 (D122, `dataRetired`): a project's paid data counts as tokens delivered (a Tier 1 one needs Tier 1's tokens now; the excess is banked), it owes no resources; the Data Relay (`an_relay`) is forgotten; the data held anywhere is banked as tokens by the remap ([persistence.md](persistence.md)). Save 20 (D128, `quartzWorkshop`): a claim holding the Face Cutter's plan holds the Quartz Workshop's node, which came with it.

## Changing the tree

- Repace by `DEPTH_COST` or a `paced` node's own numbers (`tokens`, `minutes`: the launch dialog's aim); retune a node's resources in its `res` (validation says when the base cannot make them before it). `validate.test.ts` checks each tier's band, Tier 1's tokens against the Core's compute, and the resources' shape.
- A new node: see [content.md](content.md#add-a-research-node-or-an-effect) — pick its category (`CATEGORIES`), or add one: a tier, a theme, its gates of the tier before, a line on what a base focused on it does. Run `npx vitest run src/content src/sim/research src/persist src/ui/screens/tree-layout.test.ts`. The debug bases' research lists live in [scenarios.ts](../src/sim/scenarios.ts) (`GROWN_RESEARCH`, `GROWN_NEXT`, `LATE_RESEARCH`, `SURVEY_PROJECT`, `ADVANCED_PROJECT`; `Builder.affordNode` grants a node's resources); the scenario tests check D85's never-idle lines.
- Look at it: `node scripts/tree-d144-shots.mjs` (with `URL=` for a frozen build, `TAG=`, `OUT=`, `BASES=`, `LANGS=`, `SHOTS=`) takes the tree as it opens, the whole tree, a mid zoom, a focused node and its path, the available-now filter, the launch dialog and a phone, on the fresh, tutorial, grown and late bases in French and English (D144); `node scripts/tree-shots.mjs` the whole canvas, focused chains and the zoom at 1440 × 900 and on a tablet. A node's place on the tree comes from its category and its prerequisites alone ([tree-layout.ts](../src/ui/screens/tree-layout.ts): its theme's lane, its tier's column, its chain of prerequisites of that tier): nothing to place by hand. `node scripts/launch-shots.mjs` takes the launch dialog in its three cases (the reserve covers it, the free compute busy, a flow to buy).
