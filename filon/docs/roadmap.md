# Roadmap

Where Ocelle stands and what each remaining milestone must deliver. The milestone definitions and their "done when" criteria come from the plan's section 10. This file adds what the code has taught since. Update it at the end of every milestone.

## Status

| Milestone | State | Highlights |
|---|---|---|
| M0 Foundation | ✅ | Vite + TS strict, Pixi stage and layers, camera, i18n, echo worker, `window.FL`, smoke harness |
| M1 Engine + catch-up | ✅ | Integer flow graph (chains, junctions, machines, reservoirs), A/B/C phases, power, research slots, exact offline catch-up, save / load at the same hash; bench: ~25 k entities ≈ 0.8 ms / tick, a week away ≈ 0.8 s |
| M2 World + art v0 | ✅ | Cirque template + procedural rings (two seeds, archetypes, uniques), fog, terrain painted in workers, the Moebius-ink art kit, atlas, artboard; iso relief |
| M3 Build & see | ✅ | Iso ⇄ plan morph, ribbons dragged with automatic corners, ghost + tip with costs and refusal reasons, box demolish, pipette, inspector, build bar, items riding ribbons |
| M4 Content, energy, research | ✅ | Full tables + `validate.ts`, coal generators, wind with gusts, sun day/night, accumulators, research with penalties / mastery / reconversion / dormancy, research and stats screens, HUD |
| M5 Space | ✅ | Hearth levels, excavators + brush, backfillers, pumps, pylons, skydocks + drifters + routes, skybridges, crossings, filtering forks, speed modules; its waystations (growing cost) and reclaimed land were replaced on 2026-10-14 by land parcels (D60, [land.md](land.md)) |
| Architecture pass | ✅ | Sim facade + `systems/`, `commands.ts` (exec / replay), `cfg.ts`, `src/app/` controllers, inspector panels, the layering test, `ARCHITECTURE.md`, `CLAUDE.md`, `docs/` |
| **M6 The Crier** | ⏳ engine ✅, trade posts ✅ (sim, offline-exact, saved, smoke), Crier screen and orbital view in progress | see below |
| M7 Persistence & absence | ✅ (2026-10-13) IndexedDB a/b slots + copies, checksums, gzip, migrations chain, saves re-pointed by content id (D47), one tab at a time, boot catch-up + online resync, « Pendant ton absence », export / import / start over in Settings ([persistence.md](persistence.md)) | the catch-up stays on the main thread until bases need a Worker |
| M8 Onboarding & polish | ⏳ the tutorial ✅ (quests 0–11, quest log, guide, naming modal; [quests.md](quests.md)), generative audio ✅ ([audio.md](audio.md)) | see below |

## M6: the Crier (market) and "Économie visible"

Plan sections 6 and 9 (the `MarketService` contract). The work splits along the layers:

1. ✅ **`src/market` (pure)**, see [src/market/README.md](../src/market/README.md) for the API and the integration notes. Its deviations from the plan, all argued in the README: T3/T4 supply ramps with demand; growth at the same mean rate on both sides; events ease in over 20 min; stateless value noise instead of an exact OU process; `book()` against split sales; secondary trade lines so every good has a supplier and a buyer. Spec: sister colonies, the price model (equilibrium, smoothing, noise, spread), spot quotes with slippage, events + Gazette, the scripted Port-Écume bulb shortage, import sourcing, the "What pays" board, history, `LocalMarketService` with `save` / `load`. Its tests reproduce the plan's numbers (elasticity, round trip ≈ −20 %, spot sale example).
2. ✅ **Sim integration** (see engine.md « Trade »): a `systems/trade.ts` for the trade post (kind `trade`). Export flows: items entering are sold at the bid price, settled every epoch. Standing import orders (item, rate, max price, ±3 % hysteresis): filled while P ≤ max and credits suffice, delivered after the lift delay plus the supplier's delay. Spot sales. Levels N1–N3 (throughput, fees, lift delay, number of flows / orders). A post next to the Hearth delivers straight into its stock. The **ledger** is saved and hashed. The market is called **once per epoch** from `Sim.step` (and from the catch-up at each epoch boundary): the same function online and offline. Plus the commerce-branch effects in `Mods`, and new `Command`s (export flow, import order, spot sale, post level).
3. ✅ **Offline** (the boundary runs the same `tradeEpoch`; events folded into the report): export / import flows are pseudo-flows on the post's reservoir; deliveries in flight are catch-up events; epochs are already segment boundaries. Add an online ≈ offline test with trading.
4. **UI**: the Crier screen (M): prices with sparklines, buy / sell, standing orders, the "What pays" board, the Gazette. A trade-post inspector panel (`ui/inspector/trade.ts`). HUD: ◉ with Δ/h.
5. **"Économie visible"** (signature): the planet / orbital view, i.e. Ysmère with the sister colonies placed by their longitude / latitude, arcs for the routes the player trades on, cargo launches from the player's trade post (in the Crier screen, and as lift-offs above the post in the world view).
6. ✅ **Smoke**: glass sold during the shortage → ◉ up; copper ore imported and delivered after the delay.

## M7: persistence and the absence report ✅

Done on 2026-10-13 (plan sections 7 and 9), as built in [persistence.md](persistence.md):
- IndexedDB a/b slots with sequence numbers and checksums, and the copies `prev`, `pre-import`, `pre-migration`, `pre-wipe`.
- gzip export / import (`.ocelle`), a migrations chain (since then 1 → 2, D57, and 2 → 3, D60), saves re-pointed by content id (D47).
- A Web Lock with « Reprendre ici ».
- At boot: the newest whole save, caught up for the time away. Online: a resync whenever the base falls behind the wall clock.
- Autosave every 30 s, 2 s after a structural change, and on hide / `pagehide` / `freeze`.
- The comic-panel « Pendant ton absence », and the « Sauvegarde » row in Settings (export, import, start over, a 7-day export reminder).

Deviations from the plan:
- **No Worker yet**: a 7-day catch-up of the `late` debug base takes about 0.65 s.
- **No `lastseen` marker**: the time owed comes from the save's own tick, so a missed final save loses actions, never time.

## After M7: updates

- ✅ **« Avant de partir »** (D49, 2026-10-13): the absence forecast, the catch-up run on a copy of the base ([persistence.md](persistence.md)).
- ✅ 2026-10-13, from the owner's play: the claim's value statistic (D50, its screen still to build), the incinerator (D51), the relief drawn from the levels (D52), show rather than tell (D53), excavator reach from its edge (D54), bridges at their line's pace and entered from behind only (D55), ribbons on the mountains and the traction elevators (D56), **ribbons tile by tile** (D57: one item per tile, a tile a step, the engine says where every item is; save version 2).
- ✅ 2026-10-14: **land in parcels** (D60, [land.md](land.md)): the starting square round the cirque and its Crown, parcels bought at a price from what they hold or leased by the hour (Land Registry, `tr4`; a lease the purse cannot pay lapses, its buildings dormant), sister claims owning some parcels, the expansion research reworded onto land, the waystation and the influence zones retired (save version 3, `zonesToParcels`); the late debug base's outer works laid from a drawn plan on bought parcels (D61).
- Next candidates, from the review of 2026-10-13:
  - Hide or wire inert content: the temperature shown without effect (D26), and research flags with no consumer.
  - A long-term goal: the claim's value ranked against the sister claims in the Gazette, and CrierBelt delivery contracts in world time.
  - Souffle storms as world events: the wind on the Crown, dust on the panels, forecast by the Gazette (gives `stormHarvest` a use).
  - Undo, blueprints, and sprite culling for big bases.

## M8: onboarding and polish

✅ Quests 0–11 (section 8: `content/quests.ts`, `sim/systems/quests.ts`, the quest log and the guide; a scripted run completes them in `quests.test.ts`, `FL.quests` / `FL.completeQuest`; [quests.md](quests.md)), night tint and lights, FX, the far-zoom look, the flow-heat overlay, ✅ generative audio (D30: score, ambience, cues, live volumes; [audio.md](audio.md)), Ctrl+Z (commands make undo tractable: inverse commands or a replay from a checkpoint), README for players, the full smoke run in fr-FR and en-US, a stress colony at > 30 fps.

## After v1

The server (Node + SQLite): accounts, cloud saves, an authoritative clock, a shared market (all players' flows + NPCs for liquidity), validating the catch-up by replay (checkpoint + command log + ledger), the same `MarketService`. Then Crier calls (cooperative world contracts), seasons and leagues, read-only visits to other colonies, monumental works, blueprints, touch / mobile.

## Known debts

Kept short; fix them when you are in the area.

- The tech tree screen and the HUD derive the tree's state separately.
- Offline approximations still unmeasured beyond `mode: 'approx'`: non-periodic regimes extrapolated from their warm-up average, cache reuse jumping a group to a snapshot (edge clamps are now counted: `clampedMu`, `lostMu`; docs/offline.md).
- Unread knobs and inert content: see the gaps in [content.md](content.md) and [engine.md](engine.md).
- The buildings view rebuilds every sprite on each structural change and culls nothing: fine today, a risk for the M8 stress colony.
- The catch-up of a base whose grid's satisfaction changes every few minutes (wind, brownouts) re-keys its groups ~100 000 times a week: the `late` debug base takes ~16 s for a week (offline.md, Performance). A Worker, coarser satisfaction steps in the keys, or direct ticking of short segments.
- Hints name the pipette key by language, not by keyboard layout.
- Land (D60): its defaults were chosen without the owner's answers (16-tile parcels, leases that lapse, sister claims owning land, the Heart's level as a discount; one constant each in `BAL.land`): confirm them. Bought land cannot be sold back, and the sister claims' parcels never change hands or price but by what they hold. The code keeps the zones' names for the claim's land (`needsZone`, `outside_zone`, `inZone`). `landPrice` reads the parcel's 256 tiles on every call: a view that prices many parcels at the 4 Hz refresh wants a cache by parcel and terrain change.
