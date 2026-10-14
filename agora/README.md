# AGORA

**An economics game that makes you *feel* the market.** A generative, scroll-light journey
through five laws of markets — supply & demand, the invisible hand, price controls & taxes,
comparative advantage, and the tragedy of the commons. Each chapter pairs a living particle
scene with a real, deterministic economics engine, and gives **blunt, consequence-driven
feedback**: guess wrong or set a bad policy and the game tells you so, then shows the damage
— a shortage, a deadweight-loss triangle, a collapsed fishery.

Named for the *agora*, the ancient marketplace where prices were discovered by a haggling
crowd — which is, almost literally, Chapter 2.

## The five chapters

1. **The Price is a Signal** — supply, demand, equilibrium. Set a price; watch a shortage or
   glut open up. Then find the new clearing price after a frost shrinks supply.
2. **The Invisible Hand** — an agent-based double auction. Hundreds of buyers/sellers with
   hidden reservation prices trade with no auctioneer, and the price converges on equilibrium.
3. **When We Meddle** — price ceilings, floors (minimum wage) and taxes. Shortages, gluts,
   tax incidence, and the deadweight loss shaded in red.
4. **Why We Trade** — comparative advantage. Two producers both get richer by specialising,
   even when one is better at everything. Strike a deal inside the terms-of-trade band.
5. **The Tragedy** — the commons as logistic fishery dynamics. Open access collapses the
   stock; a quota saves it. Where the unregulated market eats itself.

Every prediction and challenge is scored; a final **report card** grades how well you read
each law.

## Run

```bash
npm install
npm run dev          # http://localhost:5176
npm run build        # tsc --noEmit && vite build  →  dist/
npm run preview      # serve the production build on :5176
```

It's a Vite + TypeScript app; static once built.

## Test

```bash
npm test             # vitest: the economics engine + scoring, ~40 unit tests
npm run typecheck    # tsc --noEmit, strict

# end-to-end (with `npm run dev` or `npm run preview` running):
URL=http://localhost:5176 npm run smoke
```

`npm run smoke` is a headless Chrome (playwright-core) pass that drives the entire journey
through the `window.AG` debug API: it asserts the blunt verdict fires on every wrong guess
and agrees with the engine on every right one, that the auction converges, that the fishery
collapses under open access and survives under a quota, and that frames keep rendering. It
writes screenshots to `scripts/`.

## Architecture

- **`src/econ/`** — the deterministic engine: pure, seeded, fully unit-tested (`*.test.ts`).
  `equilibrium`, `auction` (an adaptive call auction that provably converges), `controls`
  (price controls + tax incidence + deadweight loss), `advantage` (comparative advantage),
  `fishery` (logistic stock + collapse). The renderers only ever *draw* what these return.
- **`src/render/`** — Canvas 2D. `agent-field` is the generative backbone (a noise-driven
  mote field, reused as the ambient background and the auction crowd); `graph` draws the
  animated supply/demand pictures; one `scene-*.ts` per chapter; `layers` composes the
  fixed canvas stack with parallax.
- **`src/journey/`** — chapters are *data*; `journey.ts` is the beat state machine that walks
  narrate → predict → reveal → verdict → sandbox → challenge and emits bus events.
- **`src/ui/`** — DOM glass panels over the canvases. `verdict.ts` is the reusable blunt-
  feedback component; `report-card.ts` the finale.
- **`src/scoring/`** — pure grading (`grade.ts`, tested) + `localStorage` progress.
- **`src/content/`** — per-chapter copy, prompts, sandbox ranges, challenge scoring and the
  severity-keyed verdict phrasebook (`copy.ts`).
- **`src/core/`** — shared substrate (seeded RNG + value noise, typed event bus, tween/easing,
  hyperscript DOM, versioned save).
- **`window.AG`** (`src/debug.ts`) — the deterministic console/test handle.
