# Ocelle — working notes for coding agents

A persistent factory / logistics browser game, titled **Ocelle** since 2026-10-13 (working title FILON: the `filon/` folder, the `filon.*` storage keys, `window.FL` and `FilonDebug` keep it on purpose; [D46](docs/decisions.md)) (Vite 5 + TypeScript strict + PixiJS 8.21 + vitest). The owner speaks French; code, comments and docs are in English, and the game UI is French-first with English.

**Read first:** [ARCHITECTURE.md](ARCHITECTURE.md) (layers, invariants, where code goes), then the doc for the area you touch (`docs/`). Any player-facing text follows [docs/lore.md](docs/lore.md): no humans at the base, « le Cœur » for the Hearth, « base » not « colonie ». The game design is in `~/.claude/plans/nous-allons-creer-un-mighty-perlis.md` (French): sections 3–6 cover the rules and numbers, section 10 the milestones. Status and next steps are in [docs/roadmap.md](docs/roadmap.md).

## Commands (run from `filon/`)

| | |
|---|---|
| `npm run dev` | dev server on **:5183** (strict port; `.claude/launch.json` at the BrowserGames root has `filon` and `filon-preview`) |
| `npm run typecheck` | whole project + the purity check (`src/sim/tsconfig.json`: engine, market and content without DOM) |
| `npm test` | all unit tests, then the perf bench on its own (it is timing-sensitive) |
| `npm run build` | typecheck + vite build |
| `npm run smoke` | end-to-end in the system Chrome (playwright-core) against a running :5183 server; writes `scripts/*.png` |
| `node scripts/shots.mjs` | named screenshots for visual review |

A change is **done** when typecheck, `npm test`, the build and the smoke test are green, and you have looked at the relevant screenshots. Run node scripts from `filon/` (or `scripts/`) so `playwright-core` resolves. The in-app browser pane is often a hidden tab, and a hidden tab pauses `requestAnimationFrame`, so test interactions through the headless smoke test, not by clicking in a hidden pane.

## Hard rules

- **Git.**
  - No stash, reset, checkout or other destructive command: uncommitted work from several sessions shares this checkout.
  - The lead (organising) session commits verified work to the working branch and pushes it without asking. The owner said on 2026-10-16: « Just do it ».
  - Sub-sessions run no git at all.
- **Don't stop to ask the owner.** Decide the defaults, state them, and keep going. Ask only for something destructive or that can't be undone.
- **Engine determinism** (`src/sim`, `src/core`): integers only (milli-items `MU = 1000`, kW, ‰, centi-ocelles); no `Math.random`, `Date`, `performance`, `sin/cos/exp/log/pow/atan2/hypot`; use `isqrt` and squared distances; sort with total comparators; never `for…in`. The determinism guard test will catch you.
- **Offline exactness**: anything that changes over time must work in the catch-up (`docs/offline.md`, "Making a new mechanic offline-exact") and have an online ≈ offline test.
- **Mutations go through commands**: add a `Command` variant + an `exec` case + a Sim method that logs itself; keep `replay` working (`commands.test.ts`).
- **Layering** is enforced by `src/architecture.test.ts`. Don't widen it to make a test pass: move the shared piece down a layer instead.
- **Numbers live in content** (`BAL` in `src/content/balance.ts` or the tables), never inline.
- **The sim emits ids and numbers, never text.** Every UI string goes through `t()`/`tr()`; `fr.ts` is the source; `en.ts` must have the same keys and placeholders. French typography: never a plain space before `: ; ! ? %`. Use U+00A0 before `:` and U+202F (narrow) before `; ! ? %`. The i18n test checks `fr.ts` and the French half of every `{ fr, en }` in the content tables.
- **Nothing vanishes silently**: refund to the Hearth, apply back-pressure; never delete items unseen. The two ways out are seen: the incinerator (the player's choice, D51) and the Gleaners (D103), whose every take is counted (`Sim.gleaned`), reported at dawn and marked on its line.
- **Saves are sacred** (M7, [docs/persistence.md](docs/persistence.md)). A new saved field is optional with a default, and is declared in `FIELDS` (`src/sim/save-remap.ts`). Renaming or removing an item, building or recipe id needs a line in `src/content/retired.ts`. A new save shape bumps `SAVE_VERSION` and adds a step to `MIGRATIONS`. Tests and automation save to the sandbox database (`ocelle-sandbox`); a reload opens the same base, so use `FL.wipe()` to start from bare land.

## Style

- Every file starts with `// name.ts — role` and a few lines on what it does and why. Comments are dense and explain the reasoning, not the syntax.
- Small pure functions; the `Sim` class is a facade, and rules go in `src/sim/systems/*`.
- DOM UI: build with `el()`, update with change-only `setText`/`setAttr`, rebuild only when a signature changes (refresh runs at 4 Hz).
- Art is generated in code (Canvas2D in a style close to Moebius ink drawings, then cached in atlases); there are no image files.
- Docs: relative links, symbols in backticks, no line numbers. **Update the docs in the same change** when you move or add a module, a rule or an extension point.

## Working with subagents

The parts that can be worked on in parallel with little conflict: `src/market` (pure), `src/render/art/recipes/*`, `src/ui/screens/*`, `src/content` tables, and the docs. Give each agent the file list it owns. Tell it not to edit outside that list, not to run git, and to run only the tests for its own area (`npx vitest run <path>`). The lead runs the full checks and the smoke test, and integrates.

**Don't make the owner click.** Sessions run in bypass permissions mode, but some things still ask the owner:
- Writing anything inside a `.claude/` folder (`launch.json`, settings) asks every time.
- Opening the in-app Browser pane on a new site or port asks too.

So put extra configs in your scratchpad. Start extra servers with Bash in the background, e.g. `npx vite --port <n> --strictPort`, or `npx vite preview --outDir <dir> --port <n>` for a frozen build. Drive them with headless playwright-core, as `scripts/smoke.mjs` does. Only the existing `ocelle` launch config (:5183) is for the owner's own play.

**:5184 belongs to the owner.** It serves a production build of the last pushed commit (`~/ocelle-stable.sh`, from the worktree `~/ocelle-stable`), with no HMR. Never use that port or that worktree. After each push the lead runs `~/ocelle-stable.sh update`.
