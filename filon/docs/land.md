# Land: parcels bought and rented

The claim builds on the land it holds, cut in square **parcels** (owner, 2026-10-14: "instead of
the way station, let's make it so that you have to either buy or rent square parcels. By default
you have a square that includes the Cirque, but then you need to pay. The price should vary
depending on what's on it, when no other player owns it"). Parcels replace the influence zones:
the Heart's growing disc, the waystations and the land reclaimed next to a zone are gone ([D60](decisions.md)).

## The grid

- A parcel is `BAL.land.parcel` tiles square (16). Parcels are centred on the Heart: its tile is
  the middle of parcel (32, 32), so the starting square is symmetric round the cirque
  (`sim/world/land.ts`: `parcelAt`, `parcelRect`).
- **The starting square** is the claim's grant: the smallest square of parcels round the Heart
  that holds the whole Crown out to its farthest terrace (the land's `crownReach`; 5×5 parcels on
  most lands, 7×7 round a closed cirque). It is never bought, rented nor lost.
- Everything a zone used to gate now asks the land: a building that `needsZone` must stand
  wholly on held parcels (the starting square, bought, granted or leased), the Crown's slopes too (the
  D44 exemption is gone: turbines on far mountains need their parcel). Infrastructure (ribbons,
  poles, routers…) may still cross land the claim does not hold, at the remote cost and by kite
  (`remoteBeltCost`, `remoteDelay`), but never a sister claim's parcel.

## Who owns the rest

- Most parcels belong to nobody: CrierBelt sells or leases them at their **content price**.
- About one in eight parcels beyond the ring round the starting square belongs to a **sister
  claim** (`BAL.land.sisterShare`; which one, and which claim, follows from the world and player
  seeds: never saved). Its owner sets the price: the content price × the claim's markup (×1.6 to
  ×2.4), to buy or to lease. Nothing can be built or laid across it until the claim holds it.

## The price

`landPrice(sim, p)`, in centi-ocelles, from what the parcel holds today (it changes as rock is dug
or water filled):

- a base (`BAL.land.base`), plus per tile: floor, rock, water, salt, vent, dune sea (`BAL.land.tile`);
- plus, per deposit tile, the ore's value × the tile's richness (`BAL.land.depositPerValue`);
- × the growth: each parcel the claim has bought makes the next one dearer (`BAL.land.growth`,
  ‰ per parcel; research lowers it);
- × the discounts: the Heart's level (`BAL.land.hearthDiscount` per level past the first) and
  research (`landPrice`);
- × the owner's markup on a sister claim's parcel.

## Buying and leasing

- **Buy** (`buyLand`): the price, once; the parcel is the claim's for good. A leased parcel can be
  bought outright (the lease ends).
- **Lease** (`rentLand`, after Land Registry, `tr4`): `BAL.land.rentPermille` of the price an
  hour, the first hour paid at once, the rent fixed for the lease's life. Each hour after, at the
  minute boundary the hour falls on, the rent is taken from the purse — online or in the
  catch-up, the same call (`Sim.landEpoch`). When the purse cannot pay, the lease **lapses**: the
  parcel goes back to its owner, and what stands on it goes dormant (nothing vanishes; leasing
  or buying it again wakes it up). `endLease` gives a lease up.
- Selling bought land back is not offered.

## Saves

`land: { bought, granted, leases }` (`FIELDS`). Version 3's migration (`zonesToParcels` in
`persist/migrate.ts`) takes the waystations down (retired: refunded at their cost, their stores
handed to the Heart) and grants the claim every parcel a building of its stands on (`granted`:
held without a purchase, so it raises no price; the starting square's own parcels among them do
no harm), so no base loses a machine to the change. A granted parcel is held: it is not sold again.

## Research

- Land Registry (`tr4`, was Waystations): leases.
- Boundary Stones (`xp1`): land −15 %. Land Charter (`xp3`): each parcel bought raises the next
  one's price less. Federation (`xp7`): rent −30 %. Far Claims (`xp8`): land beyond r 320 −30 %.
- Drone Relays (`xp2`) still halves the remote cost and delay outside the claim's land.
