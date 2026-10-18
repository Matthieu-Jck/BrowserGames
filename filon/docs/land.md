# Land: parcels bought and rented

The claim builds on the land it holds, cut in square **parcels** (owner, 2026-10-14: "instead of
the way station, let's make it so that you have to either buy or rent square parcels. By default
you have a square that includes the Cirque, but then you need to pay. The price should vary
depending on what's on it, when no other player owns it"). Parcels replace the influence zones:
the Heart's growing disc, the waystations and the land reclaimed next to a zone are gone ([D60](decisions.md)).

## The grid

- A parcel is `BAL.land.parcel` tiles square (23 since D74; 16 before). Parcels are centred on
  the Heart: its tile is the middle of parcel (22, 22) — an odd side, so exactly —, the grid
  starting at `ORIGIN` (−5) so the first and last columns are cut short by the world's edge;
  the starting square is symmetric round the cirque (`sim/world/land.ts`: `parcelAt`,
  `parcelRect`, `parcelCentre`).
- **The starting square** is the claim's grant: the 3 × 3 parcels round the Heart's
  (`BAL.land.startRings` = 1; owner, 2026-10-15, D74: « le joueur ne devrait posséder que 9
  parcelles… à peu près exactement le cirque »). It spans ±34 tiles: on map 2 the Crown reaches
  29–33 tiles west, north and south, and 36 east at the tarn's peak, whose crest alone is left out.
  It is never bought, rented nor lost. (D60 had the smallest square holding the Crown out to its
  farthest terrace: 5 × 5 parcels of 16, 7 × 7 round a map-1 Closed Cirque.)
- Everything a zone used to gate now asks the land: a building that `needsZone` must stand
  wholly on held parcels (the starting square, bought, granted or leased), the Crown's slopes too (the
  D44 exemption is gone: turbines on far mountains need their parcel). Infrastructure (ribbons,
  poles, routers…) may still cross land the claim does not hold, at the remote cost and by kite
  (`remoteBeltCost`, `remoteDelay`); a neighbouring base's land only with Neighbour Treaties or as a
  camouflaged ribbon (D109), and never through its buildings (below).

## Who owns the rest

- Most parcels belong to nobody: CrierBelt sells or leases them at their **content price**.
- Some belong to a **neighbouring base** (« base voisine », [D110](decisions.md); owner,
  2026-10-17: « Pourquoi "sister claim" ? Enlève ça. S'il y a un endroit possédé par un PNJ, il
  faut qu'il y ait vraiment une base, et appelle-ça d'un nom plus logique »): another claim of the
  Crier — one of the market's colonies, so the base next door is one the player trades with —, its
  name and its emblem the colony's (`colonyEmblem`), and on its land a small working base
  ([sim/world/neighbours.ts](../src/sim/world/neighbours.ts), its chain from
  [sim/world/neighbour-chain.ts](../src/sim/world/neighbour-chain.ts), its dress in
  [content/neighbours.ts](../src/content/neighbours.ts)). Nothing of it is saved: it follows from
  the world and player seeds and the land as its source made it (`Grid.made0`: what the claim digs
  never moves it).
  - **Where — few, and on the horizon** (owner, 2026-10-17, after play: « Il y a trop de bases de
    PNJ autour de moi »). None within three rings of the Heart's parcel (`BAL.land.neighbours.minRing`
    4: the two rings round the starting square stay free; the nearest bases some 90 tiles out).
    Map 4 (`MapParams.holdings`): the parcel grid is cut in 3 × 3 squares round the Heart's parcel;
    120 ‰ of them hold one base of 2–4 parcels side by side, grown from a seed parcel, so each reads
    as one — on lands 1–3, 17, 17 and 13 bases (39, 34, 31 parcels), of which 2, 2 and 5 parcels
    on ring 4, none nearer (420 ‰ from ring 3 before: some sixty bases). Maps 1–3 (and test
    worlds) keep a share of the sister claims' scattered parcels (40 ‰ of the same draw, the same
    colony: fewer, never others), one base each. Either way, on a parcel that is mostly open floor
    (`TerrainSource.floorAt`, sampled 5 × 5 without making a chunk) and holds nothing the land
    guarantees the claim (`keepsClear`: a unique site, the copper field, a vent, the quartz vein, a
    corridor): a parcel where none fits is CrierBelt's.
  - **The base: a working chain round its own Core** (owner: « leurs bases sont vraiment nulles, il
    n'y a rien qui marche, même pas de câble électrique », « ils devraient avoir un cœur, juste pas le
    même que le mien », « plus petit »). Its Core in its hub's middle, 3 × 3 (the claim's is 5 × 5;
    the sim lays it as `NEIGHBOUR_CORE`'s footprint, `NLayout.core`; the render draws its own; a
    middle on a pocket of floor under `BAL.land.neighbours.pocket` tiles: the spot of its parcels
    with the most floor joined), its intakes towards CrierBelt's trade post set beside it across the
    flow, its store before the post's intake.
  - **Its chain, made from the recipes** (fifth pass; owner: « Du charbon rentre dans des fileuses,
    puis le trou de sortie d'une batterie génère des composés électriques, et rien n'est jamais envoyé
    par trade post. En plus c'est tout petit »;
    [sim/world/neighbour-chain.ts](../src/sim/world/neighbour-chain.ts)). The goods its trade
    supplies (content/colonies.ts, its staples first) back-chained through the recipes, up to four
    steps, to what its land gives — sand where its floor has `BAL.land.neighbours.sand` places of
    bare sand for collectors, each ore with room for a drill on it — and, where the land falls short,
    one good bought at the Crier through its trade post (stone for its sifters, steel for its presses,
    empty cells for its chargers). Every machine runs a recipe its building can make, each input
    comes on a line from the stage that makes it, each extractor stands on its ground. The chain is
    laid side by side up to four times (some eight machines); its bought good leaves the trade post's
    one outlet for a depot (a silo; a great silo for three; a second depot after the first for four),
    whose outlets feed the machines across from them in order, so no two lines cross. Its goods run
    into the store, the store's two outlets into the trade post (what it sells: a CrierBelt drone
    lifts off from there) and the Core. Laid until it checks (`neighbourProblems`: each machine on its
    recipe and fed, each line from an outlet to an intake or onto another line's side carrying what
    its source puts out, every depot fed, the goods reaching the post and the Core), trying again
    with the post on the Core's other side, the bought goods' lines laid first, fewer copies, one
    product, then its plainest chain (glass from its sand, an ore as it is, else its trade's simplest
    good from two bought inputs); what still does not check is taken away (`prune`), never left
    standing idle. Lands 1–8 of map 4: 96 bases, none failing, 5.2 machines a base, 71 selling their
    own trade's goods (the salt ports and most scholar spires, short of salt or of room, make glass).
    Maps 1–3 keep the old claims' single parcels: their bases stay small.
    Then its power on the hub's far side (turbines, a coal generator, panels) and its own grid: every
    building that takes part in power wired from its Core through masts (a chain of masts that
    cannot reach the grid is taken back), by the claim's own
    rule of reach (a mast at one end, its range and slots: sim/power/links.ts) — never joined to the
    claim's. Its covered depots (canvas dome tents), its flag and two banner poles by its Core, cairns
    along its outer edge. Each building wholly on its parcel a tile in from its edge with a tile of
    room round it; a parcel the land cuts off from the pad's floor still gets a turbine on the grid.
    Laid out the first time something asks (a placement, the land panel, the view), the same in any
    order.
  - **What it gates.** Its buildings, ribbons and flag are its own: nothing of the claim's stands on
    them (`occupied`, treaties or not), the Gleaners keep off its land (D103: its drones watch over
    it, as the claim's fences do), no dig or fill mark goes on its land. The rest of its land takes infrastructure only with
    Neighbour Treaties (`neighbour_land` without), or the camouflaged ribbon (D109).
  - **Not for sale nor lease** (`LandRefusal` `neighbour`): its drones work there. A parcel bought
    from a sister claim before D110 stays bought, but does not sell back (its base would stand on
    what the claim built). An older save gives way at load (`neighboursGiveWay`, idempotent): a
    lease on a base's land, or anything of the claim's on a tile its buildings would take, makes
    that parcel the claim's (`granted`); that part of the base is not there.

## The price

`landPrice(sim, p)`, in centi-ocelles, from what the parcel holds today (it changes as rock is dug
or water filled):

- a base (`BAL.land.base`), plus per tile: floor, rock, water, salt, vent, dune sea, river, chasm (`BAL.land.tile`); floor pays in full (`floor`, 60) only where it is **usable floor** (D94, [world/floor.ts](../src/sim/world/floor.ts): some 2 × 2 square holding it is floor all through at one level, so a machine stands there), a sliver of it pays as rock (`sliver`, 25), a river 20 (water to pump from its bank, nothing to stand on), a chasm nothing. Land cut up by cliffs, chasms and rivers (map 4) costs less: the price follows the room it gives. The land panel shows the parcel's share of usable floor as a bar and a figure, and its ore as three pips and a count (`parcelOre`: tiers at `BAL.land.oreTiers`, 1, 13 and 40 deposit tiles), the Terrain view both as a gauge at each parcel's middle (amber under a third) with the pips beside it — space or ore at a glance;
- plus, per deposit tile, the ore's value × the tile's richness (`BAL.land.depositPerValue`, 250 since D94: on map 4 the ore lies in broken ground, so a rich parcel has little room; it costs a little more than an open one, ≈ 540–630 ◉ against ≈ 505–517 ◉, both worth buying for what they give); a face ore (D87: the quartz set in a wall) is priced as the rock it is in — no drill takes it, and the vein's parcel is the tutorial's first purchase (« Le quartz de la paroi »), within its purse (about 450–570 ◉ against 700–790 with it; 419–572 ◉ on map 4's lands 1–12);
- × the growth: each parcel the claim has bought makes the next one dearer (`BAL.land.growth`,
  ‰ per parcel; research lowers it);
- × the research discounts (`landPrice`). The Heart's level does not change it (owner,
  2026-10-14). (Until D110 a sister claim's parcel cost ×1.6–2.4 more; a neighbouring base's is
  not for sale.)

## Buying and leasing

- **Buy** (`buyLand`): the price, once; the parcel is the claim's for good. A leased parcel can be
  bought outright (the lease ends).
- **Lease** (`rentLand`, after Land Registry, `tr4`): `BAL.land.rentPermille` of the price an
  hour, the first hour paid at once, the rent fixed for the lease's life. Each hour after, at the
  minute boundary the hour falls on, the rent is taken from the purse — online or in the
  catch-up, the same call (`Sim.landEpoch`). When the purse cannot pay, the lease **lapses**: the
  parcel goes back to its owner, and what stands on it goes dormant (nothing vanishes; leasing
  or buying it again wakes it up). `endLease` gives a lease up.
- **Selling back** (`sellLand`, D119; owner, 2026-10-17: « il ne devrait pas y avoir d'upgrade pour revendre une parcelle. Ce n'est pas à 80 % du prix, c'est au prix du marché, avec 20 % de taxe du gouvernement »): always available, no research, for any parcel the claim bought. CrierBelt pays the parcel's **market price** — what buying it would cost now (`marketPrice`: `landPrice` with the parcel itself left out of the growth, so land growth, ore, floor and research move it) — less `BAL.landResaleTax` (200 ‰), the **taxe du Cadastre de l'Anneau** the authority that registers land on the Ring keeps. What stands on it goes dormant. The land panel shows « Revendre · X ◉ » and under it « Prix du marché Y ◉ − taxe 20 % du Cadastre de l'Anneau ». A granted parcel is not sold (`not_bought`), nor one bought from a base before D110 (`neighbour`).
- A lease needs no sale: `endLease` gives it back at any time, free, as before (the rent is paid by the hour, nothing was paid up front to get back).

## The fog (D117)

The land past what the claim has seen is in the fog (`Sim.explored`: discs that never close; a
building is placed and a tile marked on revealed land only). There is no scouting building since
D117 (owner, 2026-10-17: « On va supprimer le survey beacon, je n'aime pas »): the fog lifts as the
claim grows.

- **The Core** lifts it round itself by its level, `BAL.coreReveal`: 44 tiles at founding (the
  cirque, its Crown and the near belt's first deposits), 56, 68 and 80 at levels 2–4.
- **A parcel newly held** (bought or leased) lifts it `BAL.landReveal` (32) round its centre: the
  whole parcel and a margin round it (16 tiles at its corners), so its neighbours' near edges show.
  A parcel can be bought in the fog: its price says what it holds (the land panel's facts wait).
- **A building stood up** lifts it round its footprint's centre, `revealOf` its def: a pylon as far
  as its wires reach (40), any other building `BAL.buildReveal` (12) plus half its longer side; a
  line piece (ribbons, routing blocks, junctions, bridges, conduits, fences) nothing. So a pole
  line walks the fog back: each pole, wired from the edge of the clear, lifts the next stretch;
  a pylon line does it 40 tiles at a time. Off the claim's land the drones fly a building out
  (`remoteBuildDelay`): the fog lifts when it is placed, not when it lands.
- `Sim.liftFog` adds a disc only when one of its tiles is still in the fog, so building in the
  clear adds nothing and the list grows only at the fog's edge. Placements are commands: a replay
  lifts the same fog.

What the survey beacons of a save lifted stays lifted; the beacons themselves are refunded
(save v17, [persistence.md](persistence.md)).

## Saves

`land: { bought, granted, leases }` (`FIELDS`). Version 3's migration (`zonesToParcels` in
`persist/migrate.ts`) takes the waystations down (retired: refunded at their cost, their stores
handed to the Heart) and grants the claim every parcel a building of its stands on (`granted`:
held without a purchase, so it raises no price; the starting square's own parcels among them do
no harm), so no base loses a machine to the change. A granted parcel is held: it is not sold again.

Version 9's migration (`parcelsResized`, D74) moves the parcel ids from the 16-tile grid to the
23-tile one: a bought parcel stays bought where its middle tile now falls (its price kept in
`paid`, kept for the record since D119; refunded if that is the new starting square), a lease likewise (two
falling together make one lease with both rents; one falling on land held already is refunded
its hour), and every new parcel under a building that needs land, standing wholly on land the
claim held, is granted. The old start is recomputed from the land's Crown (`MapGen.crownReach`).
The migrations keep frozen grids by size (`parcelGrid(16)`, `parcelGrid(23)`), so version 3's
step still grants on the grid of its time whatever `BAL.land.parcel` becomes.

## Research

- Land Registry (`tr4`, was Waystations): leases.
- Selling back is no research (D119; `xp_resell` is retired: a save holding it forgets it at load, `RESEARCH_GONE`, a project of it refunded). Neighbour Treaties
  (`xp_treaties`, after Reinforced Pylons `xp4`, flag `neighbourCrossing`): ribbons and poles cross the neighbouring bases' land,
  between their buildings (D110). Far Claim (`xp_far`, Tier 2, depth 4 after the Camouflaged Ribbon since D119; it was Tier 4): buy a
  parcel that does not touch the claim's land (without it: `far`).
- Since D70 no node changes a land price by a percentage: the `landPrice`, `landRent`,
  `landGrowth` and `farLand` modifiers stay at their base.

## Buried ribbons (D109)

The camouflaged ribbon (`camo_ribbon`, research `xp_camo`, Logistique's first Tier 2 node) is the
one piece laid on land the claim neither holds nor may cross: a neighbouring base's open land
(never what stands on it: that is `occupied`), as well as free land and its own. It pays no remote
surcharge (`BAL.camoRemoteCostMult` = 1, against the ×3 of the others; the kite's delay stays) and
runs at 40/min, flat. A ribbon drag lays it by itself on the tiles the land refuses the dragged
ribbon ([engine.md](engine.md), `planBelts`); Neighbour Treaties (`xp_treaties`) still open that land
to every ribbon and the poles.
