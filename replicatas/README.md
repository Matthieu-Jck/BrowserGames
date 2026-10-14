# REPLICATAS

A browser roguelite deckbuilder in the spirit of Slay the Spire, rendered with Three.js.

You are a self-replicating probe — the **Von Neumann Protocol** — launched from a doomed
Earth to find humanity a new home. Travel planet to planet, harvest resources, fight
alien fauna, feral machines and rogue copies of yourself in turn-based card combat,
and replicate: when you die, a backup of you wakes — slightly improved — and the
lineage continues.

## Running

```sh
npm install
npm run dev        # dev server (Vite)
npm test           # headless engine + run-loop test suites (vitest)
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
```

Everything is procedural — geometry, planet textures, card art, sound, music. No asset files.

## The game

- **Act I — The Search (planets 1–10):** the scanner reveals what lies ahead; you choose
  destinations and surface routes. The 10th planet is always the Garden World — and it is
  defended. Defeating **SERAPH-0** "wins"… but nobody is left to come.
- **Act II — The Protocol (planets 11–20):** colonize. Your divergent descendants are out
  here, and some of them are hostile. **PRIME**, the first divergence, waits at the Foundry World.
- **Act III — Ouroboros:** superintelligence, a black hole, and a door that leads backward.

**Combat:** Slay-the-Spire-style cards across five archetypes — LASER (Charge), KINETIC
(Overheat), NUCLEAR (Radiation), SPEED (draw/evasion/Scout), REPAIR (shields/nanites) —
86 cards, 23 named enemies with telegraphed intents and thematically coherent loot.

**The signature tension:** every upgrade adds *Burden*, and Burden raises the cost of
replicating yourself at a Forge. A stronger probe is a more expensive probe to back up.
Death without a backup ends the lineage — your Data banks to **the Archive**, buying
permanent unlocks for the next probe. A roguelite is not made to be beat first try.

## Dev console

`window.RP` in the browser console: `RP.skipTo(10)`, `RP.combat('prime')`, `RP.winCombat()`,
`RP.minerals(500)`, `RP.card('annihilation_ray')`, `RP.backup()`, `RP.die()`, `RP.wipe()`…

## Smoke tests

With the dev server on port 5199 and Google Chrome installed:

```sh
node scripts/smoke.mjs        # core loop: combat, rewards, shop, forge, death/wake
node scripts/smoke-story.mjs  # full arc: Earthfall → SERAPH-0 → PRIME → EXODUS → ending
```

## Architecture

- `src/combat/` — headless deterministic card engine (data-driven `EffectOp` interpreter,
  status hooks, scripted boss AIs). Tested directly by vitest; the UI only consumes its event queue.
- `src/content/` — all cards/enemies/events/upgrades/payloads as typed data, validated at startup.
- `src/core/` — run/meta state, seeded RNG streams (maps and loot regenerate from seed —
  reloading cannot reroll a fight), lineage/replication, localStorage saves.
- `src/map/` — planet generation, surface DAGs, scanner intel gating, encounter tables.
- `src/scenes/` + `src/vfx/` — one renderer, three scenes (space / orbit / combat diorama),
  bloom + telemetry post, procedural meshes and canvas textures.
- `src/ui/` — vanilla TS screens over the canvas; cards, targeting arrows, SVG route maps.
- `src/audio/` — Web Audio synthesis and a generative lookahead-scheduled score.
